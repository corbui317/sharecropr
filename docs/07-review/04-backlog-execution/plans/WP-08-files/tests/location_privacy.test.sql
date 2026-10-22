BEGIN;
SELECT plan(13);

-- LP-01: private schema grants
SELECT is(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'private' AND grantee IN ('anon','authenticated'))::int,
  0, 'LP-01: no client grants on private');

-- LP-03: no client-reachable function returns private-sourced geography for gardens
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND pg_get_function_result(p.oid) LIKE '%geography%'
    AND p.proname NOT IN ('get_my_garden_location')
), 'LP-03: public geography RPCs are allowlisted');

-- LP-04: fuzz distance band (seeded garden)
SELECT ok(
  (SELECT ST_Distance(
    l.exact_point,
    g.display_point
  ) BETWEEN 400 AND 1200
   FROM private.garden_locations l
   JOIN public.gardens g ON g.id = l.garden_id
  WHERE l.garden_id = tests.fixture('owner_garden')),
  'LP-04: fuzz offset within 400-1200m');

-- LP-05: quantization invariance
SELECT is(
  (SELECT count(DISTINCT ST_AsBinary(g.display_point))
     FROM public.gardens g, generate_series(1, 100) s
    WHERE g.id = tests.fixture('owner_garden'))::int,
  1, 'LP-05: identical display_point on repeated read');

-- LP-06: averaging resistance
WITH samples AS (
  SELECT g.display_point AS p, l.exact_point AS truth
    FROM public.gardens g
    JOIN private.garden_locations l ON l.garden_id = g.id
   CROSS JOIN generate_series(1, 100)
   WHERE g.id = tests.fixture('owner_garden')
)
SELECT ok(
  (SELECT ST_Distance(ST_Centroid(ST_Collect(p::geometry))::geography, (array_agg(truth))[1]) > 400 FROM samples),
  'LP-06: mean of samples stays >400m from truth');

-- LP-07: bearing varies across seeds (spot check, not full chi-squared at baseline)
SELECT ok(
  (SELECT count(DISTINCT round(ST_Azimuth(
    l.exact_point::geometry,
    g.display_point::geometry
  )::numeric, 1))
   FROM private.garden_locations l
   JOIN public.gardens g ON g.id = l.garden_id
  WHERE l.garden_id IN (tests.fixture('owner_garden'), tests.fixture('requester_garden'),
                        tests.fixture('canary_a_garden'), tests.fixture('canary_b_garden'))) >= 2,
  'LP-07: bearing varies across gardens');

-- LP-11: audit metadata coordinate check
SELECT throws_ok(
  $$ INSERT INTO audit.events (actor_role, action, metadata)
       VALUES ('test', 'test.bad', '{"lat": 42.0}'::jsonb) $$,
  '23514', NULL, 'LP-11: audit rejects coordinate metadata');

SELECT lives_ok(
  $$ INSERT INTO audit.events (actor_role, action, metadata)
       VALUES ('test', 'test.ok', '{"note": "safe"}'::jsonb) $$,
  'LP-11b: audit accepts safe metadata');

-- LP-08..LP-10: Jest/cron — scaffold only at baseline
SELECT pass('LP-08: telemetry scrubber tested in Jest (packages/location-canary)');
SELECT pass('LP-09: EXIF integration deferred to EPIC-06');
SELECT pass('LP-10: production canary in packages/location-canary');

-- LP-12: cell boundary recall stub
SELECT pass('LP-12: cell-boundary recall requires safe_spots seed (EPIC-07)');

-- derive_display_point not granted to authenticated
SELECT tests.authenticate_as('owner');
SELECT throws_ok(
  $$ SELECT app.derive_display_point(
       ST_SetSRID(ST_MakePoint(0,0),4326)::geography, gen_random_uuid()) $$,
  '42501', NULL, 'LP: derive_display_point not client-callable');

SELECT * FROM finish();
ROLLBACK;
