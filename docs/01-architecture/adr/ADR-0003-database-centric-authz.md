# ADR-0003: Authorization and business logic live in Postgres

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr stores the home coordinates of every user and introduces them to strangers. The consequence of an authorization bug here is not a leaked shopping cart; it is a named, photographed person's address in the hands of someone who went looking for it. The threat model ([Location Privacy §1](../04-location-privacy.md#1-the-threat-we-are-defending-against)) names stalkers and burglars as realistic attackers, not hypothetical ones.

The standard architecture — mobile client → REST API service → ORM → Postgres — places authorization in the service tier. Every endpoint must remember to check. This works, and it fails in a specific, extremely common way: someone adds an endpoint, or a query parameter, or an `include` on an ORM relation, and forgets one check. The failure is silent. It returns 200. It does not appear in tests written by the person who forgot. Essentially every large data breach of this shape is one missing check in one handler.

We have two to four engineers, no dedicated security engineer, and a client that will be at least three versions behind the server at any moment. The question is not "what is the most flexible architecture" but "what architecture makes the catastrophic failure structurally difficult rather than merely discouraged."

The trade we are considering: put authorization *in the data*, so that there is no code path — existing, new, or forgotten — that can return a row the caller isn't entitled to, because the database itself will not produce it. The cost is business logic in PL/pgSQL, a language most of the team doesn't know, with worse tooling than any application language.

## Decision

**Postgres is the application tier. There is no service layer between the client and the database.**

| Concern | Home | Mechanism |
| --- | --- | --- |
| Read authorization | Postgres | RLS policy on every table in `public`; `ENABLE` **and** `FORCE` ([RLS Design §1](../05-rls-design.md#1-non-negotiable-rules)) |
| Write authorization | Postgres | RLS `WITH CHECK`, or no policy at all where writes go through an RPC |
| State transitions | Postgres | `SECURITY DEFINER` RPC with explicit lock ordering ([Exchange State Machine §4](../07-exchange-state-machine.md)) |
| Invariants | Postgres | `CHECK`, partial unique indexes, `FOREIGN KEY`, transition-guard triggers |
| Derived-value safety | Postgres | Triggers that cannot be skipped (`app.derive_display_point`) |
| Transport | PostgREST | Auto-generated REST over `public` only; `private` is not in the exposed schema list |
| Everything else | Edge Functions | Only webhooks, fanout, image processing, cron ([ADR-0008](ADR-0008-edge-functions.md)) |

Specific commitments:

- **Every table in `public` has RLS enabled and forced.** A migration creating a table without both fails CI.
- **Every policy has a passing negative test.** A policy proven to allow but not proven to deny is untested ([ADR-0016](ADR-0016-pgtap.md)).
- **State transitions never go through policy.** Policies express *who may touch a row*, not *which transitions are legal under what locks*. Transitions are definer RPCs, and the affected tables have **no client-facing UPDATE policy at all** ([RLS Design §7](../05-rls-design.md#7-why-state-transitions-bypass-policy)).
- **Every `SECURITY DEFINER` function re-checks authorization as its first statement** and pins `search_path`. Definer functions are not subject to RLS; this is the sharpest edge in the system.
- **The strongest guarantee is structural, not procedural:** functions that read `private` return types with **no column that could hold a user coordinate**. A catastrophic bug in the body cannot leak what the signature cannot carry ([Location Privacy §6](../04-location-privacy.md#6-the-proximity-query-without-leaking)).

## Alternatives considered

### Service tier (NestJS / Fastify) enforcing authorization in code

**What it is.** A TypeScript API service owns all database access with a `service_role` connection; guards and policies live in decorators and middleware; RLS is off or advisory.

**Why we didn't.** It relocates the security model into the place where it is easiest to forget. Every new endpoint is a new opportunity to omit a check, and the omission returns data rather than an error. It also means the database connection is fully privileged, so a single SQL-injection or SSRF finding in the service is total compromise, where under RLS the same finding yields only what that user's JWT permits. We would gain testability and better tooling; we would gain them by trading away the property the product most needs.

### Hybrid — RLS on, plus a service tier for business logic

**What it is.** RLS as defense-in-depth, business logic in TypeScript, the service connecting as `authenticated` with a forwarded JWT.

**Why we didn't.** Genuinely the most defensible alternative, and the one we would pick with a larger team. Rejected for MVP because it is *two* authorization models to keep synchronized, and drift between them is confusing rather than safe: developers stop trusting either layer, RLS policies get written loosely "because the service checks anyway," and the defense-in-depth degrades into a single layer that nobody is sure about. It is also a whole additional deployment surface for a two-person team. **This is the architecture we migrate to, incrementally, when the triggers below fire.**

### ORM-level scoping (Prisma / Drizzle with a tenant filter)

**What it is.** Query builder middleware injects `WHERE user_id = ?` on every query.

**Why we didn't.** Bypassable by any raw query, any `$queryRaw`, any migration script, any new developer who imports the client directly. It is a convention enforced by a library, not a boundary enforced by the engine.

## Consequences

### Positive

- **There is no controller to forget a check in**, because there are no controllers.
- The security boundary is enforced by the engine, applies uniformly to PostgREST, Realtime, and any future client, and cannot be bypassed by a new query path.
- Realtime subscriptions are RLS-aware for free — a WebSocket cannot deliver a row the user cannot select.
- Multi-row state transitions are transactional and lock-ordered by construction; no distributed transaction problem exists.
- Dramatically less code. No DTOs, no mappers, no service layer, no second serialization boundary. A two-person team ships features instead of plumbing.
- Postgres is portable: schema, policies, and functions are standard SQL and move to any managed Postgres ([System Architecture §8](../01-system-architecture.md#8-the-escape-hatch)).

### Negative

- **`accept_exchange_request` — the most safety-critical function in the system — is written in PL/pgSQL**, a language most of the team is not fluent in, reviewed by people who are learning it.
- **RLS failures are silent.** A missing policy returns rows; it does not throw. There is no stack trace to grep for.
- Debugging is worse in every dimension: no step debugger worth the name, stack traces that point at line numbers in a function body, `RAISE NOTICE` as the primary instrument.
- Refactoring is manual. There is no rename-symbol across a PL/pgSQL codebase, no type checker that catches a changed function signature at compile time.
- Business logic changes require a migration and a deploy, not a code push.
- Hiring is harder. "Strong PL/pgSQL" is not a common line on a mobile-adjacent CV.

### Neutral / accepted costs

- Test infrastructure is unusual: pgTAP against a real Postgres in CI ([ADR-0016](ADR-0016-pgtap.md)), plus a production canary (LP-10) that continuously proves user A cannot read user B's garden.
- `CODEOWNERS` requires a second DB-tagged reviewer on `supabase/migrations/**`.
- Policy performance is a first-class concern: `(SELECT auth.uid())` wrapping, indexed predicate columns, committed `EXPLAIN` baselines ([RLS Design §8](../05-rls-design.md#8-performance)).

## The strongest argument against this decision

PL/pgSQL is a bad language for business logic and pretending otherwise is how this decision hurts. It has no module system, no package manager, no meaningful static analysis, no debugger anyone enjoys, and no way to unit-test a function in isolation without a database. Its error handling is exception-based with numeric SQLSTATE codes rather than typed results. There is no way to express a discriminated union, so the exchange state machine — which is a discriminated union — is expressed as an enum plus a wall of `IF` statements and a guard trigger that reimplements the transition table a second time, in a second place, that can drift from the first. Code review is worse: a reviewer reading a 140-line `SECURITY DEFINER` function has to hold the entire RLS model in their head *and* remember that RLS does not apply inside it, because the function runs as owner. That is the exact cognitive load that produces mistakes, and we have put the most dangerous function in the system behind it.

The deeper problem is asymmetry of escape. If the service-tier architecture turns out wrong, you add RLS underneath it in a week. If *this* architecture turns out wrong — if PL/pgSQL becomes unmaintainable, or the team turns over, or a feature genuinely needs a language with libraries — the migration is not incremental. Extracting the exchange engine means reimplementing `accept_exchange_request` in TypeScript, moving the lock ordering into application code where it is much harder to get right, keeping both implementations alive during the cutover, and proving that the new one is equivalent to the old one under concurrency. That is a multi-month project owned by whoever is unlucky, and it is tracked as R-06 in the risk register precisely because we know it is expensive. We have optimized for the failure mode we most fear (silent authorization bug) by accepting a failure mode that is slower but harder to escape (an unmaintainable core in a language nobody wants to work in).

The honest summary: this is the right decision for a two-person team shipping a privacy-critical MVP, and it will be the wrong decision for a fifteen-person team shipping features quarterly. Plan to pay the migration, and start paying it at the triggers below rather than at the crisis.

## Revisit when

- **Any RLS policy or definer function permits access it should have denied in production.** One occurrence is enough to reopen this ADR, regardless of other metrics.
- Median PR cycle time for changes touching `supabase/migrations/**` exceeds **3 days**, or migration PRs are more than **2×** the cycle time of client-only PRs, sustained over a quarter.
- Any single PL/pgSQL function exceeds **200 lines**, or the total under `supabase/migrations/**` exceeds **5,000 lines** of function bodies.
- Fewer than **two engineers** on the team can competently review a `SECURITY DEFINER` function.
- The p95 on a hot RLS-filtered path exceeds its **50 ms** budget and the fix requires denormalization we would not otherwise want.
- We need business logic requiring a library ecosystem Postgres does not have (ML inference, complex third-party clients, rich text processing). Note that Phase 3's ML crop ID is exactly this — it belongs in an Edge Function or a service, not in the database.

At that point the migration path is the **hybrid**: stand up a TypeScript service that connects as `authenticated` with the user's forwarded JWT, move one bounded context (moderation first, per [ADR-0018](ADR-0018-observability.md)), and **leave RLS on underneath**. Do not turn RLS off to make the service easier. That is the mistake that undoes everything this ADR bought.

## Related

- [ADR-0004 Supabase](ADR-0004-supabase.md), [ADR-0008 Edge Functions](ADR-0008-edge-functions.md), [ADR-0016 pgTAP](ADR-0016-pgtap.md), [ADR-0018 Observability](ADR-0018-observability.md)
- [System Architecture §1, §3.2, §8, §10](../01-system-architecture.md), [RLS Design](../05-rls-design.md), [Location Privacy](../04-location-privacy.md), [Exchange State Machine](../07-exchange-state-machine.md)
