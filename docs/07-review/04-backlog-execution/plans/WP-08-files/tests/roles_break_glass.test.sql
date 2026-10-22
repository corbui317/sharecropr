BEGIN;
SELECT plan(12);

-- SCR-0201: break_glass exists and holds nothing (RLS Design §2, Location Privacy §10).
-- Grants are made only by the provisioning script, per ticket, never by a migration.

SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'break_glass'),
  'P1: break_glass role exists');

SELECT ok(NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'break_glass'),
  'N1: break_glass cannot log in');

SELECT ok(NOT (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication
                 FROM pg_roles WHERE rolname = 'break_glass'),
  'N2: break_glass has no superuser, createrole, createdb or replication attribute');

SELECT ok(NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'break_glass'),
  'N3: break_glass does not bypass RLS');

SELECT is((SELECT count(*) FROM pg_auth_members m
            JOIN pg_roles r ON r.oid = m.member
           WHERE r.rolname = 'break_glass')::int,
  0, 'N4: break_glass is a member of no role');

SELECT ok(NOT has_table_privilege('break_glass', 'private.garden_locations', 'SELECT'),
  'N5: break_glass cannot read private.garden_locations until provisioned');

SELECT ok(NOT has_schema_privilege('break_glass', 'private', 'USAGE'),
  'N6: break_glass has no USAGE on schema private');

SELECT is((SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a
            WHERE a.grantee = 'break_glass'::regrole)::int,
  0, 'N7: no table, view or sequence grants to break_glass');

SELECT is((SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
            WHERE a.grantee = 'break_glass'::regrole)::int,
  0, 'N8: no function grants to break_glass');

SELECT is((SELECT count(*) FROM pg_namespace n, aclexplode(n.nspacl) a
            WHERE a.grantee = 'break_glass'::regrole)::int,
  0, 'N9: no schema grants to break_glass');

SELECT is((SELECT count(*) FROM pg_default_acl d, aclexplode(d.defaclacl) a
            WHERE a.grantee = 'break_glass'::regrole)::int,
  0, 'N10: no default privileges name break_glass');

SELECT ok(NOT pg_has_role('authenticated', 'break_glass', 'MEMBER')
      AND NOT pg_has_role('anon', 'break_glass', 'MEMBER')
      AND NOT pg_has_role('service_role', 'break_glass', 'MEMBER')
      AND NOT pg_has_role('authenticator', 'break_glass', 'MEMBER'),
  'N11: no API role can assume break_glass');

SELECT * FROM finish();
ROLLBACK;
