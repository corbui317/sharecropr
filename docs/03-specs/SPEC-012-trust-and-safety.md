# SPEC-012: Trust & Safety — Ratings, Reports, Blocks

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.0 |
| **Owner** | Trust & Safety + Backend Engineering |
| **Phase** | MVP |
| **Security review** | required |
| **Schema depends on** | [SPEC-003](SPEC-003-identity-verification.md), [SPEC-010](SPEC-010-exchange-lifecycle.md), [SPEC-011](SPEC-011-messaging.md) |
| **Behaviourally coupled with** | SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-900 |
| **Related ADRs** | [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md), [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

Three mechanisms cover the entire distance between "two strangers agreed to meet at a library" and "one of them should not be here any more": **ratings**, which are double-blind so that the fear of retaliation cannot bend them; **reports**, which are severity-graded so that `unsafe_meeting` pages a human inside an hour instead of joining a 24-hour queue; and **blocks**, which are immediate, silent, and enforced by RLS so that a blocked person does not disappear from a list — they never enter the result set. The internal **trust score** binds the three together and is never shown as a number, only as a coarse tier, because a visible score is a score people optimize instead of a signal we can use. This spec is where a physical-safety product either has a working immune system or merely has a reporting button that satisfies [App Store Guideline 1.2](../00-foundation/02-prd.md).

## 2. Goals

- Make retaliation structurally impossible rather than discouraged: neither party can see the other's rating before their own is locked, and the window to rate closes at the moment of reveal.
- Give `unsafe_meeting` a path that does not pass through a queue, because the meeting may still be happening.
- Make a block a database fact — thread closed, session cancelled, requests cancelled, mutual invisibility — completed in one transaction, with nothing left for a client to filter.
- Make the blocked user's experience indistinguishable from ordinary attrition, deliberately, because notifying someone they were blocked is the single best-documented escalation trigger in intimate-partner harassment.
- Keep the trust score internal, unreadable by anyone including its own subject, and keep its only public projection a four-value tier.
- Preserve evidence at report time, because the subject of a report can withdraw a listing, delete an item, and let a thread age out before a moderator opens it.
- Ensure every safety action remains available to users who have lost the ability to transact — suspended, unverified, expired — because getting *out* is never the thing you gate.
- Be explicit about the four abuse cases we expect (rating extortion, mass-reporting brigades, block-as-griefing, sockpuppet re-registration) and about which control answers each.

## 3. Non-Goals

- **Public reviews, review text on profiles, or a review feed.** `ratings.comment` is read by moderators and by the ratee, never rendered on a `profile_cards` surface. Public prose reviews turn every low rating into a negotiation and every profile into a reputation-management project.
- **Rating a listing, an item, or a safe spot.** Ratings attach to an `exchange_sessions` row and to a person. Safe-spot quality feedback is [SPEC-007](SPEC-007-safe-spots.md); produce quality is a `misrepresented` tag on the person who described it.
- **Editing, deleting, or responding to a rating.** All three reopen the retaliation channel double-blindness closes (R09). A wrong rating is a report.
- **Numeric trust scores, percentile ranks, leaderboards, or "top trader" surfaces.** [SPEC-022](SPEC-022-gamification.md) is Phase 3 and will have to argue with §5.5 before it ships anything ordered by reputation.
- **Automated punitive action on report volume.** No count of reports, from any number of accounts, results in a suspension without a human. This is the entire defence against a brigade (R55).
- **Appeals adjudication.** The appeals *queue* and the two-person requirements live in [SPEC-900](SPEC-900-moderation-console.md); this spec only guarantees that every action except a law-enforcement referral is reversible and that a reversal restores what it can.
- **Identity-graph analysis, device fingerprinting SDKs, or shadow profiles.** The sockpuppet control (R59) is a hash of a vendor identity reference we already retain for seven years, and nothing more. A fingerprinting SDK is a privacy liability that would have to justify itself against [Location Privacy §12](../01-architecture/04-location-privacy.md).
- **In-app emergency services integration, panic buttons, or live location sharing.** All three require background location, which MVP does not request ([PRD §5](../00-foundation/02-prd.md)), and a panic button that quietly fails is worse than no panic button. Safe-spot choice is the safety mechanism ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)).
- **Moderating content before it is posted.** `content-scan` is asynchronous and advisory ([API Contract §6.5](../01-architecture/06-api-contract.md)); a synchronous filter puts a vendor's latency budget in the middle of "I'm ten minutes late".

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener who just completed an exchange**, I want to rate honestly without worrying about what they'll write back, so that my rating reflects what happened. | P0 |
| US-02 | As a **gardener**, I want to know that a low rating I give can't be answered with a revenge rating, because otherwise I'll just give five stars to everyone. | P0 |
| US-03 | As a **requester who was stood up**, I want the no-show to count, even if the other person never rates me. | P0 |
| US-04 | As a **person who felt unsafe at a handoff**, I want a human to see that within the hour, not tomorrow. | P0 |
| US-05 | As a **reporter**, I want to know my report was received and closed, without being told what happened to the other person. | P0 |
| US-06 | As a **person being harassed**, I want one tap to make them disappear, everywhere, immediately. | P0 |
| US-07 | As a **person being harassed**, I want them to *not be told* that I blocked them. | P0 |
| US-08 | As a **blocker**, I want to know exactly what my block just did — which exchange it cancelled — so I'm not surprised at a library tomorrow. | P0 |
| US-09 | As a **new user**, I want to understand what someone's badge means before I agree to meet them. | P1 |
| US-10 | As a **user with no exchanges yet**, I don't want to look untrustworthy just because I'm new. | P1 |
| US-11 | As a **moderator**, I want the evidence as it was when it was reported, not as it is after the subject tidied up. | P0 |
| US-12 | As a **user who was reported dishonestly**, I want the outcome to depend on a human reading the thread, not on how many friends the reporter has. | P0 |
| US-13 | As a **banned user's target**, I want the ban to survive them making a new account. | P0 |
| US-14 | As a **screen-reader user**, I want the rating control and the block confirmation to be operable and unambiguous, because these are the two controls where a mis-tap matters most. | P0 |

## 5. Functional Requirements

### 5.1 Ratings — eligibility, shape, and immutability

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | A rating MUST reference an `exchange_sessions` row whose `state = 'completed'`. `submit_rating` on any other state returns `invalid_transition` 409. A no-show is rated through the report path, not the rating path — the session never reaches `completed` and there is nothing to rate. |
| R02 | **MUST** | `rater_id` MUST be `auth.uid()` and MUST be one of `(owner_id, requester_id)`. `ratee_id` MUST be **derived inside the function** as the other participant and MUST NOT be accepted from the client. A client-supplied `ratee_id` is a one-star rating pointed at an arbitrary stranger. |
| R03 | **MUST** | `ratings_one_per_rater` — `UNIQUE (session_id, rater_id)` ([Data Model §11](../01-architecture/03-data-model.md)) — MUST exist and MUST be the enforcement of one-rating-per-rater, not a client check. |
| R04 | **MUST NOT** | A user MUST NOT rate themselves. `no_self_rating CHECK (rater_id <> ratee_id)` plus the R02 derivation makes it unreachable by construction as well as by constraint. |
| R05 | **MUST** | `stars` MUST be an integer 1–5 (`CHECK`). No half stars, no zero, no "not applicable". |
| R06 | **MUST** | `tags` MUST be drawn from the closed vocabulary `punctual`, `as_described`, `friendly`, `late`, `no_show`, `misrepresented` and from nothing else, enforced by `CHECK (tags <@ ARRAY[...])`. There is no free-text tag path and no "add your own". |
| R07 | **MUST** | `comment` MUST be optional and ≤ 300 characters (`CHECK`). It is shown to the ratee after reveal and to moderators; it is never rendered on a profile (§3). |
| R08 | **MUST** | The rating window MUST close at the moment of reveal. A `submit_rating` call against a session whose ratings are already revealed returns `invalid_transition` 409 with the copy in §8.3. **This is the load-bearing rule**: a rater who can see the other's rating before writing their own is not blind, and a 7-day reveal with a 14-day window would be double-blindness with a hole cut in it. |
| R09 | **MUST NOT** | A rating MUST NOT be editable or deletable by anyone, including its author, including before reveal. There is no `UPDATE` or `DELETE` policy on `ratings` for `authenticated`. An editable rating is a negotiable rating, and a negotiable rating is what extortion needs (R54). |
| R10 | **MUST** | Rating MUST be optional. A user who never rates MUST suffer no score penalty, no nag beyond one inbox item and one prompt, and no reduction in any surface. |
| R11 | **SHOULD** | On completion, both parties SHOULD receive an inbox item linking to `/(modals)/rate/[sessionId]`, and the exchange row SHOULD carry a "Rate this exchange" affordance until the window closes. Neither SHOULD push at the 2 a.m. completion of a late handoff. |

### 5.2 Double-blind reveal

| ID | Req | Statement |
| --- | --- | --- |
| R12 | **MUST** | `is_revealed` MUST default to `false` and MUST be flipped only by `app.reveal_session_ratings(session_id)`, called from an `AFTER INSERT` trigger on the second rating or from the hourly `reveal_ratings` job. `ratings` MUST have no client `UPDATE` policy, so there is no path by which a rater flips their own row. |
| R13 | **MUST** | `ratings_select_participant` MUST read: the rater always sees their own row; the ratee sees a row only when `is_revealed = true`; a moderator sees everything; everyone else sees nothing. Non-participants get zero rows, not a filtered subset. |
| R14 | **MUST** | Reveal MUST occur at the **earlier** of (a) both participants having submitted — same transaction as the second insert — and (b) 7 days after `exchange_sessions.completed_at`, by the hourly job ([Exchange State Machine §7](../01-architecture/07-exchange-state-machine.md)). |
| R15 | **MUST** | A session in which only one party rated MUST still reveal at 7 days, and that single rating MUST count toward the ratee's aggregate. Withholding a rating MUST NOT suppress the other one — otherwise "don't rate back" becomes the standard way to nullify a bad rating, and everyone learns it in a week. |
| R16 | **MUST NOT** | No aggregate, badge, tier, or count on either participant's profile MUST change between submission and reveal. `rating_avg`, `rating_count`, and `trust_score` MUST be recomputed **only over revealed rows**. A profile average that moves the instant your counterparty submits is a side channel that leaks the hidden rating to anyone watching. |
| R17 | **MUST** | `profile_cards.rating_avg` MUST be `NULL` until `rating_count >= 3`, and the client MUST render "New here" rather than a number. Below three ratings the average is arithmetic that recovers each individual rating exactly, which makes double-blindness cosmetic and identifies the rater by elimination. |
| R18 | **MUST** | Reveal and aggregate recomputation MUST happen in one transaction. A revealed rating that has not yet moved the average, or an average that moved before the reveal, are both observable states and both leak. |
| R19 | **MUST NOT** | Nothing MUST tell a user that their counterparty has submitted a rating: no notification, no badge, no "waiting for them" state, no difference in the rate screen. The only notification is at reveal, to both, identically. "They've rated you — rate them back to see it" is a pressure mechanic and a timing oracle in one string. |

### 5.3 Reports

| ID | Req | Statement |
| --- | --- | --- |
| R20 | **MUST** | The report sheet MUST offer exactly **six** reasons, each with one line of plain description: `no_show`, `misrepresented_goods`, `harassment`, `unsafe_meeting`, `spam`, `impersonation`. `details` is optional free text ≤ 1000 characters. |
| R21 | **MUST NOT** | `other` and `underage` MUST NOT be selectable by a user. `other` is a bucket that absorbs 40% of reports and tells a moderator nothing; `underage` is an accusation a user is not positioned to make and is a ready-made harassment vector. Both remain in the `report_reason` enum ([Data Model §4](../01-architecture/03-data-model.md)) and are reachable **only** as a moderator reclassification in [SPEC-900](SPEC-900-moderation-console.md). |
| R22 | **MUST** | `severity` MUST be assigned server-side inside `create_report`, from `(reason, subject_type, subject's open-report history)`, and MUST NOT be accepted from the client. A client-supplied severity is a self-declared SLA, and the first person to find it will set every report to 1. |
| R23 | **MUST** | `reason = 'unsafe_meeting'` MUST force `severity = 1` and `sla_due_at = created_at + interval '1 hour'`, enforced by a `BEFORE INSERT` trigger **and** by a `CHECK` that rejects any row where `reason = 'unsafe_meeting' AND severity <> 1`. Every other reason defaults to `severity = 3` and a 24-hour SLA ([PRD C12](../00-foundation/02-prd.md)). |
| R24 | **MUST** | A `severity = 1` report MUST **page on-call rather than queue**. `create_report` writes `private.oncall_pages` in the same transaction as the report; a 60-second `pg_cron` job drains it to the paging provider. The transactional-outbox shape is deliberate and identical to notifications ([Realtime & Notifications §3](../01-architecture/08-realtime-and-notifications.md)): an HTTP call cannot live inside the transaction, and a page that is lost because a process died is the one page that matters. |
| R25 | **MUST** | The `create_report` response MUST be `{ report_id, filed_at }` and MUST be byte-identical in shape and timing characteristics regardless of reason. It MUST NOT return `sla_due_at`, because a 1-hour due date is a disclosure that this report escalated and a 24-hour one is a disclosure that it did not. *(This contradicts [API Contract §5.5](../01-architecture/06-api-contract.md), which returns `sla_due_at` while also asserting the response never differs by reason — see Q1.)* |
| R26 | **MUST** | `create_report` MUST snapshot the subject into `private.report_evidence` in the same transaction: for a message, the thread's last 50 bodies with senders and timestamps; for a listing, its title, description, species, safe-spot set, and media paths; for a session, its times, safe spot, participants, and state history; for a user, their `profile_cards` projection. The subject can withdraw a listing, archive an item, and let a thread close long before a moderator opens the report, and a report about content that no longer exists is a report that gets dismissed. |
| R27 | **MUST** | `private.report_evidence` MUST live in `private`, MUST be readable only through `app.get_report_evidence(report_id)` (moderator-gated, audited), MUST be retained for 3 years from resolution ([Data Model §14](../01-architecture/03-data-model.md)), and MUST NOT contain any coordinate other than a `safe_spot_id`. |
| R28 | **MUST** | The reporter MUST be able to read their own report row via `reports_select_own`, and MUST NOT be able to read `resolved_by`, `action_taken`, or `severity` — enforced by column `REVOKE` ([RLS Design §5 Pattern E](../01-architecture/05-rls-design.md)), not by a select list. |
| R29 | **MUST NOT** | The subject of a report MUST NOT be able to see the report, its existence, its reason, its reporter, or its count, ever, through any surface. No policy grants it, no notification names it, and `moderation_outcome` copy never quotes it. |
| R30 | **MUST** | On resolution, the reporter MUST receive a `moderation_outcome` notification drawn from a fixed set of two strings — "reviewed, action taken" and "reviewed, no action" — that never discloses which action, whether the account still exists, or anything about the subject. |
| R31 | **MUST** | One open report per `(reporter_id, subject_id, reason)`, enforced by a partial unique index; a duplicate returns `conflict` 409 and the client renders it as success. Re-reporting the same thing does not make it more urgent, and letting people believe it does produces a queue made of one incident. |
| R32 | **MUST** | `create_report` MUST be limited to 10/day/user ([API Contract §7.2](../01-architecture/06-api-contract.md)), and moderators MUST be able to raise the limit for an individual user who is being genuinely and repeatedly victimized. |
| R33 | **MUST NOT** | Filing a report MUST NOT block, and blocking MUST NOT file a report. The sheet offers both as adjacent, independent actions with a checkbox that is **off by default**, because a person who reports a stranger's spam listing does not necessarily want their profile hidden, and a person who blocks an ex does not necessarily want to write a statement. |
| R34 | **SHOULD** | The report entry point SHOULD exist on every surface carrying another user's content: profile, listing detail, message thread (per message and per thread), and session detail. A safety control that is only in one place is a safety control most people cannot find under stress. |

### 5.4 Blocks

| ID | Req | Statement |
| --- | --- | --- |
| R35 | **MUST** | `create_block` MUST take effect at commit, with no propagation delay, and MUST be enforced by RLS policy rather than by any client filter ([RLS Design RLS-7](../01-architecture/05-rls-design.md)). Blocked content does not get removed from a response; it never enters the result set. |
| R36 | **MUST** | A block MUST be **one-directional as an action and bidirectional in effect**, via `app.is_blocked_either_way(a, b)`. A user does not need to be told to block back, and a one-way block leaves the blocker's content visible to the person they are hiding from. |
| R37 | **MUST** | `on_block_created` MUST, in the same transaction as the `blocks` insert: cancel every `scheduling`/`scheduled` session between the pair; cancel every `pending` `exchange_requests` row in both directions; set `message_threads.is_closed = true`; and write `audit.events` ([RLS Design §6](../01-architecture/05-rls-design.md)). |
| R38 | **MUST** | Mutual invisibility MUST hold across **all** of: `listings` (`listings_select_discoverable`), `profile_cards` (view predicate), safe-spot listing counts (`safe_spots_near`'s inner `NOT app.is_blocked_either_way`), `search_listings`, `suggest_matches`, `exchange_requests` (`requests_select_participant`), `messages` (`app.is_thread_participant` returns false on a closed thread), and `ratings`. A surface added later without the predicate is a regression, and T63 is the sweep that catches it. |
| R39 | **MUST NOT** | The blocked user MUST NOT be told, inferable, or able to distinguish. No notification, no changed error code, no altered timing, no visible state. Content simply stops being there, exactly as it would if the other person had deleted their account, expired their listings, or lost interest. **This is a deliberate harassment-escalation mitigation, not an oversight**: "X has blocked you" is a confirmed trigger in intimate-partner and stalking cases, and the cost of the ambiguity — a confused ordinary user who thinks the app is buggy — is a cost we accept knowingly and every time. |
| R40 | **MUST** | The **blocker** MUST be told exactly what the block did: `{ blocked: true, sessions_cancelled: int, thread_closed: bool }`, rendered as the copy in §8.3. Someone who blocks a counterparty an hour before a handoff must not find out at the library. |
| R41 | **MUST** | `create_block` MUST remain available to a user who is suspended, unverified, un-onboarded, or past verification expiry. It does **not** call `app.can_transact()`. Gating a safety action on eligibility to trade is how a suspended harasser's target ends up unable to hide from them. |
| R42 | **MUST** | `remove_block` MUST exist, MUST NOT restore the cancelled session, cancelled requests, or closed thread, and MUST be limited to **10/day/user** while `create_block` remains at 30/day. The asymmetry is intentional: blocking is nearly unlimited, unblocking is not, and re-blocking is always immediate and never limited. |
| R43 | **MUST NOT** | A block MUST NOT delete, hide, or redact `audit.events`, `private.report_evidence`, `reports`, or `ratings` rows involving the pair. Blocking is a visibility control, not evidence destruction, and a moderator investigating a report must still be able to read the thread that produced it. |
| R44 | **MUST** | When a session is cancelled **because of a block**, `exchange_sessions.cancelled_reason` MUST be set to the generic `'cancelled_by_participant'`, and the true cause MUST be written to `private.session_cancellation_causes` for moderators only. The existing `on_block_created` sets `cancelled_reason = 'blocked'` on a column both participants can read ([RLS Design §6](../01-architecture/05-rls-design.md)); a blocked user issuing `select=cancelled_reason` on their own session row would read the word "blocked" and R39 would be defeated by a query nobody had to be clever to write. **This spec amends that trigger.** |
| R45 | **MUST** | The block confirmation MUST state, before the user commits, what will happen — that the exchange will be cancelled, that the conversation will close, and that the other person is not told — and MUST require an explicit second tap. A block is not undoable in its effects (R42). |
| R46 | **SHOULD** | A blocked-users list SHOULD exist at `/profile/blocked`, SHOULD show handle and display name only, and SHOULD offer unblock with a confirmation that says plainly that nothing cancelled comes back. |

### 5.5 Trust tiers and the trust score

| ID | Req | Statement |
| --- | --- | --- |
| R47 | **MUST** | `trust_score` MUST be an internal composite of exactly four inputs — verification level, completed exchanges, revealed rating average, and 90-day cancellation rate — computed by `app.recompute_trust_score(user_id)` and refreshed by the nightly `recompute_trust` job plus on completion, on cancellation, and on rating reveal. |
| R48 | **MUST NOT** | `trust_score` MUST NEVER be returned to any client, in any form: not raw, not rounded, not bucketed beyond the tier, not as a sort key, not in an aggregate, not in a header, not in an error message. `REVOKE SELECT (trust_score, cancellation_count_90d, home_h3_r7, is_suspended) ON public.profiles FROM authenticated` is the enforcement, and the column is absent from `profile_cards` ([RLS Design §4](../01-architecture/05-rls-design.md)). |
| R49 | **MUST NOT** | A user MUST NOT be able to read their **own** numeric `trust_score` either, and no definer function MUST exist that returns it to `authenticated`. The column `REVOKE` is role-wide and therefore already denies self-reads; this requirement states that as intent so nobody "fixes" it. A subject who can watch their own score move can measure the marginal effect of every action and reverse-engineer the anti-abuse model, and a colluding pair can do it twice as fast. *(This contradicts [RLS Design §4](../01-architecture/05-rls-design.md), which describes the score as visible to the user themselves — see Q2.)* |
| R50 | **MUST** | The only public projection MUST be `trust_tier`, with exactly four values and this mapping: `unverified` (account exists), `email_verified` (email confirmed, no KYC), `id_verified` (`verifications.status = 'passed'` and garden verified), `trusted` (`id_verified` plus ≥ 10 completed exchanges, `rating_avg >= 4.5` over ≥ 5 revealed ratings, and `cancellation_count_90d <= 1`). |
| R51 | **MUST** | `trust_tier` MUST be maintained by trigger from `trust_score` and its inputs, and MUST NOT be client-writable. `profiles` UPDATE for `authenticated` is restricted to profile-presentation columns; a guard trigger rejects a write touching `trust_tier`, `trust_score`, `rating_avg`, `rating_count`, `completed_exchanges`, `cancellation_count_90d`, or `is_suspended` with `not_authorized` 42501. |
| R52 | **MUST NOT** | No list, search, map, or suggestion surface MUST order, rank, filter, or paginate by `trust_score` or `trust_tier`. Ordering by a hidden number publishes the number one binary search at a time, and `suggest_matches`'s ranking (mutual want → one-way → shared spot → distance → recency, [SPEC-009 R24](SPEC-009-listings-and-offers.md)) deliberately contains no reputation term. |
| R53 | **MUST** | The tier badge MUST be explained in-app by a sheet, reachable from every badge, stating in plain words what each tier means and what it does not mean. An unexplained badge is read as a rating, and "unverified" next to a person's face reads as an accusation rather than as "hasn't finished signing up". |
| R54 | **MUST** | A user whose `is_suspended = true` MUST have no `profile_cards` row at all, so their tier, average, and count vanish together rather than a badge changing to something a reader could interpret. |
| R55 | **SHOULD** | The user's own profile SHOULD explain, qualitatively, what affects their standing — "completed exchanges, your ratings once they're revealed, and cancellations in the last 90 days" — and SHOULD NOT show a number, a bar, a percentage, or a distance-to-next-tier. |

### 5.6 Abuse resistance

| ID | Req | Statement |
| --- | --- | --- |
| R56 | **MUST** | **Rating extortion** ("five stars or I leave you one") MUST be answered structurally, not by policy text: R08 closes the window at reveal, R09 forbids edits, R19 hides submission timing, and R16 freezes aggregates until reveal. Together these make the threat unverifiable — the extortionist cannot check whether they were obeyed until it is too late to act on the answer. `content-scan` additionally flags rating-conditional phrasing for the flagged-message queue ([SPEC-900 §5.2](SPEC-900-moderation-console.md)). |
| R57 | **MUST NOT** | **Mass reporting** MUST NOT be able to move severity, SLA, priority, or outcome. `severity` derives from `(reason, subject_type, subject history)` and MUST NOT include a count of reporters (R22). N reports from N accounts create N rows and MUST NOT auto-action, auto-suspend, auto-hide, or auto-anything. Any automatic response to volume is a control surface handed to whoever can organize twenty accounts. |
| R58 | **MUST** | Reports about one subject MUST be grouped by `subject_user_id` in the console so a moderator sees *one subject with N reports*, not N queue items, and so a brigade costs one triage rather than twenty ([SPEC-900 R11](SPEC-900-moderation-console.md)). |
| R59 | **MUST** | A reporter whose reports are repeatedly `dismissed` MUST have a decaying daily report quota — `private.report_credibility`, halving on each dismissal within a rolling 30 days, recovering on each `actioned` outcome — **floored at 1 per day and never zero**. The one true report from a serial false-reporter is the one that will matter, and a zero floor is how that report does not get filed. |
| R60 | **MUST** | **Block-as-griefing** MUST cost its target nothing measurable. A session cancelled by `on_block_created` MUST NOT increment `cancellation_count_90d` for either party, MUST NOT set `counts_as_late`, MUST NOT reduce `completed_exchanges`, and MUST NOT alter `trust_score` for either party. Otherwise "block them twenty minutes before the handoff" is a free reputation attack. |
| R61 | **MUST** | **Sockpuppet re-registration** after a `permanent_ban` MUST be blocked by `private.banned_identities`, keyed on a salted HMAC of the vendor identity reference already retained for 7 years in `private.verification_vendor_refs` ([Data Model §5, §14](../01-architecture/03-data-model.md)). A KYC pass whose reference hashes to an entry MUST leave `verifications.status = 'failed'` and MUST NOT satisfy `app.can_transact()`. |
| R62 | **MUST NOT** | The re-registration check MUST NOT become an enumeration oracle. The failure MUST be indistinguishable from an ordinary verification failure — same `failure_reason_code` class, same copy, same timing — and MUST NOT say or imply "you have been banned". Anything more precise tells a determined person exactly which identity document to stop using. |
| R63 | **MUST** | Every action in this spec — rating submitted, rating revealed, report filed, report resolved, block created, block removed, tier changed, ban registered — MUST write `audit.events` with actor, subject, and action ([Data Model §12](../01-architecture/03-data-model.md)), and `metadata` MUST NOT be capable of carrying a coordinate. |
| R64 | **SHOULD** | A user with an open `severity = 1` report against them SHOULD be surfaced to on-call with their in-flight sessions listed, so the responder can see whether a meeting is scheduled in the next few hours. This is the difference between a report and an intervention. |

### 5.7 Freezing and resolving an exchange

> **Unspecced neighbour: the suspension fanout.** [SPEC-010 R19](SPEC-010-exchange-lifecycle.md) and EC-05 both depend on suspension cancelling a user's pending requests and in-flight sessions, and this spec's enforcement ladder is what triggers it — but no document states which trigger fires, in what order, or which notifications go out. It strands someone mid-exchange if the order is wrong, and it is cited by three specs and owned by none. This section is its natural home ([Development Notes N-11](../07-review/02-development-notes.md#n-11--four-workflows-touching-safety-or-regulation-have-no-spec)).


A report against a session is the one place where this spec moves another spec's state machine. It does so through [SPEC-010](SPEC-010-exchange-lifecycle.md)'s transitions, never around them.

| ID | Req | Statement |
| --- | --- | --- |
| R65 | **MUST** | `create_report` against a session MUST freeze it to `disputed` when the session is non-terminal or completed within 72 hours ([SPEC-010 R67](SPEC-010-exchange-lifecycle.md)). All four source states — `scheduling`, `scheduled`, `in_progress`, `completed` — MUST be reachable. **`scheduled` is the one that matters most**: it is the state in which the reporter has a confirmed time and place with someone they have become afraid of, and the transition table originally omitted it, which made the most important freeze in the product silently impossible. |
| R66a | **MUST** | Resolving a dispute MUST move the session out of `disputed` through `moderation-action`, to `cancelled` or `completed` per [Exchange State Machine §3.2](../01-architecture/07-exchange-state-machine.md). **Leaving it in `disputed` is not a resolution**: the session still holds its listing and its inventory item, `expire_listings` will not touch a `reserved` row, and `listings_one_active_per_item` means the owner can never relist that produce. A report that is dismissed still has to release the tomatoes. |
| R66b | **MUST** | `disputed → cancelled` MUST call `app.release_reservation` and MUST NOT set `counts_as_late` or increment `cancellation_count_90d` for either party. A moderated outcome is nobody's late cancellation — the same principle as R60 for blocks, and for the same reason: a safety process that costs its participants reputation is a safety process people learn to avoid. |
| R66c | **MUST** | The moderation console MUST show, on every disputed case, **what the freeze is currently holding** — the listing, the item, and how long it has been held. A moderator deciding a case cannot weigh the cost of deferring it if the cost is invisible ([SPEC-900 R39](SPEC-900-moderation-console.md)). |
| R66d | **MUST** | `dispute_sla_breach` MUST alert on any dispute open longer than **7 days** ([SPEC-010 R68c](SPEC-010-exchange-lifecycle.md)). It MUST NOT auto-resolve. Guessing the outcome of a safety report to free an inventory row is the wrong trade in every case, and the alert exists so a human makes it. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.ratings`](../01-architecture/03-data-model.md#11-communication--trust) | read (participant, reveal-gated) / write (INSERT via definer only) | The spec's first subject. No client UPDATE or DELETE policy exists (R09) |
| [`public.reports`](../01-architecture/03-data-model.md#11-communication--trust) | read (reporter, column-restricted; moderator full) / write (definer) | Pattern E ([RLS Design §5](../01-architecture/05-rls-design.md)) |
| [`public.blocks`](../01-architecture/03-data-model.md#11-communication--trust) | read (blocker only) / write (definer) | The blocked party can never read the row |
| `public.profiles` | read (self, column-restricted) / write (definer, trust columns) | `trust_score`, `trust_tier`, `rating_avg`, `rating_count`, `cancellation_count_90d` |
| `public.profile_cards` | read | The only other-user projection; `rating_avg` NULL below 3 (R17) |
| `public.exchange_sessions` | read (participant) / write (definer, cancellation) | R37, R44 |
| `public.exchange_requests` | write (definer, cancellation on block) | R37 |
| `public.message_threads` / `public.messages` | write (definer, `is_closed`) / read (moderator, via evidence) | R37, R26 |
| `public.notifications` / `private.notification_outbox` | write via `app.enqueue_notification` | R30, reveal notice ([SPEC-013](SPEC-013-notifications.md)) |
| `private.report_evidence` | write (definer, at insert) / read (moderator definer only) | **New.** R26, R27 |
| `private.oncall_pages` | write (definer) / drain (`service_role`) | **New.** R24 |
| `private.session_cancellation_causes` | write (definer) / read (moderator definer only) | **New.** R44 |
| `private.report_credibility` | write (definer) / read (definer) | **New.** R59 |
| `private.banned_identities` | write (definer, two-person) / read (definer) | **New.** R61 |
| `audit.events` | write | R63; every action, no exceptions |
| `private.garden_locations` | **none** | Named to be explicit: nothing in trust & safety reads a garden coordinate. A moderator investigating a harassment report gets `city_label` and the safe spot, and needs [Location Privacy §10](../01-architecture/04-location-privacy.md) break-glass for anything more |

**New schema objects introduced by this spec:** migration `20260808_0121_trust_and_safety.sql`

```sql
-- Closed tag vocabulary (R06). A CHECK, not a lookup table: the set is six values
-- and it changes only with a product decision that also changes the rate screen.
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_tags_closed CHECK (
    tags <@ ARRAY['punctual','as_described','friendly','late','no_show','misrepresented']::text[]),
  ADD CONSTRAINT ratings_tag_count CHECK (COALESCE(array_length(tags,1),0) <= 4),
  ADD COLUMN revealed_at timestamptz;

-- Reveal is a definer function. There is no client UPDATE policy on ratings (R12).
CREATE OR REPLACE FUNCTION app.reveal_session_ratings(p_session uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.ratings
     SET is_revealed = true, revealed_at = now()
   WHERE session_id = p_session AND is_revealed = false;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN 0; END IF;

  -- R16/R18: aggregates move at reveal, in the same transaction, never before.
  PERFORM app.recompute_rating_aggregate(r.ratee_id)
     FROM public.ratings r WHERE r.session_id = p_session;
  PERFORM app.recompute_trust_score(r.ratee_id)
     FROM public.ratings r WHERE r.session_id = p_session;

  PERFORM app.enqueue_notification(r.rater_id, 'moderation_outcome',
            jsonb_build_object('session_id', p_session, 'kind', 'rating_revealed'))
     FROM public.ratings r WHERE r.session_id = p_session;
  RETURN v_n;
END; $$;

-- Both submitted → reveal now. Otherwise the hourly job reveals at 7 days (R14).
CREATE OR REPLACE FUNCTION public.trg_reveal_on_second_rating() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF (SELECT count(*) FROM public.ratings WHERE session_id = NEW.session_id) = 2 THEN
    PERFORM app.reveal_session_ratings(NEW.session_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_ratings_reveal AFTER INSERT ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.trg_reveal_on_second_rating();

SELECT cron.schedule('reveal_ratings', '0 * * * *', $$
  SELECT app.reveal_session_ratings(s.id)
    FROM public.exchange_sessions s
   WHERE s.state = 'completed'
     AND s.completed_at <= now() - interval '7 days'
     AND EXISTS (SELECT 1 FROM public.ratings r
                  WHERE r.session_id = s.id AND r.is_revealed = false);
$$);
```

Severity and SLA, belt and braces (R22, R23):

```sql
ALTER TABLE public.reports
  ADD CONSTRAINT reports_unsafe_is_sev1 CHECK (
    reason <> 'unsafe_meeting' OR severity = 1),
  ADD CONSTRAINT reports_sla_matches_severity CHECK (
    (severity = 1 AND sla_due_at <= created_at + interval '1 hour')
    OR (severity > 1 AND sla_due_at <= created_at + interval '24 hours'));

CREATE UNIQUE INDEX reports_one_open_per_subject_reason
  ON public.reports (reporter_id, subject_id, reason)
  WHERE status IN ('open','triaged');

CREATE OR REPLACE FUNCTION public.trg_report_severity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Severity is never client input (R22). NEW.severity is overwritten unconditionally.
  IF NEW.reason = 'unsafe_meeting' THEN
    NEW.severity   := 1;
    NEW.sla_due_at := NEW.created_at + interval '1 hour';
  ELSIF NEW.reason IN ('harassment','impersonation') THEN
    NEW.severity   := 2;
    NEW.sla_due_at := NEW.created_at + interval '24 hours';
  ELSE
    NEW.severity   := 3;
    NEW.sla_due_at := NEW.created_at + interval '24 hours';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_reports_severity BEFORE INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.trg_report_severity();
```

Paging, as an outbox rather than an HTTP call in a transaction (R24):

```sql
CREATE TABLE private.oncall_pages (
  id            bigserial PRIMARY KEY,
  report_id     uuid NOT NULL REFERENCES public.reports(id),
  severity      smallint NOT NULL CHECK (severity = 1),
  attempts      smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

SELECT cron.schedule('drain_oncall_pages', '1 minute',
  $$SELECT net.http_post(url := app.setting('edge_url') || '/oncall-page',
      headers := jsonb_build_object('Authorization','Bearer '||app.setting('service_key')));$$);
```

Block teardown, amended (R37, R44, R60):

```sql
CREATE TABLE private.session_cancellation_causes (
  session_id uuid PRIMARY KEY REFERENCES public.exchange_sessions(id) ON DELETE CASCADE,
  cause      text NOT NULL CHECK (cause IN ('blocked','moderation','no_show','user')),
  actor_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.on_block_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_session uuid;
BEGIN
  FOR v_session IN
    SELECT id FROM public.exchange_sessions
     WHERE state IN ('scheduling','scheduled')
       AND ((owner_id = NEW.blocker_id AND requester_id = NEW.blocked_id)
         OR (owner_id = NEW.blocked_id AND requester_id = NEW.blocker_id))
     FOR UPDATE
  LOOP
    UPDATE public.exchange_sessions
       SET state = 'cancelled', cancelled_by = NEW.blocker_id,
           -- R44: NEVER 'blocked' on a participant-readable column.
           cancelled_reason = 'cancelled_by_participant',
           cancelled_at = now(), version = version + 1
     WHERE id = v_session;

    INSERT INTO private.session_cancellation_causes (session_id, cause, actor_id)
    VALUES (v_session, 'blocked', NEW.blocker_id)
    ON CONFLICT (session_id) DO NOTHING;
    -- R60: no cancellation_count_90d increment, no counts_as_late, for either party.
  END LOOP;

  UPDATE public.exchange_requests SET status = 'cancelled', updated_at = now()
   WHERE status = 'pending'
     AND ((requester_id = NEW.blocker_id AND owner_id = NEW.blocked_id)
       OR (requester_id = NEW.blocked_id AND owner_id = NEW.blocker_id));

  UPDATE public.message_threads SET is_closed = true
   WHERE participant_a = LEAST(NEW.blocker_id, NEW.blocked_id)
     AND participant_b = GREATEST(NEW.blocker_id, NEW.blocked_id);

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (NEW.blocker_id, 'authenticated', 'block.created', 'user', NEW.blocked_id);
  RETURN NEW;
END; $$;
```

Trust score, and the REVOKE that is the actual control (R47–R49):

```sql
CREATE OR REPLACE FUNCTION app.recompute_trust_score(p_user uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_p public.profiles; v_verified boolean; v_score numeric(5,2);
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_user FOR UPDATE;
  SELECT (v.status = 'passed') INTO v_verified
    FROM public.verifications v WHERE v.user_id = p_user;

  v_score :=
      (CASE WHEN COALESCE(v_verified,false) THEN 30 ELSE 0 END)          -- verification
    + LEAST(25, v_p.completed_exchanges * 2.5)                            -- volume, capped
    + (CASE WHEN v_p.rating_count >= 3
            THEN ((COALESCE(v_p.rating_avg,3) - 1) / 4.0) * 35 ELSE 0 END)-- quality
    + GREATEST(0, 10 - (v_p.cancellation_count_90d * 5));                 -- reliability
  v_score := GREATEST(0, LEAST(100, v_score));

  UPDATE public.profiles SET trust_score = v_score, updated_at = now() WHERE id = p_user;
  RETURN v_score;
END; $$;

-- R48/R49. Role-wide, so it denies self-reads too, which is the intent.
REVOKE SELECT (trust_score, cancellation_count_90d) ON public.profiles FROM authenticated;
REVOKE EXECUTE ON FUNCTION app.recompute_trust_score(uuid) FROM authenticated;

-- R17: the average is withheld below three revealed ratings.
CREATE OR REPLACE VIEW public.profile_cards WITH (security_invoker = on) AS
SELECT p.id, p.handle, p.display_name, p.avatar_path, p.bio, p.city_label,
       p.trust_tier,
       CASE WHEN p.rating_count >= 3 THEN p.rating_avg END AS rating_avg,
       p.rating_count, p.completed_exchanges, p.created_at
  FROM public.profiles p
 WHERE p.deleted_at IS NULL
   AND p.is_suspended = false
   AND NOT app.is_blocked_either_way((SELECT auth.uid()), p.id);
```

Ban registry (R61, R62):

```sql
CREATE TABLE private.banned_identities (
  identity_hash bytea PRIMARY KEY,          -- HMAC(vendor_inquiry_id, server pepper)
  banned_at     timestamptz NOT NULL DEFAULT now(),
  report_id     uuid,
  proposed_by   uuid NOT NULL,
  approved_by   uuid NOT NULL,
  CONSTRAINT two_person CHECK (proposed_by <> approved_by)   -- SPEC-900 R19
);
```

Also introduced: RPCs `submit_rating` (extended), `create_report`, `create_block`, `remove_block`; the Edge Function `oncall-page`; the routes `/(modals)/rate/[sessionId]`, `/(modals)/report`, `/(modals)/block-confirm`, `/profile/blocked`; and the `pg_cron` job `decay_report_credibility` (daily).

### 6.1 Report status transitions

| From | To | Actor | Mechanism | Notes |
| --- | --- | --- | --- | --- |
| — | `open` | Reporter | `rpc.create_report` | Severity and SLA set by trigger; evidence snapshotted |
| `open` | `triaged` | Moderator | Console claim | Starts the 15-minute lease ([SPEC-900 R15](SPEC-900-moderation-console.md)) |
| `open` / `triaged` | `actioned` | Moderator | `moderation-action` | Writes `action_taken`; reporter gets the generic outcome (R30) |
| `open` / `triaged` | `dismissed` | Moderator | `moderation-action` with `action = 'none'` | Decrements reporter credibility (R59) |
| `triaged` | `escalated` | Moderator | Console | Severity 1 path; two-person actions require it |
| `actioned` / `dismissed` | — | — | Terminal | Reversal is a new appeal record, never an edit |

**PII touched:** `ratings` carries **P2** (stars, tags) and **P1** (`comment`, which is user prose about a real meeting) plus, by association, the fact that two named people met. `reports` is **P1** throughout — `reporter_id` and `subject_user_id` together are an accusation with two names on it — and `private.report_evidence` is P1 by construction because it is a copy of message bodies and session times. `blocks` is **P1**: the existence of a block between two named users is precisely the fact R39 exists to hide, which is why the blocked party has no read path to the row. `trust_score` and `cancellation_count_90d` are **P1** and column-`REVOKE`d. **No P0 column is read, written, or derivable by any path in this spec**, and no `RETURNS TABLE` here has a column capable of holding a coordinate ([API Contract §9](../01-architecture/06-api-contract.md)).

## 7. API

### 7.1 `rpc.submit_rating`

**Auth:** `authenticated`, session participant. Deliberately **not** gated on `app.can_transact()` — a user whose verification lapsed after the handoff must still be able to rate it.
**Rate limit:** 30 / day / user

```jsonc
// Request
{ "p_session_id": "7b1e0c1c-…", "p_stars": 5,
  "p_tags": ["punctual","as_described"], "p_comment": "Lovely tomatoes, easy handoff.",
  "p_idempotency_key": "8f14e45f-…" }
```

```jsonc
// Response 200
{ "rating_id": "1f3a4a0b-…", "is_revealed": false, "window_closes_at": "2026-08-15T14:31:02Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Caller is not a participant in the session |
| `invalid_transition` | 409 | Session is not `completed` (R01), **or** ratings are already revealed and the window is closed (R08) |
| `conflict` | 409 | Already rated (`ratings_one_per_rater`, R03) |
| `validation_failed` | 400 | Stars outside 1–5, a tag outside the closed vocabulary, more than 4 tags, comment > 300, self-rating |
| `request_not_found` | 404 | Unknown session, or invisible under RLS |
| `rate_limited` | 429 | Bucket empty |

`is_revealed` in the response is `true` only when this submission was the second one and the trigger fired in the same transaction. `window_closes_at` is the 7-day reveal deadline, which is information the caller already has; it is returned so the rate screen can render a truthful countdown rather than inventing one. Nothing in the response indicates whether the counterparty has rated (R19) — when `is_revealed` comes back `true` the caller is about to see both ratings anyway, so it discloses nothing they will not have in the next round trip.

### 7.2 `rpc.create_report`

**Auth:** `authenticated`. Not gated on `can_transact()` (R41's reasoning applies equally).
**Rate limit:** 10 / day / user, further reduced by `private.report_credibility` (R59), floor 1/day

```jsonc
// Request
{ "p_subject_type": "user", "p_subject_id": "9c1e3d0f-…",
  "p_reason": "unsafe_meeting", "p_details": "He followed me to my car.",
  "p_idempotency_key": "…" }
```

```jsonc
// Response 200 — identical shape for every reason (R25)
{ "report_id": "4a2f9c11-…", "filed_at": "2026-08-08T14:31:02Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Reason not one of the six selectable (R20/R21), unknown `subject_type`, details > 1000, self-report |
| `request_not_found` | 404 | Subject does not exist, or is invisible to the caller under RLS |
| `conflict` | 409 | An open report already exists for this `(reporter, subject, reason)` (R31) |
| `rate_limited` | 429 | Daily quota, possibly credibility-reduced |

Ordering inside the function: authorize → consume a token → resolve and validate the subject → insert the report (trigger sets severity and SLA) → snapshot evidence into `private.report_evidence` → if `severity = 1`, insert `private.oncall_pages` → audit. The evidence snapshot happens **before** the page, so an on-call responder woken at 03:00 opens a report that already has its evidence attached.

### 7.3 `rpc.create_block`

**Auth:** `authenticated`. **Never** gated on `app.can_transact()`, suspension, or verification (R41).
**Rate limit:** 30 / day / user

```jsonc
// Request
{ "p_blocked_id": "9c1e3d0f-…", "p_reason": "Kept messaging after I said no.",
  "p_idempotency_key": "…" }
// Response 200
{ "blocked": true, "sessions_cancelled": 1, "thread_closed": true, "requests_cancelled": 2 }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Self-block (`no_self_block` CHECK), unknown user |
| `conflict` | 409 | Already blocked — the client renders this as success, because the user's intent is satisfied |
| `rate_limited` | 429 | 30/day exhausted. Deliberately generous ([API Contract §7.2](../01-architecture/06-api-contract.md)) |

The counts exist so the blocker can be told what happened (R40). They are the *blocker's* facts about the blocker's own exchanges; nothing here is a fact about the blocked user's other activity. `p_reason` is stored on `blocks.reason`, is visible to the blocker and to moderators, and is never surfaced to the blocked party by any path.

### 7.4 `rpc.remove_block`

**Auth:** `authenticated`, blocker only
**Rate limit:** 10 / day / user (R42)

```jsonc
// Request
{ "p_blocked_id": "9c1e3d0f-…", "p_idempotency_key": "…" }
// Response 200
{ "blocked": false, "restored": false }
```

`restored` is always `false` and exists to be explicit: cancelled sessions, cancelled requests, and closed threads do not come back (R42). Errors: `request_not_found` 404 (no such block), `rate_limited` 429.

### 7.5 `GET /rest/v1/ratings`

Reveal-gated by policy, not by a select list:

```sql
CREATE POLICY ratings_select_participant ON public.ratings
  FOR SELECT TO authenticated
  USING (
    rater_id = (SELECT auth.uid())
    OR (ratee_id = (SELECT auth.uid()) AND is_revealed = true)
    OR app.is_moderator());
```

The client's two select constants are `RATING_MINE` (`id, session_id, stars, tags, comment, is_revealed, created_at`) and `RATING_RECEIVED` (identical, plus `rater:profile_cards(handle,display_name,avatar_path)`). A lint rule fails any `ratings` query using neither. `ratee_id` is present in both; `rater_id` is present only in `RATING_MINE`, so a revealed rating you received names its author only through the joined card — which is the same fact, but it makes the join the deliberate act.

### 7.6 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| Any indication that the counterparty has rated | R19. It is simultaneously social pressure and a timing oracle |
| `trust_score`, to anyone, including its subject | R48, R49. A visible score is an optimized score |
| `cancellation_count_90d` | Same, and it is a proxy for "has had things go wrong", which reads as an accusation without context |
| A report's `severity`, `action_taken`, or `resolved_by` to the reporter | R28. Column `REVOKE`, not a filtered select |
| Anything about a report to its subject | R29. There is no policy, no notification, and no error code that differs |
| `blocks` rows to the blocked party | R39. The row is unreadable, and no derived state differs |
| `exchange_sessions.cancelled_reason = 'blocked'` | R44. The public column carries the generic value; the true cause is in `private` |
| A count of how many people have blocked a user | It would be a scarlet letter computed from private safety decisions, and it would let a harasser measure their own notoriety |
| Rating text on profiles | §3. Public prose reviews make every rating a negotiation |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Rate exchange | `/(modals)/rate/[sessionId]` | Stars, up to 4 tags, optional comment. Opens from the completion prompt and the exchange row |
| Rating revealed | `/exchanges/session/[sessionId]` (section) | Both ratings, side by side, after reveal |
| Report | `/(modals)/report?subjectType=&subjectId=` | Six reasons, details, an independent "also block" checkbox, off by default (R33) |
| Block confirm | `/(modals)/block-confirm?userId=` | Consequences, then a second tap (R45) |
| Blocked users | `/profile/blocked` | List and unblock (R46) |
| Trust tier explainer | Sheet, from any badge | What each tier means (R53) |
| My standing | `/profile` (section) | Qualitative only, no number (R55) |

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | The rate screen paints instantly from the cached session — counterparty name, item, safe spot, date are all already local — and never shows a spinner; only the submit button has a pending state. The blocked-users list shows a three-row skeleton for at most one round trip. The report sheet is entirely local: reasons are a static list, so it opens in one frame even on a cold cache, which matters because it is opened by people who are upset. |
| Empty | Three cases, three different answers. **No ratings yet** on your own profile: "No ratings yet — they appear after your first completed exchange", never a zero or an empty star row. **No blocked users**: "You haven't blocked anyone." with one line explaining what blocking does, so the screen teaches rather than apologises. **A revealed session where the other party never rated**: your rating is shown alone with "They didn't rate this exchange" — stated plainly, because the absence is otherwise read as a hidden bad rating. |
| Error (recoverable) | Submit failed with a 5xx or a timeout. The rate screen and the report sheet both retain every field (Zustand draft with MMKV autosave, [Mobile Architecture §2](../01-architecture/02-mobile-architecture.md)) and show an inline banner with Retry. The idempotency key is **not** regenerated, so a report that actually committed before the timeout returns the original `report_id` rather than filing a second one. |
| Error (terminal) | Rating window closed (R08), session no longer `completed`, or the counterparty's account is gone. All render the same in-place card (§8.3) with a route back to the exchange list. A report whose subject has been deleted still succeeds — the evidence snapshot is the point (R26) — so this state does not arise for reports. |
| Offline | Rating and reporting are **disabled offline** and say so. Neither is queueable: a rating queued for six hours can commit after the reveal window closed, and a report queued overnight is a report that did not reach on-call. **Blocking is also disabled offline**, which is the hardest call in this spec — a person who taps Block and believes it worked is worse off than one who is told plainly that it did not, because they will behave as though they are hidden when they are not. The copy says exactly that. |
| Permission denied | Not a device-permission surface. The authorization cases are: rating a session you are not in (403, never rendered — the affordance does not exist), and reporting or blocking while suspended, which is **allowed** (R41) and therefore has no denied state. The one true denial is a moderator-only surface reached by a non-moderator, which returns zero rows and lands on the tab root. |
| Rate limited | 429 on report (10/day, possibly credibility-reduced) or block (30/day). The action disables for exactly `Retry-After` with a visible countdown, the draft is retained, and **no auto-retry is issued** ([API Contract §7.3](../01-architecture/06-api-contract.md)). The block limit is high enough that hitting it through genuine use is close to impossible, and §11 alerts if a real user does — because that user is having a very bad week and the limit is the wrong control for it. |

Two additional states specific to this feature:

| State | Behaviour |
| --- | --- |
| Awaiting reveal | The rate screen becomes a receipt: "Your rating is in. You'll both see them when they rate, or on {date}." No progress bar, no "waiting for them", no nudge to chase — R19 forbids the app from being the pressure. |
| Blocked, from the blocker's side | Threads, listings, and profile disappear from the blocker's surfaces too. This is symmetrical by design and is stated up front in the confirmation, because a blocker who expected to keep reading the thread will otherwise report it as data loss. |

### 8.3 Copy

Exact strings.

**Rate screen, header and prompt**
> **How did it go with {display_name}?**
> Ratings stay hidden until you've both rated, or for 7 days — whichever comes first.

**Rate screen, star accessibility labels**
> 1 star, poor · 2 stars, below expectations · 3 stars, fine · 4 stars, good · 5 stars, excellent

**Rate screen, tag section**
> **Anything worth noting?** (optional)
> Chips: `On time` · `As described` · `Friendly` · `Late` · `Didn't show` · `Not as described`

**Rate screen, comment field placeholder**
> Only {display_name} and our safety team will read this.

**Rate screen, submit and confirmation**
> Button: `Submit rating`
> Confirmation: **You can't change this later.** Ratings are final so that nobody can trade edits after seeing yours.
> Buttons: `Go back` · `Submit`

**Rating submitted, awaiting reveal**
> **Your rating is in.**
> You'll both see them when {display_name} rates too, or on {date}.

**Rating window closed (R08)**
> **This one's closed.**
> Ratings were revealed on {date}, so this exchange can't be rated any more.
>
> Button: `Back to exchanges`

**Revealed, counterparty didn't rate (R15)**
> {display_name} didn't rate this exchange. Yours still counts.

**Profile, fewer than 3 ratings (R17)**
> New here · {n} exchanges

**Trust tier explainer sheet (R53)**
> **What the badge means**
> **Unverified** — signed up, hasn't verified an ID yet. They can't publish or exchange.
> **Email verified** — confirmed their email. Still can't exchange.
> **ID verified** — verified a government ID and a real garden. Everyone you can exchange with is at least here.
> **Trusted** — ID verified, ten or more completed exchanges, consistently well rated, and rarely cancels.
>
> It isn't a score, and it isn't a rating. It's how far through verification someone got and how much they've actually done.

**My standing, own profile (R55)**
> Your standing comes from your completed exchanges, your ratings once they're revealed, and any cancellations in the last 90 days. We don't show a number — a number is something to game rather than something to be.

**Report sheet, header**
> **Report {display_name}**
> A person on our team reads every report. We don't tell them who reported them.

**Report sheet, the six reasons (R20)**
> **They didn't show up** — you waited and they never came.
> **Not as described** — the crops weren't what the listing said.
> **Harassment** — abusive, threatening, or unwanted contact.
> **I felt unsafe** — anything that made you feel at risk, before, during, or after meeting.
> **Spam or scam** — fake listings, advertising, or asking for money.
> **Impersonation** — pretending to be someone else.

**Report sheet, details field**
> **What happened?** (optional)
> Anything you can tell us helps. If you're reporting a message, we can already see the conversation.

**Report sheet, block checkbox (R33, off by default)**
> Also block {display_name}

**Report sheet, unsafe-meeting confirmation**
> **We'll look at this straight away.**
> If you're in immediate danger, call your local emergency number first. We're not an emergency service.
>
> Buttons: `Send report` · `Cancel`

**Report submitted**
> **Report sent.**
> We'll review it and let you know when it's closed. We won't tell you what we did about the other person — that's their privacy, the same as yours.

**Report duplicate (R31)**
> You've already reported this. It's still open — reporting again doesn't move it up the queue.

**Report rate limited**
> You've filed several reports today. You can file another in {n} hours. If something urgent is happening, call your local emergency number.

**Moderation outcome, reporter's inbox (R30) — the only two variants**
> **Your report was reviewed.** We took action. Thank you for telling us.
> **Your report was reviewed.** We didn't find a breach of our rules this time. If it happens again, report it again — it helps us see a pattern.

**Block confirmation (R45)**
> **Block {display_name}?**
> · You'll stop seeing each other completely — listings, profile, messages.
> · Your exchange with them will be cancelled. {display_name} will be told the exchange was cancelled, but not why.
> · Your conversation will close. Neither of you can reopen it.
> · **They aren't told they've been blocked.**
>
> Buttons: `Cancel` · `Block`

**Block done, with a cancelled exchange (R40)**
> **{display_name} is blocked.**
> We cancelled your exchange at {safe_spot_name} on {date} and closed your conversation.

**Block done, nothing in flight**
> **{display_name} is blocked.**
> You won't see each other anywhere in Sharecropr.

**Block, offline**
> **You need a connection to block someone.**
> Nothing has changed yet — {display_name} can still see you. Try again when you're back online.

**Unblock confirmation (R42)**
> **Unblock {display_name}?**
> You'll be able to see each other again. The exchange and conversation we cancelled don't come back.
>
> Buttons: `Keep blocked` · `Unblock`

**Blocked list, empty (R46)**
> You haven't blocked anyone. Blocking hides you from someone completely, straight away, and they aren't told.

**Rate, offline**
> You need a connection to rate. Your draft is saved.

**Rating accessibility summary (US-14)**
> Rate your exchange with {display_name} at {safe_spot_name} on {date}. {n} of 5 stars selected. {m} tags selected. Ratings are final once submitted.

**Block button accessibility hint**
> Hides you and {display_name} from each other and cancels any exchange between you

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Learn that they have been blocked, and escalate offline.** Every other harm in this spec is bounded by money nobody can make or by reputation nobody can see; this one ends with a person turning up somewhere. The controls are R39 (no signal of any kind), R44 (the `cancelled_reason` column carries the generic value and the true cause lives in `private.session_cancellation_causes`), and T51/T52, which assert that blocked, declined, expired, and withdrawn are byte-identical on the wire from the blocked party's side ([SPEC-009 R52](SPEC-009-listings-and-offers.md)). The second-worst is **weaponizing the report system** — a brigade or a serial false reporter driving a suspension — answered by R57 (volume moves nothing) and R59 (a decaying but never-zero quota). The third is **reputation extortion**, answered structurally by R08, R09, R16, and R19 rather than by a rule in the terms. The fourth is **a banned user coming back**, bounded but not eliminated by R61: an attacker with a second genuine government ID defeats it, and we say so in §15. |
| Which RLS policies enforce access? | `ratings_select_participant` (rater always, ratee only when `is_revealed`, moderator always — §7.5); `reports_insert_own` and `reports_select_own` plus `REVOKE SELECT (resolved_by, action_taken, severity) ON public.reports FROM authenticated` ([RLS Design §5 Pattern E](../01-architecture/05-rls-design.md)); `blocks_select_blocker` (`blocker_id = (SELECT auth.uid())`) with **no** policy readable by the blocked party; the `profile_cards` view predicate including `NOT app.is_blocked_either_way`; and `listings_select_discoverable`, `requests_select_participant`, and `app.is_thread_participant` inheriting the block through the same helper. Definer functions: `public.submit_rating`, `public.create_report`, `public.create_block`, `public.remove_block`, `app.reveal_session_ratings`, `app.recompute_rating_aggregate`, `app.recompute_trust_score`, `app.get_report_evidence`, `app.is_blocked_either_way`, `app.is_moderator`, `app.enqueue_notification`, `app.consume_token`, and the triggers `on_block_created`, `trg_report_severity`, `trg_reveal_on_second_rating`. Every one runs as owner, bypasses RLS, and therefore re-checks authorization as its first statement ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| Can any response path expose an exact coordinate or PII? | No coordinate: nothing in this spec reads `private.garden_locations`, `gardens.display_point`, `h3_r7`, or `h3_r9`, and no `RETURNS TABLE` here has a column that could hold one — the report evidence snapshot stores a `safe_spot_id`, never a point (R27). PII exposure is deliberate and narrow: a revealed rating shows its author's `profile_cards` projection to the ratee, and a report's `details` reaches moderators only. The three things a response could leak and does not are the counterparty's rating before reveal (R13), the report's resolution to its reporter (R28), and the block's existence to the blocked party (R39). |
| What is logged, and is it scrubbed? | `audit.events` records rating submitted, rating revealed, report filed, report resolved, block created, block removed, tier changed, and ban registered, with actor and subject ids and no free text; `metadata` cannot carry a coordinate ([Data Model §12](../01-architecture/03-data-model.md)). **Never logged anywhere:** a rating's stars or comment, a report's `details`, a block's `reason`, or a `trust_score` value. Analytics carry `reason` (the enum, not the text), `severity`, `subject_type`, and time-to-resolution — never a subject id, never a reporter id, and never the pair. Sentry's scrubber drops `comment`, `details`, and `reason` keys alongside coordinates ([Location Privacy §8](../01-architecture/04-location-privacy.md)). |
| Does this need step-up authentication? | **No, and deliberately not.** Requiring AAL2 to block someone means a person being harassed has to find their authenticator app first. Reporting and blocking are the two operations in the product where added friction directly converts into harm, so they sit at AAL1 and are exempt even from `app.can_transact()` (R41). The moderator side of this spec — resolving a report, registering a ban — is AAL2 with a 15-minute freshness window and lives in [SPEC-900](SPEC-900-moderation-console.md). |
| Abuse / rate-limit controls | `submit_rating` 30/day/user; `create_report` 10/day/user, further reduced by credibility with a floor of 1/day (R59); `create_block` 30/day/user; `remove_block` 10/day/user. Structural controls a rate limit cannot substitute for: one rating per rater per session (R03), one open report per reporter-subject-reason (R31), severity derived server-side (R22), no automatic action on volume (R57), aggregates frozen until reveal (R16), the average withheld below three ratings (R17), and the ban registry (R61). The deliberate asymmetries: blocking is nearly unlimited while unblocking is not, and reporting decays with false positives while never reaching zero. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Both parties submit a rating within the same millisecond. | Both inserts succeed (`ratings_one_per_rater` is per rater, not per session). Whichever trigger sees `count(*) = 2` calls `app.reveal_session_ratings`, which is idempotent — the second call updates zero rows and returns 0 without re-notifying or double-counting the aggregate (R18). |
| EC-02 | A rating is submitted at 6 days 23 hours 59 minutes; the reveal job runs a minute later. | The rating lands, the job reveals both, and the aggregate moves once. There is no ordering in which a rating is accepted and then discarded, because `submit_rating` and `reveal_session_ratings` both take the session row `FOR UPDATE` before touching `ratings`. |
| EC-03 | The `reveal_ratings` job is down for two days. | Nothing is revealed and nothing leaks — the policy's `is_revealed = true` clause is the guarantee, and the job is only the thing that flips it (the same relationship as [SPEC-009 R31](SPEC-009-listings-and-offers.md)). On resume, the backlog reveals in one pass and each affected user gets one notification per session, not a digest. The visible symptom is a late reveal, which is the correct thing to degrade. |
| EC-04 | A user rates, then the counterparty deletes their account before reveal. | The reveal still happens on schedule. The deleted user's `profile_cards` row is gone, so the rater sees their own rating with "This person is no longer on Sharecropr" and no card. The rating against the deleted user is retained pseudonymized for the aggregate history that [SPEC-900](SPEC-900-moderation-console.md) may need, per [Data Model §14](../01-architecture/03-data-model.md). |
| EC-05 | A user with exactly 2 revealed ratings receives a third. | `rating_avg` becomes non-NULL at the same moment (R17), so a profile goes from "New here" to "4.7 · 3 exchanges" in one step. This is a visible jump and it is the correct behaviour: below three the number was recoverable arithmetic, and hiding it later would be worse. |
| EC-06 | Someone reports a listing, and the owner withdraws it thirty seconds later. | The evidence snapshot was taken inside `create_report` (R26), so the moderator sees the title, description, species, spot set, and media paths as they were. The live listing is gone; the report is not. |
| EC-07 | An `unsafe_meeting` report is filed while `private.oncall_pages` cannot reach the paging provider. | The report row and the page row both committed (R24), so nothing is lost. The drain retries every minute with backoff; an unacknowledged severity-1 page after **5 minutes** escalates to the secondary and after 15 to the whole security channel ([SPEC-900 §5.5](SPEC-900-moderation-console.md)). The reporter's experience is unchanged, because the response never mentioned escalation (R25). |
| EC-08 | Twenty accounts report the same user within an hour. | Twenty rows, one grouped queue item (R58), unchanged severity (R57), no automatic action. A moderator reads the evidence. If the reports are coordinated and false, each dismissal decays that reporter's credibility (R59) and the coordination itself becomes a `spam` report against the brigade. |
| EC-09 | A user blocks their counterparty twenty minutes before a scheduled handoff. | The session is cancelled with the generic reason, the thread closes, and the other party receives `exchange_cancelled` — a push that is **not** quiet-hours suppressible ([Realtime & Notifications §5](../01-architecture/08-realtime-and-notifications.md)), because they may be about to drive somewhere. Neither party's `cancellation_count_90d` moves (R60). The blocker sees the copy naming the spot and the date so they know what they just cancelled (R40). |
| EC-10 | A blocked user issues `GET /rest/v1/exchange_sessions?select=cancelled_reason` on the cancelled session. | They read `cancelled_by_participant` (R44). The string `blocked` exists only in `private.session_cancellation_causes`, which `authenticated` has no privilege on ([Data Model §3](../01-architecture/03-data-model.md)). This is the query that would otherwise have defeated the entire silent-block design. |
| EC-11 | A blocked user re-requests the listing they were blocked over. | The listing is not in their result set at all (`listings_select_discoverable`), so the request screen is unreachable. If they replay a stored `listing_id` directly, `requests_insert_requester`'s `WITH CHECK` fails and they receive `blocked` 403 — which is indistinguishable from the code they would receive if *they* had blocked the owner, and from a 404 if the listing had merely expired. |
| EC-12 | A suspended user tries to block someone. | It works (R41). `create_block` does not call `app.can_transact()`, does not read `is_suspended`, and is not behind any client guard. A suspended harasser's target must still be able to hide, and a suspended victim must still be able to hide from a non-suspended harasser. |
| EC-13 | A user blocks, unblocks, and re-blocks the same person three times in a day. | Three blocks succeed (30/day) and two unblocks succeed (10/day); the third unblock returns 429. `on_block_created` is idempotent on the second and third block — the session is already cancelled, the thread already closed — so the counts in the response are honest zeros rather than repeated ones. |
| EC-14 | A banned user completes KYC again with the same government ID under a new email. | The vendor returns a new `inquiry_id`; the HMAC of the identity reference matches `private.banned_identities`; `verifications.status` is set to `failed` with the ordinary failure copy (R62). The account exists, can browse, and cannot transact. Nothing tells them why, and the timing is identical to a genuine verification failure. |
| EC-15 | A banned user completes KYC with a **different** genuine government ID. | It works. R61 is bounded by exactly this, we know it, and §15 Q5 tracks it. The remaining controls are behavioural and moderator-side: the same safe spots, the same targets, and the same handle patterns are what a human notices. |
| EC-16 | A moderator dismisses a report that was, in fact, true, and the reporter files again about a new incident. | The new report is a different `(reporter, subject, reason)` tuple or a new incident under the same one after the first closed, so R31 does not block it. The reporter's credibility took one halving from the dismissal; the floor of 1/day (R59) guarantees the second report is filable on any day. |
| EC-17 | `content-scan` flags a message that reads "give me five stars and I'll leave you five". | The message is delivered (scanning is asynchronous and advisory, [API Contract §6.5](../01-architecture/06-api-contract.md)), `flagged_reason` is set, and the flagged-message queue picks it up. The sender is never told they were flagged, because telling them teaches evasion. The rating itself is unaffected: R08 and R09 mean the threat was never enforceable anyway. |
| EC-18 | A user is suspended between submitting a rating and its reveal. | The rating reveals on schedule and counts. The suspended user's `profile_cards` row disappears (R54), so the aggregate is correct but unreadable by others until the suspension lifts. Suspension is not a reason to discard a rating someone honestly gave. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `rating.submitted` | product event | `stars`, `tag_count`, `has_comment`, `hours_since_completion` | — |
| `rating.rate` | gauge | `rated / completed_sessions`, 7-day rolling | < 40% ⇒ the prompt is failing or the window is too short |
| `rating.revealed` | product event | `mode` (`both_submitted`\|`timeout`), `one_sided` | `one_sided` > 45% ⇒ reciprocity is broken and R15's protection is doing all the work |
| `rating.window_closed_rejection` | error event | — | Rising ⇒ the countdown copy is not landing |
| `rating.distribution` | histogram | `stars` | A collapse onto 5 ⇒ retaliation fear has returned; check that reveal timing is behaving |
| `report.filed` | product event | `reason`, `subject_type`, `severity`, `via_screen` | `unsafe_meeting` > 1% of exchanges ⇒ a safe-spot or curation problem, not a moderation one |
| `report.time_to_first_touch` | histogram | `severity` | **p95 > 30 min for severity 1 — page.** p95 > 12 h for the rest ⇒ staffing |
| `report.sla_breach` | error event | `severity`, `overdue_minutes` | **Any severity-1 breach — page.** Any standard breach ⇒ ticket + rota review |
| `report.oncall_page_unacked` | error event | `report_id`, `age_s` | **> 300 s — escalate to secondary.** > 900 s — whole security channel |
| `report.dismissal_rate` | gauge | by `reason` | > 70% for a reason ⇒ that reason's description is misleading people |
| `report.brigade_suspected` | operational | `subject_id_hash`, `reporter_count`, `window_minutes` | ≥ 5 reporters on one subject in 60 min ⇒ notify a moderator; **never an automatic action** (R57) |
| `block.created` | product event | `had_session`, `had_thread`, `requests_cancelled`, `from_screen` | Volume spike ⇒ correlate with report volume; a rise in blocks without a rise in reports means people don't trust reporting |
| `block.removed` | product event | `age_hours` | `age_hours` p50 < 1 ⇒ people are mis-tapping Block; the confirmation is not working |
| `block.rate_limited` | error event | — | **Any occurrence — investigate the user.** 30 blocks in a day is a person having a crisis, not an abuser |
| `trust.tier_changed` | product event | `from`, `to`, `cause` | `trusted → id_verified` regressions clustering ⇒ inspect the cancellation input |
| `trust.recompute_batch` | operational | `processed`, `duration_ms` | p95 > 5 s or a skipped nightly run |
| `ban.registry_hit` | operational | — (**no user id, no hash**) | **Any occurrence — notify security.** A returning banned identity is a signal about a specific person and a specific target |
| `ratings.aggregate_drift` | gauge | `count` of profiles where `rating_avg` disagrees with a recomputation over revealed rows | **> 0** — R16/R18 failed, and the failure is a reveal side channel |

**Never emitted:** a rating's `comment`, a report's `details`, a block's `reason`, a `trust_score` value or any bucketing of it, a reporter-subject pair, or the identity behind a `ban.registry_hit`.

## 12. Accessibility

- The rate screen's star control is a **`radiogroup` with five labelled options**, not five buttons and not a slider. Each option's label carries its meaning ("3 stars, fine") because "3" alone tells a screen-reader user nothing about the scale's direction.
- The finality of a rating is announced **before** submission, in the confirm dialog, not as a toast afterwards. A destructive-in-effect action whose irreversibility is announced after the fact is not accessible, it is a trap with a caption.
- Tag chips are `accessibilityRole="checkbox"` with `accessibilityState={{ checked }}` and a live-region count ("2 of 4 selected"), and at four the remaining chips set `disabled: true` with the reason in the section header.
- The block confirmation is a modal with `accessibilityViewIsModal`, focus placed on the **body text** rather than the destructive button, buttons in a fixed order (`Cancel` first), and focus returned to the invoking control on dismissal ([Mobile Architecture §10.2](../01-architecture/02-mobile-architecture.md)).
- The four consequences in the block confirmation are a real list, marked up as list items, so a screen reader announces "list, 4 items" and the user knows how much is coming. This is the single most important accessibility decision in this spec: it is the one dialog where skipping a line changes what someone believes will happen.
- The report reasons are a `radiogroup` where each option's accessible label is the reason **plus its description**, so a user choosing under stress does not have to navigate to a separate hint node to learn what "I felt unsafe" covers.
- Trust tier badges are never conveyed by colour or icon alone; every badge carries its tier name as text and an `accessibilityLabel` that includes the one-line meaning from §8.3.
- "Awaiting reveal" is announced as text, never as a spinner or a progress ring. A rating in flight is a state, not a load.
- The blocked-users list rows are single accessible elements labelled "{display_name}, blocked {relative_date}, double tap to unblock", so the destructive-ish action is discoverable without exploring a row.
- Dynamic type to 200% throughout with no capping. The block confirmation's four bullets and the tier explainer wrap rather than truncate; a truncated consequence is a consequence not disclosed.
- Hit targets ≥ 44 × 44 dp on every star, chip, reason row, and inline action — with the stars spaced so that a 5 is not one pixel from a 4.
- Reduced motion: the reveal animation on the rating pair becomes an instant state change, and the block confirmation does not slide.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01 | `submit_rating` against `scheduling`, `scheduled`, `in_progress`, `cancelled`, `no_show`, and `disputed` each return `invalid_transition` 409; only `completed` succeeds |
| T02 | integration | R02 | A client-supplied `ratee_id` in the body is ignored; the stored `ratee_id` is always the other participant. A non-participant calling directly gets `not_authorized` 403 |
| T03 | integration | R03 | A second `submit_rating` from the same rater returns `conflict` 409; asserted against the unique index with the RPC's own check stubbed out |
| T04 | integration | R04 | A crafted definer call with `rater_id = ratee_id` is rejected by `no_self_rating` |
| T05 | integration | R05, R06, R07 | Stars 0 and 6 rejected; a tag outside the six rejected by `ratings_tags_closed`; 5 tags rejected; a 301-character comment rejected — all by `CHECK`, not only by zod |
| T06 | integration | R08 | After reveal, `submit_rating` returns `invalid_transition`. Parameterised over both reveal modes (both-submitted and 7-day timeout) |
| T07 | rls | R09 | `UPDATE` and `DELETE` on `ratings` as the author return zero rows affected / are denied; no policy exists for either action |
| T08 | e2e | R10, R11 | A user who never rates sees no score change, one inbox item, and no repeat nag; the completion prompt appears and is dismissible |
| T09 | rls | R12 | `UPDATE ratings SET is_revealed = true` as the rater is denied; `app.reveal_session_ratings` is not executable by `authenticated` |
| T10 | rls | R13 | Rater reads own always; ratee reads only when revealed; a third user and `anon` read zero rows; a moderator reads both |
| T11 | integration | R14 | Reveal fires in the same transaction as the second insert; and, with the trigger disabled, at exactly 7 days by the hourly job |
| T12 | integration | R15 | One-sided session reveals at 7 days and the single rating enters `rating_avg` and `rating_count` |
| T13 | integration | R16, R18 | `rating_avg`, `rating_count`, `trust_score`, and `trust_tier` are byte-identical before and after the first submission, and change only at reveal, in one transaction |
| T14 | integration | R17 | `profile_cards.rating_avg` is NULL at 0, 1, and 2 revealed ratings and non-NULL at 3; asserted through the view, not the base table |
| T15 | e2e | R19 | No notification, badge, screen state, or response field differs between "counterparty has rated" and "counterparty has not"; asserted on the screen **and** on a proxy capture |
| T16 | e2e | R20, R21 | The sheet renders exactly six reasons; `other` and `underage` are absent from the picker and rejected with `validation_failed` when sent directly |
| T17 | integration | R22 | A client-supplied `p_severity` (and a direct `INSERT` with `severity = 5`) is overwritten by `trg_report_severity` |
| T18 | integration | R23 | `unsafe_meeting` yields `severity = 1` and a 1-hour `sla_due_at`; a direct insert with `reason='unsafe_meeting', severity=3` is rejected by `reports_unsafe_is_sev1` |
| T19 | integration | R24 | A severity-1 report writes `private.oncall_pages` in the same transaction; a forced rollback leaves neither row; the drain delivers within 60 s |
| T20 | integration | R25 | `create_report` responses for all six reasons are identical in keys and types; `sla_due_at` is absent; response latency distributions overlap |
| T21 | integration | R26 | Evidence is snapshotted for each of the four subject types; the report survives withdrawal, archival, thread closure, and account deletion of the subject |
| T22 | rls | R27 | `authenticated` has no privilege on `private.report_evidence`; `app.get_report_evidence` denies non-moderators and writes an audit row; the snapshot contains no coordinate column |
| T23 | rls | R28 | The reporter selecting `resolved_by`, `action_taken`, or `severity` gets a permission error, not a NULL |
| T24 | rls | R29 | The subject reads zero rows from `reports` by every access path, including by id, by `subject_user_id`, and through every embedded select |
| T25 | integration | R30 | Resolution emits one of exactly two notification bodies; neither names the subject, the action, or the reason |
| T26 | integration | R31 | A duplicate open report returns `conflict` 409; a new report after the first is resolved succeeds |
| T27 | integration | R32 | The 11th report in a day is `rate_limited` 429; a moderator-raised limit takes effect immediately |
| T28 | e2e | R33 | Reporting with the checkbox off creates no block; blocking creates no report; the checkbox defaults to off on every open |
| T29 | e2e | R34 | The report entry point is reachable from profile, listing detail, message (per-message and per-thread), and session detail |
| T30 | integration | R35, R36 | A block committed at T is enforced on the very next query in both directions; asserted through `listings`, `profile_cards`, and `messages` |
| T31 | integration | R37 | `on_block_created` cancels sessions, cancels pending requests in both directions, closes the thread, and audits — all asserted in one transaction |
| T32 | rls | R38 | The block sweep: for each of the eight enumerated surfaces, a blocked pair returns zero rows in both directions. A new surface without the predicate fails this test |
| T33 | e2e | R39 | The blocked user's screens, network responses, error codes, and response timings are indistinguishable from expiry, withdrawal, decline, and account deletion |
| T34 | integration | R40 | The `create_block` response reports the true counts across 0, 1, and 2 in-flight items |
| T35 | integration | R41 | `create_block` succeeds for a suspended user, an unverified user, a user with expired verification, and a user with no garden |
| T36 | integration | R42 | `remove_block` restores nothing; the 11th unblock in a day is 429 while the 11th block is not |
| T37 | integration | R43 | After a block, `audit.events`, `reports`, `private.report_evidence`, and `ratings` rows for the pair are all still present and moderator-readable |
| T38 | integration | R44 | A block-cancelled session has `cancelled_reason = 'cancelled_by_participant'` on the public row and `cause = 'blocked'` in `private.session_cancellation_causes`; the blocked party's select never returns the word `blocked` |
| T39 | e2e | R45, R46 | The confirmation lists all four consequences and requires a second tap; the blocked list shows handle and name only and unblocks with its own confirmation |
| T40 | integration | R47 | `recompute_trust_score` is deterministic over a fixture and responds to each of the four inputs independently; it runs nightly and on completion, cancellation, and reveal |
| T41 | rls | R48, R49 | `SELECT trust_score` fails for `authenticated` on self **and** on others; the column is absent from `profile_cards`; no `app.*` function granted to `authenticated` returns it; the API-04 contract sweep passes |
| T42 | integration | R50, R51 | Each of the four tiers is produced by its exact input set; a client `PATCH` of `trust_tier`, `trust_score`, `rating_avg`, `rating_count`, `completed_exchanges`, `cancellation_count_90d`, or `is_suspended` returns 42501 |
| T43 | integration | R52 | Static check plus runtime assertion: no query in `src/api/repositories/**`, and no RPC `ORDER BY`, references `trust_score` or `trust_tier` as a sort or filter key |
| T44 | e2e | R53, R55 | Every badge opens the explainer; the own-profile standing section renders no number, bar, percentage, or distance-to-next-tier |
| T45 | rls | R54 | A suspended user has no `profile_cards` row; their tier, average, and count are absent together rather than individually |
| T46 | integration | R56 | The extortion scenario end to end: A threatens, B rates 1, A cannot see it, A's window closes at reveal, A cannot edit. The threatening message is flagged |
| T47 | integration | R57 | 20 reports from 20 accounts against one subject: 20 rows, unchanged severity on every row, no status change, no suspension, no listing removal |
| T48 | integration | R58 | The console query returns one grouped item with a count of 20, not 20 items |
| T49 | integration | R59 | Credibility halves on each dismissal within 30 days, recovers on an `actioned` outcome, and **never** reaches zero — asserted after 20 consecutive dismissals |
| T50 | integration | R60 | A block-cancelled session leaves `cancellation_count_90d`, `counts_as_late`, `completed_exchanges`, and `trust_score` unchanged for **both** parties |
| T51 | integration | R61, R62 | A KYC pass whose identity reference hashes into `private.banned_identities` yields `failed` with the ordinary failure code and copy; timing is within noise of a genuine failure |
| T52 | integration | R63 | Every one of the eight audited actions writes exactly one `audit.events` row with the right actor and subject; `metadata` rejects a coordinate key |
| T53 | e2e | R64 | An open severity-1 report surfaces the subject's in-flight sessions to on-call, with times and safe spots |
| T54 | perf | §11 | `ratings_select_participant` and the amended `profile_cards` keep p95 under 50 ms at 10× launch volume ([RLS Design §8](../01-architecture/05-rls-design.md)); `EXPLAIN` baselines committed |
| T55 | manual | §12 | VoiceOver and TalkBack over the rate screen, the tag limit, the report reason list, and the block confirmation |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T56 | `POST /rest/v1/ratings` directly, bypassing `submit_rating` | Denied. There is no INSERT policy on `ratings` for `authenticated`; the only write path is the definer RPC. Repeated with `is_revealed: true` in the body, which is denied by the same absence |
| T57 | Rate a session you are not a participant in, by id | `not_authorized` 403 from the function's first statement. Because a definer function bypasses RLS, this check is the only thing between an attacker and a one-star rating on an arbitrary stranger |
| T58 | Submit a rating, then `PATCH /rest/v1/ratings?id=eq.X` with `{"stars":5}` before reveal | Denied — no UPDATE policy (R09). Repeated after reveal, and with `{"comment": …}`, `{"tags": …}`, and `{"is_revealed": true}` |
| T59 | Infer the counterparty's hidden rating by polling their `profile_cards` every 10 s across the reveal boundary | Nothing moves until reveal (R16), and below three ratings the average is NULL (R17), so there is no arithmetic to do. Asserted by diffing the full card payload every 10 s across a 7-day simulated window |
| T60 | Infer whether the counterparty has rated, from response size, status, latency, or a realtime event | Byte-identical responses; no realtime publication carries `ratings` at all; latency distributions overlap. `ratings` is deliberately absent from `supabase_realtime` |
| T61 | File a report with `p_severity = 1` and `reason = 'spam'` | Severity overwritten to 3 by the trigger (R22). Also attempted by a direct `INSERT` as `authenticated`, which has no INSERT policy, and by a crafted `sla_due_at`, rejected by `reports_sla_matches_severity` |
| T62 | File a report about yourself, or about a nonexistent uuid, or about a user who has blocked you | `validation_failed` 400, `request_not_found` 404, and — for the blocked case — `request_not_found` 404, because a 403 would confirm the account exists ([API Contract §3.4](../01-architecture/06-api-contract.md)) |
| T63 | As a report's subject, enumerate `reports` by id, by `subject_user_id`, through `select=*`, and through every embedded resource on `profiles`, `messages`, and `exchange_sessions` | Zero rows on every path. This is the R29 sweep and it is re-run against the live schema, not against a diff, so a new embedding fails it |
| T64 | As a reporter, `select=severity,action_taken,resolved_by` on your own report | Permission denied from the column `REVOKE`, not NULLs. A NULL would be indistinguishable from "no action yet", which is itself a disclosure |
| T65 | As the blocked party, determine you were blocked from: the listing disappearing, `profile_cards` emptiness, the thread closing, the session cancelling, the request cancelling, error codes, response timing, or a realtime event | Indistinguishable from expiry, withdrawal, decline, account deletion, and moderator removal in **all eight** channels. The session's `cancelled_reason` reads `cancelled_by_participant` (R44). Asserted on the screen and on a mitmproxy capture |
| T66 | `SELECT * FROM private.session_cancellation_causes` as `authenticated` | Permission denied at the schema level ([Data Model §3](../01-architecture/03-data-model.md)). Repeated for `private.report_evidence`, `private.banned_identities`, `private.report_credibility`, and `private.oncall_pages` |
| T67 | `INSERT INTO public.blocks` directly with `blocker_id` set to someone else | Denied by `blocks_insert_own`'s `WITH CHECK`. Blocking on someone else's behalf would let an attacker sever a victim's exchanges |
| T68 | Read `blocks` as the blocked party, by pair, by id, and by count | Zero rows on every path; `blocks_select_blocker` has no clause that admits the blocked party. A count aggregate returns 0, not a redacted number |
| T69 | `SELECT trust_score` as self, as another user, as `anon`, through `profile_cards`, through an embedded `profiles(...)` select, and through `search_listings`/`suggest_matches` return types | Denied or absent on every path (R48, R49). The API-04 contract sweep asserts no reachable type has the column ([API Contract §9.1](../01-architecture/06-api-contract.md)) |
| T70 | Recover `trust_score` by binary search over an ordering | No surface orders by it (R52); asserted by static analysis over repositories and by introspecting every RPC's `ORDER BY` |
| T71 | `PATCH /rest/v1/profiles?id=eq.<me>` with `{"trust_tier":"trusted"}`, `{"rating_avg":5}`, `{"completed_exchanges":99}`, `{"is_suspended":false}` | Each rejected with 42501 by the profile guard trigger (R51). Self-promotion to `trusted` would defeat every downstream trust decision in the product |
| T72 | Brigade: 50 accounts file `harassment` against one user in 10 minutes | 50 rows, severity unchanged at 2, one grouped queue item, **zero automatic actions** (R57). `report.brigade_suspected` notifies a moderator; the notification is informational and has no action attached to it |
| T73 | Report-bomb from one account: 200 reports in an hour | 10 succeed, the rest `rate_limited` 429. After dismissals, the quota decays toward the floor of 1/day and never reaches 0 (R59) |
| T74 | Block-griefing: block a counterparty 5 minutes before 20 different scheduled handoffs | Every session cancels; the counterparties are notified generically; **no** counterparty's `cancellation_count_90d`, `counts_as_late`, `completed_exchanges`, or `trust_score` changes (R60). The griefer's own block volume trips `block.rate_limited` and is investigated |
| T75 | Banned user re-registers: same ID, new email, new device, new IP | `verifications.status = 'failed'`, `can_transact()` false, ordinary failure copy, no mention of a ban, timing within noise (R62). `ban.registry_hit` fires to security with **no** user id in the event |
| T76 | Extortion via message: "5 stars or I report you", then a 1-star rating after seeing the other | Impossible to execute: the extortionist cannot see the other rating before their own window closes (R08), cannot edit after (R09), and cannot tell whether the other has submitted (R19). The message is flagged for the console |
| T77 | Contract sweep over `ratings`, `reports`, `blocks`, `profile_cards`, and all four RPC return types | No coordinate column, no `trust_score`, no `cancellation_count_90d`, no `handoff_code`. Nothing added to the API-04 allowlist |
| T78 | Inspect the wire for a full complete → rate → reveal → report → block session | No coordinate of any kind, no `trust_score`, no pre-reveal rating value, no block signal to the blocked party, and no `blocked` string anywhere in a participant-readable payload |
| T79 | Fire a Sentry event and a PostHog event carrying a rating comment, a report's details, and a block reason | All three dropped by the scrubber's key rules and by the analytics property allow-list; a lint rule fails the source that tried |
| T80 | Force `app.reveal_session_ratings` to run twice on the same session concurrently | Second call updates zero rows, recomputes nothing, and sends no second notification. Reveal is idempotent, and a double reveal would double-count the aggregate |

### 13.3 Manual QA

- [ ] Complete a real exchange on a preview branch, rate from both devices, and confirm neither sees the other's rating until the second submission lands.
- [ ] Complete another, rate from one device only, and let the 7-day reveal fire (with the clock advanced); confirm the one-sided reveal, the aggregate move, and the "didn't rate" copy.
- [ ] File an `unsafe_meeting` report and confirm the on-call page arrives within 60 seconds, with the evidence already attached.
- [ ] File a report, withdraw the listing thirty seconds later, and confirm the moderator still sees the listing as it was.
- [ ] Block a counterparty twenty minutes before a scheduled handoff on two devices; confirm the blocker's copy names the spot and date, and the blocked party's device shows a generic cancellation with no reason anywhere, including in a proxy capture.
- [ ] From the blocked device, try every way you can think of to detect the block — listing, profile, thread, session, request, errors, timing — and write down anything that differs.
- [ ] Confirm blocking works while signed in as a suspended account.
- [ ] Confirm the 3-rating threshold: watch a profile go from "New here" to a number on the third reveal.
- [ ] Attempt to read your own `trust_score` through the app, through PostgREST, and through every embedded select you can construct.
- [ ] Screen-reader pass over the rate screen at the 4-tag limit, the report reason list, and the block confirmation's four bullets.
- [ ] Confirm every string at 200% type in both themes, particularly the block confirmation and the tier explainer.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `trust.tier_badges` (R50, R53) — default-on, flagged because the badge is the only part of this spec that is presentational and could be wrong in a way that is better switched off than patched. **Ratings, reports, and blocks are not flagged**: an app that arranges meetings between strangers without a reporting and blocking path cannot be submitted ([PRD §5](../00-foundation/02-prd.md), Apple Guideline 1.2), let alone shipped. |
| Migration required | Yes. `20260808_0121_trust_and_safety.sql` — five `private` tables, four CHECKs, two partial unique indexes, three triggers (including the **amended** `on_block_created`), the redefined `profile_cards` view, six `app.*` functions, four RPCs, and two `pg_cron` jobs. RLS policies and pgTAP tests ship in the same PR ([Data Model §15.4](../01-architecture/03-data-model.md)). |
| Backfill required | Yes, conditionally. The `profile_cards` redefinition changes `rating_avg` to NULL below three ratings, which is a **narrowing** of an existing shape and therefore breaks the additive-only rule ([API Contract §3.2](../01-architecture/06-api-contract.md)) — it is permitted here only because the client already renders a nullable `rating_avg` and no production rows exist at MVP. The migration asserts `rating_count = 0` across `profiles` and **fails loudly** if that stops being true. `trust_score` is recomputed for every profile in the same migration. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A bad reveal job is disabled with `cron.unschedule('reveal_ratings')`, which is safe precisely because the policy's `is_revealed` clause is the guarantee and the job only flips the flag — reveal stops happening and nothing leaks early. A bad `on_block_created` is **not** rollback-safe and has no kill switch: reverting to the previous version reintroduces the `cancelled_reason = 'blocked'` disclosure (R44), so any fix is forward, and the migration is gated on T38 passing in CI. |
| Client version floor | None for ratings and reports. **A floor exists for blocks**: a client older than the release containing this migration renders `cancelled_reason` verbatim, which is now the generic string — so nothing leaks — but it will not show the R40 counts. Acceptable; tracked by `devices.app_version`. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | [API Contract §5.5](../01-architecture/06-api-contract.md) specifies `create_report` returning `{ report_id, sla_due_at }` while also asserting "the response never differs by reason". Those cannot both hold: `sla_due_at` is one hour for `unsafe_meeting` and 24 for everything else, which is an escalation disclosure. This spec returns `{ report_id, filed_at }` (R25). **The API contract needs a corresponding edit.** | Architecture | Before implementation starts |
| Q2 | [RLS Design §4](../01-architecture/05-rls-design.md) says `trust_score` "must be visible to the user themselves and to moderators", but the mechanism it specifies — a role-wide column `REVOKE` — cannot express that and denies self-reads too. This spec takes the stricter reading and forbids self-visibility on purpose (R49). **Either the wording or the mechanism has to change**; we recommend the wording. | Architecture + Security | Before implementation starts |
| Q3 | [PRD C12](../00-foundation/02-prd.md) lists `other` as a user-facing report reason; R21 removes it from the picker. An "Other" bucket is cheap to offer and expensive to triage, and its removal means a genuinely novel harm has no home until a moderator reclassifies. Is six the right number, or is the correct answer six plus a clearly-labelled "Something else" that routes to a lower-priority queue? | Product + Trust & Safety | Before launch |
| Q4 | Is 7 days the right reveal window? Shorter means a faster signal and more one-sided reveals; longer means more reciprocity and a staler rating. It is a guess, and R08 makes it also the rating deadline, which couples two decisions that might want different answers. | Product | Post-launch, first season |
| Q5 | R61 stops a banned user reusing the same government ID. It does not stop a second genuine ID, a family member's ID, or a jurisdiction we don't cover. What is the acceptable residual, and at what point does it justify a device-signal control that [Location Privacy §12](../01-architecture/04-location-privacy.md) would otherwise refuse? | Security + Legal | Before the second launch metro |
| Q6 | Should `no_show` be reportable at all, given the same question about automatic filing? **Deferred to [Exchange State Machine Q2](../01-architecture/07-exchange-state-machine.md), which is the canonical row.** The question was open in three documents at once; it is answered there, and this row and [SPEC-010 Q3](SPEC-010-exchange-lifecycle.md) adopt the answer. Two paths to the same fact will double-count unless one defers, and this row is the one that defers. | *see arch Q2* | Before launch |
| Q7 | Should a `trusted` tier exist in MVP at all? Reaching it needs 10 completed exchanges, which almost nobody will have in a seeded launch metro, so for the first season the badge will be a near-empty category that mostly signals "not trusted" by its absence. | Product | Before launch |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Trust & Safety + Backend Engineering | Initial spec |
