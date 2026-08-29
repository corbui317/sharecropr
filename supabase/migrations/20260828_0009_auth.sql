-- EPIC-03 / SPEC-001: Auth tables, step-up helper, account lifecycle RPCs

-- ── Private auth tables ──────────────────────────────────────────────────────
CREATE TABLE private.pending_email_changes (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  new_email      citext NOT NULL,
  confirm_hash   text   NOT NULL,
  revoke_hash    text   NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT pending_email_not_taken CHECK (length(new_email::text) BETWEEN 3 AND 254)
);

CREATE TABLE private.account_deletions (
  user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  scheduled_at   timestamptz NOT NULL,
  reason         text NULL CHECK (reason IS NULL OR length(reason) <= 500),
  source         text NOT NULL CHECK (source IN ('in_app', 'web')),
  cancelled_at   timestamptz NULL,
  executed_at    timestamptz NULL
);

CREATE INDEX account_deletions_due_idx ON private.account_deletions (scheduled_at)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;

CREATE TABLE private.retired_handles (
  handle       citext PRIMARY KEY,
  released_at  timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now() + interval '12 months'
);

REVOKE ALL ON private.pending_email_changes, private.account_deletions, private.retired_handles
  FROM anon, authenticated, PUBLIC;

-- ── Step-up auth (API Contract §2.4) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.require_aal2(p_max_age interval DEFAULT interval '15 minutes')
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
  v_ts     bigint;
BEGIN
  IF COALESCE(v_claims ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'aal2_required' USING ERRCODE = '42501';
  END IF;
  SELECT MAX((e ->> 'timestamp')::bigint) INTO v_ts
    FROM jsonb_array_elements(COALESCE(v_claims -> 'amr', '[]'::jsonb)) e
   WHERE e ->> 'method' IN ('totp', 'mfa/totp');
  IF v_ts IS NULL OR to_timestamp(v_ts) < now() - p_max_age THEN
    RAISE EXCEPTION 'aal2_stale' USING ERRCODE = '42501';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION app.require_aal2(interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.require_aal2(interval) TO authenticated;

-- ── Audit helper for definer RPCs ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.write_audit_event(
  p_action text,
  p_subject_type text DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit, public AS $$
BEGIN
  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id, metadata)
  VALUES (auth.uid(), 'authenticated', p_action, p_subject_type, p_subject_id, p_metadata);
END; $$;

REVOKE ALL ON FUNCTION app.write_audit_event(text, text, uuid, jsonb) FROM PUBLIC, anon;

-- ── Profiles RLS: allow grace-period self-read and restore update ────────────
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- ── Deletion status (client reads via RPC — private table is unreachable) ──────
CREATE OR REPLACE FUNCTION public.get_account_deletion_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, private, public AS $$
DECLARE
  v_row private.account_deletions;
BEGIN
  SELECT * INTO v_row
    FROM private.account_deletions d
   WHERE d.user_id = auth.uid()
     AND d.cancelled_at IS NULL
     AND d.executed_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('pending', false);
  END IF;
  RETURN jsonb_build_object(
    'pending', true,
    'requested_at', v_row.requested_at,
    'scheduled_at', v_row.scheduled_at,
    'source', v_row.source,
    'grace_elapsed', v_row.scheduled_at <= now()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_account_deletion_status() TO authenticated;

-- ── request_account_deletion ─────────────────────────────────────────────────
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

  PERFORM app.require_aal2();

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

GRANT EXECUTE ON FUNCTION public.request_account_deletion(text, uuid) TO authenticated;

-- ── cancel_account_deletion ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_account_deletion(
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, public, audit AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row private.account_deletions;
  v_existing jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_existing := app.idempotency_probe(v_uid, p_idempotency_key, 'cancel_account_deletion', '{}'::jsonb);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_row
    FROM private.account_deletions d
   WHERE d.user_id = v_uid AND d.cancelled_at IS NULL AND d.executed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.scheduled_at <= now() THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23505';
  END IF;

  UPDATE private.account_deletions
     SET cancelled_at = now()
   WHERE user_id = v_uid AND cancelled_at IS NULL AND executed_at IS NULL;

  UPDATE public.profiles SET deleted_at = NULL, updated_at = now()
   WHERE id = v_uid;

  PERFORM app.write_audit_event('account.deletion_restored', 'user', v_uid, '{}'::jsonb);

  v_result := jsonb_build_object('restored', true, 'restored_at', now());
  PERFORM app.idempotency_record(v_uid, p_idempotency_key, 'cancel_account_deletion', '{}'::jsonb, v_result);
  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid) TO authenticated;

-- ── request_email_change (SPEC-001 §7 — confirmation flow deferred to mailer) ─
CREATE OR REPLACE FUNCTION public.request_email_change(
  p_new_email text,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_result jsonb;
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

  PERFORM app.require_aal2();

  IF EXISTS (SELECT 1 FROM private.pending_email_changes WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '23505';
  END IF;

  INSERT INTO private.pending_email_changes (user_id, new_email, confirm_hash, revoke_hash)
  VALUES (v_uid, p_new_email::citext, encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
          encode(sha256(gen_random_uuid()::text::bytea), 'hex'));

  v_result := jsonb_build_object('status', 'confirmation_sent');
  PERFORM app.idempotency_record(v_uid, p_idempotency_key, 'request_email_change',
    jsonb_build_object('new_email', p_new_email), v_result);
  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.request_email_change(text, uuid) TO authenticated;

-- Grant idempotency helpers to authenticated for RPC use
GRANT EXECUTE ON FUNCTION app.idempotency_probe(uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION app.idempotency_record(uuid, uuid, text, jsonb, jsonb) TO authenticated;

-- ── account-delete pipeline stub (SCR-0310 — full erasure in Edge Function) ──
CREATE OR REPLACE FUNCTION private.execute_account_deletion(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, public, audit AS $$
BEGIN
  UPDATE private.account_deletions
     SET executed_at = now()
   WHERE user_id = p_user_id AND executed_at IS NULL AND cancelled_at IS NULL;

  UPDATE public.profiles
     SET display_name = 'Deleted user',
         handle = 'deleted_' || substr(replace(p_user_id::text, '-', ''), 1, 12),
         bio = NULL,
         avatar_path = NULL,
         city_label = NULL,
         home_h3_r7 = NULL,
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now()
   WHERE id = p_user_id;

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (p_user_id, 'service_role', 'account.deleted', 'user', p_user_id);
END; $$;

REVOKE ALL ON FUNCTION private.execute_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
