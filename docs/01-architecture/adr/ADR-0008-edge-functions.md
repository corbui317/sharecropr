# ADR-0008: Edge Functions only for webhooks, fanout, images, and cron

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

[ADR-0003](ADR-0003-database-centric-authz.md) puts authorization and business logic in Postgres. Supabase also ships Deno Edge Functions, and their existence creates a standing temptation: the moment a PL/pgSQL function becomes awkward, someone will propose "just do this bit in an Edge Function, in TypeScript, where we can actually test it."

That proposal is reasonable in isolation and corrosive in aggregate. Edge Functions run with the `service_role` key — they **bypass RLS entirely**. Every piece of logic that migrates from Postgres to an Edge Function is a piece of logic that must now re-implement authorization by hand, in a second language, reviewed by people who are used to the database enforcing it. Do that four or five times and we have an application tier with a fully privileged database connection, which is precisely the architecture ADR-0003 rejected — arrived at accidentally, one pragmatic exception at a time, with no ADR ever written.

But some work genuinely cannot live in Postgres. Verifying an HMAC signature on a Persona webhook requires a vendor secret that must not be in the database or the client. Sending outbound HTTP with retries and backoff is a terrible fit for a transaction. Decoding and resizing a JPEG in PL/pgSQL is not a serious proposal. And there is scheduled work that has to call something outside the database.

So the question is not *whether* to use Edge Functions but how to draw a boundary that a reviewer can apply mechanically, without judgement, at 5pm on a Friday.

## Decision

**Edge Functions are permitted for exactly four categories. Everything else stays in Postgres. Adding a fifth category requires a new ADR.**

| # | Category | Functions | Why it cannot be in Postgres |
| --- | --- | --- | --- |
| 1 | **Third-party webhooks** | `kyc-start`, `kyc-webhook` | Vendor secrets and HMAC verification must not live in the DB or the client |
| 2 | **Push fanout** | `drain-notification-outbox` | Outbound HTTP with retries and backoff; wrong job for a transaction |
| 3 | **Image processing** | `process-media-asset` (EXIF strip, thumbnail, moderation hash) | Binary decode/encode |
| 4 | **Scheduled work that calls out** | cron-invoked jobs that must reach an external service | `pg_cron` can schedule SQL, not HTTP |

Explicitly **not** permitted, no matter how convenient:

- Any state transition. `accept_exchange_request` and every sibling stay in Postgres ([Exchange State Machine §4](../07-exchange-state-machine.md)).
- Any authorization decision. RLS and definer predicates own that ([RLS Design](../05-rls-design.md)).
- Any read the client could make directly through PostgREST.
- Any derived-value computation that a trigger can do — especially anything touching location ([Location Privacy §4.3](../04-location-privacy.md#43-the-trigger-that-makes-it-unskippable)).
- "Just this one aggregation because the SQL is ugly."

Pure-data scheduled work stays in `pg_cron` + SQL with no function involved: expiring stale listings and requests, trust-score recomputation, retention deletions.

### Rules for the functions that do exist

| Rule | Requirement |
| --- | --- |
| Authorization | Every function re-checks authorization **explicitly, first**. `service_role` means RLS is off; there is no safety net |
| Secrets | Supabase function secrets only. Never in the repo, never in an EAS profile, never reachable by the app |
| Idempotency | Every webhook stores a `webhook_idempotency_key` and rejects replays ([Data Model §5](../03-data-model.md#5-identity--profiles)) |
| Signature verification | Constant-time HMAC compare plus a replay window, before any parsing of the body |
| Writes | Narrowest possible: a webhook writes `verifications.status` and nothing else |
| Data returned to the client | Minimum. `kyc-start` returns a session token, never vendor payloads |
| Observability | Structured logs through the telemetry scrubber; no coordinates, no PII ([ADR-0018](ADR-0018-observability.md)) |
| Location | A function returning a `geography` or a lat/lng for a user is a build failure |

The outbox pattern is the load-bearing piece for category 2: `private.notification_outbox` rows are written **inside the same transaction** as the state change, and a cron-driven function drains them with exponential backoff. A push is therefore never lost because an HTTP call failed mid-transaction, and never sent for a transaction that rolled back.

## Alternatives considered

### No Edge Functions at all — `pg_net` / `http` extension from Postgres

**What it is.** Make outbound HTTP calls directly from PL/pgSQL.

**Why we didn't.** It puts vendor secrets in the database, makes transaction duration depend on a third party's latency, and gives no sane retry or backoff story. `pg_net` is asynchronous and better than the synchronous `http` extension, but it is still a queue with worse ergonomics than the outbox we already need. And none of it solves image processing.

### Edge Functions as the primary API, PostgREST for reads only

**What it is.** All mutations go through TypeScript functions; Postgres becomes storage plus RLS on reads.

**Why we didn't.** This is the service-tier architecture with extra steps and worse properties — a fully-privileged connection, authorization re-implemented per function, and multi-row transactions coordinated from outside the database. Rejected in [ADR-0003](ADR-0003-database-centric-authz.md); listed here because it is the shape we will drift into if the boundary is not defended.

### A separate long-running service (Cloud Run / Fly) for the four categories

**What it is.** Same work, a real container instead of a Deno isolate.

**Why we didn't.** A second deployment target, a second CI path, a second on-call surface, for four small functions. Worth reconsidering if image processing outgrows the Edge runtime's memory and time limits, which is the most likely of the triggers below.

### Supabase Storage image transformations instead of `process-media-asset`

**What it is.** Platform-native on-the-fly resizing.

**Why we didn't.** It does not strip EXIF on ingest, and EXIF stripping is a **privacy invariant**, not an optimization — `media_assets.exif_stripped_at IS NULL` makes an asset unreadable through every RLS policy, so an unprocessed image can never be served. We need a processing step that runs before the asset becomes visible. Transformations may still be used for delivery variants on top of the stripped original.

## Consequences

### Positive

- The boundary is four named categories, so "should this be an Edge Function?" is a lookup, not a debate.
- Authorization stays in one place for everything the client can reach.
- Vendor secrets exist in exactly one environment (function secrets) and are unreachable from the app and the database.
- The outbox makes push delivery durable and transaction-consistent — a genuinely hard problem solved once.
- EXIF stripping is structurally unskippable because visibility depends on it.

### Negative

- **The four permitted functions run as `service_role` and bypass RLS.** They are the least-protected code in the system and need the most careful review.
- Cold starts add latency to `kyc-start`, which sits in the onboarding funnel.
- Deno's library ecosystem is narrower than Node's; image processing in particular has fewer mature options.
- Every function is a second place where an environment variable can be wrong, and a misconfigured secret fails at runtime rather than at deploy.
- The boundary will feel arbitrary the first time someone has a genuinely awkward piece of PL/pgSQL. That friction is the point, and it is still friction.

### Neutral / accepted costs

- Two languages, two test harnesses: pgTAP for the database ([ADR-0016](ADR-0016-pgtap.md)), Deno's test runner for functions.
- Function deploys are separate from migrations, so an ordering discipline is required when the two must change together — migration first, always.
- Cron schedules live in `pg_cron` and are configuration in the database, which means they are in migrations and therefore reviewable.

## The strongest argument against this decision

The boundary is drawn by *mechanism* — "does it need outbound HTTP or binary processing?" — when the thing we actually care about is *authorization*. That mismatch produces a rule that is easy to apply and occasionally wrong in both directions. It forces genuinely complex, genuinely testable business logic to stay in PL/pgSQL purely because it does not happen to need an HTTP call, even when the logic would be safer with unit tests, a type system, and a debugger. The trust-score recomputation is the clearest example: it is arithmetic over a few tables, it has real edge cases, and it will end up as a hundred lines of SQL that nobody can test in isolation, when the same logic in TypeScript with a table-driven test suite would be obviously correct in an afternoon. Meanwhile the rule *permits* the four categories to do arbitrary work with `service_role`, so the actual privilege concentration is unbounded within them — `kyc-webhook` could, under this policy, grow business logic indefinitely as long as it started life as a webhook handler. A boundary drawn on privilege ("nothing that runs as `service_role` may make a decision the user could influence") would be harder to check but would actually target the risk.

There is also a slow-burn version of the failure. Four functions is a small surface today. But each one is a small piece of TypeScript that works well, is pleasant to modify, and has tests — so pressure accumulates to put the next thing there, and the arguments will always be locally correct. In three years this is either still four functions because someone defended the line, or it is fourteen functions and an accidental service tier that nobody ever wrote an ADR for. The rule's real value is not its precision; it is that it makes the fourteen-function outcome require a document.

## Revisit when

- The count of deployed Edge Functions exceeds **6**, or any function exceeds **300 lines**. Either is evidence the boundary is leaking.
- A fifth category is proposed. That is a new ADR, not a PR discussion.
- `process-media-asset` exceeds the Edge runtime's memory or execution limits, or its p95 exceeds **8 s** — the trigger to move image processing to a container.
- `kyc-start` cold-start p95 exceeds **1.5 s** and measurably affects onboarding completion.
- Outbox drain lag p95 exceeds **60 s**, meaning fanout is no longer keeping up with the 30-second cron.
- Any Edge Function is found to have made an authorization decision that RLS would have made differently. That is a security incident and reopens this ADR.

## Related

- [ADR-0003 Database-centric authz](ADR-0003-database-centric-authz.md), [ADR-0004 Supabase](ADR-0004-supabase.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md), [ADR-0018 Observability](ADR-0018-observability.md)
- [System Architecture §3.2, §5.3](../01-system-architecture.md), [Data Model §12](../03-data-model.md#12-notifications-devices-audit), [Location Privacy §8](../04-location-privacy.md#8-egress-controls--where-leaks-actually-happen)
