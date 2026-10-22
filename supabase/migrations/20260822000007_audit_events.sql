-- SCR-0211: audit.events append-only table + block trigger wiring

CREATE TABLE audit.events (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  actor_role   text NOT NULL,
  action       text NOT NULL,
  subject_type text,
  subject_id   uuid,
  metadata     jsonb NOT NULL DEFAULT '{}',
  request_id   uuid,
  CONSTRAINT audit_metadata_no_coords CHECK (NOT app.jsonb_has_coord_key(metadata))
);

REVOKE ALL ON audit.events FROM anon, authenticated, PUBLIC;
GRANT INSERT ON audit.events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE audit.events_id_seq TO service_role;

-- Block teardown (RLS Design §6)
CREATE OR REPLACE FUNCTION public.on_block_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, audit AS $$
BEGIN
  UPDATE public.exchange_sessions
     SET state = 'cancelled', cancelled_by = NEW.blocker_id,
         cancelled_reason = 'blocked', cancelled_at = now(), version = version + 1
   WHERE state IN ('scheduling', 'scheduled')
     AND ((owner_id = NEW.blocker_id AND requester_id = NEW.blocked_id)
       OR (owner_id = NEW.blocked_id AND requester_id = NEW.blocker_id));

  UPDATE public.message_threads SET is_closed = true
   WHERE (participant_a = LEAST(NEW.blocker_id, NEW.blocked_id)
      AND participant_b = GREATEST(NEW.blocker_id, NEW.blocked_id));

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (NEW.blocker_id, 'authenticated', 'block.created', 'user', NEW.blocked_id);

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION audit.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, audit
AS $$
BEGIN
  RAISE EXCEPTION 'audit.events is append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_audit_mutation();

CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_audit_mutation();

-- Wire block teardown now that audit.events exists
CREATE TRIGGER trg_on_block_created
  AFTER INSERT ON public.blocks
  FOR EACH ROW EXECUTE FUNCTION public.on_block_created();
