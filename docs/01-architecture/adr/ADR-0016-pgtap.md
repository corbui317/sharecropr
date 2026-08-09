# ADR-0016: pgTAP against a real Postgres for database and RLS testing

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

[ADR-0003](ADR-0003-database-centric-authz.md) makes the database the application tier. That means the majority of Sharecropr's business logic and **all** of its authorization live in Postgres — in RLS policies, `SECURITY DEFINER` functions, triggers, `CHECK` constraints, and partial unique indexes. Whatever we test, we have to be able to test *those*.

The thing that makes this urgent rather than merely important is the failure mode. [RLS Design](../05-rls-design.md) opens with it: "a missing or wrong policy is a data breach with no error, no crash, and no alert." A broken authorization rule does not throw. It returns rows. It looks exactly like a working feature to the developer who wrote it, to the reviewer reading the diff, and to any test written from the happy path. The only thing that catches it is a test that asserts a specific query *returns nothing* for a specific user.

Several behaviours we depend on exist only inside a real Postgres and have no meaningful representation anywhere else:

| Behaviour | Where it lives |
| --- | --- |
| RLS policy evaluation as a specific role with specific JWT claims | Postgres, per-session |
| `SECURITY DEFINER` semantics — running as owner, RLS *not* applying | Postgres |
| Row locking, lock ordering, deadlock detection under concurrency | Postgres, across sessions |
| Partial unique index enforcement (the no-double-reservation guarantee) | Postgres |
| Trigger ordering and the unskippable fuzzing derivation | Postgres |
| PostGIS distance maths and H3 cell boundaries | PostGIS + `h3-pg` |

None of these can be mocked in a way that proves anything. A mock of `auth.uid()` proves that the mock works.

## Decision

**Test the database with pgTAP, running in CI against a real Postgres instance built from the same migrations as production.**

| Element | Value |
| --- | --- |
| Framework | pgTAP, tests in `supabase/tests/` as `.sql`, run by `pg_prove` |
| Environment | Supabase CLI's Docker Postgres — same major version, PostGIS 3.4, `h3-pg`, `pg_cron` |
| Trigger | **Every migration PR.** Required check; no merge without green |
| Fixtures | Deterministic synthetic seed; every test runs in a transaction and rolls back |
| Role simulation | `SET LOCAL ROLE authenticated` plus `SET LOCAL request.jwt.claims` to impersonate a specific user |
| Concurrency | Multi-session tests via `pg_prove` with separate connections, covering hazards H1–H8 in [Exchange State Machine §5](../07-exchange-state-machine.md#5-concurrency-hazards) |
| Perf | `EXPLAIN` baselines in `supabase/perf/baselines/` diffed per migration; policy p95 budget **50 ms** at 10× launch volume ([RLS Design §8](../05-rls-design.md#8-performance)) |

### What must be proven, mechanically

Every table carries the twelve proof obligations in [RLS Design §9](../05-rls-design.md#9-proof-obligations). The ones that matter most are the negatives:

```sql
BEGIN;
SELECT plan(4);

SELECT app_test.as_user('11111111-1111-1111-1111-111111111111');
SELECT is( (SELECT count(*) FROM public.gardens WHERE owner_id = current_user_id())::int, 1,
           'owner sees their own garden' );

SELECT app_test.as_user('22222222-2222-2222-2222-222222222222');
SELECT is( (SELECT count(*) FROM public.gardens
             WHERE owner_id = '11111111-1111-1111-1111-111111111111')::int, 0,
           'NEGATIVE: another user sees nothing' );

SELECT throws_ok(
  $$ SELECT exact_point FROM private.garden_locations LIMIT 1 $$,
  '42501', NULL, 'NEGATIVE: authenticated cannot reach private schema' );

SELECT is( (SELECT count(*) FROM public.listings l
             JOIN public.blocks b ON b.blocked_id = l.owner_id
            WHERE b.blocker_id = current_user_id())::int, 0,
           'NEGATIVE: blocked user content is absent from the result set' );

SELECT * FROM finish();
ROLLBACK;
```

CI enforcement, so this does not rely on diligence:

- A migration creating a table without `ENABLE` **and** `FORCE ROW LEVEL SECURITY` fails the build.
- **A test file with fewer negative than positive assertions fails the build.** Negative tests are the ones skipped under deadline pressure, so they are counted.
- The location invariants LP-01 through LP-12 ([Location Privacy §11](../04-location-privacy.md#11-verification--how-we-prove-this-holds)) run on every migration, including the property tests over 10,000 generated gardens.
- A `SECURITY DEFINER` function reading `private` that is not on the reviewed allowlist fails a static check.

The production canary (LP-10) is the complement to all of this: pgTAP proves the system we intended to build, and a scheduled job proves the system we actually deployed, continuously, by authenticating as a synthetic user and asserting it *cannot* read another user's garden.

## Alternatives considered

### Mock the database; test authorization in application code

**What it is.** An in-memory fake or a stubbed Supabase client.

**Why we didn't.** There is no application code holding the authorization logic to test — that is the whole point of [ADR-0003](ADR-0003-database-centric-authz.md). A mock would assert that our mock enforces our understanding of a policy, which is a test of our understanding rather than of the policy. This is not a weaker version of the right test; it is a test of a different thing.

### Integration tests only, through the JS client

**What it is.** Sign in as test users via `supabase-js`, hit PostgREST, assert on responses.

**Why we didn't.** Not rejected — retained as a thin layer for API-contract shape. Insufficient as the primary mechanism because it is slow (network round trip per assertion), it cannot easily create the concurrent-session scenarios that H1–H8 require, it cannot assert on `EXPLAIN` plans, and a failure is ambiguous between a policy bug, a PostgREST configuration issue, and a client bug. Diagnosis cost matters when the thing being diagnosed is an authorization defect.

### `pgtap`-style assertions written in TypeScript with a Postgres client

**What it is.** Keep tests in the team's primary language, execute SQL from a JS runner.

**Why we didn't.** Genuinely appealing — better assertion output, better tooling, one language. Rejected because session state is the substance of these tests: `SET LOCAL ROLE`, `SET LOCAL request.jwt.claims`, transaction scope, advisory locks. Managing that from a connection pool in a JS runner is exactly where subtle bugs hide, and a test harness bug in an authorization suite is worse than no suite. pgTAP runs *inside* the session it is asserting about.

### Testcontainers with a hand-built Postgres image

**What it is.** Spin up Postgres per test suite from a custom image.

**Why we didn't.** The Supabase CLI already provides a Postgres with the exact extension set and version we run in production. Building our own image means maintaining parity by hand, and parity drift in a test database is a silent false-confidence generator.

## Consequences

### Positive

- **Authorization is tested where it is enforced**, in the same session semantics as production. There is no translation layer to be wrong.
- Concurrency hazards are testable deterministically, with real locks, which is the only honest way to test H1 (two users accepting the same listing) and H4 (simultaneous handoff confirmation).
- The negative-assertion count check turns "write negative tests" from a cultural norm into a build gate.
- PostGIS and H3 behaviour — including the cell-boundary recall trap — is exercised against the real implementations rather than an approximation.
- Property tests over 10,000 generated gardens (LP-04, LP-06, LP-07) are practical in SQL and would be painful anywhere else.
- Fast: tests run in-process against a local database, with no network and no HTTP.

### Negative

- **pgTAP's assertion output is poor.** A failed `is()` on a row count tells you the expected and actual values and essentially nothing about why, and there is no diff, no stack trace, and no debugger.
- SQL as a test language is verbose. A test that would be four lines in Jest is fifteen here.
- No familiar mocking, factories, or fixture-builder ergonomics. Fixtures are `INSERT` statements, and they get repetitive.
- Small ecosystem; the tooling has not changed much in a decade and the documentation assumes you already know Perl-adjacent TAP conventions.
- Tests are written in the same language as the thing under test, so a shared misunderstanding of SQL semantics can produce a test that agrees with a wrong implementation.

### Neutral / accepted costs

- Test fixtures must track schema changes; a migration altering an enum breaks fixtures, which is desirable feedback.
- `pg_prove` is a Perl tool, so CI needs it installed. One line in the workflow.
- Multi-session concurrency tests are slower and slightly more fragile than single-session ones. They are also the highest-value tests in the suite.

## The strongest argument against this decision

The self-referential problem is real and it is the one to worry about. pgTAP tests are SQL, asserting on SQL, executed by the same engine that runs the code under test — so a misunderstanding of Postgres semantics is very likely to appear identically in both the policy and the test that "proves" it. If an engineer believes a `PERMISSIVE` policy composes with `AND` when it actually composes with `OR`, they will write a policy reflecting that belief and a test reflecting the same belief, and the test will pass while the table is readable by people it should not be. An independent test written against the HTTP surface, in a different language, by someone reasoning about the *product* requirement rather than the *SQL* mechanism, would catch that. We have chosen the test that is closest to the implementation, which maximizes fidelity and minimizes independence, and independence is exactly what you want from a test of a security control.

The ergonomics compound this. Because writing a pgTAP test is genuinely tedious — fifteen lines and an `INSERT` block for what Jest would do in four — engineers under deadline write the minimum that satisfies the build gate. Our gate counts negative assertions, so the minimum becomes "one more negative than positive," which is a number, not coverage. A rule that can be satisfied mechanically will be satisfied mechanically, and a suite of shallow negative assertions clustered around the obvious cases will pass forever while the non-obvious case — a `JOIN` to an RLS-protected table where the inner policy filters unexpectedly, a view missing `security_invoker`, a definer function that forgot its authorization check — goes untested. Neither the tool nor the gate helps there; only a reviewer who is genuinely thinking does, and this ADR cannot mandate that.

We accept the coupling because the alternative cannot test the thing at all: there is no way to prove `SECURITY DEFINER` semantics or lock ordering from outside the database, and an untestable control is worse than a coupled test of it. The mitigations are the ones that supply independence from elsewhere: the **production canary (LP-10)**, which tests the deployed system continuously and was written from the requirement rather than the implementation; the thin API-contract integration layer; and the static CI checks (allowlist, forbidden columns, RLS flags) which reason about the migration text rather than about SQL semantics. Those three are the independence budget. Do not cut them to save CI minutes.

## Revisit when

- **Any RLS policy or definer function permits access in production that its pgTAP tests said it denied.** One occurrence reopens this ADR — it is direct evidence of the self-referential failure.
- Negative-assertion counts satisfy the gate while an audit finds a table with fewer than **3** meaningful negative cases — the gate needs strengthening, not the tool replacing.
- pgTAP suite runtime exceeds **8 minutes**, at which point it stops being run locally and becomes a CI-only formality.
- Policy p95 exceeds the **50 ms** budget and `EXPLAIN` baseline diffing is no longer sufficient to catch plan regressions.
- The architecture shifts toward the hybrid described in [ADR-0003](ADR-0003-database-centric-authz.md), moving authorization decisions into a service tier — at which point some of this coverage moves with it, and **RLS tests stay regardless**.
- LP-10 fires in production. That is an incident, and it is also a test-suite gap by definition.

## Related

- [ADR-0003 Database-centric authz](ADR-0003-database-centric-authz.md), [ADR-0004 Supabase](ADR-0004-supabase.md), [ADR-0005 Geospatial model](ADR-0005-geospatial-model.md), [ADR-0015 E2E tooling](ADR-0015-e2e-tooling.md)
- [RLS Design §8, §9, §10](../05-rls-design.md), [Location Privacy §11](../04-location-privacy.md#11-verification--how-we-prove-this-holds), [Exchange State Machine §5](../07-exchange-state-machine.md#5-concurrency-hazards), [Data Model §15](../03-data-model.md#15-migration-rules)
