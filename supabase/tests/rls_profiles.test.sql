BEGIN;
SELECT plan(18);

-- Structural
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE tablename = 'profiles'), 'S1: RLS enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'profiles'), 'S2: RLS forced');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'profiles' AND indexname = 'profiles_active_idx'),
          'S3: id indexed for policies');

-- Positive
SELECT tests.authenticate_as('owner');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('owner')), 1::bigint,
          'P1: owner reads own profile');
SELECT lives_ok($$ UPDATE public.profiles SET bio = 'Hello' WHERE id = tests.fixture('owner') $$,
          'P2: owner updates own profile');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('requester')), 1::bigint,
          'P3: owner sees requester profile card');

SELECT tests.authenticate_as('moderator');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('owner')), 1::bigint,
          'P4: moderator reads profile');

-- Negative
SELECT tests.authenticate_as('stranger');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('owner')), 0::bigint,
          'N1: stranger cannot read other profile');
SELECT throws_ok($$ UPDATE public.profiles SET bio = 'hack' WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N2: stranger cannot update other profile');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('owner')), 1::bigint,
          'N3: stranger can read profile card (public fields)');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ SELECT trust_score FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N4: column revoke on trust_score');
SELECT throws_ok($$ SELECT home_h3_r7 FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N5: column revoke on home_h3_r7');

SELECT tests.authenticate_as('blocked');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('blocker')), 0::bigint,
          'N6: blocked user invisible in profile_cards');

SELECT tests.authenticate_as('blocker');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('blocked')), 0::bigint,
          'N7: block is bidirectional in profile_cards');

SELECT tests.authenticate_as_anon();
SELECT is((SELECT count(*) FROM public.profiles), 0::bigint, 'N8: anon sees no profiles');
SELECT throws_ok($$ INSERT INTO public.profiles (id, display_name, handle)
                    VALUES (gen_random_uuid(), 'Fake', 'fake_handle') $$,
          '42501', NULL, 'N9: anon cannot insert profile');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ INSERT INTO public.profiles (id, display_name, handle)
                    VALUES (gen_random_uuid(), 'Fake', 'fake_h') $$,
          '42501', NULL, 'N10: authenticated cannot insert profile (trigger only)');

SELECT tests.authenticate_as('deleted');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('deleted')), 0::bigint,
          'N11: soft-deleted user cannot read own row via RLS');

SELECT * FROM finish();
ROLLBACK;
