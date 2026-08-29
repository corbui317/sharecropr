-- SPEC-001 account deletion RPC tests (T34–T37 subset)

BEGIN;
SELECT plan(8);

SELECT tests.authenticate_as('11111111-1111-1111-1111-111111111101');

-- T34: request_account_deletion without AAL2 returns aal2_required
SELECT throws_ok(
  $$SELECT public.request_account_deletion('test reason', gen_random_uuid())$$,
  '42501',
  'aal2_required',
  'deletion without AAL2 is rejected'
);

-- cancel with no pending deletion
SELECT throws_ok(
  $$SELECT public.cancel_account_deletion(gen_random_uuid())$$,
  'P0002',
  'request_not_found',
  'cancel with no pending deletion fails'
);

SELECT tests.authenticate_as('11111111-1111-1111-1111-11111111110b');

-- deleted user can read own profile during grace (policy fix)
SELECT ok(
  (SELECT deleted_at IS NOT NULL FROM public.profiles WHERE id = auth.uid()),
  'grace-period user has deleted_at set'
);

SELECT tests.clear_authentication();

-- anon cannot reach private tables (N09)
SET ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM private.account_deletions$$,
  '42501',
  NULL,
  'anon cannot read account_deletions'
);
RESET ROLE;

SELECT tests.authenticate_as('11111111-1111-1111-1111-111111111106');

-- T21 subset: suspended user can read own profile
SELECT ok(
  (SELECT count(*) = 1 FROM public.profiles WHERE id = auth.uid()),
  'suspended user can SELECT own profile'
);

SELECT tests.clear_authentication();

SELECT * FROM finish();
ROLLBACK;
