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
| Time-to-first-tile recorded | | See SCR-0103 → Time to first painted tile |
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

> **What counts as evidence.** MapLibre renders on its own GL (Android) / Metal (iOS) thread into a
> SurfaceView / MTKView. The in-app profiler's channels — Reanimated UI-thread frames, JS-thread
> `requestAnimationFrame`, and MapLibre frame-completion events received on the JS thread — are **not GL
> frame times**. `dumpsys gfxinfo` is not either: it covers the hwui UI thread and excludes SurfaceView content.
> **The SCR-0103 acceptance criteria are met only by platform traces:** Perfetto on Android, Instruments on iOS.
> The in-app export is supporting evidence (JS-thread stalls, clustering cost, JS heap) attached alongside.

### How to measure

1. **Build a release build with the profiler compiled in.** Dev builds are not representative.
   `EXPO_PUBLIC_MAP_PROFILER=1 npx expo run:android --variant release` ·
   `EXPO_PUBLIC_MAP_PROFILER=1 npx expo run:ios --configuration Release --device`.
   The map tab sits behind sign-in, so a reachable Supabase auth backend is required.
2. **Confirm tiles actually load** (network trace: range requests to the tile origin succeed). If the PMTiles archive is
   not reachable, "fully rendered" fires on failed tiles and every render number below is invalid.
3. **Android — Perfetto.** Per gesture, a ≥ 30 s trace:
   `adb shell perfetto -o /data/misc/perfetto-traces/map-<gesture>.perfetto-trace -t 30s sched freq gfx view input am wm`
   then `adb pull` it and open in ui.perfetto.dev. Read the MapLibre render thread's frame slices (confirm the thread
   name in the trace) and the SurfaceView layer's buffer cadence in SurfaceFlinger. Record p95 frame time, worst frame,
   and frames > 32 ms. Store traces in `spike-traces/` (create it) as `android-<device>-<gesture>-<date>.perfetto-trace`.
4. **iOS — Instruments.** *Animation Hitches* + *Metal System Trace* per gesture, ≥ 30 s; save the `.trace` alongside.
5. **Memory (NFR-09).** After 60 s of continuous pan: `adb shell dumpsys meminfo com.sharecropr.app` → TOTAL PSS;
   iOS: Instruments *Allocations*/*VM Tracker* or the Xcode memory gauge (physical footprint). The in-app `jsHeap`
   channel is the JS heap only.
6. **In-app export (supporting).** Tap **Record frames**, do the gesture for ≥ 30 s, **Stop recording**, **Export trace**.
   Each channel reports p50/p95/p99 frame ms, frames over 32 ms, dropped frames vs 60 Hz, and per-second window fps
   (`worstWindowFps` is the "sustained" signal). Buffers hold 120 s at 120 Hz. The export contains no coordinates.

### Time to first painted tile (R73)

MapLibre exposes no "first tile painted" event. The canvas records, in ms **from `MapCanvas` mount** (JS receipt time,
so biased late by JS-thread latency):

| Milestone | Event | Meaning |
| --- | --- | --- |
| `styleLoaded` | `onDidFinishLoadingStyle` | Style parsed and applied |
| `firstFrame` | first `onDidFinishRenderingFrame[Fully]` after style load | **Lower bound** for first painted tile |
| `firstFullFrame` | first `onDidFinishRenderingFrameFully` | **Upper bound**: every visible tile rendered |
| `mapFullyRendered` | `onDidFinishRenderingMapFully` | Map idle (the metric previously mislabelled "First tile") |

Run ≥ 20 cold mounts against a warm edge; report nearest-rank p95 of `firstFrame` and `firstFullFrame`.
**Proposed** reporting rule (awaiting mobile lead confirmation; not adopted): R73 is claimed as met only if
**`firstFullFrame` p95 < 1000 ms**; `firstFrame` alone does not show that a tile painted.

| Milestone | p50 (ms) | p95 (ms) | Runs | Pass (< 1000 ms p95)? |
| --- | --- | --- | --- | --- |
| `firstFrame` (lower bound) | | | | n/a |
| `firstFullFrame` (upper bound) | | | | |

| Metric | Budget (NFR-03 / EPIC-01 AC) | Measured | Pass? |
| --- | --- | --- | --- |
| Sustained FPS during pan | ≥ 60 fps | | |
| Sustained FPS during pinch zoom | ≥ 60 fps | | |
| Sustained FPS during cluster expansion | ≥ 60 fps | | |
| Max frame time | ≤ 32 ms (no frame > 32 ms per SPEC-008 R53) | | |
| Memory steady state | < 250 MB (NFR-09) | | |
| Cluster recompute (integer zoom step) | < 8 ms | | |
| Time to first painted tile, from canvas mount (SPEC-008 R73) | p95 < 1.0 s | | |

### Profiler traces

```
Link the Perfetto / Instruments traces in spike-traces/ and paste the in-app export JSON:
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
