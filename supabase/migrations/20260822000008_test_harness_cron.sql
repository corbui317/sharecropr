-- SCR-0210: pg_cron job registration for location-privacy static checks
-- LP-01..LP-12 subset enforced in pgTAP; cron jobs are scaffolding for production canary.

-- LP-01 nightly: verify no client grants on private schema
CREATE OR REPLACE FUNCTION private.lp01_check_private_grants()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM information_schema.role_table_grants
   WHERE table_schema = 'private'
     AND grantee IN ('anon', 'authenticated');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'LP-01 violation: client role has grant on private (count=%)', v_count;
  END IF;
END;
$$;

-- LP-02 stub: definer allowlist checked in CI static analysis (scripts/ci-assert-definer-allowlist.sh)

CREATE OR REPLACE FUNCTION private.lp11_check_audit_metadata()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM audit.events e
     WHERE app.jsonb_has_coord_key(e.metadata)
  ) THEN
    RAISE EXCEPTION 'LP-11 violation: coordinate key in audit.events.metadata';
  END IF;
END;
$$;

-- Register cron jobs when pg_cron is available (local + CI)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'lp01_private_grants',
      '0 3 * * *',
      $$SELECT private.lp01_check_private_grants();$$
    );
    PERFORM cron.schedule(
      'lp11_audit_metadata',
      '15 3 * * *',
      $$SELECT private.lp11_check_audit_metadata();$$
    );
    PERFORM cron.schedule(
      'sweep_idempotency_keys',
      '0 * * * *',
      $$SELECT private.sweep_idempotency_keys();$$
    );
  END IF;
END;
$cron$;

-- ── Test harness helpers (RLS Test Plan §1.1) ────────────────────────────────
CREATE TABLE tests.fixtures_users (
  handle     text PRIMARY KEY,
  id         uuid NOT NULL UNIQUE,
  staff_role text NOT NULL DEFAULT 'authenticated'
);

CREATE TABLE tests.fixtures_named (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

CREATE OR REPLACE FUNCTION tests.authenticate_as(p_handle text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_role text;
BEGIN
  SELECT id, COALESCE(staff_role, 'authenticated') INTO v_id, v_role
    FROM tests.fixtures_users WHERE handle = p_handle;
  IF v_id IS NULL THEN RAISE EXCEPTION 'no fixture user %', p_handle; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_id, 'role', 'authenticated', 'aal', 'aal2',
    'app_metadata', json_build_object('role', v_role)
  )::text, true);
END; $$;

CREATE OR REPLACE FUNCTION tests.authenticate_as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', NULL, true);
END; $$;

CREATE OR REPLACE FUNCTION tests.fixture(p_name text) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, tests AS $$
  SELECT id FROM tests.fixtures_named WHERE name = p_name;
$$;

CREATE OR REPLACE FUNCTION tests.assert_query_under_ms(
  p_query text, p_budget_ms numeric, p_label text
) RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  v_start timestamptz;
  v_elapsed_ms numeric;
BEGIN
  v_start := clock_timestamp();
  EXECUTE p_query;
  v_elapsed_ms := extract(epoch FROM (clock_timestamp() - v_start)) * 1000;
  RETURN NEXT ok(
    v_elapsed_ms < p_budget_ms,
    p_label || format(' (%.2f ms)', v_elapsed_ms)
  );
  RETURN;
END; $$;
