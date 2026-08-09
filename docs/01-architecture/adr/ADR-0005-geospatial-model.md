# ADR-0005: Dual geospatial model — PostGIS `geography` plus H3

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Three different questions in this product are spatial, and they have genuinely different requirements.

1. **"How far is this safe spot from me?"** — needs true distance in metres, correct across latitudes, sortable. This is a continuous-geometry problem.
2. **"Which gardens are roughly near this one?"** — needs cheap bucketing for matching and surplus-alert targeting, at a resolution the server may use but the client must never see.
3. **"Where are people active?"** — needs coarse aggregation for analytics and heatmaps, at a resolution where no individual is identifiable.

A single system answers all three badly. Pure PostGIS answers (1) perfectly, but (2) becomes a `ST_DWithin` self-join over every garden pair, and (3) requires choosing arbitrary bins that overlap awkwardly and leak resolution. Pure H3 answers (2) and (3) cleanly but cannot answer (1) — a cell index gives you adjacency, not metres, and sorting safe spots by cell distance produces visibly wrong ordering.

The privacy model makes this sharper than a normal engineering trade-off. [Location Privacy](../04-location-privacy.md) requires that nothing leaves the database from which a garden's position can be derived to better than ~1 km. That means the resolution at which we *compute* proximity and the resolution at which we *expose* anything must be different numbers, structurally separated, with the finer one unreachable. A single spatial representation makes that separation a matter of remembering to filter. Two representations, with per-resolution rules, make it a matter of which column is in which schema.

We also know the specific bug this will produce. H3 cell lookups silently under-return at boundaries: a garden 10 m over a cell edge is invisible to a query that checks one cell. It does not error, does not crash, and does not appear in any test that happens to place its fixtures near cell centres.

## Decision

**Store and use both. PostGIS `geography(Point, 4326)` is the source of truth for position and the only thing used for distance. H3 cells are derived, used for bucketing and aggregation, and governed by strict per-resolution exposure rules.**

### Representation

```sql
-- Truth. Never client-reachable.
private.garden_locations.exact_point  geography(Point,4326)

-- Derived, on public.gardens, all written by trigger:
display_point  geography(Point,4326)  -- fuzzed 400–1200 m, deterministic per garden
h3_r7          text                   -- ~5 km²   — exposable
h3_r9          text                   -- ~0.1 km² — internal only, never exposed

-- Public infrastructure. Precise, because it is a public building.
public.safe_spots.point  geography(Point,4326)
```

`geography`, not `geometry`, everywhere: distance comes back in metres on a spheroid with no projection choice to get wrong. We never pick an SRID per metro.

### Resolution rules

| Resolution | Approx. area | Purpose | Exposed to client? |
| --- | --- | --- | --- |
| **H3 r5** | ~250 km² | Analytics, heatmaps, PostHog spatial properties | **Yes** — and this is the ceiling for anything analytical |
| **H3 r7** | ~5 km² | Coarse matching, surplus-alert targeting, `profiles.home_h3_r7` | **Yes**, to the owner and to server logic |
| **H3 r9** | ~0.1 km² | Internal proximity bucketing inside definer functions | **Never.** On the forbidden-column CI list |
| PostGIS `geography` | exact | Distance maths inside `SECURITY DEFINER` functions; safe-spot distance | Only safe-spot coordinates |

Enforcement: `h3_r9` appears in the CI forbidden-column check; no view, RPC return type, or PostgREST-reachable selection may include it. The PostHog wrapper rejects any spatial property finer than r5 ([Location Privacy §8](../04-location-privacy.md#8-egress-controls--where-leaks-actually-happen)).

### The query pattern — mandatory

Never query a single cell. Always **disk, then filter**:

```sql
-- H3 narrows the candidate set cheaply; PostGIS decides correctness.
WITH origin AS (
  SELECT h3_lat_lng_to_cell(ST_MakePoint(p_lng, p_lat), 9) AS cell,
         ST_MakePoint(p_lng, p_lat)::geography          AS pt
)
SELECT g.id
  FROM origin o
  JOIN public.gardens g
    ON g.h3_r9 = ANY (
         SELECT c::text FROM h3_grid_disk(o.cell, app.k_for_radius(9, p_radius_m)) c
       )
 WHERE ST_DWithin(g.display_point, o.pt, p_radius_m);
```

`app.k_for_radius(resolution, metres)` computes the ring size from the radius and is the only sanctioned way to pick `k`. A hand-written `k` in a migration fails review.

Derived columns are written **only** by `private.sync_garden_derived_location()` on insert or update of `exact_point`, and client writes to them raise `42501` ([Location Privacy §4.3](../04-location-privacy.md#43-the-trigger-that-makes-it-unskippable)).

## Alternatives considered

### PostGIS alone

**What it is.** GiST index on `geography`, `ST_DWithin` for everything, no H3.

**Why we didn't.** Two problems. Matching and surplus alerts become O(n²)-ish proximity joins that we would end up bucketing anyway — badly, with ad-hoc grids. And analytics has no natural aggregation unit: rounding coordinates to decimal places produces rectangles that vary in area with latitude, and choosing a rounding precision is a privacy decision made by whoever writes the query rather than by policy. H3 gives us a named, auditable resolution ladder that a reviewer can check against a table.

### H3 alone

**What it is.** Store cells only; approximate distance from cell centroids.

**Why we didn't.** Distance is a first-class UX element — the map sorts safe spots by distance and shows metres. Cell-centroid distance is wrong by up to a cell radius, which at r9 is fine and at r7 is a visible lie. It also throws away the exact point we legitimately need inside definer functions.

### Geohash instead of H3

**What it is.** String-prefix hierarchical bins; trivially available everywhere.

**Why we didn't.** Geohash cells are rectangles that distort badly with latitude, and prefix-based neighbours are non-uniform — the eight neighbours of a cell are not all the same distance away, so ring queries are lopsided. H3's hexagons have uniform neighbour distance, which is what makes `h3_grid_disk` a defensible approximation of a circle. Geohash's only real advantage, prefix truncation for coarsening, we get from `h3_cell_to_parent`.

### S2 cells

**What it is.** Google's spherical quadtree, excellent library support.

**Why we didn't.** Comparable quality; no Postgres extension on Supabase. Doing S2 in application code would put spatial logic outside the database, which contradicts [ADR-0003](ADR-0003-database-centric-authz.md).

## Consequences

### Positive

- Each question is answered by the system suited to it: metres from PostGIS, buckets from H3.
- The resolution ladder makes privacy reviewable. "Is r9 in this return type?" is a question a reviewer can answer mechanically; "is this coordinate precise enough to be a problem?" is not.
- `h3_r9` in a `private`-adjacent, never-exposed column gives matching real precision without any exposure of it.
- H3 disks prune candidate sets before PostGIS does exact distance, keeping the map RPC inside its 400 ms budget.
- Analytics capped at r5 by construction; there is no query that could accidentally emit finer.

### Negative

- **Two representations that can disagree.** If a trigger fails or a backfill is partial, `h3_r9` and `exact_point` describe different places, and the symptom is missing results rather than an error.
- The boundary-recall trap is real and will bite at least once ([System Architecture §10](../01-system-architecture.md#10-known-architectural-weaknesses) item 4 says so explicitly).
- `h3-pg` is a smaller-community extension than PostGIS; an upgrade path is a dependency on Supabase installing it.
- Developers must learn two mental models and know which applies where.

### Neutral / accepted costs

- Extra storage: two text columns and an index per garden. Negligible.
- Every garden location write does three derivations in a trigger. Writes are rare; reads are hot. Correct trade.
- `k` selection is a function, not a literal, which makes some queries slightly harder to read.

## The strongest argument against this decision

You do not need H3. PostGIS with a GiST index will answer "gardens within 8 km" at our scale in single-digit milliseconds, and it will answer it *exactly*, with no boundary trap, no second column to keep in sync, and no `k`-selection function anyone has to reason about. The H3 layer exists to prune a candidate set that is not large enough to need pruning — two metros, low six figures of users, one garden per user. We have introduced a second spatial representation, a second index, a derived-column consistency problem, a new extension dependency, and a class of silent under-reporting bug that we have already predicted in writing, in exchange for an optimization whose benefit is unmeasured at our actual data volume. The privacy argument for H3 is also weaker than it looks: the r5 analytics cap could be achieved by rounding coordinates or by using PostGIS `ST_SnapToGrid`, and the r9 internal bucket is doing work `ST_DWithin` already does correctly. When the boundary bug ships — and it will, because it does not error and does not appear in centre-of-cell fixtures — a user near a cell edge will quietly see fewer listings than their neighbour across the street, they will not report it because they have nothing to compare against, and we will find it months later while debugging something else. That is a worse failure than the performance problem H3 was added to prevent.

The counter is that the resolution ladder is genuinely load-bearing for privacy review — a named r-value is auditable in a way that "we rounded to three decimals" is not, and the forbidden-column check on `h3_r9` is a mechanical control that a coordinate column cannot have. But if we are honest, we would adopt H3 *later*, on evidence, if we were making this call purely on engineering grounds.

## Revisit when

- p95 latency on `safe_spots_near` exceeds **400 ms** — the H3 prune should be the first thing profiled, and if it is not helping, remove it rather than tune it.
- The boundary-recall test [TC-GEO-07](../../04-testing/03-geospatial-test-plan.md) fails, or a user-reported "missing nearby listings" issue is traced to cell selection.
- A consistency check finds any garden where `h3_r9 <> h3_lat_lng_to_cell(exact_point, 9)`. This should be **zero**, checked nightly.
- Benchmarks at **10× launch volume** show the H3 prune saving less than **20%** of query time — at which point the simpler PostGIS-only model wins and this ADR should be superseded.
- We expand beyond two metros to a footprint where cross-metro queries become common, or add a country where the coordinate density assumptions change.
- Supabase drops or fails to upgrade `h3-pg`.

## Related

- [ADR-0003 Database-centric authz](ADR-0003-database-centric-authz.md), [ADR-0004 Supabase](ADR-0004-supabase.md), [ADR-0013 Map library](ADR-0013-map-library.md)
- [Location Privacy §3, §6, §7](../04-location-privacy.md), [Data Model §6, §9](../03-data-model.md), [System Architecture §10](../01-system-architecture.md#10-known-architectural-weaknesses)
