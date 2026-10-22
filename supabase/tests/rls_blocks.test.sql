BEGIN;
SELECT plan(19);

SELECT ok((SELECT rowsecurity FROM pg_tables WHERE tablename = 'blocks'), 'S1: RLS enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'blocks'), 'S2: RLS forced');

SELECT tests.authenticate_as('blocker');
SELECT is((SELECT count(*) FROM public.blocks WHERE blocker_id = tests.fixture('blocker')), 1::bigint,
          'P1: blocker sees own block');

SELECT tests.authenticate_as('blocker');
SELECT lives_ok($$ INSERT INTO public.blocks (blocker_id, blocked_id, reason)
                    VALUES (tests.fixture('blocker'), tests.fixture('stranger'), 'test') $$,
          'P2: blocker can create block');

-- Negative
SELECT tests.authenticate_as('blocked');
SELECT is((SELECT count(*) FROM public.blocks), 0::bigint,
          'N1: blocked party sees zero blocks');
SELECT is((SELECT count(*) FROM public.blocks
            WHERE blocker_id = tests.fixture('blocker')), 0::bigint,
          'N2: blocked cannot see block by blocker id');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ INSERT INTO public.blocks (blocker_id, blocked_id)
                    VALUES (tests.fixture('owner'), tests.fixture('stranger')) $$,
          '42501', NULL, 'N3: cannot block on behalf of another');

SELECT throws_ok($$ INSERT INTO public.blocks (blocker_id, blocked_id)
                    VALUES (tests.fixture('stranger'), tests.fixture('stranger')) $$,
          '23514', NULL, 'N4: no self-block');

SELECT tests.authenticate_as_anon();
SELECT throws_ok($$ SELECT count(*) FROM public.blocks $$,
          '42501', NULL, 'N5: anon has no privilege on blocks');
SELECT throws_ok($$ INSERT INTO public.blocks (blocker_id, blocked_id)
                    VALUES (gen_random_uuid(), gen_random_uuid()) $$,
          '42501', NULL, 'N6: anon cannot insert');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ UPDATE public.blocks SET reason = 'x'
                     WHERE blocker_id = tests.fixture('blocker') $$,
          '42501', NULL, 'N7: no update policy');

SELECT throws_ok($$ DELETE FROM public.blocks WHERE blocker_id = tests.fixture('blocker') $$,
          '42501', NULL, 'N8: no delete policy');

-- Caller-scoped helper (SPEC-003 / ADR-0022): answers only about auth.uid() vs other.
SELECT tests.authenticate_as('blocker');
SELECT ok(app.is_blocked_with(tests.fixture('blocked')),
          'P3: is_blocked_with true for the blocker');
SELECT tests.authenticate_as('blocked');
SELECT ok(app.is_blocked_with(tests.fixture('blocker')),
          'P4: is_blocked_with true for the blocked party (bidirectional in effect)');

SELECT tests.authenticate_as('owner');
SELECT ok(NOT app.is_blocked_with(tests.fixture('stranger')),
          'N9: unrelated users not blocked');

-- A third party cannot probe someone else's block relationship.
SELECT tests.authenticate_as('stranger');
SELECT ok(NOT app.is_blocked_with(tests.fixture('blocked')),
          'N10: third party cannot learn that blocker/blocked are linked');
SELECT throws_ok($$ SELECT app.is_blocked_either_way(tests.fixture('blocker'), tests.fixture('blocked')) $$,
          '42501', NULL, 'N11: two-arg is_blocked_either_way is not client-callable');
SELECT tests.authenticate_as_anon();
SELECT throws_ok($$ SELECT app.is_blocked_with(tests.fixture('blocker')) $$,
          '42501', NULL, 'N12: anon cannot execute is_blocked_with');
SELECT tests.authenticate_as('blocker');
SELECT throws_ok($$ UPDATE public.blocks SET reason = 'x' WHERE blocker_id = tests.fixture('blocker') $$,
          '42501', NULL, 'N13: blocker cannot UPDATE blocks either');

SELECT * FROM finish();
ROLLBACK;
