# End-to-End Scenarios

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Mobile

Maestro flows ([ADR-0015](../01-architecture/adr/ADR-0015-e2e-tooling.md)). E2E is expensive and inherently flaky, so this suite is deliberately thin: it covers journeys that cross screens and would break silently. Anything enforceable at the database is tested at the database.

---

## 1. Scope rules

**In scope:** multi-screen user journeys, navigation and deep links, permission flows, offline and reconnection behaviour, and anything where the client and server could disagree.

**Out of scope:** RLS (pgTAP), concurrency (harness), validation rules (unit), and pixel appearance (not tested at all — see [Test Strategy §11](01-test-strategy.md)).

**Flakiness policy:** a flaky flow is quarantined within 24 hours and fixed or deleted within a week. A suite people have learned to re-run is a suite nobody reads.

---

## 2. Suites

| Suite | Flows | When | Budget |
| --- | --- | --- | --- |
| **Smoke** | E-01 … E-08 | Every PR, both platforms | < 12 min |
| **Full** | All | Nightly + pre-release | < 45 min |
| **Release** | Full + manual QA | Before submission | — |

---

## 3. Fixtures

Preview environments are seeded deterministically. **Test accounts bypass KYC through the server-side allowlist** (`private.review_bypass_accounts`) — never a build flag, because a build flag ships.

| Account | State |
| --- | --- |
| `e2e_fresh` | Signed up, nothing else |
| `e2e_verified` | KYC + garden verified, empty inventory |
| `e2e_owner` | Verified, 5 inventory items, 3 active listings |
| `e2e_requester` | Verified, 2 items |
| `e2e_blocked` | Mutual block with `e2e_owner` |
| `e2e_suspended` | Suspended |

Time-dependent flows use a server clock override rather than `sleep`. A suite that waits 72 hours for a request to expire is a suite that never runs.

---

## 4. Smoke suite

### E-01 — Signup to verified

`e2e_fresh` → email signup → verify email → profile → location permission (**grant**) → register garden → capture garden photo → submit → approve via test hook → KYC bypass → land on map as `id_verified`.

**Asserts:** onboarding cannot be skipped; the map is reachable before verification but publishing is not; the trust badge appears.

### E-02 — Map loads and renders safe spots

Launch as `e2e_verified` → map centres on the user in follow mode → safe-spot nodes render → tap a node → bottom sheet lists listings → tap a listing → detail opens.

**Asserts:** cold start to interactive map under 2.5 s p95; follow mode breaks on pan and restores via the button; **no user location marker other than the user's own appears anywhere**.

### E-03 — Add inventory and publish a listing

`e2e_verified` → inventory FAB → add item (species picker → variety → quantity → unit → condition → photo) → save → publish → select 2 safe spots → set expiry → publish → listing appears on the map.

**Asserts:** the species picker searches by alias ("courgette" → Zucchini); the item cannot be published twice; the listing appears at both chosen spots.

### E-04 — Request an exchange

`e2e_requester` → map → find `e2e_owner`'s listing → request → optionally offer an item → send → thread opens with a system message → request appears in Exchanges.

**Asserts:** cannot request your own listing; a second request to the same listing is prevented; the thread cannot be opened before the request exists.

### E-05 — Accept, schedule, complete

`e2e_owner` accepts → both parties see `scheduling` → propose spot and time → other confirms → `scheduled` → handoff code visible to both → both enter it → `completed` → rating prompt.

**Asserts:** the code is identical for both parties; one confirmation alone does not complete; a time outside venue hours is rejected with `venue_closed`; completion unlocks rating.

### E-06 — Messaging with realtime

Both parties in a thread → A sends → B receives within 2 s without a manual refresh → B replies → read receipt appears.

**Asserts:** realtime delivery; read receipts; the composer is disabled on a closed thread.

### E-07 — Block tears everything down

`e2e_requester` has a pending exchange with `e2e_owner` → blocks them → thread closes → session cancels → the listing disappears from the map.

**Asserts:** immediate and complete teardown; **the blocked user sees no notification and no state change**.

### E-08 — Offline and reconnect

Grant permissions → go offline → browse cached inventory → compose a message (queues) → add an inventory item (queues) → reconnect → both sync exactly once.

**Asserts:** the offline banner appears; queued items show pending state; nothing duplicates on reconnect; the map shows a staleness banner rather than an empty screen.

---

## 5. Full suite

### Authentication

| ID | Flow | Key assertions |
| --- | --- | --- |
| E-09 | Sign in with Apple | Private-relay email handled; account links correctly |
| E-10 | Sign in with Google | Native flow, not a webview |
| E-11 | Password reset | Identical response whether or not the account exists |
| E-12 | Enroll TOTP | QR and manual key; recovery codes shown once; confirmation requires re-entering one |
| E-13 | Step-up auth | Changing email prompts for TOTP; cancelling leaves the email unchanged |
| E-14 | Sign out everywhere | The second device is signed out within 60 s |
| E-15 | Account deletion | 30-day grace; profile immediately hidden; sign-in within the window offers restoration |

### Verification

| ID | Flow | Key assertions |
| --- | --- | --- |
| E-16 | Garden verification rejected → resubmit | Rejection reason shown; resubmission allowed; attempt counter increments |
| E-17 | Location permission denied | App remains fully usable; locality search offered; **not a dead end** |
| E-18 | Camera permission denied | Clear recovery path to Settings; verification cannot proceed via photo library |
| E-19 | KYC failure and retry | Attempt cap enforced at 5; copy is non-accusatory |
| E-20 | Unverified user hits a gate | Publishing and requesting are blocked with a clear route to verification |

### Exchange edge paths

| ID | Flow | Key assertions |
| --- | --- | --- |
| E-21 | Decline a request | Requester notified; the listing returns to `active`; other pending requests are unaffected |
| E-22 | Withdraw a request | Thread closes; owner notified |
| E-23 | Cancel a scheduled session | Reason required; counterparty notified; late-cancel warning shown under 4 h |
| E-24 | Request expires | Clock advanced 72 h; request shows `expired`; the thread closes |
| E-25 | Losing acceptor's experience | Two requesters, one accepted → the loser sees "Just claimed by someone else" and the listing disappears cleanly |
| E-26 | Wrong handoff code | 5 failures lock confirmation for 15 min; both parties notified |

### Trust and safety

| ID | Flow | Key assertions |
| --- | --- | --- |
| E-27 | Rate after completion | Double-blind — the other party's rating is hidden until both submit |
| E-28 | Report from a message | Reachable in two taps; confirmation copy matches the spec exactly |
| E-29 | Report `unsafe_meeting` | Severity 1 assigned; the paging hook fires (asserted on a test endpoint) |
| E-30 | Suspended user | Cannot publish, request, or message; sees a clear explanation and the appeal path |

### Notifications

| ID | Flow | Key assertions |
| --- | --- | --- |
| E-31 | Contextual permission prompt | Requested **after** the first request is sent, never at launch |
| E-32 | Deep link from a notification | Cold start opens the correct screen with correct back-stack behaviour |
| E-33 | Quiet hours | A non-safety notification is suppressed; a `safety_alert` is not |

### Accessibility

| ID | Flow | Key assertions |
| --- | --- | --- |
| E-34 | Screen-reader signup | VoiceOver and TalkBack complete signup unaided |
| E-35 | **Map list alternative** | Fully usable with a screen reader — a map is not, so the list view is a first-class path, not a fallback |
| E-36 | Largest dynamic type | No truncation; no unreachable buttons on any core screen |

---

## 6. Flow structure

```yaml
# .maestro/E-05-accept-and-complete.yaml
appId: app.sharecropr
name: E-05 Accept, schedule, and complete an exchange
tags: [smoke, exchange]
---
- runFlow: shared/reset-and-seed.yaml
- runFlow: shared/sign-in.yaml
  env: { ACCOUNT: e2e_owner }

- tapOn: { id: "tab-exchanges" }
- assertVisible: { id: "request-card-pending" }
- tapOn: { id: "request-card-pending" }
- tapOn: { id: "btn-accept-request" }
- assertVisible: { id: "session-state-scheduling" }

- tapOn: { id: "btn-propose-schedule" }
- tapOn: { id: "safe-spot-option-0" }
- tapOn: { id: "time-slot-tomorrow-1600" }
- tapOn: { id: "btn-confirm-schedule" }
- copyTextFrom: { id: "handoff-code" }

- runFlow: shared/switch-account.yaml
  env: { ACCOUNT: e2e_requester }
- tapOn: { id: "session-card-scheduled" }
- tapOn: { id: "btn-confirm-schedule" }
- assertVisible: { id: "session-state-scheduled" }
- assertVisible: { id: "handoff-code", text: "${maestro.copiedText}" }   # same code both sides

- tapOn: { id: "btn-enter-handoff-code" }
- inputText: "${maestro.copiedText}"
- tapOn: { id: "btn-submit-code" }
- assertVisible: { id: "session-state-in-progress" }
- assertNotVisible: { id: "session-state-completed" }                    # one side is not enough

- runFlow: shared/switch-account.yaml
  env: { ACCOUNT: e2e_owner }
- tapOn: { id: "btn-enter-handoff-code" }
- inputText: "${maestro.copiedText}"
- tapOn: { id: "btn-submit-code" }
- assertVisible: { id: "session-state-completed" }
- assertVisible: { id: "rating-prompt" }
```

### testID conventions

`{component}-{purpose}[-{modifier}]`, kebab-case, stable across refactors: `btn-accept-request`, `input-crop-quantity`, `card-listing-{id}`, `sheet-safe-spot`, `state-map-empty`.

testIDs are **product surface**, not implementation detail. Renaming one is a breaking change and needs the same care as renaming an API field.

---

## 7. Anti-flake practices

| Practice | Why |
| --- | --- |
| Never `sleep` — always `assertVisible` with a timeout | Time-based waits are the single biggest source of flakes |
| Deterministic seeds, reset before every flow | Cross-test pollution is the second biggest |
| Clock override, never real waiting | 72-hour expiry cannot be waited for |
| Mock Persona and Expo Push in preview | Third-party latency is not our test surface |
| Fixed device profiles in CI | Screen-size drift changes tap targets |
| Disable animations in the test build | Animation timing races assertions |
| One journey per flow | A 40-step flow fails for forty reasons |
| Retry once, then fail loudly | Two retries hides a real 50% failure rate |

---

## 8. Reporting

Every run publishes flow duration trends, a per-flow failure-rate table over 30 days, a video of each failure, and the device logs around it. **Any flow above a 2% failure rate over 30 days is automatically quarantined** and its owner is notified — the quarantine is mechanical so it doesn't depend on someone noticing.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Mobile | Initial E2E scenarios |
