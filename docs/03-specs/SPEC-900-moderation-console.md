# SPEC-900: Moderation Console

| Field | Value |
| --- | --- |
| **Status** | Approved |
| **Version** | 1.0.0 |
| **Owner** | Trust & Safety + Platform Engineering |
| **Phase** | MVP |
| **Security review** | required |
| **Depends on** | [SPEC-004](SPEC-004-garden-verification.md), [SPEC-011](SPEC-011-messaging.md), [SPEC-012](SPEC-012-trust-and-safety.md) |
| **Depended on by** | App Store submission (Guideline 1.2) |
| **Related ADRs** | [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0018](../01-architecture/adr/ADR-0018-observability.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

The moderation console is the internal web tool where staff review reports, approve or reject garden verifications, examine flagged messages, and take enforcement actions. It is the operational half of a commitment we make in the App Store submission: that user reports get a human decision within 24 hours, and safety escalations within one hour. It is deliberately narrow — every capability it has is one a moderator needs to make a decision, and nothing more.

## 2. Goals

- Give a moderator everything needed to decide a case on one screen, without a database client.
- Make the 24h / 1h SLAs measurable and visibly breached when they are breached.
- Produce an unforgeable record of who did what, to whom, and why.
- Make it structurally impossible for the console to leak an exact garden coordinate.
- Protect the moderators themselves from the material they review.

## 3. Non-Goals

- **A general admin panel.** No user impersonation, no arbitrary SQL, no data export, no billing (there is none), no feature-flag management. Those belong elsewhere, with different access controls.
- **A mobile app.** Moderation is desk work. A phone-sized moderation UI encourages fast, low-context decisions on exactly the material where that is most dangerous.
- **Automated enforcement.** ML scores rank the queue; humans decide. An automated ban with no human in the loop is an appeal we cannot answer.
- **Blanket message reading.** Access is scoped to a report or a flag. See [SPEC-011-R32](SPEC-011-messaging.md).
- **Rendering exact coordinates.** Not "hidden by default" — the console has no code path that fetches one, so a screenshot of any console screen is safe by construction.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **moderator**, I want the queue ordered by how close each case is to breaching SLA, so I work the right case next. | P0 |
| US-02 | As a **moderator**, I want an `unsafe_meeting` report to reach me within minutes, not sit in a queue. | P0 |
| US-03 | As a **moderator**, I want the full context of a report — the thread, the exchange, both users' histories — on one screen. | P0 |
| US-04 | As a **moderator**, I want to approve or reject a garden photo quickly, with the ML score as a hint rather than an instruction. | P0 |
| US-05 | As a **T&S lead**, I want every action attributable and reviewable, including my own. | P0 |
| US-06 | As a **T&S lead**, I want permanent bans and law-enforcement referrals to require a second person. | P0 |
| US-07 | As a **moderator**, I want to rotate off the high-severity queue and not be exposed to more distressing material than necessary. | P1 |
| US-08 | As a **suspended user**, I want an appeal that a different human reviews. | P1 |

## 5. Functional Requirements

### 5.1 Access control

| ID | Req | Statement |
| --- | --- | --- |
| R01 | MUST | Console access **MUST** require a `moderator` or `admin` value in the JWT `app_metadata.role` claim, checked by `app.is_moderator()`. |
| R02 | MUST | Every moderator account **MUST** have TOTP 2FA enrolled. An account without it **MUST NOT** be able to authenticate to the console. |
| R03 | MUST | Console sessions **MUST** expire after 8 hours of wall time and 30 minutes of inactivity, whichever is sooner. |
| R04 | MUST | The console **MUST** be reachable only from an allowlisted IP range or through the corporate identity proxy. |
| R05 | MUST | Role assignment and revocation **MUST** be performed by an admin, **MUST** write to `audit.events`, and **MUST NOT** be self-service. |
| R06 | MUST | A moderator **MUST NOT** be able to act on a case in which they are the reporter, the subject, or a participant. Enforced server-side, not by convention. |
| R07 | MUST | Revoking a moderator's role **MUST** invalidate their sessions within 60 minutes (JWT lifetime), and an admin **MUST** be able to force immediate revocation. |

### 5.2 Queues

| ID | Req | Statement |
| --- | --- | --- |
| R08 | MUST | The report queue **MUST** be sorted by `sla_due_at` ascending, breached items first and visually distinct. |
| R09 | MUST | A report with `reason = 'unsafe_meeting'` **MUST** be assigned `severity = 1` and `sla_due_at = created_at + 1 hour`, and **MUST** page the on-call moderator immediately rather than waiting for a queue poll. |
| R10 | MUST | All other reports **MUST** have `sla_due_at = created_at + 24 hours`. |
| R11 | MUST | A moderator **MUST** be able to claim a case, and a claimed case **MUST NOT** appear in another moderator's queue. Claims expire after 30 minutes of inactivity. |
| R12 | MUST | The garden verification queue **MUST** be sorted by submission age and **MUST** show the ML confidence score, clearly labelled as advisory. |
| R13 | MUST | The flagged-message queue **MUST** show the flagged message with 10 messages of surrounding context, per [SPEC-011-R29](SPEC-011-messaging.md). |
| R14 | MUST | An appeals queue **MUST** exist, and an appeal **MUST NOT** be routable to the moderator who took the original action. |
| R15 | SHOULD | Queue counts and oldest-item age **SHOULD** be visible without opening a queue. |

### 5.3 Case context

| ID | Req | Statement |
| --- | --- | --- |
| R16 | MUST | A report case view **MUST** show: the report, the subject content, both parties' trust tiers, verification status, completed exchange counts, rating summaries, prior reports filed by and against each, and prior actions taken. |
| R17 | MUST | The case view **MUST NOT** display, fetch, or embed any exact garden coordinate. It **MAY** display `city_label` and the fuzzed `display_point` only. |
| R18 | MUST | For an exchange-related report, the case view **MUST** show the session state history, the safe spot, and the scheduled window. |
| R19 | MUST | Thread access **MUST** be scoped by `app.is_moderatable_thread()` and **MUST** write an `audit.events` row on each read, per [SPEC-011-R32–R34](SPEC-011-messaging.md). |
| R20 | SHOULD | The case view **SHOULD** surface a "related cases" panel linking reports sharing a subject, a device, or a safe spot within 30 days. |

### 5.4 Actions

| ID | Req | Statement |
| --- | --- | --- |
| R21 | MUST | Available actions **MUST** be exactly the `moderation_action` enum: `none`, `warning`, `content_removed`, `listing_removed`, `suspension`, `permanent_ban`, `law_enforcement_referral`. |
| R22 | MUST | Every action **MUST** require a free-text rationale of at least 20 characters. |
| R23 | MUST | `permanent_ban` and `law_enforcement_referral` **MUST** require approval by a second moderator before taking effect. The proposing moderator **MUST NOT** be able to approve their own proposal. |
| R24 | MUST | A `suspension` **MUST** carry an explicit `suspended_until`, and the maximum single suspension **MUST** be 90 days. |
| R25 | MUST | Every action **MUST** notify the affected user with the category of violation and the appeal path, and **MUST NOT** disclose the reporter's identity. |
| R26 | MUST | Resolving a report **MUST** set `status`, `action_taken`, `resolved_by`, and `resolved_at` atomically. |
| R27 | MUST | Actions **MUST** be executed through the `moderation-action` Edge Function running as `service_role`. The console **MUST NOT** hold database credentials or write to tables directly. |
| R28 | MUST | An action **MUST** be reversible by an admin within 30 days, and the reversal **MUST** be audited as its own event rather than editing the original. |
| R29 | SHOULD | The console **SHOULD** suggest an action based on the subject's history, clearly marked as a suggestion. |

### 5.5 Audit

| ID | Req | Statement |
| --- | --- | --- |
| R30 | MUST | Every case view, every thread read, every action, every reversal, and every role change **MUST** write to `audit.events` with actor, subject, action, and correlation id. |
| R31 | MUST | `audit.events` **MUST** have no `UPDATE` or `DELETE` grant for any role, including `service_role`. |
| R32 | MUST | An action that fails to write its audit row **MUST** fail entirely. Audit and effect are in one transaction. |
| R33 | MUST | A weekly report of all moderator actions **MUST** be delivered to the T&S lead, including a per-moderator action distribution. |
| R34 | MUST | Any access to P0 data (exact coordinates) **MUST** occur only through the break-glass procedure in [Location Privacy §10](../01-architecture/04-location-privacy.md), never through the console. |

### 5.6 Moderator wellbeing

| ID | Req | Statement |
| --- | --- | --- |
| R35 | MUST | Distressing content categories **MUST** be behind a click-through content warning stating the category. |
| R36 | MUST | Images in a case **MUST** default to blurred with a click to reveal. |
| R37 | SHOULD | No moderator **SHOULD** be assigned more than 2 consecutive hours on the severity-1 queue, and the console **SHOULD** enforce a rotation prompt. |
| R38 | MUST | Support resources **MUST** be one click away from every case view. |

> **The honest framing.** A 24-hour SLA is a staffing commitment, not a software feature. The console can measure the SLA, page on it, and make breaches visible — it cannot meet it. Meeting it requires a named human on a rota, and the App Store submission asserts that this exists. Before launch, that rota must be real, with a defined escalation path and a paging target for severity 1. This is tracked as [R-11](../06-roadmap/02-open-risks.md).

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| `public.reports` | read/update via `moderation-action` | Full row including `severity`, `action_taken` |
| `public.profiles` | read (moderator columns) | Includes `trust_score`, `is_suspended` |
| `public.messages` / `message_threads` | read, scoped by `app.is_moderatable_thread()` | Audited per read |
| `public.garden_verification_submissions` | read/update | Photo, ML score, decision |
| `public.exchange_sessions` | read | State history, safe spot, window |
| `public.listings` | read/update status | Content removal |
| `public.blocks`, `public.ratings` | read | Context |
| `audit.events` | insert only | Append-only |
| `private.garden_locations` | **no access** | Break-glass only, outside the console |

**New schema objects introduced by this spec:**

```sql
CREATE TABLE public.moderation_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL UNIQUE REFERENCES public.reports(id),
  claimed_by    uuid REFERENCES public.profiles(id),
  claimed_at    timestamptz,
  claim_expires_at timestamptz
    GENERATED ALWAYS AS (claimed_at + interval '30 minutes') STORED,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.moderation_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES public.moderation_cases(id),
  proposed_by   uuid NOT NULL REFERENCES public.profiles(id),
  proposed_action moderation_action NOT NULL,
  rationale     text NOT NULL CHECK (length(rationale) >= 20),
  approved_by   uuid REFERENCES public.profiles(id),
  approved_at   timestamptz,
  CONSTRAINT no_self_approval CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

CREATE TABLE public.appeals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id),
  action_ref    uuid NOT NULL,
  statement     text NOT NULL CHECK (length(statement) BETWEEN 20 AND 2000),
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','upheld','overturned')),
  reviewed_by   uuid REFERENCES public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_original_reviewer CHECK (reviewed_by IS DISTINCT FROM user_id)
);

CREATE INDEX cases_unclaimed_idx ON public.moderation_cases (created_at)
  WHERE claimed_by IS NULL AND resolved_at IS NULL;
```

**PII touched:** essentially all P1 data in the system, scoped per case. **No P0 data.** The console's connection role is granted nothing on schema `private`, which is what makes R17 and R34 structural rather than aspirational.

## 7. API

The console is a separate web app. It never talks to Postgres directly; every write goes through `moderation-action`.

### Edge Function: `moderation-action`

**Auth:** `moderator` JWT, re-verified server-side · **Rate limit:** 60/min per moderator

```jsonc
// Request
{ "case_id": "…", "action": "suspension", "rationale": "Two confirmed no-shows in 14 days…",
  "suspended_until": "2026-09-07T00:00:00Z", "idempotency_key": "…" }
// Response 200
{ "status": "applied", "audit_event_id": 88213 }
// Response 202 — awaiting second approval
{ "status": "pending_approval", "approval_id": "…" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_moderator` | 403 | Claim missing or revoked |
| `conflict_of_interest` | 403 | Moderator is a party to the case (R06) |
| `case_claimed_by_other` | 409 | Another moderator holds the claim |
| `rationale_too_short` | 422 | < 20 characters |
| `second_approval_required` | 202 | Ban or referral proposed |
| `self_approval_forbidden` | 403 | Proposer attempted to approve |
| `suspension_too_long` | 422 | > 90 days |

### Other endpoints

| Endpoint | Purpose |
| --- | --- |
| `rpc.claim_case(case_id)` | Atomic claim with expiry; returns `case_claimed_by_other` on conflict |
| `rpc.release_case(case_id)` | Explicit release |
| `rpc.moderator_read_thread(thread_id, report_id)` | Returns messages **and** writes the audit row in one transaction (R19, R32) |
| `rpc.review_garden_submission(id, decision, reason)` | Approve/reject with rationale |
| `rpc.decide_appeal(appeal_id, outcome, rationale)` | Enforces `no_original_reviewer` |
| `GET /queues/summary` | Counts and oldest-item ages for the dashboard |

> `moderator_read_thread` returning the messages *and* writing the audit row in the same transaction is the whole design. If reads and audits were separate calls, a console bug — or a curious moderator with the network tab open — could read without recording. Here, an unaudited read is not possible.

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Dashboard | `/` | Queue counts, oldest ages, SLA breach banner, on-call indicator |
| Report queue | `/reports` | SLA-sorted, filterable by reason and severity |
| Case view | `/reports/:id` | The decision screen |
| Garden queue | `/gardens` | Photo grid with ML scores |
| Flagged messages | `/flagged` | Message plus context |
| Appeals | `/appeals` | Second-reviewer queue |
| Approvals | `/approvals` | Pending second approvals for bans and referrals |
| Audit search | `/audit` | Read-only, filter by actor, subject, action, date |

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Skeleton rows; queue counts render first from a cheap aggregate |
| Empty | "No open cases. Oldest resolved 2 hours ago." — with the honest note that empty queues are good and should not be filled |
| Error (recoverable) | Inline retry; a failed action never leaves partial state (R32) |
| Error (terminal) | Role revoked mid-session → immediate logout with an explanation |
| Offline | Read-only from cache with a hard banner; **all actions disabled** — a queued moderation action is a correctness hazard |
| Permission denied | Non-moderator hitting any route → 404, not 403. The console does not confirm its own routes to unauthorized visitors. |
| Rate limited | Action button disabled with countdown |

### 8.3 Copy

| Situation | Exact copy |
| --- | --- |
| SLA breach banner | "{n} cases past SLA. Oldest: {duration}." |
| Severity-1 page | "URGENT — unsafe meeting reported. Case {id}. Respond within 1 hour." |
| Content warning | "This case may contain descriptions of {category}. Continue?" |
| Second approval required | "Permanent bans need a second moderator. This will be sent for approval." |
| Self-approval blocked | "You proposed this action. Someone else needs to approve it." |
| Conflict of interest | "You're involved in this case and can't act on it." |
| Offline | "You're offline. You can read cases but not act on them." |
| User-facing suspension notice | "Your account is suspended until {date} for {category}. You can appeal in the app." |
| User-facing ban notice | "Your account has been permanently closed for {category}. You can appeal within 30 days." |
| Appeal acknowledgement | "We've received your appeal. A different reviewer will look at it within 5 days." |
| Wellbeing link | "Support resources" |

The user-facing notices never name the reporter, never quote the report, and never say how many reports were received — all three are re-identification vectors in a small local network.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Obtain moderator access and use it to look up the location and meeting schedule of a specific person. That is why the console has no path to P0 data, why every read is audited, and why the account requires 2FA behind an IP allowlist. A compromised moderator account is a serious incident but a bounded one. |
| **Which RLS policies enforce access?** | `app.is_moderator()` gates every moderator policy; `app.is_moderatable_thread()` scopes message access to reported or flagged threads; `reports_select_own` with the moderator branch; column-level `REVOKE` keeps `resolved_by`, `action_taken`, and `severity` from ordinary users. The console's own role has **zero** grants on `private`. |
| **Can any response path expose an exact coordinate or PII?** | No coordinate — the console role cannot reach `private.garden_locations`, and R17 forbids fetching one. PII is exposed by design, scoped per case, and every access is audited. |
| **What is logged, and is it scrubbed?** | Everything the moderator does is logged deliberately. Application telemetry from the console is scrubbed of message bodies and user identifiers before leaving the perimeter. |
| **Does this need step-up authentication?** | Yes — 2FA at login (R02), plus re-authentication before `permanent_ban` or `law_enforcement_referral`. |
| **Abuse / rate-limit controls** | R06 conflict-of-interest check, R23 two-person rule, R11 claim expiry, R33 weekly action review, and anomaly alerting on any moderator whose action volume or severity distribution deviates sharply from peers. |

**The insider threat is the main one here**, and we should be plain about it: the controls make abuse *detectable and attributable*, not impossible. R30–R33 exist so that a moderator who goes looking leaves a trail someone will read.

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Two moderators open the same case simultaneously | First `claim_case` wins; second sees `case_claimed_by_other` with the holder's name |
| EC-02 | A moderator claims a case then goes to lunch | Claim expires after 30 minutes; the case returns to the queue; a system note records the abandonment |
| EC-03 | The subject of a report is themselves a moderator | R06 blocks self-action; the case routes to admin only |
| EC-04 | Reporter and subject file mirror reports about each other | Both cases surface in the related panel; a single moderator handles both to avoid contradictory outcomes |
| EC-05 | A severity-1 report arrives at 3 a.m. | Pages on-call; if unacknowledged in 15 minutes, escalates to the T&S lead, then the CTO |
| EC-06 | Ten reports against one user in an hour (brigade) | Related-cases panel groups them; the console shows a brigade warning; volume is explicitly not evidence |
| EC-07 | A ban is proposed and the proposer leaves the company before approval | Pending approvals older than 72 hours escalate to admin |
| EC-08 | An action is taken, then the audit insert fails | The whole transaction rolls back; the moderator sees an error; nothing is applied (R32) |
| EC-09 | A moderator's role is revoked mid-case | Next request fails `not_moderator`; the session terminates; the claim releases |
| EC-10 | Appeal filed for an action taken by the only available reviewer | The appeal waits for a second reviewer rather than being decided by the original actor (R14) |
| EC-11 | A garden photo is genuinely ambiguous (a balcony with three pots) | "Request more information" path — not a rejection; the user is asked for another angle |
| EC-12 | The ML score says 0.02 but the photo is obviously a garden | The moderator overrides; the override is recorded and feeds model evaluation |
| EC-13 | A reported message has already been purged by retention | R37 should have exempted it; if the purge ran anyway, the case shows a retention gap notice — the moderator decides on the remaining evidence |
| EC-14 | A user appeals, wins, and the reporter reports again on the same facts | The duplicate is auto-linked to the overturned case and deprioritized |
| EC-15 | Console deploy fails during a severity-1 incident | Documented fallback: the T&S lead uses the break-glass read-only role to view the report and acts via a direct `moderation-action` call; the action is audited identically |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `sla_breach` | event | `report_id`, `severity`, `overdue_minutes` | **Any** severity-1 breach pages immediately |
| `queue_depth` | gauge | `queue`, count | Reports > 50, or oldest > 18 h |
| `time_to_first_action` | histogram | by severity | p50 > 6 h (standard), p50 > 20 min (severity 1) |
| `moderator_action` | audit | actor, action, subject | — |
| `moderator_thread_read` | audit | moderator, thread, report | Any read with a null `report_id` → page |
| `unaudited_read_attempt` | event | — | **Any occurrence pages.** This should be structurally impossible; if it fires, something is very wrong. |
| `action_reversal_rate` | gauge | per moderator, 30 d | > 15% suggests a training or calibration problem |
| `second_approval_latency` | histogram | hours | p95 > 24 h |
| `appeal_overturn_rate` | gauge | 30 d | > 25% suggests the original bar is wrong |
| `moderator_severity1_hours` | gauge | per moderator per day | > 2 h consecutive → rotation prompt (R37) |

## 12. Accessibility

- Full keyboard operation: `j`/`k` to move through the queue, `Enter` to open, `a` to act, `Esc` to close. Moderators work this tool for hours and a mouse-only UI is both slow and an RSI risk.
- Visible focus indicators throughout; focus is trapped in action modals and returned to the triggering row on close.
- SLA state is conveyed by text and icon, never colour alone — a red row means nothing to a colour-blind moderator.
- Live region announces queue changes politely; it never interrupts a moderator mid-decision.
- All images carry alt text describing their role ("garden verification photo, submission 4 of 12"), and the blur-to-reveal control is keyboard operable.
- Text scales to 200% without horizontal scrolling.
- Contrast meets WCAG 2.2 AA at minimum; the dashboard's status colours meet AAA because they are glanced at constantly.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01 | Non-moderator JWT is rejected on every route |
| T02 | integration | R02 | Moderator without TOTP enrolled cannot authenticate |
| T03 | integration | R03 | Session expires at 8 h and at 30 min idle |
| T04 | integration | R05, R07 | Role change is audited; revocation terminates access |
| T05 | integration | R06 | Moderator who is the reporter gets `conflict_of_interest` |
| T06 | integration | R08, R10 | Queue order matches `sla_due_at`; standard reports get 24 h |
| T07 | integration | R09 | `unsafe_meeting` gets severity 1, 1 h SLA, and pages |
| T08 | integration | R11 | Concurrent `claim_case` — exactly one succeeds; claim expires at 30 min |
| T09 | integration | R12 | Garden queue ordering and ML label presence |
| T10 | integration | R13 | Flagged message returns exactly 10 messages of context |
| T11 | integration | R14 | Appeal cannot route to the original actor |
| T12 | integration | R16, R18 | Case view assembles all required context in one response |
| T13 | integration | R19 | `moderator_read_thread` returns messages **and** writes audit atomically |
| T14 | integration | R22 | Rationale under 20 characters is rejected |
| T15 | integration | R23 | Ban requires a second approver |
| T16 | integration | R24 | Suspension over 90 days is rejected |
| T17 | integration | R25 | Notification omits reporter identity |
| T18 | integration | R26 | Resolution fields are set atomically |
| T19 | integration | R28 | Reversal creates a new audit event; the original is unchanged |
| T20 | rls | R31 | `UPDATE` and `DELETE` on `audit.events` fail for every role |
| T21 | integration | R33 | Weekly report generates with a per-moderator distribution |
| T22 | e2e | R35, R36 | Content warning gates the case; images render blurred |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T23 | Console role attempts any read of `private.garden_locations` | Permission denied at the database — no grant exists |
| T24 | Case view response is scanned for coordinate-shaped values | None present, across 200 generated cases |
| T25 | Moderator reads a thread with no open report and no flag | `app.is_moderatable_thread()` false → empty set |
| T26 | Moderator reads a thread and the audit insert is forced to fail | Whole transaction rolls back; no messages returned (T13's inverse) |
| T27 | Proposer approves their own ban | `self_approval_forbidden`; `no_self_approval` CHECK also rejects at the database |
| T28 | Revoked moderator replays a valid unexpired JWT | Server-side role re-verification rejects; JWT claim alone is insufficient |
| T29 | Non-moderator requests `/reports/:id` | 404, not 403 — no route confirmation |
| T30 | Direct `POST` to `moderation-action` bypassing the console UI | Same server-side checks apply; UI is not a security boundary |
| T31 | Moderator attempts to write into a user message thread | Denied ([SPEC-011-R35](SPEC-011-messaging.md)) |
| T32 | Moderator attempts an action on a case where they are the subject | `conflict_of_interest` |
| T33 | Replay of the same `idempotency_key` on an action | Exactly one effect; the second call returns the first result |
| T34 | SQL injection in the rationale field | Stored literally; parameterized |
| T35 | XSS payload in a user-generated field rendered in a case view | Escaped; console renders text, never HTML |
| T36 | Offline moderator queues an action, then reconnects | No queued action exists — actions are disabled offline by design |
| T37 | Appeal decided by the moderator who took the original action | `no_original_reviewer` CHECK rejects |
| T38 | Enumeration of case ids by a valid moderator outside their assignment | Permitted (moderators may see all cases) but every view is audited — the test asserts the audit rows exist |

### 13.3 Manual QA

- [ ] Full keyboard-only pass through triage, decision, and approval
- [ ] Screen-reader pass over the dashboard, queue, and case view
- [ ] Verify a severity-1 report pages within 60 seconds, end to end, including the escalation chain
- [ ] Verify no console screen renders a coordinate, by inspecting network responses as well as the DOM
- [ ] Confirm user-facing notices never reveal the reporter
- [ ] Walk the EC-15 fallback procedure with the T&S lead

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | None. The console is not user-facing and ships with the backend. |
| Migration required | Yes — `moderation_cases`, `moderation_approvals`, `appeals`, indexes |
| Backfill required | No |
| Rollback plan | Redeploy the previous console build. Database objects are additive. The EC-15 fallback covers a total console outage. |
| Client version floor | Not applicable |
| **Launch gate** | The console must be operable **and** a named human must be on the SLA rota before MVP submission. Both are release gates in the [PRD §7](../00-foundation/02-prd.md). |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | What is the actual on-call rota at launch — one person with a phone, or a shared inbox with a paging integration? The submission asserts a 24h process exists. | T&S lead | Before submission |
| Q2 | At what report volume does a part-time moderator stop sufficing? Proposed trigger: sustained > 20 reports/day. | T&S lead | Before launch |
| Q3 | Should law-enforcement referrals require counsel sign-off in addition to the second moderator? | Legal | Before launch |
| Q4 | Do we need a formal transparency report, and at what cadence? | Legal + Product | 6 months post-launch |
| Q5 | Retention for moderator rationales — they contain P1 data about both parties and currently inherit the 3-year report retention. | Legal | Before launch |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Trust & Safety + Platform Engineering | Initial spec |
