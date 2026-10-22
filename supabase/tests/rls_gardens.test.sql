BEGIN;
SELECT plan(30);

SELECT ok((SELECT rowsecurity FROM pg_tables WHERE tablename = 'gardens'), 'S1: RLS enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'gardens'), 'S2: RLS forced');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'gardens' AND indexname = 'gardens_owner_idx'),
          'S3: owner_id indexed');

SELECT tests.authenticate_as('owner');
SELECT is((SELECT count(*) FROM public.gardens WHERE id = tests.fixture('owner_garden')), 1::bigint,
          'P1: owner sees own garden');
SELECT lives_ok($$ UPDATE public.gardens SET name = 'My Garden'
                    WHERE id = tests.fixture('owner_garden') $$,
          'P2: owner updates own garden');

SELECT tests.authenticate_as('moderator');
SELECT is((SELECT count(*) FROM public.gardens WHERE id = tests.fixture('owner_garden')), 1::bigint,
          'P3: moderator reads garden');

-- Negative
-- SPEC-004-T23 (fine_cell), SPEC-004-N09 (other user's garden)
SELECT tests.authenticate_as('stranger');
SELECT is((SELECT count(*) FROM public.gardens WHERE id = tests.fixture('owner_garden')), 0::bigint,
          'N1: stranger cannot read other garden');
-- RLS turns a cross-user UPDATE into a 0-row no-op, not an error: assert the row is unchanged.
SELECT lives_ok($$ UPDATE public.gardens SET name = 'Stolen'
                    WHERE id = tests.fixture('owner_garden') $$,
          'N2: stranger UPDATE of another garden is a silent no-op');
SELECT tests.clear_authentication();
SELECT is((SELECT name FROM public.gardens WHERE id = tests.fixture('owner_garden')), 'My Garden',
          'N15: other garden unchanged after stranger UPDATE');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ UPDATE public.gardens SET display_point = ST_SetSRID(ST_MakePoint(0,0),4326)::geography
                     WHERE id = tests.fixture('owner_garden') $$,
          '42501', NULL, 'N3: client cannot write display_point');
SELECT throws_ok($$ SELECT fine_cell FROM public.gardens WHERE id = tests.fixture('owner_garden') $$,
          '42501', NULL, 'N4: fine_cell column revoked (SPEC-004-T23)');

SELECT throws_ok($$ SELECT exact_point FROM private.garden_locations LIMIT 1 $$,
          '42501', NULL, 'N5: private garden_locations unreachable');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ INSERT INTO public.gardens (owner_id, name)
                    VALUES (tests.fixture('owner'), 'Forged') $$,
          '42501', NULL, 'N6: cannot insert garden for another user');

SELECT tests.authenticate_as('no_garden');
SELECT lives_ok($$ INSERT INTO public.gardens (owner_id, name)
                    VALUES (tests.fixture('no_garden'), 'Draft One') $$,
          'P4: user without garden inserts draft');

SELECT tests.authenticate_as_anon();
SELECT throws_ok($$ SELECT count(*) FROM public.gardens $$,
          '42501', NULL, 'N7: anon has no privilege on gardens');

-- Privilege escalation by PATCH (table-level grants used to let owners self-verify)
SELECT tests.authenticate_as('no_garden');
SELECT throws_ok($$ UPDATE public.gardens SET status = 'verified'
                     WHERE owner_id = tests.fixture('no_garden') $$,
          '42501', NULL, 'N16: owner cannot set own garden status');
SELECT throws_ok($$ UPDATE public.gardens SET verified_at = now()
                     WHERE owner_id = tests.fixture('no_garden') $$,
          '42501', NULL, 'N17: owner cannot set verified_at');
SELECT throws_ok($$ UPDATE public.gardens SET owner_id = tests.fixture('stranger')
                     WHERE owner_id = tests.fixture('no_garden') $$,
          '42501', NULL, 'N18: owner cannot reassign garden');
SELECT throws_ok($$ UPDATE public.gardens SET deleted_at = now()
                     WHERE owner_id = tests.fixture('no_garden') $$,
          '42501', NULL, 'N19: owner cannot soft-delete via PATCH');
SELECT throws_ok($$ INSERT INTO public.gardens (owner_id, name, status)
                    VALUES (tests.fixture('no_garden'), 'Born Verified', 'verified') $$,
          '42501', NULL, 'N20: cannot insert a garden with a chosen status');

SELECT tests.authenticate_as('moderator');
SELECT throws_ok($$ SELECT fine_cell FROM public.gardens $$,
          '42501', NULL, 'N21: moderator cannot select fine_cell either (SPEC-004-T23)');

-- Fuzz invariant needs private.garden_locations, unreachable by clients: run as migration role.
SELECT tests.clear_authentication();
SELECT ok(
  (SELECT ST_Distance(
    (SELECT exact_point FROM private.garden_locations WHERE garden_id = tests.fixture('owner_garden')),
    (SELECT display_point FROM public.gardens WHERE id = tests.fixture('owner_garden'))
  ) BETWEEN 400 AND 1200),
  'N8: display_point 400-1200m from exact (LP-04 sample)');

SELECT tests.authenticate_as('owner');
SELECT is(
  (SELECT count(DISTINCT ST_AsBinary(display_point)) FROM (
     SELECT display_point FROM public.gardens WHERE id = tests.fixture('owner_garden')
     UNION ALL SELECT display_point FROM public.gardens WHERE id = tests.fixture('owner_garden')
     UNION ALL SELECT display_point FROM public.gardens WHERE id = tests.fixture('owner_garden')
   ) s)::int,
  1, 'N9: display_point stable across reads (LP-05 sample)');

SELECT tests.authenticate_as('canary_a');
SELECT is((SELECT count(*) FROM public.gardens WHERE id = tests.fixture('canary_b_garden')), 0::bigint,
          'N10: canary A cannot read B garden');
SELECT ok((SELECT lat IS NOT NULL FROM public.get_my_garden_location(tests.fixture('canary_a_garden'))),
          'P5: owner reads own exact via RPC');

SELECT tests.authenticate_as('canary_a');
SELECT throws_ok($$ SELECT * FROM private.garden_locations $$,
          '42501', NULL, 'N11: private schema query denied');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ INSERT INTO private.garden_locations (garden_id, exact_point, capture_source)
                    VALUES (tests.fixture('owner_garden'),
                            ST_SetSRID(ST_MakePoint(0,0),4326)::geography, 'device_gps') $$,
          '42501', NULL, 'N12: cannot insert private location');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ DELETE FROM public.gardens WHERE id = tests.fixture('owner_garden') $$,
          '42501', NULL, 'N13: no delete policy');

SELECT tests.authenticate_as('suspended');
SELECT is((SELECT count(*) FROM public.gardens WHERE owner_id = tests.fixture('suspended')), 0::bigint,
          'N14: suspended user gardens hidden (no gardens seeded)');

-- app.location_cell is internal (not granted to clients); exercised as the migration role.
SELECT tests.clear_authentication();
SELECT ok(app.location_cell(ST_SetSRID(ST_MakePoint(10, 50), 4326)::geography, 'coarse')
            ~ '^2500:[0-9]+:[0-9]+$',
          'P6: location_cell derives a coarse-tier cell id (ADR-0023)');

SELECT * FROM finish();
ROLLBACK;
