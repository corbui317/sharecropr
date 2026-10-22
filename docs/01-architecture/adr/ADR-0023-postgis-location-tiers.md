# ADR-0023: PostGIS location tiers (H3 removed)

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-22 |
| **Deciders** | Corey (owner), Architecture, Security (review approved by Corey, 2026-10-22) |
| **Supersedes** | [ADR-0005](ADR-0005-geospatial-model.md) |
| **Superseded by** | — |

## Context

[ADR-0005](ADR-0005-geospatial-model.md) chose a dual model: PostGIS `geography` for distance and H3 (`h3-pg`) for bucketing, with three named resolutions (r5 analytics, r7 exposed to the owner and server logic, r9 internal only). Its own dissent argued that PostGIS alone would do.

On 2026-10-22 the first real CI runs against Supabase's own Postgres image (db.yml runs 39803696654 and 39804036046, CLI 2.120.0) both failed at the first migration:

```
Applying migration 20260822_0001_baseline.sql...
ERROR: extension "h3" is not available (SQLSTATE 0A000)
At statement: 13
```

`h3` is not in Supabase's extension list. The earlier local harness had it only because it was installed by hand. ADR-0005's own revisit trigger, "Supabase drops or fails to upgrade `h3-pg`", was therefore true from the start.

Corey decided (D1, D2, 2026-10-22): drop H3, PostGIS only; and edit never-applied migrations in place, because no migration has applied anywhere (CI stopped at the first file and no hosted project is linked). The change is therefore a set of edits, not a data migration ([Data Model §15](../03-data-model.md#15-migration-rules) rule 12).

What must survive from ADR-0005:

- a named, auditable resolution per purpose;
- an internal tier that is never exposed;
- the analytics ceiling;
- the mechanical forbidden-column and egress checks.

## Decision

1. **Geography is the only spatial representation.** Distance and matching use `ST_DWithin` / `ST_Distance` on `geography` with GiST indexes. **No cell is ever used to select proximity candidates.**
2. **Named location tiers**, computed in the database by `app.location_cell(point, tier)`:

   | Tier | Cell | Area | Replaces | Purpose | Exposure | Stored |
   | --- | --- | --- | --- | --- | --- | --- |
   | region | 16 000 m | 256 km² | r5 ~253 km² | analytics and heatmaps; ceiling for anything analytical | yes (aggregates, PostHog `region_cell`) | not stored |
   | coarse | 2 500 m | 6.25 km² | r7 ~5.2 km² | coarse labels, surplus-alert origin | owner and server logic | `gardens.coarse_cell`, `profiles.home_coarse_cell` |
   | fine | 320 m | 0.10 km² | r9 ~0.105 km² | internal bucketing in definer functions | **never** | `gardens.fine_cell` |

   Each tier is at least as coarse as the H3 resolution it replaces, in area and in its smallest ground dimension.

   **Decided (Corey, 2026-10-22):** the tier sizes (region 16 km, coarse 2.5 km, fine 320 m) stand, including the exposable coarse tier.

3. **The grid.**
   - Banded equal-area square grid on the mean-radius sphere (R = 6 371 008.8 m; 1° of latitude = 111 195.08 m). `row = floor((lat+90)/h)` with `h = side/111195.08`. The column width is set per row from the row-centre latitude, and `col = floor((lng+180)/w)`.
   - The id is `side:row:col`.
   - Properties: deterministic, IMMUTABLE pure arithmetic, so a PROJ or `spatial_ref_sys` upgrade cannot move a cell. Cells are about side × side everywhere. The id carries its own resolution, which lets a CHECK pin each column to its tier.
   - Limits: rows are offset like brickwork; tiers do not nest, so roll-ups recompute from `exact_point` inside the database; the antimeridian column is partial; cells widen near the poles.

4. **Why not `ST_SnapToGrid`.**
   - On degrees, the cell width shrinks with cos(lat): at 42°N it is 1.86 km east-west for 2.5 km north-south, 26% less area.
   - Per-point cos-corrected snapping (the approach in `app.quantize_lat_lng`) is not a partition. That is fine for a transient query origin and wrong for a stored label.
   - `ST_Transform` to EPSG:6933 plus `SnapToGrid` is equal-area but the cells are 1.17x / 0.86x at 42°N and 2x / 0.5x at 60°N, so the smallest dimension shrinks. It also depends on `spatial_ref_sys` and PROJ.

5. **Enforcement.**
   - Trigger-only writes; the 42501 reject trigger; no client INSERT/UPDATE grants on the cell columns.
   - A per-tier CHECK on each column.
   - `fine_cell` is column-revoked, swept by `location_tiers` N5, and named in the planned `ci:assert-no-forbidden-columns`.
   - Egress deny-lists: `h3_r[89]` becomes `fine_cell`; route params reject `_cell`.
   - The PostHog wrapper accepts only a `region_cell` matching `^16000:`.
   - The tier functions are not client-executable, and an unknown tier raises 22023.
   - Nightly `private.check_location_tiers()` raises on drift and reports a count only.

### LP-01…LP-13 under this ADR

| LP | Under ADR-0005 | Under ADR-0023 | Where asserted |
| --- | --- | --- | --- |
| LP-01 | No client privilege on `private` | Unchanged | location_privacy LP-01, structural_sweeps |
| LP-02 | Definer allowlist | Unchanged. New definer that reads `private`: `private.check_location_tiers` (add it when the allowlist is built, WP-13/WP-19). `location_cell` is not a definer and reads nothing | `ci:assert-definer-allowlist` (stub) |
| LP-03 | No client function returns private geography; `h3_r9` forbidden column | Unchanged; the forbidden-column sweep now names `fine_cell`, `exact_point`, `fuzz_seed` | location_privacy LP-03; location_tiers N5 |
| LP-04…07 | Fuzz band, stability, averaging, bearing | Unchanged (`display_point` is untouched) | location_privacy |
| LP-08 | Sentry regex `h3_r[89]` | `fine_cell` | Jest (`skip('SCR-1701…')` in pgTAP) |
| LP-09 | EXIF | Unchanged | SCR-0604 |
| LP-10 | Canary `FORBIDDEN_KEY` `h3_r[89]` | `fine_cell` | packages/location-canary |
| LP-11 | jsonb key CHECK `h3_r[89]` | `fine_cell` | location_privacy LP-11; location_tiers N9 |
| LP-12 | Cell-boundary recall (disk sizing) | Radius recall: no cell pre-filter; a spot 10 m across a coarse-cell edge is returned | `skip('SCR-0804…')` until safe_spots exist |
| LP-13 | API response sweep | Unchanged; forbidden names `fine_cell`, `exact_point`, `fuzz_seed` | WP-19 |

New database-enforced controls: per-tier CHECK constraints (location_tiers N2–N4), tier sizes asserted (P1, P4–P6), tier functions not client-callable (N6), nightly drift job (P7, N12).

## Alternatives considered

- **Keep H3 via self-hosting or a support request.** Not available on managed Supabase, which contradicts [ADR-0004](ADR-0004-supabase.md).
- **`h3-js` in Edge Functions.** Puts spatial logic outside the database ([ADR-0003](ADR-0003-database-centric-authz.md)), and a derivation outside the trigger is skippable.
- **Geohash.** The ADR-0005 reasoning still holds.
- **`ST_SnapToGrid` variants.** As in Decision 4.
- **No tiers at all.** The dissent's extreme. Rejected by D1, which keeps the ladder.

## Consequences

**Positive**

- One spatial representation.
- The boundary-recall bug class is gone.
- No extension beyond PostGIS.
- The resolution is in the value, and CHECK constraints pin it.

**Negative**

- A bespoke grid we own (covered by `location_tiers` P1–P6).
- No hierarchy.
- `fine_cell` has no consumer yet.
- SPEC-020 surplus matching must be re-specified.

**Accepted**

- The coarse cell is about 20% larger than r7, so surplus targeting is slightly coarser.

## The strongest argument against

We replaced a documented, widely reviewed index with about 20 lines of our own arithmetic, in the one place where a silent error is a stalking risk. The grid has no hierarchy, so every aggregate must be recomputed next to `exact_point`. And keeping `fine_cell`, a 320 m box around a home with no consumer, is privacy cost kept only to preserve the shape of a ladder.

The counter-argument: the arithmetic is small, pure and pinned by pgTAP (sizes at 42°N and 60°N, CHECK prefixes, the nightly drift job); an error in a coarser-than-before label cannot expose a coordinate, because the exact point never leaves `private`; and the ladder is what makes each purpose auditable by name. **Decided (Corey, 2026-10-22):** `fine_cell` stays. It is kept to preserve the ladder, never exposed, and revisitable by a later ADR.

## Revisit when

- p95 of `safe_spots_near` exceeds 400 ms on GiST. Profile first; any cell pre-filter must be verified with `ST_DWithin` and pass LP-12.
- The drift check reports anything above 0.
- A feature needs a tier hierarchy or rendered cells.
- We have users beyond ±60° latitude or a metro on the antimeridian.
- Supabase shipping h3 is **not** a trigger on its own.

## Security review

Approved by Corey (owner) on 2026-10-22, covering this ADR and the matching changes to [Location Privacy](../04-location-privacy.md) 1.1.0 and [RLS Design](../05-rls-design.md) 1.2.0. Merge of WP-DB-BASELINE is gated on this approval plus a green `db.yml` run.

## Related

[ADR-0003](ADR-0003-database-centric-authz.md), [ADR-0004](ADR-0004-supabase.md), [ADR-0005](ADR-0005-geospatial-model.md), [Location Privacy](../04-location-privacy.md) §3/§4/§7/§11, [Data Model](../03-data-model.md) §6/§15.
