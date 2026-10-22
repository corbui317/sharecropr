-- SCR-0208: Vault handoff_code_key provisioning for local dev
-- Key custody documented in docs/05-operations/01-environments.md §6

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'handoff_code_key'
  ) THEN
    PERFORM vault.create_secret(
      'local-dev-handoff-key-replace-before-production',
      'handoff_code_key',
      'Symmetric key for pgp_sym_encrypt on exchange_sessions.handoff_code'
    );
  END IF;
END;
$$;

-- Demonstrate encrypt/decrypt path (Exchange State Machine §3.3)
-- HARNESS FIX 3: removed COMMENT ON FUNCTION vault.get_secret(text) (function does not exist in Supabase Vault)
