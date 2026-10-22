# ADR-0004: Supabase as the backend platform

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security |
| **Supersedes** | — |
| **Superseded by** | — |

> **Note (2026-10-22):** `h3-pg` is not available on Supabase and was removed; see [ADR-0023](ADR-0023-postgis-location-tiers.md).

## Context

[ADR-0003](ADR-0003-database-centric-authz.md) commits us to Postgres as the application tier: RLS is the authorization layer, definer RPCs are the business logic, PostgREST is the transport. That decision constrains this one heavily — we need a platform where **Postgres is the product**, not a persistence option behind an opinionated SDK.

Around that core we still need: authentication with OAuth and TOTP MFA, object storage for garden and crop photos, a realtime channel that respects row-level security, a serverless runtime for webhooks and cron, and PostGIS with a working H3 extension. Building each of these is between a week and a month of work we would rather spend on the exchange flow.

The team is two to four engineers with no dedicated infrastructure owner. Nobody is going to be on call for a Kubernetes cluster, and nobody is going to configure `pgbouncer`, WAL archiving, and PITR by hand. Whatever we choose has to have a managed control plane and a local development story that matches production closely enough that migrations tested locally are trustworthy.

Two things we do not know and should say out loud: whether Supabase's Realtime layer holds up under our subscription patterns at 50k users, and whether the company's pricing or product direction stays aligned with ours over five years. Both are vendor risks we are choosing to take with eyes open.

## Decision

**Use managed Supabase — Postgres 15 with PostGIS 3.4, `h3-pg`, and `pg_cron`; GoTrue for auth; PostgREST for the API; Realtime; Storage; Deno Edge Functions — as the entire backend.**

| Component | Used for | Notes |
| --- | --- | --- |
| Postgres 15 | Everything that is state or logic | Four-schema split: `public`, `private`, `app`, `audit` ([System Architecture §3.1](../01-system-architecture.md#31-schema-separation)) |
| PostgREST | The client API | Exposes `public` only. `private` is **not** in `db-schemas` |
| GoTrue | Email+password, Apple, Google, TOTP MFA | [ADR-0006](ADR-0006-auth-providers.md), [ADR-0014](ADR-0014-totp-not-sms.md) |
| Realtime | Exchange and message channels | RLS-aware; a socket cannot deliver an unreadable row |
| Storage | Garden and crop photos | S3-compatible; EXIF stripped by an Edge Function on upload |
| Edge Functions | Webhooks, push fanout, image pipeline, cron | Bounded by [ADR-0008](ADR-0008-edge-functions.md) |
| Supabase CLI | Local dev in Docker, migration authoring, type generation | Same Postgres major version as production |

Deliberate hedges taken **now**, not later:

- **`@supabase/supabase-js` is imported in exactly one file** — `src/api/supabase.ts`. Every other module uses our own typed repository functions. Swapping transport is a one-file change plus type reconciliation.
- **Migrations are plain, forward-only SQL** under `supabase/migrations/`, applied by the CLI. Nothing depends on a Supabase-proprietary migration format.
- **Auth is used through standard OIDC/JWT semantics.** We do not depend on GoTrue-specific behaviours beyond session refresh.
- **PITR enabled on production** from day one; a documented RTO/RPO in [Runbooks](../../05-operations/05-runbooks.md).
- **Preview environments are ephemeral branch projects per PR**, seeded synthetically. There is no path from production data to any other environment.

The full exit analysis lives in [System Architecture §8](../01-system-architecture.md#8-the-escape-hatch) and is summarized under "strongest argument against" below.

## Alternatives considered

### Custom NestJS + managed Postgres (RDS / Neon / Cloud SQL)

**What it is.** Our own TypeScript API service, our own auth (or Auth0/Clerk), our own file storage on S3, our own WebSocket layer, on a managed Postgres of our choosing.

**Why we didn't.** Maximum control at maximum cost. Realistically 6–10 weeks of setup before the first feature ships: auth flows, OAuth callbacks, TOTP enrollment and recovery, refresh-token rotation, S3 presigned uploads, a WebSocket server with its own authorization model, a job runner, CI, deployment, and an on-call rotation for all of it. Every one of those is a component we would build once, badly, and then own forever. And the authorization model would be *worse*, because a hand-rolled WebSocket layer does not enforce RLS the way Supabase Realtime does — we would have to reimplement read authorization a second time, for sockets, which is exactly the duplicated-security-model failure [ADR-0003](ADR-0003-database-centric-authz.md) rejects.

### Firebase

**What it is.** Google's BaaS: Firestore, Firebase Auth, Cloud Functions, Cloud Storage, excellent mobile SDKs and offline support.

**Why we didn't.** Two disqualifiers. First, **no relational database and no PostGIS**. Our data model is deeply relational (profiles → gardens → inventory → listings → requests → sessions → ratings) and our core query is a geospatial aggregate with a block filter applied inside it. In Firestore that becomes client-side joins, denormalization with fan-out writes, and a geohash library doing approximate proximity — every one of which multiplies the surface where a location could leak. Second, **Firestore security rules cannot express our authorization model**. They cannot do a `SECURITY DEFINER`-style computation over data the caller may not read, which is precisely what `safe_spots_near` does: it reads `private` garden geography to compute counts, and returns a type with no column for a coordinate. Firebase would also be a far stickier lock-in — Firestore data has no portable equivalent.

### Appwrite / Nhost / PocketBase

**What it is.** Other open-source BaaS platforms, some Postgres-backed.

**Why we didn't.** Smaller ecosystems, weaker PostGIS/extension stories, and — for the self-hosted ones — an operational burden that defeats the purpose. Nhost is the closest architecturally but pairs Postgres with Hasura/GraphQL, adding a permission layer we do not want on top of the one we do.

### Self-hosted Supabase

**What it is.** Same components, our infrastructure.

**Why we didn't.** We would take on the operations without gaining portability we do not already have — the components are open source either way, so the exit path is identical. Self-hosting is the *response* to a Supabase pricing or reliability failure, not a hedge against one. Keeping the option is enough.

## Consequences

### Positive

- Auth, storage, realtime, functions, and cron exist on day one. Weeks of undifferentiated work avoided.
- **Realtime is RLS-aware**, so the subscription layer inherits the authorization model for free. This is the single feature that most justifies the choice.
- PostGIS, `h3-pg`, and `pg_cron` are all available on a managed instance without a support ticket.
- Local development is a Docker Compose stack from the CLI at the same Postgres major version, so pgTAP tests and `EXPLAIN` baselines transfer.
- Branch-per-PR preview projects make ephemeral environments cheap ([System Architecture §6](../01-system-architecture.md#6-deployment-topology)).
- `supabase gen types typescript` produces the client's types from the schema, so a schema change breaks the build rather than the app.

### Negative

- **Total outage of Supabase is total outage of Sharecropr.** There is no meaningful degradation path beyond a cached-inventory offline banner. Accepted, documented, mitigated only by PITR and runbooks.
- **A single Postgres instance is a single point of failure** for MVP. No read replica, no multi-region.
- Vendor risk on pricing, product direction, and acquisition.
- Edge Functions have a real cold-start and a Deno runtime with narrower library availability than Node.
- Supabase's Postgres major-version upgrade cadence is theirs, not ours.
- Realtime at scale is the least-proven component for our access patterns and the hardest to test before we have load.

### Neutral / accepted costs

- Cost scales with database size and egress; the image pipeline is the main lever and is why we thumbnail server-side.
- Some platform behaviour is configuration in a dashboard rather than code. Everything security-relevant that *can* be expressed in a migration **is**, so the dashboard is not the source of truth for anything that matters.
- We track Supabase's changelog deliberately; managed-platform changes arrive whether or not we planned for them.

## The strongest argument against this decision

We have made a venture-funded startup a load-bearing dependency of a product whose core promise is that it will keep people's home addresses safe. That is not primarily a technical risk, it is a business-continuity one. Supabase can change pricing, deprecate a component, get acquired, or simply decide that our usage pattern is not the one they optimize for — and every one of those events lands on a two-person team with no infrastructure owner. The "Postgres is portable" comfort is real but partial, and the partial part is the expensive part. The schema, policies, and functions move unchanged. **Auth does not.** Migrating off GoTrue means exporting bcrypt hashes (portable, but requiring every user to keep working through a login flow we have rebuilt), re-linking every Apple and Google identity — where Apple's private relay email addresses are scoped to the *client ID*, so a naive migration silently orphans the account of every user who chose "Hide My Email" — and re-enrolling TOTP factors, which cannot be migrated at all if the secret store format differs. Realtime means either self-hosting their server or rewriting the subscription layer. Storage is S3-compatible in shape but the RLS-integrated access policies are not. The honest estimate for a full exit is not "two weeks for auth" as [System Architecture §8](../01-system-architecture.md#8-the-escape-hatch) optimistically states — it is one to two engineer-months with a user-visible disruption to sign-in, executed by a team that will be doing it under duress rather than on a plan.

There is a subtler cost too. Because Supabase makes the database-centric architecture easy, it encourages us to lean harder into it than we otherwise would, which deepens the coupling in both directions. Every RLS-aware Realtime channel and every Storage policy expressed in SQL is a thing that looks portable and is not quite. The alternative — a boring NestJS service on RDS — would have cost two months up front and bought a system where every component is individually replaceable. We chose speed. That is defensible for an MVP and it is a debt, and the mitigation (one file imports `supabase-js`) addresses only the smallest and least sticky part of the coupling.

## Revisit when

- Monthly Supabase spend exceeds **$2,000/month**, or exceeds **12%** of total infrastructure-plus-vendor spend, without a proportional user increase.
- Supabase-attributable downtime exceeds **0.2% of a rolling 30-day window** (≈86 minutes), or any single incident exceeds our documented **4-hour RTO**.
- Realtime message delivery p95 exceeds **2 s**, or connection-drop rate exceeds **1%** of subscriptions per hour, at any scale.
- A platform-level change (pricing model, component deprecation, acquisition) materially alters the terms. Treat an acquisition announcement as an automatic trigger to re-cost the exit, not as an emergency.
- We need multi-region, a read replica the platform will not provision, or a Postgres extension Supabase will not install.
- We exceed **150k users** on a single instance, at which point the scaling order in [System Architecture §7](../01-system-architecture.md#7-scaling-posture) starts and the platform's ceiling becomes a real number rather than a hypothetical.

Standing mitigation: **re-cost the exit annually** and keep the estimate in [Open Risks](../../06-roadmap/02-open-risks.md). An escape hatch nobody has priced recently is a comfort, not a plan.

## Related

- [ADR-0003 Database-centric authz](ADR-0003-database-centric-authz.md), [ADR-0005 Geospatial model](ADR-0005-geospatial-model.md), [ADR-0006 Auth providers](ADR-0006-auth-providers.md), [ADR-0008 Edge Functions](ADR-0008-edge-functions.md)
- [System Architecture §3, §6, §7, §8](../01-system-architecture.md), [Data Model §3](../03-data-model.md#3-schemas), [RLS Design §2](../05-rls-design.md#2-roles)
