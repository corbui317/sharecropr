# Product Requirements Document

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Product · **Phase:** MVP

This PRD defines *what* Sharecropr does at the capability level. Each capability links to the [feature spec](../03-specs/README.md) that defines it precisely. Where the two disagree, the spec wins and this document is stale — fix it.

---

## 1. Scope statement

**In scope for MVP:** account creation with identity and garden verification, crop inventory with a structured taxonomy, a live map of nearby safe spots and available crops, an offer/request/accept exchange lifecycle ending in a dual-confirmed in-person handoff, transaction-scoped messaging, ratings, reports, blocks, and a moderation console.

**Out of scope for MVP:** payments of any kind, shipping or delivery, multi-garden accounts, group exchanges, a web client, in-app navigation/directions, seed and tool trading, non-English localization.

**Launch geography:** two metropolitan areas selected for safe-spot density and an existing gardening community. Rationale in [Roadmap §1](../06-roadmap/01-roadmap.md).

---

## 2. Capability map

| # | Capability | Spec | Phase |
| --- | --- | --- | --- |
| C1 | Account creation & authentication | [SPEC-001](../03-specs/SPEC-001-authentication.md) | MVP |
| C2 | Two-factor authentication | [SPEC-002](../03-specs/SPEC-002-two-factor-auth.md) | MVP |
| C3 | Identity verification (KYC) | [SPEC-003](../03-specs/SPEC-003-identity-verification.md) | MVP |
| C4 | Garden registration & verification | [SPEC-004](../03-specs/SPEC-004-garden-verification.md) | MVP |
| C5 | Crop taxonomy & classification | [SPEC-005](../03-specs/SPEC-005-crop-taxonomy.md) | MVP |
| C6 | Crop inventory management | [SPEC-006](../03-specs/SPEC-006-crop-inventory.md) | MVP |
| C7 | Safe spot network | [SPEC-007](../03-specs/SPEC-007-safe-spots.md) | MVP |
| C8 | Interactive map & discovery | [SPEC-008](../03-specs/SPEC-008-interactive-map.md) | MVP |
| C9 | Listings & offers | [SPEC-009](../03-specs/SPEC-009-listings-and-offers.md) | MVP |
| C10 | Exchange lifecycle | [SPEC-010](../03-specs/SPEC-010-exchange-lifecycle.md) | MVP |
| C11 | Messaging | [SPEC-011](../03-specs/SPEC-011-messaging.md) | MVP |
| C12 | Trust & safety: ratings, reports, blocks | [SPEC-012](../03-specs/SPEC-012-trust-and-safety.md) | MVP |
| C13 | Notifications | [SPEC-013](../03-specs/SPEC-013-notifications.md) | MVP |
| C20 | Harvest planning & surplus alerts | [SPEC-020](../03-specs/SPEC-020-harvest-planning.md) | Phase 2 |
| C21 | Community groups & garden clubs | [SPEC-021](../03-specs/SPEC-021-community-groups.md) | Phase 2 |
| C22 | Gamification | [SPEC-022](../03-specs/SPEC-022-gamification.md) | Phase 3 |
| C23 | ML crop ID & food safety disclosure | [SPEC-023](../03-specs/SPEC-023-crop-id-and-food-safety.md) | Phase 3 |
| C90 | Moderation console | [SPEC-900](../03-specs/SPEC-900-moderation-console.md) | MVP |

---

## 3. Capability requirements

> These are product-level obligations. Each spec decomposes them into testable `R##` requirements.

### C1 — Account creation & authentication

- Sign up with email + password, or OAuth via Apple, Google, Facebook, or X.
- Apple Sign-In is mandatory on iOS because other third-party logins are offered (App Store Guideline 4.8).
- Email addresses are verified before an account can list or transact.
- Sessions persist across app restarts; refresh tokens are stored in hardware-backed secure storage.
- Account deletion is available in-app and via a public web URL, with a 30-day grace period.

*MVP note:* Facebook and X OAuth are **deferred to Phase 2**. Apple + Google covers the overwhelming majority of signups and each additional provider adds a review surface and a data-handling obligation. Recorded in [ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md).

### C2 — Two-factor authentication

- TOTP (RFC 6238) via any authenticator app. No SMS — SIM-swap risk is unacceptable for an app that gates physical meetings.
- Optional for browsing, **required** to change email, change password, disable 2FA, or view account security settings (step-up auth).
- Ten single-use recovery codes issued at enrollment, displayed exactly once.

### C3 — Identity verification

- Performed by a third-party vendor (Persona; Stripe Identity as documented alternate) using government ID capture plus a liveness selfie.
- Sharecropr stores **only** the pass/fail outcome, the vendor's inquiry reference, the verification timestamp, and a coarse document-country code. **No ID images, no document numbers, no date of birth beyond an over-18 boolean.**
- Verification gates *transacting*, not browsing. An unverified user can create an account, register a garden, and browse the map. They cannot publish a listing, send an exchange request, or accept one.
- Reviewer accounts bypass KYC via a server-side allowlist, never a build flag.

### C4 — Garden registration & verification

- A user registers exactly one garden in MVP, with a precise location captured on-device.
- Verification requires a photo of the garden taken in-app (camera only, no library import) with device location within a tolerance of the declared garden location.
- Photos are stripped of all EXIF metadata on upload, server-side, before storage.
- Review is ML-assisted with a human queue. Target decision time: under 24 hours.

### C5 — Crop taxonomy

- A four-level hierarchy: **kingdom → category → species → variety**, so that "Cherokee Purple" resolves to *Plant → Vegetable (culinary) → Tomato → Cherokee Purple*.
- Culinary classification is authoritative for browsing (tomatoes appear under vegetables), with botanical classification retained as metadata. This distinction is deliberate; see [SPEC-005](../03-specs/SPEC-005-crop-taxonomy.md).
- Taxonomy ships bundled with the app for offline use and is updatable server-side without a store release.
- Users may submit a custom variety under an existing species; free-text species creation is not permitted.

### C6 — Crop inventory

- Add, edit, archive inventory items with species/variety, quantity, unit, harvest date, condition, and up to five photos.
- Quantity units are constrained to the fixed `quantity_unit` enum defined in the [data model](../01-architecture/03-data-model.md#4-enums) (each, bunch, pound, kilogram, ounce, gram, quart, pint, gallon, liter, dozen). The data model is authoritative if the two ever diverge.
- Inventory is private by default. Publishing a listing is a distinct, deliberate action.
- Inventory is readable offline from local cache.

### C7 — Safe spots

- A curated set of public, staffed-or-surveilled locations: public libraries, police station lobbies and lots, town and city halls, community centers, college campuses, fire stations, and farmers' market sites.
- Each carries name, category, address, coordinates, hours of operation, accessibility notes, parking notes, and a photo.
- Only Sharecropr staff can create or approve a safe spot in MVP. User proposals are Phase 2.
- Safe spot coordinates are **public data** and are the only precise coordinates the client ever receives.
- **Candidates are sourced from OpenStreetMap; verification is human.** A scheduled server-side Overpass import writes civic POIs into a private candidate queue, and a monthly refresh diffs upstream changes against live spots. **No import path publishes a spot.** A person confirms hours by phone, website, or visit, assesses whether the place is actually suitable for a handoff, and moves the pin to a real entrance before anything becomes discoverable. Imported `opening_hours` is a reviewer hint and can never reach a user. [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md), [SPEC-007 §5.7](../03-specs/SPEC-007-safe-spots.md).
- Because that data is OSM-derived, **"© OpenStreetMap contributors" is displayed on every surface showing spot data**. That is an ODbL 1.0 obligation, not a design choice.

### C8 — Interactive map & discovery

- Map opens centered on the user with their avatar, in a follow-mode that can be broken by panning and restored by a button.
- Safe spots render as distinct nodes styled by how much is available at them; clustering applies above a density threshold.
- An inventory button is fixed at bottom-right. Tapping a node opens a bottom sheet listing what's offered there.
- Filter chips by crop category; search by species.
- Default discovery radius 8 km, user-adjustable from 2 km to 40 km.
- **No other user's location is ever rendered.** Listings are attached to safe spots, not to people.
- **The basemap is OpenStreetMap vector tiles, rendered by MapLibre from a tile archive we host ourselves** ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). No Apple Maps, no Google Maps, no tile vendor, no API key. The map therefore **renders identically on iOS and Android** — design is done once, and a whole class of "correct on iOS, wrong on Android" defects does not exist.
- **Attribution is an obligation, not a preference.** "© OpenStreetMap contributors" is on the map in every state, including before any tile loads and when every tile fails. Removing or obscuring it is a licence breach (ODbL 1.0), and it is tested as such.
- **A tile failure costs context, never capability.** The map degrades to a neutral background with markers still at correct positions; opening a spot and arranging an exchange keep working.
- Offline map packs are **Phase 2**. Location-denied locality search resolves against a bundled gazetteer for the two launch metros — there is no third-party geocoder, including the OS one.

### C9 — Listings & offers

- A listing publishes one inventory item to one to three safe spots, with an expiry window (default 7 days, max 21).
- A listing may declare a wishlist of species the owner is seeking, which drives match suggestions.
- Listings auto-expire and can be manually withdrawn at any time before a request is accepted.

### C10 — Exchange lifecycle

The core transaction. States and legal transitions are normative and defined in [Exchange State Machine](../01-architecture/07-exchange-state-machine.md).

- A user sends an **exchange request** against a listing, optionally offering one of their own items in return.
- The listing owner may **accept**, **decline**, or let it expire; the requester may **withdraw**.
- Acceptance reserves the listing atomically. Concurrent acceptance of the same listing MUST be impossible.
- Accepting opens a **scheduling** step: a safe spot and a time window agreed in-thread.
- At handoff, both parties confirm using a shared six-digit code shown to each. Completion requires **both** confirmations.
- Either party may cancel before completion, with a reason; repeated late cancellations affect trust score.
- Completion unlocks mutual rating.

### C11 — Messaging

- Threads are scoped to a specific exchange request and are created only when a request is sent.
- No cold DMs. There is no way to message a user you have no pending or completed exchange with.
- Text and system messages only in MVP. No images, no attachments, no voice.
- Content scanning flags shared addresses, phone numbers, and payment solicitations for moderation review.
- Blocking a user tears down the thread and cancels any in-flight exchange between them.

### C12 — Trust & safety

- **Ratings:** double-blind (neither party sees the other's rating until both submit or 7 days pass), 1–5 stars plus optional tags. Only available after a completed exchange.
- **Reports:** categorized (no-show, misrepresented goods, harassment, unsafe meeting, spam, impersonation, other). `unsafe_meeting` pages on-call rather than queueing.
- **Blocks:** immediate, bidirectional in effect, enforced at the database layer so blocked users disappear from each other's queries entirely.
- **Trust score:** a derived, internal composite of verification level, completed exchanges, rating average, and cancellation rate. Displayed to users only as a coarse tier badge, never a number.
- **Moderation SLA:** 24 hours for standard reports, 1 hour for `unsafe_meeting`.

### C13 — Notifications

- Push via Expo Push, plus a durable in-app inbox — push is best-effort, the inbox is the record.
- Categories are the `notification_kind` enum in the [data model](../01-architecture/03-data-model.md#4-enums) — request received, request accepted/declined, message received, exchange reminder, exchange cancelled, verification outcome, garden review outcome, moderation outcome, safety alert (plus `surplus_alert`, reserved for [SPEC-020](../03-specs/SPEC-020-harvest-planning.md)).
- Per-category toggles plus quiet hours. **Safety alerts ignore quiet hours and cannot be disabled.**
- Permission requested contextually — after the first exchange request is sent, never at launch.

---

## 4. Non-functional requirements

Full detail in [Non-Functional Requirements](05-nfr.md). Headlines:

| Dimension | Target |
| --- | --- |
| Cold start to interactive map | p95 < 2.5 s on a 3-year-old mid-range device |
| Map query (safe spots + counts within radius) | p95 < 400 ms server-side |
| Crash-free sessions | ≥ 99.5% |
| API availability | 99.9% monthly |
| Accessibility | WCAG 2.2 AA equivalent for mobile; full screen-reader support on all core flows |
| Offline | Inventory and taxonomy fully readable; map shows last-known state with a staleness banner. Offline **tile** packs are Phase 2 |
| Attribution | "© OpenStreetMap contributors" present in every map state and on every surface showing OSM-derived spot data (NFR-99) |

---

## 5. Constraints

| Constraint | Source | Implication |
| --- | --- | --- |
| Apple Guideline 4.8 | App Store | Apple Sign-In required alongside other social logins |
| Apple Guideline 1.2 (UGC) | App Store | In-app reporting, blocking, filtering, and a documented 24h moderation process are submission requirements |
| Apple Guideline 5.1.1(v) | App Store | Account deletion must be available in-app |
| Google Play data deletion | Play Console | Public web deletion URL required |
| Background location review | Both stores | We do **not** request background location in MVP, specifically to avoid this review burden |
| No money | Product decision | No payments SDK may be added without a new ADR and legal review |
| Two launch metros | Ops capacity | Safe-spot **verification** is manual and headcount-bound. Discovery is not — OSM supplies candidates ([ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)) |
| **ODbL 1.0** | OpenStreetMap licence | Attribution is mandatory wherever OSM-derived data is shown, and it is tested. Share-alike does not bite today because we publish no derived database — **any** safe-spot export, public API, or partner feed needs legal review before it ships |
| **No map vendor** | [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md) | There is no Google Maps API key, no Mapbox account, and no tile-vendor key to hold, restrict, or rotate — and no per-map-load billing to forecast. The cost of that is a monthly tile build we own |
| **OpenStreetMap and Overpass have no SLA** | Donated community infrastructure | Tiles are served from our own archive, so an upstream outage cannot break the map. A failed Overpass month delays candidate discovery and nothing else |

---

## 6. Assumptions

| # | Assumption | If wrong |
| --- | --- | --- |
| A1 | Users will accept ID verification to transact | Conversion collapses; fall back to the tiered trust model in [Roadmap Phase 2](../06-roadmap/01-roadmap.md) |
| A2 | Safe-spot-only meetings are acceptable, not merely tolerable | Users route around the app; revisit [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) with data |
| A3 | Libraries and municipal venues will not object to being listed | Partnership program moves ahead of Phase 2 |
| A4 | Seasonal usage collapse in winter is survivable | Phase 2 harvest planning moves into MVP |
| A5 | `@maplibre/maplibre-react-native` performs acceptably under the New Architecture, rendering 200 clustered markers as GPU symbol layers over self-hosted OSM vector tiles | Fall back to `react-native-maps` behind the `MapCanvas` seam per [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md), which [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) retains for exactly this; see [R-04](../06-roadmap/02-open-risks.md) |

Assumption A5 is validated by a **mandatory spike before any other implementation work.** [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) supersedes [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md), which means **the spike is reset** — the profiled `react-native-maps` spike does not answer this question, and MapLibre RN's New Architecture interop is the specific unknown it must close first.

---

## 7. Release gates

MVP does not ship unless all of the following are true:

- [ ] Location invariant suite passes: no query path returns an exact garden coordinate to any client role
- [ ] Full pgTAP RLS suite green, including every negative case
- [ ] Exchange concurrency harness passes at 50 simultaneous acceptors
- [ ] Maestro critical-path suite green on both platforms
- [ ] Moderation console operable and a named human on the SLA rota
- [ ] ≥ 40 verified safe spots per launch metro, hours confirmed within the last 30 days
- [ ] Seeded supply: ≥ 100 active listings per metro at launch
- [ ] Incident response playbook signed off by counsel
- [ ] External security review of RLS policies complete, findings closed

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product | Initial PRD |
| 2026-08-09 | 1.1.0 | Product | OpenStreetMap decision reflected: C8 restated for MapLibre over self-hosted OSM vector tiles with mandatory ODbL attribution; C7 restated for OSM candidate sourcing with a human verification gate; constraints table gains ODbL, no-map-vendor, and no-SLA rows; A5 and its spike restated for MapLibre. [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md), [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) |
