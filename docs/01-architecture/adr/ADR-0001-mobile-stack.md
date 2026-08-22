# ADR-0001: React Native + Expo as the mobile stack

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile, Product |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr ships iOS and Android at the same time, from a team of two to four engineers, with no dedicated iOS or Android specialist. The MVP is two metros. If the app is not on both platforms at launch, the local network density that makes barter work never forms — a gardener whose three nearest neighbours are on the other platform has no product.

The feature surface is unusual in exactly one dimension: a **map** with clustered markers is the primary screen, and it must stay smooth on a five-year-old mid-range Android. Everything else is ordinary — lists, forms, a camera capture, a chat thread, push notifications, secure token storage, an embedded webview for the KYC vendor. There is no video, no audio processing, no ARKit, no Bluetooth, no background location ([Location Privacy §9](../04-location-privacy.md) forecloses background location deliberately).

The constraints that actually drove this: (a) one codebase must serve two platforms because we cannot staff two; (b) we need to ship JS fixes without a store review cycle, because a bug in the exchange flow is a safety issue with a 24-hour tolerance, not a two-week one ([ADR-0017](ADR-0017-release-cadence.md)); (c) the build and submission pipeline must be someone else's problem, because managing signing certificates and provisioning profiles is a week of specialist work we do not have.

What we don't know: whether the map screen will hold 60 fps under 300 markers on the Android floor device. This is the single technical risk in the choice, and it is testable early.

## Decision

Build the app in **React Native with Expo, on the New Architecture (Fabric + TurboModules), targeting Expo SDK 57 / RN 0.86 / React 19.2, in TypeScript with `strict: true`.**

| Setting | Value | Rationale |
| --- | --- | --- |
| Workflow | Expo with **CNG** (prebuild); `ios/` and `android/` are generated, not committed | Config plugins stay declarative; native dirs regenerate cleanly |
| Architecture | New Architecture only. `newArchEnabled: true`. | SDK 57 defaults to it; the legacy bridge is a dead end |
| Language | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true` | — |
| `any` | **Banned in `src/domain/`** by lint rule; discouraged elsewhere | The state machine mirror must be sound |
| Minimum OS | iOS 16, Android 8 (API 26) | Covers >97% of devices; iOS 18 floor would have blocked `expo-maps` anyway ([ADR-0013](ADR-0013-map-library.md)) |
| Native modules | Only via Expo config plugins. A bare native module requires an ADR. | Preserves the prebuild story and OTA safety |

Generated types from the Postgres schema (`supabase gen types typescript`) are committed and checked in CI, so a schema change that breaks the client fails the build rather than the app.

## Alternatives considered

### Flutter

**What it is.** Dart, Skia/Impeller-rendered UI, single codebase, excellent rendering consistency across platforms, mature `google_maps_flutter`.

**Why we didn't.** Two reasons, neither about the framework's quality. First, **the Supabase Dart client is a second-class citizen relative to `supabase-js`** — realtime, auth session handling, and the generated-types story all lag, and we are betting the entire authorization model on that client behaving exactly as documented ([ADR-0003](ADR-0003-database-centric-authz.md)). Second, the team writes TypeScript. Retraining on Dart costs roughly a month of throughput at exactly the moment we can least afford it, and buys rendering fidelity we do not need for a list-and-map app. Flutter would have been the better answer if the map were custom-drawn.

### Native Swift + Kotlin

**What it is.** Two codebases, best possible performance, first-party access to MapKit and the Google Maps SDK, no framework version risk.

**Why we didn't.** Roughly 1.7–2× the feature work, permanently, plus two review cycles and two release trains. For a product whose differentiation is a social mechanic and a privacy model — neither of which is expressed in native code — this is spending the entire engineering budget on the least differentiating layer. It also forecloses OTA updates, which we depend on for safety fixes.

### React Native without Expo (bare RN + CLI)

**What it is.** Same runtime, none of the Expo modules, EAS, or config plugins.

**Why we didn't.** We would rebuild EAS Build, EAS Update, `expo-secure-store`, `expo-image-picker`, and the config-plugin system by hand, worse. The historical argument against Expo — "you can't use custom native code" — died with prebuild.

## Consequences

### Positive

- One codebase, one review process for logic, one set of domain tests covering both platforms.
- EAS Build removes signing and provisioning from the critical path entirely.
- EAS Update gives a same-day path for JS-only fixes ([ADR-0017](ADR-0017-release-cadence.md)).
- `supabase-js` is the reference client; every Supabase feature lands there first.
- The Expo module ecosystem covers every native capability the MVP needs without writing Objective-C or Kotlin.

### Negative

- **We inherit Expo's release calendar.** A new iOS version's breaking change lands when Expo ships support for it, not when Apple ships it.
- Map performance is a genuine risk. `react-native-maps` marker rendering crosses the JS/native boundary and clustering must be done carefully. *(Partly mitigated since: [ADR-0019](ADR-0019-openstreetmap-maplibre.md) moved to MapLibre, where 200 markers are one GeoJSON source update rendered as GPU layers rather than 200 native views. The risk did not disappear — it moved to New Architecture interop and style complexity.)*
- App binary is ~8–12 MB larger than an equivalent native build.
- Debugging a Fabric-layer crash requires native skills we do not have on the team, and is the scenario in which we would buy consulting hours.

### Neutral / accepted costs

- Third-party SDKs occasionally require a config plugin we write and maintain ourselves.
- Some Expo modules (notably `expo-maps`) ship as alpha and cannot be adopted on their announcement date.
- New Architecture means some older community libraries are unavailable; we check interop support before adding any dependency.

## The strongest argument against this decision

The map is the product, and the map is precisely where React Native is weakest. Every marker on a `react-native-maps` map is a React component whose props cross the bridge (or, on Fabric, the shadow-tree boundary) on every update; a region change that re-clusters 300 markers is 300 component updates in a frame budget of 16 ms. Native map SDKs annotate directly against a rendering layer that was designed for exactly this and pay none of that cost. A gardener panning the map on a Pixel 4a is going to feel a difference we cannot fix without writing a native module — at which point we have paid the framework's cost and the native code's cost. The counterargument compounds: gesture-heavy interfaces are the known weak spot of RN, and we chose an architecture where the first screen the user sees after login is the gesture-heavy one. If the map stutters, the app feels cheap, and "feels cheap" is fatal for a product asking strangers to trust it enough to meet in person.

We accept this because the mitigation is bounded and testable: marker clustering is done in the database (H3 r7 aggregation, [ADR-0005](ADR-0005-geospatial-model.md)) rather than on-device, the marker count on screen is capped, and `MapCanvas` ([ADR-0013](ADR-0013-map-library.md)) isolates the map so a native replacement is one component, not one app. We spike the map on the Android floor device before writing any other screen.

## Revisit when

- Sustained frame rate on the map screen falls below **55 fps p50 or 45 fps p05** on the Android floor device (Pixel 4a class) with 300 clustered markers, after the clustering and cap mitigations are in place.
- Time-to-interactive on the map screen exceeds **2.0 s p95** on the floor device.
- Expo lags a major iOS or Android release by more than **one full store-review cycle (≈8 weeks)** on something we need.
- We add a feature requiring sustained background execution, real-time video, or BLE — none of which are on the roadmap through Phase 3.
- Crash-free sessions fall below **99.5%** and more than a third of crashes are in native framework frames rather than our JS.

## Related

- [ADR-0011 State management](ADR-0011-state-management.md), [ADR-0012 Navigation](ADR-0012-navigation.md), [ADR-0013 Map library](ADR-0013-map-library.md), [ADR-0017 Release cadence](ADR-0017-release-cadence.md)
- [System Architecture §4](../01-system-architecture.md#4-technology-stack)
