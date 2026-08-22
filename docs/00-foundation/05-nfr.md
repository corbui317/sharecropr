# Non-Functional Requirements

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Engineering

Budgets, not aspirations. Every number here is measured somewhere and enforced somewhere. A target with no measurement is deleted from this document.

Requirement IDs are `NFR-##` and are referenced from specs and tests.

---

## 1. Performance

### 1.1 Mobile

| ID | Metric | Budget | Measured on | Verified by |
| --- | --- | --- | --- | --- |
| NFR-01 | Cold start → interactive map | **p95 < 2.5 s** | 3-year-old mid-range device | Maestro timing, nightly |
| NFR-02 | Warm start → interactive | p95 < 900 ms | Same | Maestro |
| NFR-03 | Map pan/zoom at 200 clustered markers | **60 fps sustained** | Same, both platforms | Profiler, manual per release |
| NFR-04 | Screen transition | p95 < 300 ms | Same | Maestro |
| NFR-05 | Inventory list scroll (200 items) | 60 fps | Same | Manual |
| NFR-06 | Image thumbnail render | p95 < 200 ms from cache | Same | Instrumented |
| NFR-07 | JS bundle size | < 6 MB | — | CI, blocking |
| NFR-08 | Install size | < 80 MB iOS, < 60 MB Android | — | CI, reported |
| NFR-09 | Memory, steady state on map | < 250 MB | Reference device | Profiler |
| NFR-10 | Battery, 10 min active map use | < 4% | Reference device | Manual per release |

**The reference device is a three-year-old mid-range phone, not a current flagship.** It is the device the budget is written against and the one most likely to be skipped in QA. Skipping it is how a product becomes unusable for the half of users who don't upgrade annually.

NFR-01 and NFR-03 are unchanged by the move to MapLibre ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)), but the shape of the work behind them is different and the budget should be read accordingly. Markers are GPU layers driven by one GeoJSON source, not 200 native marker views crossing the bridge — 200 markers is one source update. The 200-marker cap survives as a privacy and payload bound rather than as a rendering bound, and the new frame-budget risk is style complexity (label collision, sprite count) rather than marker count. NFR-01 now also depends on the tile path: the map must be pannable and tappable before the first tile paints, so a slow edge costs context, never interactivity.

### 1.2 Backend

| ID | Metric | Budget | Conditions | Verified by |
| --- | --- | --- | --- | --- |
| NFR-11 | `safe_spots_near`, 8 km | **p95 < 400 ms** | 500k listings, 200 concurrent | k6 nightly |
| NFR-12 | `safe_spots_near`, 40 km max | p95 < 900 ms | Same | k6 |
| NFR-13 | Any RLS-filtered table query | **p95 < 50 ms** | 10× launch volume | pgTAP timing, blocking |
| NFR-14 | `accept_exchange_request` | p99 < 300 ms | Under contention | Concurrency harness |
| NFR-15 | Message insert | p95 < 100 ms | — | Integration |
| NFR-16 | Auth token refresh | p95 < 250 ms | — | Instrumented |
| NFR-17 | Image processing (EXIF strip + thumbnail + blurhash) | p95 < 3 s | 12 MP input | Integration |
| NFR-18 | Notification outbox → Expo | p95 < 60 s | — | Instrumented |
| NFR-19 | Realtime message delivery | p95 < 2 s | — | E2E |

`EXPLAIN (ANALYZE, BUFFERS)` baselines for the six hottest queries are committed and diffed on every migration, so a plan regression appears in code review rather than in production.

---

## 2. Availability and reliability

| ID | Metric | Target | Window |
| --- | --- | --- | --- |
| NFR-20 | API availability | **99.9%** | 30 days (43 min budget) |
| NFR-21 | Crash-free sessions | **≥ 99.5%** | 7 days |
| NFR-22 | Crash-free users | ≥ 99.8% | 7 days |
| NFR-23 | Push delivery to Expo | ≥ 99% | 7 days |
| NFR-24 | Notification inbox delivery | **100%** | Always — the inbox is the durable record |
| NFR-25 | Severity-1 report first response | **< 15 min** | Per incident, **zero error budget** |
| NFR-26 | Location canary pass rate | **100%** | Continuous, **zero error budget** |

NFR-25 and NFR-26 have no error budget by design. A missed safety escalation and a location leak are not failures you amortise across a quarter.

### Recovery

| ID | Objective | Target |
| --- | --- | --- |
| NFR-27 | RPO | 5 minutes (WAL) |
| NFR-28 | RTO — JS rollback | 15 minutes |
| NFR-29 | RTO — point-in-time restore | 2 hours |
| NFR-30 | Restore rehearsal | Quarterly against staging |

Regional failover is **not available at MVP**. Accepted, documented, revisit at scale.

---

## 3. Offline behaviour

| ID | Data class | Requirement |
| --- | --- | --- |
| NFR-31 | Crop taxonomy | **MUST** be fully available offline. Bundled, updated server-side. |
| NFR-32 | Own inventory | **MUST** be readable and writable offline; writes queue |
| NFR-33 | Map | **MUST** show last-known state with an explicit staleness banner — never an empty screen or a permanent spinner |
| NFR-34 | Exchanges | **MUST** be readable offline; actions disabled with a clear reason |
| NFR-35 | Messages | **MUST** be readable from cache; sends queue with an unmistakable pending indicator |
| NFR-36 | Queued mutations | **MUST** deliver exactly once on reconnect; **MUST NOT** duplicate |
| NFR-37 | Queue failure | **MUST** surface a persistent failure state after 5 attempts; **MUST NOT** silently drop |

**No screen shows an infinite spinner.** Every loading state has a timeout that resolves to content, a cached view, or an actionable error.

---

## 4. Scalability

| ID | Dimension | MVP target | Design headroom |
| --- | --- | --- | --- |
| NFR-38 | Registered users | 20,000 | 500,000 on one Postgres instance |
| NFR-39 | Concurrent users | 500 | 5,000 |
| NFR-40 | Active listings | 20,000 | 1,000,000 |
| NFR-41 | Safe spots | 100 | 50,000 |
| NFR-42 | Messages/day | 5,000 | 500,000 |
| NFR-43 | Exchanges/day | 200 | 20,000 |

The scaling order is in [System Architecture §7](../01-architecture/01-system-architecture.md#7-scaling-posture). We are deliberately not building microservices, a GraphQL gateway, or multi-region for a two-metro launch.

---

## 5. Security

| ID | Requirement |
| --- | --- |
| NFR-44 | All traffic over TLS 1.2+; certificate pinning for the Supabase and Persona hosts |
| NFR-45 | **No exact garden coordinate in any response, log, telemetry event, or export** — verified continuously by LP-01 … LP-13 |
| NFR-46 | Every `public` table has RLS enabled **and** forced |
| NFR-47 | Every RLS policy has both positive and negative tests; negatives outnumber positives per table |
| NFR-48 | Refresh tokens in hardware-backed secure storage only |
| NFR-49 | Access token lifetime ≤ 60 min; refresh tokens rotate and are single-use |
| NFR-50 | Passwords ≥ 12 characters, breach-checked, bcrypt-hashed |
| NFR-51 | TOTP only — **no SMS second factor** |
| NFR-52 | All EXIF stripped server-side before an asset is readable |
| NFR-53 | Every moderator action and every P1 data access written to an immutable audit trail |
| NFR-54 | Dependencies scanned weekly; high and critical CVEs patched within 7 days |
| NFR-55 | External security review before public launch, findings closed |

---

## 6. Privacy

| ID | Requirement |
| --- | --- |
| NFR-56 | Data minimisation — no field collected without a documented purpose in the [data inventory](../02-security/04-privacy-and-data-retention.md) |
| NFR-57 | Retention enforced automatically by scheduled jobs, not by manual cleanup |
| NFR-58 | Account deletion: functional removal immediately, hard deletion at 30 days |
| NFR-59 | DSAR export within 30 days, in a form a human can actually read |
| NFR-60 | Telemetry scrubbing enforced by tested code, not by convention |
| NFR-61 | Analytics spatial resolution capped at H3 r5 |
| NFR-62 | No third party receives PII beyond what the [sub-processor register](../02-security/04-privacy-and-data-retention.md#7-sub-processors) documents |

---

## 7. Accessibility

Target: **WCAG 2.2 AA equivalent for mobile.** "Follows WCAG" is not a commitment, so these are specific.

| ID | Requirement |
| --- | --- |
| NFR-63 | Every interactive element has a meaningful accessibility label — not the icon name |
| NFR-64 | Full dynamic type support to the largest accessibility size, with reflow rather than truncation |
| NFR-65 | Minimum 44×44 pt touch targets |
| NFR-66 | Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components; status indicators meet AAA |
| NFR-67 | **No information conveyed by colour alone** |
| NFR-68 | Screen-reader operable end to end: signup, garden registration, inventory, listing, request, thread, rating |
| NFR-69 | **The map has an equivalent list view, tested as a first-class path** — a map is not usable with a screen reader |
| NFR-70 | Focus order is logical; focus is trapped in modals and returned on dismiss |
| NFR-71 | Reduced-motion honoured; no animation is required to understand state |
| NFR-72 | Live regions announce changes politely and never steal focus from a text input |

NFR-69 is the one that gets treated as optional and shouldn't be. See [Ray's journey](03-personas-and-journeys.md#9-journey--ray-accessibility).

---

## 8. Internationalization

| ID | Requirement |
| --- | --- |
| NFR-73 | All user-facing strings externalized from day one; **no hardcoded copy**, even in MVP |
| NFR-74 | Dates, times, and numbers formatted per device locale |
| NFR-75 | Timestamps stored UTC, rendered in the device timezone |
| NFR-76 | Layouts tolerate 40% string expansion without breaking |
| NFR-77 | Units respect locale preference (pounds vs kilograms) while storing canonically |
| NFR-78 | RTL not supported in MVP, but layouts use logical properties so it is not a rewrite later |

MVP ships `en-US` only. Externalizing strings costs nothing now and is expensive to retrofit.

---

## 9. Maintainability

| ID | Requirement |
| --- | --- |
| NFR-79 | TypeScript `strict: true`; **no `any` in `src/domain`** |
| NFR-80 | `src/domain` imports no React Native — enforced by lint, for testability and future web reuse |
| NFR-81 | `@supabase/supabase-js` imported in exactly one file |
| NFR-82 | Every `MUST` requirement has a linked passing test — enforced in CI |
| NFR-83 | Migrations forward-only; no `DOWN` scripts |
| NFR-84 | Every `SECURITY DEFINER` function pins `search_path` and appears on the reviewed allowlist |
| NFR-85 | Feature flags older than 90 days are removed or promoted |
| NFR-86 | Full CI suite completes in < 20 minutes — a slow pipeline gets bypassed |

---

## 10. Compliance

| ID | Requirement |
| --- | --- |
| NFR-87 | Apple 4.8 — Sign in with Apple alongside other social logins |
| NFR-88 | Apple 1.2 — in-app reporting, blocking, filtering, and a **real** 24-hour moderation process |
| NFR-89 | Apple 5.1.1(v) — in-app account deletion |
| NFR-90 | Google Play — public web deletion URL, live and functional |
| NFR-91 | Google Play — target API level meets the current deadline |
| NFR-92 | **No background location permission** in the merged manifest, checked in CI |
| NFR-93 | Data-safety declarations match the data inventory, verified each release |
| NFR-94 | GDPR applied globally; CCPA/CPRA honoured; under-13 prohibited |

---

## 11. Cost

| ID | Metric | Budget | Alert |
| --- | --- | --- | --- |
| NFR-95 | Infrastructure per MAU | < $0.15 | > 130% of forecast |
| NFR-96 | KYC per verified user | < $2.00 | > 130% forecast, or > 150% of 7-day baseline daily |
| NFR-97 | Storage per user | < 25 MB | > 130% |
| NFR-98 | Push cost per user/month | < $0.01 | > 130% |

NFR-96 is the one an attacker can drive up directly, which makes its alarm a security control as much as a finance one ([R-07](../06-roadmap/02-open-risks.md)).

Tile serving does not appear here as a per-map-load line because there isn't one. [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md) makes the basemap a storage-and-egress cost — estimated under $10/month at MVP scale, folded into NFR-95 — rather than a vendor's pricing decision. The number to watch is the trend, and its revisit trigger is $50/month.

---

## 12. Basemap and tiles

We own the basemap now ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)). These four requirements are the price of that, and the first is a licence obligation rather than a quality target.

| ID | Requirement | Budget / threshold | Verified by |
| --- | --- | --- | --- |
| NFR-99 | **"© OpenStreetMap contributors" is rendered on the map and on every surface showing OSM-derived safe-spot data, in every UI state, unobscured** | Present, legible, ≥ 4.5:1 contrast, non-zero measured area. Always — not on tile-load success, not behind a tap-to-reveal | CI, blocking. E2E over every map state and sheet detent ([SPEC-008-T69/T70](../03-specs/SPEC-008-interactive-map.md), [SPEC-007-R58](../03-specs/SPEC-007-safe-spots.md)) |
| NFR-100 | Tile serving latency at the CDN edge in a launch market | **p95 < 300 ms** | Synthetic edge measurement, continuous ([SPEC-008-R72](../03-specs/SPEC-008-interactive-map.md)) |
| NFR-101 | `basemap_age_days` — days since the served PMTiles archive was built | **≤ 45** | Monitored metric with an alert ([Observability §5.2](../05-operations/04-observability.md)) |
| NFR-102 | **No map, tile, sprite, glyph, style, or geocoding request leaves Sharecropr-controlled infrastructure** | Zero requests to a non-allowlisted host | CI wire-level capture, blocking ([SPEC-008-T78/T79](../03-specs/SPEC-008-interactive-map.md)) |

NFR-99 is the only requirement in this document that a well-meaning redesign can breach without anything appearing broken, which is why its verification is a geometric assertion in CI and not a review checklist item. Its threshold is one occurrence.

NFR-101 exists because "we own the basemap" is only safe if someone notices when it rots. A stale archive is not a user-visible failure — the map looks fine, it is just wrong about a building that opened last month — so the metric is the only detector.

NFR-102 is the wire-level restatement of the privacy consistency argument in ADR-0019. It is asserted from captured traffic rather than from an import audit, because a transitive dependency phoning home is exactly the case an import audit misses.

---

## 13. Verification summary

| Category | Where enforced |
| --- | --- |
| Mobile performance | Maestro timing, profiler, CI bundle checks |
| Backend performance | k6 nightly, pgTAP timing (blocking), `EXPLAIN` baselines |
| Availability | Grafana SLOs, error budgets |
| Offline | E2E flow E-08, manual QA |
| Security | Location invariant suite, RLS suite, static checks, external review |
| Privacy | Scrubber tests, retention job monitoring, privacy review checklist |
| Accessibility | Automated per PR, manual per release |
| Compliance | Release checklist, CI manifest checks |
| Cost | Billing alerts |
| **Attribution (NFR-99)** | CI geometric assertion over every map state and sheet detent; client-side `map.attribution_missing` detector in production |
| **Tile serving (NFR-100, NFR-101)** | Synthetic edge probes per launch market; `basemap_age_days` gauge with a 45-day alert; monthly tile-build job result |
| **Map egress (NFR-102)** | Wire-level request capture in CI against a host allowlist, blocking |

**A requirement in this document with no verification row is a requirement we are pretending to have.** Adding one requires naming how it will be measured.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering | Initial NFRs |
| 2026-08-09 | 1.1.0 | Engineering | §12 added for the OpenStreetMap basemap ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)): NFR-99 ODbL attribution, NFR-100 tile p95, NFR-101 `basemap_age_days`, NFR-102 no map request leaves our infrastructure. Verification summary extended. §1.1 annotated for GPU-layer marker rendering; the old Verification summary is now §13 |
