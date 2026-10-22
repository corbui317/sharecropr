-- SCR-0201: Baseline migration — schemas, extensions, enums, shared utilities

-- ── Schemas ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS tests;

REVOKE ALL ON SCHEMA private FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SCHEMA audit FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SCHEMA app FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SCHEMA tests FROM anon, authenticated, PUBLIC;

GRANT USAGE ON SCHEMA app TO authenticated;
GRANT USAGE ON SCHEMA tests TO postgres, service_role;

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS h3 WITH SCHEMA extensions; -- HARNESS FIX 1
CREATE EXTENSION IF NOT EXISTS h3_postgis WITH SCHEMA extensions CASCADE; -- HARNESS FIX 4
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- ── Enums (Data Model §4) ───────────────────────────────────────────────────
CREATE TYPE public.verification_status AS ENUM (
  'unstarted', 'pending_vendor', 'passed', 'failed', 'expired', 'revoked'
);
CREATE TYPE public.garden_status AS ENUM (
  'draft', 'pending_review', 'verified', 'rejected', 'archived'
);
CREATE TYPE public.trust_tier AS ENUM (
  'unverified', 'email_verified', 'id_verified', 'trusted'
);
CREATE TYPE public.quantity_unit AS ENUM (
  'each', 'bunch', 'pound', 'kilogram', 'ounce', 'gram',
  'quart', 'pint', 'gallon', 'liter', 'dozen'
);
CREATE TYPE public.item_condition AS ENUM (
  'just_picked', 'fresh', 'ripe', 'very_ripe', 'preserved', 'seed'
);
CREATE TYPE public.inventory_status AS ENUM (
  'available', 'listed', 'reserved', 'exchanged', 'composted', 'archived'
);
CREATE TYPE public.listing_status AS ENUM (
  'draft', 'active', 'reserved', 'completed', 'withdrawn', 'expired'
);
CREATE TYPE public.request_status AS ENUM (
  'pending', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled'
);
CREATE TYPE public.session_state AS ENUM (
  'scheduling', 'scheduled', 'in_progress', 'completed',
  'cancelled', 'disputed', 'no_show'
);
CREATE TYPE public.safe_spot_category AS ENUM (
  'public_library', 'police_station', 'city_hall', 'community_center',
  'college_campus', 'fire_station', 'farmers_market', 'park_pavilion', 'other_municipal'
);
CREATE TYPE public.safe_spot_status AS ENUM (
  'proposed', 'under_review', 'active', 'suspended', 'retired'
);
CREATE TYPE public.safe_spot_source AS ENUM (
  'manual', 'osm_import', 'partner', 'user_proposed'
);
CREATE TYPE public.message_kind AS ENUM ('user', 'system', 'safety_notice');
CREATE TYPE public.report_reason AS ENUM (
  'no_show', 'misrepresented_goods', 'harassment', 'unsafe_meeting',
  'spam', 'impersonation', 'underage', 'other'
);
CREATE TYPE public.report_status AS ENUM (
  'open', 'triaged', 'actioned', 'dismissed', 'escalated'
);
CREATE TYPE public.moderation_action AS ENUM (
  'none', 'warning', 'content_removed', 'listing_removed',
  'suspension', 'permanent_ban', 'law_enforcement_referral'
);
CREATE TYPE public.notification_kind AS ENUM (
  'request_received', 'request_accepted', 'request_declined',
  'message_received', 'exchange_reminder', 'exchange_cancelled',
  'verification_result', 'garden_review_result', 'moderation_outcome',
  'safety_alert', 'surplus_alert'
);
CREATE TYPE public.device_platform AS ENUM ('ios', 'android');

-- ── Shared updated_at trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
