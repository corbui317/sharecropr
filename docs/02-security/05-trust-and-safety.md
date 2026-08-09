# Trust & Safety Policy

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Trust & Safety

The policy layer. Mechanics are in [SPEC-012](../03-specs/SPEC-012-trust-and-safety.md) and [SPEC-900](../03-specs/SPEC-900-moderation-console.md); this defines what the rules are, how they are enforced, and what happens when something goes badly wrong in the physical world.

---

## 1. The premise

Sharecropr arranges meetings between strangers. Every other trust-and-safety decision follows from taking that seriously.

The bar is not "comparable to other marketplaces." It is: **would we be comfortable explaining this policy to a journalist after an incident?** If a control exists mainly to look responsible rather than to reduce harm, it should be removed and replaced with one that works.

---

## 2. Community guidelines

Written to be read, not to be enforceable in court. These are the user-facing rules verbatim.

> **Meet at safe spots.** Every exchange happens at a place on the map — a library, a town hall, a community centre. Not at your home, not at theirs. This is the rule that makes everything else work.
>
> **No money.** Sharecropr is trade only. Nobody should ever ask you to pay for anything, and if they do, report it.
>
> **Be who you say you are.** One account, your real identity, your own garden.
>
> **Show up, or say you can't.** Cancelling is fine. Not showing up wastes someone's afternoon.
>
> **Describe your crops honestly.** Say what it is, how much, and what condition it's in. If it's bruised, say so.
>
> **Be decent.** No harassment, threats, hate speech, or sexual content. No contacting someone after they've stopped replying.
>
> **This is food.** Don't offer anything you wouldn't eat. Tell people about pesticides, allergens, and anything else they'd want to know.
>
> **Nobody under 18 trades here.**

### 2.1 Prohibited absolutely

Threats or violence · sexual content or solicitation · content sexualizing minors · hate speech targeting a protected characteristic · doxxing · impersonation · selling anything · non-produce goods · alcohol, cannabis, tobacco, or foraged wild mushrooms · anything requiring a licence to distribute · commercial-scale operations posing as home gardens.

> **Foraged wild mushrooms are prohibited outright**, while cultivated mushrooms are fine. Misidentification is a fatal-outcome error, we have no capacity to verify identification, and there is no version of this we can do responsibly.

---

## 3. Enforcement ladder

| Rung | Action | Trigger | Duration | Appealable |
| --- | --- | --- | --- | --- |
| 1 | **No action** | Report unfounded | — | — |
| 2 | **Educational notice** | First minor issue — vague listing, sharing an address in chat | — | No (not a penalty) |
| 3 | **Warning** | First substantiated violation | Recorded 12 months | Yes |
| 4 | **Content removal** | Specific listing or message violates the rules | Permanent for that content | Yes |
| 5 | **Feature restriction** | Repeated no-shows or late cancellations | 14–30 days, cannot send requests | Yes |
| 6 | **Suspension** | Second substantiated violation, or one serious one | 7 / 30 / 90 days | Yes |
| 7 | **Permanent ban** | Severe single violation, or a third substantiated one | Permanent | Yes, within 30 days |
| 8 | **Law-enforcement referral** | Credible threat, assault, or content involving a minor | — | No |

### 3.1 Straight to rung 7 or 8

No ladder, no warning: threats of violence · assault at an exchange · sexual content involving a minor · any grooming behaviour · doxxing another user · a credible attempt to lure someone away from a safe spot · impersonating Sharecropr staff · a second account after a ban.

### 3.2 Requirements on every action

- **Rungs 7 and 8 require two moderators.** The proposer cannot approve their own proposal ([SPEC-900-R23](../03-specs/SPEC-900-moderation-console.md)).
- Every action requires a written rationale of at least 20 characters.
- The user is told the *category* of violation and the appeal path, never the reporter's identity, never the number of reports, never a quotation from a report. In a small local network, all three are re-identification vectors.
- Every action is audited immutably.

### 3.3 What we will not do

- **No automated enforcement.** ML ranks the queue; humans decide. An automated ban is an appeal we cannot explain.
- **No shadowbanning.** If someone's content is hidden, they are told. Shadowbans are a support nightmare and, applied wrongly, indefensible.
- **No enforcement based on report volume alone.** Brigading is a real tactic; a pile of reports is a signal to look, not a verdict.
- **No "safety" claims we can't back.** We never say a user is safe, only that they are ID-verified.

---

## 4. Reports and SLAs

| Reason | Severity | SLA | Routing |
| --- | --- | --- | --- |
| `unsafe_meeting` | **1** | **1 hour** | **Pages on-call.** Escalates to T&S lead at 15 min unacknowledged, then to the CTO. |
| `harassment` | 2 | 24 h | Queue, priority |
| `impersonation` | 2 | 24 h | Queue, priority |
| `underage` | **1** | **1 hour** | Pages on-call; immediate suspension pending review |
| `misrepresented_goods` | 3 | 24 h | Queue |
| `no_show` | 4 | 24 h | Queue; auto-correlated with session state |
| `spam` | 4 | 24 h | Queue |
| `other` | 3 | 24 h | Queue, triaged first |

Reporting is available from every user, listing, message, and exchange, and is never more than two taps away — an App Store Guideline 1.2 requirement and, more to the point, the thing a frightened person needs to find quickly.

Reporters are told their report was received and, when it is resolved, that it was resolved. They are never told what action was taken — a reporter who learns their target was banned has a retaliation opportunity.

---

## 5. Appeals

| Property | Value |
| --- | --- |
| Who | Anyone who received rung 3 or above |
| Window | 30 days |
| Reviewer | **Never the original actor** — enforced by a database constraint, not by process |
| SLA | 5 business days |
| Outcome | Upheld or overturned, with a plain-language reason |
| Second appeal | Only with genuinely new information |

An overturn rate above 25% over 30 days triggers a calibration review — the problem is our bar, not the appellants.

---

## 6. Safe-spot conduct

| Expectation | Rationale |
| --- | --- |
| Meet during the venue's open hours | Stale hours are the top cause of no-shows; hours older than 90 days are flagged |
| Stay in the public area | The lobby, not the back of the lot |
| Don't obstruct the venue's operation | We are guests, and a library that finds us disruptive delists itself |
| Don't linger | It is a handoff, not a social event |
| Leave if uncomfortable | **Always the right call.** Cancelling for this reason is never penalized. |

**The venue is not a partner unless we've asked.** Listing a library does not make it responsible for anything, and copy never implies staff supervision or endorsement. Any venue asking to be removed is removed within 48 hours, no negotiation — this is both correct and the only way the partnership programme survives.

---

## 7. After a real-world incident

The situation this whole architecture exists for. **This is the section to read first when it happens.**

### 7.1 Immediate — first hour

1. **Preserve everything.** Freeze the session, its thread, both accounts' data, and all related records. Set a legal hold that overrides every retention job.
2. **Separate the parties.** Bidirectional block, all shared context removed, no notifications between them.
3. **Suspend pending review** if there is any credible allegation of harm. We suspend first and investigate second; the cost of a wrongly suspended account is hours, and the cost of the alternative is not.
4. **Page the T&S lead and the CEO.** Not a queue. Not an email.
5. **Contact the reporting user** — a human, by phone if they'll take a call. Ask what they need. Do not ask them to fill in a form.

### 7.2 First 24 hours

6. Engage counsel before any external statement.
7. Preserve for law enforcement: audit trail, session record, thread, both profiles, verification references. Do **not** volunteer data absent a valid legal process, except where there is an imminent threat to life.
8. Assess whether other users are at risk from the same actor, and check for a pattern across earlier reports.
9. Notify insurers.
10. Prepare a holding statement. Do not speculate publicly. Do not describe the incident. Do not say "isolated" before you know.

### 7.3 First week

11. Blameless post-mortem covering the product, not just the incident: what did the design make easy that should have been hard?
12. Decide on a product change, and be willing to make an expensive one.
13. Support for the moderators who handled it.
14. Decide on public disclosure with counsel — bias toward telling users something true rather than nothing.

### 7.4 What we do not do

Blame the user for meeting someone. Claim our verification prevents harm. Delete anything. Discourage anyone from contacting the police. Offer compensation as a condition of silence.

---

## 8. Law-enforcement requests

| Request | Response |
| --- | --- |
| Informal / no legal process | Refused, politely, with an explanation of the correct process |
| Subpoena or court order | Reviewed by counsel; narrowest compliant response; user notified unless legally barred |
| Emergency disclosure (imminent threat to life) | Expedited, documented, counsel notified within 24 h, user notified after the emergency |
| **Exact garden coordinates** | **Break-glass only** — two-person authorization, 60-minute window, fully audited ([Location Privacy §10](../01-architecture/04-location-privacy.md)) |

Every request is logged, and the count is reported in any transparency reporting we publish.

---

## 9. Moderators

### 9.1 Training

Before touching a live queue: the guidelines and their intent; the enforcement ladder with worked examples; bias awareness, especially around name, language, and photo cues; the escalation path; the audit expectation; and the two-person rule. Calibration sessions monthly, with sample cases scored against the lead.

### 9.2 Wellbeing

| Control | Rule |
| --- | --- |
| Content warnings | Category stated before any distressing case is opened |
| Image blur | Default on, click to reveal |
| Rotation | No more than 2 consecutive hours on the severity-1 queue |
| Support | Resources one click from every case view |
| Debrief | Mandatory after any incident involving physical harm |
| Volume | Case-per-hour targets are **not** a performance metric |

Rushing this work produces bad decisions on exactly the material where bad decisions are most costly. Speed is not the goal; the SLA is a floor for responsiveness, not a productivity target.

---

## 10. Metrics

| Metric | Target | Meaning |
| --- | --- | --- |
| Severity-1 first response | < 15 min | The number that matters most |
| Standard SLA compliance | > 95% | Our public commitment |
| Reports per 1,000 exchanges | Baseline in month 1 | Trend, not level |
| Appeal overturn rate | < 15% | Calibration health |
| Repeat-offender rate | < 5% | Whether enforcement sticks |
| **Assaults per 1,000 exchanges** | **0** | Existential |
| No-shows per 1,000 exchanges | < 2 | Product health |
| Address-sharing flag rate | Baseline, then monitor | Whether safe-spot-only is working ([R-09](../06-roadmap/02-open-risks.md)) |

---

## 11. Pre-launch gates

**Blocking. MVP does not ship without all of these.**

- [ ] Community guidelines published and linked from signup
- [ ] A **named human** on the severity-1 rota, with a working paging path tested end to end
- [ ] Moderation console operable ([SPEC-900](../03-specs/SPEC-900-moderation-console.md))
- [ ] Incident-response playbook (§7) reviewed and signed off by counsel
- [ ] **Liability insurance in force**, with the policy reviewed against the actual product
- [ ] Law-enforcement request procedure documented, with a named point of contact
- [ ] Moderator training completed and calibration run at least once
- [ ] Safe-spot venue-consent and takedown procedure agreed
- [ ] Appeals process live before the first enforcement action
- [ ] Escalation chain tested with a drill, not just written down

> **§7 and the insurance line are the ones most likely to be deferred under launch pressure, and they are the two that matter most.** Everything else can be improved after launch. These cannot be improvised at 2 a.m. on the day something happens. [R-03](../06-roadmap/02-open-risks.md).

---

## 12. Open questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Does a no-show auto-file a report, or only prompt one? Auto-filing inflates the queue; prompting under-reports. | T&S | Before launch |
| Q2 | Do we publish a transparency report, and when? | Legal + Product | 6 months post-launch |
| Q3 | Is a 30-day appeal window right for a permanent ban? | Legal | Before launch |
| Q4 | At what report volume does a part-time moderator stop sufficing? Proposed trigger: sustained > 20/day. | T&S lead | Before launch |
| Q5 | What is our public position if a serious incident occurs — full disclosure, or counsel-minimal? Decide **now**, not during. | CEO + Legal | Before launch |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Trust & Safety | Initial policy |
