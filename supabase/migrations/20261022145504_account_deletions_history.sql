-- SPEC-001 R45/R47, EC-08 (SPEC-001-T50): a cancelled deletion request must not block a later one.
-- 20260828_0009_auth.sql made user_id the primary key, and cancel only stamps cancelled_at, so a
-- request after a restore failed with a raw duplicate-key error on account_deletions_pkey.
-- Forward-only (SCRUM-18; Data Model §15): 0009 and 0010 are not edited.
--
-- Each request is now its own row, so history is kept. At most one row per user is OPEN (neither
-- cancelled nor executed); a partial unique index enforces that, which also closes the
-- check-then-insert race in request_account_deletion. The RPCs need no change: they already filter
-- on cancelled_at IS NULL AND executed_at IS NULL. No client grants (private schema).
-- Asserted by supabase/tests/auth_account_deletion_history.test.sql.

ALTER TABLE private.account_deletions DROP CONSTRAINT account_deletions_pkey;

ALTER TABLE private.account_deletions
  ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

CREATE UNIQUE INDEX account_deletions_one_open_per_user
  ON private.account_deletions (user_id)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;

-- The PK index used to serve the profiles FK (ON DELETE CASCADE) and per-user lookups.
CREATE INDEX account_deletions_user_idx ON private.account_deletions (user_id);

COMMENT ON TABLE private.account_deletions IS
  'One row per deletion request (SPEC-001 R45). At most one open row per user '
  '(account_deletions_one_open_per_user); cancelled and executed rows are history.';
