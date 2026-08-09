# ADR-0013: `react-native-maps` behind a `MapCanvas` seam

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

The map is the first screen after login and the primary discovery surface. It renders safe spots with listing counts, clusters them, supports pan/zoom, and opens a detail sheet on tap. It does **not** render gardens — there is nothing to render, by design ([Location Privacy §5](../04-location-privacy.md#5-what-each-audience-can-see)) — which is a significant simplification: no per-user markers, no privacy-sensitive geometry, and a marker count bounded by the 200-row cap on `safe_spots_near`.

[ADR-0001](ADR-0001-mobile-stack.md) already names map performance as the single largest technical risk in the stack choice, so this decision is partly a hedge against that one.

The landscape as of Expo SDK 57:

| Option | State | Blockers |
| --- | --- | --- |
| `react-native-maps` | Mature, ~10 years, Fabric support, Apple Maps on iOS / Google Maps on Android | Marker updates cross the JS boundary |
| `expo-maps` | **Alpha.** Expo's new module wrapping SwiftUI `MapKit` and Jetpack Compose Maps | **iOS 18 minimum**; **no Google Maps on iOS**; alpha API stability |
| `@rnmapbox/maps` | Mature, vector tiles, excellent performance and styling | Paid above free tier; ~4 MB binary; separate tile pipeline |
| MapLibre RN | Open-source Mapbox fork | Requires our own tile hosting or a provider; smaller community |

`expo-maps` is the strategically correct destination and is unusable today for a specific, non-negotiable reason: its iOS 18 floor is two major versions above our iOS 16 minimum ([ADR-0001](ADR-0001-mobile-stack.md)), which would exclude a meaningful share of the older-skewing device base our demographic actually carries. Its lack of Google Maps on iOS is a secondary concern only because we do not need cross-platform tile consistency.

## Decision

**Ship `react-native-maps`, and put every map interaction behind a `MapCanvas` component that is the only file in the codebase importing it.**

### The seam

```ts
// src/components/map/MapCanvas.tsx — the ONLY file importing react-native-maps.
export type MapMarker = {
  id: string;
  lat: number;
  lng: number;                    // safe-spot coordinates only; a public building
  label: string;
  count: number;
  category: SafeSpotCategory;
};

export type MapCanvasProps = {
  markers: MapMarker[];
  region: Region;                 // our own type, not the vendor's
  onRegionChangeComplete: (r: Region) => void;
  onMarkerPress: (id: string) => void;
  onUserLocationChange?: (q: QuantizedPoint) => void;  // already ~100 m quantized
};
```

| Rule | Enforcement |
| --- | --- |
| No vendor type crosses the seam | `Region`, `MapMarker`, `QuantizedPoint` are ours. A lint rule bans `react-native-maps` imports outside `src/components/map/` |
| Clustering is server-side | H3 r7 aggregation in Postgres ([ADR-0005](ADR-0005-geospatial-model.md)), not a client clustering library. The device renders what it is given |
| Marker cap | **200**, matching the `safe_spots_near` `LIMIT` ([Location Privacy §6](../04-location-privacy.md#6-the-proximity-query-without-leaking)) |
| User position | Quantized to ~100 m before it reaches the RPC or any callback |
| Markers | Custom `<Marker>` with a memoized child; `tracksViewChanges={false}` after first render — the single most important performance setting in this library |
| Region changes | Debounced 300 ms before triggering a query |
| Tile failure | Renders a neutral background with markers correctly positioned. Never blocks the exchange flow |
| Offline | Last successful marker set from the persisted cache, with an offline banner ([ADR-0011](ADR-0011-state-management.md)) |

The seam is the actual decision. `react-native-maps` is replaceable; a map API leaking through 15 screens is not.

### Costed fallback

**`@rnmapbox/maps` is the pre-costed alternative**, estimated at **3–5 engineer-days** behind the seam: swap the implementation, map region and camera semantics, restyle markers, add the tile token to EAS secrets. Its advantages are vector tiles (smooth zoom, no raster reload), genuine annotation performance, and consistent styling across platforms. Its costs are a metered pricing model tied to map loads and ~4 MB of binary. We are not paying that today because our marker counts are low and our styling needs are minimal.

## Alternatives considered

### `expo-maps`

**What it is.** Expo's first-party module over SwiftUI MapKit and Jetpack Compose Maps. Modern, native-rendered, no bridge chatter for annotations.

**Why we didn't.** **iOS 18 minimum.** That is a hard blocker against our iOS 16 floor and cannot be worked around. It is also alpha, meaning API breakage between SDK releases, and it offers no Google Maps on iOS. Every one of these resolves with time, which is why the seam exists — this is the option we most expect to adopt.

### `@rnmapbox/maps` now

**What it is.** Mapbox GL native, vector tiles, best-in-class performance.

**Why we didn't.** Real cost for performance we have not yet demonstrated we need, plus a metered dependency on a fourth vendor and a larger binary. Adopting it preemptively would be optimizing before measuring. Kept costed and ready.

### MapLibre React Native

**What it is.** Open-source Mapbox GL fork, no vendor lock.

**Why we didn't.** Requires a tile source — either self-hosted (an infrastructure project we have no capacity for) or a third-party provider (a vendor dependency without Mapbox's maturity). The lock-in we would escape is not one we currently feel.

### WebView with Leaflet or MapLibre GL JS

**What it is.** A web map in a `WebView`.

**Why we didn't.** Worse gestures, worse performance, no native location integration, and a `postMessage` bridge for every interaction. It also puts map state in a context where the coordinate-egress controls are harder to reason about.

## Consequences

### Positive

- Mature, widely deployed library with Fabric support and a large body of known-issue documentation.
- Platform-native tiles: Apple Maps on iOS, Google Maps on Android — familiar to users, no additional vendor, no tile bill.
- No tile costs, no map-load metering, no fourth vendor in the privacy disclosure.
- The `MapCanvas` seam means the migration to `expo-maps` or Mapbox is one component, and the lint rule keeps it that way.
- Server-side clustering keeps the device dumb, which is both a performance win and a privacy win — aggregation happens where the data already is.
- Because gardens are never rendered, the map has no privacy-sensitive geometry at all. The most dangerous class of map bug does not exist here.

### Negative

- **Marker rendering crosses the JS/native boundary.** This is the known weak spot and the reason for `tracksViewChanges={false}` and the 200-marker cap.
- Different underlying SDKs mean platform-specific visual and behavioural differences; some fixes are per-platform.
- The library's issue backlog is long and maintenance is community-driven; a fix we need may not arrive on our schedule.
- Raster/vector behaviour differs between platforms, so zoom feel is not identical.

### Neutral / accepted costs

- Google Maps on Android requires an API key in the config plugin and a key-restriction policy.
- Marker components must stay memoized; an unmemoized marker child is a performance regression that is easy to introduce and easy to miss in review.
- The seam adds a small indirection cost on every map feature — deliberate.

## The strongest argument against this decision

Abstraction seams over UI components are famously the wrong abstraction, and this one has all the warning signs. `MapCanvas` claims a vendor-neutral interface, but the interface is shaped by `react-native-maps` — `Region` with `latitudeDelta`/`longitudeDelta` is that library's model of a viewport, and neither MapKit nor Mapbox thinks in those terms. Mapbox has a camera with zoom, pitch, and bearing; `expo-maps` wraps SwiftUI's `MapCameraPosition`. So the seam will not actually absorb a swap — it will require redefining `Region`, which means touching every caller, which is exactly what the seam was supposed to prevent. Meanwhile the seam actively costs us: every map feature that needs something specific (a callout with custom layout, a polyline, a heatmap, gesture-level control) either gets a new prop bolted onto `MapCanvas` until it is a leaky mirror of the vendor API, or gets refused. Six months in, `MapCanvasProps` will have twenty fields and a `renderCustomMarker` escape hatch, and it will be a worse version of the library it wraps, maintained by us.

The stronger version of the objection is that we have hedged in the wrong direction. If the real concern is that `react-native-maps` will not perform, the useful action is to spike Mapbox on the floor device *now*, measure, and pick the right one — not to build insurance against a decision we have not validated. Insurance against an unmeasured risk is a common way to pay for complexity twice: once building the seam, once discovering it does not fit when you actually swap.

We keep the seam anyway, for a reason that is about privacy rather than portability: **exactly one file may touch a map API, and therefore exactly one file could ever plot a coordinate.** That is a control worth having in a product where "someone rendered a user's location on a map" is the failure we most fear, and it is enforced by a lint rule rather than by review attention. The portability benefit is a secondary and partial bonus, and this ADR should not pretend otherwise.

## Revisit when

- **Map frame rate falls below 55 fps p50 or 45 fps p05** on the Android floor device with 200 markers — profile first, then evaluate `@rnmapbox/maps`.
- Time-to-first-marker exceeds **1.5 s p95** on the floor device.
- `expo-maps` reaches stable **and** our iOS minimum reaches 18 (expected once iOS 16 usage falls below **3%**). At that point it likely supersedes this ADR.
- `MapCanvasProps` exceeds **12 props** or acquires a render-prop escape hatch — the seam has become a leaky mirror and should be re-examined honestly.
- A `react-native-maps` issue blocks us for more than **two weeks** with no upstream fix in sight.
- We need vector tiles, custom cartography, or offline tile packs — none are on the roadmap through Phase 3, and all point directly at Mapbox.

## Related

- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0005 Geospatial model](ADR-0005-geospatial-model.md), [ADR-0011 State management](ADR-0011-state-management.md), [ADR-0012 Navigation](ADR-0012-navigation.md)
- [Location Privacy §5, §6, §9](../04-location-privacy.md), [System Architecture §2, §4](../01-system-architecture.md), [Data Model §9](../03-data-model.md#9-safe-spots)
