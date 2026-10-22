# Development Notes — Things to Watch

**Status:** Active · **Version:** 0.1 · **Date:** 2026-08-09 · **Owner:** Workflow Architect

Things that are **not defects** — the defects were fixed and are recorded in [the review](01-workflow-architect-review.md) — but that will cost someone a day, or a weekend, if nobody wrote them down.

Organised by **when each one bites**, not by topic. A note filed under "the first migration" is a note you want before you write the migration, and a topic-sorted list buries it next to something you needed six months later.

**Rule for this file:** a note earns its place by being non-obvious from the specs. Anything already stated normatively belongs in the spec, not here. When a note is resolved, strike it and say what happened — the record of why we watched something is worth more than a clean list.

---

## Index

| # | Note | Bites at | Severity if missed |
|---|---|---|---|
| [N-01](#n-01--do-the-map-spike-first-and-mean-it) | Do the map spike first, and mean it | Day one | **Critical** — replans the project |
| [N-02](#n-02--supply-seeding-has-no-engineering-weeks-and-decides-the-outcome) | Supply seeding has no engineering weeks | Day one | **Critical** — decides success |
| [N-03](#n-03--vault-is-now-on-the-critical-path-of-a-physical-meeting) | Vault is on the critical path of a meeting | First migration | High |
| [N-04](#n-04--the-idempotency-table-is-the-highest-churn-table-in-the-system) | Idempotency table is highest-churn | First migration | Medium |
| [N-05](#n-05--moderator-only-transitions-are-a-convention-not-a-constraint) | Moderator-only edges are a convention | First migration | High |
| [N-06](#n-06--the-disabled-fallback-path-will-rot-unless-it-is-exercised) | The disabled fallback will rot | First migration | Medium |
| [N-07](#n-07--the-ci-gates-are-described-not-built) | CI gates are described, not built | First PR | High |
| [N-08](#n-08--three-alerts-page-a-human-and-fix-nothing) | Three alerts page and fix nothing | First week live | Medium |
| [N-09](#n-09--safe-spot-curation-is-the-growth-constraint-not-engineering) | Curation is the growth constraint | First metro | High |
| [N-10](#n-10--the-moderation-rota-is-asserted-to-apple-before-it-exists) | Moderation rota asserted to Apple | Store submission | **Critical** — review rejection |
| [N-11](#n-11--four-workflows-touching-safety-or-regulation-have-no-spec) | Four safety/regulatory workflows unspecced | Before launch | High |
| [N-12](#n-12--contesting-a-no-show-weakens-the-signal-it-corrects) | Contest weakens the signal it corrects | 30 days | Medium |
| [N-13](#n-13--the-trusted-tier-will-be-empty-and-will-read-as-a-warning) | `trusted` will be empty at launch | Launch day | Medium |
| [N-14](#n-14--adding-a-session_state-is-breaking-with-a-long-tail) | Adding a `session_state` is breaking | First schema change | High |
| [N-15](#n-15--composted-exists-twice-and-the-fix-gets-more-expensive-monthly) | `composted` exists twice | **Resolved 2026-10-21** | — |
| [N-16](#n-16--the-highest-value-row-in-the-database-has-a-90-day-fuse) | Time-and-place has a 90-day fuse | Ongoing | High |
| [N-17](#n-17--phase-3-proximity-would-replace-the-handoff-model-not-extend-it) | Phase 3 proximity replaces the model | Phase 3 | Medium |
| [N-18](#n-18--every-rate-limit-is-a-guess-and-two-of-them-are-load-bearing) | Rate limits are guesses | 30 days | Medium |
| [N-19](#n-19--expo-modules-jsi5705-needs-a-temporary-patch-on-xcode-26) | `expo-modules-jsi@57.0.5` needs a patch on Xcode 26 | Day one (iOS dev client) | High — blocks iOS build |

---

## Day one

### N-01 — Do the map spike first, and mean it

[R-04](../06-roadmap/02-open-risks.md) says the map spike runs *before any other work*: SPEC-008's screen, 200 clustered custom markers, both platforms, New Architecture. The [roadmap](../06-roadmap/01-roadmap.md) says the same.

The reason to restate it here is that spikes are the first thing dropped when a plan looks tractable, and this one is load-bearing in an unusual way. The map is not a feature of the product — it *is* the discovery surface, and [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) picked a renderer on the assumption it behaves under Fabric. If it misbehaves, the options are a different library, a different rendering approach, or a different discovery model — and every one of those changes the data model, not just the screen.

> **This note now has a second, sharper edge.** The spike was run once against `react-native-maps` and passed. [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md) then changed the renderer, which means **a passing spike result is sitting in the repo that validates a stack we are not shipping**. That is more dangerous than never having run it: a remembered "the spike passed" is exactly the kind of thing that justifies skipping the reset. The failure surface also moved — marker count is no longer the risk, New Architecture interop and style complexity are. Re-run everything; do not diff against the old traces and call it done.

**The trap:** the spike is cheap to *start* and easy to declare finished at "it renders." It is finished when 200 markers cluster, pan, and zoom at 60fps on a mid-range Android device, because that device is the one Sharecropr's users own.

### N-02 — Supply seeding has no engineering weeks, and decides the outcome

[R-01](../06-roadmap/02-open-risks.md) states it plainly: *"the plan contains roughly 18 weeks of engineering and approximately zero weeks of supply seeding."* That register entry is the most honest line in the document set and it is the one most likely to be read, nodded at, and skipped.

Nothing in this documentation improves the odds of a user opening the map and seeing something. The whole set — the RLS design, the concurrency work, the location invariant — is a well-built answer to *"how do we make this safe and correct?"* and none of it is an answer to *"is there anything here?"*

**The trigger is already written down** ([R-01](../06-roadmap/02-open-risks.md)): fewer than 8 active listings per active safe spot at week 4 means stop feature work. Put that number on the dashboard from day one, because it is much easier to agree to a trigger before you are emotionally invested in continuing.

### N-19 — `expo-modules-jsi@57.0.5` needs a temporary patch on Xcode 26

Expo SDK 57 pulls `expo-modules-jsi@57.0.5`, which annotates two `RuntimeScheduler` **constructors** in `RuntimeScheduler.h` with `SWIFT_RETURNS_RETAINED`. Swift 6.3 / Xcode 26 treats that as invalid (constructors are not returning a `SWIFT_SHARED_REFERENCE` type), emits warnings, and the nested `[CP-User] Build ExpoModulesJSI xcframework` CocoaPods script fails with exit code 65 — even though the underlying compile often succeeds.

Upstream: [expo/expo#49214](https://github.com/expo/expo/issues/49214).

**Workaround in repo:** `patch-package` applies `patches/expo-modules-jsi+57.0.5.patch`, which removes only those two annotations. On some macOS/Xcode 26 hosts the same patch also disables codesigning in the nested `build-xcframework.sh` invocation (`CODE_SIGNING_ALLOWED=NO`) because provenance xattrs on build products trigger `resource fork, Finder information, or similar detritus not allowed` during CodeSign. `npm ci` / `npm install` must run postinstall so the patch is applied before `npx expo run:ios`.

**Remove the patch when:** a fixed `expo-modules-jsi` version **newer than 57.0.5** ships (check the upstream issue and `npm view expo-modules-jsi versions`). Then delete `patches/expo-modules-jsi+57.0.5.patch`, remove `patch-package` if no other patches remain, and verify a clean `npm ci && npx expo run:ios` on Xcode 26 without the patch.

**Do not confuse with:** MapLibre, New Architecture, PMTiles, or missing `jsi.h` — those were red herrings in the initial diagnosis.

---

## The first migration

### N-03 — Vault is now on the critical path of a physical meeting

The handoff code is encrypted at rest ([Exchange State Machine §3.3](../01-architecture/07-exchange-state-machine.md)), which was the right call — but it means **`vault.get_secret('handoff_code_key')` is now a dependency of two people completing an exchange in a library lobby.**

Three consequences nobody has to think about until they do:

1. **Vault unavailable = handoff unavailable.** `get_handoff_code` and `confirm_handoff` both fail. There is no cached path and there must not be one, because caching a decrypted code on the client is the thing R51 exists to prevent. This failure is not in the §9 error taxonomy — it will surface as `server_error`, which is honest but unhelpful at the moment it matters most. **Consider a distinct code and a distinct string** before launch: "we can't verify your code right now — try again in a moment" is a materially different message from a generic failure when someone is standing next to a stranger.
2. **The rotation runbook is untested until it is needed.** [Runbook 14](../05-operations/05-runbooks.md) exists and is correct on paper. Rehearse it against a seeded staging database with live `scheduled` sessions *before* the first production rotation, not during it. T73b covers the mechanics; it does not cover an operator reading the runbook at 2am.
3. **Key custody is now a launch dependency.** Who can read `handoff_code_key`? That answer belongs in [Environments](../05-operations/01-environments.md) and is currently unstated.

### N-04 — The idempotency table is the highest-churn table in the system

`private.idempotency_keys` takes a row for **every mutating RPC call** — eight RPCs, every request, every retry — and deletes them an hour later ([Exchange State Machine §4.1](../01-architecture/07-exchange-state-machine.md)). That is a pure insert-then-delete workload, which is the classic recipe for table and index bloat, and the sweep is a delete-heavy job that autovacuum has to keep up with.

At launch volume this is a non-issue and mentioning it would be premature optimisation. It is here because **the moment it stops being a non-issue is invisible** — nothing degrades, the table just gets slower and the sweep takes longer, until a `VACUUM FULL` is needed on a table sitting in the write path of every exchange.

**Cheap insurance now:** a per-table autovacuum setting tuned for high churn, and a size/bloat metric on the observability dashboard. Both cost minutes at migration time and are awkward to add under load. If it does become a problem, the standard answer is partitioning by hour and dropping partitions instead of deleting rows — but that is a migration, and this note exists so it is a planned one.

### N-05 — Moderator-only transitions are a convention, not a constraint

`disputed → cancelled` and `disputed → completed` are in `private.legal_session_transitions`, so the guard trigger permits them. Authorization lives in `moderation-action`, which checks `app.is_moderator()` ([R79a](../03-specs/SPEC-010-exchange-lifecycle.md)).

That division is deliberate and it is explained in the spec — a trigger that reads the JWT behaves differently in a migration than at runtime, which defeats the point of a storage-layer guard. But it does mean **nothing structural stops a future RPC from using those edges.** The next person adding a session RPC will see two legal transitions in the generated table and no compile-time reason not to reach for them.

**The control is a test, and it is T59's second clause** — the two edges must be unreachable from any participant RPC. That assertion has to be maintained as RPCs are added, and it is the kind of test that gets quietly weakened when it fails for a "good reason." `PARTICIPANT_TRANSITIONS` (generated, [arch §8](../01-architecture/07-exchange-state-machine.md)) is the client-side half of the same guard. Treat a change to either as a security review.

### N-06 — The disabled fallback path will rot unless it is exercised

[R88](../03-specs/SPEC-010-exchange-lifecycle.md) requires `dual_with_fallback` to ship **written, tested, and disabled**. The reasoning is sound: building it after the data arrives means a schema change under time pressure on the most concurrency-sensitive function in the system.

The failure mode of shipped-but-disabled code is that it stops working silently. Nobody runs it, nothing fails, and the day you flip the config is the day you discover it was broken three months ago.

**So the test suite must run the fallback path as a first-class case**, not as a skipped block — the completion-model config is a parameter of the exchange test suite, and both settings run in CI on every PR. If that is too slow, run `dual` per-PR and `dual_with_fallback` nightly, but never zero.

### N-07 — The CI gates are described, not built

[CI/CD §5.1](../05-operations/02-cicd.md) specifies five doc-governance gates and three generated-artefact gates. They are the mechanism by which most of [the review's](01-workflow-architect-review.md) process findings stay fixed rather than recurring — the normative-prose sweep in particular exists because five rate limits hid in a prose cell where the existing `MUST`→test gate could not see them.

**None of them exist yet.** Until `npm run ci:doc-gates` is real, the fixes are a snapshot and the doc set will drift back. The schema-graph gate is the cheapest and catches the most (it is ~30 lines of Python; the version in [the review's](01-workflow-architect-review.md) verification run already works). The approval gate is the one that matters most, because without it `Approved` goes back to meaning "we finished writing it".

Build them in the first sprint, while the reasons are fresh and there are no green builds to break.

> **2026-10-21 — the predicted drift happened.** By EPIC-03 the spec register again showed all 18 specs `Approved` (front matter and registry said `Review`), its dependency column disagreed with four specs' `Schema depends on`, and AGENTS.md described traceability and the RN-import ban as CI-enforced when no workflow ran them. Fixed by hand; `.github/workflows/app.yml` now runs lint, typecheck, auth unit tests, and the agent-memory bridge check. **The doc gates themselves still do not exist** — [CI/CD §2](../05-operations/02-cicd.md#2-required-checks) now carries a State column so the gap is visible.

> **2026-10-21 — first gate built.** `npm run ci:doc-gates` checks `Schema depends on` is acyclic and the register column matches front matter, with deliberately-broken fixtures under `scripts/fixtures/doc-gates/` (SCR-0003). Symmetry, normative-prose, approval, cross-reference, and staleness gates remain planned.

---

## The first week live

### N-08 — Three alerts page a human and fix nothing

`dispute_sla_breach`, `orphan_reservation_scan`, and the `exchange.no_show_backlog` gauge all alert and deliberately **mutate nothing** ([R68c, R68d](../03-specs/SPEC-010-exchange-lifecycle.md)). That is correct — guessing the outcome of a safety report to free an inventory row is the wrong trade, every time.

It also means each is a page with no runbook action beyond "go look." An alert that fires, gets acknowledged, and produces no change is an alert people learn to acknowledge without looking, and that habit transfers to the alerts that do matter — `exchange.double_reservation`, which means two people are driving to a library, and `exchange.transition_guard_rejection`, which means something other than an RPC is moving state.

**Give each of the three a named owner and a decision, not just a recipient.** "Dispute open 7 days → T&S lead decides today or records why not" is an action. "Alert to #eng-alerts" is a notification.

### N-18 — Every rate limit is a guess, and two of them are load-bearing

Eleven rate limits are now numbered requirements ([R13, R49, R63, R63a](../03-specs/SPEC-010-exchange-lifecycle.md)). Every number in that set was chosen by judgement, not measurement, which is unavoidable pre-launch and worth admitting.

Two deserve watching specifically:

- **`accept_exchange_request` at 30/hour.** Fine for an ordinary user, possibly tight for a community garden coordinator in peak season working through a queue of requests on a Saturday morning. The failure is a 429 in the middle of being helpful.
- **`get_handoff_code` at 20/hour/session.** The handoff screen fetches on open. A user who backgrounds and reopens the app repeatedly while waiting — which is exactly what someone standing in a lobby does — could plausibly approach it. Watch `exchange.code_read` against lockouts.

The rest are generous enough that the first signal will be abuse, not friction. These two could produce friction first, in the two moments where friction is least affordable.

---

## The first metro

### N-09 — Safe-spot curation is the growth constraint, not engineering

[R-02](../06-roadmap/02-open-risks.md) rates this High/High and it is the note most likely to be underestimated, because it does not look like an engineering problem and therefore does not get engineering attention.

Every new metro needs a human to verify venues, confirm hours by visiting or calling, and ideally obtain consent. There is no automation path in the plan and no obvious one to build. Meanwhile [SPEC-007 R21](../03-specs/SPEC-007-safe-spots.md) auto-suspends a spot whose hours go 180 days unverified — so curation is not a one-off cost per metro, it is a **recurring** one that scales with the number of spots.

Two consequences of the review worth carrying forward:

- **SPEC-007 no longer schema-depends on SPEC-900**, so seeding can start on day one against the schema. But the *console* affordance still lands with SPEC-900, which means early curation is manual data entry. Budget for that, or pull a thin curation slice forward.
- **The 48-hour takedown SLA in [R-02](../06-roadmap/02-open-risks.md) must be published before the first venue is listed**, not after the first objection.

### N-13 — The `trusted` tier will be empty, and will read as a warning

Reaching `trusted` needs 10 completed exchanges ([SPEC-012](../03-specs/SPEC-012-trust-and-safety.md) Q7). In a seeded launch metro, for the first season, essentially nobody will have that.

The problem is not the empty category. It is that **a badge nobody has makes its absence meaningful.** Every profile in the app will lack it, and a user who notices the tier exists will reasonably read "not trusted" into every counterparty they see — in a product whose entire job is getting strangers comfortable enough to meet.

This is SPEC-012 Q7 and it is open. Worth deciding *before* launch rather than after, because the fix afterwards is removing a badge people have started earning.

---

## Store submission

### N-10 — The moderation rota is asserted to Apple before it exists

[SPEC-900](../03-specs/SPEC-900-moderation-console.md) is unusually honest about this: *"A 24-hour SLA is a staffing commitment, not a software feature. The console can measure the SLA, page on it, and make breaches visible — it cannot meet it."*

App Store Guideline 1.2 requires a mechanism for reporting objectionable content **and a commitment to act on reports within 24 hours**. The submission asserts that. [R-11](../06-roadmap/02-open-risks.md) tracks it. The console being finished proves nothing about whether a human is on a rota.

**This is a launch blocker that no engineering task will close**, and it is the kind that gets discovered during review rather than before it. Before submission there must be: a named person per shift, a defined escalation path, a paging target for severity 1, and a documented answer for what happens when that person is on holiday. [SPEC-900 Q2](../03-specs/SPEC-900-moderation-console.md) asks at what report volume a part-time moderator stops sufficing; the proposed trigger is 20/day sustained.

### N-11 — Four workflows touching safety or regulation have no spec

From the [registry's](../workflows/REGISTRY.md) discovery gaps, these four are not "nice to have" documentation debt:

| Workflow | Why it matters | Where it should live |
|---|---|---|
| **Data subject access request** | Regulatory obligation with a statutory clock. Currently a manual Ops path with no runbook, no template, and no defined response window | [Privacy §5](../02-security/04-privacy-and-data-retention.md) + a runbook |
| **Break-glass exact-coordinate access** | The single most sensitive operation in the system. Described as a *policy* in [Location Privacy §10](../01-architecture/04-location-privacy.md); there is no step-by-step workflow, and the two-person rule needs a procedure, not a principle | [Runbook 6](../05-operations/05-runbooks.md) exists — verify it is complete against the policy |
| **Foodborne-illness incident** | [SPEC-023 R60](../03-specs/SPEC-023-crop-id-and-food-safety.md) says the runbook **MUST** exist before launch. It does not exist. Evidence preservation, notification path, counsel escalation, and the instruction that support must not offer medical opinions | New runbook |
| **Suspension fanout** | Cited by three specs ([SPEC-010 R19](../03-specs/SPEC-010-exchange-lifecycle.md), EC-05, SPEC-012), owned by none. Which trigger, in what order, with which notifications? It cancels in-flight sessions, so getting the order wrong strands someone mid-exchange | [SPEC-012](../03-specs/SPEC-012-trust-and-safety.md) is the natural home |

The foodborne-illness one is the sharpest: a spec requirement says it must exist before launch, and the CI approval gate will now catch SPEC-023 claiming `Approved` without it — but only once the gate is built ([N-07](#n-07--the-ci-gates-are-described-not-built)).

---

## Thirty to sixty days in

### N-12 — Contesting a no-show weakens the signal it corrects

`contest_no_show` ([R64a–d](../03-specs/SPEC-010-exchange-lifecycle.md)) was the right call — someone who stood in a lobby with no signal should not carry a marker for it. But it has a second-order effect worth naming.

R65's attribution was already only as strong as its honesty assumption. Making the marker clearable in one tap, with no evidence and no friction, means **`no_show_by` is now a weaker input to `trust_score` than it was**, and by an amount nobody can estimate in advance. That is the intended trade: a slightly noisier trust signal in exchange for not punishing people for bad reception.

**What to watch:** `exchange.no_show_contested` as a share of markers issued. Interpretations differ sharply by level:

- **Low (< 10%)** — the marker is mostly landing on the right people, and the contest is a safety valve doing its job quietly.
- **Moderate (10–40%)** — expected, and roughly the design assumption.
- **High (> 40%)** — `detect_no_shows` is blaming people who turned up, and the correct response is to weaken the marker's weight in `trust_score`, not to make contesting harder. **A high rate is evidence about R65, not evidence about the contesters.**

That last sentence is the one to remember, because the instinct when a clearing mechanism is used a lot is to add friction to it, and here that instinct is backwards.

### The completion-model review at 60 days

Not a note so much as a diary entry: [SPEC-010 §5.10](../03-specs/SPEC-010-exchange-lifecycle.md) commits to reviewing the dual-confirmation decision at 60 days against three pre-committed numbers, with a pre-committed switching threshold. **Put it in a calendar now.** The value of deciding the threshold in advance evaporates if nobody runs the review, and a review that happens six months late happens after people have built opinions.

---

## The first schema change

### N-14 — Adding a `session_state` is breaking, with a long tail

Adding a value to the `session_state` enum is a **breaking change** under [API Contract §3.2](../01-architecture/06-api-contract.md): it requires a new RPC, not a new enum label, and the client's generated transition table turns an unknown state into a compile error rather than a blank screen.

The tail is longer than the enum, and every item is somewhere different:

- `private.legal_session_transitions` gains rows, and the generated `LEGAL_SESSION_TRANSITIONS` **and** `PARTICIPANT_TRANSITIONS` regenerate ([R81](../03-specs/SPEC-010-exchange-lifecycle.md)).
- The transition-pair test count changes — which is fine, because the generator counts rows and enumerates `pg_enum` rather than hard-coding a total. That property was added precisely so this change stays cheap; **do not reintroduce a literal.**
- The [registry's](../workflows/REGISTRY.md) View 4 state map needs the new state, its entries, and its exits.
- Every terminal state needs a release path for the reservation, or it is [B-4](01-workflow-architect-review.md) again.
- `orphan_reservation_scan` needs to know whether the new state holds a reservation.
- Migrations are forward-only ([Data Model §15](../01-architecture/03-data-model.md)), and the generated transition table **must never lead the migration that defines it** — the client would then know a transition the database rejects.

The Cleanup Inventory section now in the [spec template](../00-foundation/07-spec-template.md) exists to force the fourth item. Use it.

### N-15 — `composted` exists twice, and the fix gets more expensive monthly

> **Resolved 2026-10-21.** `composted` stays in `inventory_status` (the baseline migration already ships it) and is removed from the `archive_reason` vocabulary. See [SPEC-006 Q3](../03-specs/SPEC-006-crop-inventory.md#15-open-questions). The note is kept as the record of why.

`composted` is both a value of `inventory_status` and a value of `archive_reason` ([SPEC-006](../03-specs/SPEC-006-crop-inventory.md) Q3). Two ways to say the same thing is how enums rot: some rows will use one, some the other, and every query that cares has to handle both forever.

Removing it is an `ALTER TYPE`, which is destructive and gated by [Data Model §15.3](../01-architecture/03-data-model.md). **Right now that costs nothing — there is no data.** After launch it costs a migration, a backfill, and a two-release expand/contract cycle.

This is the cheapest open question in the set and the only one whose price rises on a schedule. Decide it before the first migration ships.

---

## Ongoing

### N-16 — The highest-value row in the database has a 90-day fuse

`exchange_sessions.scheduled_start` + `safe_spot_id` is, per [Data Model §10](../01-architecture/03-data-model.md) and the [threat model](../02-security/01-threat-model.md), the highest-value target in the database for a stalker — a confirmed time and place a named person will be, and by implication a window when they are *not at home*.

The controls are good and structural. The one that needs watching is `anonymize_sessions`, which nulls participants and times 90 days after completion. It is a daily cron and, like every cron, it fails silently if it stops being scheduled — and the failure mode is *accumulating* rather than immediate. Six months of unanonymized sessions is a materially different breach than one.

**`exchange.cron_heartbeat` already covers this** ([SPEC-010 §11](../03-specs/SPEC-010-exchange-lifecycle.md)) with an alert at 3× cadence. The note is to make sure `anonymize_sessions` is actually in the job list that gauge watches — it is owned by [Privacy §3](../02-security/04-privacy-and-data-retention.md), not by SPEC-010, and jobs that span documents are the ones that fall between them.

### N-17 — Phase 3 proximity would replace the handoff model, not extend it

Geofenced or BLE arrival confirmation is deferred to Phase 3 with explicit opt-in ([SPEC-010 §3](../03-specs/SPEC-010-exchange-lifecycle.md), [Mobile Architecture §7](../01-architecture/02-mobile-architecture.md)). It is easy to read that as "the handoff code plus proximity later."

It is not additive. Real co-presence proof changes what completion *means*: the honest framing of the code today is that it proves co-presence **only among honest people** ([R52](../03-specs/SPEC-010-exchange-lifecycle.md)) and is therefore a coordination device. Proximity would make it an actual control — which changes the no-show attribution rules, the dispute evidence, the rating trust model, and the completion model that [§5.10](../03-specs/SPEC-010-exchange-lifecycle.md) just decided.

It also requires the background-location entitlement that is **deliberately absent from `app.json` so it cannot be added by accident**. Adding it is an ADR and a privacy review, not a build-config change.

**When Phase 3 is planned, re-open SPEC-010 §5.10 and R52 in the same breath.** Shipping proximity while the copy still says "coordination device, not an anti-fraud control" would leave the product making one claim and the docs another.

---

## Session notes

### 2026-08-22 — EPIC-02 (Data Model, RLS & Test Harness)

**Status:** Baseline landed in-repo; ready for EPIC-03 auth to depend on SCR-0202.

| Story | Status | Notes |
| --- | --- | --- |
| SCR-0201 | Done | `supabase/config.toml`, schemas, extensions, enums, `20260822_0001_baseline.sql` |
| SCR-0202 | Done | profiles, verifications, blocks, vendor refs, signup trigger, RLS + column REVOKE |
| SCR-0203 | Done | gardens, `private.garden_locations`, fuzz trigger, H3/geohash helpers, `get_my_garden_location` |
| SCR-0204 | Done | `app.is_moderator`, `is_blocked_either_way`, `can_transact`, session/thread participants; stub `exchange_sessions` / `message_threads` |
| SCR-0205 | Done | pgTAP harness, `scripts/run-pgtap.sh`, `.github/workflows/db.yml`, npm `db:*` scripts |
| SCR-0206 | Done | `ci:assert-negative-ratio` |
| SCR-0207 | Done | `private.idempotency_keys`, probe/record, autovacuum tuning, sweep cron |
| SCR-0208 | Done | Vault `handoff_code_key` local provision; custody in [Environments §6](../05-operations/01-environments.md) |
| SCR-0209 | **Deferred** | Blocked on SCR-1210 (handoff RPC) — vault rotation rehearsal not run |
| SCR-0210 | Scaffold | `packages/location-canary/` + pg_cron LP-01/LP-11 jobs; LP-08/09/10/12 partial |
| SCR-0211 | Done | `audit.events` append-only + metadata coordinate CHECK |
| SCR-0212 | Done | `tests.assert_query_under_ms` + `query_timing.test.sql` |

**Not yet verified on device/CI:** `supabase db reset && npm run db:test` needs Docker + Supabase CLI in CI (workflow committed). Physical go/no-go unchanged.

**Open items carried forward:** N-03 key custody now documented; SCR-0209 rotation rehearsal still outstanding; full LP-02 static allowlist and production-shaped perf seed deferred to EPIC-18.

---

## Change Log

| Date | Version | Author | Change |
|---|---|---|---|
| 2026-08-09 | 0.1 | Workflow Architect | Initial notes, from the full-set review and the three decided suggestions. A link sweep over all 74 documents (1,957 links) found and fixed 6 broken anchors along the way |
