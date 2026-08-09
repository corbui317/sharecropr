# ADR-0015: Maestro over Detox for end-to-end testing

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile, QA |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

E2E tests are the top of the pyramid and the layer most likely to be abandoned. The failure pattern is well known: a suite is written, it becomes flaky, engineers start re-running failed jobs reflexively, someone marks a test as skipped "temporarily," and within two quarters the suite is decorative. Flakiness does not merely waste time — it destroys the signal, and a red build that means nothing is worse than no build check at all.

Sharecropr's critical paths are genuinely worth covering end to end, because they are the ones where a defect has physical consequences:

| Flow | Why E2E |
| --- | --- |
| Signup → TOTP → KYC → garden registration | Four systems, two webviews, a webhook, a camera. Unit tests cannot see this |
| Publish listing → receive request → accept → schedule → dual-confirm handoff | Two devices, a state machine, Realtime, push |
| Map load → filter → open safe spot → open listing | The primary discovery path and the perf-sensitive one |
| Block a user → verify their content disappears | An RLS behaviour the client must actually reflect |
| Report → moderation outcome | Safety-critical, low-frequency, easy to break silently |

The unusual constraints: two of these paths cross into **webviews we do not control** (Persona's hosted flow), several require **real device permissions** (camera, location), the exchange flow is inherently **two-user** and therefore two-session, and the [Definition of Done](../../00-foundation/06-doc-conventions.md#11-definition-of-done) requires offline behaviour and error states to be implemented rather than just the happy path — which means the suite must be able to simulate network failure.

We also have a small team and no dedicated QA automation engineer. Whatever we choose, product engineers write and maintain the tests, which makes authoring cost and debuggability dominant considerations over raw capability.

## Decision

**Use Maestro for all E2E flows, run against EAS-built binaries in CI, with a small critical-path subset gating releases.**

| Element | Value |
| --- | --- |
| Format | YAML flows in `e2e/flows/`, one file per user journey |
| Selectors | `testID` first, accessibility label second, text last. A test that selects on visible copy breaks on a copy change |
| Where flows run | `preview` (per PR, critical subset) and `staging` (full suite, nightly) ([System Architecture §6](../01-system-architecture.md#6-deployment-topology)) |
| Data | Synthetic seed per run. **Never production data**, ever |
| KYC | `private.review_bypass_accounts` allowlist, server-side and time-boxed — the same mechanism used for app-store reviewers ([ADR-0010](ADR-0010-kyc-vendor.md)) |
| Two-user flows | Two sequential sessions in one flow, driven by seeded fixtures and a `runFlow` sub-flow per role |
| Release gate | The critical subset must be **green, not "green after a re-run"** |
| Flake policy | A test that fails intermittently is **fixed or deleted within one week**. There is no quarantine tier — quarantine is where suites go to die |

Maestro's defining property for us is its **built-in tolerance**: it waits for elements and retries within a step rather than requiring explicit synchronization. This is a trade — it can mask a real race by waiting through it — and it is the right trade for a small team, because the alternative failure mode (a suite nobody trusts) is worse than the occasional masked timing bug, which our pgTAP concurrency tests are better positioned to catch anyway ([ADR-0016](ADR-0016-pgtap.md)).

Scope discipline: **E2E covers the five flows above and nothing else.** Component behaviour belongs in React Native Testing Library, domain logic in Jest against `src/domain`, authorization in pgTAP. A growing E2E suite is a symptom of missing tests underneath it.

## Alternatives considered

### Detox

**What it is.** The established React Native E2E framework. Grey-box: it hooks into the app's runtime to know when it is idle, so synchronization is automatic and precise.

**Why we didn't.** Detox's grey-box synchronization is genuinely superior in principle — it knows when the app is busy rather than guessing. In practice it is a heavier commitment: JS test code with its own runner, a native build configuration per platform, and a setup that must be maintained against every Expo SDK upgrade. Its weakest area is exactly our hardest requirement: **it cannot drive content inside a webview it does not control**, and the Persona hosted flow is a webview. Working around that means stubbing the vendor, which turns the single most integration-heavy path in the product into a test of our own mock. Detox is the better tool for a team with a dedicated automation engineer; we do not have one.

### Appium / WebdriverIO

**What it is.** The industry-standard, cross-platform, cross-framework driver.

**Why we didn't.** Maximum capability, maximum ceremony. Server processes, driver versions, capability matrices, and notoriously fragile setup. The authoring cost per test is high enough that product engineers will not write them, which means the tests will not exist.

### EAS Workflows / Maestro Cloud only, no local runs

**What it is.** Hosted device farm execution exclusively.

**Why we didn't.** Not rejected — used *in addition*. A test you cannot run locally is a test you cannot debug, and the first thing an engineer does with a failing E2E test is run it locally with the app visible.

### No E2E; manual QA checklist only

**What it is.** The [QA & Release Checklist](../../04-testing/05-qa-release-checklist.md) as the sole integration gate.

**Why we didn't.** Manual gates catch what the tester thinks to check, and the exchange flow's regressions are precisely the ones nobody thinks to re-check. The manual checklist stays, for the things automation cannot judge — visual polish, accessibility feel, camera behaviour on real hardware.

## Consequences

### Positive

- YAML flows are readable by non-engineers, so Product and QA can review what is covered and, in practice, propose flows themselves.
- Authoring cost is low enough that tests get written when a bug is fixed, which is when E2E coverage is most valuable.
- Built-in waiting removes the largest source of flake in mobile E2E without hand-written synchronization.
- Works against real device permission dialogs and against webviews, so the Persona flow is testable end to end rather than mocked.
- No test-only native build configuration to maintain across Expo SDK upgrades, which preserves [ADR-0001](ADR-0001-mobile-stack.md)'s upgrade story.
- Runs against EAS-built binaries, so we test the artifact we ship rather than a debug variant.

### Negative

- **YAML is not a programming language.** Complex conditional logic, loops, and data-driven cases are awkward or impossible, and the workarounds (JavaScript blocks, `runFlow` composition) get ugly fast.
- Black-box synchronization means Maestro waits rather than knowing. A real race condition can be waited through and never surface — this is the honest cost versus Detox.
- Weaker debugging than a JS test framework: no breakpoints, no rich assertion output, and failure messages that are less informative than a Jest diff.
- Two-user flows are sequential rather than genuinely concurrent, so true simultaneity hazards (H1, H4 in [Exchange State Machine §5](../07-exchange-state-machine.md#5-concurrency-hazards)) are **not** covered here and must be covered in pgTAP.
- Smaller ecosystem than Detox or Appium; fewer answers when something is wrong.

### Neutral / accepted costs

- `testID` discipline in components is required. That is a code-review item forever.
- Synthetic seed data must stay in sync with the schema; a migration that changes an enum can break flows, which is a feature, not a bug.
- Device-farm minutes cost money; the per-PR subset is deliberately small for this reason.

## The strongest argument against this decision

Maestro's convenience is purchased with the exact property that makes E2E tests worth running. Detox's grey-box synchronization means it knows when the app has finished work; Maestro polls and waits. In an app whose core flow is a distributed state transition — user A accepts a request, Postgres commits a multi-row transaction, Realtime delivers an event to user B, an outbox row is drained by a cron job, a push arrives — the interesting bugs *are* timing bugs. A test that retries a tap for ten seconds until the button appears will pass whether the Realtime event arrived in 200 ms or 8 s, and it will pass on the day the event does not arrive at all but a background refetch happens to fire. That is a test that reports green while the user experience is broken, which is a worse outcome than flake: flake at least gets attention. We have chosen a tool that converts a class of real defects into silent passes, in the flow where those defects are most consequential, and we have done it because YAML is easier to write.

The counter-objection to our own "flaky suites die" reasoning is that suites die from *unexplained* flake, not from strictness. Detox's failures are usually informative — it tells you the app was busy — and a team that invests in fixing them ends up with a suite that actually asserts timing. We have optimized for the suite surviving rather than for the suite being right, and a surviving suite that cannot detect a Realtime regression is only marginally better than no suite.

We take this path because the Persona webview is a hard blocker for Detox on our single most integration-heavy flow, and because the timing hazards have a better home: [ADR-0016](ADR-0016-pgtap.md)'s pgTAP concurrency tests exercise the actual races (H1–H8) at the level where they occur, deterministically, with real locks. E2E's job here is to prove the screens wire up, not to prove the state machine is correct. **But that division of labour must hold** — if we ever start relying on Maestro to catch a concurrency bug, this decision is wrong and should be reopened.

## Revisit when

- Critical-path flake rate exceeds **2% of runs** over a rolling 30 days, or any single flow is re-run more than **twice a week**.
- A production incident in the exchange flow would have been caught by a synchronization-aware test but was not — one occurrence is enough to reconsider Detox for that flow specifically.
- Any flow file exceeds **150 lines** or requires more than **three** JavaScript blocks; that is a signal the tool has run out of expressiveness.
- We hire a dedicated automation engineer, which changes the authoring-cost calculus that drove this decision.
- Persona ships a sandbox mode that is drivable without a webview, removing Detox's main blocker.
- E2E suite runtime exceeds **20 minutes** for the critical subset, at which point the subset is too large and the pyramid below it is too thin.

## Related

- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md), [ADR-0016 pgTAP](ADR-0016-pgtap.md), [ADR-0017 Release cadence](ADR-0017-release-cadence.md)
- [Exchange State Machine §5](../07-exchange-state-machine.md#5-concurrency-hazards), [System Architecture §6](../01-system-architecture.md#6-deployment-topology), [Doc Conventions §11](../../00-foundation/06-doc-conventions.md#11-definition-of-done)
