-- SCR-0204: app.* authorization helpers, RLS policies, profile_cards, block teardown

-- ── Authorization helpers (RLS Design §3) ─────────────────────────────────
CREATE OR REPLACE FUNCTION app.is_moderator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'role') IN ('moderator', 'admin'),
    false);
$$;

CREATE OR REPLACE FUNCTION app.is_blocked_either_way(a uuid, b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
     WHERE (blocker_id = a AND blocked_id = b)
        OR (blocker_id = b AND blocked_id = a));
$$;

CREATE OR REPLACE FUNCTION app.can_transact(u uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.verifications v ON v.user_id = p.id
     WHERE p.id = u
       AND p.deleted_at IS NULL
       AND p.is_suspended = false
       AND (v.status = 'passed'
            OR EXISTS (SELECT 1 FROM private.review_bypass_accounts r
                        WHERE r.user_id = u AND r.expires_at > now()))
       AND EXISTS (SELECT 1 FROM public.gardens g
                    WHERE g.owner_id = u AND g.status = 'verified' AND g.deleted_at IS NULL));
$$;

CREATE OR REPLACE FUNCTION app.is_session_participant(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exchange_sessions s
     WHERE s.id = sid
       AND auth.uid() IN (s.owner_id, s.requester_id));
$$;

CREATE OR REPLACE FUNCTION app.is_thread_participant(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.message_threads t
     WHERE t.id = tid
       AND auth.uid() IN (t.participant_a, t.participant_b)
       AND t.is_closed = false);
$$;

CREATE OR REPLACE FUNCTION app.jsonb_has_coord_key(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_each(p) kv
     WHERE kv.key ~* '^(lat|lng|latitude|longitude|point|coordinates|geohash|fine_cell)$'
        OR (jsonb_typeof(kv.value) = 'object' AND app.jsonb_has_coord_key(kv.value)));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.is_blocked_either_way(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.can_transact(uuid) TO authenticated;

-- ── profile_cards ────────────────────────────────────────────────────────────
CREATE VIEW public.profile_cards
WITH (security_invoker = on) AS
SELECT p.id, p.handle, p.display_name, p.avatar_path, p.bio,
       p.city_label, p.trust_tier, p.rating_avg, p.rating_count,
       p.completed_exchanges, p.created_at
  FROM public.profiles p
 WHERE p.deleted_at IS NULL
   AND p.is_suspended = false
   AND NOT app.is_blocked_either_way(auth.uid(), p.id);

GRANT SELECT ON public.profile_cards TO authenticated;

REVOKE SELECT (trust_score, cancellation_count_90d, home_coarse_cell, is_suspended)
  ON public.profiles FROM authenticated;

-- ── RLS: profiles ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) AND deleted_at IS NULL);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (id = (SELECT auth.uid()));

-- ── RLS: verifications ───────────────────────────────────────────────────────
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications FORCE ROW LEVEL SECURITY;

CREATE POLICY verifications_select_own ON public.verifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY verifications_select_moderator ON public.verifications
  FOR SELECT TO authenticated
  USING (app.is_moderator());

-- ── RLS: blocks ──────────────────────────────────────────────────────────────
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks FORCE ROW LEVEL SECURITY;

CREATE POLICY blocks_select_blocker ON public.blocks
  FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

CREATE POLICY blocks_insert_own ON public.blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = (SELECT auth.uid()));

-- ── RLS: gardens ─────────────────────────────────────────────────────────────
ALTER TABLE public.gardens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gardens FORCE ROW LEVEL SECURITY;

CREATE POLICY gardens_select_own ON public.gardens
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);

CREATE POLICY gardens_select_moderator ON public.gardens
  FOR SELECT TO authenticated
  USING (app.is_moderator());

CREATE POLICY gardens_insert_own ON public.gardens
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND status = 'draft'
    AND display_point IS NULL AND coarse_cell IS NULL AND fine_cell IS NULL
  );

CREATE POLICY gardens_update_own ON public.gardens
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- Block teardown function + trigger created in 0007 after audit.events exists.
