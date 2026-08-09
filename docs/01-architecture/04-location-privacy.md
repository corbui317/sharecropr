# Location Privacy Architecture

**Status:** Review · **Version:** 1.0.0 · **Owner:** Architecture + Security
**Security review:** required for any change to this document.

> **Read this before writing any code that touches location.** Sharecropr stores the home addresses of thousands of people and introduces them to strangers. This document describes the one mechanism that makes that acceptable. Every other privacy control in the system is secondary to this one.

---

## 1. The threat we are defending against

A user's garden is at their home. If an attacker can determine a garden's coordinates, they know where a specific, named, photographed person lives. The realistic attackers:

| Attacker | Capability | Goal |
| --- | --- | --- |
| **Stalker / ex-partner** | A legitimate account, patience, knows the target's display name and photo | Find the target's home |
| **Burglar** | A legitimate account, bulk browsing | Find houses with valuable gardens and known absence windows (a scheduled exchange is an announcement that someone will be elsewhere at a known time) |
| **Scraper** | Automated client, many accounts | Bulk-harvest a location dataset to sell or publish |
| **Curious user** | Casual, no tooling | Idle de-anonymization |
| **Insider** | Database or admin console access | Targeted lookup |

The subtle one, and the one most implementations get wrong, is the **averaging attack**: if the system adds random noise to a coordinate on every read, an attacker who reads the same garden 500 times computes the mean and recovers the true point to within a few metres. Random fuzzing applied per-request is not privacy; it is a slow information leak.

---

## 2. The invariant

> **No API response, realtime payload, log line, telemetry event, push notification, or export may contain a garden's exact coordinate, or any value from which it can be derived to better than ~1 km.**

This is not enforced by remembering to filter. It is enforced structurally, in four layers:

| Layer | Control | What it stops |
| --- | --- | --- |
| **1. Storage** | Exact points live in `private.garden_locations`. `REVOKE ALL ON SCHEMA private FROM anon, authenticated`. The schema is not in PostgREST's exposed schema list. | Any direct query, including a crafted PostgREST request |
| **2. Derivation** | A `BEFORE INSERT OR UPDATE` trigger computes the fuzzed `display_point` and H3 cells. There is no code path that writes a garden without fuzzing, because the trigger cannot be skipped. | A developer forgetting to fuzz |
| **3. Access** | Only an allowlisted set of `SECURITY DEFINER` functions may read `private`. Their **return types have no coordinate column** for user gardens. | A function accidentally returning a point |
| **4. Egress** | Telemetry scrubbers, a `jsonb` CHECK on notification payloads and audit metadata, and analytics capped at H3 r5. | Leaks through the side doors, which is how this usually happens |

---

## 3. Storage model

```sql
-- The real coordinate. Never reachable by a client role.
CREATE TABLE private.garden_locations (
  garden_id     uuid PRIMARY KEY REFERENCES public.gardens(id) ON DELETE CASCADE,
  exact_point   geography(Point, 4326) NOT NULL,
  accuracy_m    real,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  capture_source text NOT NULL CHECK (capture_source IN ('device_gps','manual_pin')),
  -- Stable per garden. This is what defeats the averaging attack.
  fuzz_seed     uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX garden_locations_gix ON private.garden_locations USING GIST (exact_point);

REVOKE ALL ON private.garden_locations FROM anon, authenticated, PUBLIC;
```

The client-reachable `public.gardens` row carries only derived values:

```sql
ALTER TABLE public.gardens
  ADD COLUMN display_point geography(Point,4326),  -- fuzzed, ~800 m offset
  ADD COLUMN h3_r7 text,                            -- ~5 km²  — safe to expose
  ADD COLUMN h3_r9 text;                            -- ~0.1 km² — NEVER exposed
```

> `h3_r9` exists because proximity matching needs finer resolution than we can safely show. It is used *inside* `SECURITY DEFINER` functions and is stripped from every client-facing view. It is listed in the forbidden-column CI check.

---

## 4. The fuzzing function

### 4.1 Design requirements

| Requirement | Why |
| --- | --- |
| **Deterministic per garden** | Defeats the averaging attack. Same input → same output, always. |
| **Offset ≥ 400 m, ≤ 1200 m** | Far enough that the displaced point is not on the same block. Close enough that "roughly this neighbourhood" is still true. |
| **Uniform bearing** | A fixed bearing (e.g. always north) would let an attacker subtract it. |
| **Recomputed only when the true point changes** | Moving the display point around a stationary garden leaks that the garden is stationary and gives multiple samples. |
| **Not reversible from the seed** | The seed lives in `private` and never leaves. |

### 4.2 Implementation

```sql
CREATE OR REPLACE FUNCTION app.derive_display_point(
  p_exact  geography(Point,4326),
  p_seed   uuid
) RETURNS geography(Point,4326)
LANGUAGE plpgsql IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Two independent, stable pseudo-random values in [0,1) derived from the seed.
  h        bytea   := digest(p_seed::text, 'sha256');
  u1       double precision := (get_byte(h,0) * 256 + get_byte(h,1))::double precision / 65536.0;
  u2       double precision := (get_byte(h,2) * 256 + get_byte(h,3))::double precision / 65536.0;
  min_m    constant double precision := 400.0;
  max_m    constant double precision := 1200.0;
  -- sqrt() gives a uniform area distribution rather than clustering near the centre.
  dist_m   double precision := min_m + (max_m - min_m) * sqrt(u1);
  bearing  double precision := 2 * pi() * u2;
BEGIN
  RETURN ST_Project(p_exact, dist_m, bearing)::geography;
END;
$$;

REVOKE ALL ON FUNCTION app.derive_display_point(geography, uuid) FROM anon, authenticated;
```

### 4.3 The trigger that makes it unskippable

```sql
CREATE OR REPLACE FUNCTION private.sync_garden_derived_location()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
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
```

And the client is forbidden from writing the derived columns directly:

```sql
CREATE OR REPLACE FUNCTION public.reject_client_location_write()
RETURNS trigger LANGUAGE plpgsql AS $$
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
```

---

## 5. What each audience can see

| Audience | Garden location visibility |
| --- | --- |
| **The garden's owner** | Their own exact point, via `rpc.get_my_garden_location()`. They already know where they live. |
| **Any other user** | **Nothing.** Gardens are not rendered on the map at all. Listings attach to safe spots, not to gardens. |
| **The map** | Only `safe_spots.point` — precise, and public because it is a public building. |
| **Aggregate/analytics** | H3 r5 cells (~250 km²) and above. Nothing finer, ever. |
| **Moderator** | `display_point` and `city_label` only. Exact point requires a break-glass procedure that writes to `audit.events` and pages the security owner. |
| **Support** | Never. Support has no path to any location data. |

> **The strongest control is a product decision, not a technical one: other users' gardens are never drawn on the map.** The fuzzing exists as defence-in-depth for the matching layer, for future features, and for the day someone proposes a "gardens near me" view. It is not the primary protection. The primary protection is that there is nothing to render.

---

## 6. The proximity query, without leaking

Discovery needs to answer "what's available near me" without any user coordinate crossing the wire. The answer: **the query returns safe spots and counts, never people.**

```sql
CREATE OR REPLACE FUNCTION public.safe_spots_near(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_m   integer DEFAULT 8000,
  p_category_ids smallint[] DEFAULT NULL
)
RETURNS TABLE (
  safe_spot_id  uuid,
  name          text,
  category      safe_spot_category,
  lat           double precision,   -- safe spot's own coordinate: public building
  lng           double precision,
  distance_m    double precision,
  listing_count integer,
  top_categories smallint[]
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH me AS (
    SELECT ST_MakePoint(p_lng, p_lat)::geography AS pt
  )
  SELECT s.id,
         s.name,
         s.category,
         ST_Y(s.point::geometry),
         ST_X(s.point::geometry),
         ST_Distance(s.point, me.pt),
         COUNT(DISTINCT l.id)::integer,
         COALESCE(array_agg(DISTINCT sp.category_id)
                    FILTER (WHERE sp.category_id IS NOT NULL), '{}')
    FROM public.safe_spots s
   CROSS JOIN me
    LEFT JOIN public.listing_safe_spots lss ON lss.safe_spot_id = s.id
    LEFT JOIN public.listings l
           ON l.id = lss.listing_id
          AND l.status = 'active'
          AND l.expires_at > now()
          AND NOT app.is_blocked_either_way(auth.uid(), l.owner_id)
    LEFT JOIN public.crop_species sp ON sp.id = l.species_id
   WHERE s.status = 'active'
     AND ST_DWithin(s.point, me.pt, LEAST(p_radius_m, 40000))
     AND (p_category_ids IS NULL OR sp.category_id = ANY(p_category_ids))
   GROUP BY s.id, s.name, s.category, s.point, me.pt
   ORDER BY 6
   LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.safe_spots_near(double precision, double precision, integer, smallint[])
  TO authenticated;
```

**The safety property is structural: the `RETURNS TABLE` declaration has no column that could hold a user's location.** Even a catastrophic bug in the function body cannot leak a garden coordinate, because there is nowhere to put it.

Note also:
- `LEAST(p_radius_m, 40000)` caps the radius server-side. A client asking for 10,000 km gets 40 km.
- Blocks are applied inside the aggregate, so a blocked user's listings don't even contribute to a count.
- `LIMIT 200` bounds the response and the scraping yield.

### 6.1 The client's own position

The client sends its own lat/lng to this RPC. That is unavoidable — proximity search needs an origin. Mitigations:

- The parameter is **quantized client-side to ~100 m** before transmission. Map queries don't need metre precision.
- It is **never persisted**. The function is `STABLE`, writes nothing, and Supabase statement logging is configured to omit RPC parameters for this function.
- It is **excluded from telemetry** by the scrubber's coordinate rule.

---

## 7. H3 usage rules

We use two spatial systems and it is important to know which is for what.

| System | Used for | Exposed? |
| --- | --- | --- |
| **PostGIS `geography`** | Exact distance maths inside `SECURITY DEFINER` functions; safe-spot distance | Only safe-spot points |
| **H3 r7** (~5 km²) | Coarse matching, surplus-alert targeting, `profiles.home_h3_r7` | Yes, to the owner and to server logic |
| **H3 r9** (~0.1 km²) | Internal proximity bucketing | **Never** |
| **H3 r5** (~250 km²) | Analytics, heatmaps | Yes |

**The recall trap.** Querying a single H3 cell silently misses everything just over the boundary. Always use `h3_grid_disk(cell, k)` with a `k` sized to the search radius, then filter precisely with `ST_DWithin`. A user near a cell edge who sees fewer results than a user in a cell centre is a bug that will not crash, will not error, and will not appear in tests unless the boundary case is written explicitly. It is [TC-GEO-07](../04-testing/03-geospatial-test-plan.md).

---

## 8. Egress controls — where leaks actually happen

The database is the well-defended part. Real-world location leaks come from the boring edges.

| Vector | Control |
| --- | --- |
| **Photo EXIF** | Stripped server-side in an Edge Function on Storage upload. `media_assets.exif_stripped_at IS NULL` makes the asset unreadable through every RLS policy, so an unprocessed image can never be served. |
| **Sentry breadcrumbs** | `beforeSend` scrubber deletes any key matching `/lat|lng|latitude|longitude|coord|point|geohash|h3_r[89]/i` at any depth, and redacts emails and tokens. Tested by firing a synthetic event containing a coordinate and asserting it is absent from the payload. |
| **PostHog events** | Wrapper rejects any property that parses as a coordinate. Spatial properties are capped at H3 r5. |
| **Notification payloads** | `CHECK` constraint on `notifications.payload` forbidding `lat`/`lng`/`point`/`coordinates` keys. |
| **Audit metadata** | Same `CHECK` on `audit.events.metadata`. |
| **Push notification body** | Notification copy is templated; templates are reviewed and cannot interpolate a location. |
| **Support screenshots** | Moderation console never renders exact points; screenshots are therefore safe by construction. |
| **CSV / analytics export** | Export tooling runs as a role with no `private` access. Growth experiments get H3 r5. |
| **Deep links** | No route accepts or emits a coordinate parameter. |
| **Error messages** | Postgres exception messages are mapped to codes before reaching the client; raw messages could contain row data. |

> These one-line policies protect the crown jewels and are easy to regress. Each has an automated test; see [Test Strategy §7](../04-testing/01-test-strategy.md).

---

## 9. Device permission policy

| Permission | When requested | Justification shown | Background? |
| --- | --- | --- | --- |
| Location — while in use | At garden registration, and again at first map open | "To place your garden and show you what's available nearby." | — |
| Location — **background** | **Never in MVP** | — | **No.** Requesting background location triggers a heavyweight store review, an ongoing justification burden, and a class of privacy risk we have no product need for. Geofenced arrival confirmation is Phase 3 and requires explicit per-exchange opt-in. |
| Camera | At garden verification and photo capture | "To verify your garden and photograph your crops." | — |
| Photo library | **Never for verification** | Garden verification is camera-only; a library import defeats the point. | — |
| Notifications | After the first exchange request is sent | Contextual, never at launch. | — |

If the user denies location, the app remains fully usable: they search by locality name instead, and the map centres on that. Location denial is a first-class supported state, not a dead end.

---

## 10. Break-glass access to exact coordinates

There is exactly one legitimate reason to read `private.garden_locations` outside automated logic: a law-enforcement request or an active safety investigation.

**Procedure:**
1. Two-person authorization — Security owner plus one of Legal or the CTO.
2. Access is via a dedicated `break_glass` role, time-boxed to 60 minutes, provisioned by a script that requires both approvals.
3. Every statement executed under that role writes to `audit.events` with the ticket reference.
4. A notification fires to the whole security channel on role activation. It is not possible to use this quietly.
5. A post-hoc review within 5 business days confirms the access was warranted.

Documented in full in [Runbooks §6](../05-operations/05-runbooks.md).

---

## 11. Verification — how we prove this holds

| # | Check | Where |
| --- | --- | --- |
| LP-01 | No client role has any privilege on schema `private` | pgTAP, runs on every migration |
| LP-02 | Every `SECURITY DEFINER` function that reads `private` is on the reviewed allowlist | CI static check over `supabase/migrations/**` |
| LP-03 | No function returning a client-reachable type has a `geography` column sourced from `private` | CI static check |
| LP-04 | `display_point` is ≥ 400 m and ≤ 1200 m from `exact_point`, for 10,000 generated gardens | pgTAP property test |
| LP-05 | **Quantization invariance:** the same garden read 1,000 times yields byte-identical `display_point` | pgTAP |
| LP-06 | **Averaging resistance:** mean of 1,000 reads is > 400 m from the true point | pgTAP |
| LP-07 | Bearing distribution over 10,000 gardens is uniform (χ² over 36 bins, p > 0.01) | pgTAP |
| LP-08 | Telemetry scrubber removes coordinates from a synthetic Sentry event | Jest |
| LP-09 | EXIF is absent from every stored asset, verified on a real geotagged JPEG | Integration |
| LP-10 | Scheduled production canary: synthetic user A cannot read user B's garden by any means | Cron, alerts on failure |
| LP-11 | `notifications.payload` and `audit.events.metadata` reject coordinate keys | pgTAP |
| LP-12 | Cell-boundary recall: a point 10 m inside a cell edge returns spots in the adjacent cell | pgTAP |

**LP-10 is the important one.** Every other check verifies the system we intended to build. LP-10 verifies the system we actually deployed, continuously, in production.

---

## 12. Residual risk

Stated honestly:

1. **A determined attacker who completes an exchange learns roughly where the counterparty travels from**, through conversation and observation. We cannot prevent people from telling each other things. Safe spots limit this to "somewhere within a few miles."
2. **Users will share their address in chat.** `content-scan` flags it, but flagging is not prevention. If the rate is high, the friction we've added isn't buying the safety we think it is — tracked as [R-09](../06-roadmap/02-open-risks.md).
3. **A malicious insider with production database access can read exact points.** Break-glass auditing makes it detectable, not impossible. Reducing this further requires application-level encryption with a key we don't hold, which breaks proximity queries entirely. Accepted, documented, revisit at scale.
4. **Timing and count side channels.** An attacker who repeatedly queries `safe_spots_near` from varying origins while a target's listing is active can narrow the target's location to the intersection of their safe-spot choices — realistically a few square kilometres. Mitigated by the 200-row cap, per-user rate limits on the RPC, and the fact that listings attach to up to three spots. Not eliminated.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Architecture + Security | Initial location privacy architecture |
