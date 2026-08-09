# ADR-0018: Sentry + PostHog + Supabase logs, behind a mandatory scrubber

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security, Product |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

We need to know three different things, and they have different consumers and different retention profiles: **is the app broken** (crashes, errors, performance), **is the product working** (funnels, retention, feature adoption), and **is the backend healthy** (query performance, RLS behaviour, Edge Function failures).

Observability in this product carries a constraint most products do not have. Telemetry is the classic path by which a privacy invariant that is airtight in the database leaks anyway. [Location Privacy §8](../04-location-privacy.md#8-egress-controls--where-leaks-actually-happen) is explicit: "The database is the well-defended part. Real-world location leaks come from the boring edges." A Sentry breadcrumb capturing a map region, a PostHog event carrying a `listing_viewed` property with a coordinate, a Postgres statement log containing an RPC parameter — every one of these is a coordinate leaving our infrastructure to a third party, and none of them is caught by any RLS policy, because the data was legitimately readable by the user whose session produced it.

There is also a specific scaling question this ADR is asked to answer. [System Architecture §7](../01-system-architecture.md#7-scaling-posture) lists "extract moderation into its own service" as step 4 of the scaling order, with the trigger stated as >200 reports/day and attributed here. That number needs to be measured by something, and this is the ADR that says what and how.

## Decision

**Three tools, three questions, one mandatory scrubber in front of every egress path.**

| Tool | Answers | Retention |
| --- | --- | --- |
| **Sentry** | Crashes, unhandled errors, performance traces, release health | 90 days |
| **PostHog** | Funnels, retention, feature adoption, product decisions | 12 months, aggregated after |
| **Supabase logs + `pg_stat_statements`** | Query performance, RLS behaviour, Edge Function failures, auth events | Platform default; critical events mirrored to `audit.events` |

### The scrubber — non-negotiable

Nothing reaches a third party except through it.

```ts
// src/observability/scrub.ts — applied to Sentry beforeSend AND every PostHog capture.
const FORBIDDEN_KEY = /lat|lng|latitude|longitude|coord|point|geohash|h3_r[89]/i;
const EMAIL        = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const JWT          = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[depth]';
  if (typeof value === 'string') {
    return value.replace(EMAIL, '[email]').replace(JWT, '[jwt]');
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        FORBIDDEN_KEY.test(k) ? [k, '[redacted]'] : [k, scrub(v, depth + 1)]),
    );
  }
  return value;
}
```

| Rule | Enforcement |
| --- | --- |
| Forbidden keys stripped at **any depth** | The recursion above; tested by firing a synthetic event with a nested coordinate (LP-08) |
| Spatial properties capped at **H3 r5** (~250 km²) | PostHog wrapper rejects finer; r7 and r9 never leave the device ([ADR-0005](ADR-0005-geospatial-model.md)) |
| PII in Sentry | `sendDefaultPii: false`. User context is a `user_id` only — never email, name, or avatar |
| Screenshots and session replay | **Disabled.** A screenshot of the map is a coordinate |
| RPC parameters in Postgres logs | Statement logging configured to omit parameters for `safe_spots_near` ([Location Privacy §6.1](../04-location-privacy.md#61-the-clients-own-position)) |
| Raw Postgres exception text | Mapped to error codes before reaching the client or any log |
| New event with a spatial or PII-adjacent property | **Requires a scrubber test in the same PR** ([Definition of Done](../../00-foundation/06-doc-conventions.md#11-definition-of-done)) |

The scrubber is a **denylist**, which is the weaker construction, and we know it. See below.

### Event taxonomy

Events are declared in one typed registry (`src/observability/events.ts`); ad-hoc `capture()` calls fail lint. Naming is `object_verb_past_tense`: `listing_published`, `exchange_request_accepted`, `handoff_confirmed`, `report_filed`.

### Alerting

| Alert | Threshold | Route |
| --- | --- | --- |
| Crash-free sessions | < 99.5% | On-call |
| `accept_exchange_request` error rate | > 1% over 15 min | On-call, page |
| `safe_spots_near` p95 | > 400 ms over 15 min | On-call ([System Architecture §7](../01-system-architecture.md#7-scaling-posture)) |
| RLS policy p95 on any hot table | > 50 ms | Engineering channel ([RLS Design §8](../05-rls-design.md#8-performance)) |
| Outbox drain lag p95 | > 60 s | Engineering channel ([ADR-0008](ADR-0008-edge-functions.md)) |
| LP-10 canary failure | Any | **Page immediately.** This is a breach signal, not a bug signal |
| Break-glass role activation | Any | Whole security channel ([Location Privacy §10](../04-location-privacy.md#10-break-glass-access-to-exact-coordinates)) |
| Verification spend | > 70% of monthly budget | Product + Finance ([ADR-0010](ADR-0010-kyc-vendor.md)) |
| **Reports filed** | **> 200/day, 7-day rolling** | **Extracts moderation — see below** |

### The 200 reports/day trigger

`reports_filed_daily` is a first-class metric with a dashboard and an owner, because it is the trigger for the largest planned architectural change in the scaling order.

At **>200 reports/day sustained over a 7-day rolling window**, moderation extracts into its own service. The reasoning is not load — 200 rows/day is nothing for Postgres. It is that at that volume moderation is a staffed function with its own workflow: queues, SLAs, assignment, escalation, appeals, and moderator-specific views. Those requirements pull hard against a schema optimized for the gardener-facing product, and moderation queries running against the OLTP instance are already named as the first thing to degrade `safe_spots_near` p95. Extracting it earlier is premature; extracting it later means doing it during an incident.

Leading indicators tracked alongside, so the trigger is not a surprise: reports per 1,000 completed exchanges, median time-to-triage, and open-report backlog.

## Alternatives considered

### One tool for everything (Sentry-only, or PostHog-only)

**What it is.** Consolidate to reduce vendors and cost.

**Why we didn't.** Sentry's product analytics are thin; PostHog's error tracking is much weaker than Sentry's symbolication, release health, and native crash handling. More importantly, consolidating means **one scrubber protecting one pipe** — which sounds better and is actually worse, because product events and crash events have different shapes and a single scrubber tuned for one will be loose for the other.

### Firebase Crashlytics + Google Analytics

**What it is.** Free, ubiquitous, excellent native crash reporting.

**Why we didn't.** Weaker `beforeSend`-equivalent hooks, which is disqualifying — the scrubber must be under our control and testable. GA4's event model is poorly suited to funnel analysis on a mobile product, and adding Google as a data processor is a privacy-disclosure cost for a product whose positioning is privacy discipline.

### Self-hosted PostHog

**What it is.** Same product, our infrastructure, no third-party product data.

**Why we didn't.** Strongest privacy posture available and genuinely tempting given this product's stance. Rejected because it is an infrastructure project — ClickHouse, retention, upgrades — for a team with no infrastructure owner. Revisit if event volume makes cloud pricing painful, since that lands the two arguments in the same place.

### Log everything to Postgres; build our own dashboards

**What it is.** No third parties at all.

**Why we didn't.** Puts analytics load on the OLTP instance that serves the map, which is exactly the first scaling problem in [System Architecture §7](../01-system-architecture.md#7-scaling-posture), and it means building crash symbolication, which is not a thing to build.

### No product analytics at all

**What it is.** Crash reporting only; make product decisions from support and interviews.

**Why we didn't.** Every major open question in this document set — [ADR-0002](ADR-0002-barter-only.md)'s liquidity bet, [ADR-0009](ADR-0009-safe-spots-only.md)'s friction cost, [ADR-0010](ADR-0010-kyc-vendor.md)'s KYC drop-off, [ADR-0014](ADR-0014-totp-not-sms.md)'s enrollment drop-off — has a revisit trigger stated as a number. Without instrumentation those triggers are decorative and every one of those ADRs becomes unfalsifiable.

## Consequences

### Positive

- Each tool is good at its question; nothing is stretched into a role it fits poorly.
- The scrubber is one tested function in front of every egress path, so the invariant is enforced in one reviewable place rather than at every call site.
- Numeric revisit triggers across the whole ADR set become measurable, which is what makes them commitments rather than gestures.
- The 200/day moderation trigger is instrumented before it fires, so the extraction is planned work rather than incident response.
- LP-10 canary paging turns the location invariant into a continuously verified property of the deployed system, not just of the intended one.
- Screenshots and session replay disabled by default removes the highest-bandwidth accidental-leak channel entirely.

### Negative

- **The scrubber is a denylist**, and denylists fail open. A property named `where`, `spot`, `origin`, or `pos` sails straight through the regex.
- Three vendors, three data-processing agreements, three privacy-label disclosures, three sets of retention settings to keep aligned.
- Disabling PII, screenshots, and replay makes debugging genuinely harder — a user reporting "the map was wrong" arrives with a `user_id` and very little else.
- Sentry and PostHog costs scale with event volume, and PostHog in particular grows quickly once funnels are instrumented properly.
- Version skew from OTA ([ADR-0017](ADR-0017-release-cadence.md)) means Sentry must report both binary and bundle version, or crash attribution is misleading.

### Neutral / accepted costs

- The typed event registry is friction on adding an event. Deliberate — that friction is where the scrubber test gets written.
- Supabase log retention is the platform's; anything we need to keep goes to `audit.events`.
- The scrubber runs on every event, adding microseconds. Irrelevant.

## The strongest argument against this decision

The scrubber is a regex denylist standing between our users' home addresses and three third-party vendors, and denylists fail in exactly the direction that hurts. `FORBIDDEN_KEY` catches `lat`, `lng`, `coord`, `point`, `h3_r9`. It does not catch `origin`, `where`, `spot_pos`, `region`, `bounds`, `centre`, `pin`, `place`, `map_state`, `viewport`, or a serialized object stringified into a message body before the scrubber ever sees it as a key — and it certainly does not catch a coordinate embedded in free text, because it only inspects keys and only rewrites emails and JWTs in strings. Every one of those is a plausible property name that an engineer under deadline would write without a second thought, and the failure is **completely silent**: the event is accepted, the dashboard looks fine, and the coordinate sits in a vendor's warehouse until someone happens to look. The Definition of Done says a new event with a spatial-adjacent property requires a scrubber test — but the whole problem is that the engineer who names a property `viewport` does not think of it as spatial-adjacent, so the rule that would catch it depends on the recognition that failed in the first place.

An allowlist would close this: a registry where every event declares its permitted properties by name and type, and the emitter drops anything undeclared. It is more work to maintain, it is annoying when you want a quick debug property, and it is *correct* — the failure mode becomes "my event is missing a field," which is loud, obvious, and fixed in a minute. We chose the denylist because it is compatible with the ad-hoc breadcrumbs Sentry adds automatically (navigation, network, console), which an allowlist cannot enumerate. That reasoning is sound for Sentry's automatic instrumentation and much weaker for PostHog, where every event is one we wrote deliberately, and where the typed registry already exists — meaning we are three hours of work away from an allowlist on the pipe that carries the most structured data, and we have not done it.

The second-order concern: telemetry is the leak path that will not be caught by any other control in this system. RLS does not apply. The `private` schema does not apply. The forbidden-column CI check does not apply. LP-08 tests the scrubber against a synthetic event we wrote, which tests the keys we already thought of. There is no independent verification here comparable to the LP-10 canary, and that asymmetry — the best-defended data with the least-defended egress path — is the real weakness in this ADR.

## Revisit when

- **Any coordinate, email, or token is found in a third-party telemetry store.** One occurrence is a privacy incident and reopens this ADR immediately, with an allowlist as the default remedy.
- PostHog events accumulate more than **50 distinct event names** or more than **200 distinct property names** — beyond that, denylist review is not humanly tractable and the allowlist becomes mandatory.
- Combined Sentry + PostHog spend exceeds **$400/month**, which makes self-hosted PostHog a live option again.
- **Reports exceed 200/day on a 7-day rolling average** — extract moderation, per [System Architecture §7](../01-system-architecture.md#7-scaling-posture).
- Median time-to-triage on reports exceeds **24 hours**, which is the leading indicator that the 200/day trigger is about to fire.
- Debugging a production issue is blocked by missing context more than **3 times in a quarter** — reconsider *what* we collect, never *whether* we scrub.
- We enter a jurisdiction requiring data residency for telemetry.

## Related

- [ADR-0003 Database-centric authz](ADR-0003-database-centric-authz.md), [ADR-0005 Geospatial model](ADR-0005-geospatial-model.md), [ADR-0008 Edge Functions](ADR-0008-edge-functions.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md), [ADR-0017 Release cadence](ADR-0017-release-cadence.md)
- [Location Privacy §8, §10, §11](../04-location-privacy.md), [System Architecture §7, §9](../01-system-architecture.md), [RLS Design §8](../05-rls-design.md#8-performance), [Data Model §12](../03-data-model.md#12-notifications-devices-audit)
