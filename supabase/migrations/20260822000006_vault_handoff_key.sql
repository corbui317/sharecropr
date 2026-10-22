-- SCR-0208: handoff_code_key accessor (Exchange State Machine §3.3, Environments §6).
-- Edited in place before first apply (Data Model §15 rule 12): the local placeholder secret moved to
-- supabase/seed.sql so no hosted project ever receives it, and the invalid
-- COMMENT ON FUNCTION vault.get_secret (Supabase Vault has no such function) is gone.

CREATE OR REPLACE FUNCTION private.get_handoff_key()
RETURNS text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_key text;
BEGIN
  SELECT s.decrypted_secret INTO v_key
    FROM vault.decrypted_secrets s
   WHERE s.name = 'handoff_code_key'
   LIMIT 1;
  IF v_key IS NULL OR v_key = '' THEN
    -- Fail closed: there is no fallback key, ever (SPEC-010 R30; client mapping is SCR-1216).
    RAISE EXCEPTION 'handoff_key_unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION private.get_handoff_key() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.get_handoff_key() IS
  'The only read path for handoff_code_key, for get_handoff_code / accept_exchange_request. '
  'No client EXECUTE. Raises handoff_key_unavailable (55000) when absent. Custody: Environments §6.';
