-- SCR-0202: Core identity tables, blocks, profile_cards, signup trigger
-- Stub exchange_sessions / message_threads for block teardown (EPIC-12 replaces)

-- ── Minimal stubs for block teardown and app helpers ────────────────────────
CREATE TABLE public.exchange_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL UNIQUE,
  owner_id      uuid NOT NULL,
  requester_id  uuid NOT NULL,
  state         public.session_state NOT NULL DEFAULT 'scheduling',
  safe_spot_id  uuid,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  handoff_code  bytea,
  owner_confirmed_at timestamptz,
  requester_confirmed_at timestamptz,
  completed_at  timestamptz,
  cancelled_by  uuid,
  cancelled_reason text,
  cancelled_at  timestamptz,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.message_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL UNIQUE,
  participant_a   uuid NOT NULL,
  participant_b   uuid NOT NULL,
  is_closed       boolean NOT NULL DEFAULT false,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exchange_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads FORCE ROW LEVEL SECURITY;

-- No client policies on stubs — EPIC-12 adds them.

-- ── profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id                      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 40),
  handle                  citext NOT NULL,
  avatar_path             text CHECK (avatar_path IS NULL OR length(avatar_path) <= 300),
  bio                     text CHECK (bio IS NULL OR length(bio) <= 280),
  city_label              text CHECK (city_label IS NULL OR length(city_label) <= 80),
  home_coarse_cell        text CONSTRAINT profiles_home_coarse_cell_tier
                            CHECK (home_coarse_cell IS NULL OR home_coarse_cell ~ '^2500:[0-9]+:[0-9]+$'),
  trust_tier              public.trust_tier NOT NULL DEFAULT 'unverified',
  trust_score             numeric(5,2) NOT NULL DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 100),
  rating_avg              numeric(3,2) CHECK (rating_avg IS NULL OR rating_avg BETWEEN 1 AND 5),
  rating_count            integer NOT NULL DEFAULT 0,
  completed_exchanges     integer NOT NULL DEFAULT 0,
  cancellation_count_90d  integer NOT NULL DEFAULT 0,
  is_suspended            boolean NOT NULL DEFAULT false,
  suspended_until         timestamptz,
  locale                  text NOT NULL DEFAULT 'en-US',
  timezone                text NOT NULL DEFAULT 'UTC',
  onboarding_completed_at timestamptz,
  deleted_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_handle_key ON public.profiles (handle) WHERE deleted_at IS NULL;
CREATE INDEX profiles_home_coarse_cell_idx ON public.profiles (home_coarse_cell) WHERE deleted_at IS NULL;
CREATE INDEX profiles_trust_tier_idx ON public.profiles (trust_tier);
CREATE INDEX profiles_active_idx ON public.profiles (id)
  WHERE is_suspended = false AND deleted_at IS NULL;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── verifications ────────────────────────────────────────────────────────────
CREATE TABLE public.verifications (
  user_id             uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status              public.verification_status NOT NULL DEFAULT 'unstarted',
  is_over_18          boolean,
  document_country    char(2),
  verified_at         timestamptz,
  expires_at          timestamptz,
  failure_reason_code text CHECK (failure_reason_code IS NULL OR length(failure_reason_code) <= 60),
  attempt_count       smallint NOT NULL DEFAULT 0 CHECK (attempt_count <= 5),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_verifications_updated_at
  BEFORE UPDATE ON public.verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── private identity tables ──────────────────────────────────────────────────
CREATE TABLE private.verification_vendor_refs (
  user_id                 uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  vendor                  text NOT NULL,
  inquiry_id              text NOT NULL,
  webhook_idempotency_key text UNIQUE,
  raw_decision            jsonb CHECK (
    raw_decision IS NULL OR NOT (
      raw_decision ? 'image' OR raw_decision ? 'images'
      OR raw_decision ? 'document_number' OR raw_decision ? 'document_numbers'
      OR raw_decision ? 'selfie' OR raw_decision ? 'biometric'
    )
  ),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private.review_bypass_accounts (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  expires_at timestamptz NOT NULL
);

REVOKE ALL ON private.verification_vendor_refs FROM anon, authenticated, PUBLIC;
REVOKE ALL ON private.review_bypass_accounts FROM anon, authenticated, PUBLIC;

-- ── blocks ───────────────────────────────────────────────────────────────────
CREATE TABLE public.blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason     text CHECK (reason IS NULL OR length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX blocks_blocker_idx ON public.blocks (blocker_id, blocked_id);
CREATE INDEX blocks_blocked_idx ON public.blocks (blocked_id);

-- profile_cards view created in 0004 after app.is_blocked_either_way exists.

-- ── Signup trigger ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_base   text;
  v_handle citext;
  v_suffix text;
BEGIN
  v_base := lower(regexp_replace(
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'gardener'),
    '[^a-z0-9]', '', 'gi'
  ));
  IF length(v_base) < 3 THEN
    v_base := 'gardener';
  END IF;
  v_suffix := substr(replace(NEW.id::text, '-', ''), 1, 6);
  v_handle := left(v_base, 14) || '_' || v_suffix;

  INSERT INTO public.profiles (id, display_name, handle)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'Gardener'),
    v_handle
  );

  INSERT INTO public.verifications (user_id) VALUES (NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Foreign keys to profiles (tables created above without FK to avoid ordering issues)
ALTER TABLE public.exchange_sessions
  ADD CONSTRAINT exchange_sessions_owner_fk
    FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT exchange_sessions_requester_fk
    FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.message_threads
  ADD CONSTRAINT message_threads_participant_a_fk
    FOREIGN KEY (participant_a) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT message_threads_participant_b_fk
    FOREIGN KEY (participant_b) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- RLS and policies applied in 0004 after app helpers exist.
