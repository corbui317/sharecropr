# Geospatial Test Plan

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Backend + Security

Geospatial bugs in this system fail in two directions, and both are silent:

- **Privacy direction** — the fuzzing is weaker than believed, and a location leaks.
- **Recall direction** — a cell-boundary or projection error means some users see fewer results than others, with no error and no crash.

The privacy direction is catastrophic. The recall direction quietly makes the product worse for a subset of users and will never appear in a bug report, because nobody knows what they didn't see.

---

## 1. Environment

Real PostGIS 3.4 and `h3-pg` in the Supabase CLI stack. No mocks — spherical geometry is exactly the sort of thing a mock gets subtly wrong.

Test data spans latitudes deliberately: **0°, 25°, 42°, 60°, 71°**. Anything relying on a flat-earth approximation passes at 42° and fails at 71°, so the northern cases are not optional.

---

## 2. Fuzzing invariants

The controls in [Location Privacy §4](../01-architecture/04-location-privacy.md). These are the highest-priority tests in the entire suite.

### TC-GEO-01 — Offset within band

Across 10,000 generated gardens spanning all test latitudes, every `display_point` is between **400 m and 1200 m** from its `exact_point`.

```sql
SELECT is(
  (SELECT count(*) FROM tests.generated_gardens g
     JOIN private.garden_locations l ON l.garden_id = g.id
    WHERE ST_Distance(l.exact_point,
                      app.derive_display_point(l.exact_point, l.fuzz_seed))
          NOT BETWEEN 400 AND 1200)::int,
  0, 'GEO-01: every fuzzed point is 400-1200m from truth, at every latitude');
```

A naive implementation using degree offsets passes at the equator and produces a ~400 m offset at 60° latitude. This test is what catches that.

### TC-GEO-02 — Quantization invariance

The same garden read 1,000 times produces **byte-identical** output.

```sql
SELECT is(
  (SELECT count(DISTINCT ST_AsBinary(app.derive_display_point(l.exact_point, l.fuzz_seed)))
     FROM private.garden_locations l, generate_series(1, 1000)
    WHERE l.garden_id = tests.fixture('garden_a'))::int,
  1, 'GEO-02: 1000 reads produce exactly one distinct point');
```

### TC-GEO-03 — Averaging resistance

The direct consequence of GEO-02, tested explicitly because it is the actual attack ([THR-02](../02-security/01-threat-model.md)):

```sql
WITH samples AS (
  SELECT app.derive_display_point(l.exact_point, l.fuzz_seed) AS p, l.exact_point AS truth
    FROM private.garden_locations l, generate_series(1, 1000)
   WHERE l.garden_id = tests.fixture('garden_a')
)
SELECT ok(ST_Distance(ST_Centroid(ST_Collect(p::geometry))::geography, MIN(truth)) > 400,
          'GEO-03: mean of 1000 samples remains >400m from the true point')
  FROM samples;
```

> If someone ever "fixes" the fuzzing to be non-deterministic — a perfectly reasonable-sounding change — GEO-02 fails immediately and GEO-03 explains why it matters. These two tests are the institutional memory for a subtle attack.

### TC-GEO-04 — Bearing uniformity

χ² over 36 ten-degree bins across 10,000 gardens, p > 0.01. A fixed or clustered bearing lets an attacker subtract the offset direction.

### TC-GEO-05 — Radial uniformity

Distances follow `min + (max−min)·√u`, not `min + (max−min)·u`. Without the square root, points cluster toward the inner radius, and the *expected* distance from truth is meaningfully smaller than it appears. Verified by a Kolmogorov–Smirnov test against the intended distribution.

### TC-GEO-06 — Reseed on relocation only

Updating `exact_point` recomputes `display_point`; updating any other garden column does not. A display point that drifts while the garden is stationary hands an attacker multiple samples.

### TC-GEO-16 — Fuzz seed is never emitted

`fuzz_seed` appears in no view, no function return type, and no API response. With the seed and the algorithm, the offset is invertible and the whole scheme collapses.

---

## 3. Cell-boundary recall

The bug this section exists to prevent: a user 10 m from an H3 cell edge sees fewer nearby safe spots than a user in the middle of a cell, forever, silently.

### TC-GEO-07 — Boundary recall

For each of 500 points placed 10 m inside a cell boundary, `safe_spots_near` returns **every** spot within the radius, including those in the adjacent cell.

```sql
-- The failure mode this catches: querying one cell instead of a disk.
SELECT is(
  (SELECT count(*) FROM tests.boundary_points bp
    WHERE (SELECT count(*) FROM public.safe_spots_near(bp.lat, bp.lng, 5000))
        < (SELECT count(*) FROM public.safe_spots s
            WHERE ST_DWithin(s.point, bp.geog, 5000) AND s.status = 'active'))::int,
  0, 'GEO-07: boundary points suffer no recall loss');
```

### TC-GEO-08 — Disk sizing

`h3_grid_disk(cell, k)` is called with a `k` large enough for the requested radius at that resolution. Asserted for radii 2, 8, 20, and 40 km. An under-sized `k` produces exactly the silent under-fetch GEO-07 detects; this test names the cause.

### TC-GEO-09 — Antimeridian and poles

Queries at ±179.99° longitude and above 80° latitude return correct results. Nobody gardens at the pole, but a coordinate-parsing bug that sends a query there should error visibly rather than return an empty set that looks like "nothing nearby."

### TC-GEO-10 — Resolution discipline

- `h3_r7` may appear in client-facing output.
- **`h3_r9` may not**, in any view, function return type, or API response.
- Analytics events carry no cell finer than r5.

Enforced by a catalogue sweep plus a response-body regex over every endpoint in the [API contract](../01-architecture/06-api-contract.md).

---

## 4. Distance and projection correctness

### TC-GEO-11 — Geography, not geometry

Every spatial column is `geography(Point,4326)`. A `geometry` column with an SRID of 4326 computes distance in **degrees**, and `ST_DWithin(point, point, 8000)` then means "within 8000 degrees" — which returns the entire planet, silently, and looks like a working feature until someone notices the map is showing listings from three states away.

```sql
SELECT is(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema IN ('public','private')
      AND udt_name = 'geometry')::int,
  0, 'GEO-11: no geometry columns exist — geography only');
```

### TC-GEO-12 — Distance accuracy

`ST_Distance` on geography against known great-circle distances between reference city pairs, tolerance 0.1%. Catches an accidental switch to a planar calculation.

### TC-GEO-13 — Radius cap

A request for 500 km is clamped server-side to 40 km. Verified by result-set extent, not by inspecting the parameter — the clamp must be in the function, not in the client.

### TC-GEO-14 — Row cap

`safe_spots_near` never returns more than 200 rows, and the returned set is the 200 **nearest**, not an arbitrary 200. A cap applied before ordering is a subtle correctness bug that makes the map look randomly incomplete.

### TC-GEO-15 — Index usage

`EXPLAIN` confirms `safe_spots_gix` is used and no sequential scan appears on `safe_spots` or `gardens`. A GiST index that silently stops being used turns a 20 ms query into a 4 s one at scale.

---

## 5. Result-shape safety

The structural guarantee from [Location Privacy §6](../01-architecture/04-location-privacy.md): the proximity RPC has no column that could carry a user coordinate.

| # | Assertion |
| --- | --- |
| TC-GEO-17 | `safe_spots_near`'s `RETURNS TABLE` contains no `geography`/`geometry` column and no column sourced from `gardens` or `private` |
| TC-GEO-18 | `search_listings` returns no coordinate of any kind |
| TC-GEO-19 | `get_my_garden_location` returns a coordinate **only** for `auth.uid()`'s own garden, and raises `42501` otherwise |
| TC-GEO-20 | A full sweep of every API response body matches no coordinate-shaped pair except from `safe_spots.*` and `get_my_garden_location` |

TC-GEO-20 is the belt-and-braces test: it does not care how a coordinate got into a response, only that none is there.

---

## 6. Performance

| # | Target | Budget | Conditions |
| --- | --- | --- | --- |
| TC-GEO-21 | `safe_spots_near`, 8 km | p95 < 400 ms | 500k listings, 2k safe spots, 200 concurrent |
| TC-GEO-22 | `safe_spots_near`, 40 km max radius | p95 < 900 ms | Same |
| TC-GEO-23 | H3 cell lookup | p95 < 5 ms | — |
| TC-GEO-24 | Fuzz derivation on garden write | p95 < 10 ms | It is on the registration path |
| TC-GEO-25 | Boundary-heavy workload | No worse than p95 + 20% | 500 boundary origins |

TC-GEO-25 exists because the fix for GEO-07 — querying a disk instead of a cell — costs performance, and the fix for *that* is often to shrink the disk, which reintroduces GEO-07. The two tests hold each other honest.

---

## 7. Data quality

| # | Assertion |
| --- | --- |
| TC-GEO-26 | Every active safe spot has a valid point on land in a supported country |
| TC-GEO-27 | No two active safe spots are within 50 m of each other (duplicate detection) |
| TC-GEO-28 | Every safe spot's `h3_r8` generated column matches its point |
| TC-GEO-29 | `hours_verified_at` older than 90 days raises a data-quality alert |
| TC-GEO-30 | Every launch metro has ≥ 40 active safe spots — a [release gate](../00-foundation/02-prd.md) |

---

## 8. Client-side

| # | Assertion | Level |
| --- | --- | --- |
| TC-GEO-31 | The device coordinate is quantized to ~100 m before transmission | unit |
| TC-GEO-32 | Quantization is stable — small GPS jitter does not produce a new query origin | unit |
| TC-GEO-33 | Clustering merges markers correctly and never drops one | unit |
| TC-GEO-34 | Cluster expansion at max zoom reveals every constituent marker | e2e |
| TC-GEO-35 | Map degrades gracefully at 200+ markers per the [degradation ladder](../01-architecture/02-mobile-architecture.md) | manual |
| TC-GEO-36 | No coordinate appears in any analytics event or breadcrumb | unit |

TC-GEO-32 matters more than it sounds: unstable quantization means every GPS tick issues a new query, which is a battery problem, a cost problem, and a much richer side channel for [THR-08](../02-security/01-threat-model.md).

---

## 9. Running the suite

| Suite | When | Duration |
| --- | --- | --- |
| Fuzzing invariants (01–06, 16) | **Every PR** | ~40 s |
| Boundary and recall (07–10) | Every PR | ~30 s |
| Projection and distance (11–15) | Every PR | ~20 s |
| Result shape (17–20) | Every PR | ~15 s |
| Performance (21–25) | Nightly + on any spatial migration | ~6 min |
| Data quality (26–30) | Nightly against production | ~1 min |
| Client (31–36) | Every PR | ~10 s |

The 10,000-garden property tests use a fixed seed so failures are reproducible. Nightly, they run with a random seed as well — a fixed seed proves the implementation works for those 10,000 gardens, which is not quite the same as proving it works.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Backend + Security | Initial geospatial test plan |
