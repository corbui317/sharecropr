BEGIN;
SELECT plan(12);

SELECT ok((SELECT rowsecurity FROM pg_tables WHERE tablename = 'verifications'), 'S1: RLS enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'verifications'), 'S2: RLS forced');

SELECT tests.authenticate_as('owner');
SELECT is((SELECT count(*) FROM public.verifications WHERE user_id = tests.fixture('owner')), 1::bigint,
          'P1: owner reads own verification');

SELECT tests.authenticate_as('moderator');
SELECT is((SELECT count(*) FROM public.verifications WHERE user_id = tests.fixture('owner')), 1::bigint,
          'P2: moderator reads verification');

-- Negative
SELECT tests.authenticate_as('stranger');
SELECT is((SELECT count(*) FROM public.verifications WHERE user_id = tests.fixture('owner')), 0::bigint,
          'N1: stranger cannot read other verification');
SELECT throws_ok($$ UPDATE public.verifications SET status = 'passed'
                     WHERE user_id = tests.fixture('owner') $$,
          '42501', NULL, 'N2: stranger cannot update verification');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ UPDATE public.verifications SET status = 'passed'
                     WHERE user_id = tests.fixture('owner') $$,
          '42501', NULL, 'N3: owner cannot self-verify (no update policy)');

SELECT tests.authenticate_as_anon();
SELECT is((SELECT count(*) FROM public.verifications), 0::bigint, 'N4: anon sees nothing');
SELECT throws_ok($$ INSERT INTO public.verifications (user_id) VALUES (gen_random_uuid()) $$,
          '42501', NULL, 'N5: anon cannot insert');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ INSERT INTO public.verifications (user_id, status)
                    VALUES (tests.fixture('stranger'), 'passed') $$,
          '42501', NULL, 'N6: cannot insert verification row');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ DELETE FROM public.verifications WHERE user_id = tests.fixture('owner') $$,
          '42501', NULL, 'N7: no delete policy');

SELECT throws_ok($$ SELECT * FROM private.verification_vendor_refs LIMIT 1 $$,
          '42501', NULL, 'N8: private vendor refs unreachable');

SELECT * FROM finish();
ROLLBACK;
