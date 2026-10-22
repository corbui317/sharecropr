-- SCR-0203: Gardens, private.garden_locations, location derivation (Location Privacy §4)
-- Location tiers are PostGIS-only (ADR-0023, supersedes ADR-0005). Edited in place before first
-- apply (Data Model §15 rule 12): the H3 columns and helpers never existed in any database.

CREATE TABLE public.gardens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description      text CHECK (description IS NULL OR length(description) <= 500),
  status           public.garden_status NOT NULL DEFAULT 'draft',
  display_point    geography(Point, 4326),
  coarse_cell      text CONSTRAINT gardens_coarse_cell_tier
                     CHECK (coarse_cell IS NULL OR coarse_cell ~ '^2500:[0-9]+:[0-9]+$'),
  fine_cell        text CONSTRAINT gardens_fine_cell_tier
                     CHECK (fine_cell IS NULL OR fine_cell ~ '^320:[0-9]+:[0-9]+$'),
  grow_zone        text CHECK (grow_zone IS NULL OR length(grow_zone) <= 8),
  size_band        text CHECK (size_band IS NULL OR size_band IN (
    'containers', 'small', 'medium', 'large', 'allotment'
  )),
  verified_at      timestamptz,
  rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 200),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gardens_owner_idx ON public.gardens (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX gardens_display_gix ON public.gardens USING GIST (display_point);
CREATE INDEX gardens_status_idx ON public.gardens (status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX gardens_one_per_owner ON public.gardens (owner_id)
  WHERE deleted_at IS NULL AND status <> 'archived';

CREATE TRIGGER trg_gardens_updated_at
  BEFORE UPDATE ON public.gardens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE private.garden_locations (
  garden_id      uuid PRIMARY KEY REFERENCES public.gardens(id) ON DELETE CASCADE,
  exact_point    geography(Point, 4326) NOT NULL,
  accuracy_m     real,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  capture_source text NOT NULL CHECK (capture_source IN ('device_gps', 'manual_pin')),
  fuzz_seed      uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX garden_locations_gix ON private.garden_locations USING GIST (exact_point);
REVOKE ALL ON private.garden_locations FROM anon, authenticated, PUBLIC;

-- ── Location tiers (ADR-0023) ───────────────────────────────────────────────
-- The ONLY place tier sizes live. Every stored tier column CHECK-pins its id prefix, so changing
-- a size also requires changing those constraints: a resolution change is a reviewed schema change.
CREATE OR REPLACE FUNCTION app.location_tier_side_m(p_tier text)
RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_tier
           WHEN 'region' THEN 16000  -- analytics ceiling, 256 km²   (H3 r5 was ~253 km²)
           WHEN 'coarse' THEN 2500   -- owner/server only, 6.25 km² (H3 r7 was ~5.2 km²)
           WHEN 'fine'   THEN 320    -- internal only, 0.10 km²     (H3 r9 was ~0.105 km²)
         END;
$$;

-- Banded equal-area square grid on the mean-radius sphere (ADR-0023 §The grid). Rows have constant
-- height; each ROW's column width comes from the row's centre latitude (not the point's), so the
-- grid is a true partition and cells are ~side x side on the ground at any latitude.
-- Id '<side_m>:<row>:<col>' with row, col >= 0. Pure arithmetic: no spatial_ref_sys, no PROJ.
CREATE OR REPLACE FUNCTION app.location_cell(p_point geography, p_tier text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  m_per_deg constant double precision := pi() * 6371008.8 / 180.0;  -- metres per degree of latitude
  v_side    integer := app.location_tier_side_m(p_tier);
  v_lat     double precision;
  v_lng     double precision;
  v_row_h   double precision;
  v_row     bigint;
  v_col_w   double precision;
  v_col     bigint;
BEGIN
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'unknown location tier' USING ERRCODE = '22023';
  END IF;
  v_lat   := ST_Y(p_point::geometry);
  v_lng   := ST_X(p_point::geometry);
  v_row_h := v_side / m_per_deg;
  v_row   := floor((v_lat + 90.0) / v_row_h)::bigint;
  v_col_w := v_side / (m_per_deg * GREATEST(cos(radians(-90.0 + (v_row + 0.5) * v_row_h)), 1e-9));
  v_col   := floor((v_lng + 180.0) / v_col_w)::bigint;
  RETURN format('%s:%s:%s', v_side, v_row, v_col);
END;
$$;

REVOKE ALL ON FUNCTION app.location_tier_side_m(text) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION app.location_cell(geography, text) FROM anon, authenticated, PUBLIC;

-- ── Fuzzing (Location Privacy §4.2) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.derive_display_point(
  p_exact geography(Point, 4326),
  p_seed  uuid
) RETURNS geography(Point, 4326)
LANGUAGE plpgsql IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  h       bytea := digest(p_seed::text, 'sha256');
  u1      double precision := (get_byte(h, 0) * 256 + get_byte(h, 1))::double precision / 65536.0;
  u2      double precision := (get_byte(h, 2) * 256 + get_byte(h, 3))::double precision / 65536.0;
  min_m   constant double precision := 400.0;
  max_m   constant double precision := 1200.0;
  dist_m  double precision := min_m + (max_m - min_m) * sqrt(u1);
  bearing double precision := 2 * pi() * u2;
BEGIN
  RETURN ST_Project(p_exact, dist_m, bearing)::geography;
END;
$$;

REVOKE ALL ON FUNCTION app.derive_display_point(geography, uuid) FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION private.sync_garden_derived_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $$
BEGIN
  UPDATE public.gardens g
     SET display_point = app.derive_display_point(NEW.exact_point, NEW.fuzz_seed),
         coarse_cell   = app.location_cell(NEW.exact_point, 'coarse'),
         fine_cell     = app.location_cell(NEW.exact_point, 'fine'),
         updated_at    = now()
   WHERE g.id = NEW.garden_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_garden_location
  AFTER INSERT OR UPDATE OF exact_point ON private.garden_locations
  FOR EACH ROW EXECUTE FUNCTION private.sync_garden_derived_location();

CREATE OR REPLACE FUNCTION public.reject_client_location_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated' THEN
    IF NEW.display_point IS DISTINCT FROM OLD.display_point
       OR NEW.coarse_cell IS DISTINCT FROM OLD.coarse_cell
       OR NEW.fine_cell IS DISTINCT FROM OLD.fine_cell THEN
      RAISE EXCEPTION 'derived location columns are not client-writable'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reject_client_location_write
  BEFORE UPDATE ON public.gardens
  FOR EACH ROW EXECUTE FUNCTION public.reject_client_location_write();

-- ── Quantization helpers (Location Privacy §6.1) ────────────────────────────
CREATE OR REPLACE FUNCTION app.quantize_lat_lng(
  p_lat double precision,
  p_lng double precision,
  p_grid_m double precision DEFAULT 100.0
) RETURNS TABLE (lat double precision, lng double precision)
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, extensions
AS $$
  SELECT
    ST_Y(ST_SnapToGrid(
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geometry,
      p_grid_m / 111320.0
    )) AS lat,
    ST_X(ST_SnapToGrid(
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geometry,
      p_grid_m / (111320.0 * cos(radians(p_lat)))
    )) AS lng;
$$;

CREATE OR REPLACE FUNCTION app.geohash_encode(
  p_lat double precision,
  p_lng double precision,
  p_precision int DEFAULT 7
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, extensions
AS $$
  SELECT ST_GeoHash(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), p_precision);
$$;

REVOKE ALL ON FUNCTION app.quantize_lat_lng(double precision, double precision, double precision)
  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION app.geohash_encode(double precision, double precision, int)
  FROM anon, authenticated, PUBLIC;

-- fine_cell is never client-readable (0010 also leaves it out of the column grants).
REVOKE SELECT (fine_cell) ON public.gardens FROM authenticated;

-- Owner reads own exact point (Location Privacy §5)
CREATE OR REPLACE FUNCTION public.get_my_garden_location(p_garden_id uuid DEFAULT NULL)
RETURNS TABLE (lat double precision, lng double precision)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $$
DECLARE
  v_garden_id uuid;
BEGIN
  SELECT COALESCE(p_garden_id, g.id) INTO v_garden_id
    FROM public.gardens g
   WHERE g.owner_id = auth.uid() AND g.deleted_at IS NULL
   ORDER BY g.created_at
   LIMIT 1;

  IF v_garden_id IS NULL THEN
    RAISE EXCEPTION 'garden_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_garden_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gardens g
     WHERE g.id = p_garden_id AND g.owner_id = auth.uid() AND g.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ST_Y(l.exact_point::geometry), ST_X(l.exact_point::geometry)
    FROM private.garden_locations l
   WHERE l.garden_id = v_garden_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_garden_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_garden_location(uuid) TO authenticated;

-- ── Tier consistency (ADR-0023 §Enforcement 7) ──────────────────────────────
-- Raises on any garden whose stored cells disagree with its exact_point. Reports a COUNT only:
-- never a garden id, cell or coordinate (Invariant 1). Failures land in cron.job_run_details.
CREATE OR REPLACE FUNCTION private.check_location_tiers()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $$
DECLARE v_drift bigint;
BEGIN
  SELECT count(*) INTO v_drift
    FROM private.garden_locations l
    JOIN public.gardens g ON g.id = l.garden_id
   WHERE g.coarse_cell IS DISTINCT FROM app.location_cell(l.exact_point, 'coarse')
      OR g.fine_cell   IS DISTINCT FROM app.location_cell(l.exact_point, 'fine');
  IF v_drift > 0 THEN
    RAISE EXCEPTION 'location tier drift: % garden(s)', v_drift USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.check_location_tiers() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('location_tier_consistency', '45 3 * * *',
                          $$SELECT private.check_location_tiers();$$);
  END IF;
END;
$cron$;
