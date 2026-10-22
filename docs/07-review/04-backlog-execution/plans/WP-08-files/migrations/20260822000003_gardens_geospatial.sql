-- SCR-0203: Gardens, private.garden_locations, location derivation (Location Privacy §4)

CREATE TABLE public.gardens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description      text CHECK (description IS NULL OR length(description) <= 500),
  status           public.garden_status NOT NULL DEFAULT 'draft',
  display_point    geography(Point, 4326),
  h3_r7            text,
  h3_r9            text,
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
CREATE INDEX gardens_h3_r9_idx ON public.gardens (h3_r9);
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
         h3_r7         = h3_lat_lng_to_cell(NEW.exact_point::geometry, 7)::text,
         h3_r9         = h3_lat_lng_to_cell(NEW.exact_point::geometry, 9)::text,
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
       OR NEW.h3_r7 IS DISTINCT FROM OLD.h3_r7
       OR NEW.h3_r9 IS DISTINCT FROM OLD.h3_r9 THEN
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

-- ── H3 / geohash helpers (ADR-0005) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.k_for_radius(p_resolution int, p_radius_m double precision)
RETURNS int
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, extensions
AS $$
  SELECT GREATEST(1, CEIL(
    p_radius_m / NULLIF(h3_get_hexagon_edge_length_avg(p_resolution, 'm'), 0)
  ))::int;
$$;

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

REVOKE ALL ON FUNCTION app.k_for_radius(int, double precision) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION app.quantize_lat_lng(double precision, double precision, double precision)
  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION app.geohash_encode(double precision, double precision, int)
  FROM anon, authenticated, PUBLIC;

-- Column-level protection for h3_r9
REVOKE SELECT (h3_r9) ON public.gardens FROM authenticated;

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
