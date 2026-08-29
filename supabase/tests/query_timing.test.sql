BEGIN;
SELECT plan(8);

-- SCR-0212: query timing structure (small seed — budget is structural)
SELECT tests.authenticate_as('owner');
SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT * FROM public.gardens WHERE owner_id = tests.fixture('owner') $$,
  50, 'gardens owner select under 50ms');

SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT * FROM public.profiles WHERE id = tests.fixture('owner') $$,
  50, 'profiles self select under 50ms');

SELECT tests.authenticate_as('stranger');
SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT * FROM public.profile_cards LIMIT 50 $$,
  50, 'profile_cards select under 50ms');

SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT * FROM public.gardens LIMIT 50 $$,
  50, 'gardens stranger select under 50ms');

SELECT ok(app.can_transact(tests.fixture('owner')), 'P1: owner can_transact when verified+garden');
SELECT ok(NOT app.can_transact(tests.fixture('unverified')), 'N1: unverified cannot transact');
SELECT ok(NOT app.can_transact(tests.fixture('no_garden')), 'N2: no verified garden cannot transact');
SELECT ok(NOT app.can_transact(tests.fixture('suspended')), 'N3: suspended cannot transact');

SELECT * FROM finish();
ROLLBACK;
