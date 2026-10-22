-- SCR-0201: the break_glass role (RLS Design §2, Location Privacy §10, Runbooks §6).
--
-- This migration creates the role only: NOLOGIN, NOINHERIT, no attributes, no grants,
-- no memberships. It deliberately does NOT grant SELECT on private.garden_locations.
-- That grant, the 60-minute time box, two-person activation and per-statement audit
-- belong to the break-glass provisioning script (`npm run ops:break-glass`, Runbooks §6),
-- which does not exist yet. Until it does, the role can do nothing.
--
-- Roles are cluster-wide and survive a database re-create, so creation is guarded.
-- Asserted by supabase/tests/roles_break_glass.test.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'break_glass') THEN
    CREATE ROLE break_glass
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

COMMENT ON ROLE break_glass IS
  'Two-person authorized, time-boxed read of private.garden_locations (RLS Design §2). '
  'Holds no privileges until the provisioning script grants them for one ticket. Never grant in a migration.';
