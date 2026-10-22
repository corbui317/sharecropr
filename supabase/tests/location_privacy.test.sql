BEGIN;
SELECT plan(15);

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

-- LP-06: averaging resistance (Location Privacy §11; mean of 1,000 reads > 400 m from truth).
-- display_point is deterministic per garden (§4.1), so the attack is: read the same garden
-- 1,000 times through the client path and average. Each read is a separate execution of the
-- PostgREST-shaped query, as `authenticated` with JWT claims, under RLS (gardens_select_own).
-- Exact coordinates never leave SQL: assertions use ok()/is() on booleans and counts only.
CREATE TEMP TABLE lp06_samples (p geography(Point, 4326)) ON COMMIT DROP;
GRANT INSERT ON lp06_samples TO authenticated;
SELECT tests.authenticate_as('owner');
DO $$
BEGIN
  FOR i IN 1..1000 LOOP
    INSERT INTO lp06_samples (p)
    SELECT g.display_point FROM public.gardens g WHERE g.id = tests.fixture('owner_garden');
  END LOOP;
END $$;
SELECT tests.clear_authentication();

SELECT is(
  (SELECT count(p) FROM lp06_samples)::int,
  1000, 'LP-06: 1000 client-path reads each returned a display_point');

SELECT ok(
  (SELECT ST_Distance(
            ST_Centroid(ST_Collect(s.p::geometry))::geography,
            (SELECT l.exact_point FROM private.garden_locations l
              WHERE l.garden_id = tests.fixture('owner_garden'))) > 400
     FROM lp06_samples s),
  'LP-06: mean of 1000 client reads stays >400m from exact_point');

SELECT ok(
  (SELECT ST_Distance(
            ST_Centroid(ST_Collect(s.p::geometry))::geography,
            (SELECT g.display_point FROM public.gardens g
              WHERE g.id = tests.fixture('owner_garden'))) < 0.01
     FROM lp06_samples s),
  'LP-06: mean of client reads equals the stored display_point (no per-read noise)');

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

-- LP-08/09/10/12 are not implemented here. skip(), not pass(): a placeholder must not
-- report as a passing location invariant. Descriptions start with the backlog key (not
-- 'LP-NN:') so ci-assert-negative-ratio does not count them as negatives.
SELECT skip('SCR-1701: LP-08 telemetry scrubber on a synthetic Sentry event (JS test, not pgTAP)');
SELECT skip('SCR-0604: LP-09 EXIF absent from every stored asset (integration test, EPIC-06)');
SELECT skip('SCR-0210: LP-10 scheduled production canary (cron job, not pgTAP)');
SELECT skip('SCR-0804: LP-12 radius recall across a coarse-cell edge needs safe_spots (EPIC-08)');

-- derive_display_point not granted to authenticated
SELECT tests.authenticate_as('owner');
SELECT throws_ok(
  $$ SELECT app.derive_display_point(
       ST_SetSRID(ST_MakePoint(0,0),4326)::geography, gen_random_uuid()) $$,
  '42501', NULL, 'LP: derive_display_point not client-callable');

SELECT * FROM finish();
ROLLBACK;
