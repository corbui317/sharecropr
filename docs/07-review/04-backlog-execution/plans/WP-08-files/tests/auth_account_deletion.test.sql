-- SPEC-001 account deletion RPC tests (R43, R44, R45, R47; T21, T34, T35)
-- Step-up rule: fresh AAL2 is required only when a verified second factor is enrolled.
-- Fixtures: 'stranger' / 'requester' have no factor; 'mfa' has a verified TOTP factor.
BEGIN;
SELECT plan(18);

-- SPEC-001-T34 / R43: a user WITHOUT a second factor can delete their account at aal1.
SELECT tests.authenticate_as('stranger');
SELECT ok(
  (SELECT (public.request_account_deletion('moving', gen_random_uuid()) ->> 'scheduled_deletion_at') IS NOT NULL),
  'P1: no-factor user can request deletion at aal1');
-- SPEC-001-T35
SELECT is((SELECT count(*) FROM public.get_my_profile() WHERE deleted_at IS NOT NULL), 1::bigint,
  'P2: deleted_at is set after the request');
SELECT ok((public.get_account_deletion_status() ->> 'pending')::boolean,
  'P3: deletion status reports pending');
SELECT ok((public.cancel_account_deletion(gen_random_uuid()) ->> 'restored')::boolean,
  'P4: cancel restores within grace (no step-up, R47)');

-- SPEC-001-T21: suspended and grace-period users can still read their own state.
SELECT tests.authenticate_as('suspended');
SELECT is((SELECT count(*) FROM public.get_my_profile() WHERE is_suspended), 1::bigint,
  'P6: suspended user can read own profile state');
SELECT tests.authenticate_as('deleted');
SELECT is((SELECT count(*) FROM public.get_my_profile() WHERE deleted_at IS NOT NULL), 1::bigint,
  'P7: grace-period user can read own profile state');

-- SPEC-001-T34 / N11: enrolled user, wrong or stale elevation.
SELECT tests.authenticate_as('mfa');  -- aal1
SELECT throws_ok(
  $$SELECT public.request_account_deletion('x', gen_random_uuid())$$,
  '42501', 'aal2_required', 'N1: enrolled user at aal1 gets aal2_required');
SELECT tests.authenticate_as('mfa', 'aal2', interval '20 minutes');
SELECT throws_ok(
  $$SELECT public.request_account_deletion('x', gen_random_uuid())$$,
  '42501', 'aal2_stale', 'N2: enrolled user with a 20-minute-old TOTP gets aal2_stale (N11)');

SELECT tests.authenticate_as('mfa');  -- aal1 again
SELECT throws_ok(
  $$SELECT public.request_account_deletion('x', gen_random_uuid())$$,
  '42501', 'aal2_required', 'N3: enrolled user at aal1 gets aal2_required again');

SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.account_deletions WHERE user_id = tests.fixture('mfa')), 0::bigint,
  'N4: rejected attempts write no account_deletions row (T34)');

SELECT is((SELECT count(*) FROM auth.mfa_factors WHERE user_id = tests.fixture('mfa') AND status = 'verified'), 1::bigint,
  'S1: fixture user really has one verified factor');

SELECT tests.authenticate_as('mfa', 'aal2');
SELECT ok(
  (SELECT (public.request_account_deletion(NULL, gen_random_uuid()) ->> 'scheduled_deletion_at') IS NOT NULL),
  'P5: enrolled user with fresh aal2 can request deletion');

-- Remaining negatives
SELECT tests.authenticate_as('owner');
SELECT throws_ok(
  $$SELECT public.cancel_account_deletion(gen_random_uuid())$$,
  'P0002', 'request_not_found', 'N5: cancel with no pending deletion fails');

SELECT tests.authenticate_as('requester');
SELECT lives_ok($$SELECT public.request_account_deletion(NULL, gen_random_uuid())$$,
  'P8: first deletion request accepted (setup for conflict check)');
SELECT throws_ok(
  $$SELECT public.request_account_deletion(NULL, gen_random_uuid())$$,
  '23505', 'conflict', 'N6: second deletion request conflicts');
SELECT throws_ok($$SELECT * FROM private.account_deletions$$,
  '42501', NULL, 'N7: authenticated cannot read private.account_deletions');

SELECT tests.authenticate_as_anon();
SELECT throws_ok($$SELECT count(*) FROM private.account_deletions$$,
  '42501', NULL, 'N8: anon cannot read account_deletions (N09)');
SELECT throws_ok($$SELECT public.request_account_deletion(NULL, gen_random_uuid())$$,
  '42501', NULL, 'N9: anon cannot execute request_account_deletion');

SELECT * FROM finish();
ROLLBACK;
