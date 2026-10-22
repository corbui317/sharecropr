-- SPEC-001 account deletion history (R45, R47, EC-08; SPEC-001-T50) and per-intent idempotency
-- replay (SPEC-001-T53). Fixture 'no_garden' has no verified factor, so no step-up applies (R44).
BEGIN;
SELECT plan(17);

-- ── Schema (S: structural, not counted by the negative-ratio gate) ──
SELECT col_is_pk('private', 'account_deletions', 'id', 'S1: id is the primary key');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = 'private' AND tablename = 'account_deletions'
             AND indexname = 'account_deletions_one_open_per_user'),
  'S2: partial unique index on open requests exists');
SELECT col_isnt_pk('private', 'account_deletions', 'user_id',
  'N1: user_id is no longer the primary key (a cancelled request must not block the next)');

-- ── First request ──
SELECT tests.authenticate_as('no_garden');
SELECT throws_ok($$SELECT public.cancel_account_deletion(gen_random_uuid())$$,
  'P0002', 'request_not_found', 'N2: cancel with nothing scheduled fails');
SELECT lives_ok($$SELECT public.request_account_deletion('first', 'a0000000-0000-4000-8000-000000000001')$$,
  'P1: first request schedules a deletion');
SELECT throws_ok($$SELECT public.request_account_deletion(NULL, gen_random_uuid())$$,
  '23505', 'conflict', 'N3: a second request while one is open conflicts (EC-08)');
SELECT throws_ok($$SELECT public.request_account_deletion('other reason', 'a0000000-0000-4000-8000-000000000001')$$,
  'P0001', 'idempotency_conflict', 'N4: a key cannot be reused for a different intent (T53)');
SELECT lives_ok($$SELECT public.request_account_deletion('first', 'a0000000-0000-4000-8000-000000000001')$$,
  'P2: replaying the same key returns the stored result instead of conflicting (T53)');
SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.account_deletions WHERE user_id = tests.fixture('no_garden')), 1::bigint,
  'N5: the replay created no second deletion row (T53)');

-- ── Cancel, then request again (the bug) ──
SELECT tests.authenticate_as('no_garden');
SELECT ok((public.cancel_account_deletion('b0000000-0000-4000-8000-000000000001') ->> 'restored')::boolean,
  'P3: cancel restores within grace');
SELECT ok(NOT (public.get_account_deletion_status() ->> 'pending')::boolean,
  'N6: nothing is pending after the cancel');
SELECT lives_ok($$SELECT public.request_account_deletion('again', gen_random_uuid())$$,
  'P4: a request after a cancel succeeds (T50; was duplicate key on account_deletions_pkey)');
SELECT ok((public.get_account_deletion_status() ->> 'pending')::boolean,
  'P5: the new request is pending');

SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.account_deletions
            WHERE user_id = tests.fixture('no_garden') AND cancelled_at IS NULL AND executed_at IS NULL),
  1::bigint, 'N7: exactly one open request per user');
SELECT is((SELECT count(*) FROM private.account_deletions
            WHERE user_id = tests.fixture('no_garden') AND cancelled_at IS NOT NULL),
  1::bigint, 'P6: the cancelled request is kept as history, not overwritten');
SELECT throws_ok(
  $$INSERT INTO private.account_deletions (user_id, scheduled_at, source)
    VALUES (tests.fixture('no_garden'), now() + interval '30 days', 'in_app')$$,
  '23505', NULL, 'N8: the index rejects a second open row even outside the RPC');

SELECT tests.authenticate_as('no_garden');
SELECT throws_ok($$SELECT id FROM private.account_deletions$$,
  '42501', NULL, 'N9: authenticated still cannot read private.account_deletions');

SELECT * FROM finish();
ROLLBACK;
