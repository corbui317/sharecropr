-- Location tiers, PostGIS only (ADR-0023, supersedes ADR-0005). Tags: ADR-0023, LP-03, LP-11,
-- SPEC-004-T05, SPEC-004-T23, TC-GEO-10. No fine-tier value or garden coordinate reaches TAP output:
-- assertions on stored cells are ok() on booleans or is() on counts. Walk points are synthetic.
BEGIN;
SELECT plan(19);

-- ── Positive ────────────────────────────────────────────────────────────────
SELECT is(ARRAY[app.location_tier_side_m('region'), app.location_tier_side_m('coarse'),
                app.location_tier_side_m('fine')],
          ARRAY[16000, 2500, 320],
  'P1: the tier ladder is region 16 km, coarse 2.5 km, fine 320 m (ADR-0023)');

SELECT ok((SELECT g.coarse_cell = app.location_cell(l.exact_point, 'coarse')
              AND g.fine_cell   = app.location_cell(l.exact_point, 'fine')
             FROM public.gardens g JOIN private.garden_locations l ON l.garden_id = g.id
            WHERE g.id = tests.fixture('owner_garden')),
  'P2: the location trigger derives coarse_cell and fine_cell from exact_point');

SELECT is((SELECT count(*) FROM public.gardens
            WHERE coarse_cell ~ '^2500:[0-9]+:[0-9]+$' AND fine_cell ~ '^320:[0-9]+:[0-9]+$')::int,
  4, 'P3: all four seeded gardens carry one cell per stored tier');

-- Resolution: walk 100 points spaced side/10 (9.9 sides) and count distinct column (E-W) or row
-- (N-S) indices. Square side x side cells give 10-11. A degree grid shrunk by cos(lat) gives 14+ at
-- 42N. ST_Project measures on the spheroid, independently of location_cell's sphere.
SELECT ok((SELECT bool_and(n BETWEEN 9 AND 12) FROM (
    SELECT count(DISTINCT split_part(app.location_cell(
             ST_Project(ST_SetSRID(ST_MakePoint(-83.80, 42.28), 4326)::geography,
                        i * app.location_tier_side_m(t) / 10.0, radians(90)), t), ':', 3)) AS n
      FROM unnest(ARRAY['region','coarse','fine']) AS t CROSS JOIN generate_series(0, 99) AS i
     GROUP BY t) s),
  'P4: every tier is its nominal size east-west at 42N (TC-GEO-10)');

SELECT ok((SELECT bool_and(n BETWEEN 9 AND 12) FROM (
    SELECT count(DISTINCT split_part(app.location_cell(
             ST_Project(ST_SetSRID(ST_MakePoint(-83.80, 42.28), 4326)::geography,
                        i * app.location_tier_side_m(t) / 10.0, radians(0)), t), ':', 2)) AS n
      FROM unnest(ARRAY['region','coarse','fine']) AS t CROSS JOIN generate_series(0, 99) AS i
     GROUP BY t) s),
  'P5: every tier is its nominal size north-south at 42N (TC-GEO-10)');

SELECT ok((SELECT count(DISTINCT split_part(app.location_cell(
             ST_Project(ST_SetSRID(ST_MakePoint(10.75, 59.91), 4326)::geography,
                        i * 250.0, radians(90)), 'coarse'), ':', 3))
             FROM generate_series(0, 99) AS i) BETWEEN 9 AND 12,
  'P6: coarse cells stay 2.5 km wide at 60N (no shrink with latitude)');

SELECT lives_ok($$ SELECT private.check_location_tiers() $$,
  'P7: nightly tier consistency check passes on trigger-derived data');

-- ── Negative ────────────────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT app.location_cell(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 'r9') $$,
  '22023', NULL, 'N1: an unnamed tier is rejected (no ad-hoc resolution)');

SELECT throws_ok($$ UPDATE public.gardens SET coarse_cell = '320:1:1' WHERE id = tests.fixture('owner_garden') $$,
  '23514', NULL, 'N2: coarse_cell rejects a value from any other tier');
SELECT throws_ok($$ UPDATE public.gardens SET fine_cell = '2500:1:1' WHERE id = tests.fixture('owner_garden') $$,
  '23514', NULL, 'N3: fine_cell rejects a value from any other tier');
SELECT throws_ok($$ UPDATE public.profiles SET home_coarse_cell = '320:1:1' WHERE id = tests.fixture('owner') $$,
  '23514', NULL, 'N4: profiles.home_coarse_cell rejects a finer tier');

SELECT is((SELECT count(*) FROM (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public','app') AND c.relkind IN ('v','m') AND NOT a.attisdropped
       AND a.attname IN ('fine_cell','exact_point','fuzz_seed')
    UNION ALL
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public','app')
       AND (pg_get_function_result(p.oid) ~ '(fine_cell|exact_point|fuzz_seed)'
         OR pg_get_function_arguments(p.oid) ~ '(fine_cell|exact_point|fuzz_seed)')) s)::int,
  0, 'N5: no client-reachable view or function exposes fine_cell, exact_point or fuzz_seed (LP-03 forbidden-column sweep)');

SELECT ok(NOT has_function_privilege('authenticated', 'app.location_cell(geography,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.location_cell(geography,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'app.location_tier_side_m(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.location_tier_side_m(text)', 'EXECUTE'),
  'N6: tier functions are not client-callable');

SELECT is((SELECT count(*) FROM pg_extension WHERE extname IN ('h3','h3_postgis'))::int,
  0, 'N7: no h3 extension is installed (ADR-0023)');

SELECT is(((SELECT count(*) FROM information_schema.columns
             WHERE table_schema IN ('public','private','app','audit') AND column_name ~ 'h3')
         + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('public','private','app','audit')
               AND (p.proname ~ '^h3_' OR p.proname = 'k_for_radius')))::int,
  0, 'N8: no h3 column or helper survives (ADR-0023)');

SELECT throws_ok($$ INSERT INTO audit.events (actor_role, action, metadata)
                    VALUES ('test', 'test.bad', '{"fine_cell": "x"}'::jsonb) $$,
  '23514', NULL, 'N9: audit.events rejects a fine_cell metadata key (LP-11)');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ UPDATE public.gardens SET coarse_cell = NULL WHERE id = tests.fixture('owner_garden') $$,
  '42501', NULL, 'N10: owner cannot write coarse_cell (SPEC-004-T05)');
SELECT throws_ok($$ UPDATE public.gardens SET fine_cell = NULL WHERE id = tests.fixture('owner_garden') $$,
  '42501', NULL, 'N11: owner cannot write fine_cell (SPEC-004-T05)');
SELECT tests.clear_authentication();

-- Drift detection: corrupt one stored cell (valid format, wrong value). Rolled back with the file.
UPDATE public.gardens SET fine_cell = '320:0:0' WHERE id = tests.fixture('owner_garden');
SELECT throws_ok($$ SELECT private.check_location_tiers() $$,
  'P0001', NULL, 'N12: the nightly consistency check raises on tier drift');

SELECT * FROM finish();
ROLLBACK;
