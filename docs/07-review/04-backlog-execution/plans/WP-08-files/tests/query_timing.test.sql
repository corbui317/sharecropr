BEGIN;
SELECT plan(8);

-- SCR-0212: query timing structure (small seed — budget is structural)
-- Column-level grants mean SELECT * is not permitted on profiles/gardens: name the columns,
-- exactly as a real client must.
SELECT tests.authenticate_as('owner');
SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT id, owner_id, name, status FROM public.gardens WHERE owner_id = tests.fixture('owner') $$,
  50, 'gardens owner select under 50ms');

SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT id, handle, display_name FROM public.profiles WHERE id = tests.fixture('owner') $$,
  50, 'profiles self select under 50ms');

SELECT tests.authenticate_as('stranger');
SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT * FROM public.profile_cards LIMIT 50 $$,
  50, 'profile_cards select under 50ms');

SELECT * FROM tests.assert_query_under_ms(
  $$ SELECT id, owner_id, name FROM public.gardens LIMIT 50 $$,
  50, 'gardens stranger select under 50ms');

-- app.can_transact() is caller-scoped: authenticate as each subject.
-- SPEC-001-T42 (bypass accounts) is covered by the reviewer fixture elsewhere.
SELECT tests.authenticate_as('owner');
SELECT ok(app.can_transact(), 'P1: owner can_transact when verified+garden');
SELECT tests.authenticate_as('unverified');
SELECT ok(NOT app.can_transact(), 'N1: unverified cannot transact');
SELECT tests.authenticate_as('no_garden');
SELECT ok(NOT app.can_transact(), 'N2: no verified garden cannot transact');
SELECT tests.authenticate_as('suspended');
SELECT ok(NOT app.can_transact(), 'N3: suspended cannot transact');

SELECT * FROM finish();
ROLLBACK;
