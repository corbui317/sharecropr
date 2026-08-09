# QA & Release Checklist

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Engineering + QA

The manual gates. Automated tests answer "did we break what we knew about"; this checklist answers "is this thing actually fit to put in front of people who will meet strangers because of it."

Every box is signed by a named person. "The team checked it" is not a signature.

---

## 1. Per-pull-request

Automated in CI, but the reviewer confirms:

- [ ] Spec status is `Approved` and its version matches what was built
- [ ] Every `MUST` in the touched spec has a passing, ID-tagged test
- [ ] RLS changes have positive **and** negative pgTAP tests in the same PR
- [ ] Error, empty, offline, and permission-denied states are implemented — not just the happy path
- [ ] New user-facing copy matches the spec's §8.3 exactly
- [ ] No new coordinate reaches any response, log, or telemetry event
- [ ] Accessibility: labels, focus order, hit targets checked on the changed screens
- [ ] Spec change log updated if behaviour changed

---

## 2. Per-release

### 2.1 Automated gates

- [ ] Full test suite green on both platforms
- [ ] Location invariant suite (LP-01 … LP-13) green
- [ ] Concurrency harness green at 50 concurrent acceptors
- [ ] Full Maestro suite green, no quarantined flow on a critical path
- [ ] Performance budgets met; `EXPLAIN` baselines unchanged or reviewed
- [ ] No secret detected in the built bundle
- [ ] Migration tested against a production-shaped seed
- [ ] Destructive-migration DAU gate passed

### 2.2 Manual — core journeys

Both platforms. **Real devices, not simulators** — camera, location, and push all behave differently on real hardware, and those three are the ones that matter here.

- [ ] Signup → verification → first listing, start to finish, on a fresh install
- [ ] Full exchange: request → accept → schedule → handoff → rate
- [ ] Decline, withdraw, cancel, and expire paths
- [ ] Messaging with the app backgrounded, then foregrounded
- [ ] Block teardown observed from **both** sides
- [ ] Report submission, including `unsafe_meeting`
- [ ] Account deletion and restoration within the grace window

### 2.3 Manual — the states people skip

The rows below are where products actually fail, and they are exactly the ones that get waved through under release pressure.

- [ ] **Location permission denied** — app fully usable, locality search offered
- [ ] **Camera permission denied** — clear recovery, no dead end
- [ ] **Notification permission denied** — in-app inbox still complete
- [ ] **Airplane mode** on every core screen — cached content plus a clear banner, never a spinner forever
- [ ] **Reconnect after 10 minutes offline** — queued actions sync exactly once
- [ ] **Slow 3G** — no unbounded spinner; skeletons; timeouts produce a retry, not a blank screen
- [ ] **Empty states** — no gardens, no inventory, no listings nearby, no exchanges, no messages
- [ ] **Cold start from a push notification** — correct screen, correct back stack
- [ ] **Rate limited** — countdown shown, input preserved
- [ ] **Session expired mid-action** — re-auth, then the action resumes or fails cleanly

### 2.4 Manual — device matrix

| Device | iOS | Android |
| --- | --- | --- |
| Current flagship | Latest OS | Latest OS |
| **3-year-old mid-range** | **Minimum supported OS** | **Minimum supported OS** |
| Small screen | iPhone SE | Compact Android |
| Large text / display zoom | Both | Both |

The three-year-old mid-range device is the one the performance budget is written against, and it is the one most likely to be skipped. Do not skip it.

### 2.5 Manual — accessibility

- [ ] VoiceOver: signup, map **list alternative**, inventory, listing, request, thread, rating
- [ ] TalkBack: same
- [ ] Largest dynamic type on every core screen — no truncation, no unreachable button
- [ ] Keyboard/switch navigation reaches every interactive element
- [ ] No information conveyed by colour alone
- [ ] Contrast spot-checked on status and state indicators

### 2.6 Manual — safety and privacy

**Signed by Security, not by the release manager.**

- [ ] No screen displays another user's location, at any zoom, in any state
- [ ] Network trace inspected on the map, listing detail, and thread screens — **no coordinate present** except safe spots and the user's own garden
- [ ] A geotagged photo uploaded from a real device arrives EXIF-free
- [ ] A test Sentry event containing a coordinate is scrubbed
- [ ] Reporting is reachable in ≤ 2 taps from every user, listing, message, and exchange
- [ ] Blocked user sees no indication they were blocked
- [ ] Moderation console renders no coordinate anywhere
- [ ] Break-glass procedure exercised in staging within the last 90 days

---

## 3. Store submission

### 3.1 Both stores

- [ ] Reviewer accounts on the **server-side** KYC bypass allowlist, with a future `expires_at`
- [ ] KYC vendor mocked in the review environment — a reviewer will not photograph their licence, and a stalled flow reads as a broken app
- [ ] Review notes explain the safe-spot model, the verification gate, and the reviewer credentials
- [ ] Demo data seeded near the reviewer's likely location, or a location override documented
- [ ] Screenshots current and showing no real user data
- [ ] Privacy policy and terms reachable from the app and from the store listing
- [ ] Data-safety declarations match what the app actually collects — verified against the [data inventory](../02-security/04-privacy-and-data-retention.md), not from memory

### 3.2 Apple

- [ ] **4.8** — Sign in with Apple present alongside Google
- [ ] **1.2 (UGC)** — reporting, blocking, filtering, and a documented 24 h moderation process; the process is described in the review notes **and is real**
- [ ] **5.1.1(v)** — account deletion available in-app
- [ ] **5.1.1** — permission strings explain purpose in plain language; no permission requested before it is needed
- [ ] **No background location requested** — deliberate, and it keeps us out of a review category we don't need
- [ ] `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryAddUsageDescription` present and specific
- [ ] Export compliance answered
- [ ] Age rating reflects UGC and the 18+ transacting requirement

### 3.3 Google Play

- [ ] Public web deletion URL live at `https://sharecropr.app/delete-account` and actually working
- [ ] Target API level meets the current deadline
- [ ] `ACCESS_BACKGROUND_LOCATION` **absent** from the merged manifest — check the merged manifest, since a transitive dependency can inject it
- [ ] Data-deletion declaration matches the 30-day grace we implement
- [ ] UGC policy: in-app reporting and a documented moderation process
- [ ] Permissions declaration form complete

---

## 4. Launch gates

**MVP-only. All must be true before first public release** — these mirror [PRD §7](../00-foundation/02-prd.md) and [Trust & Safety §11](../02-security/05-trust-and-safety.md).

- [ ] Location invariant suite green in **production**, not just CI
- [ ] External RLS-focused security review complete, findings closed
- [ ] ≥ 40 verified safe spots per launch metro, hours confirmed within 30 days
- [ ] ≥ 100 seeded active listings per metro — a map with nothing on it is a failed launch regardless of code quality
- [ ] Moderation console operable, with a **named human** on the severity-1 rota
- [ ] Paging path tested end to end with a drill
- [ ] Incident-response playbook signed off by counsel
- [ ] **Liability insurance in force**
- [ ] Community guidelines published and linked from signup
- [ ] Appeals process live before the first enforcement action
- [ ] Support inbox monitored with a stated response time
- [ ] Rollback plan rehearsed, including the EAS Update revert path

---

## 5. Post-release

### First hour

- [ ] Crash-free sessions ≥ 99.5%
- [ ] API error rate within baseline
- [ ] `safe_spots_near` p95 within budget
- [ ] Auth success rate normal
- [ ] No spike in report volume
- [ ] Sentry triaged for new issue types

### First 24 hours

- [ ] Signup funnel conversion within expectation
- [ ] Verification conversion within expectation
- [ ] First exchanges completing end to end
- [ ] No SLA breaches in the moderation queue
- [ ] Store reviews scanned for a systemic complaint
- [ ] Address-sharing flag rate baselined ([R-09](../06-roadmap/02-open-risks.md))

### First week

- [ ] Retention cohort curve reviewed
- [ ] Listings per active safe spot trending up
- [ ] Request → completed conversion measured
- [ ] Post-release review held, checklist updated with anything this release taught us

---

## 6. Rollback triggers

Roll back **immediately**, without discussion, on any of:

| Trigger | Action |
| --- | --- |
| Any confirmed location exposure | Roll back, then execute the [location-breach runbook](../05-operations/05-runbooks.md) |
| Crash-free sessions < 98% | Roll back |
| Auth failure rate > 5% | Roll back |
| Exchange completion rate down > 50% | Roll back |
| Any data-loss report | Roll back and freeze writes |
| Moderation console down > 30 min | Escalate; use the documented fallback |

JS-only changes revert via EAS Update in minutes. Native changes require a store release, which is precisely why native changes get more scrutiny before they ship ([ADR-0017](../01-architecture/adr/ADR-0017-release-cadence.md)).

---

## 7. Sign-off

| Role | Confirms | Name | Date |
| --- | --- | --- | --- |
| Engineering lead | §1, §2.1 | | |
| QA | §2.2, §2.3, §2.4, §2.5 | | |
| **Security** | **§2.6** | | |
| Trust & Safety | §4 T&S gates | | |
| Product | §3, §4 | | |
| Release manager | Overall | | |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering + QA | Initial checklist |
