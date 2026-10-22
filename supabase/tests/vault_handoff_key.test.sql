-- SCR-0208 (WP-09): private.get_handoff_key() is the only read path for handoff_code_key.
-- Tags: SPEC-010-R30, SCR-1216 (fail closed). Key material never reaches TAP output.
BEGIN;
SELECT plan(8);

SELECT ok((SELECT p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
             FROM pg_proc p WHERE p.oid = 'private.get_handoff_key()'::regprocedure),
  'S1: get_handoff_key is SECURITY DEFINER with a pinned search_path');

SELECT ok(extensions.pgp_sym_decrypt(extensions.pgp_sym_encrypt('424242', private.get_handoff_key()),
                                     private.get_handoff_key()) = '424242',
  'P1: owner round trip with the seeded key returns the plaintext (SPEC-010-R30)');

SELECT ok(NOT has_function_privilege('anon', 'private.get_handoff_key()', 'EXECUTE'),
  'N1: anon cannot execute get_handoff_key');
SELECT ok(NOT has_function_privilege('authenticated', 'private.get_handoff_key()', 'EXECUTE'),
  'N2: authenticated cannot execute get_handoff_key');
SELECT ok((SELECT p.proacl IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
             FROM pg_proc p WHERE p.oid = 'private.get_handoff_key()'::regprocedure),
  'N3: PUBLIC holds no EXECUTE on get_handoff_key');
SELECT ok(NOT has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')
      AND NOT has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT'),
  'N4: client roles cannot read vault.decrypted_secrets directly');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ SELECT private.get_handoff_key() $$, '42501', NULL,
  'N5: a signed-in client calling get_handoff_key is denied');
SELECT tests.clear_authentication();

-- Fail closed (SCR-1216). Rolled back with the file.
DELETE FROM vault.secrets WHERE name = 'handoff_code_key';
SELECT throws_ok($$ SELECT private.get_handoff_key() $$, '55000', 'handoff_key_unavailable',
  'N6: get_handoff_key fails closed when the key is absent');

SELECT * FROM finish();
ROLLBACK;
