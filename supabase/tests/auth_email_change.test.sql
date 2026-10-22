-- SPEC-001 email change (R36, R39, R40; T28, T30, T31; N02)
-- Fixtures: 'stranger'/'requester'/'unverified' have no factor; 'mfa' has a verified TOTP factor.
BEGIN;
SELECT plan(19);

-- ── SPEC-001-T28: step-up only when enrolled ───────────────────────────────
SELECT tests.authenticate_as('requester');   -- aal1, no factor
SELECT is(public.request_email_change('requester.new@example.org', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'P1: no-factor user can request email change at aal1');

SELECT tests.authenticate_as('mfa', 'aal2');
SELECT is(public.request_email_change('mfa.new@example.org', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'P2: enrolled user with fresh aal2 can request email change');

SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.pending_email_changes
            WHERE user_id IN (tests.fixture('requester'), tests.fixture('mfa'))), 2::bigint,
  'P3: both accepted requests created a pending row');
-- mfa user's row would otherwise trip the conflict check below
DELETE FROM private.pending_email_changes WHERE user_id = tests.fixture('mfa');

SELECT tests.authenticate_as('mfa');          -- aal1
SELECT throws_ok($$SELECT public.request_email_change('x.new@example.org', gen_random_uuid())$$,
  '42501', 'aal2_required', 'N1: enrolled user at aal1 gets aal2_required');
SELECT tests.authenticate_as('mfa', 'aal2', interval '20 minutes');
SELECT throws_ok($$SELECT public.request_email_change('x.new@example.org', gen_random_uuid())$$,
  '42501', 'aal2_stale', 'N2: enrolled user with stale TOTP gets aal2_stale');

-- ── SPEC-001-T30 / R39: expiry ─────────────────────────────────────────────
SELECT tests.authenticate_as('requester');
SELECT throws_ok($$SELECT public.request_email_change('another.new@example.org', gen_random_uuid())$$,
  '23505', 'conflict', 'N3: an unexpired pending change still conflicts');

SELECT tests.clear_authentication();
UPDATE private.pending_email_changes
   SET requested_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
 WHERE user_id = tests.fixture('requester');

SELECT tests.authenticate_as('requester');
SELECT is(public.request_email_change('another.new@example.org', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'P4: an expired pending change no longer blocks a new request');
SELECT tests.clear_authentication();
SELECT is((SELECT new_email::text FROM private.pending_email_changes WHERE user_id = tests.fixture('requester')),
  'another.new@example.org', 'P5: the expired row was replaced, not kept');

-- Reaper
INSERT INTO private.pending_email_changes (user_id, new_email, confirm_hash, revoke_hash, expires_at)
VALUES (tests.fixture('unverified'), 'stale@example.org', 'c', 'r', now() - interval '2 hours');
SELECT ok(private.sweep_pending_email_changes() >= 1, 'P6: reaper reports expired rows deleted');
SELECT is((SELECT count(*) FROM private.pending_email_changes WHERE user_id = tests.fixture('unverified')), 0::bigint,
  'P7: reaper removed the expired row and left live rows alone');

-- ── SPEC-001-T31 / R40 / N02: no existence oracle ──────────────────────────
SELECT tests.authenticate_as('stranger');
SELECT is(public.request_email_change('owner@test.local', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'N4: address of another account returns the identical neutral response');
SELECT is(public.request_email_change('OWNER@Test.Local', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'N5: the same holds case-insensitively');
SELECT is(public.request_email_change('deleted@test.local', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'N6: and for an account in deletion grace');
SELECT is(public.request_email_change('another.new@example.org', gen_random_uuid()),
  '{"status":"confirmation_sent"}'::jsonb,
  'N7: and for an address pending for another user');
SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.pending_email_changes WHERE user_id = tests.fixture('stranger')), 0::bigint,
  'N8: none of those four requests inserted a pending row');

SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$SELECT public.request_email_change('not-an-email', gen_random_uuid())$$,
  '22023', 'validation_failed', 'N9: syntactically invalid address rejected');
SELECT throws_ok($$SELECT * FROM private.pending_email_changes$$,
  '42501', NULL, 'N10: authenticated cannot read pending_email_changes');
SELECT tests.authenticate_as_anon();
SELECT throws_ok($$SELECT public.request_email_change('anon@example.org', gen_random_uuid())$$,
  '42501', NULL, 'N11: anon cannot execute request_email_change');
SELECT tests.authenticate_as('stranger');
SELECT throws_ok($$SELECT private.sweep_pending_email_changes()$$,
  '42501', NULL, 'N12: the reaper is not client-callable');

SELECT * FROM finish();
ROLLBACK;
