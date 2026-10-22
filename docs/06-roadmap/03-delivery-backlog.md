# Delivery Backlog

**Status:** Draft · **Version:** 0.1.1 · **Date:** 2026-08-09 · **Owner:** Product + Engineering
**Authored by:** Product Manager · Software Architect · Workflow Architect (merged lenses)

The [Roadmap](01-roadmap.md) says *what* ships and *why*. The [Spec Register](../03-specs/README.md) says *what is specified*. This document is the layer between them: the **executable plan** — epics, stories, estimates, dependencies, and acceptance criteria that a team can pull from on a Monday morning.

Nothing here invents scope. Every story traces to a spec requirement, an NFR, an ADR, a risk, or a development note. If a story has no trace, it does not belong in the backlog.

---

## How to read this

### Hierarchy

```
EPIC-##          A shippable capability, usually one spec. Has an owner and a success metric.
  SCR-####       A story. Vertically sliced, independently testable, ≤ 5 points.
    · Tasks      Listed inline where decomposition is non-obvious. Not separately tracked.
```

Story keys are `SCR-EENN` — `EE` is the epic number, `NN` the story number within it. **Keys are permanent and never reused**, the same rule the spec register uses.

### Fields on every story

| Field | Meaning |
| --- | --- |
| **Pts** | Fibonacci story points. 1 ≈ half a day, 2 ≈ a day, 3 ≈ two days, 5 ≈ half a sprint. **Nothing is 8** — an 8 is a story that has not been split yet. |
| **Blocked by** | Hard dependency. Derived from the spec register's `Schema depends on` DAG, never from `Behaviourally coupled with`. |
| **Trace** | The spec requirement, NFR, ADR, risk (`R-##`) or note (`N-##`) this exists to satisfy. |
| **AC** | Acceptance criteria. Written as observable behaviour, not implementation. |

### Definition of Ready

A story may not enter a sprint until all five are true:

1. Traces to at least one spec requirement, NFR, or recorded risk.
2. Acceptance criteria are written and are observable without reading the code.
3. Every branch, failure mode, and recovery path named in the spec's §10 is either covered by an AC or explicitly deferred to a named follow-up story. *(Workflow Architect gate — a story with only a happy path is not ready.)*
4. Schema dependencies are satisfied by merged work, not by work in flight.
5. Its test IDs from the spec's §13 coverage matrix are listed.

### Definition of Done

1. Code merged, spec's §13 tests passing, coverage matrix satisfied (CI blocks an untested `MUST` — [CI/CD §4](../05-operations/02-cicd.md)).
2. RLS: positive **and** negative tests present, negatives outnumbering positives for every touched table (NFR-47).
3. No exact garden coordinate in any response, log, telemetry event, or export — location canary green (NFR-45, LP-01…LP-13).
4. Observability: the events named in the spec's §11 are emitted and visible on a dashboard.
5. Accessibility criteria from the spec's §12 verified.
6. Offline behaviour matches NFR-31…NFR-37 for any data class the story touches.
7. No new infinite spinner. Every loading state resolves to content, a cached view, or an actionable error.

### Priority

`P0` blocks launch · `P1` in MVP scope · `P2` post-launch, ordered by launch data · `P3` speculative.

---

## Epic map

| Epic | Title | Spec | Phase | Pts | Priority |
| --- | --- | --- | --- | --- | --- |
| [EPIC-00](#epic-00--delivery-platform) | Delivery Platform | — | MVP | 34 | P0 |
| [EPIC-01](#epic-01--map-spike-blocking) | **Map Spike (blocking)** | SPEC-008 | Pre-MVP | 13 | P0 |
| [EPIC-02](#epic-02--data-model-rls--test-harness) | Data Model, RLS & Test Harness | — | MVP | 44 | P0 |
| [EPIC-03](#epic-03--authentication) | Authentication | SPEC-001 | MVP | 39 | P0 |
| [EPIC-04](#epic-04--two-factor-authentication) | Two-Factor Authentication | SPEC-002 | MVP | 29 | P0 |
| [EPIC-05](#epic-05--identity-verification) | Identity Verification | SPEC-003 | MVP | 24 | P0 |
| [EPIC-06](#epic-06--garden-verification--location-privacy) | Garden Verification & Location Privacy | SPEC-004 | MVP | 37 | P0 |
| [EPIC-07](#epic-07--crop-taxonomy) | Crop Taxonomy | SPEC-005 | MVP | 29 | P0 |
| [EPIC-08](#epic-08--safe-spots) | Safe Spots | SPEC-007 | MVP | 28 | P0 |
| [EPIC-09](#epic-09--crop-inventory) | Crop Inventory | SPEC-006 | MVP | 34 | P0 |
| [EPIC-10](#epic-10--listings--offers) | Listings & Offers | SPEC-009 | MVP | 37 | P0 |
| [EPIC-11](#epic-11--interactive-map) | Interactive Map | SPEC-008 | MVP | 37 | P0 |
| [EPIC-12](#epic-12--exchange-lifecycle) | **Exchange Lifecycle** | SPEC-010 | MVP | 75 | P0 |
| [EPIC-13](#epic-13--messaging) | Messaging | SPEC-011 | MVP | 27 | P0 |
| [EPIC-14](#epic-14--trust--safety) | Trust & Safety | SPEC-012 | MVP | 42 | P0 |
| [EPIC-15](#epic-15--moderation-console) | Moderation Console | SPEC-900 | MVP | 33 | P0 |
| [EPIC-16](#epic-16--notifications) | Notifications | SPEC-013 | MVP | 31 | P0 |
| [EPIC-17](#epic-17--observability--operational-readiness) | Observability & Operational Readiness | — | MVP | 32 | P0 |
| [EPIC-18](#epic-18--hardening-compliance--launch) | Hardening, Compliance & Launch | — | MVP | 34 | P0 |
| [EPIC-19](#epic-19--supply-seeding--liquidity-non-engineering) | Supply Seeding & Liquidity | — | MVP | — | P0 |
| [EPIC-20](#phase-2--epic-placeholders) | Harvest Planning & Surplus Alerts | SPEC-020 | Phase 2 | ~55 | P2 |
| [EPIC-21](#phase-2--epic-placeholders) | Community Groups & Garden Clubs | SPEC-021 | Phase 2 | ~55 | P2 |
| [EPIC-22](#phase-3--epic-placeholders) | Gamification | SPEC-022 | Phase 3 | ~40 | P3 |
| [EPIC-23](#phase-3--epic-placeholders) | Crop ID & Food Safety | SPEC-023 | Phase 3 | ~55 | P3 |

**MVP total: 659 points across 18 engineering epics, 186 stories.** Scheduled against dependencies at ≤ 42 points per sprint, that is **one one-week sprint 0 plus sixteen two-week sprints — roughly 33 calendar weeks**, which does not fit the roadmap's 14–18 *engineer-weeks* figure. That discrepancy is deliberate and is addressed in [Capacity reality check](#capacity-reality-check).

---

## Capacity reality check

*Product Manager lens. Read this before committing to a date.*

The roadmap estimates **14–18 engineer-weeks** for MVP. This backlog decomposes to **659 points across 186 stories**, which schedules to ~33 calendar weeks for three engineers. Those two numbers cannot both be right.

| Reading | Implication |
| --- | --- |
| The roadmap figure is per-engineer feature time and excludes CI, observability, hardening, store submission, and the RLS test harness | Then EPIC-00, 02, 17 and 18 (139 pts, ~21%) are unaccounted for in the roadmap and the roadmap number should be restated |
| The point estimates are inflated | Then re-estimate as a team before sprint 1, not after sprint 4 |
| Both are partly true | Most likely. |

**The decision this forces:** either restate the roadmap as ~33 calendar weeks for three engineers, or cut scope now. Options for the cut, in the order a PM should reach for them:

1. **Moderation console (EPIC-15, 34 pts) → the thinnest viable slice.** SQL-plus-runbook moderation is survivable at launch volume for a two-metro launch. The console is not — until [N-10](../07-review/02-development-notes.md#n-10--the-moderation-rota-is-asserted-to-apple-before-it-exists) is read: a moderation capability was asserted to Apple. **The rota must exist; the console UI need not.** Cut to SCR-1501, 1502, 1505 (13 pts).
2. **Gamification-adjacent polish** — already out of MVP. No further gain here.
3. **The second metro** — halves EPIC-19's manual curation cost, at direct cost to liquidity. See R-01 before touching this. This is the cut that looks cheapest and is most expensive.

**What must not be cut:** EPIC-01 (spike), EPIC-02 (RLS harness), the eight concurrency controls in EPIC-12, and the location canary in EPIC-06. Each is load-bearing for either correctness or safety, and each is cheap to cut and ruinous to retrofit.

---

## EPIC-00 — Delivery Platform

**Goal:** A developer joining on day one can clone, run, test, and ship. **Success metric:** time from clone to a green local test run < 30 minutes; time from merge to a staging build < 15 minutes.
**Trace:** [Environments](../05-operations/01-environments.md), [CI/CD](../05-operations/02-cicd.md), [N-07](../07-review/02-development-notes.md#n-07--the-ci-gates-are-described-not-built).

> **[N-07] The CI gates are described, not built.** The spec register, the traceability rules and the DAG check are all documented as CI-enforced. None of them exist yet. Every sprint they don't exist is a sprint where the documentation's central guarantee is honour-system.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0001** | As an engineer, I can clone the repo and get a running app against a local Supabase in under 30 minutes | 3 | — | Environments |
| **SCR-0002** | As an engineer, my PR is blocked if lint, typecheck, or unit tests fail | 2 | SCR-0001 | CI/CD §2 |
| **SCR-0003** | As a doc owner, CI fails the build if the spec `Schema depends on` graph contains a cycle | 3 | SCR-0002 | Register §Build order, CI/CD §4 |
| **SCR-0004** | As a doc owner, CI fails the build if any `Behaviourally coupled with` edge is asymmetric | 2 | SCR-0003 | Register §Build order |
| **SCR-0005** | As a doc owner, CI fails the build if any spec `MUST` has no test ID in its §13 coverage matrix | 5 | SCR-0002 | Traceability, CI/CD §4 |
| **SCR-0006** | As an engineer, CI fails if the JS bundle exceeds 6 MB and reports install size on every build | 2 | SCR-0002 | NFR-07, NFR-08 |
| **SCR-0007** | As an engineer, migrations run forward and roll back cleanly in CI against a disposable database | 3 | SCR-0001 | CI/CD |
| **SCR-0008** | As an engineer, `EXPLAIN (ANALYZE, BUFFERS)` baselines for the six hottest queries are committed and diffed on every migration | 5 | SCR-0007 | NFR §1.2 |
| **SCR-0009** | As a release manager, a merge to `main` produces an EAS build for `staging` automatically | 3 | SCR-0002 | Release & Store Submission |
| **SCR-0010** | As an engineer, dependency scanning runs weekly and opens an issue for high/critical CVEs | 2 | SCR-0002 | NFR-54 |
| **SCR-0011** | As an engineer, the `src/domain` and `src/api` layers fail the build if they import React Native | 2 | SCR-0002 | Mobile Architecture, Roadmap Phase 3 |
| **SCR-0012** | As a release manager, a JS-only rollback completes in under 15 minutes and is rehearsed once before launch | 2 | SCR-0009 | NFR-28 |

**AC — SCR-0003/0004/0005 (the traceability gates).** Given a PR that introduces a spec cycle, an asymmetric coupling, or a `MUST` with no test ID, the build fails with a message naming the offending spec, the offending line, and the rule violated. A passing build is not sufficient evidence — each gate ships with a deliberately-broken fixture proving it *can* fail.

---

## EPIC-01 — Map Spike (blocking)

**Goal:** Prove or disprove **`@maplibre/maplibre-react-native` over self-hosted OSM tiles** under Fabric before a line of the data model is written. **Success metric:** a written go/no-go with profiler traces attached.
**Trace:** [R-04](02-open-risks.md#r-04--the-map-stack-is-unvalidated), [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md), [N-01](../07-review/02-development-notes.md#n-01--do-the-map-spike-first-and-mean-it), NFR-03, NFR-99…NFR-102.

> **⚠️ RESET.** The existing spike code passed against `react-native-maps`, which [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) superseded. **That result no longer validates the shipping stack.** This epic grows a port story and is re-timeboxed from 2 days to **4–6 engineer-days plus the original 2**. The old points are retained rather than reset so the plan reflects rework honestly.
>
> **This epic blocks every other epic except EPIC-00, SCR-0801, and EPIC-19.** It is not done when it renders.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0105** | Port `MapCanvas` to MapLibre: `Region` → `Camera`, markers → one `ShapeSource`/`SymbolLayer`, lint rule retargeted to `@maplibre/*` | 8 | — | ADR-0019 |
| **SCR-0106** | Build and publish a launch-metro PMTiles archive to R2; style JSON versioned in-repo pointing at a dated archive | 5 | — | ADR-0020 |
| **SCR-0101** | Render 200 clustered symbols on a real map, iOS and Android, New Architecture enabled | 5 | SCR-0105, SCR-0106 | R-04 |
| **SCR-0107** | Verify ODbL attribution renders and is unobscured in every map state; verify no tile request leaves Sharecropr infrastructure | 3 | SCR-0101 | NFR-99, NFR-102 |
| **SCR-0102** | Animate an avatar marker with follow mode while the map is panning | 3 | SCR-0101 | SPEC-008 §5.1 |
| **SCR-0103** | Profile pan, zoom, cluster expansion **and label-collision behaviour at density** on the reference device; record fps traces and time-to-first-tile | 5 | SCR-0102 | NFR-03, NFR-100 |
| **SCR-0104** | Write the go/no-go decision, and if no-go, raise the ADR-0019 supersession and re-plan | 2 | SCR-0103 | ADR-0019 |

**AC — the exit criteria, all of them.** 60 fps *sustained* pan and zoom at 200 markers **on a three-year-old mid-range Android device**, not a simulator and not a flagship · symbols render from a single source on both platforms and look **identical** · cluster expansion works · avatar animates without dropping the frame budget · memory under 250 MB (NFR-09) · attribution present and unobscured · tiles load from the PMTiles archive with no key and no user identifier · map is pannable and tappable before the first tile paints.

**AC — test what is actually unvalidated.** Marker count is no longer the risk; MapLibre renders 200 symbols as GPU layers from one source. **A spike that only re-measures marker count has not tested anything new.** The two open questions are New Architecture interop at our SDK version and style complexity — label collision, sprite count, glyph loading. Exercise both explicitly.

**AC — the failure path is a first-class outcome.** If any criterion fails: ADR-0019 is superseded, `react-native-maps` is restored behind the same seam (**~3 days — the code exists in git history**), and the basemap reverts to platform maps. **[ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)'s OSM safe-spot pipeline survives regardless** — it is server-side and renderer-independent, and it is the change with the clearest operational payoff. Record the decision before continuing.

---

## EPIC-02 — Data Model, RLS & Test Harness

**Goal:** The shared baseline every feature migration lands on top of. **Success metric:** every `public` table has RLS enabled *and* forced, with negative tests outnumbering positive ones.
**Trace:** [Data Model](../01-architecture/03-data-model.md), [RLS Design](../01-architecture/05-rls-design.md), [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), NFR-46, NFR-47, NFR-13.

> **Architect's note.** This epic exists because [the register](../03-specs/README.md#the-critical-path) is explicit that SPEC-001/002/003 and SPEC-010/011/012/013 appear mutually recursive until you separate schema dependency from behavioural coupling. The recursion is resolved *here* — by a shared baseline that lands before any feature migration. Weakening this epic re-introduces a five-way cycle that cannot be topologically sorted.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0201** | Baseline migration: extensions, schemas (`public`, `private`, `app`), roles, and the migration convention | 3 | SCR-0007 | Data Model |
| **SCR-0202** | Core identity and profile tables with RLS enabled and forced | 3 | SCR-0201 | NFR-46 |
| **SCR-0203** | PostGIS setup, the geospatial types, and the location-tier/geohash quantization helpers (ADR-0023) | 5 | SCR-0201 | ADR-0023, Location Privacy |
| **SCR-0204** | `app.*` authorization helper functions (`is_moderator`, `current_user_id`, gate predicates) | 3 | SCR-0202 | ADR-0003 |
| **SCR-0205** | pgTAP harness wired into CI, failing the build on any RLS regression | 5 | SCR-0202 | ADR-0016, NFR-47 |
| **SCR-0206** | RLS negative-test convention and a generator that asserts negatives > positives per table | 5 | SCR-0205 | NFR-47 |
| **SCR-0207** | `private.idempotency_keys` with per-table autovacuum tuning and a bloat metric on the dashboard | 3 | SCR-0201 | [N-04](../07-review/02-development-notes.md#n-04--the-idempotency-table-is-the-highest-churn-table-in-the-system) |
| **SCR-0208** | Vault integration and `handoff_code_key` provisioning, with key custody documented in Environments | 3 | SCR-0201 | [N-03](../07-review/02-development-notes.md#n-03--vault-is-now-on-the-critical-path-of-a-physical-meeting) |
| **SCR-0209** | Rehearse the Vault key-rotation runbook against seeded staging with live `scheduled` sessions | 3 | SCR-0208, SCR-1210 | N-03, [Runbook 14](../05-operations/05-runbooks.md) |
| **SCR-0210** | The location canary: a continuous job asserting no exact garden coordinate is reachable from any surface | 5 | SCR-0203 | NFR-45, NFR-26, LP-01…LP-13 |
| **SCR-0211** | Immutable audit-trail table and the append-only guard for moderator and P1 data access | 3 | SCR-0202 | NFR-53 |
| **SCR-0212** | Query-timing assertions in pgTAP that fail the build if an RLS-filtered query exceeds p95 50 ms at 10× launch volume | 3 | SCR-0205 | NFR-13 |

**AC — SCR-0210 (the canary) is the story that must not be softened.** It runs continuously, has a **zero error budget** (NFR-26), and enumerates surfaces rather than sampling them: REST responses, RPC returns, realtime payloads, push notification bodies, Sentry breadcrumbs, PostHog events, CSV exports, and moderator console views. A canary that only checks the API is a canary that will pass on the day of the leak.

---

## EPIC-03 — Authentication

**Goal:** A neighbour can create an account, prove their email, stay signed in safely, and leave completely. **Success metric:** signup→verified-email conversion > 80%; zero refresh tokens outside hardware-backed storage.
**Trace:** [SPEC-001](../03-specs/SPEC-001-authentication.md), [ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md), [ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md), [Auth & 2FA](../02-security/02-auth-and-2fa.md).

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0301** | As a neighbour, I can sign up with email and password | 3 | SCR-0202 | §5.1, NFR-50 |
| **SCR-0302** | As a neighbour, my password is rejected if under 12 characters or found in a breach corpus | 2 | SCR-0301 | NFR-50 |
| **SCR-0303** | As a neighbour, I can sign in with Apple | 3 | SCR-0301 | §5.1, ADR-0006 |
| **SCR-0304** | As a neighbour, I can sign in with Google | 3 | SCR-0301 | §5.1, ADR-0006 |
| **SCR-0305** | As a neighbour, I must verify my email before I can act, and I can request a new link | 3 | SCR-0301 | §5.2 |
| **SCR-0306** | As a neighbour, my session persists across app restarts with refresh tokens in hardware-backed storage only | 5 | SCR-0301 | §5.3, ADR-0007, NFR-48, NFR-49 |
| **SCR-0307** | As a neighbour, I can reset a forgotten password and change a known one | 3 | SCR-0305 | §5.4 |
| **SCR-0308** | As a neighbour, I can change my email address, with re-authentication required | 3 | SCR-0305 | §5.5 |
| **SCR-0309** | As a neighbour, I can request account deletion, see the grace window, and cancel it | 5 | SCR-0306 | §5.6, Privacy & Retention |
| **SCR-0310** | As a neighbour, the deletion pipeline removes or tombstones every record it promised to | 5 | SCR-0309 | §5.6, NFR-45 |
| **SCR-0311** | As an app reviewer, I can delete an account from the public web endpoint without installing the app | 3 | SCR-0309 | §5.7, store policy |
| **SCR-0312** | As an app reviewer, I have working demo credentials and a documented reviewer path | 1 | SCR-0301 | §5.7 |

**AC — SCR-0306 (sessions).** Access token lifetime ≤ 60 min · refresh tokens rotate and are single-use · a stolen refresh token replayed after rotation is rejected and invalidates the family · token refresh p95 < 250 ms (NFR-16) · no token is ever written to `AsyncStorage`, a log line, or a crash report — asserted by a test, not by review.

**AC — SCR-0310 (deletion).** Every table listed in [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md) is covered by an assertion. Deletion of a user who is a participant in an in-flight exchange resolves that exchange first — it does not orphan the counterparty. A tombstone that still resolves to a garden coordinate is a NFR-45 failure and fails the canary.

---

## EPIC-04 — Two-Factor Authentication

**Goal:** TOTP that people can actually recover from. **Success metric:** enrolment > 25% at 90 days; recovery-support tickets < 1 per 100 enrolled users per month.
**Trace:** [SPEC-002](../03-specs/SPEC-002-two-factor-auth.md), [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md), NFR-51.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0401** | As a neighbour, I can enrol a TOTP factor by scanning a QR code and confirming a code | 5 | SCR-0306 | §5.2, NFR-51 |
| **SCR-0402** | As a neighbour, I am issued one-time recovery codes at enrolment and must acknowledge storing them | 3 | SCR-0401 | §5.3 |
| **SCR-0403** | As a neighbour, sensitive actions trigger step-up authentication to AAL2 | 5 | SCR-0401 | §5.4 |
| **SCR-0404** | As a neighbour, a code from an adjacent time window is accepted; repeated wrong codes lock me out with a clear recovery route | 3 | SCR-0401 | §5.5 |
| **SCR-0405** | As a neighbour, I can redeem a recovery code, and it is burned on use | 3 | SCR-0402 | §5.6 |
| **SCR-0406** | As a neighbour, I can regenerate recovery codes, invalidating the old set | 2 | SCR-0405 | §5.3 |
| **SCR-0407** | As a neighbour, I can disable and re-enrol 2FA, with step-up required for both | 3 | SCR-0403 | §5.7 |
| **SCR-0408** | As a neighbour who lost both my device and my codes, there is a defined, rate-limited, human-reviewed recovery path | 5 | SCR-0405 | §5.8 |

**AC — SCR-0408 (the path everyone forgets).** The request is rate-limited, the waiting period is stated to the user up front, the review is logged to the immutable audit trail (NFR-53), and the path can be cancelled by the account owner from a still-valid session — which is the control that stops it being a social-engineering backdoor. Failure modes covered: request while a valid session exists, two concurrent requests, cancellation after approval but before use.

---

## EPIC-05 — Identity Verification

**Goal:** Both parties to a physical meeting are KYC-verified, with the minimum possible data retained. **Success metric:** verification start→pass conversion > 70%; zero PII from the vendor stored beyond the pass/fail flag and reference.
**Trace:** [SPEC-003](../03-specs/SPEC-003-identity-verification.md), [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md), [Identity Verification](../02-security/03-identity-verification.md), [R-03](02-open-risks.md#r-03--physical-safety-is-irreducible-and-one-incident-is-existential).

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0501** | As a neighbour, I can start a hosted verification flow and return to the app | 5 | SCR-0306 | §5.2 |
| **SCR-0502** | As the system, the vendor webhook records pass/fail and a reference, and nothing else | 3 | SCR-0501 | §5.1, §5.3, data minimization |
| **SCR-0503** | As the system, the webhook is signature-verified, replay-resistant, and idempotent | 5 | SCR-0502 | §5.3 |
| **SCR-0504** | As a neighbour, verification gates transacting only — I can browse, list, and message without it | 3 | SCR-0502 | §5.4 |
| **SCR-0505** | As a neighbour, I am told why I am gated, in language that names the action I can take | 2 | SCR-0504 | §5.4, §8.3 |
| **SCR-0506** | As the system, a reconciliation job repairs state when a webhook was never delivered | 3 | SCR-0503 | §5.6 |
| **SCR-0507** | As a neighbour, my verification expires and I am prompted to re-verify before it gates me | 3 | SCR-0502 | §5.5 |

**AC — SCR-0504 (where the gate sits) is a product decision encoded in code.** Verification gates *transacting*, not *existing*. A user who has not verified can browse the map, build inventory, publish a listing, and message — because a marketplace that demands ID before showing value converts at a fraction of one that doesn't. The gate fires at `create_exchange_request` and `accept_exchange_request`, and nowhere earlier. Any future story that moves the gate earlier requires a recorded decision.

> **Open decision, owed before launch ([Roadmap §Decision points](01-roadmap.md#decision-points)).** Does the alternate trust path exist at MVP at all? KYC excludes people without government ID — disproportionately the people a neighbourhood food-sharing product should serve. This backlog assumes **no alternate path at MVP** and carries the equity cost knowingly. If that assumption is wrong, it is wrong now, not in Phase 2.

---

## EPIC-06 — Garden Verification & Location Privacy

**Goal:** Prove someone has a garden without ever learning, storing, or emitting where it is. **Success metric:** garden review queue p95 turnaround < 24 h; location canary 100% pass, always.
**Trace:** [SPEC-004](../03-specs/SPEC-004-garden-verification.md), [Location Privacy](../01-architecture/04-location-privacy.md), NFR-45, NFR-26.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0601** | As a neighbour, I can register exactly one garden; a second attempt is refused with a clear reason | 2 | SCR-0503 | §5.1 |
| **SCR-0602** | As a neighbour, my garden location is captured on-device and never leaves the device un-fuzzed | 5 | SCR-0601, SCR-0203 | §5.2, §5.4 |
| **SCR-0603** | As a neighbour, I take a geotagged photo in-app and cannot upload one from my library | 3 | SCR-0602 | §5.3 |
| **SCR-0604** | As the system, `media-process` strips EXIF, generates a thumbnail and blurhash, before the asset is readable | 5 | SCR-0603 | §7, NFR-52, NFR-17 |
| **SCR-0605** | As the system, the fuzzing invariant holds: only derived location is persisted and no query can recover the original | 5 | SCR-0602 | §5.4, NFR-45 |
| **SCR-0606** | As the system, the capture is scored against a distance tolerance and routed to review or auto-reject | 5 | SCR-0605 | §5.5 |
| **SCR-0607** | As a moderator, I can approve or reject a garden capture with a reason, recorded to the audit trail | 3 | SCR-0606 | §5.6, NFR-53 |
| **SCR-0608** | As a neighbour, a rejection tells me what to fix and lets me resubmit within limits | 3 | SCR-0607 | §5.7 |
| **SCR-0609** | As a neighbour who denies location permission, there is a degraded path that does not dead-end me | 3 | SCR-0602 | §5.8 |
| **SCR-0610** | As the system, the location canary covers every garden-derived surface added by this epic | 3 | SCR-0210 | NFR-26 |

**AC — SCR-0605 (the fuzzing invariant), stated as a property, not a behaviour.** For any sequence of API calls, realtime subscriptions, notification payloads, telemetry events, and exports available to any actor — including a moderator and including staff with database read access via the console — the mutual information between the response set and the true garden coordinate must not exceed the fuzz radius. Tested adversarially: repeated captures, multi-account correlation, and timing.

**AC — SCR-0604 (EXIF).** The asset is *not readable* until processing completes. Not "processed shortly after upload" — a window in which the original is fetchable is the whole vulnerability. Verified by attempting a read of a mid-processing asset and asserting a 404, not a 200.

---

## EPIC-07 — Crop Taxonomy

**Goal:** A shared vocabulary that works offline and can evolve without breaking existing inventory. **Success metric:** species-picker search success on first query > 90%; taxonomy fully available with zero network.
**Trace:** [SPEC-005](../03-specs/SPEC-005-crop-taxonomy.md), NFR-31.

> **Parallelizable from day one.** SPEC-005 depends on nothing. It is mostly data work and it unblocks EPIC-09. Start it in sprint 1 alongside the spike.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0701** | Kingdom → category → species → variety hierarchy with closed vocabularies | 3 | SCR-0201 | §5.1, §6.2 |
| **SCR-0702** | As a neighbour, I can find a crop by common name, alias, or misspelling | 5 | SCR-0701 | §5.2, §7.3 |
| **SCR-0703** | As the app, the full taxonomy is bundled and usable with no network at all | 3 | SCR-0701 | §5.3, NFR-31 |
| **SCR-0704** | As the app, I fetch only the delta since my bundled version on launch | 5 | SCR-0703 | §5.3, §7.2 |
| **SCR-0705** | As a taxonomy owner, I can rename or merge a species without orphaning existing inventory rows | 5 | SCR-0701 | §5.4, §6.1 |
| **SCR-0706** | As a neighbour, I can propose a variety that isn't listed, and it enters an approval queue | 3 | SCR-0701 | §5.5, §7.4 |
| **SCR-0707** | As a taxonomy owner, I can approve or reject a proposed variety | 2 | SCR-0706 | §7.5 |
| **SCR-0708** | Seed the launch taxonomy dataset | 3 | SCR-0701 | §5.6 |

> **[N-15] `composted` exists twice.** The value appears in two closed vocabularies with different meanings. Fixing it is cheap now and gets more expensive every month there is production data. **Resolve it in SCR-0701, before the first seed load.**

---

## EPIC-08 — Safe Spots

**Goal:** Enough verified public meeting places that the map is not empty. **Success metric:** ≥ 50 approved spots per metro at launch; ≥ 8 active listings per active spot at week 4 ([R-01](02-open-risks.md#r-01--liquidity-not-architecture-decides-whether-this-works)).
**Trace:** [SPEC-007](../03-specs/SPEC-007-safe-spots.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [N-09](../07-review/02-development-notes.md#n-09--safe-spot-curation-is-the-growth-constraint-not-engineering).

> **Twelve-week lead time, starting day one.** SCR-0801 is the earliest-startable, longest-running item in the whole plan and the one most likely to be started too late. It is manual, it requires physically verifying venue hours, and no amount of engineering shortens it.
>
> **The console is not a prerequisite.** The register is explicit: curation *happens through* SPEC-900, but `safe_spots` does not need it to exist. Seeding metro one is manual data entry against the schema. If that proves painful, pull a thin curation slice forward — do **not** make the console a prerequisite for the product's supply side.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0801** | Curate and physically verify safe spots for metro one *(ops track — runs 12 weeks)* | — | — | §5.6, N-09 |
| **SCR-0802** | Safe-spot schema, categories, and eligibility constraints | 3 | SCR-0203 | §5.1, §5.2, §6.3 |
| **SCR-0803** | `hours` JSON schema and the `app.venue_open_during` definer function | 5 | SCR-0802 | §6.2, §7.3 |
| **SCR-0804** | `rpc.safe_spots_near` meeting p95 < 400 ms at 8 km, 500k listings, 200 concurrent | 5 | SCR-0802 | §7.2, NFR-11, NFR-12 |
| **SCR-0805** | Staff write path for creating and approving a spot, audited | 3 | SCR-0802 | §5.3, §7.5 |
| **SCR-0806** | Hours staleness tracking, so a spot with unverified hours is visibly stale rather than silently wrong | 3 | SCR-0803 | §5.4 |
| **SCR-0807** | Suspend, retire, and take down a spot, with in-flight exchanges at that spot handled | 5 | SCR-0805 | §5.5 |
| **SCR-0808** | As a neighbour, I can report a problem with a spot | 2 | SCR-0802 | §7.4 |
| **SCR-0809** | Bulk seeding tooling for metro data entry | 2 | SCR-0805 | §5.6 |

**AC — SCR-0807 (takedown).** Retiring a safe spot with `scheduled` sessions attached must not orphan those sessions. Every affected participant is notified, the session is moved to a re-scheduling state, and the workflow is testable end to end. *(Workflow Architect: this is exactly the "what happens at step 7 of 12" path — a takedown is rare, which is why it will be untested.)*

---

## EPIC-09 — Crop Inventory

**Goal:** Recording what you have is fast enough to do standing in the garden with one hand. **Success metric:** median time to add an item < 30 s; inventory writes succeed offline 100% of the time.
**Trace:** [SPEC-006](../03-specs/SPEC-006-crop-inventory.md), NFR-32, NFR-05.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-0901** | Inventory item model, validation, and status transitions | 3 | SCR-0607, SCR-0701 | §5.1, §6.1 |
| **SCR-0902** | As a gardener, I can add an item by picking a species, with variety and a custom label optional | 5 | SCR-0901, SCR-0702 | §5.1, §5.2 |
| **SCR-0903** | As a gardener, I can set quantity and unit from a closed vocabulary | 2 | SCR-0902 | §5.1, §6.2 |
| **SCR-0904** | As a gardener, I can attach photos, EXIF-stripped server-side | 3 | SCR-0902, SCR-0604 | §5.3, NFR-52 |
| **SCR-0905** | As a gardener, my inventory is private by default and nothing is visible until I publish a listing | 5 | SCR-0901 | §5.4, RLS |
| **SCR-0906** | As a gardener, I can archive and soft-delete items without losing exchange history | 3 | SCR-0901 | §5.5 |
| **SCR-0907** | As a gardener, I can read and write my inventory with no network, and writes sync on reconnect | 5 | SCR-0901 | §5.6, NFR-32, NFR-36 |
| **SCR-0908** | As a gardener, a queued write that fails five times surfaces a persistent failure state and is never silently dropped | 3 | SCR-0907 | NFR-37 |
| **SCR-0909** | As a gardener, a 200-item list scrolls at 60 fps and thumbnails render from cache in under 200 ms | 3 | SCR-0904 | §5.7, NFR-05, NFR-06 |
| **SCR-0910** | As a gardener, I can keep private notes on an item that are never published | 2 | SCR-0905 | §7.3 |

**AC — SCR-0905 (the publication boundary).** The default is private, enforced by RLS, not by the client omitting a field. A test asserts that another user's authenticated read of an unpublished item returns zero rows — and a second test asserts the same for a moderator, because "moderator can see everything" is a decision that belongs in SPEC-900 and not in an implicit RLS gap.

**AC — SCR-0907 (offline, exactly once).** Queued mutations deliver **exactly once** on reconnect and MUST NOT duplicate (NFR-36). Tested with: airplane mode mid-write, app killed with a queue pending, reconnect during a partial flush, and the same mutation replayed after a server-side 500.

---

## EPIC-10 — Listings & Offers

**Goal:** Turn private inventory into a public offer attached to a place. **Success metric:** listing→request conversion measurable from week 1; zero listings that reveal a garden location.
**Trace:** [SPEC-009](../03-specs/SPEC-009-listings-and-offers.md).

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1001** | Listing model, status transitions, and the publish guard | 3 | SCR-0905, SCR-0802 | §5.1, §6.1 |
| **SCR-1002** | As a gardener, I can compose and publish a listing from an inventory item | 5 | SCR-1001 | §5.1, §7.1 |
| **SCR-1003** | As a gardener, I attach my listing to between one and three safe spots | 3 | SCR-1002 | §5.2, §7.3 |
| **SCR-1004** | As a gardener, I set an expiry window and the listing expires automatically | 3 | SCR-1002 | §5.4 |
| **SCR-1005** | As a gardener, I can withdraw a listing, and in-flight requests against it are resolved not orphaned | 3 | SCR-1002 | §5.5, §7.2 |
| **SCR-1006** | As a gardener, I can record what I'm looking for | 3 | SCR-1001 | §5.3 |
| **SCR-1007** | As a gardener, I see suggested matches between my wishlist and nearby listings | 5 | SCR-1006, SCR-0804 | §5.3, §7.4 |
| **SCR-1008** | As a requester, I see only what a requester is entitled to see; the owner sees more | 5 | SCR-1001 | §5.6, RLS |
| **SCR-1009** | As the system, concurrent edits to a listing cannot produce an inconsistent state | 5 | SCR-1002 | §5.7 |
| **SCR-1010** | As a gardener, publishing works offline and reconciles on reconnect | 2 | SCR-0907 | NFR-36 |

---

## EPIC-11 — Interactive Map

**Goal:** Open the app, see that there is something here. **Success metric:** cold start → interactive map p95 < 2.5 s on the reference device; map is never empty without an explanation.
**Trace:** [SPEC-008](../03-specs/SPEC-008-interactive-map.md), NFR-01, NFR-03, NFR-33.

> **Gated on EPIC-01.** If the spike went no-go, this epic is re-estimated against `@rnmapbox/maps` before it is pulled.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1101** | Map camera, follow mode, and avatar, carried forward from the spike | 5 | SCR-0104, SCR-1003 | §5.1 |
| **SCR-1102** | Viewport querying with quantized coordinates so the request itself leaks nothing | 5 | SCR-0804 | §5.2, NFR-45 |
| **SCR-1103** | Marker styling and clustering at 200 markers, 60 fps sustained | 5 | SCR-1101 | §5.3, NFR-03 |
| **SCR-1104** | Category filters, species search, and radius control | 5 | SCR-1102 | §5.4 |
| **SCR-1105** | Safe-spot bottom sheet with listings at that spot, and the inventory FAB | 5 | SCR-1103 | §5.5 |
| **SCR-1106** | Location permission flow, including a fully usable denied path | 3 | SCR-1101 | §5.6 |
| **SCR-1107** | Performance degradation ladder — what is dropped first when the budget is exceeded | 3 | SCR-1103 | §5.7 |
| **SCR-1108** | List view as a complete alternative to the map, not a fallback | 3 | SCR-1104 | §5.8 |
| **SCR-1109** | Empty, cold-start, offline and stale states — each with an action, none with a spinner | 3 | SCR-1102 | §5.9, NFR-33 |

**AC — SCR-1109 (empty is the default state at launch).** [N-02](../07-review/02-development-notes.md#n-02--supply-seeding-has-no-engineering-weeks-and-decides-the-outcome) and [N-13](../07-review/02-development-notes.md#n-13--the-trusted-tier-will-be-empty-and-will-read-as-a-warning) both land here. On launch day, in most viewports, the map has nothing on it. The empty state is not an edge case — it is the **modal experience of a new user in week one**, and it must offer an action (widen radius, switch to list, set a wishlist alert) rather than an apology. Offline shows last-known state with an explicit staleness banner (NFR-33) — never an empty screen and never a permanent spinner.

---

## EPIC-12 — Exchange Lifecycle

**Goal:** Two strangers meet in a public place and swap food, and the system never double-promises, never strands anyone, and never reveals a home. **Success metric:** request→completed conversion; zero double-acceptances; `accept_exchange_request` p99 < 300 ms under contention.
**Trace:** [SPEC-010](../03-specs/SPEC-010-exchange-lifecycle.md), [Exchange State Machine](../01-architecture/07-exchange-state-machine.md), NFR-14.

> **The highest-risk epic in the plan, and the one where the eight concurrency hazards live.** Nothing in §5.8 is optional and nothing in it is cuttable. This epic is 63 points because the correctness bar is a physical meeting between strangers, not a shopping cart.

### 12a — The state machine

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1201** | Request and session tables, and the generated legal-transition tables | 5 | SCR-1001, SCR-0504 | §6.1, §6.2 |
| **SCR-1202** | Storage-layer transition guard trigger, rejecting any edge not in the legal table | 5 | SCR-1201 | Exchange State Machine §4 |
| **SCR-1203** | Idempotency wrapper applied to all eight mutating RPCs | 3 | SCR-0207, SCR-1201 | §7, N-04 |
| **SCR-1204** | Client-side `PARTICIPANT_TRANSITIONS` generated from the same source as the server table | 3 | SCR-1202 | §5.9, [N-05](../07-review/02-development-notes.md#n-05--moderator-only-transitions-are-a-convention-not-a-constraint) |

### 12b — The happy path

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1205** | As a requester, I can send an exchange request against a listing | 5 | SCR-1201 | §5.1, §7.1 |
| **SCR-1206** | As an owner, I can accept a request — and this is the critical section | 5 | SCR-1205 | §5.3, §7.2, NFR-14 |
| **SCR-1207** | As an owner, I can decline; as a requester, I can withdraw | 3 | SCR-1205 | §5.2, §7.3, §7.4 |
| **SCR-1208** | As a participant, I can propose a time and place from the listing's safe spots | 5 | SCR-1206 | §5.4, §7.5 |
| **SCR-1209** | As a participant, I can confirm a proposed schedule | 3 | SCR-1208 | §7.6 |
| **SCR-1210** | As a participant, I get a handoff code, decrypted server-side, never cached on device | 5 | SCR-1209, SCR-0208 | §5.5, N-03 |
| **SCR-1211** | As both participants, dual handoff confirmation completes the exchange | 5 | SCR-1210 | §5.5, §7.7 |
| **SCR-1212** | As a participant, I can cancel a session, with the counterparty notified immediately | 3 | SCR-1209 | §5.6, §7.8 |

### 12c — The paths that decide whether it works

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1213** | All eight concurrency hazards from §5.8 have a control and a test that provokes them | 5 | SCR-1206 | §5.8 |
| **SCR-1214** | No-show reporting and the dispute path, including ties | 5 | SCR-1211 | §5.7 |
| **SCR-1215** | `dual_with_fallback` shipped **written, tested, and disabled**, with a periodic exercise job | 3 | SCR-1211 | R88, [N-06](../07-review/02-development-notes.md#n-06--the-disabled-fallback-path-will-rot-unless-it-is-exercised) |
| **SCR-1216** | Client error taxonomy, including a distinct code and human string for Vault unavailability | 3 | SCR-1210 | §7.10, N-03 |
| **SCR-1217** | Exchanges readable offline with actions disabled and a stated reason | 3 | SCR-1201 | NFR-34 |
| **SCR-1218** | Test asserting `disputed → cancelled` and `disputed → completed` are unreachable from any participant RPC | 3 | SCR-1202 | T59, N-05 |
| **SCR-1219** | Time-and-place row retention: the 90-day fuse on the highest-value row in the database | 3 | SCR-1209 | [N-16](../07-review/02-development-notes.md#n-16--the-highest-value-row-in-the-database-has-a-90-day-fuse) |

**AC — SCR-1213 (the eight hazards).** Each of the eight has a named test that **provokes the race**, not one that merely asserts the guard exists. Two accepts of the same request from two devices at the same millisecond; an accept racing a withdrawal; an accept racing a listing withdrawal; a schedule confirm racing a cancel; a handoff confirm racing a dispute; a safe-spot takedown racing a schedule confirm; a block racing an accept; a deletion racing an in-flight session. A guard with no adversarial test is an assumption.

**AC — SCR-1216 (Vault down at the worst possible moment).** When `vault.get_secret('handoff_code_key')` is unavailable, `get_handoff_code` and `confirm_handoff` return a **distinct** error code with the string *"we can't verify your code right now — try again in a moment"*, not a generic `server_error`. There is no cached path and there must not be one. This is the message two people read while standing next to each other in a library lobby.

**AC — SCR-1218 (moderator edges).** This test fails closed and is **treated as a security review to change**, per N-05. The next engineer adding a session RPC will see two legal transitions and no compile-time reason to avoid them; this test is the only thing standing there.

---

## EPIC-13 — Messaging

**Goal:** Enough conversation to coordinate a handoff, and not one message more. **Success metric:** realtime delivery p95 < 2 s; zero cold DMs, structurally.
**Trace:** [SPEC-011](../03-specs/SPEC-011-messaging.md), NFR-15, NFR-19, NFR-35.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1301** | Threads open with an exchange and close with it — no thread exists outside one | 5 | SCR-1206 | §5.1 |
| **SCR-1302** | As a participant, I can send and read messages, insert p95 < 100 ms | 3 | SCR-1301 | §5.2, NFR-15 |
| **SCR-1303** | As a participant, messages arrive in realtime, p95 < 2 s | 3 | SCR-1302 | Realtime, NFR-19 |
| **SCR-1304** | As a participant, I can mark a thread read and see unread counts | 2 | SCR-1302 | §7 |
| **SCR-1305** | As the system, message rate limits apply per thread and per user | 3 | SCR-1302 | §5.3, [N-18](../07-review/02-development-notes.md#n-18--every-rate-limit-is-a-guess-and-two-of-them-are-load-bearing) |
| **SCR-1306** | As the system, `content-scan` flags messages and routes them to moderation | 5 | SCR-1302 | §5.4 |
| **SCR-1307** | As a moderator, I can read a thread only with a recorded, audited reason | 3 | SCR-1306, SCR-0211 | §5.5, NFR-53 |
| **SCR-1308** | As a participant, messages are readable from cache offline and sends queue with an unmistakable pending indicator | 3 | SCR-1302 | NFR-35 |

> **[N-18] Two rate limits are load-bearing guesses.** SCR-1305's numbers are invented. Instrument them from day one and put them on the dashboard, because the first thing you'll want when abuse appears is the distribution you didn't record.

---

## EPIC-14 — Trust & Safety

**Goal:** A bad actor is caught, a good actor is not punished for being new, and a severity-1 report is answered in 15 minutes. **Success metric:** NFR-25 met with zero misses. Zero error budget.
**Trace:** [SPEC-012](../03-specs/SPEC-012-trust-and-safety.md), [Trust & Safety](../02-security/05-trust-and-safety.md), NFR-25.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1401** | As a participant, I can rate a completed exchange; ratings are immutable once submitted | 5 | SCR-1211 | §5.1, §7.1 |
| **SCR-1402** | As a participant, ratings reveal double-blind — neither side sees the other's until both are in or the window closes | 5 | SCR-1401 | §5.2 |
| **SCR-1403** | As a neighbour, I can report a user, a listing, a message, or a spot | 5 | SCR-1401 | §5.3, §7.2 |
| **SCR-1404** | As the system, reports are triaged by severity with SLA timers, and severity-1 pages a human in under 15 minutes | 5 | SCR-1403 | §5.3, NFR-25 |
| **SCR-1405** | As a neighbour, I can block someone, and the block tears down every existing surface between us | 5 | SCR-1403 | §5.4 |
| **SCR-1406** | Trust score and tier computation, with the inputs documented and auditable | 5 | SCR-1402 | §5.5 |
| **SCR-1407** | Abuse resistance: rating-farming, report-brigading, and sockpuppet controls | 5 | SCR-1406 | §5.6 |
| **SCR-1408** | As a moderator, I can freeze an exchange and resolve a frozen one | 5 | SCR-1404, SCR-1202 | §5.7 |
| **SCR-1409** | The `trusted` tier reads as neutral, not as a warning, while it is empty | 2 | SCR-1406 | [N-13](../07-review/02-development-notes.md#n-13--the-trusted-tier-will-be-empty-and-will-read-as-a-warning) |

**AC — SCR-1405 (block teardown) is the story most likely to be under-specified.** A block must tear down: the thread, any in-flight request in either direction, any scheduled session, visibility of each other's listings on the map and in search, match suggestions, and notification routing. Each of those is a separate assertion. A block that leaves one surface standing is a block that failed at the moment it mattered.

**AC — SCR-1409.** At launch nobody has completed enough exchanges to be `trusted`, so every profile shows the *absence* of a badge. Copy and visual treatment must make an unbadged new neighbour read as **new**, not as **suspect** — otherwise the trust system suppresses the liquidity it exists to protect.

---

## EPIC-15 — Moderation Console

**Goal:** A moderator can work a queue without SQL. **Success metric:** median time-to-first-action on a severity-1 report < 15 min (NFR-25).
**Trace:** [SPEC-900](../03-specs/SPEC-900-moderation-console.md), [N-10](../07-review/02-development-notes.md#n-10--the-moderation-rota-is-asserted-to-apple-before-it-exists).

> **The scope-cut candidate — with one non-negotiable.** [N-10] records that a moderation capability was asserted to Apple during store submission planning. **The rota and the response capability must exist at launch.** The *console UI* is what can be cut. The thin slice is SCR-1501 + 1502 + 1505.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1501** | Moderator role, access control, and session policy | 3 | SCR-0204 | §5.1 |
| **SCR-1502** | Queues: reports, garden reviews, flagged content, with SLA timers visible | 5 | SCR-1404, SCR-0606 | §5.2 |
| **SCR-1503** | Case context view assembling everything a moderator needs without a second query | 5 | SCR-1502 | §5.3 |
| **SCR-1504** | Actions: warn, suspend, remove content, freeze exchange, approve/reject garden | 5 | SCR-1503, SCR-1408 | §5.4, §7 |
| **SCR-1505** | Every action written to the immutable audit trail, with the reason required not optional | 3 | SCR-1504, SCR-0211 | §5.5, NFR-53 |
| **SCR-1506** | Moderator wellbeing controls — content blurring, session limits, escalation | 3 | SCR-1503 | §5.6 |
| **SCR-1507** | Safe-spot curation affordance in the console | 3 | SCR-0805 | Register note on 007/900 |
| **SCR-1508** | The on-call rota, escalation path, and severity-1 pager, documented and rehearsed | 3 | SCR-1502 | N-10, NFR-25 |
| **SCR-1509** | Moderator console views included in the location canary's enumerated surfaces | 3 | SCR-0210, SCR-1503 | NFR-45 |

**AC — SCR-1508 is a launch blocker regardless of what else is cut.** A rehearsed rota with a named human, a tested pager, and a documented escalation path. Asserting a moderation capability to an app store that does not exist in practice is a review rejection at best.

---

## EPIC-16 — Notifications

**Goal:** People find out things happened, and the record survives a failed push. **Success metric:** inbox delivery 100% (NFR-24); push→Expo p95 < 60 s.
**Trace:** [SPEC-013](../03-specs/SPEC-013-notifications.md), [Realtime & Notifications](../01-architecture/08-realtime-and-notifications.md), NFR-18, NFR-23, NFR-24.

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1601** | Durable inbox as the record of truth, independent of push delivery | 5 | SCR-1201 | §5.1, NFR-24 |
| **SCR-1602** | The notification catalog, with priority, collapse keys, and channels | 3 | SCR-1601 | §5.2, §6.2, §6.3 |
| **SCR-1603** | Outbox row lifecycle and the `push-drain` worker, p95 < 60 s | 5 | SCR-1602 | §6.1, §7.4, NFR-18 |
| **SCR-1604** | `push-receipts` handling, retiring dead tokens | 3 | SCR-1603 | §7.5, NFR-23 |
| **SCR-1605** | As a neighbour, I can set preferences and quiet hours | 3 | SCR-1602 | §5.3, §7.3 |
| **SCR-1606** | As a neighbour, the safety-critical notification cannot be turned off, and I am told why | 2 | SCR-1605 | §5.3 |
| **SCR-1607** | Device registration and permission request at a contextual moment, not on first launch | 3 | SCR-1601 | §5.4, §7.2 |
| **SCR-1608** | Deep-link routing from a notification, including foreground and cold start | 5 | SCR-1603 | §5.6 |
| **SCR-1609** | Mark-read, badge counts, and cross-device consistency | 2 | SCR-1601 | §7.1 |

**AC — SCR-1601.** Push is best-effort (NFR-23, ≥ 99%); the inbox is not (NFR-24, 100%, always). A push that never arrives must leave a user who opens the app with the complete story. Tested by dropping the push channel entirely and asserting no information loss.

---

## EPIC-17 — Observability & Operational Readiness

**Goal:** When something breaks at 2am, the person paged can tell what and why. **Success metric:** every NFR with a number has a dashboard tile; every alert has a runbook.
**Trace:** [Observability](../05-operations/04-observability.md), [ADR-0018](../01-architecture/adr/ADR-0018-observability.md), [Runbooks](../05-operations/05-runbooks.md), [N-08](../07-review/02-development-notes.md#n-08--three-alerts-page-a-human-and-fix-nothing).

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1701** | Sentry wired with release tracking, source maps, and PII scrubbing verified against NFR-45 | 3 | SCR-0009 | ADR-0018, NFR-45 |
| **SCR-1702** | PostHog events, with an allowlist that makes leaking a coordinate structurally impossible | 5 | SCR-1701 | NFR-45 |
| **SCR-1703** | A dashboard tile for every numbered NFR budget | 5 | SCR-1702 | NFR §1–4 |
| **SCR-1704** | The R-01 liquidity tile: active listings per active safe spot, from day one | 3 | SCR-1703 | [R-01](02-open-risks.md#r-01--liquidity-not-architecture-decides-whether-this-works), N-02 |
| **SCR-1705** | Alert triage: every alert either has a runbook and an action, or is deleted | 3 | SCR-1703 | N-08 |
| **SCR-1706** | k6 nightly load suite covering NFR-11, NFR-12, NFR-14 | 5 | SCR-0804 | NFR §1.2 |
| **SCR-1707** | Maestro nightly timing suite covering NFR-01, NFR-02, NFR-04 on the reference device | 5 | SCR-1109 | ADR-0015, NFR §1.1 |
| **SCR-1708** | Backup, PITR and quarterly restore rehearsal, first rehearsal before launch | 3 | SCR-0201 | NFR-27…NFR-30 |

> **[N-08] Three alerts page a human and fix nothing.** Triage before launch, not after the third false page teaches the on-call to ignore the pager.

---

## EPIC-18 — Hardening, Compliance & Launch

**Goal:** Ship it, and be able to prove it's safe. **Success metric:** external review closed; store approval first submission; crash-free sessions ≥ 99.5%.
**Trace:** [Threat Model](../02-security/01-threat-model.md), [Release & Store Submission](../05-operations/03-release-and-store-submission.md), [QA Release Checklist](../04-testing/05-qa-release-checklist.md), [N-11](../07-review/02-development-notes.md#n-11--four-workflows-touching-safety-or-regulation-have-no-spec).

| Key | Story | Pts | Blocked by | Trace |
| --- | --- | --- | --- | --- |
| **SCR-1801** | Spec the four unspecced safety/regulatory workflows named in N-11 | 5 | — | N-11 |
| **SCR-1802** | External security review, with findings triaged and blockers closed | 5 | SCR-1509 | Threat Model |
| **SCR-1803** | Full E2E scenario suite green on both platforms | 5 | SCR-1707 | [E2E Scenarios](../04-testing/04-e2e-scenarios.md) |
| **SCR-1804** | RLS test plan and geospatial test plan fully executed | 5 | SCR-0206 | [RLS Test Plan](../04-testing/02-rls-test-plan.md), [Geospatial Test Plan](../04-testing/03-geospatial-test-plan.md) |
| **SCR-1805** | Accessibility pass across every screen, against each spec's §12 | 5 | SCR-1109 | Specs §12 |
| **SCR-1806** | Store listings, privacy nutrition labels, and data-safety declarations that match what the code does | 3 | SCR-1802 | Release & Store Submission |
| **SCR-1807** | Certificate pinning for Supabase and Persona hosts, with a pin-rotation plan | 3 | SCR-0306 | NFR-44 |
| **SCR-1808** | Launch-day runbook, rollback rehearsal, and the go/no-go checklist | 3 | SCR-0012 | QA Release Checklist |

**AC — SCR-1806.** The privacy declarations are generated from, or diffed against, the actual data flows — not written from memory. A declaration that says less than the code does is a compliance failure; one that says more is a conversion cost.

---

## EPIC-19 — Supply Seeding & Liquidity (non-engineering)

**Goal:** A new user's first map view is not empty. **Success metric:** ≥ 8 active listings per active safe spot at week 4. **This is the metric the project lives or dies on.**
**Trace:** [R-01](02-open-risks.md#r-01--liquidity-not-architecture-decides-whether-this-works), [N-02](../07-review/02-development-notes.md#n-02--supply-seeding-has-no-engineering-weeks-and-decides-the-outcome).

> **Zero story points, and it decides the outcome.** The plan contains roughly 18 weeks of engineering and approximately zero weeks of supply seeding. This epic carries no points because it is not engineering work — but it carries an owner, a start date, and a kill trigger, which is more than most engineering epics do.

| Key | Item | Starts | Owner |
| --- | --- | --- | --- |
| **SCR-1901** | Recruit gardening communities in metro one | Week 1 | Product |
| **SCR-1902** | Recruit gardening communities in metro two | Week 4 | Product |
| **SCR-1903** | Seed listings ahead of public launch | Week 8 | Product |
| **SCR-1904** | Instrument and publish the liquidity tile *(engineering: SCR-1704)* | Week 1 | Product + Eng |
| **SCR-1905** | **Week-4 kill trigger review** — under 8 listings per active spot, feature work stops | Week 4 post-launch | Product + CTO |

**SCR-1905 is agreed now, in writing, before anyone is emotionally invested in continuing.** That is the entire reason it is a backlog item and not a paragraph.

---

## Phase 2 — epic placeholders

Specified, not decomposed. **Phase 2 is reordered by launch data, not by this table** — if retention is fine and liquidity is the problem, EPIC-21 jumps ahead of EPIC-20.

| Epic | Spec | Est. | Decomposition trigger |
| --- | --- | --- | --- |
| **EPIC-20** Harvest Planning & Surplus Alerts | [SPEC-020](../03-specs/SPEC-020-harvest-planning.md) | ~55 pts | First off-season, or when retention data lands ([R-13](02-open-risks.md#r-13--seasonality-may-kill-retention)) |
| **EPIC-21** Community Groups & Garden Clubs | [SPEC-021](../03-specs/SPEC-021-community-groups.md) | ~55 pts | Week-4 liquidity review says the problem is demand-side |
| **EPIC-24** Alternate trust path | [Identity §6.1](../02-security/03-identity-verification.md) | ~21 pts | Needs the recorded decision from R-03 first |
| **EPIC-25** User-proposed safe spots | SPEC-007 v2 | ~21 pts | When curation headcount becomes the coverage constraint |
| **EPIC-26** Deferred MVP items (Facebook/X OAuth, multi-garden, iPad, Spanish) | — | ~34 pts | Any time; deferred purely for MVP focus |

## Phase 3 — epic placeholders

| Epic | Spec | Est. | Gate |
| --- | --- | --- | --- |
| **EPIC-22** Gamification | [SPEC-022](../03-specs/SPEC-022-gamification.md) | ~40 pts | **Deliberately last.** Requires the full anti-gaming design, and the open register question on its security review resolved (SPEC-022 §15 Q1) |
| **EPIC-23** Crop ID & Food Safety | [SPEC-023](../03-specs/SPEC-023-crop-id-and-food-safety.md) | ~55 pts | Crop ID needs a labelled corpus. **Food safety needs counsel before it needs code.** |

---

## Sprint plan — MVP

Two-week sprints, three engineers, **42 points capacity**. Sprint 0 is one week.

This schedule is **generated, not asserted** — every story is placed in the earliest sprint where its `Blocked by` predecessors are already complete and the sprint has capacity. It is verified to contain zero ordering violations. If you re-estimate a story, regenerate the schedule rather than nudging a row.

| Sprint | Theme | Stories | Pts | Exit criterion |
| --- | --- | --- | --- | --- |
| **S0** | Spike + platform | SCR-0001…0002 · SCR-0101…0104 | 18 | **Go/no-go on the map stack is written down.** Nothing below starts until it is. |
| **S1** | CI gates + schema baseline | SCR-0003…0012 · SCR-0201…0203 · SCR-0801\* · SCR-1901\* | 40 | A deliberately-broken fixture fails each CI gate. Curation and recruiting have started. |
| **S2** | RLS harness + auth | SCR-0204…0208, SCR-0210…0212 · SCR-0301…0304, SCR-0312 | 42 | Location canary green. Sign-in works on both platforms. |
| **S3** | Auth complete + 2FA | SCR-0305…0311 · SCR-0401…0403 | 40 | Account deletion passes the web-endpoint reviewer path. |
| **S4** | 2FA complete + identity | SCR-0404…0408 · SCR-0501…0507 · SCR-0601 | 42 | 2FA is recoverable without a support ticket. Gate sits at transacting, not earlier. |
| **S5** | Garden + taxonomy | SCR-0602…0610 · SCR-0701, SCR-0703 | 41 | Fuzzing invariant holds under adversarial test. |
| **S6** | Taxonomy + safe spots | SCR-0702, SCR-0704…0708 · SCR-0802…0806 | 42 | `safe_spots_near` meets NFR-11. Taxonomy works with zero network. |
| **S7** | Spot lifecycle + inventory | SCR-0807…0809 · SCR-0901…0909 | 41 | Inventory works fully offline, exactly-once on reconnect. |
| **S8** | Listings | SCR-0910 · SCR-1001…1010 · SCR-1501 | 42 | A listing can be published to a safe spot and found. |
| **S9** | Map | SCR-1101…1109 · SCR-1201 | 42 | Cold start → interactive map p95 < 2.5 s on the reference device. |
| **S10** | Exchange core | SCR-1202…1211 | 42 | Accept is provably single-winner under contention. Handoff completes end to end. |
| **S11** | Exchange hazards + messaging | SCR-0209 · SCR-1212…1219 · SCR-1301…1303 | 42 | All eight hazards have a provoking test. Vault rotation rehearsed on staging. |
| **S12** | Messaging + trust | SCR-1304…1308 · SCR-1401…1405 | 41 | Severity-1 report pages a human in under 15 minutes. Block teardown verified. |
| **S13** | Trust + moderation | SCR-1406…1409 · SCR-1502…1507 | 41 | Abuse controls tested adversarially. Queues have live SLA timers. |
| **S14** | Rota + notifications | SCR-1508…1509 · SCR-1601…1609 · SCR-1701 | 40 | Rota rehearsed with a named human. Inbox survives total push failure. |
| **S15** | Observability + review | SCR-1702…1708 · SCR-1801…1802, SCR-1806 | 42 | Liquidity tile live. Every NFR has a tile. External review findings triaged. |
| **S16** | Launch | SCR-1803…1805, SCR-1807…1808 | 21 | Go/no-go checklist green. |

*\* Ops-track items run in parallel and carry no engineering points.*

**Critical path:** `S0 spike → S1–S2 foundations → S3–S4 auth & identity → S5 garden → S7 inventory → S8 listings → S10–S11 exchange → S12–S13 trust → S14 moderation → S15–S16 launch.` Everything off that line — taxonomy, safe spots, notifications, observability — is scheduled into the slack around it, which is why those epics appear split across sprints rather than as contiguous blocks. That is the schedule working, not the schedule being untidy.

**Two things start in S1 and finish outside this table:** safe-spot curation (12 weeks) and community recruiting. Neither has engineering points and both gate launch.

**S16 carries 21 points against a 42-point capacity.** That half-sprint of slack is the entire buffer in a 33-week plan. It will be consumed. Treat any earlier sprint that runs over as spending it, and say so out loud when it happens.

---

## Risk register linkage

| Risk | Mitigated by | Residual |
| --- | --- | --- |
| [R-01](02-open-risks.md#r-01--liquidity-not-architecture-decides-whether-this-works) liquidity | EPIC-19, SCR-1704, SCR-1905 | **High.** Engineering cannot fix this. |
| [R-03](02-open-risks.md#r-03--physical-safety-is-irreducible-and-one-incident-is-existential) physical safety | EPIC-05, EPIC-08, EPIC-14, SCR-1508 | **Irreducible.** One incident is existential. |
| [R-04](02-open-risks.md#r-04--the-map-stack-is-unvalidated) map stack | EPIC-01 | Resolved or re-planned by end of S0 |
| [R-09](02-open-risks.md#r-09--users-may-route-around-safe-spots) routing around safe spots | Measurement at week 8 post-launch | Open. Product problem, not a code one. |
| [R-13](02-open-risks.md#r-13--seasonality-may-kill-retention) seasonality | EPIC-20, deferred | Open through the first off-season |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-09 | 0.1.0 | Product + Engineering | Initial backlog decomposed from the roadmap and spec register |
| 2026-10-22 | 0.1.1 | Product + Engineering | H3 removed; renamed to location tiers per [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md). SCR-0203 wording. |
