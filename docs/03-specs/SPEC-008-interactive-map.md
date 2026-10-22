# SPEC-008: Interactive Map & Discovery

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 2.1.0 |
| **Owner** | Mobile Engineering |
| **Phase** | MVP |
| **Security review** | not required |
| **Schema depends on** | [SPEC-005](SPEC-005-crop-taxonomy.md), [SPEC-007](SPEC-007-safe-spots.md), [SPEC-009](SPEC-009-listings-and-offers.md) |
| **Behaviourally coupled with** | SPEC-009, SPEC-010 |
| **Related ADRs** | [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md), [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md) (superseded), [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0011](../01-architecture/adr/ADR-0011-state-management.md) |
| **Last updated** | 2026-08-09 |

---

## 1. Summary

The map is Sharecropr's front door: it opens centred on the user, shows curated safe spots styled by how much is available at each, and lets a gardener go from "I have too many courgettes" to "there's a library 1.2 km away with four things I want" in two taps. It is also the app's hardest performance problem and its most load-bearing privacy surface, because it is the only screen that consumes precise coordinates at all. **No other user's location is ever rendered — not fuzzed, not clustered, not aggregated into a heat map.** Listings attach to safe spots, not to people, and `safe_spots_near` has no column that could carry a garden coordinate.

The basemap is **OpenStreetMap vector tiles rendered by `@maplibre/maplibre-react-native`**, served from a PMTiles archive we host ourselves ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). Three consequences run through the whole of this spec. The map renders **identically on iOS and Android**, so every pixel below is specified once rather than twice. **No third party serves a tile**, so panning the map does not stream a viewport to a company outside our infrastructure. And **ODbL attribution is a legal obligation with a test attached** (§5.10) — "© OpenStreetMap contributors" is not a design element that a redesign may quietly drop.

## 2. Goals

- Get a user from cold start to an interactive, populated map in **p95 < 2.5 s** on a three-year-old mid-range Android ([NFR](../00-foundation/05-nfr.md)).
- Make availability legible at a glance: a marker's styling answers "is anything here?" before the user taps anything.
- Support the two discovery intents that actually occur — "what's near me" (browse) and "who has tomatoes" (search) — without building a third.
- Hold the 200-marker performance budget with a **pre-decided degradation ladder**, so the trade-off is made in this document rather than during an incident.
- Make location denial a first-class, fully functional path, not a dead end.
- Ship the accessible list view as a real screen on a real user path, because an accessibility path only accessibility users touch is one that breaks silently.
- Be honest about the cold-start liquidity problem: at launch, most viewports are empty, and an empty map that says nothing is the fastest uninstall in the product.
- **Render the same map on both platforms.** One style, one renderer, one set of screenshots, one design review. The class of bug that reads "correct on iOS, wrong on Android" is designed out rather than tested for.
- **Degrade honestly when tiles fail.** Markers are the product; the basemap is context. A tile failure must cost the user context, never the ability to find a spot and arrange an exchange.
- **Discharge the ODbL attribution obligation in the UI, and prove it in CI.** Attribution that depends on nobody redesigning the map chrome is not compliance.

## 3. Non-Goals

- **Rendering gardens, users, fuzzed points, or heat maps of supply density.** Not "we render them carefully" — there is no code path, because `safe_spots_near` has no column for one ([Location Privacy §6](../01-architecture/04-location-privacy.md)). A "gardens near me" view is not a future feature to be designed carefully; it is a decision already made against.
- **Turn-by-turn directions or in-app navigation.** Out of scope per [PRD §1](../00-foundation/02-prd.md). We show an address; the OS maps app does the rest.
- **Background location.** The entitlement is absent from `app.json` so it cannot be requested by accident ([Mobile Architecture §7](../01-architecture/02-mobile-architecture.md)).
- **Server-side clustering.** Rejected explicitly: a server cluster index needs the user's viewport at high precision on every pan, which is exactly the query-pattern side channel [Location Privacy §12.4](../01-architecture/04-location-privacy.md) warns about. Clustering stays on the client.
- **Realtime map updates.** Broadcasting count deltas to every client in a metro is a fanout problem with no product payoff ([Realtime & Notifications §8.3](../01-architecture/08-realtime-and-notifications.md)). The map polls on a 60 s `staleTime`.
- **Offline map packs.** Deliberately **Phase 2**, not MVP ([Roadmap](../06-roadmap/01-roadmap.md)). Self-hosted PMTiles makes downloadable per-metro packs achievable ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)) — which is exactly why it is tempting to pull forward and exactly why we are not. MVP ships last-known-state plus a staleness banner (§8.2), and outside the tile cache a neutral background with correctly positioned markers. Bundling tiles in the binary is separately rejected against [NFR-08](../00-foundation/05-nfr.md).
- **A third-party tile or geocoding vendor.** No MapTiler, no Stadia, no Google, no Apple, in the map path. The tile origin is ours; the location-denied search path is a bundled gazetteer (R71). This is a `MUST NOT` with a wire-level test (T78), not a preference.
- **Saved searches, "notify me when tomatoes appear".** That is [SPEC-020](SPEC-020-harvest-planning.md) surplus alerts.
- **A radius above 40 km.** Capped server-side. A 200 km "search" is a scraping request wearing a product costume.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener**, I want the map to open where I am so that I immediately see what's relevant. | P0 |
| US-02 | As a **gardener browsing**, I want to pan around freely and then get back to my own position with one tap. | P0 |
| US-03 | As a **gardener**, I want to see at a glance which meeting places actually have crops available. | P0 |
| US-04 | As a **gardener**, I want to tap a place and see everything offered there without leaving the map. | P0 |
| US-05 | As a **gardener looking for something specific**, I want to search by species and see only the places that have it. | P0 |
| US-06 | As a **gardener in a dense metro**, I want markers to cluster so the map isn't an unreadable pile of pins. | P0 |
| US-07 | As a **rural gardener**, I want to widen my radius to 40 km because there is nothing within 8. | P0 |
| US-08 | As a **user who declined location access**, I want to type my town and use the app normally. | P0 |
| US-09 | As a **screen-reader user**, I want a list that gives me the same data as the map, permanently, without being bounced back to a map I can't use. | P0 |
| US-10 | As a **gardener with one bar of signal**, I want the map to show me what it last knew rather than a spinner. | P1 |
| US-11 | As a **new user in a new metro**, I want an empty map to tell me what to do next rather than implying the app is broken. | P0 |
| US-12 | As a **gardener**, I want to add something to my inventory from the map without hunting for the right tab. | P1 |

## 5. Functional Requirements

### 5.1 Camera, follow mode, and location

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | On first open with location granted, the camera MUST centre on the device position at zoom 13 (≈ 8 km visible radius) with `following = true`. |
| R02 | **MUST** | The user's own position MUST render as an avatar dot, and it MUST be the only user-derived point drawn on the map. |
| R03 | **MUST NOT** | The map MUST NOT render any other user's position, garden, `display_point`, location-tier cell, or any aggregate derived from one. |
| R04 | **MUST** | A user pan, pinch, or rotate gesture MUST set `following = false`. |
| R05 | **MUST NOT** | A programmatic camera move (follow-me animation, cluster expansion, sheet inset re-centre, deep link) MUST NOT clear follow mode. The gesture flag (`isGesture` on iOS, `reason === 1` on Android) is the only permitted discriminator; `onRegionChangeComplete` fires for animations too. |
| R06 | **MUST** | A "recentre" button MUST be visible whenever `following = false`, and pressing it MUST set `following = true` and animate to the device position preserving the current zoom. |
| R07 | **MUST** | While `following = true`, a location update MUST animate the camera over 200 ms. While `following = false`, a location update MUST move the avatar dot only and MUST NOT touch the camera. |
| R08 | **SHOULD** | On foreground with `following = true` and a last fix older than 60 s, the client SHOULD take one fresh fix and then animate. |
| R09 | **MUST** | `following` MUST live in Zustand, not React state. A boolean in React state here re-renders the marker tree on every location tick ([Mobile Architecture §4.2](../01-architecture/02-mobile-architecture.md)). |
| R10 | **MUST** | The device position MUST be held in memory only. It MUST NOT be written to MMKV, to a log, to a Sentry breadcrumb, or to an analytics property. |

### 5.2 Querying and quantization

| ID | Req | Statement |
| --- | --- | --- |
| R11 | **MUST** | Map data MUST come from `rpc.safe_spots_near` exclusively. No other query path may supply map markers. |
| R12 | **MUST** | `p_lat` and `p_lng` MUST be quantized client-side to a ~100 m grid before transmission, via `domain/geo/quantize.ts` ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)). |
| R13 | **MUST** | The TanStack Query key MUST be built from the **quantized** viewport plus an integer zoom band, so a pan does not mint a cache entry per frame ([Mobile Architecture §2.1](../01-architecture/02-mobile-architecture.md)). |
| R14 | **MUST** | Refetch-on-pan MUST be debounced at **400 ms** of camera stillness, and MUST NOT fire while a gesture is in flight. |
| R15 | **MUST** | The client MUST NOT issue a new `safe_spots_near` call when the quantized viewport and filters are unchanged, regardless of how far the camera moved within the grid cell. |
| R16 | **MUST** | `staleTime` for `safe_spots_near` MUST be 60 s and `gcTime` 15 min ([Mobile Architecture §2.2](../01-architecture/02-mobile-architecture.md)). |
| R17 | **MUST** | On `rate_limited` (429) from `safe_spots_near`, the client MUST stop issuing viewport queries for `Retry-After` seconds, keep rendering the last successful result, and show the rate-limit affordance. It MUST NOT auto-retry a viewport query into the limit. |
| R18 | **SHOULD** | The first paint after cold start SHOULD come from the persisted cache, with the network result reconciling afterwards. A network round trip on the critical path makes p95 a function of the user's cellular connection. |

### 5.3 Markers, styling, and clustering

Markers are **GPU layers, not views**. The entire marker set is one GeoJSON `FeatureCollection` handed to one MapLibre `ShapeSource`, drawn by a `SymbolLayer` whose icon, badge, and text are data-driven style expressions over the feature's properties. Nothing about a marker is a React component and nothing about a marker crosses the JS/native boundary per marker.

This is why the swap to MapLibre improves marker performance rather than trading it away ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)). Under `react-native-maps`, 200 markers were 200 native views, each re-rasterising on camera change unless explicitly told not to — which is what made `tracksViewChanges` the most dangerous prop on the screen and what produced this spec's original 200-marker anxiety. Under MapLibre, 200 markers are **one source update**. Rendering cost is a function of the number of *source updates*, not the number of features, so the marginal cost of the 200th marker is approximately zero.

**The 200-cap therefore stays, but it is no longer a performance cap.** It is a privacy and payload cap: it is the `LIMIT 200` on `safe_spots_near` (§7.1), which bounds what a scraper harvests per call and bounds the response size on a cellular connection. Nothing in this section may be relaxed on the argument that "the renderer can handle more" — the renderer was never the reason.

| ID | Req | Statement |
| --- | --- | --- |
| R19 | **MUST** | A safe spot marker MUST be styled by availability in three bands: **empty** (`listing_count = 0`), **some** (1–4), **many** (≥ 5). The band MUST be conveyed by shape or fill *and* by the count badge, never by colour alone. The band MUST be expressed as a data-driven style expression over the feature's `listing_count` property, so a count change repaints from the same source rather than remounting anything. |
| R20 | **MUST** | A marker MUST carry its category glyph (library, police station, city hall, …) so that a user who will not enter one category can avoid it visually. Glyphs MUST ship as a sprite sheet in the style bundle, not as runtime-loaded images, so a marker never renders glyph-less while an icon downloads. |
| R21 | **MUST** | Clustering MUST use `supercluster` on the client with `radius: 56`, `maxZoom: 15`, `minZoom: 3`, `minPoints: 3`, `extent: 512`. |
| R22 | **MUST** | `getClusters` MUST be called on **integer** zoom. Reclustering on fractional zoom makes markers visibly jitter mid-pinch. |
| R23 | **MUST** | A cluster badge MUST show the **summed `listing_count`** of its member spots, not the number of spots. "23 things available" is more useful to a gardener than "7 spots". |
| R24 | **MUST** | Tapping a cluster MUST animate to `getClusterExpansionZoom` for that cluster. |
| R25 | **MUST** | Markers MUST be rendered exclusively through `ShapeSource` + `SymbolLayer`. No marker, cluster, or selection halo may be a `PointAnnotation`, a `MarkerView`, or any other per-feature native view. Per-marker views are the failure mode this renderer exists to remove, and one of them on the screen reintroduces the whole class. |
| R26 | **MUST** | The `FeatureCollection` handed to the `ShapeSource` MUST be memoised over `(id, listing_count, selected)` across the whole set and MUST be a new object reference **only** when one of those changes. A new array identity per render pushes a full source update to native on every frame, which is this renderer's version of the `tracksViewChanges` bug. |
| R27 | **MUST** | The supercluster index MUST be rebuilt only when the query result changes, never on camera change. |
| R28 | **SHOULD** | An empty spot (`listing_count = 0`) SHOULD still render. Hiding empty spots makes a cold-start metro look like it has no meeting places at all, which is a worse lie than "nothing here yet". |
| R69 | **MUST** | The marker set MUST reach `MapCanvas` as a single `FeatureCollection` of `Point` features whose properties are exactly `(id, listing_count, category, label, selected)`. No property carrying or derived from a user coordinate may appear on a feature, and the seam's `MapMarker` type ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)) is the only shape permitted across it. |
| R70 | **MUST NOT** | MapLibre's built-in source clustering (`cluster`, `clusterRadius`, `clusterMaxZoom`, `clusterProperties`) MUST NOT be enabled on the `ShapeSource`. Clustering is R21's `supercluster` index and only R21's index; two clustering implementations that disagree at a zoom boundary produce a bug with no owner and no reproducible case. |

### 5.4 Filters, search, and radius

| ID | Req | Statement |
| --- | --- | --- |
| R29 | **MUST** | Category filter chips MUST map to `crop_categories` and MUST be passed as `p_category_ids` to `safe_spots_near`, so filtering happens server-side inside the count aggregate rather than by hiding markers client-side. |
| R30 | **MUST** | Species search MUST call `rpc.search_listings` and MUST NOT filter the marker set client-side; a client-side filter over a 200-row cap silently under-reports. |
| R31 | **MUST** | With an active species search, the map MUST show only spots that have at least one matching listing, and the result count MUST be stated in the search bar ("12 places have tomatoes"). |
| R32 | **MUST** | The discovery radius MUST default to **8 km** and be adjustable from **2 km to 40 km**. |
| R33 | **MUST** | The radius selection MUST persist across launches (MMKV); filter chips and search text MUST NOT — they are session intent, not preference ([Mobile Architecture §2](../01-architecture/02-mobile-architecture.md)). |
| R34 | **MUST** | The radius MUST be presented as a discrete control with values 2, 5, 8, 12, 20, 30, 40 km. A continuous slider produces a new query per pixel and no user wants 17 km specifically. |
| R35 | **MUST** | Changing the radius MUST NOT change the camera zoom. They are different concepts and coupling them makes the map lurch. |
| R36 | **MUST** | Active filters MUST be visible on the map itself (a chip row with a clear-all affordance), never hidden behind a filter modal. A filtered empty map that looks like an unfiltered empty map is the most common "the app is broken" report in map products. |
| R37 | **SHOULD** | Species search SHOULD match against `common_name` and `aliases` so "courgette" finds Zucchini ([Data Model §7](../01-architecture/03-data-model.md)). |

### 5.5 The safe-spot bottom sheet and the FAB

| ID | Req | Statement |
| --- | --- | --- |
| R38 | **MUST** | Tapping a marker MUST open the safe-spot sheet at the 55% detent, with three detents at 25 / 55 / 92% ([SPEC-007 §8.1](SPEC-007-safe-spots.md)). |
| R39 | **MUST** | The sheet MUST be a route (`/(modals)/safe-spot/[safeSpotId]`), not local component state, so a deep link and a marker press land in the same place and Android back behaves. |
| R40 | **MUST NOT** | Opening the sheet MUST NOT move the camera. It MUST inset the map by the sheet height and re-centre the selected marker into the remaining visible region. Moving the camera to the marker destroys the user's spatial context. |
| R41 | **MUST** | The sheet's listing list MUST be a `FlashList` with `estimatedItemSize={88}`; a dense-metro spot can carry 60+ listings. |
| R42 | **MUST** | An inventory FAB MUST be fixed at bottom-right, above the tab bar at `insets.bottom + 16`, 56 × 56 dp. |
| R43 | **MUST** | The FAB MUST hide (translate + fade, 150 ms) while the sheet is above the 40% detent, because it otherwise sits on the sheet's own primary button. |
| R44 | **SHOULD** | FAB long-press SHOULD offer "Add item" and "Publish listing". Long-press is an accelerator, never the only path — both actions exist in the Inventory tab. |

### 5.6 Location permission and the denied path

| ID | Req | Statement |
| --- | --- | --- |
| R45 | **MUST** | Location permission MUST be requested at first map open with the justification copy in [Location Privacy §9](../01-architecture/04-location-privacy.md), and MUST be while-in-use only. |
| R46 | **MUST NOT** | The app MUST NOT request background location, and the entitlement MUST be absent from the built `Info.plist` and `AndroidManifest.xml`, asserted in CI. |
| R47 | **MUST** | With location denied, the map MUST be fully functional via locality search: the user types a town or postcode, the map centres there, and every other feature (radius, filters, species search, sheet, listing, requesting) works unchanged. |
| R48 | **MUST** | With location denied, the avatar dot and the recentre button MUST be absent, not disabled. A disabled control the user cannot enable is noise. |
| R49 | **MUST** | Locality search MUST resolve against the **bundled locality gazetteer** (R71), and the resolved coordinate MUST be quantized identically to a device fix before it reaches `safe_spots_near`. It MUST NOT call the OS geocoder (`expo-location`'s `geocodeAsync`) or any hosted geocoding service: the OS geocoder is a third-party lookup wearing a platform API, and it would hand a user-typed place name to Apple or Google on a screen whose entire premise is that we do not do that. |
| R50 | **SHOULD** | The last locality the user searched SHOULD persist, so a location-denied user does not retype their town on every launch. |
| R51 | **MUST** | A user who denies permission MUST be able to grant it later from within the map screen (a single "Use my location" affordance that deep-links to OS settings when the OS will no longer prompt). |
| R71 | **MUST** | The gazetteer MUST be a versioned dataset in the repo, bundled with the app, covering the launch metros and their surrounding counties — a few hundred rows of `(name, aliases, postal codes, admin region, centroid, default zoom)`. Search MUST be a local prefix-and-alias match over it with no network call, and a miss MUST say so honestly (§8.3) rather than falling back to any remote lookup. This is deliberately a small, dumb dataset: it covers exactly the geography where the product functions, and self-hosted Photon is the documented Phase 2 answer if we outgrow it ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)). |

### 5.7 Performance budget and degradation

| ID | Req | Statement |
| --- | --- | --- |
| R52 | **MUST** | The client MUST hold at most **200** features in the supercluster index and MUST render at most **60** markers simultaneously post-clustering. |
| R53 | **MUST** | Map pan and zoom MUST sustain ≥ 55 fps with no frame exceeding 32 ms on the reference device. |
| R54 | **MUST** | When the budget is exceeded, degradation MUST follow this order and no other: (1) drop marker glyph detail to flat dots, (2) raise clustering aggression to `minPoints: 2` / `radius: 80`, (3) raise the refetch debounce from 400 ms to 1200 ms and show the staleness affordance, (4) drop base map tiles to a neutral background with markers still correctly positioned, (5) offer the list view persistently. |
| R55 | **MUST NOT** | Degradation MUST NOT reduce the query radius. Silently showing a user less of the world than they asked for is a correctness bug wearing a performance costume. |
| R56 | **MUST** | The marker layer MUST be wrapped in its own error boundary, so a rendering crash in a marker cannot take down the tab bar, the FAB, or the "View as list" escape. |
| R57 | **MUST** | `@maplibre/maplibre-react-native` MUST be imported in exactly one file, `src/features/map/components/MapCanvas.tsx`, enforced by lint ([Mobile Architecture §1.1](../01-architecture/02-mobile-architecture.md), [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)). The same lint rule MUST ban `react-native-maps` and `@rnmapbox/maps` anywhere in the tree, so the superseded renderer cannot return by accident. |
| R58 | **MUST** | Cold start to interactive map MUST be p95 < 2.5 s, measured from the app-start transaction to the first frame with markers painted. **Tiles are explicitly not part of this measurement** — a map with markers over a blank background is interactive, and letting tile latency into the cold-start number would make our headline metric a function of CDN edge warmth. |
| R72 | **MUST** | Tile requests MUST serve p95 **< 300 ms** at the CDN edge in a launch market, measured server-side. This is [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)'s own revisit trigger; breaching it is a signal to take the managed-tiles fallback, not to add client-side workarounds. |
| R73 | **MUST** | Time to first painted tile MUST be p95 **< 1.0 s** from map-canvas mount on the reference device against a warm edge, and the map MUST be pannable and tappable before the first tile arrives. A map that blocks interaction on tiles has made the basemap load-bearing, which R77 says it is not. |

> **R53 is the shipping floor; the spike gate is stricter.** [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) sets the reset spike's pass criterion at **60 fps pan/zoom at 200 markers** on the Android floor device. R53's ≥ 55 fps with no frame over 32 ms is what we hold in production across the device fleet. If the spike cannot reach 60 on the floor device, the answer is ADR-0013's renderer behind the seam (§14) — not a quiet renegotiation of R53.

### 5.8 The list view

| ID | Req | Statement |
| --- | --- | --- |
| R59 | **MUST** | `/map/list` MUST use the same query, filters, radius, and search as the map, rendered as a distance-sorted `FlashList` of safe spots, each expandable into its listings. |
| R60 | **MUST** | The list MUST be reachable from a header button on the map that is always visible and labelled "View as list". |
| R61 | **MUST** | The list MUST be the default tab content when `AccessibilityInfo.isScreenReaderEnabled()` is true. |
| R62 | **MUST** | The map/list choice MUST be sticky across launches. Bouncing someone back to a map they cannot use is worse than not offering the list. |
| R63 | **MUST** | Every feature added to the map MUST be added to the list in the same pull request. A feature that exists only on the map is a regression no test catches. |

### 5.9 Empty and cold-start states

| ID | Req | Statement |
| --- | --- | --- |
| R64 | **MUST** | An empty viewport (zero listings within radius) MUST distinguish four causes and render different copy for each: (a) no safe spots at all in range, (b) safe spots but zero listings, (c) filters or search excluded everything, (d) offline with no cache. |
| R65 | **MUST** | Case (c) MUST show the active filters and a one-tap "Clear filters" action. |
| R66 | **MUST** | Case (b) MUST offer the two actions that actually fix it — widen the radius, or publish something — rather than a shrug. |
| R67 | **SHOULD** | Case (a) SHOULD state honestly that Sharecropr has not launched in this area and offer to notify the user when it does. Pretending a metro exists where it doesn't is how a review reads "empty app". |
| R68 | **MUST** | An empty map MUST NOT render a spinner, a zero, or a bare "No results". Every empty state carries a next action. |

### 5.10 Basemap, tiles, and attribution

The basemap used to be somebody else's problem. It is now ours, and the requirements below are the price of that ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). Two of them — R75 and R76 — are legal obligations under ODbL 1.0 rather than product decisions, and they are the only requirements in this spec that a well-meaning redesign could breach without anything appearing broken.

| ID | Req | Statement |
| --- | --- | --- |
| R74 | **MUST** | The map style MUST be a single style JSON versioned in the repo (`src/features/map/style/sharecropr-basemap.json`), reviewed like code, pointing at a specific dated PMTiles archive ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). The client MUST NOT fetch a style, a sprite sheet, or a font glyph range from any host we do not control, and MUST NOT construct a style at runtime from a remote descriptor. |
| R75 | **MUST** | **"© OpenStreetMap contributors" MUST be rendered on the map, legibly, unconditionally, in every state.** Not on tile-load success; not once tiles arrive; not when the user is online. It MUST also appear on every screen that displays OSM-derived safe-spot data ([SPEC-007-R58](SPEC-007-safe-spots.md)) and on a credits screen. This is an ODbL 1.0 obligation: removing it is a licence breach first and a failing test second. |
| R76 | **MUST NOT** | The attribution MUST NOT be obscured, clipped, faded below the contrast floor, or collapsed behind a tap-to-reveal affordance by any other UI. The sheet at any detent, the offline banner, the rate-limit countdown, the degraded chip, the empty-state card, the FAB, and the chip row MUST reposition it rather than cover it, and the layout MUST guarantee this rather than achieve it by luck of z-order. An "ⓘ" button that reveals the notice on tap does not satisfy R75. |
| R77 | **MUST** | Tile failure — network error, 404 on the archive, CDN outage, cold cache in airplane mode — MUST degrade to a neutral background with markers still rendered at correct geographic positions, the camera still functional, and the attribution still present (R75). It MUST NOT show a modal, MUST NOT block, and MUST NOT prevent a user opening a spot, sending a request, or completing any step of the exchange flow. A non-blocking chip (§8.3) is the entire user-facing treatment. |
| R78 | **MUST** | Tile requests MUST be plain, cacheable HTTP `GET`s with range headers to our own tile origin, carrying **no API key, no `Authorization` header, no cookie, no session token, and no user or device identifier**. The absence of a credential is the point: it means a tile request is not attributable to a user even by us, and it means there is no key to rotate, leak, or restrict. |
| R79 | **MUST NOT** | No request originating from the map screen — tiles, sprites, glyphs, style, or geocoding — may go to a host other than the Sharecropr tile origin or the Sharecropr Supabase origin. Asserted at the wire level (T78) rather than by reading imports, because a transitive dependency phoning home is exactly the case an import audit misses. |
| R80 | **MUST NOT** | No coordinate may appear in a tile request beyond the standard `z/x/y` addressing implied by the viewport, plus PMTiles byte-range offsets. No viewport centre, no user position, no `safe_spot_id`, no locality string, in a URL, a query parameter, a header, or a body. `z/x/y` is a public grid index; a `?lat=&lng=` is a coordinate, and the difference is the whole of [Location Privacy §6](../01-architecture/04-location-privacy.md). |
| R81 | **MUST NOT** | Basemap freshness is a **server-side concern**. The client MUST NOT compute, display, or branch on basemap age, and MUST NOT show a "map may be out of date" notice. A stale basemap is detected by `basemap_age_days` in [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)'s pipeline and fixed by repointing the style — with no app release and no client logic. The staleness banner in §8.2 is about **listing counts**, which change hourly; conflating it with basemap age would teach users to ignore the one that matters. |
| R82 | **MUST** | The map MUST render identically on iOS and Android for the same style, camera, and marker set. Parity MUST be asserted by a screenshot diff in CI over a fixed fixture at three zoom levels, with a perceptual threshold tight enough to catch a missing sprite or a font-fallback difference. Identical rendering is the main product benefit of owning the renderer ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)); untested, it is just an aspiration. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.safe_spots`](../01-architecture/03-data-model.md#9-safe-spots) | read (via `safe_spots_near` and by id) | The only precise coordinates the client receives |
| `public.listings` | read (via `safe_spots_near` aggregate, `search_listings`, and the sheet's list) | Pattern D policy applies; blocked and suspended owners never enter the result set |
| `public.listing_safe_spots` | read | Join for the aggregate |
| `public.crop_species` / `crop_categories` | read (bundled + cached) | Filter chips and species search; `staleTime: Infinity` |
| `private.garden_locations` | **none** | Named to be explicit: the map has no path to it, and `safe_spots_near` has no column that could carry its contents |
| `public.blocks` | read (inside `app.is_blocked_either_way`, definer) | Applied inside the count aggregate, so a blocked user's listings do not contribute to a count the blocker sees |

Columns of `public.safe_spots` this spec reads beyond the marker payload, all **P3** and all added by [SPEC-007](SPEC-007-safe-spots.md)'s migration ([Data Model §9](../01-architecture/03-data-model.md#9-safe-spots)):

| Column | Why the map cares |
| --- | --- |
| `source` (`safe_spot_source`) | `'osm_import'` marks a row as OSM-derived, which is what makes R75's attribution obligation apply to the screen showing it |
| `osm_type` / `osm_id` | Provenance. Not rendered; read by the credits screen's aggregate count and by support when a pin is wrong |
| `osm_source_licence` | `'ODbL-1.0'`. The attribution string is a constant, not derived from this column — but a row whose licence is not ODbL would be a data bug we want to be able to find |

The map does **not** branch on `source`: an OSM-imported spot and a hand-curated one render identically, because both have passed the same human verification gate ([SPEC-007 §5.7](SPEC-007-safe-spots.md)). Provenance is a compliance and support fact, not a quality signal to show a user.

**New schema objects introduced by this spec:** none. `safe_spots_near` is defined in [Location Privacy §6](../01-architecture/04-location-privacy.md) and `search_listings` in [API Contract §5.3](../01-architecture/06-api-contract.md); this spec consumes them and adds no schema. The only new artefacts are client-side: `MapCanvas`, `useMapMarkers`, `useFollowMode`, `useViewportQuery`, `domain/geo/quantize.ts`, the versioned style JSON and sprite sheet (R74), and the bundled locality gazetteer (R71).

**PII touched:** the caller's own device position, transiently, as `p_lat`/`p_lng`. Classified **P1**. It is quantized to ~100 m before transmission, never persisted client-side (R10), excluded from statement logging for this function, and removed by the telemetry scrubber's coordinate rule. It is not stored anywhere at any point. No other user's location data is read, derived, or rendered by any code path in this spec.

## 7. API

### 7.1 `rpc.safe_spots_near`

**Auth:** `authenticated`
**Rate limit:** **30 / min / user** (Postgres token bucket — the primary anti-scraping control)
**Definition:** verbatim in [Location Privacy §6](../01-architecture/04-location-privacy.md). Not restated here; the data model and privacy doc are authoritative.

```jsonc
// Request — lat/lng quantized to ~100 m client-side before transmission
{ "p_lat": 42.281, "p_lng": -83.743, "p_radius_m": 8000, "p_category_ids": [2, 4] }
```

```jsonc
// Response 200
[{
  "safe_spot_id": "3f2a9c11-…",
  "name": "Ann Arbor District Library — Downtown",
  "category": "public_library",
  "lat": 42.28031, "lng": -83.74797,
  "distance_m": 612.4,
  "listing_count": 7,
  "top_categories": [2, 4, 6]
}]
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | `p_lat` outside ±90, `p_lng` outside ±180, `p_radius_m` ≤ 0 |
| `rate_limited` | 429 | 30/min bucket empty. `Retry-After` in integer seconds. |
| `unauthenticated` | 401 | Missing or expired JWT |

Properties this spec depends on and must not undermine:

- The `RETURNS TABLE` declaration has **no column capable of holding a user coordinate**. A catastrophic bug in the function body cannot leak one.
- `LEAST(p_radius_m, 40000)` caps the radius server-side. R32's 40 km ceiling is a UI affordance over a server-enforced cap, not the enforcement itself.
- `LIMIT 200` bounds both the response and the scraping yield, and is simultaneously the client's performance contract (R52).
- Blocks are applied inside the aggregate, so a blocked user's listings do not contribute to a count.
- **Not paginated, deliberately.** Pagination would let an attacker walk past the 200-row cap.

### 7.2 `rpc.search_listings`

**Auth:** `authenticated`
**Rate limit:** 30 / min / user
**Shape:** [API Contract §5.3](../01-architecture/06-api-contract.md).

Used for species search (R30) and for the sheet's listing list when a search is active. Ranking is trigram similarity on `common_name || aliases`, then distance from the **nearest attached safe spot**, then `published_at DESC`. Distance is never to a garden; the function has no access to a garden point and no column to return one.

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Out-of-range coordinates, `p_limit` > 100 |
| `rate_limited` | 429 | Bucket empty |

### 7.3 `GET /rest/v1/safe_spots?id=eq.<uuid>`

Sheet detail. Shape in [API Contract §4.3](../01-architecture/06-api-contract.md), semantics in [SPEC-007 §7.1](SPEC-007-safe-spots.md). Cached 24 h client-side; buildings do not move.

### 7.4 What the map deliberately does not call

| Not called | Why |
| --- | --- |
| `get_my_garden_location` | The map has no use for the caller's own garden coordinate. Calling it here would put an exact point into the map screen's memory for no product reason, and the 10/min limit exists because any volume on it is anomalous. |
| Any realtime channel | Map counts are polled at 60 s. A `map:` channel would mean per-metro fanout for a number that changes slowly ([Realtime & Notifications §8.3](../01-architecture/08-realtime-and-notifications.md)). |
| **Any third-party tile vendor** (MapTiler, Stadia, Mapbox, Google, Apple) | Tiles come from our own PMTiles archive on our own CDN ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). Whoever serves tiles learns every user's viewport continuously; there is no vendor in that position because there is no vendor. R79 asserts it on the wire, and R78 means the requests carry nothing to attribute anyway. |
| **Any third-party geocoder**, including the OS geocoder | Locality search is a local lookup in the bundled gazetteer (R71). `expo-location`'s `geocodeAsync` is a platform API wrapping a vendor service, and calling it would send a user-typed place name to Apple or Google from the one screen in the app whose purpose is that this does not happen. |
| `tile.openstreetmap.org` | Prohibited by the [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) for app-scale use, and enforced by User-Agent blocking. Listed explicitly so nobody proposes it as a quick fix during a CDN incident ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Map | `/map` | Default tab. Camera, markers, chips, search, radius, FAB. |
| List | `/map/list` | The accessible and low-end-device equivalent; same data, distance-sorted |
| Safe-spot sheet | `/(modals)/safe-spot/[safeSpotId]` | What's available here ([SPEC-007 §8](SPEC-007-safe-spots.md)) |
| Filters | `/(modals)/filters` | Category chips (also inline), radius, sort |
| Species picker | `/(modals)/species-picker` | Search-by-species entry |

Map chrome layout, top to bottom: search field (floating, top, respecting the safe area) → filter chip row (horizontally scrolling, directly under search) → map canvas → radius pill (bottom-left) → recentre button (bottom-right, above the FAB, only when `following = false`) → inventory FAB (bottom-right) → "View as list" (header-right, always).

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | The map canvas and base tiles render immediately. Markers paint from the persisted cache on the first frame they are available (R18); the network result reconciles silently. A skeleton is never shown over the map — a blank map that fills in beats a spinner over nothing. A thin indeterminate progress bar under the search field indicates an in-flight viewport query and nothing else. |
| Empty | Four distinct cases (R64). (a) **No coverage:** a centred card over a dimmed map, "Sharecropr isn't here yet", with a notify-me action. (b) **Spots, no listings:** markers render in the empty band, plus a bottom card with the widen-radius and publish actions. (c) **Filtered out:** the filter chips stay visible and highlighted, plus a card with "Clear filters". (d) **Offline, no cache:** the offline state below. |
| Error (recoverable) | Viewport query failed (5xx, timeout). Last successful markers stay on screen, a persistent bottom banner appears with the copy in §8.3 and a Retry action. The map remains pannable; panning re-arms the debounce and retries naturally. |
| Error (terminal) | Only two cases reach terminal: the map SDK failed to initialise, and the marker layer's error boundary caught a crash. Both render an in-place error card with two actions — "Try again" and "View as list" — because the list is a complete escape from every map failure. The tab bar stays alive. |
| Offline | Last-known `safe_spots_near` result for the last-viewed viewport renders with counts greyed, plus a **persistent** staleness banner: counts are the thing most likely to be wrong. Safe-spot details come from the 7-day cache. Tiles come from MapLibre's on-disk tile cache for areas the user has already viewed; outside it, a neutral background with correctly positioned markers and the tile-failure chip (R77). Attribution renders throughout (R75) — the cached tiles are still OSM, and the spot data still is too. The banner is never a toast — this is a condition, not an event. **There are no offline map packs in MVP** (§3): last-known-state plus this banner is the whole offline story. |
| Permission denied | The avatar dot and recentre button are absent (R48). The search field's placeholder becomes "Search a town or postcode". A one-line, dismissible-per-session strip offers "Use my location" which deep-links to OS settings when the OS will no longer prompt. Every other control works. |
| Rate limited | 429 on `safe_spots_near`. Viewport queries stop for `Retry-After` seconds. Existing markers stay. A bottom banner shows a live countdown ("Too many map updates. Refreshing in 38 s"). Panning is not blocked — only the query is. No auto-retry. |

Two additional states specific to this screen:

| State | Behaviour |
| --- | --- |
| Degraded (performance) | Entered when the frame budget is missed for 3 consecutive seconds. The ladder in R54 applies in order. A subtle chip reads "Simplified view" with a tap-through explaining why and offering the list. It exits when the budget is met for 10 consecutive seconds — hysteresis, so the map does not oscillate. |
| Search active with zero results | Markers clear, the search field shows "No one has courgettes within 8 km", and two actions appear: widen radius, or clear search. The empty-viewport card is **not** shown; a search with no hits is a different fact from an empty area. |

### 8.3 Copy

Exact strings.

**Location permission prompt (pre-permission explainer, shown before the OS dialog)**
> **Show what's nearby?**
> Sharecropr uses your location to centre the map and show you meeting places close to you. Your location is never shared with other users, and we never show anyone where you or your garden are.
>
> Buttons: `Not now` · `Continue`

**OS permission string (`NSLocationWhenInUseUsageDescription`)**
> To place your garden and show you what's available nearby.

**Permission denied strip**
> Using a searched location. **Use my location**

**Empty (a) — no coverage**
> **Sharecropr isn't here yet.**
> We're live in two metro areas while we build out safe meeting places. Tell us where you are and we'll let you know when we reach you.
>
> Button: `Notify me`

**Empty (b) — spots, no listings**
> **No crops here yet.**
> There are {n} meeting places nearby, but nobody's offering anything right now. This happens a lot early in a season — and in a new area, the first person to list is the one who gets everyone else started.
>
> Buttons: `Widen to 20 km` · `Publish something`

**Empty (c) — filtered out**
> **Nothing matches those filters.**
> {n} places nearby have crops available, just not in the categories you picked.
>
> Button: `Clear filters`

**Empty (d) — offline, no cache**
> **You're offline.**
> We don't have a saved map for this area yet. Connect and we'll load it.
>
> Button: `Retry`

**Search, zero results**
> No one has {species} within {radius} km.
>
> Buttons: `Search 40 km` · `Clear search`

**Offline staleness banner (persistent)**
> Showing what was available {relative_time} ago.  ·  `Retry`

Where `{relative_time}` is "2 hours", "yesterday", "3 days" — never a raw timestamp.

**Recoverable error banner**
> Couldn't refresh the map. **Retry**

**Terminal error card**
> **The map didn't load.**
> Something went wrong rendering the map on this device.
>
> Buttons: `Try again` · `View as list`

**Rate-limit banner**
> Too many map updates. Refreshing in {n} s.

**Map attribution (R75 — rendered unconditionally, on the map and on every screen showing OSM-derived spot data)**
> © OpenStreetMap contributors

Exact string, including the `©` character and the capitalisation of "OpenStreetMap". It is **not** localised, **not** abbreviated to "© OSM", and **not** truncated with an ellipsis at any type size — above 130% dynamic type the map chrome reflows around it. Its `accessibilityLabel` is "Map data from OpenStreetMap contributors", and it is tappable to reach the credits screen, but the tap is an addition to the visible notice and never a replacement for it (R76).

**Tile-failure chip (non-blocking, bottom-left, above the radius pill)**
> Map background unavailable

**Tile-failure explainer (on tap)**
> **The map background didn't load.**
> Everything else is working. The places shown are in their real positions, and you can open them and arrange an exchange as normal.
>
> Button: `Try again`

Not a dialog, not a banner, and not shown at all when the offline staleness banner is already up — offline already explains it, and two notices about one condition read as two problems.

**Locality search, no match in the gazetteer**
> **We don't know that place yet.**
> Sharecropr is live in two metro areas, so we only carry place names from those. Try a nearby town or postcode.

**Degraded chip**
> Simplified view

**Degraded explainer (on tap)**
> **We've simplified the map.**
> There's a lot to draw here and we've reduced the detail to keep it smooth. Everything is still accurate — the list view shows the same places with full detail.
>
> Button: `View as list`

**Radius control label**
> Within {n} km

**Filter chip row, clear-all**
> Clear all

**Marker accessibility label (map)**
> {category_label}, {n} items available

**Cluster accessibility label**
> {n} meeting places, {m} items available. Double tap to zoom in.

**List row accessibility label**
> {name}, {category_label}. {distance} away. {n} items available including {top three species}. {open_state}. Double tap to see what's available.

**"View as list" button label**
> View as list

**Recentre button accessibility label**
> Recentre on my location

**Inventory FAB**
> `accessibilityLabel`: Add to inventory · `accessibilityHint`: Opens the new item form

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Bulk-harvest supply data and infer where users are.** The attacker cannot get a garden coordinate — there is no column for one — but by sweeping `safe_spots_near` from many origins while a target's listing is active, they can narrow the target to the intersection of that listing's up-to-three safe spots, realistically a few square kilometres. This is stated as accepted residual risk in [Location Privacy §12.4](../01-architecture/04-location-privacy.md) and is bounded, not eliminated, by the 200-row cap, the 30/min per-user token bucket, and the fact that listings attach to up to three spots. A secondary risk is the client itself leaking the caller's own position through a breadcrumb or an analytics property, which R10 and the scrubber address. |
| Which RLS policies enforce access? | `safe_spots_read` (`status = 'active'`) and `listings_select_discoverable` (Pattern D: owner-or-discoverable, unexpired, not blocked either way, owner not suspended or deleted) — [RLS Design §5](../01-architecture/05-rls-design.md). Definer functions: `public.safe_spots_near`, `public.search_listings`, `app.is_blocked_either_way`. `safe_spots_near` runs as definer and therefore bypasses RLS on `listings`, which is why it applies `NOT app.is_blocked_either_way(auth.uid(), l.owner_id)` explicitly inside the aggregate — the definer function re-implements the policy it bypasses. |
| Can any response path expose an exact coordinate or PII? | Yes, exactly one, deliberately: `safe_spots.point` via `safe_spots_near.lat/lng`. That is a public building and is one of the two entries on the CI coordinate-column allowlist (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)). No response on this screen carries a garden coordinate, an fine-tier cell, a `display_point`, or a user's position. The caller's own position travels **inbound only**, quantized, and is never echoed. |
| What is logged, and is it scrubbed? | `p_lat`/`p_lng` are excluded from Supabase statement logging for `safe_spots_near` and `search_listings` ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)). Client-side, the Sentry `beforeSend` scrubber deletes any key matching `/lat|lng|latitude|longitude|coord|point|geohash|fine_cell/i` at any depth, and the PostHog wrapper rejects any property that parses as a coordinate. Map analytics events carry `safe_spot_id`, zoom band, and radius — never a viewport centre. |
| Does this need step-up authentication? | No. Browsing is never gated on identity verification, let alone AAL2 ([Mobile Architecture §3.2](../01-architecture/02-mobile-architecture.md)). An unverified user gets the full map. |
| Who learns which map areas a user looks at? | **Nobody outside our infrastructure.** A tile request necessarily reveals a viewport to whoever serves the tile, at whatever zoom, whenever the user pans — so under a platform-native basemap, Apple and Google received a continuous stream of that. We serve tiles ourselves ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)), so no third party is in that position, and R78 means the requests carry no credential or identifier that would let even us attribute them to a user. **This is a secondary benefit and this spec will not oversell it**, per [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)'s own strongest-argument-against: Apple and Google already know where the user is continuously at the OS level, so a tile request telling them the user is looking at a map of Ann Arbor discloses nothing new. The honest framing is consistency — we spent an entire architecture preventing third parties from learning where users are, and a basemap that streamed viewports to an ad-adjacent company was an inconsistency that would have needed a threat-model entry and a sub-processor disclosure. Removing it is tidiness with a real but modest security value, not a mitigation of a live threat. |
| Abuse / rate-limit controls | `safe_spots_near`: 30/min/user, Postgres token bucket — the primary anti-scraping control, and the one that a scraper with 50 accounts cannot defeat with IP rotation. `search_listings`: 30/min/user. Kong applies a per-IP layer above both. Client-side, the 400 ms debounce and quantized cache key mean ordinary panning generates a small fraction of the budget; a client hitting 429 through normal use is a bug in the debounce, and the §11 alert on that is how we would find out. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | User grants location, then revokes it in OS settings while the app is backgrounded. | On foreground, the client re-reads permission status, drops the avatar dot and recentre button, keeps the last camera position, and shows the permission-denied strip. It does not re-prompt and does not reset the camera to a default. |
| EC-02 | Device returns a location fix with 3 km accuracy (indoor, no GPS). | The fix is used — quantization to 100 m makes accuracy differences largely moot for the query — but the avatar dot renders with an accuracy halo so the user understands why the map is centred oddly. Follow mode still works. |
| EC-03 | User pans 2,000 km to another continent. | `safe_spots_near` returns zero rows. Empty case (a) renders. No error. The radius is unchanged and the recentre button is prominent. |
| EC-04 | Exactly 200 spots are within the radius in a dense metro. | The cap truncates by distance ascending, so the nearest 200 are shown. The client detects `length === 200` and shows an inline note in the list view ("Showing the 200 closest places — zoom in for more"). It does **not** silently pretend the result is complete, and it does **not** reduce the radius (R55). |
| EC-05 | The user is at a cell boundary and a cell-based recall bug bites. | Not reachable: `safe_spots_near` uses `ST_DWithin` only, never a cell ([ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md)). Covered by [TC-GEO-07](../04-testing/03-geospatial-test-plan.md). Named here so nobody "optimises" this query into a cell lookup. |
| EC-06 | A pinch gesture spans several integer zoom levels quickly. | Clustering recomputes only on integer-zoom change (R22), so at most one recompute per level crossed, each < 8 ms. Markers do not jitter. The viewport query does not fire until 400 ms of stillness (R14). |
| EC-07 | A marker's `listing_count` changes from 4 to 5 while the user is looking at it (band change). | The marker sets `tracksViewChanges={true}` for ~300 ms to re-rasterise, then returns to `false` (R25). The count badge animates; the marker does not move. |
| EC-08 | The user opens the sheet, then rotates the device. | The sheet is a route, so it survives rotation. The map re-insets to the new sheet height and re-centres the selected marker into the visible region, without moving the camera centre in map space (R40). |
| EC-09 | Deep link to `/(modals)/safe-spot/[id]` for a spot that has just been suspended. | The router resolves the target *after* a `fetchQuery`, gets a 404, and lands on the map tab root with a toast rather than on a broken sheet ([Mobile Architecture §3.1](../01-architecture/02-mobile-architecture.md)). |
| EC-10 | The user blocks someone whose listings are the only supply at a nearby spot. | On the next viewport query (≤ 60 s), that spot's `listing_count` drops to 0 and its marker moves to the empty band. The count changes inside the server aggregate, so there is no client-side filtering step that could get it wrong, and the blocked user is never told ([SPEC-012-R28](SPEC-012-trust-and-safety.md)). |
| EC-11 | A species search returns results at 200 spots and the user then applies a category filter that excludes all of them. | Empty case (c). The search text and the filter chips both remain visible, and "Clear filters" clears only the filters, not the search. Two independent narrowings need two independent escapes. |
| EC-12 | `search_listings` succeeds but `safe_spots_near` 429s in the same interaction. | The marker set is derived from the search result for the duration of the limit; the rate-limit banner shows. The screen degrades to search-only rather than going blank. |
| EC-13 | Cold start on a device whose persisted cache is from a different contract version. | The persistence `buster` includes the schema contract version, so the cache is discarded rather than rehydrated into a screen that reads a missing column ([Mobile Architecture §2.3](../01-architecture/02-mobile-architecture.md)). The map shows the loading state and paints from the network. |
| EC-14 | Base map tiles fail (CDN error, missing PMTiles archive, cold cache) but the RPC succeeds. | Markers render at correct positions over a neutral background, and the attribution stays (R75, R77) — the spot data is still OSM-derived even when no tile loaded. The non-blocking chip appears; no dialog, no blocked flow. This is also step 4 of the degradation ladder and is a fully usable map ([System Architecture §2](../01-architecture/01-system-architecture.md)). |
| EC-15 | A screen-reader user has the sticky preference set to "map" from before enabling the reader. | R61 wins on the launch where the reader is detected as enabled: the list is shown, and a one-time note explains it with a "Use the map instead" escape that updates the sticky preference. Detection overrides a stale preference exactly once, then defers to the user. |
| EC-16 | The user sets radius to 40 km in a rural area and 200 spots come back at 39 km. | Handled as EC-04. Additionally, the "Simplified view" ladder is likely to engage; the list view is offered prominently, and for a rural user scanning 40 km, the list is usually the better screen anyway. |
| EC-17 | Two viewport queries race: a slow one from an earlier pan resolves after a faster later one. | TanStack Query keys are per-quantized-viewport, so the stale response lands in its own cache entry and is never rendered for the current viewport. No manual sequencing needed — this is why R13 is a `MUST`. |
| EC-18 | The style JSON points at a PMTiles archive that has been deleted or reverted server-side. | Identical to EC-14 from the client's point of view — the client has no concept of "wrong archive" (R81). The fix is repointing the style at the previous dated archive, which needs no app release ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)); detection is `map.tiles_failed` in §11, not anything on the device. |
| EC-19 | The launch metro's tiles are fine but the user pans to a region outside the regional extract. | Empty tiles over the neutral background, markers absent because `safe_spots_near` returns none, and empty case (a) renders. The tile-failure chip is **not** shown: an area we deliberately do not cover is not a failure, and calling it "unavailable" would imply a bug ([ADR-0020 §Coverage strategy](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). |
| EC-20 | A place label falls back to a different font on Android than on iOS. | An R82 parity failure, caught by the CI screenshot diff rather than in the field. Glyph ranges are served from our own style bundle (R74) precisely so that label rendering does not depend on what fonts the OS happens to have. |
| EC-21 | A UI change adds a bottom banner that lands on top of the attribution. | R76 violation, caught by T77's geometric assertion rather than by a reviewer noticing. Treated as a licence incident, not a layout bug: the fix ships in the next update and the occurrence is recorded, because "we breached ODbL for six weeks and nobody checked" is the failure this test exists to prevent. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `map.opened` | product event | `has_location_permission`, `radius_km`, `is_list_view`, `cold_start` | — |
| `map.cold_start_to_interactive_ms` | histogram | `platform`, `device_class` | **p95 > 2500 ms** ([NFR](../00-foundation/05-nfr.md)) |
| `map.viewport_query_ms` | histogram | `radius_km`, `result_count`, `cache_hit` | server-side p95 > 400 ms |
| `map.frame_drops` | counter | `frames_over_32ms`, `duration_s` | > 5% of map sessions entering degraded state |
| `map.degradation_entered` | product event | `step` (1–5), `marker_count`, `device_class` | > 2% of sessions reaching step 3+ |
| `map.result_capped` | counter | `radius_km`, `locality` | Rising trend ⇒ [API Contract §10 Q2](../01-architecture/06-api-contract.md) (is 200 the right cap?) |
| `map.empty_viewport` | product event | `cause` (`no_coverage`\|`no_listings`\|`filtered`\|`offline`), `radius_km`, `metro_slug` | `no_listings` > 60% of map opens in a live metro ⇒ **liquidity alarm**, escalate to Product |
| `map.radius_changed` | product event | `from_km`, `to_km`, `cause` (`user`\|`empty_state_action`) | — |
| `map.filter_applied` | product event | `category_ids`, `result_count` | — |
| `map.species_searched` | product event | `species_id`, `result_count`, `radius_km` | zero-result rate > 50% ⇒ supply mix is wrong for demand |
| `map.marker_pressed` | product event | `safe_spot_id`, `listing_count`, `is_cluster` | — |
| `map.recenter_pressed` | product event | — | Unusually high per-session count ⇒ suspect the follow-mode gesture-flag bug (R05) |
| `map.follow_mode_lost_without_gesture` | error event | `platform` | **Any occurrence** — this is the R05 bug and it is invisible to users as anything but "the button doesn't work" |
| `map.permission_result` | product event | `granted`, `was_reprompt` | Denial rate > 40% ⇒ the pre-permission explainer copy is not working |
| `map.list_view_used` | product event | `reason` (`screen_reader`\|`preference`\|`degradation`\|`manual`) | — |
| `map.rate_limited` | error event | `endpoint` | > 0.5% of sessions ⇒ the debounce is wrong, not the limit |
| `map.tiles_failed` | error event | `platform`, `style_version` | > 2% of sessions ⇒ CDN, archive, or network-policy issue — check `basemap_age_days` and the archive URL before suspecting the client |
| `map.tile_load_ms` | histogram | `platform`, `z`, `cache` (`cold`\|`warm`) | **p95 > 300 ms** at the edge (R72) — an [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md) revisit trigger, not a client bug |
| `map.time_to_first_tile_ms` | histogram | `platform`, `device_class` | p95 > 1000 ms (R73) |
| `map.attribution_missing` | error event | `screen`, `state` | **Any occurrence.** A client-side assertion fires if the attribution node is unmounted or has zero measured area while the map is visible. This is a licence-breach detector, and its threshold is one |
| `map.locality_search` | product event | `matched` boolean, `metro_slug` when matched | Miss rate > 30% ⇒ the gazetteer's coverage is too narrow for where users actually are (R71) |

**Never emitted, at any threshold:** the viewport centre, the device position, the resolved locality coordinate, or any property from which one could be derived. `map.empty_viewport` carries `metro_slug`, which is a coarse label attached to safe spots, not a user-derived cell. Spatial analytics are capped at the region tier ([Location Privacy §8](../01-architecture/04-location-privacy.md)).

## 12. Accessibility

- **`/map/list` is the accessible path and it is a real screen, not a fallback** ([Mobile Architecture §10.4](../01-architecture/02-mobile-architecture.md)). A map is not usable with a screen reader: VoiceOver and TalkBack over a cluster of markers produce an unordered stream of "button, button, button" with no spatial meaning, and pinch-to-zoom is unavailable when the reader owns the gesture layer. This is not a labelling problem and no `accessibilityLabel` fixes it.
- The list is automatically preferred when a screen reader is enabled (R61), reachable from an always-visible header button (R60), settable as a persistent preference, and **sticky** (R62).
- It is also step 5 of the performance degradation ladder (R54), which means ordinary users on low-end devices exercise it and it stays maintained. Tying the accessibility path to a performance path is deliberate: an accessibility path only accessibility users touch is one that breaks silently.
- Every list row is **one** accessible element with a composed label (§8.3), not five separate stops.
- Map markers still carry labels (`"Public library, 7 items available"`) so a low-vision user with magnification but not a reader gets meaning, and so Maestro can select them.
- Filter chips: `accessibilityRole="button"` with `accessibilityState={{ selected }}`. Selection is never conveyed by colour alone — a selected chip carries a checkmark glyph and its label reads "{category}, selected".
- The radius control is a discrete stepper (R34) with `accessibilityRole="adjustable"`, `accessibilityValue={{ text: "Within 8 kilometres" }}`, and increment/decrement actions. A continuous slider is unusable with a screen reader and produces a query per pixel.
- Availability bands are conveyed by shape and by the count badge, never by colour alone (R19).
- The attribution (R75) is a static, focusable text element in the reading order, meeting the 4.5:1 contrast floor against every basemap and every degraded background, and scaling with dynamic type rather than truncating. It is never conveyed as an icon, and its accessible name is "Map data from OpenStreetMap contributors" — a screen-reader user receives the attribution too, which is what an ODbL obligation on a "reasonably visible" notice means when the user cannot see.
- The offline banner and the rate-limit countdown use `accessibilityLiveRegion="polite"`. The degraded-view chip does not — it would interrupt on every hysteresis crossing.
- Sheet detent changes move focus to the newly revealed heading; dismissing the sheet returns focus to the marker or row that opened it, via `AccessibilityInfo.setAccessibilityFocus` on a ref rather than left to chance.
- All hit targets ≥ 44 × 44 dp, including filter chips and the recentre button. The `Pressable` primitive applies a default `hitSlop` that brings anything smaller up to 44 dp, so correct is the default.
- Dynamic type to 200%. The map marker count badge is one of only two places in the app that caps scaling at 1.3× (it must fit inside a fixed glyph), and the list view is the full-size alternative one tap away — which is another reason it is permanently available rather than a fallback.
- Reduced motion: with `AccessibilityInfo.isReduceMotionEnabled()`, camera animations become instant jumps and the FAB hide/show transition is removed. Cluster expansion still changes zoom, just without the animation.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | e2e | R01 | Fresh install, permission granted, map centres on the mock position at zoom 13 with `following = true` |
| T02 | unit | R02, R03 | `MapCanvas` prop contract accepts exactly one `userLocation`; a snapshot of rendered marker sources contains only safe spots |
| T03 | integration | R03 | Contract sweep: `safe_spots_near`'s return type introspected from `information_schema`; asserts no column outside the two-entry coordinate allowlist |
| T04 | unit | R04, R05 | `useFollowMode` reducer: gesture region change clears follow; programmatic region change does not; parameterised over iOS `isGesture` and Android `reason` |
| T05 | e2e | R05 | Press recentre, assert follow mode is still true 1 s after the animation completes (the classic self-clearing-button bug) |
| T06 | e2e | R06 | Recentre button hidden while following, visible after a pan, restores position and preserves zoom |
| T07 | unit | R07 | Location update with `following = false` leaves camera props identical and moves only the avatar |
| T08 | unit | R09 | Lint/architecture test: `following` is read from the Zustand store, not from `useState`, in the map feature |
| T09 | integration | R10 | Persistence test: after a full map session, no MMKV key and no Sentry breadcrumb contains a coordinate; synthetic Sentry event asserted scrubbed |
| T10 | unit | R11 | Marker source is `safe_spots_near` only; any other repository call in the map feature fails a module-boundary test |
| T11 | unit | R12 | `quantize.ts` property test: 10,000 random points quantize to a ~100 m grid; the same input always yields the same output |
| T12 | unit | R13, R15 | Two camera positions inside one grid cell produce the same query key and exactly one network call |
| T13 | unit | R14 | Debounce: 20 synthetic region changes over 300 ms produce zero calls; one call fires 400 ms after the last |
| T14 | integration | R16 | `staleTime`/`gcTime` configuration asserted from the query client config |
| T15 | e2e | R17 | Forced 429: viewport queries stop, markers persist, countdown banner shown, no auto-retry observed on the wire |
| T16 | e2e | R18 | Cold start with a warm cache paints markers before any network response arrives |
| T17 | unit | R19, R20 | Marker styling: bands at 0, 1, 4, 5, 40; contrast and non-colour differentiation asserted; category glyph present |
| T18 | unit | R21, R22, R27 | Supercluster configured as specified; `getClusters` called with `Math.round(zoom)`; index rebuilt only on data change (call counter) |
| T19 | unit | R23 | Cluster badge equals the sum of member `listing_count`, not the member count |
| T20 | e2e | R24 | Cluster press animates to the expansion zoom and the cluster resolves into its members |
| T21 | unit | R25 | Rendered tree under `MapCanvas` contains exactly one `ShapeSource`/`SymbolLayer` pair and zero `PointAnnotation` / `MarkerView` nodes, including for the selected marker and cluster badges |
| T22 | unit | R26 | Re-render with a structurally identical marker array yields the **same** `FeatureCollection` object reference and zero source updates pushed to native; changing one spot's `listing_count` yields exactly one |
| T23 | unit | R28 | A spot with `listing_count = 0` is present in the rendered marker set |
| T24 | integration | R29 | Category filter is sent as `p_category_ids`; no client-side marker filtering occurs |
| T25 | integration | R30, R31 | Species search calls `search_listings`; result count rendered; marker set restricted to matching spots |
| T26 | unit | R32, R34 | Radius values are exactly [2,5,8,12,20,30,40]; default 8 |
| T27 | integration | R33 | Radius survives a cold start; filters and search do not |
| T28 | unit | R35 | Radius change produces no camera zoom change |
| T29 | e2e | R36 | Applying a filter that empties the map leaves the chip row visible and highlighted |
| T30 | integration | R37 | "courgette" returns Zucchini listings |
| T31 | e2e | R38, R39 | Marker press opens the sheet at 55%; the same URL via deep link opens the same sheet; Android back closes it |
| T32 | e2e | R40 | Camera centre in map space is unchanged after the sheet opens; the selected marker is inside the visible inset region |
| T33 | unit | R41 | Sheet listing list is a `FlashList` with `estimatedItemSize` set |
| T34 | e2e | R42, R43 | FAB position respects safe-area insets; hides above the 40% detent and returns below it |
| T35 | e2e | R44 | FAB long-press offers both actions; both are also reachable from the Inventory tab |
| T36 | e2e | R45, R47, R48 | Deny permission at first open: no avatar, no recentre button, locality search centres the map, sheet and requests work end to end |
| T37 | integration | R46 | CI asserts no `NSLocationAlwaysAndWhenInUseUsageDescription` in the built `Info.plist` and no `ACCESS_BACKGROUND_LOCATION` in `AndroidManifest.xml` |
| T38 | unit | R49 | Gazetteer-resolved locality coordinate passes through the same quantizer before reaching the repository; the map feature contains no call to `geocodeAsync` and no network request is made during a locality search |
| T39 | integration | R50 | Last locality persists across a cold start |
| T40 | e2e | R51 | "Use my location" deep-links to OS settings when the OS will no longer prompt |
| T41 | perf | R52, R53, R58 | Device-farm run: 200 features, ≤ 60 rendered markers, ≥ 55 fps sustained, no frame > 32 ms, cold start p95 < 2.5 s |
| T42 | integration | R54 | Synthetic frame-budget failure drives the ladder in order; each step asserted; hysteresis prevents oscillation |
| T43 | integration | R55 | No degradation step alters `p_radius_m` |
| T44 | unit | R56 | A throwing marker component is caught by the marker error boundary; tab bar, FAB, and list button remain mounted |
| T45 | integration | R57 | Lint rule: `@maplibre/maplibre-react-native` imported only in `MapCanvas.tsx`; `react-native-maps` and `@rnmapbox/maps` imported nowhere, asserted over the whole tree including transitive re-exports |
| T46 | e2e | R59, R60, R63 | List view shows identical data for the same filters/radius/search; header button always present |
| T47 | integration | R61, R62 | With `isScreenReaderEnabled` mocked true, the list is default; the choice persists across launches |
| T48 | e2e | R64–R68 | All four empty causes render their distinct copy and actions; none renders a bare spinner or "No results" |
| T49 | e2e | §8.2 | Offline: airplane mode with a warm cache renders greyed counts and the persistent staleness banner |
| T50 | manual | §12 | VoiceOver and TalkBack pass over `/map/list` and the sheet; focus return verified; 200% type verified |
| T68 | unit | R69, R70 | The `FeatureCollection` handed to `ShapeSource` carries exactly the five permitted properties and nothing coordinate-derived beyond geometry; the source is configured with `cluster` absent or `false`, asserted from the rendered props |
| T69 | e2e | R75 | Attribution is present and legible on the map at first paint, before any tile has loaded, and on the safe-spot sheet, the list rows, both spot pickers, and the credits screen |
| T70 | e2e | R75, R76 | **Attribution survives every UI state.** Parameterised over all §8.2 states — loading, empty (a)(b)(c)(d), recoverable error, terminal error, offline, permission denied, rate limited, degraded, search-with-zero-results — and over the sheet at 25 / 55 / 92%. In each, the attribution node is mounted, has non-zero measured area, and meets the contrast floor |
| T71 | e2e | R77 | Tile origin stubbed to fail: neutral background renders, marker screen positions match the tile-success run within 2 px, no modal appears, and a full flow (open spot → open listing → send request) completes |
| T72 | perf | R72, R73 | Synthetic edge measurement asserts tile p95 < 300 ms in each launch market; on-device run asserts time-to-first-tile p95 < 1.0 s and that pan/tap are responsive before the first tile paints |
| T73 | visual | R82 | Cross-platform render parity: identical style, camera, and fixture marker set on iOS and Android at z11 / z13 / z15; perceptual diff under threshold; a deliberately removed sprite fails the test |
| T74 | unit | R74, R78, R79, R80 | Static half of the tile-request rules: the style is loaded from the in-repo JSON; the style, sprite, glyph, and tile URLs all resolve to the Sharecropr tile origin; the request builder attaches no credential and no parameter beyond `z/x/y` and a `Range` header; no code path assigns a style or tile URL from a remote response or a remote config value. T78–T80 assert the same three requirements on the wire, which is where a transitive dependency would be caught |
| T75 | integration | R71 | Gazetteer resolves every launch-metro locality and its aliases and postal codes with zero network calls; a miss renders the §8.3 no-match copy and issues no request |
| T76 | integration | R81 | Static check: no symbol matching `/basemap.*(age\|stale\|version)/i` is read by any client render path, and no user-facing string mentions the basemap being out of date |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T51 | Call `safe_spots_near` with `p_radius_m = 10000000` | Server caps at 40,000 m via `LEAST`; response contains no spot beyond 40 km |
| T52 | Call `safe_spots_near` with `p_lat = 91`, `p_lng = 181` | `validation_failed` 400; no rows |
| T53 | Attempt to paginate `safe_spots_near` (add `p_cursor`, `offset`, or a second call with a shifted origin to walk past 200) | No pagination parameter exists; the function signature rejects unknown named arguments. The shifted-origin sweep is bounded by the 30/min token bucket, asserted by a harness that exhausts it in 60 s |
| T54 | Sweep `safe_spots_near` 100× in 60 s from one user | 30 succeed, 70 return `rate_limited` 429 with integer `Retry-After`; the bucket refills at the specified rate |
| T55 | Sweep from 50 accounts behind one IP | Kong's per-IP layer engages; separately, each user's Postgres bucket limits them independently. Asserts the per-user bucket is not keyed on IP (mobile carriers NAT thousands of users) |
| T56 | Craft a PostgREST request for `private.garden_locations` | Schema not in `db-schemas`; no grant; request 404s at the API layer before reaching Postgres |
| T57 | Craft `GET /rest/v1/gardens?select=fine_cell,display_point` as an authenticated non-owner | Zero rows (owner-only policy). Additionally the forbidden-column CI check asserts `fine_cell` appears in no client-reachable view or function return type |
| T58 | Inspect the wire for any map request while a listing owner is nearby | No request or response on the map screen contains a garden coordinate, a `display_point`, an `coarse_cell`/`fine_cell`, or any other user's identifier beyond a `listing_id`/`owner handle` in the sheet |
| T59 | Block a user, then read a spot where only their listings exist | `listing_count = 0` from the server aggregate; no client-side filtering step is involved; the blocked user receives no signal ([SPEC-012](SPEC-012-trust-and-safety.md)) |
| T60 | Suspended user's listings appear in a count | They must not: `listings_select_discoverable` and the aggregate both exclude suspended owners. Asserted by suspending an owner and re-querying |
| T61 | Deep link `sharecropr://map?lat=42.28&lng=-83.74` | Route rejects unknown params; the CI static check over the route manifest fails any param matching the coordinate regex (API-05) |
| T62 | Fire a synthetic Sentry event from the map screen containing `{ viewport: { lat, lng } }` | Scrubber removes it at any depth; asserted absent from the outgoing payload (LP-08) |
| T63 | Emit a PostHog event with a `center` property containing a coordinate | Wrapper rejects the property; the event is sent without it and a lint rule fails the source |
| T64 | Read MMKV after a map session on a rooted-device simulation | No coordinate keys present; `qk.meLocation()` is on the persistence deny-list and the map never writes a position |
| T65 | Malicious `search_listings` query `p_query` with 10 KB of text | `validation_failed` 400 on length; the trigram index is never asked to process it |
| T66 | Unauthenticated (`anon`) call to `safe_spots_near` | 401 `unauthenticated`. `anon` may read `safe_spots` rows but not the proximity RPC — the RPC is the rate-limited, capped path and it requires a user to limit |
| T67 | Two accounts on one device rapidly switching, each panning | Buckets are per user id, so one account exhausting its budget does not affect the other; asserted so the bucket key is never accidentally the device or IP |
| T77 | **Try to hide the attribution.** (a) Open the sheet to 92% with the offline banner, rate-limit countdown, degraded chip, chip row, and FAB all present simultaneously. (b) Set dynamic type to 200%. (c) Delete the attribution component from the tree. | (a) and (b): the attribution's measured frame intersects no other rendered view's frame and is not clipped by any parent — a geometric assertion, not a snapshot. (c) The test suite fails and `map.attribution_missing` fires. There is no configuration, feature flag, remote-config value, or theme under which the notice is absent (R75, R76) |
| T78 | Capture the wire for a full map session (cold cache, pan across the metro, locality search, sheet open, request sent) and enumerate every request host | Every host is in a two-entry allowlist: the Sharecropr tile origin and the Sharecropr Supabase origin. Any other host — a tile vendor, a geocoder, an SDK phoning home, `tile.openstreetmap.org` — fails the test (R79). Run at the wire rather than over the import graph, because a transitive dependency is exactly what an import audit misses |
| T79 | Regex every captured tile request URL, header, and body for coordinate-shaped values | Only `z/x/y` path segments and PMTiles `Range:` byte offsets present. No decimal degrees, no `lat`/`lng`/`center`/`bbox` parameter, no locality string, no `safe_spot_id` (R80) |
| T80 | Inspect tile requests for credentials | No `Authorization` header, no cookie, no `key=`/`api_key=`/`token=` query parameter, no device or user identifier in any header. The request is indistinguishable from any other client's request for the same tile (R78) |
| T81 | Point the style at a non-Sharecropr host in a build and run the suite | T74 and T78 both fail. Asserted so that switching to the [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md) managed fallback is a deliberate, documented change rather than something a config edit can do quietly |

### 13.3 Manual QA

- [ ] **Reset spike on `@maplibre/maplibre-react-native`** completed on the Android floor device and its result recorded in the [go/no-go doc](../07-review/03-map-spike-go-no-go.md) and against [PRD A5](../00-foundation/02-prd.md), **before any other map implementation work**. New Architecture interop is the first question it must answer ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)).
- [ ] Walk a real route in a launch metro with follow mode on; confirm smooth tracking and no self-clearing recentre button.
- [ ] Pan hard for 30 seconds on the reference Android device; confirm ≥ 55 fps and that no viewport query fires mid-gesture.
- [ ] Confirm the degradation ladder by artificially loading 200 spots in a 2 km radius; observe each step in order and confirm hysteresis on exit.
- [ ] Deny location on a fresh install and complete a full journey: search a town → open a spot → open a listing → send a request.
- [ ] Confirm on both platforms that the map renders with tiles disabled (airplane mode after a cold cache clear) and markers remain correctly positioned, and that the attribution is still on screen.
- [ ] Put an iOS and an Android device side by side on the same camera and confirm the map looks the same. This is the benefit we bought with the migration and it is worth looking at once with human eyes, not only in a diff.
- [ ] Confirm the attribution is visible at 200% type, in light and dark themes, with the sheet at 92% and the offline banner showing.
- [ ] Screen-reader pass on `/map/list` end to end, including expanding a spot into its listings and reaching a request.
- [ ] Confirm the empty-state copy for all four causes on a real device, at 200% type, in both light and dark themes.
- [ ] Confirm the "Simplified view" explainer and the list escape are reachable while degraded.
- [ ] Confirm no coordinate appears in a Charles/mitmproxy capture of a full map session.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `map.list_default_for_screen_reader` (R61) ships default-on and is flagged only so it can be disabled if detection proves unreliable on a platform version. The map itself is not flagged — it is the default tab and there is no fallback product. |
| Migration required | No. `safe_spots_near` and `search_listings` are created by [SPEC-007](SPEC-007-safe-spots.md) and [SPEC-009](SPEC-009-listings-and-offers.md) migrations respectively. |
| Backfill required | No. |
| Rollback plan | Client-only. An EAS Update reverts the map bundle; the RPCs are unchanged and older clients keep working. If the renderer itself regresses, the escape is the `MapCanvas` seam ([Mobile Architecture §4.1](../01-architecture/02-mobile-architecture.md)) — roughly 300 lines to swap renderers, which bounds the code change but not the product change (different clustering model, different offline story, different attribution obligation). Separately, a **bad basemap build is rolled back server-side** by repointing the style at the previous dated PMTiles archive, with no client release at all ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). |
| Renderer gate | **The spike must be re-run on MapLibre before implementation.** [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md)'s spike is invalidated: `src/features/map/` was built on `react-native-maps`, and the New Architecture interop story for MapLibre RN is the primary unknown. Budget 4–6 engineer-days to port plus the spike itself; the [go/no-go doc](../07-review/03-map-spike-go-no-go.md) is reset accordingly. **If the reset spike fails its pass criteria, ADR-0013's `react-native-maps` is the documented fallback behind the seam** (~3 days) — and taking it means R74–R82 need re-derivation against a vendor basemap, which is the real cost of that fallback rather than the 3 days. |
| Client version floor | None. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Is a 200-row hard cap on `safe_spots_near` correct for a dense metro at peak season, or does it silently truncate a legitimate view? Loosening it weakens the scraping bound ([API Contract §10 Q2](../01-architecture/06-api-contract.md)). | Architecture | Post-launch, first season |
| Q2 | Should the empty-map state offer to seed supply by prompting the user to publish, given that a user with nothing to give sees a prompt they cannot act on? The cold-start liquidity problem is the most likely cause of MVP failure and this copy is our only lever inside the app. | Product | Before launch |
| Q3 | Should the map show a coarse "coverage boundary" so a user outside a launch metro understands *why* it is empty, rather than concluding the app is broken? Drawing a boundary also tells a competitor exactly where we operate. | Product | Before second metro launch |
| Q4 | Is 60 s the right `staleTime` for counts at peak season, when a listing can be claimed within a minute of publishing? Shorter multiplies RPC load against a 30/min budget. | Mobile + Architecture | Post-launch data |
| Q5 | Should species search persist across launches like radius does? It is arguably a standing intent ("I always want tomatoes") rather than a session one. | Product | Post-launch |
| Q6 | Does the availability band (0 / 1–4 / 5+) match how users actually read the map, or should the badge simply show the number at all times? Bands are cheaper to render at 60 markers; numbers are more honest. | Design | Post-launch, first usability round |
| Q7 | **Where does clustering live?** [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)'s seam table says "server-side aggregation remains authoritative — the device renders what it is given", while §3 of this spec rejects server-side clustering outright (a viewport-precision side channel, [Location Privacy §12.4](../01-architecture/04-location-privacy.md)) and R21 mandates client-side `supercluster`. Both cannot be true. R21 and §3 are unchanged in this revision because nothing in the renderer swap bears on the privacy argument, and R70 bans the third option (MapLibre's built-in clustering) either way — but the ADR's wording needs correcting or this spec needs a documented exception. Not an implementation decision to be made in code. | Architecture | **Before implementation begins** |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-09 | 2.0.0 | Mobile Engineering | **OpenStreetMap / MapLibre migration.** Renderer moves from `react-native-maps` (Apple Maps on iOS, Google Maps on Android) to `@maplibre/maplibre-react-native` over self-hosted OSM vector tiles ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)); [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md) superseded. Behaviour-breaking, hence the major bump: §5.3 markers become one `ShapeSource`/`SymbolLayer` instead of native marker views (R25, R26 restated; the `tracksViewChanges` hazard no longer exists and the 200-cap is re-characterised as a privacy and payload cap); R49 replaces the OS geocoder with a bundled locality gazetteer; R57 changes which package is seam-locked. New §5.10 (R74–R82) covers the style JSON, mandatory ODbL attribution, tile-failure degradation, credential-free tile requests, the tile-host allowlist, server-side basemap staleness, and cross-platform render parity. New R69–R73 add the feature-collection contract, the built-in-clustering ban, the gazetteer, and tile-latency budgets. Offline map packs moved to a Phase 2 non-goal. Tests T68–T81 added, T21/T22/T38/T45 restated. Q7 raised: the ADR-0019 clustering wording contradicts §3 and R21. |
| 2026-08-08 | 1.0.0 | Mobile Engineering | Initial spec |
| 2026-10-22 | 2.1.0 | Mobile Engineering | H3 removed; renamed to location tiers per [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md). R03, EC-05 (`safe_spots_near` uses ST_DWithin only), Q7 wording and the analytics cap updated. |
