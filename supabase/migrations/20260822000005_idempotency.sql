-- SCR-0207: private.idempotency_keys + app.idempotency_probe/record + sweep stub

CREATE TABLE private.idempotency_keys (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key        uuid NOT NULL,
  rpc_name   text NOT NULL,
  args_hash  bytea NOT NULL,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX idempotency_keys_sweep_idx ON private.idempotency_keys (created_at);

REVOKE ALL ON private.idempotency_keys FROM anon, authenticated, PUBLIC;

-- Per-table autovacuum tuning (Development Notes N-04)
ALTER TABLE private.idempotency_keys SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 2
);

CREATE OR REPLACE FUNCTION app.idempotency_probe(
  p_user uuid, p_key uuid, p_rpc text, p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, public AS $$
DECLARE v_row private.idempotency_keys;
BEGIN
  IF p_key IS NULL THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM private.idempotency_keys
   WHERE user_id = p_user AND key = p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.rpc_name <> p_rpc
     OR v_row.args_hash <> extensions.digest(p_args::text, 'sha256') THEN
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row.result;
END; $$;

CREATE OR REPLACE FUNCTION app.idempotency_record(
  p_user uuid, p_key uuid, p_rpc text, p_args jsonb, p_result jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, private, public AS $$
  INSERT INTO private.idempotency_keys (user_id, key, rpc_name, args_hash, result)
  VALUES (p_user, p_key, p_rpc, extensions.digest(p_args::text, 'sha256'), p_result)
  ON CONFLICT (user_id, key) DO NOTHING;
$$;

-- Sweep stub: deletes keys older than 24 hours (Exchange State Machine §4.1, §7)
CREATE OR REPLACE FUNCTION private.sweep_idempotency_keys()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, private AS $$
  WITH deleted AS (
    DELETE FROM private.idempotency_keys
     WHERE created_at < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*)::bigint FROM deleted;
$$;

REVOKE ALL ON FUNCTION app.idempotency_probe(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.idempotency_record(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sweep_idempotency_keys() FROM PUBLIC, anon, authenticated;

-- pg_cron registration deferred until audit migration confirms extension (0008)
