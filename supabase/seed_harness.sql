-- pgTAP test harness (RLS Test Plan §1.1). LOCAL / CI RESETS ONLY.
-- Listed before seed.sql in config.toml [db.seed]; never part of a migration, so the
-- production database has no `tests` schema (migration 0010 drops the one 0001/0008 made).

CREATE SCHEMA IF NOT EXISTS tests;

CREATE TABLE IF NOT EXISTS tests.fixtures_users (
  handle     text PRIMARY KEY,
  id         uuid NOT NULL UNIQUE,
  staff_role text NOT NULL DEFAULT 'authenticated'
);

CREATE TABLE IF NOT EXISTS tests.fixtures_named (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

-- Registries are read only through the SECURITY DEFINER functions below, so the tables
-- themselves carry no client grants.
REVOKE ALL ON tests.fixtures_users, tests.fixtures_named FROM PUBLIC, anon, authenticated;

-- Definer lookup: tests call authenticate_as() again while already running as
-- `authenticated`, which cannot read the registry directly.
CREATE OR REPLACE FUNCTION tests.lookup_user(p_handle text)
RETURNS TABLE (id uuid, staff_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, tests AS $$
  SELECT f.id, COALESCE(f.staff_role, 'authenticated')
    FROM tests.fixtures_users f WHERE f.handle = p_handle;
$$;

-- p_aal: 'aal1' (default, the honest baseline) or 'aal2'. At aal2 the JWT carries a TOTP
-- amr entry stamped (now - p_totp_age), so staleness (SPEC-001 N11) is testable.
CREATE OR REPLACE FUNCTION tests.authenticate_as(
  p_handle text,
  p_aal text DEFAULT 'aal1',
  p_totp_age interval DEFAULT interval '0 seconds'
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_role text;
  v_amr jsonb;
BEGIN
  IF p_aal NOT IN ('aal1', 'aal2') THEN
    RAISE EXCEPTION 'p_aal must be aal1 or aal2, got %', p_aal;
  END IF;
  SELECT l.id, l.staff_role INTO v_id, v_role FROM tests.lookup_user(p_handle) l;
  IF v_id IS NULL THEN RAISE EXCEPTION 'no fixture user %', p_handle; END IF;

  IF p_aal = 'aal2' THEN
    v_amr := jsonb_build_array(
      jsonb_build_object('method', 'password', 'timestamp', floor(extract(epoch FROM now()))::bigint),
      jsonb_build_object('method', 'totp',
                         'timestamp', floor(extract(epoch FROM (now() - p_totp_age)))::bigint));
  ELSE
    v_amr := jsonb_build_array(
      jsonb_build_object('method', 'password', 'timestamp', floor(extract(epoch FROM now()))::bigint));
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'amr', v_amr,
    'app_metadata', jsonb_build_object('role', v_role))::text, true);
END; $$;

CREATE OR REPLACE FUNCTION tests.authenticate_as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
END; $$;

-- Back to the session role (postgres) with no claims.
CREATE OR REPLACE FUNCTION tests.clear_authentication() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
END; $$;

-- Named fixtures first, then fall back to fixture user handles.
CREATE OR REPLACE FUNCTION tests.fixture(p_name text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, tests AS $$
  SELECT COALESCE(
    (SELECT n.id FROM tests.fixtures_named n WHERE n.name = p_name),
    (SELECT u.id FROM tests.fixtures_users u WHERE u.handle = p_name));
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
    p_label || ' (' || to_char(round(v_elapsed_ms, 2), 'FM999990.00') || ' ms)'
  );
  RETURN;
END; $$;

-- Tests call these after SET LOCAL ROLE authenticated / anon.
GRANT USAGE ON SCHEMA tests TO postgres, service_role, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated;
