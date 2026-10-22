# Test Strategy

**Status:** Approved · **Version:** 1.1.0 · **Owner:** Engineering

---

## 1. What we are actually testing for

Most test strategies optimise for "does the feature work." Sharecropr's two worst failure modes are silent:

1. **An RLS policy that returns data it shouldn't.** No crash, no error, no alert. Just a location in a response.
2. **A concurrency bug in the exchange engine.** Two people accept the same listing, and one of them drives to a library for nothing.

Neither is caught by testing the happy path. So the strategy is weighted heavily toward **negative testing** and **concurrency testing**, and the coverage gate that matters is not line coverage — it is whether every `MUST` requirement has a test that proves the system *refuses*.

> **The rule:** a policy proven to allow but not proven to deny is untested. CI counts negative assertions per table and fails the build when there are fewer negatives than positives.

---

## 2. The pyramid, weighted for this system

```
                    ╱╲
                   ╱E2E╲          Maestro · ~25 flows · critical paths only
                  ╱──────╲
                 ╱  RLS   ╱╲      pgTAP · ~400 assertions · THE HEAVY LAYER
                ╱────────╱  ╲
               ╱ Integration ╲    RPCs, Edge Functions, concurrency · ~200
              ╱───────────────╲
             ╱      Unit       ╲  Domain logic, pure TS · ~600
            ╱───────────────────╲
```

The RLS layer is deliberately fatter than the usual shape. In a [database-centric architecture](../01-architecture/adr/ADR-0003-database-centric-authz.md) the policies *are* the authorization code, so they get tested like authorization code — exhaustively, with a bias toward proving refusal.

| Layer | Tool | Runs | Budget |
| --- | --- | --- | --- |
| Unit + component | Jest (`jest-expo`) + React Native Testing Library | Every PR | < 30 s |
| RLS / DB | pgTAP against real Postgres | Every PR | < 4 min |
| Integration | Jest + Supabase CLI | Every PR | < 6 min |
| Concurrency | Custom harness | Every PR | < 2 min |
| E2E | Maestro, iOS + Android | Every PR (smoke), nightly (full) | < 12 min smoke |
| Performance | k6 + `EXPLAIN` baselines | Nightly + on migration | — |
| Accessibility | Automated axe-equivalent + manual | Every PR + per release | — |

**One JavaScript test runner: Jest.** Unit and component tests use Jest with the `jest-expo` preset and React Native Testing Library (SCRUM-64). `npm test` runs them, and `app.yml` runs `npm test` on every push and PR. `jest.config.js` has two projects: `domain` runs `src/domain` in the plain Node environment with no React Native preset, so a domain test that needs a mock is a design smell (§3); `app` runs everything else under `jest-expo`. Tests live in `__tests__/` beside the code and every test name carries its namespaced ID (`SPEC-001-T05`). RNTL's `render` and `fireEvent` are async — always `await` them; lint enforces it in `__tests__/`.

Not Jest, deliberately: E2E is Maestro ([ADR-0015](../01-architecture/adr/ADR-0015-e2e-tooling.md)), the database is pgTAP ([ADR-0016](../01-architecture/adr/ADR-0016-pgtap.md)), Edge Functions use Deno's runner ([ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md)), and the repo's own Node tooling under `scripts/` (doc gates, dependency audit) uses `node:test` because it is not app code and runs before `npm ci`.

---

## 3. Unit tests

Scope: everything in `src/domain` — the state machine mirror, validation, formatting, unit conversion, taxonomy search ranking, distance and H3 helpers.

`src/domain` has an eslint rule forbidding React Native imports, which is what makes it testable in plain Node with no simulator — the Jest `domain` project runs it with no React Native preset, so an RN import there fails the test run as well as lint. That constraint exists for testability first and web-client reuse second.

**Property-based tests** where the input space is large enough to be interesting:

```ts
// SPEC-006-T14 — unit conversion round-trips
fc.assert(fc.property(
  fc.float({ min: 0.01, max: 10_000 }), fc.constantFrom(...UNITS), fc.constantFrom(...UNITS),
  (qty, from, to) => {
    if (!compatible(from, to)) return true;
    expect(convert(convert(qty, from, to), to, from)).toBeCloseTo(qty, 6);
  },
));
```

The client's copy of the exchange state machine is generated from `private.legal_session_transitions` at build time, so drift between client and server is a **compile error**, not a runtime bug. The generator itself is tested.

---

## 4. Database and RLS tests

The heavy layer. Full detail in the [RLS Test Plan](02-rls-test-plan.md); the strategy points:

- **Real Postgres, not a mock.** Supabase CLI spins up the actual stack with the actual extensions. A mocked policy engine tests nothing.
- **Every table gets the twelve-point proof obligation** from [RLS Design §9](../01-architecture/05-rls-design.md).
- **Test fixtures create real authenticated sessions**, not `SET LOCAL role`. Setting the role skips the JWT claim handling that half the policies depend on.
- **Generated tests where the truth is data.** The 36 session-transition assertions are generated from `private.legal_session_transitions`, so adding a state adds its tests automatically.

```sql
-- The shape every table's test file follows
SELECT plan(12);
SELECT ok(  (SELECT rowsecurity FROM pg_tables WHERE tablename='listings'), 'RLS enabled');
SELECT ok(  (SELECT relforcerowsecurity FROM pg_class WHERE relname='listings'), 'RLS forced');

SELECT tests.authenticate_as('owner');
SELECT is( (SELECT count(*) FROM listings WHERE id = tests.fixture('listing_a')), 1::bigint,
           'owner sees own listing');

SELECT tests.authenticate_as('stranger');
SELECT is( (SELECT count(*) FROM listings WHERE id = tests.fixture('draft_listing')), 0::bigint,
           'NEGATIVE: stranger cannot see a draft listing');

SELECT tests.authenticate_as('blocked_user');
SELECT is( (SELECT count(*) FROM listings WHERE owner_id = tests.fixture('owner')), 0::bigint,
           'NEGATIVE: blocked user sees nothing from the blocker');

SELECT tests.authenticate_as('anon');
SELECT throws_ok($$ INSERT INTO listings (owner_id) VALUES (gen_random_uuid()) $$, '42501',
                 'NEGATIVE: anon cannot insert');
SELECT * FROM finish();
```

---

## 5. Integration tests

Cover the seams: RPC behaviour under real transactions, Edge Function contracts, webhook signature and replay handling, storage triggers, and cron jobs.

**Time is injected, never slept.** Expiry, no-show detection, and rating reveal are tested by moving a clock function, not by waiting.

**Webhooks are tested adversarially** — valid signature, invalid signature, replayed nonce, out-of-window timestamp, duplicate idempotency key, and a payload containing fields we've contractually said we won't accept.

### 5.1 The concurrency harness

The most important non-obvious test infrastructure in the project.

```ts
// SPEC-010-T30 — exactly one acceptor wins
const results = await Promise.allSettled(
  Array.from({ length: 50 }, (_, i) =>
    clientFor(requesters[i]).rpc('accept_exchange_request', {
      p_request_id: requests[i].id, p_idempotency_key: crypto.randomUUID(),
    })),
);

expect(results.filter(ok)).toHaveLength(1);
expect(results.filter(failedWith('listing_unavailable'))).toHaveLength(49);
expect(await countRows('exchange_sessions', { listing_id })).toBe(1);
expect(await countRows('exchange_requests', { listing_id, status: 'accepted' })).toBe(1);
```

It must run on every PR, so it must be fast — the whole suite of H1–H8 hazards completes in under two minutes. A concurrency suite that takes ten minutes gets skipped, and a skipped concurrency suite is worse than none because it creates false confidence.

---

## 6. Reviewing `SECURITY DEFINER` functions

Definer functions bypass RLS entirely. Every one is reviewed against this checklist before merge, and the checklist is in the PR template:

- [ ] `SET search_path` is pinned
- [ ] Authorization is re-checked **as the first action**, before any data is touched
- [ ] The return type has no column that could carry a coordinate (unless it is `get_my_garden_location`)
- [ ] Lock order matches the documented global order: `listings → exchange_requests → exchange_sessions`
- [ ] `EXECUTE` is granted to the narrowest role, and `REVOKE`d from `PUBLIC`
- [ ] Errors raise stable codes, never raw messages that could leak row data
- [ ] Idempotency is handled if the function mutates
- [ ] It appears on the reviewed definer allowlist
- [ ] A second reviewer with the `DB` CODEOWNERS tag has approved

---

## 7. Location invariant suite

The tests that enforce [the five rules](../README.md). These run on every PR **and** on a schedule against production.

| ID | Assertion | Type |
| --- | --- | --- |
| LP-01 | No client role has any privilege on schema `private` | pgTAP |
| LP-02 | Every definer function reading `private` is on the allowlist | CI static |
| LP-03 | No client-reachable return type carries a `private`-sourced geography | CI static |
| LP-04 | Fuzz offset is within 400–1200 m across 10,000 gardens | pgTAP property |
| LP-05 | 1,000 reads of one garden return byte-identical points | pgTAP |
| LP-06 | Mean of 1,000 reads is > 400 m from truth | pgTAP |
| LP-07 | Bearing distribution is uniform (χ², 36 bins, p > 0.01) | pgTAP |
| LP-08 | Scrubber strips coordinates from a synthetic Sentry event | Jest |
| LP-09 | EXIF absent from a stored real geotagged JPEG | Integration |
| LP-10 | **Production canary: synthetic user A cannot read user B's garden** | Cron |
| LP-11 | Notification payload and audit metadata reject coordinate keys | pgTAP |
| LP-12 | Cell-boundary recall: a point 10 m inside an edge returns adjacent-cell spots | pgTAP |
| LP-13 | API response sweep: no endpoint returns a coordinate-shaped value except `safe_spots.*` and `get_my_garden_location` | Integration |

**LP-10 is the one that matters most.** Everything else verifies the system we intended to build. LP-10 verifies the system we actually deployed, continuously.

---

## 8. E2E

Maestro over Detox ([ADR-0015](../01-architecture/adr/ADR-0015-e2e-tooling.md)). Flows in [E2E Scenarios](04-e2e-scenarios.md).

E2E is **expensive and flaky by nature**, so it is deliberately thin: it covers user journeys that cross screens and would break silently, and nothing else. A rule that would be enforced at the database is tested at the database, not through the UI.

- Smoke suite (8 flows) on every PR, both platforms.
- Full suite (~25 flows) nightly and before every release.
- A flaky test is quarantined within 24 hours and either fixed or deleted within a week. A tolerated flaky suite is a suite nobody reads.

---

## 9. Performance

| Target | Budget | Verified by |
| --- | --- | --- |
| `safe_spots_near` p95 | < 400 ms | k6 at 10× launch volume |
| Any RLS-filtered query p95 | < 50 ms | pgTAP timing + `EXPLAIN` baselines |
| Cold start to interactive map p95 | < 2.5 s | Maestro timing on a 3-year-old device |
| Map at 200 clustered markers | 60 fps pan/zoom | Manual + profiler, both platforms |
| `accept_exchange_request` p99 | < 300 ms under contention | Concurrency harness |

`EXPLAIN (ANALYZE, BUFFERS)` output for the six hottest queries is committed to `supabase/perf/baselines/` and diffed on every migration, so a plan regression appears in the pull request rather than in production.

---

## 10. Accessibility

Automated checks catch missing labels and contrast. They do not catch an unusable flow, so both are required:

- **Automated, every PR:** labels present, contrast ratios, minimum touch targets.
- **Manual, every release:** VoiceOver and TalkBack passes over signup, garden registration, map, listing, request, thread, and rating.
- **The map's list alternative is tested as a first-class path**, not as a fallback. A map is not usable with a screen reader, and a list view that nobody tests is a list view that doesn't work.
- Largest dynamic type size on every screen, checking for truncation and unreachable buttons.

---

## 11. What we deliberately don't test

- **Supabase's own correctness.** We test our policies, not whether Postgres enforces them.
- **Third-party SDK internals.** We test our integration contract with Persona and Expo Push, and mock them in CI.
- **Visual regression.** High maintenance cost, low defect yield for an app of this size. Revisit if UI regressions become a real source of bugs.
- **Line coverage as a gate.** We gate on requirement coverage instead: every `MUST` has a test. Line coverage is reported for information and is not a merge condition — it is trivially gameable and rewards testing the easy code.

---

## 12. CI gates

A PR cannot merge unless:

- [ ] All suites green
- [ ] Every `MUST` requirement in every touched spec has a linked, passing test
- [ ] Negative assertions ≥ positive assertions for any touched table's RLS file
- [ ] No new table without RLS enabled **and** forced
- [ ] No new `GRANT` on schema `private`
- [ ] Every new view sets `security_invoker = on`
- [ ] Location invariant suite green
- [ ] Concurrency harness green
- [ ] `EXPLAIN` baselines updated if a hot path changed
- [ ] No secret detected in the built bundle
- [ ] Second reviewer with the `DB` tag if `supabase/migrations/**` changed

Details in [CI/CD](../05-operations/02-cicd.md).

---

## 13. Ownership

| Layer | Owner |
| --- | --- |
| Unit | The engineer writing the code |
| RLS / DB | Backend, with security review on any policy change |
| Concurrency | Backend, `CODEOWNERS`-protected |
| E2E | Mobile |
| Location invariants | **Security owns these outright.** They are not negotiable in a code review. |
| Performance baselines | Backend |
| Accessibility | Mobile, with a designated reviewer per release |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering | Initial test strategy |
| 2026-10-21 | 1.1.0 | Engineering | Unit/integration runner is Jest (`jest-expo`) + React Native Testing Library, matching mobile architecture §1/§4.1, ADR-0015 and Location Privacy LP-08 (SCRUM-64). §2 names the one runner and what deliberately is not Jest; §7 LP-08 runner corrected |
