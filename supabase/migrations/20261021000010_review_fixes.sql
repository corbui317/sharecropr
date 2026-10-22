-- Code-review fixes (EPIC-02/03 hardening). Forward-only; 0001-0009 are not edited.
--   1. Column-level privileges (REVOKE ALL, then explicit column GRANTs)
--   2. Caller-scoped app helpers; idempotency helpers no longer client-callable
--   3. Step-up only when a second factor is enrolled
--   4. profiles other-user SELECT policy + get_my_profile() (ADR-0022)
--   5. request_email_change: expiry, reaper, no existence oracle
--   9. Test harness removed from production schema (now in supabase/seed_harness.sql)

-- ══ 1. Column-level privileges ══════════════════════════════════════════════
-- Supabase default privileges grant ALL on public tables to anon/authenticated, and a
-- column-level REVOKE is a no-op while a table-level grant exists. So: revoke the table
-- grant, then grant exactly the columns each policy needs.

-- Future public tables start with no client grants; every grant must be explicit.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

REVOKE ALL ON public.profiles, public.gardens, public.verifications, public.blocks,
              public.exchange_sessions, public.message_threads, public.profile_cards
  FROM PUBLIC, anon, authenticated;

-- profiles: card-safe columns only. Because profiles_select_visible (below) lets any
-- authenticated user read other users' rows, EVERY column granted here is visible for
-- other users' rows. Owner-only columns are served by public.get_my_profile().
GRANT SELECT (id, handle, display_name, avatar_path, bio, city_label, trust_tier,
              rating_avg, rating_count, completed_exchanges, created_at)
  ON public.profiles TO authenticated;
-- handle is NOT updatable (SPEC-001 R11: editable once, via a future RPC). trust_*,
-- rating_*, is_suspended, suspended_until, deleted_at, city_label, home_h3_r7 are
-- server-maintained.
GRANT UPDATE (display_name, avatar_path, bio, locale, timezone, onboarding_completed_at)
  ON public.profiles TO authenticated;

-- gardens: h3_r9 is never client-readable. status/verified_at/rejection_reason/deleted_at
-- and derived location columns change only through RPCs (SPEC-004).
GRANT SELECT (id, owner_id, name, description, status, display_point, h3_r7, grow_zone,
              size_band, verified_at, rejection_reason, deleted_at, created_at, updated_at)
  ON public.gardens TO authenticated;
GRANT INSERT (owner_id, name, description, grow_zone, size_band)
  ON public.gardens TO authenticated;
GRANT UPDATE (name, description, grow_zone, size_band)
  ON public.gardens TO authenticated;

-- verifications: read-only for clients (select_own / select_moderator policies only).
GRANT SELECT ON public.verifications TO authenticated;

-- blocks: select_blocker + insert_own policies only. No UPDATE/DELETE.
GRANT SELECT ON public.blocks TO authenticated;
GRANT INSERT (blocker_id, blocked_id, reason) ON public.blocks TO authenticated;

-- exchange_sessions / message_threads: no client policies yet (EPIC-12) => no grants.

-- profile_cards: SELECT only (an auto-updatable view must not accept writes).
GRANT SELECT ON public.profile_cards TO authenticated;

-- Account RPCs are not anonymous-callable (functions default to PUBLIC EXECUTE).
REVOKE ALL ON FUNCTION public.get_account_deletion_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_account_deletion(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_email_change(text, uuid) FROM PUBLIC, anon;

-- ══ 2. app helper surface ═══════════════════════════════════════════════════
-- (a) Only called inside SECURITY DEFINER RPCs, which run as owner.
REVOKE EXECUTE ON FUNCTION app.idempotency_probe(uuid, uuid, text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION app.idempotency_record(uuid, uuid, text, jsonb, jsonb) FROM authenticated;

-- (b) Caller-scoped client surface. Two-arg / uuid-arg forms stay internal (no grants).
REVOKE EXECUTE ON FUNCTION app.is_blocked_either_way(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.is_blocked_with(other uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks b
     WHERE (b.blocker_id = auth.uid() AND b.blocked_id = other)
        OR (b.blocker_id = other AND b.blocked_id = auth.uid()));
$$;

CREATE OR REPLACE FUNCTION app.can_transact_for(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.verifications v ON v.user_id = p.id
     WHERE p.id = u
       AND p.deleted_at IS NULL
       AND p.is_suspended = false
       AND (v.status = 'passed'
            OR EXISTS (SELECT 1 FROM private.review_bypass_accounts r
                        WHERE r.user_id = u AND r.expires_at > now()))
       AND EXISTS (SELECT 1 FROM public.gardens g
                    WHERE g.owner_id = u AND g.status = 'verified' AND g.deleted_at IS NULL));
$$;

DROP FUNCTION app.can_transact(uuid);

CREATE OR REPLACE FUNCTION app.can_transact() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private, app AS $$
  SELECT app.can_transact_for(auth.uid());
$$;

REVOKE ALL ON FUNCTION app.is_blocked_with(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.can_transact_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.can_transact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_blocked_with(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.can_transact() TO authenticated;
-- Policies (gardens_select_moderator, verifications_select_moderator) call this as the
-- invoker; EXECUTE is checked when the policy expression is initialised, so without this
-- grant every SELECT on those tables fails for authenticated. It reads only the caller's JWT.
GRANT EXECUTE ON FUNCTION app.is_moderator() TO authenticated;

-- ══ 3. Step-up only when enrolled ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION app.require_aal2_if_enrolled(
  p_max_age interval DEFAULT interval '15 minutes')
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.mfa_factors f
              WHERE f.user_id = auth.uid() AND f.status = 'verified') THEN
    PERFORM app.require_aal2(p_max_age);
  END IF;
END; $$;

REVOKE ALL ON FUNCTION app.require_aal2_if_enrolled(interval) FROM PUBLIC, anon, authenticated;

-- ══ 4. profiles: visible-to-others policy + owner-only RPC (ADR-0022) ═══════
CREATE POLICY profiles_select_visible ON public.profiles
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL
         AND is_suspended = false
         AND NOT app.is_blocked_with(id));

-- profile_cards keeps security_invoker = on. Its deleted/suspended filters moved into
-- profiles_select_visible: a security_invoker view needs column SELECT on every column it
-- references, and is_suspended / deleted_at are owner-only (SPEC-001 N08).
CREATE OR REPLACE VIEW public.profile_cards
WITH (security_invoker = on) AS
SELECT p.id, p.handle, p.display_name, p.avatar_path, p.bio,
       p.city_label, p.trust_tier, p.rating_avg, p.rating_count,
       p.completed_exchanges, p.created_at
  FROM public.profiles p
 WHERE NOT app.is_blocked_with(p.id);

-- Owner-only columns, for the caller only. Deliberately NOT returned: trust_score and
-- cancellation_count_90d (SPEC-012 R48: never returned to any client in any form) and
-- home_h3_r7 (no client need yet). Adding any of them is a recorded decision, not a tweak.
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  id uuid, handle citext, display_name text, avatar_path text, bio text, city_label text,
  trust_tier public.trust_tier, rating_avg numeric, rating_count integer,
  completed_exchanges integer, is_suspended boolean, suspended_until timestamptz,
  locale text, timezone text, onboarding_completed_at timestamptz, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
  SELECT p.id, p.handle, p.display_name, p.avatar_path, p.bio, p.city_label,
         p.trust_tier, p.rating_avg, p.rating_count, p.completed_exchanges,
         p.is_suspended, p.suspended_until, p.locale, p.timezone,
         p.onboarding_completed_at, p.deleted_at, p.created_at, p.updated_at
    FROM public.profiles p
   WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- ══ 3 + 5. request_account_deletion / request_email_change ═════════════════
CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_reason text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, public, audit AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_scheduled timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NOT NULL AND length(p_reason) > 500 THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
  END IF;

  v_existing := app.idempotency_probe(v_uid, p_idempotency_key, 'request_account_deletion',
    jsonb_build_object('reason', p_reason));
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- SPEC-001 R44: fresh AAL2 when a second factor is enrolled. 2FA is optional
  -- (SPEC-002 R04) and deletion must stay possible without it (R43, App Store 5.1.1(v)).
  PERFORM app.require_aal2_if_enrolled();

  IF EXISTS (
    SELECT 1 FROM private.account_deletions d
     WHERE d.user_id = v_uid AND d.cancelled_at IS NULL AND d.executed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '23505';
  END IF;

  v_scheduled := now() + interval '30 days';

  UPDATE public.profiles SET deleted_at = now(), updated_at = now()
   WHERE id = v_uid AND deleted_at IS NULL;

  INSERT INTO private.account_deletions (user_id, scheduled_at, reason, source)
  VALUES (v_uid, v_scheduled, p_reason, 'in_app');

  PERFORM app.write_audit_event('account.deletion_requested', 'user', v_uid,
    jsonb_build_object('source', 'in_app'));

  v_result := jsonb_build_object('scheduled_deletion_at', v_scheduled);
  PERFORM app.idempotency_record(v_uid, p_idempotency_key, 'request_account_deletion',
    jsonb_build_object('reason', p_reason), v_result);
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.request_email_change(
  p_new_email text,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_result jsonb := jsonb_build_object('status', 'confirmation_sent');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_new_email IS NULL OR length(p_new_email) > 254 OR p_new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
  END IF;

  v_existing := app.idempotency_probe(v_uid, p_idempotency_key, 'request_email_change',
    jsonb_build_object('new_email', p_new_email));
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- SPEC-001 R36: fresh AAL2 when a second factor is enrolled.
  PERFORM app.require_aal2_if_enrolled();

  -- R39: an expired pending change is treated as absent and leaves no residue.
  DELETE FROM private.pending_email_changes
   WHERE user_id = v_uid AND expires_at <= now();

  IF EXISTS (SELECT 1 FROM private.pending_email_changes WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '23505';
  END IF;

  -- R40 / N02: an address held by any account (deletion grace included: the auth.users
  -- row persists until hard deletion) or pending for another user is NOT inserted, but the
  -- response is byte-identical to success so this is not an account-existence oracle.
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(p_new_email))
     AND NOT EXISTS (SELECT 1 FROM private.pending_email_changes p
                      WHERE p.new_email = p_new_email::citext
                        AND p.user_id <> v_uid AND p.expires_at > now()) THEN
    INSERT INTO private.pending_email_changes (user_id, new_email, confirm_hash, revoke_hash)
    VALUES (v_uid, p_new_email::citext, encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
            encode(sha256(gen_random_uuid()::text::bytea), 'hex'));
  END IF;

  PERFORM app.idempotency_record(v_uid, p_idempotency_key, 'request_email_change',
    jsonb_build_object('new_email', p_new_email), v_result);
  RETURN v_result;
END; $$;

-- Hourly reaper for expired pending email changes (R39).
CREATE OR REPLACE FUNCTION private.sweep_pending_email_changes()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, private AS $$
  WITH deleted AS (
    DELETE FROM private.pending_email_changes WHERE expires_at <= now() RETURNING 1
  )
  SELECT count(*)::bigint FROM deleted;
$$;

REVOKE ALL ON FUNCTION private.sweep_pending_email_changes() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'sweep_pending_email_changes',
      '30 * * * *',
      $$SELECT private.sweep_pending_email_changes();$$
    );
  END IF;
END;
$cron$;

-- ══ 9. Remove the test harness from the production schema ═══════════════════
-- Recreated for local/CI resets only by supabase/seed_harness.sql.
DROP SCHEMA IF EXISTS tests CASCADE;
