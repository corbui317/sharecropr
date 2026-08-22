# ADR-0019: OpenStreetMap via MapLibre React Native

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-09 |
| **Deciders** | Architecture, Mobile, Product |
| **Supersedes** | [ADR-0013](ADR-0013-map-library.md) |
| **Superseded by** | — |

## Context

[ADR-0013](ADR-0013-map-library.md) chose `react-native-maps` — Apple Maps on iOS, Google Maps on Android — behind a `MapCanvas` seam. That decision was made on a narrow reading of the requirement: render ~200 safe-spot markers, cluster them, open a sheet on tap. Against that requirement it was defensible, and the spike code in `src/features/map/` was built on it.

The requirement has changed. **Sharecropr is committing to OpenStreetMap as its map substrate**, not as a tile source of convenience but as a foundational choice that everything else is built around. That reframes the decision in three ways ADR-0013 did not consider:

1. **The basemap is no longer a commodity.** ADR-0013 treated platform-native tiles as a free, invisible background. If OSM is the substrate, the basemap becomes something we control, style, and can carry offline — and something whose data we can also *query*, which is what makes [ADR-0021](ADR-0021-osm-safe-spot-sourcing.md) possible.

2. **Platform-native tiles are a privacy dependency we hadn't priced.** Every pan and zoom on Apple Maps or Google Maps sends the user's viewport to Apple or Google. For an app whose entire architecture exists to prevent third parties learning where users are ([Location Privacy](../04-location-privacy.md)), shipping a basemap that streams viewport coordinates to a large ad-adjacent company is an inconsistency we papered over. ADR-0013's consequences section listed "no additional vendor" as a *positive* — that was wrong. There were two vendors; they were just invisible because they came bundled with the OS.

3. **ADR-0013 rejected MapLibre for a reason that no longer holds.** It said MapLibre "requires a tile source — either self-hosted (an infrastructure project we have no capacity for) or a third-party provider." Self-hosting an OSM basemap is now a single PMTiles file on object storage, costing single-digit dollars per month and requiring no server. See [ADR-0020](ADR-0020-pmtiles-self-hosting.md). The premise was accurate when written and is no longer accurate.

The `MapCanvas` seam ADR-0013 built is the thing that makes this affordable. It was justified primarily as a privacy control — exactly one file may touch a map API — and secondarily as portability insurance. The insurance is now being claimed, sooner than expected.

## Decision

**Adopt `@maplibre/maplibre-react-native` as the map renderer, rendering OpenStreetMap vector tiles, and keep the `MapCanvas` seam as the sole file permitted to import it.**

### What changes

| Concern | Before (ADR-0013) | After |
| --- | --- | --- |
| Renderer | `react-native-maps` | `@maplibre/maplibre-react-native` |
| iOS basemap | Apple Maps | OSM vector tiles |
| Android basemap | Google Maps | OSM vector tiles |
| Tile format | Raster/vendor-native | Vector (MVT), styled by us |
| Tile source | Apple / Google | Self-hosted PMTiles ([ADR-0020](ADR-0020-pmtiles-self-hosting.md)) |
| Cross-platform consistency | Two different maps | **Identical on both platforms** |
| Viewport egress | To Apple / Google | To our own R2 bucket |
| Offline capability | None | Available (Phase 2) |
| Marker rendering | Native `<Marker>` views | `ShapeSource` + `SymbolLayer`, GPU-rendered |
| Attribution | Vendor-supplied | **Ours to render — ODbL requirement** |

### The seam, revised

The seam survives, but ADR-0013's steel-man was right that `Region` with `latitudeDelta`/`longitudeDelta` is a `react-native-maps` concept that does not survive the swap. We take that on the chin and redefine it:

```ts
// src/features/map/components/MapCanvas.tsx
// The ONLY file in the codebase permitted to import @maplibre/maplibre-react-native.

export type Camera = {
  center: { lat: number; lng: number };
  zoom: number;                       // MapLibre zoom level, not deltas
};

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;                        // safe-spot coordinates only; a public building
  label: string;
  count: number;
  category: SafeSpotCategory;
};

export type MapCanvasProps = {
  markers: MapMarker[];
  camera: Camera;
  onCameraChanged: (c: Camera) => void;
  onMarkerPress: (id: string) => void;
  onUserLocationChange?: (q: QuantizedPoint) => void;  // ~100 m quantized already
  styleUrl: string;                                     // our PMTiles style
};
```

| Rule | Enforcement |
| --- | --- |
| No vendor type crosses the seam | `Camera`, `MapMarker`, `QuantizedPoint` are ours. Lint bans `@maplibre/*` imports outside `src/features/map/components/` |
| **Attribution is not optional** | `MapCanvas` renders "© OpenStreetMap contributors" unconditionally. Removing it is both a licence breach and a failing test ([NFR-99](../../00-foundation/05-nfr.md)) |
| Marker rendering | `ShapeSource` + `SymbolLayer` with a GeoJSON `FeatureCollection`. **Not** individual native marker views — that was the `react-native-maps` weakness and it does not exist here |
| Clustering | **Client-side `supercluster`**, unchanged by this ADR ([SPEC-008-R21](../../03-specs/SPEC-008-interactive-map.md)). MapLibre's built-in source clustering is **not** enabled — two clustering implementations that disagree at a zoom boundary produce a bug with no owner |
| Marker cap | **200**, matching the `safe_spots_near` `LIMIT` |
| User position | Quantized to ~100 m before reaching any RPC or callback |
| Camera changes | Debounced 300 ms before triggering a query |
| Tile failure | Neutral background, markers still correctly positioned. Never blocks the exchange flow |
| Style | One style JSON, versioned in the repo, pointing at our PMTiles source |

> **A correction worth recording.** An earlier draft of this ADR asserted that server-side H3 aggregation was authoritative and "the device renders what it is given" — inherited verbatim from [ADR-0013](ADR-0013-map-library.md) without being checked. It is wrong, and [SPEC-008 §3](../../03-specs/SPEC-008-interactive-map.md) had already rejected server-side clustering for a better reason than performance: a server cluster index needs the user's viewport at high precision on *every pan*, which is exactly the query-pattern side channel [Location Privacy §12.4](../04-location-privacy.md) warns about. The renderer swap has no bearing on that argument. Clustering stays on the client.

### Why marker performance improves rather than degrades

This is the part that makes the swap a net win rather than a lateral move. `react-native-maps` renders each marker as a native view, and each one crosses the JS/native boundary — hence ADR-0013's `tracksViewChanges={false}` warning and its 200-marker anxiety. MapLibre renders markers as **GPU layers from a single GeoJSON source**: 200 markers is one source update, not 200 view updates. The 200-cap remains, but it is now a privacy and payload cap rather than a performance cap.

## Alternatives considered

### Keep `react-native-maps` with an OSM raster tile overlay

**What it is.** Add a `UrlTile` layer of OSM raster tiles on top of the existing map.

**Why we didn't.** It is a half-measure that gets the downsides of both. On iOS the Apple Maps basemap is still loaded underneath and still receives viewport requests, so the privacy inconsistency remains. Raster tiles cannot be styled, look poor between zoom levels, and have no offline story. And it would leave us with an OSM-flavoured map rather than an OSM-native one, which is not what "built around OSM" means.

### `@rnmapbox/maps` with OSM tiles

**What it is.** Mapbox GL Native, which can render non-Mapbox vector tiles.

**Why we didn't.** MapLibre *is* the community fork of exactly this SDK, without the licence terms, the account requirement, or the per-map-load billing. Choosing Mapbox to render OSM data is paying a vendor to avoid a vendor. ADR-0013 had it costed as the fallback; MapLibre supersedes it in that role too.

### MapLibre GL JS in a WebView

**What it is.** The web renderer inside a `WebView`.

**Why we didn't.** Same reasons ADR-0013 gave and they still hold: worse gestures, worse performance, no native location integration, a `postMessage` bridge for every interaction, and map state in a context where coordinate-egress controls are harder to reason about.

### `expo-maps`

**What it is.** Expo's first-party module over SwiftUI MapKit and Jetpack Compose Maps.

**Why we didn't.** Unchanged from ADR-0013 — iOS 18 floor against our iOS 16 minimum, and alpha API stability. It is additionally now off the strategic path: it wraps *platform* maps, which is the thing this ADR is deliberately moving away from.

## Consequences

### Positive

- **One map, both platforms.** Identical rendering, identical styling, identical behaviour. A whole class of "works on iOS, wrong on Android" bugs disappears, and design only has to be done once.
- **No viewport data leaves our infrastructure.** Consistent with every other decision in [Location Privacy](../04-location-privacy.md), rather than in tension with it.
- **No per-map-load billing, ever.** Tile cost is object storage and egress ([ADR-0020](ADR-0020-pmtiles-self-hosting.md)), which scales with bytes rather than with a vendor's pricing decisions.
- **Better marker performance**, for the structural reason above.
- **Custom cartography.** We can de-emphasise everything irrelevant and make safe spots the visually dominant feature — impossible on a vendor basemap.
- **Offline becomes achievable** rather than impossible ([Roadmap Phase 2](../../06-roadmap/01-roadmap.md)).
- **OSM data becomes queryable**, which unlocks [ADR-0021](ADR-0021-osm-safe-spot-sourcing.md) and attacks [R-02](../../06-roadmap/02-open-risks.md).
- No Google Maps API key, no key-restriction policy, one less credential to rotate.

### Negative

- **The spike is invalidated and must be redone.** `src/features/map/` is built on `react-native-maps`. Estimated **4–6 engineer-days** to port plus a re-run of the spike. This is real cost, paid because the decision changed, and the [go/no-go doc](../../07-review/03-map-spike-go-no-go.md) is reset accordingly.
- **We now own the basemap.** Tile builds, style maintenance, and a data-refresh cadence are ours. A basemap that silently goes stale is our problem, where previously it was Apple's.
- **Attribution is a legal obligation**, not a design preference. ODbL requires it, and a UI change that hides it is a licence breach.
- **Smaller community than `react-native-maps`.** Fewer Stack Overflow answers; more reading of source.
- **Larger binary** than platform-native maps (the renderer ships with the app rather than living in the OS).
- **OSM data quality varies by region.** In our two launch metros it is excellent. A future market may be sparse in a way Apple Maps would not have been.

### Neutral / accepted costs

- A style JSON is now a versioned artifact requiring review like code.
- The New Architecture interop story for MapLibre RN is the primary spike risk and is exactly what the reset spike must answer first.
- Geocoding is no longer supplied by the platform. For MVP's two metros a **bundled locality gazetteer** (a few hundred rows) covers the location-denied search path with no vendor at all; self-hosted Photon is the documented Phase 2 answer if we outgrow it.

## The strongest argument against this decision

We are discarding working, already-written, already-profiled spike code and replacing a ten-year-old library that has answers to every question with a smaller one that does not — and we are doing it for a benefit that is, on honest inspection, mostly ideological. The privacy argument is the weakest part of the case: Apple and Google already know precisely where the user is, continuously, at the operating-system level. A tile request revealing that the user is looking at a map of Ann Arbor tells them nothing they do not already have, and pretending otherwise confuses a real threat model with a purity preference. Meanwhile the costs are concrete and immediate — 4–6 days of rework, a reset spike on the critical path of a project whose own risk register says the map is the highest technical risk ([R-04](../../06-roadmap/02-open-risks.md)), a new infrastructure component to build and operate, a basemap that can go stale, and a renderer whose New Architecture support is less battle-tested than the one we already have running.

The disciplined move would be to finish the spike on `react-native-maps`, ship the MVP, learn whether liquidity even works ([R-01](../../06-roadmap/02-open-risks.md) says that is the question that actually decides the product's fate), and revisit the basemap when there is a measured reason — a styling need, an offline requirement, or a cost. Rewriting the map before a single user has completed a single exchange is optimising a component we have not yet proven anyone wants.

**We proceed anyway, but the honest justification is not privacy — it is optionality and the safe-spot pipeline.** OSM makes the basemap a thing we can query, style, carry offline, and seed operational data from. [ADR-0021](ADR-0021-osm-safe-spot-sourcing.md) turns the manual safe-spot curation bottleneck — which [R-02](../../06-roadmap/02-open-risks.md) identifies as a plausible *actual* constraint on growth, more binding than any engineering concern — into a review queue. That is a concrete operational win, available only because the map substrate is open data. The privacy consistency is a genuine but secondary benefit, and this ADR should not oversell it. If the reset spike fails, [ADR-0013](ADR-0013-map-library.md)'s decision is the documented fallback and the seam makes reverting a one-component change.

## Revisit when

- **The reset spike fails** its pass criteria (60 fps pan/zoom at 200 markers, correct symbol rendering, working camera control on the Android floor device) — revert to ADR-0013 behind the seam, cost ~3 days.
- Tile serving costs exceed **$50/month** — investigate before it becomes a habit ([ADR-0020](ADR-0020-pmtiles-self-hosting.md)).
- OSM coverage in a target launch market is materially worse than platform maps — a market-selection input, not a renderer decision.
- MapLibre RN falls more than **two minor versions** behind the Expo SDK cadence, or a blocking issue sits unfixed for **four weeks**.
- `MapCanvasProps` exceeds **12 props** or grows a render-prop escape hatch — the seam has become a leaky mirror and deserves an honest re-examination, exactly as ADR-0013 warned.

## Related

- Supersedes [ADR-0013 Map library](ADR-0013-map-library.md)
- [ADR-0020 PMTiles self-hosting](ADR-0020-pmtiles-self-hosting.md), [ADR-0021 OSM safe-spot sourcing](ADR-0021-osm-safe-spot-sourcing.md)
- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0005 Geospatial model](ADR-0005-geospatial-model.md), [ADR-0011 State management](ADR-0011-state-management.md)
- [SPEC-008 Interactive map](../../03-specs/SPEC-008-interactive-map.md), [Location Privacy §5–6](../04-location-privacy.md), [Mobile Architecture](../02-mobile-architecture.md)
