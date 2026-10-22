-- profiles RLS + column privileges (ADR-0022, RLS Design §4)
-- Tags: SPEC-001-T09 (insert), SPEC-001-T21, SPEC-001-N06, N07, N08, N09 (SPEC-001 §13.2)
BEGIN;
SELECT plan(38);

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
          'P2: owner updates own bio');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('requester')), 1::bigint,
          'P3: owner sees requester profile card');
SELECT is((SELECT locale FROM public.get_my_profile()), 'en-US',
          'P4: get_my_profile returns owner-only columns for the caller');

SELECT tests.authenticate_as('stranger');
SELECT is((SELECT display_name FROM public.profiles WHERE id = tests.fixture('owner')), 'Owner Gardener',
          'P5: stranger reads card-safe columns of another visible profile');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('owner')), 1::bigint,
          'P6: stranger reads profile card (public fields)');

SELECT tests.authenticate_as('moderator');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('owner')), 1::bigint,
          'P7: moderator reads a visible profile');

-- Negative: other users' rows
SELECT tests.authenticate_as('stranger');
-- N07: RLS makes this a 0-row UPDATE, not an error; assert the row did not change.
SELECT lives_ok($$ UPDATE public.profiles SET bio = 'hack' WHERE id = tests.fixture('owner') $$,
          'N1: stranger UPDATE of another profile is a silent no-op');
SELECT tests.clear_authentication();
SELECT is((SELECT bio FROM public.profiles WHERE id = tests.fixture('owner')), 'Hello',
          'N2: other profile unchanged after stranger UPDATE');

SELECT tests.authenticate_as('stranger');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('suspended')), 0::bigint,
          'N3: suspended user row invisible to others');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('deleted')), 0::bigint,
          'N4: soft-deleted user row invisible to others');
SELECT throws_ok($$ DELETE FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N5: no DELETE privilege on profiles');

-- Negative: columns (N08)
SELECT throws_ok($$ SELECT trust_score FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N6: other user''s trust_score not selectable');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ SELECT trust_score FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N7: trust_score not table-selectable even for self');
SELECT throws_ok($$ SELECT home_coarse_cell FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N8: home_coarse_cell not selectable (SPEC-001-N08)');
SELECT throws_ok($$ SELECT is_suspended FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N9: is_suspended not selectable');
SELECT throws_ok($$ SELECT locale FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N10: owner-only locale not table-selectable');
SELECT throws_ok($$ SELECT deleted_at FROM public.profiles WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N11: deleted_at not table-selectable');

-- Negative: privilege escalation by PATCH
SELECT throws_ok($$ UPDATE public.profiles SET is_suspended = false WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N12: cannot set own is_suspended');
SELECT throws_ok($$ UPDATE public.profiles SET trust_tier = 'trusted' WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N13: cannot set own trust_tier');
SELECT throws_ok($$ UPDATE public.profiles SET trust_score = 100 WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N14: cannot set own trust_score');
SELECT throws_ok($$ UPDATE public.profiles SET deleted_at = NULL WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N15: cannot set own deleted_at');
SELECT throws_ok($$ UPDATE public.profiles SET rating_avg = 5 WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N16: cannot set own rating_avg');
SELECT throws_ok($$ UPDATE public.profiles SET handle = 'other_handle' WHERE id = tests.fixture('owner') $$,
          '42501', NULL, 'N17: no direct handle UPDATE (SPEC-001 R11)');
SELECT throws_ok($$ UPDATE public.profile_cards SET display_name = 'x' $$,
          '42501', NULL, 'N18: profile_cards is read-only');

-- Negative: blocks
SELECT tests.authenticate_as('blocked');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('blocker')), 0::bigint,
          'N19: blocked user invisible in profile_cards');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = tests.fixture('blocker')), 0::bigint,
          'N20: blocked user cannot read blocker row from profiles either');

SELECT tests.authenticate_as('blocker');
SELECT is((SELECT count(*) FROM public.profile_cards WHERE id = tests.fixture('blocked')), 0::bigint,
          'N21: block is bidirectional in profile_cards');

-- Negative: anon / insert
SELECT tests.authenticate_as_anon();
SELECT throws_ok($$ SELECT count(*) FROM public.profiles $$,
          '42501', NULL, 'N22: anon has no privilege on profiles');
SELECT throws_ok($$ INSERT INTO public.profiles (id, display_name, handle)
                    VALUES (gen_random_uuid(), 'Fake', 'fake_handle') $$,
          '42501', NULL, 'N23: anon cannot insert profile');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$ INSERT INTO public.profiles (id, display_name, handle)
                    VALUES (gen_random_uuid(), 'Fake', 'fake_h') $$,
          '42501', NULL, 'N24: authenticated cannot insert profile (trigger only)');

-- Own row during deletion grace is still readable via the RPC (SPEC-001 R45/R47).
SELECT tests.authenticate_as('deleted');
SELECT is((SELECT count(*) FROM public.get_my_profile() WHERE deleted_at IS NOT NULL), 1::bigint,
          'P8: grace-period user reads own state via get_my_profile');
SELECT throws_ok($$ SELECT trust_score FROM public.get_my_profile() $$,
          '42703', NULL, 'N26: trust_score is not returned by get_my_profile (SPEC-012 R48)');
SELECT tests.authenticate_as_anon();
SELECT throws_ok($$ SELECT * FROM public.get_my_profile() $$,
          '42501', NULL, 'N25: anon cannot call get_my_profile');
SELECT tests.authenticate_as('stranger');
SELECT is((SELECT count(*) FROM public.get_my_profile()), 1::bigint,
          'P9: get_my_profile returns exactly the caller''s row');

SELECT * FROM finish();
ROLLBACK;
