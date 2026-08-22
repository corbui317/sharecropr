# EPIC-01 Map Spike — Go / No-Go Decision

**Status:** **RESET — spike must be re-run on MapLibre** · **Stories:** SCR-0101…0104 · **Owner:** Mobile Engineering  
**Trace:** [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md), [R-04](../06-roadmap/02-open-risks.md), [N-01](02-development-notes.md#n-01--do-the-map-spike-first-and-mean-it)

---

> ## ⚠️ This spike has been reset
>
> [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) moved the renderer from `react-native-maps` to `@maplibre/maplibre-react-native` over self-hosted OpenStreetMap vector tiles, superseding [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md).
>
> **Any earlier result recorded in this document validated a stack we are no longer shipping.** Do not carry it forward, and do not let a remembered "the spike passed" justify skipping this. Port the spike (**4–6 engineer-days**), then re-run every criterion below.
>
> **The failure surface has moved.** Marker count is no longer the concern — MapLibre renders 200 symbols from a single GeoJSON source as GPU layers, so what used to be 200 bridge crossings is now one source update. The two open questions are **New Architecture interop at our SDK version** and **style complexity** (label collision, sprite count, glyph loading), neither of which the old spike exercised at all. A spike that only re-measures marker count has not tested the thing that is actually unvalidated.

## Decision

| Field | Value |
| --- | --- |
| **Outcome** | `GO` / `NO-GO` — *fill after physical device profiling* |
| **Library** | `@maplibre/maplibre-react-native` under `MapCanvas` seam |
| **Basemap** | Self-hosted Protomaps PMTiles archive on Cloudflare R2 ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)) |
| **New Architecture** | Enabled (`newArchEnabled: true`) |
| **Expo SDK** | 57 / RN 0.86 |
| **Fallback if NO-GO** | [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md) `react-native-maps` behind the same seam — **~3 days, the code already exists** |

---

## Test environment

| Platform | Device | OS | Tester | Date |
| --- | --- | --- | --- | --- |
| Android (reference) | *e.g. Pixel 6a / 3-yr mid-range* | | | |
| iOS | *e.g. iPhone 12* | | | |

> **Simulators are insufficient for SCR-0103.** Profile on physical hardware.

---

## SCR-0101 — 200 clustered custom markers

| Criterion | Pass? | Notes |
| --- | --- | --- |
| 200 markers load around metro centre | | |
| Symbols render from **one `ShapeSource` + `SymbolLayer`** (glyph + count badge), not per-marker views | | |
| `supercluster` clusters at zoom out (`minPoints: 3`) — client-side, per [SPEC-008-R21](../03-specs/SPEC-008-interactive-map.md) | | |
| MapLibre's **built-in** source clustering is confirmed **disabled** (R70) | | |
| Cluster badge shows summed `listing_count` | | |
| Label collision behaves at high marker density — no overlap, no flicker | | |
| Sprite sheet and glyph ranges load without a visible pop | | |
| iOS visual check | | |
| Android visual check | | |
| **Rendering is visually identical across platforms** (the point of ADR-0019) | | |

### SCR-0101b — Basemap, tiles, and attribution

| Criterion | Pass? | Notes |
| --- | --- | --- |
| Tiles load from the PMTiles archive over HTTP range requests | | |
| No tile request carries an API key, token, or user identifier | | |
| Every tile host is Sharecropr-controlled (network trace inspected) | | |
| **ODbL attribution renders and is not obscured** in every map state | | |
| Tile failure degrades to neutral background with markers still positioned and tappable | | |
| Time-to-first-tile recorded | | |
| Map is pannable and tappable **before** first tile paints | | |

---

## SCR-0102 — Avatar + follow mode

| Criterion | Pass? | Notes |
| --- | --- | --- |
| Avatar dot renders at user location | | |
| Pan/pinch sets `following = false` (gesture flag) | | |
| Recentre restores follow without self-clearing | | |
| Location update with follow on animates camera ~200 ms | | |
| Location update with follow off moves avatar only | | |
| `following` in Zustand (not React state) | ✓ | Implemented |

---

## SCR-0103 — Performance profiling

Record using in-app **Record FPS** control, then **Export trace**. Attach JSON here or in `spike-traces/`.

| Metric | Budget (NFR-03 / EPIC-01 AC) | Measured | Pass? |
| --- | --- | --- | --- |
| Sustained FPS during pan | ≥ 60 fps | | |
| Sustained FPS during pinch zoom | ≥ 60 fps | | |
| Sustained FPS during cluster expansion | ≥ 60 fps | | |
| Max frame time | ≤ 32 ms (no frame > 32 ms per SPEC-008 R53) | | |
| Memory steady state | < 250 MB (NFR-09) | | |
| Cluster recompute (integer zoom step) | < 8 ms | | |

### Profiler traces

```
Paste exported JSON or link to spike-traces/ file:
```

---

## SCR-0104 — Decision and next steps

### If GO

- ADR-0019 stands. OSM/MapLibre is the shipping stack.
- Carry `MapCanvas`, `useMapMarkers`, `useFollowMode` into EPIC-11.
- Proceed with EPIC-00 / EPIC-02 per [sprint plan](../06-roadmap/03-delivery-backlog.md).

### If NO-GO

**Revert the renderer, keep everything else.** This is the cheap direction, which is why the seam exists.

1. Fall back to [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md)'s `react-native-maps` behind the same `MapCanvas` seam — **~3 days**, since that implementation already exists in git history.
2. Mark ADR-0019 `Superseded`, with the spike result as the reason. Record what failed specifically; "MapLibre didn't work" is not a finding a future engineer can act on.
3. **[ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) is unaffected.** The OSM safe-spot pipeline is server-side and renderer-independent. Do not unwind it — it is the change with the clearest operational payoff ([R-02](../06-roadmap/02-open-risks.md)).
4. **[ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md) becomes moot** for the basemap; the tile pipeline is shelved rather than deleted, since a future retry would want it.
5. Re-estimate EPIC-11 before pulling; restore the ODbL attribution obligation only where OSM-derived *spot data* is still shown.

---

## Implementation notes (code spike)

- Spike screen: `src/features/map/screens/MapSpikeScreen.tsx`
- **`@maplibre/maplibre-react-native` isolated to:** `src/features/map/components/MapCanvas.tsx` (lint-enforced — the rule now bans `@maplibre/*` outside the seam, and continues to ban the old renderers everywhere)
- Style JSON: versioned in-repo, pointing at an explicit dated PMTiles archive
- Synthetic data: `src/domain/geo/spikeData.ts` (200 spots, deterministic seed)
- Clustering: `supercluster` per SPEC-008 R21 — **client-side**, and MapLibre's built-in clustering stays off (R70)

> **Porting note.** `Region` (`latitudeDelta`/`longitudeDelta`) does not survive the swap and becomes `Camera` (`center` + `zoom`). [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md)'s steel-man predicted exactly this, which is the honest reason the port costs days rather than hours.

---

## Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Mobile lead | | |
| Architecture | | |
