# SPEC-010: Exchange Lifecycle

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.2.0 |
| **Owner** | Backend Engineering |
| **Phase** | MVP |
| **Security review** | required |
| **Schema depends on** | [SPEC-003](SPEC-003-identity-verification.md), [SPEC-006](SPEC-006-crop-inventory.md), [SPEC-007](SPEC-007-safe-spots.md), [SPEC-009](SPEC-009-listings-and-offers.md) |
| **Behaviourally coupled with** | SPEC-011, SPEC-012, SPEC-013 |
| **Related ADRs** | [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md), [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

The exchange lifecycle is the product: it carries two strangers from "I'd like your tomatoes" to two people standing in a library lobby who both press a button, and it is the only part of Sharecropr where a software bug puts a real person in a car park for nothing. It implements — without deviation — the two coupled state machines, the eight concurrency hazards, the lock order, and the error taxonomy defined normatively in [Exchange State Machine](../01-architecture/07-exchange-state-machine.md), and it is the reason `exchange_requests` and `exchange_sessions` have no client `UPDATE` policy at all. Everything here exists to make one guarantee hold under concurrency: **one listing, one reservation, one meeting, and both people know the same facts about it.**

## 2. Goals

- Implement [Exchange State Machine](../01-architecture/07-exchange-state-machine.md) §2, §3, §4, §5, §6, §8, and §9 exactly. Where this spec adds detail, it adds it *inside* that document's constraints; where it would contradict, the architecture document wins and this spec is wrong.
- Make concurrent acceptance of one listing **structurally impossible**, not merely unlikely — under 50 simultaneous acceptors, under two devices on one account, and under a client that replays a mutation after a timeout.
- Make every transition atomic across `listings`, `exchange_requests`, `exchange_sessions`, `inventory_items`, `message_threads`, and the notification outbox, so there is no committed state in which one of those six disagrees with the others.
- Give the meeting itself a shape people already understand — a time, a named public building, and a six-digit code — with **no background location, no geofence, and no presence signal**.
- Be honest, in the product and in this document, that the handoff code proves co-presence only among honest people. It is a coordination device.
- Make cancellation cheap enough that people do it instead of ghosting, and expensive enough that doing it an hour beforehand costs something.
- Give the client a mirror of the server's machine that cannot silently drift, so the app never renders a button for a transition the server will reject.
- Make every failure legible: the stable error codes of [Exchange State Machine §9](../01-architecture/07-exchange-state-machine.md), each with exactly one client behaviour and exactly one string. The count lives in that table and nowhere else — this line said "eleven" while the spec used sixteen, which is what a number in prose does.

## 3. Non-Goals

- **Money, escrow, deposits, cancellation fees, or "no-show insurance."** There is no currency column ([ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md), [Data Model §1](../01-architecture/03-data-model.md)). The consequence of a late cancellation is `cancellation_count_90d` and a trust tier, not a charge.
- **Geofenced or BLE-proximity arrival confirmation.** Deferred to Phase 3 with explicit per-exchange opt-in ([Mobile Architecture §7](../01-architecture/02-mobile-architecture.md)). The handoff code exists precisely so that co-presence coordination ships without requesting background location, and the background-location entitlement is absent from `app.json` so it cannot be added by accident.
- **Presence, typing indicators, or "on my way" live status.** Presence in an app that arranges physical meetings tells a stalker when their target is awake ([Realtime & Notifications §8.3](../01-architecture/08-realtime-and-notifications.md)).
- **Partial-quantity reservations.** One listing reserves one item, whole. Splitting 10 lb of tomatoes between two people turns hazard H1 from "one winner" into a sum-check under a lock and is [Exchange State Machine Q1](../01-architecture/07-exchange-state-machine.md).
- **Un-declining, un-cancelling, un-expiring, or any form of state resurrection.** Terminal states are terminal (R20). The remedy is a new request, which re-runs every guard.
- **Rescheduling after `no_show`, `cancelled`, or `disputed`.** Those sessions are over. A new request creates a new session with a new code.
- **Multi-party exchanges, chains, or three-way swaps.** Two participants, denormalized as `owner_id` and `requester_id`, are what every policy and every lock in this spec assumes.
- **Ratings.** Completion unlocks them; the rating flow, its double-blind reveal, and its effect on trust are [SPEC-012](SPEC-012-trust-and-safety.md).
- **Messaging.** The thread is created here and closed here; everything that happens inside it is [SPEC-011](SPEC-011-messaging.md).
- **Meeting anywhere that is not a curated safe spot.** There is no free-text location field on a session, and that absence is a safety property ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)).
- **Automatic report filing on a no-show.** MVP prompts; it does not file. See Q3.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **requester**, I want to ask for a listing and optionally offer something of mine, so the owner can judge whether it's a fair swap. | P0 |
| US-02 | As an **owner**, I want to see who's asking, what they're offering, and what their rating is, before I commit to meeting them. | P0 |
| US-03 | As an **owner**, I want accepting one request to decline the rest automatically, so nobody is left hanging and nobody else drives out. | P0 |
| US-04 | As a **requester**, I want to know quickly that I lost, rather than waiting three days to find out. | P0 |
| US-05 | As a **requester**, I want to withdraw a request I've changed my mind about, without messaging anyone. | P0 |
| US-06 | As **either party**, I want to agree a place and a time inside the app, from the spots the owner already offered. | P0 |
| US-07 | As **either party**, I want to be stopped from proposing a time the library is shut. | P0 |
| US-08 | As **either party**, I want a reminder the day before and two hours before, because I will forget. | P0 |
| US-09 | As **either party**, I want a simple way to confirm we actually met, that doesn't need my location. | P0 |
| US-10 | As **either party**, I want completion to require *both* of us, so one person can't mark an exchange done that never happened. | P0 |
| US-11 | As **either party**, I want to cancel with a reason if my plans change, and I want to be told plainly that a late cancellation counts against me. | P0 |
| US-12 | As **someone who was stood up**, I want the system to notice, tell me, and record it, without me having to file anything. | P0 |
| US-13 | As **either party**, I want the time and place readable at the meeting even with one bar of signal. | P0 |
| US-14 | As **either party**, I want the app to never show me a button that does nothing. | P1 |
| US-15 | As **someone with a bad connection**, I want a retried tap to not create two requests or two sessions. | P0 |
| US-16 | As **someone who reported an unsafe meeting**, I want the exchange frozen while it's looked at. | P0 |
| US-17 | As a **screen-reader user**, I want the exchange state, the next action, and the handoff code read as one coherent statement. | P0 |
| US-18 | As **someone whose counterparty is guessing my handoff code**, I want to know about it. | P1 |

## 5. Functional Requirements

### 5.1 Sending a request

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | An `exchange_requests` row MUST be created only through `rpc.create_exchange_request`. `requests_insert_requester` ([RLS Design §5 Pattern C](../01-architecture/05-rls-design.md)) remains on the table as a backstop expressing the same guards, so a direct PostgREST insert is denied rather than merely unsupported — but it is not a client path and no shipped repository function uses it. |
| R02 | **MUST** | Creation MUST require `app.can_transact()` — identity verified, garden verified, not suspended. Browsing and inventory are never gated on this; asking a stranger to meet you always is. |
| R03 | **MUST** | Creation MUST assert, **inside** the transaction, that the listing is `status = 'active'` and `expires_at > now()`. A listing that became `reserved` a millisecond ago returns `listing_unavailable` 409, not a request nobody can accept. |
| R04 | **MUST NOT** | A user MUST NOT request their own listing. Enforced by the `no_self_request` CHECK ([Data Model §10](../01-architecture/03-data-model.md)) **and** by an explicit guard returning `validation_failed` 400, because a CHECK violation surfaces as an unreadable 23514. |
| R05 | **MUST** | Creation MUST fail with `blocked` 403 when `app.is_blocked_either_way(requester, owner)` is true. In practice the listing is already invisible under `listings_select_discoverable`; this is the second layer, and it is the one that holds when a block is created between the read and the write. |
| R06 | **MUST** | A requester MUST NOT hold more than one `pending` request against one listing, enforced by `exchange_requests_one_pending` on `(listing_id, requester_id) WHERE status = 'pending'`. A second attempt returns `conflict` 409. |
| R07 | **MUST** | A requester MUST NOT hold more than **10 open (`pending`) requests** across all listings; the 11th returns `quota_exceeded` 422. This is the structural half of the spam control; the 10/hour rate limit (R13) is the temporal half, and neither substitutes for the other. |
| R08 | **MUST** | If `offered_item_id` is supplied it MUST be owned by the requester and MUST have `inventory_status = 'available'`, checked inside the transaction. An offer of an item already promised elsewhere is a second broken promise waiting to happen. |
| R09 | **MUST** | `message` MUST be ≤ 300 characters and optional, and MUST be written into the thread as the first `user` message in the same transaction ([SPEC-011 R04](SPEC-011-messaging.md)). It is not a separate field the recipient has to find. |
| R10 | **MUST** | `create_exchange_request` MUST create the `message_threads` row in the same transaction as the request ([PRD C11](../00-foundation/02-prd.md)), and MUST return its id. The `INSERT … ON CONFLICT (request_id) DO NOTHING` inside `accept_exchange_request` is an **idempotent backstop for a request created before this rule existed**, not a second creation path. |
| R11 | **MUST** | `expires_at` MUST default to `now() + interval '72 hours'`, and the `expire_requests` job MUST run every 5 minutes moving `pending` → `expired` past that time. |
| R12 | **MUST** | If `proposed_safe_spot_id` is supplied it MUST be a member of the listing's `listing_safe_spots` set and `status = 'active'`. It is **advisory**: it pre-fills the scheduling screen and binds nothing. The binding choice is made in `propose_schedule` (R35). |
| R13 | **MUST** | `create_exchange_request` MUST be rate limited to **10 / hour / user** and MUST take `p_idempotency_key uuid`, returning the original row on replay rather than a 409 ([API Contract §3.1](../01-architecture/06-api-contract.md)). |
| R14 | **MUST** | Creation MUST enqueue a `request_received` notification to the owner through `app.enqueue_notification`, in the same transaction. No HTTP call happens inside the transaction, ever ([Realtime & Notifications §3](../01-architecture/08-realtime-and-notifications.md)). |

### 5.2 Resolving a request

| ID | Req | Statement |
| --- | --- | --- |
| R15 | **MUST** | `rpc.decline_exchange_request` MUST require the caller to be `owner_id` and the request to be `pending`, and MUST set `status = 'declined'` and `responded_at = now()`. |
| R16 | **MUST** | A decline reason MUST be ≤ 200 characters, optional, and MUST NOT be returned to the requester by any read path. It exists for moderation context and for our own analysis, and telling someone why they were turned down is a conversation, not a field. |
| R17 | **MUST** | `rpc.withdraw_exchange_request` MUST require the caller to be `requester_id` and the request to be `pending`, and MUST notify the owner **in the inbox only** — no push. A withdrawn request is the absence of an obligation, not an event worth buzzing a phone for. |
| R18 | **MUST** | `expire_requests` MUST process in bounded batches of **500** with `FOR UPDATE SKIP LOCKED`, and MUST notify the requester in the inbox. A request that silently evaporates teaches people the app doesn't work. |
| R19 | **MUST** | A request MUST transition `pending` → `cancelled` when any of these occurs: a block is created between the parties (`on_block_created`, [RLS Design §6](../01-architecture/05-rls-design.md)), the listing is withdrawn ([SPEC-009 R40](SPEC-009-listings-and-offers.md)), or either party is suspended. |
| R20 | **MUST NOT** | A request MUST NOT leave a terminal state. `accepted`, `declined`, `withdrawn`, `expired`, and `cancelled` are absorbing, enforced by the `trg_guard_request_transition` trigger over `private.legal_request_transitions` (§6), not by convention and not only by the RPCs. |
| R21 | **MUST NOT** | A requester auto-declined by someone else's acceptance MUST NOT be distinguishable from one declined by hand. Same `request_status`, same `request_declined` notification, same copy, same wire response. Revealing "you lost a race" invites re-requesting on a cadence, and revealing "they chose someone else" is information about a third party. |
| R22 | **MUST** | There MUST be no un-decline, un-withdraw, or reopen path. A user who changes their mind sends a new request, which re-runs R02–R08 in full. This removes an entire class of race conditions at the cost of one extra tap. |

### 5.3 Acceptance — the critical section

| ID | Req | Statement |
| --- | --- | --- |
| R23 | **MUST** | Acceptance MUST go through `public.accept_exchange_request(p_request_id uuid, p_idempotency_key uuid)`, whose body is specified verbatim in [Exchange State Machine §4](../01-architecture/07-exchange-state-machine.md). This spec does not restate it and MUST NOT diverge from it; a change to that function is a change to that document first. |
| R24 | **MUST** | The function MUST short-circuit on idempotency **before taking any lock**, in two layers: `app.idempotency_probe` on the key (R80), then a lookup of the existing session for `(request_id, owner_id)` which catches a retry that arrived with a *new* key. Both return `session_id` alone — **never the handoff code** (R30). A replay that queues behind a lock is a replay that can deadlock. |
| R24a | **MUST** | The rate limit MUST also be consumed before the locks, for the same reason: a limiter that queues behind a lock amplifies exactly the load it exists to shed. |
| R25 | **MUST** | Every function touching more than one of `listings`, `exchange_requests`, `exchange_sessions` MUST take them in the global order **`listings → exchange_requests → exchange_sessions`**, and MUST carry that order as a comment at the top of its body. This is hazard H7's control and it is a code-review obligation, not a runtime one. |
| R26 | **MUST** | Because the function is `SECURITY DEFINER` and therefore bypasses RLS, it MUST re-check authorization by hand as its first act after the idempotency probe: caller is `owner_id` (`not_authorized` 403), `app.can_transact(v_uid)` (`not_verified` 403), and `NOT app.is_blocked_either_way(owner, requester)` (`blocked` 403). |
| R26a | **MUST** | It MUST also check `app.can_transact(requester_id)` inside the lock, returning **`request_not_pending` 409 — deliberately the same code as a resolved request**. R19's suspension fanout cancels these rows, but the fanout is a trigger and this is the microsecond before it ran. Reusing the code is not laziness: the owner must not learn from an error that the person who asked them for tomatoes has just been suspended. |
| R27 | **MUST** | State assertions MUST be evaluated **while both locks are held**: request `pending` (`request_not_pending` 409), request unexpired (`request_expired` → surfaced as `request_not_pending`), listing `active` (`listing_unavailable` 409), listing unexpired (`listing_expired` 409). An assertion outside the lock is a check that was true once. |
| R28 | **MUST** | Acceptance MUST, in one transaction: set the listing to `reserved` with `reserved_request_id`; set the request to `accepted` with `responded_at`; decline every other `pending` request on that listing; set the inventory item to `reserved`; insert the `exchange_sessions` row in state `scheduling` with a `handoff_code`; ensure the `message_threads` row exists. All six or none. |
| R29 | **MUST** | The auto-decline MUST be a single set-based `UPDATE … WHERE listing_id = $1 AND id <> $2 AND status = 'pending'` inside the same transaction. Never a loop, never a follow-up call, never a cron catch-up — a losing requester who is still `pending` after the winner is chosen can be accepted a second time by a stale client. |
| R30 | **MUST** | `handoff_code` MUST be six digits generated from `gen_random_bytes(3)` by **rejection sampling**, **encrypted with `pgp_sym_encrypt` against the Vault key `handoff_code_key`**, and stored as `bytea` ([Exchange State Machine §3.3](../01-architecture/07-exchange-state-machine.md)). The plaintext MUST exist only as a local variable inside `accept_exchange_request` and MUST NOT be returned: `RETURNS TABLE (session_id uuid)` is the whole return type. It MUST NOT be exposed until the session reaches `scheduled` (R45). |
| R30a | **MUST NOT** | The generator MUST NOT use a bare `% 1000000` over a 24-bit draw. 2²⁴ = 16,777,216 is not a multiple of 10⁶, so codes `000000`–`777215` come out **6.25% more often** than the rest. Discard draws ≥ 16,000,000 and take the modulo of what remains; expected iterations 1.05. The `lpad` argument MUST be cast with `::text` — there is no `lpad(integer, integer, text)` in Postgres and the un-cast form does not resolve at all. |
| R31 | **MUST** | Notifications MUST be enqueued through the transactional outbox in the same transaction: `request_accepted` to the winner, and `request_declined` to each loser via `app.enqueue_notification_bulk_declined(listing_id, winning_request_id)`. |
| R32 | **MUST** | Acceptance MUST write `audit.events` with `action = 'exchange.accepted'`, `subject_type = 'session'`. Session state transitions are on the audited-actions list ([Data Model §12](../01-architecture/03-data-model.md)). |
| R33 | **MUST** | `EXECUTE` on every RPC in this spec MUST be `REVOKE`d from `PUBLIC` and `anon` and granted only to `authenticated`. A definer function reachable by `anon` is a privilege escalation with a REST endpoint. |

### 5.4 Scheduling

| ID | Req | Statement |
| --- | --- | --- |
| R34 | **MUST** | A session MUST begin in `scheduling` and MUST reach `scheduled` only through `rpc.propose_schedule` followed by `rpc.confirm_schedule` by the other party. There is no direct write path; `exchange_sessions` has no client `UPDATE` policy ([API Contract §1.3](../01-architecture/06-api-contract.md)). |
| R35 | **MUST** | `p_safe_spot_id` MUST be a member of the `listing_safe_spots` set of the listing behind this session. Not "any active safe spot" — the owner published to one to three specific places and agreed to travel to those. A spot outside the set returns `validation_failed` 400. |
| R36 | **MUST** | The chosen spot MUST have `safe_spots.status = 'active'` at propose time **and** be re-checked at confirm time. A spot suspended between the two returns `validation_failed` 400 with the spot-suspended copy (§8.3), because the interval between proposing and confirming is measured in hours. |
| R37 | **MUST** | `scheduled_start` MUST satisfy `>= now() + interval '1 hour'` and `<= now() + interval '14 days'`. Below an hour there is no time to travel; beyond a fortnight the produce is a different product. |
| R38 | **MUST** | `scheduled_end` MUST satisfy `>= scheduled_start + interval '15 minutes'` and `<= scheduled_start + interval '2 hours'`, enforced by the `sessions_window_length` CHECK. The window is a meeting slot, not an availability calendar; an eight-hour window makes `detect_no_shows` meaningless. |
| R39 | **MUST** | `app.venue_open_during(p_safe_spot_id, p_start, p_end)` ([SPEC-007 R22](SPEC-007-safe-spots.md)) MUST return true, evaluated in the **venue's** timezone. A false return raises `venue_closed` 422 and the client shows the venue's hours from the response rather than from its own clock ([SPEC-007 EC-13](SPEC-007-safe-spots.md)). |
| R40 | **MUST** | `confirm_schedule` MUST be callable only by the party who did **not** make the current proposal. Confirming your own proposal returns `validation_failed` 400. One person agreeing with themselves is not agreement. |
| R41 | **MUST** | A new `propose_schedule` from either party MUST supersede the outstanding proposal, overwrite `schedule_proposed_by` / `schedule_proposed_at`, and leave the session in `scheduling`. There is no "counter-offer" object and no proposal history; the session carries the current proposal and the thread carries the negotiation. |
| R42 | **MUST** | Every session-mutating RPC MUST accept `p_expected_version integer` and MUST increment `version` on every successful mutation. `propose_schedule`, `confirm_schedule`, and `cancel_session` MUST raise `stale_state` 409 on a mismatch — these are *decisions* about state, and a decision made against a screen that has moved is the wrong decision. This is hazard H5's control. |
| R42a | **MUST NOT** | `confirm_handoff` MUST NOT reject on a version mismatch. There the version is **advisory**: accepted, returned for the client's cache, never a guard. A strict check defeats R74 outright — two parties confirming in the same instant both hold version *N*, the first commits *N+1*, and the second is rejected with `stale_state` for the exact case the H4 atomic statement exists to handle. A handoff confirmation is not a decision about state; it is a claim that a person is standing there, and that claim is true whatever version the client holds. The `WHERE state IN ('scheduled','in_progress')` predicate is this RPC's concurrency control ([Exchange State Machine §5 H5](../01-architecture/07-exchange-state-machine.md)). |
| R43 | **MUST** | `remind_upcoming` MUST run every 15 minutes and notify both parties **24 hours** and **2 hours** before `scheduled_start`. The 2-hour reminder is not quiet-hours suppressible ([Realtime & Notifications §5](../01-architecture/08-realtime-and-notifications.md)); suppressing it produces a no-show, and a no-show damages a real person's trust score. |
| R44 | **MUST NOT** | No scheduling response, notification, realtime payload, or route parameter MUST carry any coordinate other than `safe_spots.point` — a public building on the two-line CI allowlist (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)). |

### 5.5 Handoff and completion

| ID | Req | Statement |
| --- | --- | --- |
| R45 | **MUST** | One six-digit code MUST be available to **both** parties **by the same gated read**, and MUST NOT be readable until the session is `scheduled`. It is fetched by `rpc.get_handoff_code` from the handoff screen and by nothing else ([API Contract §5.4](../01-architecture/06-api-contract.md)). `SELECT (handoff_code)` MUST be `REVOKE`d from `authenticated`, so the column cannot be read directly even by a participant — the RPC is the only decrypt path in the system. There is no path by which one party is handed the code and the other has to fetch it: the accept RPC returns `session_id` alone (R30) and the `request_accepted` payload carries `session_id` alone. |
| R46 | **MUST** | `confirm_handoff` MUST accept the code only within `scheduled_start − 30 minutes … scheduled_end + 2 hours`. Outside it, `validation_failed` 400 with the too-early / too-late copy (§8.3). |
| R47 | **MUST** | The first correct confirmation MUST move the session to `in_progress`; the second, **by the other party**, MUST move it to `completed`. Both MUST be performed by the single atomic `UPDATE … RETURNING` in [Exchange State Machine §5 H4](../01-architecture/07-exchange-state-machine.md), which sets the caller's own column and derives the new state from the other's — never read-then-write. |
| R48 | **MUST NOT** | One party MUST NOT be able to complete a session alone, by any sequence of calls, at any interval. A second confirmation from the same party is idempotent: it re-stamps nothing and returns the current state. |
| R49 | **MUST** | **5 wrong code attempts on one session inside a rolling 15-minute window** MUST lock confirmation on that session for 15 minutes (`handoff_locked_until`), return `rate_limited` 429 with `Retry-After`, and enqueue a `safety_alert` to **both** parties. The limit is per **session**, not per user, because the abuse case is brute-forcing one six-digit code. The window is real: `handoff_window_started_at` opens on the first failure and resets when it lapses, so a pair who fumble twice on Tuesday do not carry those attempts into Saturday. |
| R49a | **MUST NOT** | A wrong-code attempt MUST NOT be recorded by a statement that a subsequent `RAISE EXCEPTION` will roll back. **This is the defect that made R49 decorative in the first draft**: the counter increment, the lockout timestamp, and both `safety_alert` outbox rows all shared a transaction with the `RAISE` that aborted them, so `handoff_attempts` was permanently 0 and no lockout ever fired. `confirm_handoff` MUST therefore **return a result rather than raise** on a wrong code or a closed window — the transaction commits, the counter sticks, and the client maps `ok = false` to the right screen. Raising is reserved for conditions with no state to preserve (`not_authorized`, `invalid_transition`, `request_not_found`). |
| R49b | **MUST** | The response on a wrong code MUST carry `attempts_remaining`, so the handoff screen can announce it through a polite live region (§12) instead of leaving a screen-reader user to count red flashes. |
| R50 | **MUST** | Completion MUST, in one transaction: set the listing to `completed`, the inventory item to `exchanged`, increment `completed_exchanges` for both parties, set `completed_at`, unlock ratings ([SPEC-012](SPEC-012-trust-and-safety.md)), and schedule the thread to close in 14 days ([SPEC-011 R21](SPEC-011-messaging.md)). |
| R51 | **MUST NOT** | `handoff_code` MUST NOT appear in the realtime publication, in any push title or body, in any list select, in MMKV, in a log line, in a Sentry breadcrumb, or in an analytics property. Enforced by the publication column list, the fixed select constants, the MMKV allow-list, and the pgTAP assertion over `pg_publication_tables` (API-08). |
| R52 | **MUST NOT** | The handoff code MUST NOT be described — in the app, in support copy, in the store listing, or in this spec — as an anti-fraud, identity, or verification control. **It is a coordination device, not an anti-fraud control.** It can be read aloud over the phone, so it proves co-presence only if both parties are honest, and calling it more than it is would make a safety claim we cannot keep. Real co-presence proof needs geofencing or BLE proximity, both Phase 3 and both opt-in. |
| R53 | **MUST NOT** | Handoff confirmation MUST NOT be queueable offline. Failure is a retry button and never a queue: a confirmation that sits in a queue while its owner walks away is a completed exchange that never happened ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)). |
| R54 | **MUST** | The submitted code MUST be decrypted and then compared in **constant time** against the stored value and against nothing else. A short-circuiting comparison over six digits is a timing oracle worth about 10 bits, which is not nothing when the search space is 10⁶ and there are five attempts. Encryption does not remove this requirement — the comparison happens on plaintext either way, and `pgp_sym_decrypt` runs before it on every attempt, correct and incorrect alike, so the decrypt itself leaks nothing. |
| R55 | **MUST** | `completed_at` MUST be set by the same statement that sets `state = 'completed'`. A follow-up `UPDATE` is a second chance to lose the race that H4 exists to prevent. |

### 5.6 Cancellation

| ID | Req | Statement |
| --- | --- | --- |
| R56 | **MUST** | `cancel_session` MUST require `p_reason` of 1–200 characters. The reason is mandatory and it is the whole point: "cancelled" is a fact the counterparty can do nothing with, and "the library closed early" is one they can. Enforced by the `sessions_reason_required` CHECK as well as by the RPC. |
| R57 | **MUST** | Cancellation MUST be legal only from `scheduling` and `scheduled`. From `in_progress` it returns `invalid_transition` 409 — at that point at least one person is standing there and the honest outcomes are `completed` or `no_show`. |
| R58 | **MUST** | Cancelling **less than 4 hours before `scheduled_start`** MUST set `counts_as_late = true`, return `counts_as_late: true`, and increment the canceller's `cancellation_count_90d`. The threshold is a product decision about travel time, not a technical one, and the client MUST state it before the user commits (§8.3). |
| R59 | **MUST** | Cancellation MUST, in one transaction: set `state = 'cancelled'`, `cancelled_by`, `cancelled_reason`, `cancelled_at`; return the listing to `active`; return the inventory item to `listed`; and leave `listings.expires_at` **unchanged**, so a listing cancelled after its window has passed expires on the sweeper's next tick ([SPEC-009 EC-12](SPEC-009-listings-and-offers.md)). |
| R60 | **MUST** | Both parties MUST receive `exchange_cancelled`. The **reason lives in the inbox row only and never in the push body** — a cancellation reason on a lock screen is a harassment vector ([Realtime & Notifications §5](../01-architecture/08-realtime-and-notifications.md)). This notification is not quiet-hours suppressible: someone may be about to drive somewhere. |
| R61 | **MUST** | `cancel_session` and `withdraw_exchange_request` MUST remain callable by a user who has lost `app.can_transact()` through suspension or verification expiry. **You can always get out** ([API Contract §5.4](../01-architecture/06-api-contract.md)). A user who cannot cancel is a user who becomes a no-show. |
| R62 | **MUST** | A cancelled session's `exchange_requests` row MUST remain `accepted`. Requests are terminal (R20); the session carries the outcome. Renewed interest is a new request against the now-`active` listing. |
| R63 | **MUST** | `cancel_session` MUST be rate limited to **20 / day / user** — generous, because throttling a safety-adjacent exit is how a limit becomes a trap, and abusive cancellation is handled by `cancellation_count_90d` and moderation rather than by a 429. |
| R63a | **MUST** | The remaining limits MUST be enforced through `app.consume_token` and MUST each have a test: `accept_exchange_request` **30/hour/user**, `decline_exchange_request` and `withdraw_exchange_request` **60/hour/user** each, `propose_schedule` and `confirm_schedule` **30/hour/user** each. These were stated only in a §9 prose cell in the first draft, which meant no requirement number, no traceability row, and therefore no test — the one place the `MUST`-to-test CI check cannot see. **Test: T93.** |
| R63b | **MUST** | Every limit MUST be consumed **before** the function takes any lock. A limiter that queues behind a lock amplifies the load it exists to shed. |

### 5.7 No-show, dispute, and ties

| ID | Req | Statement |
| --- | --- | --- |
| R64 | **MUST** | `detect_no_shows` MUST run every 15 minutes over sessions in `scheduled` or `in_progress` whose `scheduled_end` is more than **2 hours 15 minutes** in the past, moving them to `no_show`, releasing the reservation, and notifying both parties. The extra 15 minutes is a deliberate buffer against R46, which accepts a confirmation until `scheduled_end + 2 h` **exactly** — at the same instant the sweeper would fire. `FOR UPDATE SKIP LOCKED` protects the cron from the user, not the user from the cron: without the buffer, a person confirming at the boundary can block on the sweeper's lock and then fail with `invalid_transition` against a row that just became `no_show`. A no-show recorded 15 minutes late costs nothing. A confirmation rejected because a cron won a millisecond costs a real completed exchange, in a lobby, in front of a stranger. |
| R65 | **MUST** | When exactly one party confirmed, the **other** party MUST accrue the no-show marker (`no_show_by`). This is the only attribution the data supports, and it is exactly as strong as the honesty assumption in R52 — which is why a no-show marker is an input to moderation and to `trust_score`, never an automatic sanction. |
| R64a | **MUST** | A party carrying a no-show marker MUST be able to clear it with **one tap**, through `rpc.contest_no_show`, which sets `no_show_by = NULL` and records `no_show_contested_by` / `no_show_contested_at`. The session state does **not** change: `no_show` stays terminal and the exchange stays over. Only the attribution moves, because attribution is the only part of a no-show that names a person. The reason this exists is EC-22: someone who stood in the lobby with no signal is indistinguishable in the data from someone who never came, and R65 blames them both. A marker that cannot be answered is a punishment for bad reception. |
| R64b | **MUST** | Contesting MUST write a `no_show_contested` trust signal and MUST be visible to moderation. It is **not** a hard clear: one contest is a person explaining themselves, and eleven contests is a pattern. The signal feeds `trust_score` and the moderation console; it does not auto-action, auto-suspend, or auto-restore. **If the contest rate runs high (> 40% of markers), the correct response is to reduce the marker's weight in `trust_score`, not to add friction to contesting** — a high rate is evidence about R65's attribution, not about the people using the mechanism. The instinct to make a clearing path harder when it is used a lot is exactly backwards here ([Development Notes N-12](../07-review/02-development-notes.md#n-12--contesting-a-no-show-weakens-the-signal-it-corrects)). |
| R64c | **MUST** | Contesting MUST be available only to the party the marker is against, only while it exists, only once, and only within **7 days** of `scheduled_end`. A second attempt returns `conflict` 409. The window is generous because the person most likely to need it is the person least likely to open the app that evening. |
| R64d | **MUST** | The counterparty MUST be notified that the marker was contested, in the **inbox only** — no push. They MUST NOT be told anything the contester wrote, because there is no free-text field: one tap, no narrative, nothing to weaponize. A contest is not an accusation and must not read as one. |
| R66 | **MUST** | When **neither** party confirmed, the session MUST become `no_show` with `no_show_by = NULL` and **no marker on either party**. Two people who both failed to press a button are indistinguishable from two people who met and forgot, and guessing between them would punish the wrong person about half the time. |
| R67 | **MUST** | A report filed against a session that is non-terminal, or that completed within the last **72 hours**, MUST freeze it to `disputed` pending moderation ([SPEC-012](SPEC-012-trust-and-safety.md)). All four edges — `scheduling`, `scheduled`, `in_progress`, `completed` → `disputed` — MUST be present in `private.legal_session_transitions`. A session must be freezable **from the state it is actually in**, and `scheduled` is the state in which someone has a confirmed time and place with a person they have become afraid of; an earlier draft omitted that edge and made the most important freeze in the product unreachable. `completed → disputed` is the one transition out of a state that is terminal to participants, and it exists because "it's done" is exactly what a bad actor wants recorded. |
| R68 | **MUST** | `disputed` MUST be terminal **from the client's perspective**: no participant RPC transitions out of it, and `PARTICIPANT_TRANSITIONS.disputed` is empty (R81). Resolution is a moderator action through `moderation-action` ([API Contract §6.6](../01-architecture/06-api-contract.md)), audited as `exchange.dispute_resolved`, with the participants notified via `moderation_outcome`. |
| R68a | **MUST** | Resolution MUST move the session to `cancelled` or `completed` per [Exchange State Machine §3.2](../01-architecture/07-exchange-state-machine.md), and `disputed → cancelled` MUST call `app.release_reservation` — listing → `active`, item → `listed`, `reserved_request_id` nulled. **A `disputed` session holds its reservation.** `expire_listings` never touches `reserved` (R78) and `detect_no_shows` never revisits a terminal state, so without this the owner can never relist that item: `listings_one_active_per_item` covers `reserved`, and the row is frozen for as long as the dispute is. `counts_as_late` MUST NOT be set by a moderated outcome. |
| R68b | **MUST** | `app.finalize_completed_session` MUST be **idempotent**, because `disputed → completed` may resolve a session that already ran it and may resolve one that never did. A second call MUST NOT double-increment `completed_exchanges`, re-flip an already-`exchanged` item, or re-schedule the thread close. |
| R68c | **MUST** | `dispute_sla_breach` MUST run hourly and alert on any session in `disputed` for more than **7 days**. There is deliberately no automatic resolution: guessing the outcome of a safety report is worse than a held listing. The alert pages a human, and that is the whole control. |
| R68d | **MUST** | `orphan_reservation_scan` MUST run hourly and alert on any listing in `reserved` whose session is terminal, or reserved for more than 21 days (the `expires_at` cap). **Any occurrence means a release path did not run** and is investigated, not tidied away by the scan — the scan MUST NOT itself mutate anything. |
| R69 | **MUST** | **Completion wins ties.** If a handoff confirmation and a cancellation arrive in the same instant, the confirmation MUST be processed first. Both paths take `FOR UPDATE` on the session and assert state inside the lock; the ordering rule is realised by `cancel_session` asserting `state IN ('scheduling','scheduled')` *after* acquiring the lock, so a confirmation that already moved the row to `in_progress`/`completed` makes the cancel fail with `invalid_transition`. The goods have physically changed hands, and pretending otherwise would be false. |
| R70 | **MUST NOT** | A `no_show` MUST NOT automatically file a report in MVP. It notifies both parties and offers a one-tap report action. Automatic filing inflates the moderation queue with cases nobody wants pursued; see Q3. |

### 5.8 Concurrency — the eight hazards

Each row is a hazard from [Exchange State Machine §5](../01-architecture/07-exchange-state-machine.md), its control here, and the test that proves it.

| ID | Req | Statement |
| --- | --- | --- |
| R71 | **MUST** | **H1 — two users accept the same listing.** Four controls in depth, all required: (1) `SELECT l.* … FOR UPDATE OF l` serializes the transactions; (2) the `v_listing.status <> 'active'` assertion inside the lock makes the loser fail cleanly with `listing_unavailable`; (3) `CREATE UNIQUE INDEX listings_single_reservation ON listings (reserved_request_id) WHERE reserved_request_id IS NOT NULL` is the backstop if future code takes locks in a different order — **indexed on the pointer, never on `(id) WHERE status = 'reserved'`, which is a no-op because `id` is already the primary key** ([Exchange State Machine §5 H1](../01-architecture/07-exchange-state-machine.md), [Data Model §10](../01-architecture/03-data-model.md)); (4) `listings_reservation_coherent` keeps `status` and `reserved_request_id` in step so control 3 cannot be sidestepped by a release path that clears one and forgets the other. Exactly one session row MUST exist afterwards. **Test: T30.** |
| R72 | **MUST** | **H2 — inventory double-commit.** `listings_one_active_per_item` on `(inventory_item_id) WHERE status IN ('draft','active','reserved')` ([SPEC-009 R57](SPEC-009-listings-and-offers.md)) MUST remain the control, and acceptance MUST additionally assert the item is not already `reserved` or `exchanged` before flipping it. **Test: T52.** |
| R73 | **MUST** | **H3 — duplicate requests from retries.** `exchange_requests_idem` on `(requester_id, idempotency_key)` plus `exchange_requests_one_pending` on `(listing_id, requester_id) WHERE status = 'pending'`. A replay MUST return the original row, not a second row and not a 409. **Test: T53.** |
| R74 | **MUST** | **H4 — simultaneous handoff confirmations.** `confirm_handoff` MUST use the single atomic statement from H4 that sets the caller's own timestamp column and derives `state` and `completed_at` from the other party's column in the same `UPDATE`. A read-then-write loses one confirmation and the session never completes. **Test: T54.** |
| R75 | **MUST** | **H5 — stale client mutation.** `p_expected_version` on every session RPC. A mismatch raises `stale_state` 409 on `propose_schedule`, `confirm_schedule`, and `cancel_session`; the client refetches and re-renders and **MUST NOT blind-retry** (R83). `confirm_handoff` is exempt per R42a. **Test: T55.** |
| R76 | **MUST** | **H6 — cancel racing completion.** Both paths take `FOR UPDATE` on the session and assert state inside the lock; the loser gets `invalid_transition`. Product rule R69 resolves the tie in favour of completion. **Test: T56.** |
| R77 | **MUST** | **H7 — deadlock between two exchanges.** The global lock order `listings → exchange_requests → exchange_sessions` MUST be documented at the top of every function touching more than one, and MUST be asserted in review. Postgres will still abort a genuine deadlock; SQLSTATE **`40P01` is retryable ×3 with jitter** (R86). **Test: T57.** |
| R78 | **MUST** | **H8 — listing expires mid-acceptance.** `app.expire_due_listings` MUST select only `status = 'active' AND expires_at <= now()` ([SPEC-009 R33](SPEC-009-listings-and-offers.md)), so a row that just became `reserved` is invisible to it, and `accept_exchange_request` MUST re-check `expires_at` inside the lock. **Test: T58.** |
| R79 | **MUST** | `private.legal_session_transitions` and the `trg_guard_session_transition` BEFORE UPDATE trigger MUST exist and MUST reject every ordered state pair not in the table, including writes made as `service_role` or by a migration. The transition table is **data**: the test generator counts its rows and enumerates `pg_enum` rather than hard-coding a total, so adding a state cannot leave a stale literal behind. At the time of writing there are 7 states, 13 legal edges, and 36 illegal ones. |
| R79a | **MUST** | The trigger permits `disputed → cancelled` and `disputed → completed`; **only `moderation-action` may issue them**, gated on `app.is_moderator()`. The trigger MUST NOT be made role-aware to enforce this. A trigger that reads the JWT behaves differently inside a migration than at runtime, which is precisely the property the storage-layer guard exists to eliminate — the table says which pairs are legal, and the calling function says who may ask. |
| R80 | **MUST** | Every mutating RPC in this spec MUST take `p_idempotency_key uuid` and MUST route through `app.idempotency_probe` / `app.idempotency_record` ([Exchange State Machine §4.1](../01-architecture/07-exchange-state-machine.md)): return the original result on replay, and raise `idempotency_conflict` 409 when the same key arrives with different arguments. The probe MUST run **before any lock is taken** and the record MUST happen **inside the effect's transaction** — a key written outside it survives a rollback and then silently suppresses the retry that would have fixed it. A NULL key is `validation_failed` 400, not a bypass. |
| R80a | **MUST** | Arguments MUST be stored as a **hash**, never verbatim. A literal `args` column on `create_exchange_request` would hold the requester's free-text message, which is P1. |

### 5.9 Client mirroring

| ID | Req | Statement |
| --- | --- | --- |
| R81 | **MUST** | `LEGAL_SESSION_TRANSITIONS` in `src/domain/exchange/machine.ts` MUST be **generated at build time** from `private.legal_session_transitions`, with a `satisfies Record<SessionState, readonly SessionState[]>` annotation, so a drift between the client's machine and the server's is a **compile error** rather than a runtime bug. The file carries a `// generated — do not edit` header and a CI check that regeneration produces no diff. |
| R82 | **MUST NOT** | The client MUST NOT render an action for a transition the machine says is illegal from the current state. A disabled-with-explanation button is permitted (offline, unverified); a button that produces `invalid_transition` is not. |
| R83 | **MUST** | Optimistic updates MUST be applied through `onMutate` only for transitions the local machine considers legal, and MUST roll back on any error. On `stale_state` the client MUST refetch and re-render, replaying only if the intent is still legal against the fresh state — **never a blind retry** ([Mobile Architecture §2.5](../01-architecture/02-mobile-architecture.md)). |
| R84 | **MUST NOT** | No exchange transition — create, accept, decline, withdraw, propose, confirm, handoff, cancel — MUST be queueable offline. Actions are disabled with an explicit "You're offline" state rather than hidden, and the cached time and place remain readable, which is the entire reason exchanges are cached at all. |
| R85 | **MUST** | The client MUST implement the error taxonomy in §7.10 exactly: one code, one surface, one retry policy, one string. An unmapped code renders the generic message and emits a Sentry event, because an unmapped code means the contract moved. |
| R86 | **MUST** | SQLSTATE `40P01` MUST be auto-retried up to **3 times** with jittered backoff, silently, and MUST emit `exchange.deadlock_retry` on each attempt. It is the one exchange error the user should never see and the one we most want counted. |

### 5.10 The completion model, and the evidence that would change it

Completion requires **both** parties to confirm (R47, R48, US-10). That is the decision, it ships, and the alternative is built but switched off.

The case against it is real and worth stating plainly: every pair who meet, swap tomatoes, and forget to press a button produces a `no_show` with no attribution (EC-18). If that turns out to be the *majority* of no-shows, then the no-show signal is mostly noise, `detect_no_shows` is mostly generating false alarms about honest people, and dual confirmation costs more than it earns.

The case for it is that the alternative lets one person mark an exchange done that never happened. That is the exact failure US-10 exists to prevent, and no amount of data about forgetfulness makes it acceptable to ship a completion path a single party controls — which is why the fallback below is *lower-confidence completion*, never *single-party completion*.

| ID | Req | Statement |
| --- | --- | --- |
| R87 | **MUST** | Completion MUST require both confirmations at launch. `exchange.completion_model` is a config value, not a product flag, with exactly three settings: `dual` (launch), `dual_with_fallback`, and — reserved and **never** to be enabled — `single`. |
| R88 | **MUST** | The `dual_with_fallback` path MUST ship as **written, tested, and disabled** code, not as a future migration. Under it, one confirmation plus 24 hours of silence completes the session with `completion_confidence = 'single'`; ratings from such a session weight lower in `trust_score` and the session is excluded from the `exchange.completion_rate` numerator. Building it after the data arrives means a schema change under time pressure on the most concurrency-sensitive function in the system. |
| R89 | **MUST NOT** | `single` MUST NOT be enabled by config alone. Enabling it requires an ADR, because it deletes US-10 and R48, and a product decision that removes a safety property should not be reachable from a settings table. |
| R90 | **MUST** | The decision MUST be reviewed against data at **60 days**, on three numbers, all of which §11 already emits: `exchange.no_show` with `attribution = none` as a share of all no-shows; `exchange.completion_rate`; and the share of `none`-attribution sessions where both parties later exchanged messages (a proxy for "they met and forgot"). |
| R91 | **MUST** | The trigger for switching to `dual_with_fallback` is stated in advance so it is not argued about afterwards: **`attribution = none` exceeding 50% of no-shows, sustained over 14 days, with completion rate below 70%.** Either signal alone is not sufficient — a high `none` rate with a healthy completion rate means the model is working and a few pairs forget. |

Deciding the threshold now, before anyone has a stake in a particular answer, is the point. A number chosen after the data arrives is a number chosen to justify a preference.

> **Two things about R88 that will go wrong quietly if nobody watches them.** Shipped-but-disabled code stops working silently — nobody runs it, nothing fails, and the day you flip the config is the day you find out it broke three months ago. The completion-model setting must therefore be a **parameter of the exchange test suite**, with both values exercised in CI, not a skipped block. And the 60-day review only has value if it happens: put R90 in a calendar now, because a review that slips six months happens after people have formed opinions. [Development Notes N-06](../07-review/02-development-notes.md#n-06--the-disabled-fallback-path-will-rot-unless-it-is-exercised).

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.exchange_requests`](../01-architecture/03-data-model.md#publicexchange_requests) | read (Pattern C) / write (definer only) | The spec's first subject. **No client UPDATE policy exists**, and that absence is load-bearing |
| [`public.exchange_sessions`](../01-architecture/03-data-model.md#publicexchange_sessions) | read (Pattern C, participant) / write (definer only) | The spec's second subject. `handoff_code` excluded from the default select |
| `public.listings` | read / write (definer: `active` ⇄ `reserved` → `completed`) | Reservation and release. `reserved` and `completed` are unreachable from any client write path ([SPEC-009 R42](SPEC-009-listings-and-offers.md)) |
| `public.listing_safe_spots` | read | The membership check behind R35 |
| `public.inventory_items` | write (definer, status only) | `listed` → `reserved` → `exchanged`, and back to `listed` on cancellation |
| `public.safe_spots` | read | `status = 'active'` at propose and confirm (R36); `hours` via `app.venue_open_during` |
| `public.message_threads` | write (definer) | Created with the request (R10), closed 14 days after completion ([SPEC-011](SPEC-011-messaging.md)) |
| `public.messages` | write (definer) | The request's `message` becomes the first thread message (R09); system messages on each state change |
| `public.profiles` | write (definer: `completed_exchanges`, `cancellation_count_90d`) | Never client-writable; `cancellation_count_90d` is column-`REVOKE`d from `authenticated` |
| `public.notifications` / `private.notification_outbox` | write via `app.enqueue_notification` | Every transition that a human needs to know about |
| `public.reports` | read (inside the dispute freeze) | R67 |
| `public.blocks` | read (inside `app.is_blocked_either_way`) | R05, R19 |
| `private.rate_buckets` | write via `app.consume_token` | R13, R49, R63 |
| `audit.events` | write | Every session state transition (R32) |
| `private.garden_locations` | **none** | Named to be explicit: a session's geography is a public building's coordinate and nothing else (R44) |

**New schema objects introduced by this spec:** migration `20260808_0092_exchange_lifecycle.sql`

```sql
------------------------------------------------------------------------
-- Session columns the lifecycle needs and the data model does not yet carry.
------------------------------------------------------------------------
ALTER TABLE public.exchange_sessions
  ADD COLUMN schedule_proposed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN schedule_proposed_at timestamptz,
  ADD COLUMN handoff_attempts     smallint    NOT NULL DEFAULT 0,
  ADD COLUMN handoff_locked_until timestamptz,
  -- R49: makes the 15-minute window real rather than a lifetime counter.
  ADD COLUMN handoff_window_started_at timestamptz,
  -- R64a: lets a party who showed up but could not confirm say so.
  ADD COLUMN no_show_contested_by uuid REFERENCES public.profiles(id),
  ADD COLUMN no_show_contested_at timestamptz,
  ADD COLUMN no_show_by           uuid REFERENCES public.profiles(id),
  ADD COLUMN disputed_at          timestamptz,
  ADD COLUMN dispute_report_id    uuid REFERENCES public.reports(id),
  ADD COLUMN counts_as_late       boolean     NOT NULL DEFAULT false,
  -- R38: a meeting slot, not an availability calendar.
  ADD CONSTRAINT sessions_window_length CHECK (
        scheduled_end IS NULL OR (
             scheduled_end >= scheduled_start + interval '15 minutes'
         AND scheduled_end <= scheduled_start + interval '2 hours')),
  -- R56: "cancelled" without a reason is a fact nobody can act on.
  ADD CONSTRAINT sessions_reason_required CHECK (
        state <> 'cancelled'
     OR (cancelled_reason IS NOT NULL AND length(cancelled_reason) BETWEEN 1 AND 200)),
  -- R65/R66: attribution only where the data supports it.
  ADD CONSTRAINT sessions_no_show_attribution CHECK (
        no_show_by IS NULL OR no_show_by IN (owner_id, requester_id));

------------------------------------------------------------------------
-- R20: the request machine gets the same storage-layer guard the session
-- machine already has. Terminal means terminal even for service_role.
------------------------------------------------------------------------
CREATE TABLE private.legal_request_transitions (
  from_state request_status NOT NULL,
  to_state   request_status NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO private.legal_request_transitions VALUES
  ('pending','accepted'), ('pending','declined'), ('pending','withdrawn'),
  ('pending','expired'),  ('pending','cancelled');

------------------------------------------------------------------------
-- R67 / R68a: the session transition table, mirroring Exchange State
-- Machine §6 exactly. Four edges into `disputed`, because a session must be
-- freezable from the state it is actually in — including `scheduled`, which
-- is the state in which someone has a confirmed time and place with a person
-- they have become afraid of. Two edges out, moderator-only in practice.
------------------------------------------------------------------------
INSERT INTO private.legal_session_transitions VALUES
  ('scheduling','scheduled'), ('scheduling','cancelled'), ('scheduling','disputed'),
  ('scheduled','in_progress'),('scheduled','cancelled'),('scheduled','no_show'),
  ('scheduled','disputed'),
  ('in_progress','completed'),('in_progress','no_show'),('in_progress','disputed'),
  ('completed','disputed'),
  ('disputed','cancelled'),  ('disputed','completed');

CREATE OR REPLACE FUNCTION private.guard_request_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, private, public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT EXISTS (SELECT 1 FROM private.legal_request_transitions
                      WHERE from_state = OLD.status AND to_state = NEW.status) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_guard_request_transition
BEFORE UPDATE ON public.exchange_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_request_transition();

------------------------------------------------------------------------
-- Indexes for every predicate the crons and the quota checks scan.
------------------------------------------------------------------------
CREATE INDEX exchange_requests_requester_open_idx
  ON public.exchange_requests (requester_id) WHERE status = 'pending';   -- R07
CREATE INDEX exchange_requests_expiry_idx
  ON public.exchange_requests (expires_at)   WHERE status = 'pending';   -- R11
CREATE INDEX sessions_no_show_sweep_idx
  ON public.exchange_sessions (scheduled_end)
  WHERE state IN ('scheduled','in_progress');                            -- R64
CREATE INDEX sessions_request_idx ON public.exchange_sessions (request_id);

------------------------------------------------------------------------
-- R30/R45: the code is encrypted at rest and readable through exactly one
-- audited function. Encrypted, not hashed — both parties must be able to
-- READ it at the meeting, days later, possibly on a reinstalled app.
------------------------------------------------------------------------
ALTER TABLE public.exchange_sessions
  ALTER COLUMN handoff_code TYPE bytea
  USING pgp_sym_encrypt(handoff_code::text, vault.get_secret('handoff_code_key'));

REVOKE SELECT (handoff_code) ON public.exchange_sessions FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_handoff_code(p_session_id uuid)
RETURNS TABLE (handoff_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, vault AS $$
DECLARE v_s public.exchange_sessions;
BEGIN
  SELECT * INTO v_s FROM public.exchange_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002'; END IF;
  IF auth.uid() NOT IN (v_s.owner_id, v_s.requester_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_s.state <> 'scheduled' THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (auth.uid(), 'authenticated', 'exchange.code_read', 'session', p_session_id);

  RETURN QUERY SELECT pgp_sym_decrypt(v_s.handoff_code,
                        vault.get_secret('handoff_code_key'))::text;
END; $$;

REVOKE ALL ON FUNCTION public.get_handoff_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_handoff_code(uuid) TO authenticated;

------------------------------------------------------------------------
-- R64a: contesting a no-show marker. Clears attribution and files a
-- low-priority signal. Deliberately cheap to use and deliberately recorded.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contest_no_show(
  p_session_id      uuid,
  p_idempotency_key uuid
) RETURNS TABLE (session_id uuid, cleared boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $$
DECLARE v_uid uuid := auth.uid(); v_s public.exchange_sessions; v_prior jsonb;
BEGIN
  v_prior := app.idempotency_probe(v_uid, p_idempotency_key, 'contest_no_show',
               jsonb_build_object('session_id', p_session_id));
  IF v_prior IS NOT NULL THEN
    RETURN QUERY SELECT p_session_id, (v_prior->>'cleared')::boolean; RETURN;
  END IF;

  SELECT * INTO v_s FROM public.exchange_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_uid NOT IN (v_s.owner_id, v_s.requester_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_s.state <> 'no_show' OR v_s.no_show_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001'; END IF;
  IF v_s.no_show_contested_at IS NOT NULL THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'P0001'; END IF;
  IF v_s.completed_at IS NULL
     AND v_s.scheduled_end < now() - interval '7 days' THEN     -- R64c
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001'; END IF;

  -- NOTE: `state` does not change. `no_show` is still terminal. Only the
  -- attribution moves, because attribution is the only part that names a person.
  UPDATE public.exchange_sessions
     SET no_show_by = NULL, no_show_contested_by = v_uid,
         no_show_contested_at = now(), version = version + 1
   WHERE id = p_session_id;

  PERFORM app.record_trust_signal(v_uid, 'no_show_contested', p_session_id);  -- R64b
  PERFORM app.enqueue_notification(
            CASE WHEN v_uid = v_s.owner_id THEN v_s.requester_id ELSE v_s.owner_id END,
            'exchange_cancelled',
            jsonb_build_object('session_id', p_session_id, 'kind', 'no_show_contested'));

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (v_uid, 'authenticated', 'exchange.no_show_contested', 'session', p_session_id);

  PERFORM app.idempotency_record(v_uid, p_idempotency_key, 'contest_no_show',
            jsonb_build_object('session_id', p_session_id),
            jsonb_build_object('cleared', true));

  RETURN QUERY SELECT p_session_id, true;
END; $$;

REVOKE ALL ON FUNCTION public.contest_no_show(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contest_no_show(uuid, uuid) TO authenticated;
```

The handoff confirmation, which is hazard H4's control and the single most delicate function in the codebase.

**Two things about its shape are load-bearing and neither is obvious.**

First, **it returns a failure rather than raising one** (R49a). A wrong code has to increment a counter, and `RAISE EXCEPTION` in PL/pgSQL with no enclosing handler aborts the transaction — which rolls back the increment, the lockout timestamp, and both `safety_alert` outbox rows. That is exactly what the first draft did, which meant `handoff_attempts` was permanently 0 and the brute-force lockout never fired once. Anything with state to preserve returns `ok = false`; only conditions with nothing to preserve raise.

Second, **it does not check `p_expected_version`** (R42a). A strict check here rejects the second of two simultaneous confirmations with `stale_state` — the exact case the atomic statement below exists to handle. See [Exchange State Machine §5 H5](../01-architecture/07-exchange-state-machine.md).

```sql
CREATE OR REPLACE FUNCTION public.confirm_handoff(
  p_session_id       uuid,
  p_code             text,
  p_expected_version integer,   -- advisory only (R42a); echoed back, never a guard
  p_idempotency_key  uuid
) RETURNS TABLE (
  session_id         uuid,
  ok                 boolean,
  reason             text,      -- NULL | handoff_code_invalid | handoff_window_closed | rate_limited
  state              session_state,
  version            integer,
  attempts_remaining smallint,  -- R49b
  retry_after_s      integer,
  both_confirmed     boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private, vault AS $$
-- LOCK ORDER: listings → exchange_requests → exchange_sessions. This function
-- takes only the session, and must never be extended to take one of the others
-- without moving the acquisition above this comment.
DECLARE
  v_uid      uuid := auth.uid();
  v_s        public.exchange_sessions;
  v_new      session_state;
  v_ver      integer;
  v_attempts smallint;
  v_prior    jsonb;
BEGIN
  -- R80: probe before the lock. A replay must never wait on the row it replays.
  v_prior := app.idempotency_probe(v_uid, p_idempotency_key, 'confirm_handoff',
               jsonb_build_object('session_id', p_session_id));
  IF v_prior IS NOT NULL THEN
    RETURN QUERY SELECT p_session_id, (v_prior->>'ok')::boolean, v_prior->>'reason',
                        (v_prior->>'state')::session_state, (v_prior->>'version')::integer,
                        (v_prior->>'attempts_remaining')::smallint,
                        (v_prior->>'retry_after_s')::integer,
                        (v_prior->>'both_confirmed')::boolean;
    RETURN;
  END IF;

  SELECT * INTO v_s FROM public.exchange_sessions WHERE id = p_session_id FOR UPDATE;

  ------------------------------------------------------------------
  -- Conditions with no state to preserve. These raise.
  ------------------------------------------------------------------
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_uid NOT IN (v_s.owner_id, v_s.requester_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_s.state NOT IN ('scheduled','in_progress') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001'; END IF;
  -- NOTE: no version check. R42a — a strict one here defeats H4 outright.

  ------------------------------------------------------------------
  -- R49: rolling 15-minute window. A lapsed window resets, so a pair who
  -- fumbled twice on Tuesday do not carry those attempts into Saturday.
  ------------------------------------------------------------------
  IF v_s.handoff_window_started_at IS NOT NULL
     AND v_s.handoff_window_started_at < now() - interval '15 minutes'
     AND (v_s.handoff_locked_until IS NULL OR v_s.handoff_locked_until <= now()) THEN
    UPDATE public.exchange_sessions
       SET handoff_attempts = 0, handoff_window_started_at = NULL
     WHERE id = p_session_id;
    v_s.handoff_attempts := 0;
  END IF;

  ------------------------------------------------------------------
  -- Conditions WITH state to preserve. These return, so the transaction
  -- commits and the counter survives (R49a).
  ------------------------------------------------------------------
  IF v_s.handoff_locked_until IS NOT NULL AND v_s.handoff_locked_until > now() THEN
    RETURN QUERY SELECT p_session_id, false, 'rate_limited', v_s.state, v_s.version, 0::smallint,
      CEIL(EXTRACT(EPOCH FROM (v_s.handoff_locked_until - now())))::integer, false;
    RETURN;
  END IF;

  IF now() < v_s.scheduled_start - interval '30 minutes'
     OR now() > v_s.scheduled_end + interval '2 hours' THEN
    -- Not a wrong guess, so it costs no attempt. R46.
    RETURN QUERY SELECT p_session_id, false, 'handoff_window_closed', v_s.state, v_s.version,
      (5 - v_s.handoff_attempts)::smallint, NULL::integer, false;
    RETURN;
  END IF;

  -- R54: constant time. Six digits short-circuited is a timing oracle.
  -- R30/R54: decrypt, then compare in constant time. The decrypt runs on every
  -- attempt, right and wrong alike, so it leaks nothing the comparison doesn't.
  IF NOT app.digest_equals(
       pgp_sym_decrypt(v_s.handoff_code, vault.get_secret('handoff_code_key'))::text,
       p_code) THEN
    UPDATE public.exchange_sessions
       SET handoff_attempts          = handoff_attempts + 1,
           handoff_window_started_at = COALESCE(handoff_window_started_at, now()),
           handoff_locked_until      = CASE WHEN handoff_attempts + 1 >= 5
                                            THEN now() + interval '15 minutes' END
     WHERE id = p_session_id
    RETURNING handoff_attempts INTO v_attempts;

    IF v_attempts >= 5 THEN                                              -- R49
      PERFORM app.enqueue_notification(v_s.owner_id,     'safety_alert',
                jsonb_build_object('session_id', p_session_id, 'kind', 'handoff_lockout'));
      PERFORM app.enqueue_notification(v_s.requester_id, 'safety_alert',
                jsonb_build_object('session_id', p_session_id, 'kind', 'handoff_lockout'));
    END IF;

    -- Committing, not raising. This is the whole of R49a: a RAISE here would
    -- roll back the increment, the lockout, and both alerts above.
    RETURN QUERY SELECT p_session_id, false, 'handoff_code_invalid', v_s.state, v_s.version,
      GREATEST(5 - v_attempts, 0)::smallint,
      CASE WHEN v_attempts >= 5 THEN 900 ELSE NULL END, false;
    RETURN;
  END IF;

  -- H4 / R47 / R55: one statement. Sets MY column, derives state from THEIRS.
  UPDATE public.exchange_sessions
     SET owner_confirmed_at     = CASE WHEN v_uid = owner_id     THEN COALESCE(owner_confirmed_at, now())     ELSE owner_confirmed_at END,
         requester_confirmed_at = CASE WHEN v_uid = requester_id THEN COALESCE(requester_confirmed_at, now()) ELSE requester_confirmed_at END,
         state = CASE WHEN (v_uid = owner_id     AND requester_confirmed_at IS NOT NULL)
                        OR (v_uid = requester_id AND owner_confirmed_at     IS NOT NULL)
                      THEN 'completed'::session_state ELSE 'in_progress'::session_state END,
         completed_at = CASE WHEN (v_uid = owner_id     AND requester_confirmed_at IS NOT NULL)
                               OR (v_uid = requester_id AND owner_confirmed_at     IS NOT NULL)
                             THEN now() ELSE completed_at END,
         handoff_attempts = 0,
         handoff_window_started_at = NULL,
         version = version + 1
   WHERE id = p_session_id
     AND state IN ('scheduled','in_progress')
  RETURNING state, version INTO v_new, v_ver;

  IF v_new = 'completed' THEN
    PERFORM app.finalize_completed_session(p_session_id);   -- R50/R68b, same transaction
  END IF;

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (v_uid, 'authenticated', 'exchange.' || v_new::text, 'session', p_session_id);

  PERFORM app.idempotency_record(v_uid, p_idempotency_key, 'confirm_handoff',
            jsonb_build_object('session_id', p_session_id),
            jsonb_build_object('ok', true, 'reason', NULL, 'state', v_new,
                               'version', v_ver, 'attempts_remaining', 5,
                               'retry_after_s', NULL,
                               'both_confirmed', v_new = 'completed'));

  RETURN QUERY SELECT p_session_id, true, NULL::text, v_new, v_ver, 5::smallint,
                      NULL::integer, v_new = 'completed';
END; $$;

REVOKE ALL ON FUNCTION public.confirm_handoff(uuid, text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_handoff(uuid, text, integer, uuid) TO authenticated;
```

**PostgREST mapping.** `ok = false` returns HTTP 200 carrying the body above, and the client maps `reason` to a screen through the §7.10 taxonomy. This is a deliberate departure from "every failure is an HTTP status" and it is confined to this one function, because this is the one function whose failure path must durably change state. `Retry-After` is set by the client from `retry_after_s`: `set_config('response.headers', …)` cannot survive a `RAISE` either, and relying on it was part of the same original defect.

No-show detection (R64–R66), which is deliberately dull because it runs unattended:

```sql
CREATE OR REPLACE FUNCTION app.detect_no_shows(p_batch int DEFAULT 200)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $$
DECLARE v_row record; v_n int := 0; v_blame uuid;
BEGIN
  FOR v_row IN
    SELECT id, owner_id, requester_id, owner_confirmed_at, requester_confirmed_at
      FROM public.exchange_sessions
     WHERE state IN ('scheduled','in_progress')
       -- R64: 2h15m, not 2h. `confirm_handoff` accepts until end + 2h exactly,
       -- and a sweeper firing at that same instant can hold the row while a
       -- user is confirming against it.
       AND scheduled_end < now() - interval '2 hours 15 minutes'
     ORDER BY scheduled_end
     LIMIT p_batch
     FOR UPDATE SKIP LOCKED
  LOOP
    -- R65/R66: blame only where exactly one person confirmed.
    v_blame := CASE
      WHEN v_row.owner_confirmed_at IS NOT NULL AND v_row.requester_confirmed_at IS NULL THEN v_row.requester_id
      WHEN v_row.requester_confirmed_at IS NOT NULL AND v_row.owner_confirmed_at IS NULL THEN v_row.owner_id
      ELSE NULL END;

    UPDATE public.exchange_sessions
       SET state = 'no_show', no_show_by = v_blame, version = version + 1
     WHERE id = v_row.id;

    PERFORM app.release_reservation(v_row.id);          -- listing → active, item → listed
    PERFORM app.enqueue_notification(v_row.owner_id,     'exchange_cancelled',
              jsonb_build_object('session_id', v_row.id, 'kind', 'no_show'));
    PERFORM app.enqueue_notification(v_row.requester_id, 'exchange_cancelled',
              jsonb_build_object('session_id', v_row.id, 'kind', 'no_show'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END; $$;
```

Also introduced: the RPCs `create_exchange_request`, `decline_exchange_request`, `withdraw_exchange_request`, `propose_schedule`, `confirm_schedule`, `cancel_session`; the definer helpers `app.finalize_completed_session` (**idempotent**, R68b), `app.release_reservation`, `app.enqueue_notification_bulk_declined`, `app.digest_equals`, `app.expire_due_requests`, `app.idempotency_probe` / `app.idempotency_record` and their `private.idempotency_keys` table ([Exchange State Machine §4.1](../01-architecture/07-exchange-state-machine.md)); the routes `/(modals)/schedule/[sessionId]` and `/(modals)/handoff/[sessionId]`; the build-time generator `scripts/gen-transitions.ts` (R81); and six `pg_cron` jobs — `expire_requests` (*/5 min), `detect_no_shows` (*/15 min), `remind_upcoming` (*/15 min), `sweep_idempotency_keys` (hourly), `dispute_sla_breach` (hourly, R68c), `orphan_reservation_scan` (hourly, R68d).

**`close_threads` is not in that list.** It is owned by [SPEC-011 R21](SPEC-011-messaging.md), which creates it; this spec only *schedules* a close at completion (R50). An earlier draft claimed both specs created the same job, which is how two migrations end up racing to `cron.schedule` the same name.

`app.release_reservation` is called from three places and must behave identically in all of them: `cancel_session` (R59), `detect_no_shows` (R64), and `moderation-action` on `disputed → cancelled` (R68a). It sets the listing to `active`, the item to `listed`, and **nulls `reserved_request_id`** — required by `listings_reservation_coherent` ([Data Model §10](../01-architecture/03-data-model.md)), which will reject the update outright if the pointer is left behind.

### 6.1 Request transitions

| From | To | Actor | Mechanism | Guards |
| --- | --- | --- | --- | --- |
| — | `pending` | Requester | `rpc.create_exchange_request` | `can_transact`; listing `active` + unexpired; not self; not blocked; no existing pending for (requester, listing); < 10 open |
| `pending` | `accepted` | Owner | `rpc.accept_exchange_request` | Caller is `owner_id`; request pending + unexpired; listing `active` + unexpired; can transact; not blocked |
| `pending` | `declined` | Owner | `rpc.decline_exchange_request`, or the set-based auto-decline inside acceptance | Caller is `owner_id`; request pending |
| `pending` | `withdrawn` | Requester | `rpc.withdraw_exchange_request` | Caller is `requester_id`; request pending. Available without `can_transact` (R61) |
| `pending` | `expired` | System | `app.expire_due_requests` | `expires_at < now()` |
| `pending` | `cancelled` | System | `on_block_created`, `withdraw_listing`, suspension fanout | R19 |
| `accepted` / `declined` / `withdrawn` / `expired` / `cancelled` | — | — | **Terminal** (R20, R22) | Enforced by `trg_guard_request_transition` |

### 6.2 Session transitions

| From | To | Actor | Mechanism | Guards & effects |
| --- | --- | --- | --- | --- |
| — | `scheduling` | System | `accept_exchange_request` | Created atomically with acceptance; `handoff_code` generated |
| `scheduling` | `scheduled` | Either | `propose_schedule` + `confirm_schedule` | Spot in the listing's set and `active`; start ∈ [now+1h, now+14d]; end ∈ [start+15m, start+2h]; `venue_open_during` true; the *other* party confirms |
| `scheduling` | `cancelled` | Either | `cancel_session` | Reason required. `counts_as_late` is false — there is no `scheduled_start` yet |
| `scheduling` | `disputed` | System | Report filed | R67. No time or place exists yet; §8.3's hold copy has a variant for this |
| `scheduled` | `in_progress` | Either | `confirm_handoff` | Correct code within start−30m … end+2h |
| `scheduled` | `cancelled` | Either | `cancel_session` | Reason required; `counts_as_late` if < 4 h before start (R58) |
| `scheduled` | `no_show` | System | `app.detect_no_shows` | 2 h 15 m past `scheduled_end`, zero confirmations → no attribution (R66); reservation released |
| `scheduled` | `disputed` | System | Report filed | R67. **The most important freeze in the product** — a confirmed time and place with someone the reporter has become afraid of |
| `in_progress` | `completed` | The other party | `confirm_handoff` | Second confirmation. Effects: listing → `completed`, item → `exchanged`, `completed_exchanges` +1 both, ratings unlocked, thread closes in 14 days |
| `in_progress` | `no_show` | System | `app.detect_no_shows` | 2 h 15 m past `scheduled_end`, exactly one confirmation → the *other* accrues the marker (R65); reservation released |
| `in_progress` | `disputed` | System | Report filed during the window | R67 |
| `completed` | `disputed` | System | Report filed within 72 h | R67. The one transition out of a state that is terminal to participants |
| `disputed` | `cancelled` | Moderator | `moderation-action` | R68a. Releases the reservation. `counts_as_late` never set |
| `disputed` | `completed` | Moderator | `moderation-action` | R68a. `app.finalize_completed_session` if not already run (R68b) |
| `cancelled` / `no_show` | — | — | **Terminal** | Enforced by `trg_guard_session_transition` |
| `disputed` | — | — | **Terminal to participants** (R68) | Two moderator exits above; `PARTICIPANT_TRANSITIONS.disputed` is empty |

**PII touched:** `exchange_sessions.scheduled_start` + `safe_spot_id` together are, per [Data Model §10](../01-architecture/03-data-model.md), **the highest-value target in the database for a stalker** — a confirmed time and place a named person will be. Both are **P1**, readable only by the two participants and by moderators on an open report, excluded from every analytics event, scrubbed from telemetry, and anonymized by `anonymize_sessions` 90 days after completion. `handoff_code` is **P1** and is the most tightly held column in the schema: **encrypted at rest** against a Vault key, `SELECT`-`REVOKE`d from `authenticated` so even a participant reads ciphertext, excluded from the realtime publication, from every list select, from push bodies, and from client persistence (R51). The single decrypt path, `rpc.get_handoff_code`, is gated on `state = 'scheduled'` and audited. `exchange_requests.message` and `cancelled_reason` are **P1** free text. `cancellation_count_90d` and `trust_score` are **P1** and column-`REVOKE`d from `authenticated`; this spec writes the first and never reads either into a client-reachable shape. No **P0** column is read, written, or derivable by any path here, and no `RETURNS TABLE` in §7 has a column capable of holding a coordinate other than a safe spot's public point.

## 7. API

All RPCs are `POST /rest/v1/rpc/<name>`, `SECURITY DEFINER`, `SET search_path` pinned, authorization re-checked as the first act, `EXECUTE` granted to `authenticated` only (R33). Full catalogue context in [API Contract §5.4](../01-architecture/06-api-contract.md).

### 7.1 `rpc.create_exchange_request`

**Auth:** `authenticated` + `app.can_transact()`
**Rate limit:** 10 / hour / user (Postgres token bucket)

```jsonc
// Request
{ "p_listing_id": "4a2f9c11-…",
  "p_offered_item_id": "3d0f5a7b-…",          // optional
  "p_message": "I've got basil if you want a swap.",   // optional, ≤ 300
  "p_proposed_safe_spot_id": "3f2a9c11-…",    // optional, advisory (R12)
  "p_idempotency_key": "8f14e45f-…" }
```

```jsonc
// Response 200
{ "request_id": "9c1e3d0f-…", "thread_id": "b1e0c1c2-…",
  "expires_at": "2026-08-11T14:31:02Z", "open_requests": 3 }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_verified` | 403 | `app.can_transact()` false (R02) |
| `blocked` | 403 | A block exists in either direction (R05) |
| `listing_unavailable` | 409 | Listing is `reserved`, `withdrawn`, or `completed` (R03) |
| `listing_expired` | 409 | Past `expires_at` (R03) |
| `conflict` | 409 | An existing `pending` request for this (listing, requester) (R06) |
| `quota_exceeded` | 422 | 10 open requests already (R07) |
| `validation_failed` | 400 | Self-request (R04), message > 300, offered item not owned or not `available` (R08), proposed spot outside the listing's set (R12) |
| `idempotency_conflict` | 409 | Same key, different arguments |
| `rate_limited` | 429 | Bucket empty; integer `Retry-After` |

Ordering inside the function: re-check authorization → consume a rate token → `SELECT … FOR UPDATE` on the listing → assert `active` and unexpired → assert the quota → insert the request → insert the thread → insert the first message → enqueue `request_received` → audit. `open_requests` is returned so the client can render "3 of 10 open" without a second query; it is the caller's own count and nobody else's.

### 7.2 `rpc.accept_exchange_request`

**Auth:** `authenticated`, owner, `app.can_transact()`
**Rate limit:** 30 / hour / user
**Body:** specified verbatim in [Exchange State Machine §4](../01-architecture/07-exchange-state-machine.md). This section restates its contract only.

```jsonc
// Request
{ "p_request_id": "9c1e3d0f-…", "p_idempotency_key": "1f3a4a0b-…" }
// Response 200
{ "session_id": "7b1e0c1c-…", "handoff_code": "408213" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `request_not_found` | 404 | Unknown, or invisible under RLS |
| `not_authorized` | 403 | Caller is not `owner_id` |
| `not_verified` | 403 | `app.can_transact()` false |
| `blocked` | 403 | A block exists in either direction |
| `request_not_pending` | 409 | Already resolved, or past `expires_at` |
| `listing_unavailable` | 409 | **The other acceptor won.** This is hazard H1, resolved |
| `listing_expired` | 409 | Listing window closed |
| `deadlock` | 500 | SQLSTATE `40P01`; retryable ×3 with jitter (R86) |

`handoff_code` is returned here and by exactly one other path — an explicit `GET /rest/v1/exchange_sessions?select=handoff_code` issued when the session is `scheduled` and the handoff screen is open. It is returned at acceptance because the acceptor's device is the one that just performed the transition; it is **not displayed** until `scheduled` (R45), and the client does not persist it (R51).

### 7.3 `rpc.decline_exchange_request`

**Auth:** `authenticated`, owner · **Rate limit:** 60 / hour / user

```jsonc
{ "p_request_id": "…", "p_reason": "Already promised to a neighbour.", "p_idempotency_key": "…" }
// Response 200
{ "request_id": "…", "status": "declined" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `request_not_found` | 404 | Unknown or invisible |
| `not_authorized` | 403 | Not the owner |
| `request_not_pending` | 409 | Already resolved |
| `validation_failed` | 400 | Reason > 200 characters |

The reason is stored and never returned to the requester (R16). The requester's notification is identical to the one produced by an auto-decline (R21).

### 7.4 `rpc.withdraw_exchange_request`

**Auth:** `authenticated`, requester. **Does not require `can_transact`** (R61) · **Rate limit:** 60 / hour / user

```jsonc
{ "p_request_id": "…", "p_idempotency_key": "…" }
// Response 200
{ "request_id": "…", "status": "withdrawn" }
```

Errors: `request_not_found` 404 · `not_authorized` 403 · `request_not_pending` 409.

### 7.5 `rpc.propose_schedule`

**Auth:** `authenticated`, participant · **Rate limit:** 30 / hour / user

```jsonc
// Request
{ "p_session_id": "7b1e0c1c-…", "p_safe_spot_id": "3f2a9c11-…",
  "p_start": "2026-08-10T16:00:00Z", "p_end": "2026-08-10T16:30:00Z",
  "p_expected_version": 1, "p_idempotency_key": "…" }
// Response 200
{ "session_id": "7b1e0c1c-…", "state": "scheduling", "version": 2,
  "proposed_by": "8f14e45f-…", "safe_spot_id": "3f2a9c11-…",
  "scheduled_start": "2026-08-10T16:00:00Z", "scheduled_end": "2026-08-10T16:30:00Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not a participant |
| `invalid_transition` | 409 | Session is not `scheduling` or `scheduled` |
| `stale_state` | 409 | `p_expected_version` mismatch (R42) |
| `venue_closed` | 422 | `app.venue_open_during` false — includes a window spanning local midnight (R39) |
| `validation_failed` | 400 | Spot outside the listing's set (R35), spot not `active` (R36), `start < now()+1h`, `start > now()+14d`, `end` outside [start+15m, start+2h] (R37, R38) |

The response echoes the window so the client renders what the **server** accepted rather than what the device's clock believes it sent. A `venue_closed` response additionally carries the venue's hours for the proposed day, so the error screen can show them without a second request ([SPEC-007 EC-13](SPEC-007-safe-spots.md)).

### 7.6 `rpc.confirm_schedule`

**Auth:** `authenticated`, the participant who did **not** propose · **Rate limit:** 30 / hour / user

```jsonc
{ "p_session_id": "…", "p_expected_version": 2, "p_idempotency_key": "…" }
// Response 200
{ "session_id": "…", "state": "scheduled", "version": 3,
  "scheduled_start": "2026-08-10T16:00:00Z", "scheduled_end": "2026-08-10T16:30:00Z",
  "safe_spot_id": "3f2a9c11-…" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not a participant |
| `invalid_transition` | 409 | No outstanding proposal, or session not `scheduling` |
| `stale_state` | 409 | Version mismatch |
| `validation_failed` | 400 | Confirming your own proposal (R40); spot suspended since the proposal (R36) |
| `venue_closed` | 422 | Hours changed between propose and confirm — rare, and the reason the check runs twice |

### 7.7 `rpc.confirm_handoff`

**Auth:** `authenticated`, participant · **Rate limit: 5 / 15 min, per session** — not per user, because the abuse case is brute-forcing one six-digit code, not making many calls.

```jsonc
{ "p_session_id": "…", "p_code": "408213", "p_expected_version": 3, "p_idempotency_key": "…" }
// Response 200
{ "session_id": "…", "state": "in_progress", "version": 4, "both_confirmed": false }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not a participant |
| `invalid_transition` | 409 | Session not `scheduled` or `in_progress` |
| `stale_state` | 409 | Version mismatch |
| `validation_failed` | 400 | Wrong code, or outside `start − 30 min … end + 2 h` (R46) |
| `rate_limited` | 429 | 5 wrong attempts — confirmation locked 15 minutes, **both parties notified** (R49) |

A wrong code and an out-of-window attempt deliberately share one error code and two different strings (§8.3). They are distinguished in the client by the session's own `scheduled_start`, which it already has, rather than by a server code — because a code that says "right code, wrong time" tells a guesser they have the code.

### 7.8 `rpc.cancel_session`

**Auth:** `authenticated`, participant. **Does not require `can_transact`** (R61) · **Rate limit:** 20 / day / user

```jsonc
{ "p_session_id": "…", "p_reason": "Car won't start, sorry.",
  "p_expected_version": 3, "p_idempotency_key": "…" }
// Response 200
{ "session_id": "…", "state": "cancelled", "version": 4, "counts_as_late": true }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not a participant |
| `invalid_transition` | 409 | Session is `in_progress` (R57) or terminal — including the completion-wins-ties case (R69) |
| `stale_state` | 409 | Version mismatch |
| `validation_failed` | 400 | Reason missing, empty, or > 200 characters (R56) |

`counts_as_late` is returned so the client can confirm afterwards what it warned about beforehand. It is the caller's own fact; the counterparty's notification never carries it.

### 7.9 Reads

| Read | Shape | Constraint this spec adds |
| --- | --- | --- |
| `GET /rest/v1/exchange_requests` | [API Contract §4.6](../01-architecture/06-api-contract.md) | `idempotency_key` and the decline reason are in **no** select list. A fixed select constant in `src/api/repositories/exchanges.ts`, lint-enforced, so neither can be widened in |
| `GET /rest/v1/exchange_sessions` | [API Contract §4.7](../01-architecture/06-api-contract.md) | `version` is **mandatory** in every select, because every mutating RPC takes `p_expected_version`. `handoff_code` is absent from the default constant |
| `GET /rest/v1/exchange_sessions?select=handoff_code` | single column | Issued only when `state = 'scheduled'` and the handoff screen is mounted. Never cached, never persisted, never logged |
| `session:{session_id}` realtime channel | [Realtime §1](../01-architecture/08-realtime-and-notifications.md) | An invalidation hint only. The handler **never** writes `payload.new` into the cache; it invalidates and refetches |

### 7.10 Client-side error taxonomy

The complete set for this feature. One code, one surface, one retry policy, one string (R85). Codes come from [Exchange State Machine §9](../01-architecture/07-exchange-state-machine.md) and [API Contract §3.4](../01-architecture/06-api-contract.md); the behaviour column is normative for the client.

| Code | HTTP | SQLSTATE | Raised by | Surface | Auto-retry | Exact client behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| `request_not_found` | 404 | `P0002` | Every RPC | Screen | No | Refetch the list, replace the screen with the "No longer available" card (§8.3), offer `Back to exchanges`. Never a 403 — RLS invisibility is a 404-shaped answer |
| `not_authorized` | 403 | `42501` | Every RPC | Screen | No | Refetch and re-render. Almost always a stale screen; log at `warn` with the RPC name and no ids |
| `not_verified` | 403 | `42501` | Create, accept | Sheet | No | Present the verification sheet with the §8.3 copy and a `Verify now` route into [SPEC-003](SPEC-003-identity-verification.md). Never hide the button that produced it |
| `blocked` | 403 | `42501` | Create, accept | **Silent** | No | Remove the row from the list, invalidate `qk.exchanges()`, show **nothing**. A block that announces itself is a known harassment escalation |
| `request_not_pending` | 409 | `P0001` | Accept, decline, withdraw | Toast | No | "That request was already answered." Refetch and re-render |
| `listing_unavailable` | 409 | `P0001` | Create, accept | Toast | No | "Just claimed by someone else." Invalidate `qk.exchanges()` **and** the map prefix, because the listing left the map in the same transaction |
| `listing_expired` | 409 | `P0001` | Create, accept | Toast | No | "That listing has expired." Remove the row from the list |
| `invalid_transition` | 409 | `P0001` | Every session RPC | Screen | No | Refetch and re-render. **Emit a Sentry error** — this is a client bug and it means the generated machine (R81) drifted or a button rendered that should not have (R82) |
| `stale_state` | 409 | `P0001` | Every session RPC | **Silent** | No | Roll back the optimistic update, refetch, re-render. Replay the intent **only** if it is still legal against the fresh state; never blind-retry (R83) |
| `venue_closed` | 422 | `P0001` | Propose, confirm schedule | Inline | No | Keep the form, render the venue's hours from the response beneath the time field, and the §8.3 copy. Do not clear the user's chosen spot |
| `validation_failed` | 400 | `22023` | All | Inline | No | Field-level message from the zod schema. For `confirm_handoff` specifically, the string is chosen from the session's own window (§8.3) and the attempts-remaining count is shown |
| `quota_exceeded` | 422 | `P0001` | Create | Sheet | No | "You've got 10 requests waiting." List the open requests with a withdraw action. Not a rate-limit message — the user is at a ceiling, not going too fast |
| `conflict` | 409 | `23505` | Create | Toast | No | "You've already asked for this one." Navigate to the existing request |
| `idempotency_conflict` | 409 | `22023` | All | Screen | No | Generic failure plus a Sentry event. A key reused with different arguments is always a client bug |
| `rate_limited` | 429 | `P0001` | Create, accept, handoff, cancel | Toast (Inline for handoff) | **No** | Disable the action for exactly `Retry-After` seconds with a visible countdown. **Never auto-retry a mutation.** For handoff, render the lockout copy inline on the code field |
| `deadlock` | 500 | `40P01` | Accept, cancel, handoff | **Silent** | **Yes, ×3** | Jittered backoff, invisible to the user, `exchange.deadlock_retry` emitted per attempt (R86). On the fourth failure, fall through to `server_error` |
| `network_unavailable` | — | — | All | Banner | Yes | Persistent offline banner; the action is disabled, not queued (R84). Cached time, place, and code stay readable |
| `server_error` | 5xx | — | All | Screen | Yes, ×1 | "Something went wrong" with a correlation id and `Try again`. The raw Postgres message is never rendered — it can contain row data |

### 7.11 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| The number or identity of competing requesters on a listing | It is a demand signal that changes barter behaviour in ways nobody has modelled, and it names third parties ([SPEC-009 R50](SPEC-009-listings-and-offers.md)) |
| Whether a decline was manual or automatic | R21. Distinguishing them tells a requester they lost a race, which invites re-request-on-a-cadence |
| The decline reason, to the requester | R16 |
| `handoff_code` over realtime, push, or any list read | R51. It would end up in a websocket frame log and on a lock screen |
| `counts_as_late`, to the counterparty | It is the canceller's own trust consequence. Publishing it turns a private penalty into a public shaming |
| `cancellation_count_90d` or `trust_score`, to anyone | Column-`REVOKE`d from `authenticated`; surfaced only as a coarse `trust_tier` ([PRD C12](../00-foundation/02-prd.md)) |
| A presence, typing, or "arrived" signal | Tells a stalker when their target is at a known location at a known time |
| Any coordinate other than a safe spot's public point | R44, and the CI contract sweep (API-04) fails a build that adds one |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Send request | `/(modals)/request-new/[listingId]` | Optional offered item, optional message, optional preferred spot. `[guard: canTransact]` |
| Exchanges tab | `/exchanges` | Two segments — **Incoming** (requests on my listings) and **Mine** (requests I sent and sessions I'm in). Badge counts pending incoming |
| Request detail | `/exchanges/[requestId]` | The counterparty card, the offered item, the message, and exactly one primary action per role |
| Session detail | `/exchanges/session/[sessionId]` | **The spine of the feature.** State, next action, agreed place and time, thread entry, cancel |
| Schedule | `/(modals)/schedule/[sessionId]` | Spot picker across the listing's 1–3 spots, date, time, duration; open/closed per spot for the chosen window |
| Handoff | `/(modals)/handoff/[sessionId]` | The six-digit code, large; the other party's code entry field; confirm |
| Rate | `/(modals)/rate/[sessionId]` | [SPEC-012](SPEC-012-trust-and-safety.md); reachable only from `completed` |
| Thread | `/thread/[threadId]` | [SPEC-011](SPEC-011-messaging.md) |

Session detail is a single screen across all seven states rather than seven screens, because the user's mental model is one exchange with a changing next step. Its layout is fixed top to bottom — **state line → counterparty → item → place and time → primary action → secondary actions → thread entry** — and only the contents change. The primary action is derived from `LEGAL_SESSION_TRANSITIONS` and the caller's role, so a state we forgot to design renders no primary action rather than a wrong one.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Session detail paints from the cached row that brought the user here — the exchanges list, a push tap, or a deep link — so the state line, counterparty, place, and time are on screen immediately, and the thread preview and safe-spot hours fill in. A cold deep link shows a four-block skeleton for at most one round trip, and the router resolves after `fetchQuery` so a session that no longer exists never renders half a screen. The handoff screen is the exception: it **never** paints a code from cache, because the code is not persisted (R51), so it shows a code-shaped skeleton for the duration of one request |
| Empty | Three cases, three different screens. **No incoming requests:** "Nothing waiting on you" plus a link to the user's active listings, or to publishing if there are none. **No outgoing requests or sessions:** "You haven't asked for anything yet" plus `Find something nearby` into the map. **No safe spot open in the next 14 days** (schedule screen): the spot rows render disabled with their next opening, and the section explains it rather than showing an empty time picker — this blocks scheduling and must say so plainly |
| Error (recoverable) | Any 5xx, timeout, or `deadlock` past its three silent retries. The form keeps every field — the request composer and the schedule picker are Zustand drafts with MMKV autosave — and an inline banner offers `Try again`. **The idempotency key is not regenerated on retry** (R80), so a call that actually committed before the timeout returns the original session rather than creating a second |
| Error (terminal) | Four causes, one card: the request or session was resolved by the other party, expired, cancelled by a block, or belongs to a user who has since been suspended. All four render the §8.3 "no longer available" card with a single route back to `/exchanges`, because the requester-side distinction between them is exactly what [SPEC-009 R52](SPEC-009-listings-and-offers.md) forbids. `invalid_transition` also lands here, and additionally emits a Sentry error — for the user it is the same dead end, but for us it is a bug |
| Offline | Reads come from cache and the screen stays fully legible: state, counterparty, safe spot name and address, date, time, and — if the handoff screen was open before the drop — the code that is already on screen. **Every action is disabled with an explicit "You're offline" label rather than hidden** (R84), because a hidden button reads as a missing feature and a disabled one reads as a temporary condition. A persistent banner, never a toast. The handoff screen additionally shows "You both need a connection to confirm" |
| Permission denied | Two cases. **Unverified** (`can_transact` false): the request and accept buttons are present and disabled with an explanatory sheet routing to verification; browsing, the thread, and all read paths stay open. **Suspended:** the same surface with the suspension copy and no route onward — **but cancel and withdraw remain enabled** (R61), because a suspended user with a scheduled meeting must be able to call it off |
| Rate limited | Four limits with four different meanings, and the copy must not blur them: 10/hour on requests ("You've sent a lot of requests"), 30/hour on accepts, 20/day on cancels, and **5 per 15 minutes per session on handoff confirmation**, which is not a throughput limit at all but a brute-force lockout. The first three disable the action for `Retry-After` with a countdown. The fourth renders inline on the code field with the lockout copy and notifies both parties (R49). No auto-retry in any of the four |

Two additional states specific to this feature:

| State | Behaviour |
| --- | --- |
| At the meeting (`scheduled`, within the confirmation window) | The session detail promotes the handoff action to a full-width primary button and pins the safe spot's name, address, and today's hours above it. The screen is designed for one bar of signal and a phone held at arm's length in a lobby: the code is 44 pt, the entry field is numeric-only with a large keypad, and nothing on the screen requires a fresh network call |
| Frozen (`disputed`) | Every action disappears except reading the thread and contacting support. The state line reads the §8.3 dispute copy. The counterparty is not told who reported, and the screen makes no claim about the outcome — moderation has not decided yet, and a screen that implies it has is a screen that gets quoted back to us |

### 8.3 Copy

Exact strings.

**Request composer, header and helper**
> **Ask for {title}**
> {display_name} will see your name, your rating, and anything you offer.

**Request composer, offer section**
> **Offer something in return?** *(optional)*
> Most people do. It's not required — {display_name} said they'll take anything.

**Request composer, message field placeholder**
> Say hello, or say what you'd like it for.

**Request composer, submit button**
> `Send request`

**Request sent confirmation**
> **Request sent.**
> {display_name} has 3 days to reply. We'll let you know either way.

**Request quota reached (R07)**
> **You've got 10 requests waiting.**
> Withdraw one you've changed your mind about, or wait for a reply.
>
> Button: `See my requests`

**Duplicate request (R06)**
> You've already asked for this one.
>
> Button: `Open my request`

**Request, offline**
> You need a connection to send a request. Your message is saved.

**Request, unverified (R02)**
> **Verify your identity to exchange.**
> You can browse and keep an inventory any time. Asking to meet someone needs a verified ID and a verified garden — that's what makes meeting a stranger at a library reasonable.
>
> Button: `Verify now`

**Incoming request, owner's primary actions**
> `Accept` · `Decline`

**Accept confirmation, with other pending requests**
> **Accept {display_name}'s request?**
> The other {n} people waiting will be told it's gone. You'll agree a place and time next.
>
> Buttons: `Not yet` · `Accept`

**Accept confirmation, sole request**
> **Accept {display_name}'s request?**
> You'll agree a place and time next.
>
> Buttons: `Not yet` · `Accept`

**Accepted, requester's notification and screen**
> **{display_name} accepted your request.**
> Pick a time and a place to meet.
>
> Button: `Choose a time`

**Lost the race (R21 — identical to a manual decline)**
> **{display_name} declined your request for "{title}".**
>
> Button: `Find something else`

**Decline confirmation**
> **Decline this request?**
> {display_name} will be told it's no longer available. You can add a note — they won't see it.
>
> Buttons: `Keep it` · `Decline`

**Request expired, requester's inbox (R18)**
> **Your request for "{title}" expired.**
> {display_name} didn't reply within 3 days.

**Schedule screen, header**
> **Where and when?**
> {display_name} offered {n} place{s}. Pick one that works for you both.

**Schedule screen, spot row**
> {name} · {category} · {distance} away · {open_state}

**Schedule screen, spot closed for the chosen window**
> Closed then — open {next_window}

**Schedule screen, stale hours note ([SPEC-007 R20](SPEC-007-safe-spots.md))**
> Hours may be out of date

**Schedule screen, time constraint helper (R37)**
> Any time from an hour from now up to two weeks away.

**Schedule screen, `venue_closed` (R39)**
> **{name} is closed then.**
> Open {today_hours}. Pick another time, or another place.

**Schedule proposed, waiting on the other party**
> **Waiting for {display_name} to agree.**
> {spot_name}, {weekday} {date} at {time}.

**Schedule proposal received**
> **{display_name} suggested a time.**
> {spot_name}, {weekday} {date} at {time}.
>
> Buttons: `Suggest another` · `That works`

**Confirmed schedule, session detail state line**
> **{weekday} {date}, {start}–{end}** at **{spot_name}**

**Reminder, 24 hours (push and inbox)**
> **Exchange tomorrow**
> {item_title} with {display_name} at {spot_name}, {time}.

**Reminder, 2 hours (push and inbox; not quiet-hours suppressible)**
> **Exchange in 2 hours**
> {item_title} with {display_name} at {spot_name}, {time}.

**Handoff screen, header and code**
> **Your code**
> `408213`
> Show this to {display_name}, and type in theirs. You'll both have the same six digits.

**Handoff screen, what the code is — verbatim, and it does not get softened (R52)**
> This just confirms you both turned up. It isn't a security check.

**Handoff screen, entry field label**
> Enter the code

**Handoff, wrong code**
> That code doesn't match. {n} tries left.

**Handoff, too early (R46)**
> You can confirm from {start_minus_30}, half an hour before you're due to meet.

**Handoff, too late (R46)**
> This exchange's window closed at {end_plus_2h}. If you met up, {display_name} can tell us — or cancel it and start again.

**Handoff, locked out (R49)**
> **Confirmation is paused for 15 minutes.**
> There have been 5 wrong codes on this exchange. We've told {display_name} too.

**Handoff, first confirmation done**
> **You've confirmed.**
> Waiting for {display_name} to confirm too.

**Handoff, completed**
> **Exchange complete.**
> Nice one. Rate {display_name}?
>
> Buttons: `Rate now` · `Later`

**Handoff, offline**
> You both need a connection to confirm. Your code is still on screen.

**Cancel dialog, more than 4 hours before (R58)**
> **Cancel this exchange?**
> {display_name} will be told, with your reason. Please give one — it's the difference between a bad day and a bad impression.
>
> Field: `Why are you cancelling?` *(required)*
> Buttons: `Keep it` · `Cancel exchange`

**Cancel dialog, less than 4 hours before (R58)**
> **Cancel this exchange?**
> It's in under 4 hours, so this counts as a late cancellation and will affect how much people trust you here. {display_name} may already be on their way.
>
> Field: `Why are you cancelling?` *(required)*
> Buttons: `Keep it` · `Cancel anyway`

**Cancelled, counterparty's notification (reason in the inbox only, R60)**
> **Your exchange with {display_name} was cancelled.**

**Cancelled, counterparty's inbox body**
> {display_name} cancelled your exchange for "{title}". They said: "{reason}"
>
> Button: `See the listing`

**Cannot cancel — in progress (R57)**
> **One of you has already confirmed.**
> If you didn't meet, don't confirm — the exchange will close itself and we'll record it.

**No-show, both parties (R64)**
> **That exchange didn't get confirmed.**
> The window for {item_title} with {display_name} has passed. If something went wrong, tell us.
>
> Buttons: `Report a problem` · `Dismiss`

**Disputed / frozen (R68)**
> **This exchange is on hold.**
> Someone's reported a problem and we're looking into it. You'll hear from us.

**No longer available — one card for four causes (§8.2 terminal)**
> **This exchange isn't available any more.**
> It may have been cancelled, answered, or expired.
>
> Button: `Back to exchanges`

**Stale state, silent recovery (R83)**
> *(No copy. The screen refetches and re-renders. If the user's intended action is still legal, the button is still there; if not, it isn't.)*

**Rate limited — requests**
> You've sent a lot of requests recently. Try again in {n} minutes.

**Rate limited — accepts**
> You've accepted a lot just now. Try again in {n} minutes.

**Session detail accessibility label (US-17)**
> {state_sentence}. {item_title} with {display_name}. {place_and_time}. {next_action}.
> — e.g. "Scheduled. Cherokee Purple tomatoes with Priya. Ann Arbor District Library Downtown, Monday 10 August, 4 to 4:30 in the afternoon. Next: confirm the handoff code when you meet."

**Handoff code accessibility label**
> Your handoff code is 4, 0, 8, 2, 1, 3. Six digits, read one at a time.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Learn where and when a specific person will physically be.** `exchange_sessions.scheduled_start` + `safe_spot_id` is the highest-value row in the database for a stalker ([Data Model §10](../01-architecture/03-data-model.md)), and this spec is the only thing that writes it. The controls are structural rather than procedural: the pair is readable only through `sessions_select_participant` (`(SELECT auth.uid()) IN (owner_id, requester_id)`), it is excluded from every analytics event and scrubbed from telemetry, sessions are anonymized 90 days after completion, and the block trigger cancels an in-flight session the instant a block is created — which is the case that matters, because the person most likely to want this data is someone the victim has just blocked. The second-worst is **double-promising one item**, which is a physical-world harm: two people drive to a library and one of them leaves with nothing and a story about the app. That is hazard H1 and it is prevented by `FOR UPDATE` plus an in-lock assertion plus `listings_single_reservation`, never by a client check. The third is **brute-forcing a handoff code** to fabricate a completion and a rating; 10⁶ codes against 5 attempts per 15 minutes per session is ~2 × 10⁻⁵ per lockout window, both parties are notified on lockout, and — honestly — the code was never the control that mattered, because it can be read aloud over the phone (R52). |
| Which RLS policies enforce access? | `requests_select_participant` (`auth.uid() IN (requester_id, owner_id) AND NOT app.is_blocked_either_way(requester_id, owner_id)`) and `requests_insert_requester` (Pattern C, [RLS Design §5](../01-architecture/05-rls-design.md)); the equivalent participant policy on `exchange_sessions` backed by `app.is_session_participant()`; `listings_select_discoverable` for everything the requester reads on the way in. **There is no client `UPDATE` policy on either table, and that absence is the load-bearing control** — if a client could `PATCH` `status = 'accepted'`, every concurrency guarantee in this spec would be void. Definer functions: `public.create_exchange_request`, `accept_exchange_request`, `decline_exchange_request`, `withdraw_exchange_request`, `propose_schedule`, `confirm_schedule`, `confirm_handoff`, `cancel_session`; `app.can_transact`, `app.is_blocked_either_way`, `app.is_session_participant`, `app.venue_open_during`, `app.enqueue_notification`, `app.enqueue_notification_bulk_declined`, `app.consume_token`, `app.finalize_completed_session`, `app.release_reservation`, `app.digest_equals`, `app.expire_due_requests`, `app.detect_no_shows`; the triggers `private.guard_session_transition` and `private.guard_request_transition`. Every one of them runs as owner, bypasses RLS entirely, and therefore **re-checks authorization by hand as its first statement** ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| Can any response path expose an exact coordinate or PII? | Only `safe_spots.point`, and only for a public building on the two-line CI allowlist (API-04). No RPC in §7 has a `RETURNS TABLE` column capable of holding a garden coordinate, and no route in §8.1 accepts a coordinate parameter (API-05). The PII that does flow — a counterparty's `profile_cards` row, a confirmed time and place, a free-text message — is P1/P2 and is exposed to exactly the person it is about and the person meeting them. `handoff_code` is the tightest: excluded from the realtime publication (asserted by pgTAP over `pg_publication_tables`, API-08), from every push body, from the default select, and from MMKV persistence. `cancellation_count_90d` and `trust_score` are written here and readable by nobody. |
| What is logged, and is it scrubbed? | Every session state transition writes `audit.events` with the actor, the session id, and the action (`exchange.accepted`, `exchange.scheduled`, `exchange.in_progress`, `exchange.completed`, `exchange.cancelled`, `exchange.no_show`, `exchange.disputed`); `metadata` cannot carry a coordinate because of the `CHECK` on that column. **`handoff_code`, `p_code`, `cancelled_reason`, and `message` are excluded from Postgres statement logging**, alongside `safe_spots_near`'s coordinates. Client analytics carry `state_from`, `state_to`, `role`, `hours_ahead` (bucketed), and `safe_spot_category` — never a `safe_spot_id`, never a `scheduled_start`, never a counterparty id alongside a time. Sentry breadcrumbs for these screens are allow-listed to the state machine's own vocabulary, and the telemetry scrubber test (API-07) covers a synthetic session event. |
| Does this need step-up authentication? | **No, and deliberately so.** Every exchange operation is AAL1 ([API Contract §2.4](../01-architecture/06-api-contract.md)). Requiring a TOTP code at a library counter, on a phone with one bar, while a stranger waits, is a usability failure that would push the handoff off-platform — which is the exact outcome the safe-spot model exists to prevent. The compensating controls are `app.can_transact()` on the entry points, the block check on every path, and the per-session lockout on handoff. |
| Abuse / rate-limit controls | `create_exchange_request` 10/hour/user, reinforced by the structural 10-open-request cap (R07) and the one-pending-per-listing index (R06) — a rate limit alone lets someone accumulate 240 open requests in a day. `accept_exchange_request` 30/hour. `decline` / `withdraw` 60/hour. `propose_schedule` / `confirm_schedule` 30/hour. **`confirm_handoff` 5 per 15 minutes per *session*** — the one limit keyed on something other than a user, because the abuse case is one code and not many calls. `cancel_session` 20/day, deliberately generous (R63). Structural bounds a rate limit cannot substitute for: one reservation per listing, one session per request (`request_id` UNIQUE), 14-day scheduling horizon, 2-hour meeting window, 72-hour request expiry, and the transition guard triggers, which hold against `service_role` and against a migration. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Two owners' devices, one account, accept two different requests on the same listing at the same millisecond. | Both transactions take `FOR UPDATE` on the listing row and serialize. The first flips it to `reserved`; the second's `v_listing.status <> 'active'` assertion fails inside the lock and returns `listing_unavailable` 409. Exactly one `exchange_sessions` row exists. `listings_single_reservation` is the backstop if a future function takes locks in a different order (R71, T30). |
| EC-02 | Fifty requesters' clients race to be accepted; the owner taps Accept fifty times through a flaky connection. | The idempotency probe (R24) returns the original `session_id` for every replay of the same key, before any lock is taken — **never the code**, which no acceptance path returns (R30). A *different* key on the same request falls through to the natural-key lookup and also returns the original `session_id`, so a client that regenerates its key on retry still cannot accept twice. One session, one code, one notification to the winner, forty-nine `request_declined`. |
| EC-03 | A listing's `expires_at` passes during an acceptance transaction. | `app.expire_due_listings` selects only `status = 'active'`, so a row that just became `reserved` is invisible to it ([SPEC-009 R33](SPEC-009-listings-and-offers.md)); `accept_exchange_request` re-checks `expires_at` inside its lock. Whichever commits first wins cleanly, and there is no interleaving that produces an expired reservation (H8, R78). |
| EC-04 | A user blocks their counterparty ten minutes before a scheduled meeting. | `on_block_created` cancels the session (`cancelled_reason = 'blocked'`), cancels any pending requests, and closes the thread, all in one trigger. Both get `exchange_cancelled`; the blocked party is never told a block exists and sees only a cancelled exchange. **`counts_as_late` is not set** — a block is a safety action and must never carry a trust penalty for the person who used it. |
| EC-05 | The requester is suspended between acceptance and the meeting. | The session is cancelled by the suspension fanout and both are notified. The suspended user **can still cancel and still read the time and place** (R61), because a suspended user with an unclosed meeting is a no-show waiting to happen. |
| EC-06 | The chosen safe spot is suspended after the schedule is confirmed. | [SPEC-007 R28](SPEC-007-safe-spots.md)'s fanout notifies both parties and returns the session to `scheduling` with the proposal cleared; the listing's remaining spots are offered. If the listing's spot set is now empty, the listing is withdrawn and the session is cancelled with reason `spot_unavailable` and `counts_as_late = false` — nobody's fault, nobody's penalty. |
| EC-07 | Both parties tap Confirm on the handoff screen in the same millisecond. | The H4 statement sets each caller's own column and derives the state from the other's in one `UPDATE`. Whichever commits second sees the first's timestamp and produces `completed`; the first sees `in_progress`. No lost update, no session stuck at one confirmation (R74, T54). |
| EC-08 | One party confirms, then confirms again, hoping to complete alone. | The second call is idempotent: `COALESCE(owner_confirmed_at, now())` does not re-stamp, the derived state stays `in_progress`, and the response reports the current state. There is no sequence of calls by one party that reaches `completed` (R48). |
| EC-09 | One party cancels at the exact instant the other confirms the handoff. | Both take `FOR UPDATE` on the session. If the confirmation commits first, the cancel's in-lock state assertion fails with `invalid_transition` — **completion wins ties** (R69), because the goods have physically changed hands. If the cancel commits first, the confirmation gets `invalid_transition` and the handoff screen refetches into the cancelled state. |
| EC-10 | A and B each hold a pending request against the other's listing, and both accept in the same instant. | The global lock order `listings → exchange_requests → exchange_sessions` means the two transactions request the same resources in the same sequence and one simply waits. If a genuine deadlock still occurs — a new function violating the order, say — Postgres aborts one with `40P01` and the client retries ×3 with jitter, invisibly (R77, R86). |
| EC-11 | The client's cached session is three versions behind and it sends a cancel. | `p_expected_version` mismatches, `stale_state` 409, the optimistic update rolls back, the client refetches and re-renders. The cancel is replayed only if it is still legal against the fresh state — **never blind-retried** (R75, R83). |
| EC-12 | A request is accepted while the requester's app is showing the request as pending. | The `session:{id}` and `user:{id}` channels invalidate; if the app is backgrounded, the push and the durable inbox row carry it. Realtime is an invalidation hint, never state ([Realtime & Notifications §1.4](../01-architecture/08-realtime-and-notifications.md)), so the handler refetches rather than writing `payload.new`. |
| EC-13 | The proposed window spans local midnight (23:30–00:30). | `app.venue_open_during` returns false and `propose_schedule` raises `venue_closed` 422. Every eligible safe-spot category closes at night, so this is always an error and needs no special case ([SPEC-007 EC-08](SPEC-007-safe-spots.md)). |
| EC-14 | The two parties are in different timezones, or one is travelling. | Hours are evaluated in the **venue's** timezone by `app.venue_open_during` (R39); the client renders the meeting time in the venue's timezone with the abbreviation shown whenever it differs from the device's. Rendering venue hours in the viewer's timezone is a bug that sends people to a locked door. |
| EC-15 | A user's device clock is 40 minutes fast and they try to confirm the handoff early. | The server is authoritative: `now()` inside `confirm_handoff` is Postgres's, and the attempt returns `validation_failed` with the "too early" string computed from `scheduled_start`. The client's countdown is decoration; the RPC is the rule. |
| EC-16 | Someone enters four wrong codes, waits an hour, then enters four more. | The window is rolling and 15 minutes long, so the first four have lapsed and the counter resets on the fifth attempt — the attacker is back to five fresh tries, and a pair who legitimately fumbled an hour ago are not punished for it. On the 5th wrong attempt *inside* one window, `handoff_locked_until = now() + 15 min` and both parties get a `safety_alert`. A patient attacker gets ~20 guesses an hour against 10⁶ codes; the notification means the victim finds out on the first lockout. **Every one of those counters survives because the failure path returns rather than raises** (R49a) — the original draft rolled all of it back and bounded nothing. Honestly: this bounds the attack, it does not make the code a security control (R52). |
| EC-16a | The handoff window closes while someone is mistyping. | `handoff_window_closed` is returned, it costs **no attempt**, and the response carries `attempts_remaining` unchanged. Being late is not a guess, and charging an attempt for it would let a slow clock exhaust a real pair's budget. |
| EC-17 | `detect_no_shows` is down for six hours. | Nothing incorrect becomes visible — a session past its window simply stays `scheduled`, and its actions remain legal, which is the right thing to degrade. On resume, the backlog drains 200 rows per 15-minute tick with `SKIP LOCKED`. The visible symptom is delayed no-show notifications, and the `exchange.no_show_backlog` gauge is how we find out. |
| EC-18 | Both parties met and neither pressed confirm. | `detect_no_shows` moves the session to `no_show` with `no_show_by = NULL` and **no marker on either party** (R66). Two people who forgot are indistinguishable from two people who never turned up, and guessing would punish the wrong person roughly half the time. Both are notified and offered a report action, not a report. |
| EC-19 | A report is filed 30 minutes after completion. | The session moves `completed` → `disputed` (R67). Ratings for that session are frozen, the listing stays `completed` (the reservation was already released by completion), and both parties see the §8.3 hold copy. Resolution is a moderator action, audited as `exchange.dispute_resolved`, notified as `moderation_outcome`. `disputed → completed` re-runs nothing, because `app.finalize_completed_session` is idempotent (R68b). |
| EC-19a | A report is filed against a session scheduled for tomorrow. | `scheduled → disputed` freezes it (R67). This is the case the transition table originally could not express, and it is the one that matters most: the reporter has a confirmed time and place with someone they have become afraid of. Neither party can transition the session afterwards; both see the hold copy; **the listing stays `reserved` until a moderator resolves**, which is why `dispute_sla_breach` pages at 7 days (R68c). |
| EC-22a | Someone contests a no-show marker they did in fact earn. | It clears, and that is intended. R64b makes the contest itself a recorded trust signal rather than a hard clear, so one contest reads as a person explaining themselves and eleven read as a pattern — visible to moderation and to `trust_score`, without a machine deciding which is which. Making the tap expensive to use would mostly deter the honest, who are the ones it exists for. |
| EC-22b | Both parties contest markers on each other. | Impossible: `detect_no_shows` attributes to at most one party (R65/R66), so at most one marker exists per session and only the party it names can contest it (R64c). |
| EC-19b | A dispute is resolved as "the exchange did not stand". | `disputed → cancelled` via `moderation-action` (R68a): `app.release_reservation` returns the listing to `active` and the item to `listed`, `reserved_request_id` is nulled, `cancelled_by` is the moderator, and **`counts_as_late` is not set** — a moderated outcome is nobody's late cancellation. Without this path the item is frozen forever: `expire_listings` skips `reserved` (R78), `detect_no_shows` never revisits a terminal state, and `listings_one_active_per_item` covers `reserved`, so the owner could never relist it. |
| EC-19c | A moderator never resolves a dispute. | `dispute_sla_breach` alerts hourly past 7 days (R68c). There is deliberately **no automatic resolution** — guessing the outcome of a safety report is worse than a held listing — and `orphan_reservation_scan` (R68d) catches the general case of a reservation whose session is already terminal. Neither job mutates anything; both page a human. |
| EC-20 | A moderator's console writes an illegal state directly as `service_role`. | `trg_guard_session_transition` raises `invalid_transition` regardless of role. The trigger is on the table, not in the RPC, precisely so that a migration, an admin script, or a mistaken `service_role` write cannot produce an illegal state (R79). The same holds for requests via `trg_guard_request_transition` (R20). |
| EC-21 | An old client is missing an enum value after a `session_state` addition. | It cannot happen without a new RPC: adding a `session_state` value is a **breaking** change under [API Contract §3.2](../01-architecture/06-api-contract.md). The generated `LEGAL_SESSION_TRANSITIONS` (R81) means an added state that the client does not know about is a compile error at build time, not a blank screen at runtime. |
| EC-22 | The user opens the handoff screen, loses signal, and the meeting happens anyway. | The code already on screen stays rendered; confirmation is disabled with "You both need a connection to confirm" and is **not** queued (R53, R84). If neither confirms before the sweep, the session becomes `no_show` with no attribution and both are prompted to report. If *one* of them had signal, the other accrues a marker they did not earn — and that is what `contest_no_show` (R64a) is for: one tap, no free text, attribution cleared, a trust signal recorded. The queue remains the wrong answer, but the marker is no longer the last word. |
| EC-23 | An accepted exchange is cancelled after the listing's original `expires_at` has passed. | `cancel_session` returns the listing to `active` and the item to `listed`, and leaves `expires_at` untouched (R59), so the listing expires on the sweeper's next tick — correctly, because the produce is now a week older than when it was published. The owner's inbox gets the expiry notice with the one-tap relist ([SPEC-009 R37](SPEC-009-listings-and-offers.md)). |
| EC-24 | A user withdraws a request in the same instant the owner accepts it. | Both take `FOR UPDATE` on the request row after the listing. Whoever commits first wins; the loser's `status = 'pending'` assertion fails with `request_not_pending` 409. If the withdrawal wins, the listing was never reserved and stays `active`; there is no interleaving that reserves a listing against a withdrawn request. |
| EC-25 | The notification outbox drain is down for an hour after an acceptance. | The `notifications` row and the outbox row committed with the state change, so nothing is lost: the requester sees the acceptance the moment they open the app, and the push arrives when the drain resumes. **A total notification outage degrades the product to "not live", never to "wrong"** ([Realtime & Notifications §8.1](../01-architecture/08-realtime-and-notifications.md)). |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `exchange.request_created` | product event | `has_offer`, `has_message`, `proposed_spot`, `open_requests_after` | — |
| `exchange.request_failed` | error event | `code`, `stage` | `listing_unavailable` > 5% of attempts ⇒ the map is showing reserved listings as available |
| `exchange.request_resolved` | product event | `outcome` (`accepted`\|`declined`\|`auto_declined`\|`withdrawn`\|`expired`\|`cancelled`), `age_hours` | `expired` > 35% ⇒ owners are not being reached; revisit the 72-hour window (Q1) |
| `exchange.time_to_response_hours` | histogram | `outcome` | p50 > 24 h ⇒ the incoming badge is not doing its job |
| `exchange.accept_contention` | counter | `losers` (count of auto-declined) | `losers` p95 > 4 ⇒ supply is far thinner than demand in that metro |
| `exchange.accept_conflict` | error event | `code` | Any `listing_unavailable` is normal; a **rise** tracks the map's `staleTime` |
| `exchange.double_reservation` | error event | `listing_id` | **Any occurrence — page.** This is H1 defeated, and it means two people are driving to a library |
| `exchange.session_transition` | product event | `from`, `to`, `role`, `hours_since_accept` (bucketed) | — |
| `exchange.schedule_proposals` | histogram | `count_before_confirm` | p95 > 4 ⇒ the spot/time picker is making agreement hard |
| `exchange.venue_closed` | error event | `safe_spot_category` (**never `safe_spot_id`**) | > 20 per spot per day is [SPEC-007 §11](SPEC-007-safe-spots.md)'s bad-hours alarm; here we track only the category |
| `exchange.handoff_attempt` | counter | `result` (`ok`\|`wrong_code`\|`out_of_window`), `attempt_index` | `wrong_code` > 15% of attempts ⇒ the code is being mistyped, not guessed; check the entry field |
| `exchange.handoff_lockout` | error event | `session_age_hours` | **> 5 in an hour across the fleet — page.** Either a brute-force campaign or a broken keypad, and both need a human |
| `exchange.completion_rate` | ratio | per metro, per week | < 70% of `scheduled` sessions reaching `completed` ⇒ the meeting model is failing and no amount of app polish fixes it |
| `exchange.cancelled` | product event | `by_role`, `counts_as_late`, `hours_before_start` (bucketed), `state_at_cancel` | `counts_as_late` > 20% of cancellations ⇒ the 4-hour threshold or the reminder cadence is wrong |
| `exchange.no_show` | product event | `attribution` (`owner`\|`requester`\|`none`), `both_messaged_after` | **`none` > 50% of no-shows sustained 14 days, with `completion_rate` < 70% ⇒ switch to `dual_with_fallback` (R91).** This is the pre-committed trigger for the completion-model decision, not a general-purpose alarm |
| `exchange.no_show_contested` | product event | `role`, `hours_after_sweep` | Rising share ⇒ `detect_no_shows` is blaming people who turned up. A **high** rate is not abuse, it is evidence R65's attribution is weaker than assumed (R64b) |
| `exchange.code_read` | counter | `role`, `hours_before_start` (bucketed) | A read with **no** subsequent handoff attempt on the same session, at volume, means codes are being fetched by something other than a person about to meet someone |
| `exchange.no_show_backlog` | gauge | `oldest_due_minutes` | > 60 minutes ⇒ `detect_no_shows` is not keeping up or is not scheduled |
| `exchange.disputed` | product event | `from_state`, `hours_since_completion` | Any spike is a [SPEC-012](SPEC-012-trust-and-safety.md) signal first and an engineering signal second |
| `exchange.stale_state` | error event | `rpc`, `version_gap` | `version_gap` p95 > 2 ⇒ realtime invalidation is not reaching the client |
| `exchange.invalid_transition` | error event | `rpc`, `from`, `to` | **Any occurrence — investigate.** It means the generated machine drifted or a button rendered that should not have (R81, R82) |
| `exchange.deadlock_retry` | counter | `rpc`, `attempt` | > 10 / hour ⇒ a new function is taking locks out of order (H7) |
| `exchange.transition_guard_rejection` | error event | `table`, `from`, `to`, `role` | **Any occurrence — page.** A trigger rejection means something other than the RPCs tried to move state, including `service_role` |
| `exchange.cron_heartbeat` | gauge | `job` (4 jobs), `last_success_age_s` | Any job with `last_success_age_s` > 3× its cadence |

**Never emitted:** a `handoff_code` or any part of one, a `scheduled_start`, a `safe_spot_id`, a counterparty id alongside a time, a `cancelled_reason` or `message` body, `cancellation_count_90d`, `trust_score`, or any coordinate. The rule that makes this checkable rather than aspirational: exchange analytics use a fixed property allow-list in the analytics wrapper, and a lint rule fails any `track()` call on these screens whose properties are not in it.

## 12. Accessibility

- The session state, the counterparty, the place and time, and **the next action** are read as **one statement** via the composed label in §8.3, not as eleven separate stops. An exchange is a commitment, and a commitment needs its facts in one utterance — this is the single most important accessibility decision in the spec.
- **The handoff code is announced digit by digit** ("4, 0, 8, 2, 1, 3"), never as "four hundred eight thousand two hundred thirteen", using an `accessibilityLabel` with comma separation. A six-digit number read as a quantity is unusable for its purpose.
- The code entry field is `keyboardType="number-pad"`, `textContentType="oneTimeCode"`, `maxLength={6}`, with `accessibilityHint` naming the counterparty, and it announces attempts remaining through a `polite` live region after each failure — never only as red text.
- **State changes are announced.** The session detail's state line is an `accessibilityLiveRegion="polite"` region, so a schedule confirmed by the other party, an acceptance, or a cancellation arriving over realtime is spoken rather than silently repainted.
- Every timestamp is rendered as text with weekday, date, and both times spelled out, never as a bare numeric string and never as relative-only ("in 3 hours"). At the meeting the user needs the absolute time; on the list they need the relative one; both appear, in that order.
- The primary action is the **first focusable element** after the state line on the session detail, so a screen-reader user reaches "Accept", "Choose a time", or "Confirm handoff" in two swipes rather than twelve.
- Cancellation and acceptance dialogs are `accessibilityViewIsModal` with a fixed button order (dismissive first, destructive second), a labelled required reason field, and focus returning to the invoking control on dismissal ([Mobile Architecture §10.2](../01-architecture/02-mobile-architecture.md)).
- **The late-cancellation warning is text, not colour.** "This counts as a late cancellation" is announced; an amber banner is not, and an amber banner alone would hide the only consequence in the flow.
- The schedule screen's spot rows are a `radiogroup` with each option labelled in full — name, category, distance, and open/closed for the chosen window — so the open/closed state is never conveyed by a dot alone.
- Offline and rate-limited states are `accessibilityState={{ disabled: true }}` **with** an `accessibilityHint` giving the reason and, where applicable, the countdown. A disabled button with no reason is indistinguishable from a broken one.
- Dynamic type to 200% throughout, with no capping. The handoff code scales with it and wraps rather than truncating; a truncated code is worse than no code.
- Hit targets ≥ 44 × 44 dp on every action, chip, spot row, and keypad key — the handoff screen in particular is used one-handed, standing up, in a lobby.
- Reduced motion: the confirmation success animation and the state-line cross-fade become instant changes.

## 13. Test Plan

### 13.1 Coverage matrix

> **T30 is fixed.** It is cited by name from [Exchange State Machine §5 H1](../01-architecture/07-exchange-state-machine.md) and from [SPEC-009 EC-15](SPEC-009-listings-and-offers.md), so it sits here rather than in the concurrency block and its number is a stable reference, not an ordering.

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01, R02 | `create_exchange_request` is the only successful path; a direct `POST /rest/v1/exchange_requests` is denied by `requests_insert_requester`; unverified, garden-unverified, and suspended callers each get `not_verified` 403 while retaining full read access |
| T02 | integration | R03 | Requesting a `reserved`, `withdrawn`, `completed`, or `expired` listing returns `listing_unavailable` / `listing_expired` 409; the assertion is proven to run inside the transaction by an injected delay between read and insert |
| T03 | integration | R04 | Self-request rejected with `validation_failed` 400 by the guard, and independently by the `no_self_request` CHECK when the guard is stubbed out |
| T04 | rls | R05 | Blocked in either direction returns `blocked` 403; the listing is also absent from every read the requester can perform |
| T05 | integration | R06 | A second pending request for the same (listing, requester) returns `conflict` 409; asserted against `exchange_requests_one_pending` directly, not only through the RPC |
| T06 | integration | R07 | The 11th open request returns `quota_exceeded` 422; withdrawing one frees a slot immediately; the count is per-requester and unaffected by other users |
| T07 | integration | R08 | `offered_item_id` not owned, or in `listed`/`reserved`/`exchanged`/`archived`, each rejected with `validation_failed` 400 |
| T08 | integration | R09, R12 | A 301-character message rejected; a 300-character message stored and present as the thread's first `user` message; a `proposed_safe_spot_id` outside the listing's set rejected; one inside the set stored and binding nothing |
| T09 | integration | R10 | The thread row exists after `create_exchange_request` and shares its transaction — an injected failure after the request insert leaves neither row. `accept_exchange_request`'s `ON CONFLICT DO NOTHING` creates no second thread |
| T10 | integration | R11, R18 | `expires_at` defaults to exactly `created_at + 72 h`; `expire_requests` moves only due `pending` rows, in batches of 500, with `SKIP LOCKED`, and writes an inbox row per requester |
| T11 | integration | R13 | 10 requests succeed in an hour, the 11th returns `rate_limited` 429 with integer `Retry-After`; replaying one `p_idempotency_key` returns the original `request_id`; the same key with different arguments returns `idempotency_conflict` 409 |
| T12 | integration | R14 | `request_received` writes a `notifications` row **and** a `private.notification_outbox` row in the same transaction as the request; a rolled-back request leaves neither |
| T13 | integration | R15, R16 | Decline by the owner sets `declined` + `responded_at`; a 201-character reason is rejected; the reason is absent from every requester-reachable select and from the realtime payload |
| T14 | integration | R17 | Withdraw by the requester sets `withdrawn`; the owner gets an inbox row and **no** outbox row; a non-requester gets `not_authorized` 403 |
| T15 | integration | R19 | Block creation, listing withdrawal, and owner suspension each move `pending` → `cancelled` for the affected requests, in one transaction with their trigger |
| T16 | integration | R20, R22 | Every ordered pair of `request_status` values is attempted; the 5 legal pairs succeed and the other 25 raise `invalid_transition` — including as `service_role`. Generated from `private.legal_request_transitions`, not hand-written |
| T17 | e2e | R21 | An auto-declined loser and a manually declined requester receive byte-identical notifications, byte-identical screens, and byte-identical wire responses |
| T18 | rls | R23, R33 | `accept_exchange_request` is the only path that produces `accepted`; `EXECUTE` is revoked from `PUBLIC` and `anon` and granted to `authenticated`, asserted for all eight RPCs by introspecting `information_schema.role_routine_grants` |
| T19 | integration | R24, R30 | The idempotency probe returns the original `session_id` **and no code column at all** — the return type is asserted to have exactly one column — and is proven to run **before** any lock, by asserting no lock is held on the listing during a replay (`pg_locks` inspection). A replay with a fresh key hits the natural-key lookup and returns the same `session_id` |
| T20 | integration | R25 | Lock-order assertion for all eight RPCs: acquisitions are observed in `listings → exchange_requests → exchange_sessions` order. A deliberately reversed variant is shown to deadlock and is rejected in review |
| T21 | integration | R26 | Non-owner → `not_authorized` 403; owner without `can_transact` → `not_verified` 403; blocked either way → `blocked` 403. Each asserted by calling the definer function directly, because RLS does not apply to it |
| T22 | integration | R27 | Each of request-not-pending, request-expired, listing-not-active, and listing-expired fails inside the lock. Proven by mutating the row from a second session between the client's read and its call |
| T23 | integration | R28, R29 | Acceptance is atomic across all six writes — an injected failure at each of six points leaves zero of them. The auto-decline is a single statement over 20 competing requests, asserted by statement count, and every loser is `declined` on commit |
| T24 | integration | R30, R30a, R31, R32 | The code is six digits from `gen_random_bytes`; **uniformity is asserted by χ² over 10⁶ generations at p = 0.01 across 100 buckets**, which is sized to detect the 6.25% modulo skew the rejection sampler exists to remove — a 100k-sample eyeball test passes on a biased generator and proves nothing. `accept_exchange_request`'s return type is asserted to have exactly one column and for it not to be `handoff_code`. Winner and losers each get exactly one outbox row; `audit.events` carries `exchange.accepted` |
| T24a | unit | R30a | The generator is run against a stub RNG that returns values ≥ 16,000,000 twice before a valid draw, proving the rejection loop retries rather than folding; and the un-cast `lpad(integer, …)` form is asserted to fail to resolve, so nobody reintroduces it |
| T25 | integration | R34, R35, R36 | A session begins `scheduling`; a spot outside `listing_safe_spots` is rejected; a `proposed`/`suspended`/`retired` spot is rejected at propose **and** a spot suspended between propose and confirm is rejected at confirm |
| T26 | integration | R37, R38 | Boundary sweep: `now()+59m` rejected, `now()+61m` accepted, `now()+14d−1h` accepted, `now()+14d+1h` rejected; windows of 14 min and 2 h 1 min rejected by `sessions_window_length`, 15 min and 2 h accepted |
| T27 | integration | R39 | `venue_closed` 422 for a window outside weekly hours, inside an exception, and spanning local midnight; hours evaluated in the venue's timezone with the parties in three different ones; the response carries that day's hours |
| T28 | integration | R40, R41 | The proposer confirming their own proposal gets `validation_failed`; the other party succeeds; a new proposal from either side supersedes the previous one, resets confirmation, and leaves the state `scheduling` |
| T29 | integration | R42, R43, R44 | Every session RPC rejects a stale `p_expected_version` with `stale_state` and increments `version` on success; `remind_upcoming` fires at 24 h and 2 h and the 2 h reminder ignores quiet hours; the contract sweep finds no coordinate column on any RPC return type in this spec |
| T29a | integration | R63a, R63b | Each of the five limits promoted from prose is exercised to its boundary: accept 30/h, decline 60/h, withdraw 60/h, propose 30/h, confirm 30/h. The (n+1)th returns `rate_limited` 429 with an integer `Retry-After`, and `pg_locks` is inspected to prove **the token was consumed before any row lock was taken** |
| **T30** | integration | **R71 (H1)** | **50 concurrent acceptors on one listing.** Exactly **one** succeeds; **49** receive `listing_unavailable` 409; exactly **one** `exchange_sessions` row exists; the listing is `reserved` with `reserved_request_id` matching the winner; the inventory item is `reserved`; 49 requests are `declined`; 49 `request_declined` outbox rows exist. Asserted on **row counts**, not on error messages. Repeated 20 times in CI, and repeated with the in-lock status assertion stubbed out to prove `listings_single_reservation` alone still holds the line. **That sub-case is why R71's index definition matters:** the `(id) WHERE status = 'reserved'` form the first draft carried constrains nothing, so a stubbed run against it would have produced 50 winners and still reported green |
| T31 | integration | R30, R45, R51 | `handoff_code` is null-shaped in every default select, absent from the realtime publication (pgTAP over `pg_publication_tables`), **absent from `accept_exchange_request`'s return type**, absent from every push body across every **MVP** notification kind — the list is derived from `private.notification_templates` filtered by phase, not from the `notification_kind` enum, which also carries the Phase 2 `surplus_alert` — and absent from the MMKV persistence allow-list. It is readable by an explicit single-column select only when `state = 'scheduled'` |
| T32 | integration | R46 | Confirmation at `start − 31 min` and at `end + 2 h 1 min` rejected; at `start − 29 min` and `end + 1 h 59 min` accepted. Server clock is authoritative; a client clock skewed 40 minutes changes nothing |
| T33 | integration | R47, R55 | First correct confirmation → `in_progress`; the other party's → `completed` with `completed_at` set **by the same statement**, asserted by checking `xmin` equality on the two column groups |
| T34 | integration | R48 | Ten confirmations from one party, at intervals, never reach `completed`; `owner_confirmed_at` is stamped once and never re-stamped |
| T35 | integration | R49, R49a, R49b | Five wrong codes lock the session for 15 minutes and enqueue a `safety_alert` outbox row for **both** parties. **`handoff_attempts` is re-read from the database after each attempt and asserted to be 1, 2, 3, 4, 5** — this is the assertion that catches the original rollback defect, and a test that only checks the final response passes against a function that counts nothing. `attempts_remaining` counts down in the response body. A sixth attempt inside the window returns `rate_limited` with `retry_after_s` and does not increment. The limit is per session: a second session by the same user is unaffected |
| T35a | integration | R49 | After a lockout expires and 15 minutes pass with no attempt, `handoff_attempts` and `handoff_window_started_at` reset, and a legitimate pair get a full five tries again. Four wrong attempts followed by an hour's gap do not contribute to a later lockout |
| T35b | integration | R49a | Fault injection: every failure path of `confirm_handoff` is exercised and the transaction is asserted to have **committed**, by reading the row from a second connection. A variant that restores the `RAISE EXCEPTION` on the wrong-code branch is asserted to fail this test — the regression guard for the defect itself |
| T35c | integration | R46, EC-16a | A confirmation outside the window returns `handoff_window_closed` and leaves `handoff_attempts` **unchanged**. Being late is not a guess |
| T36 | integration | R50 | Completion sets listing `completed`, item `exchanged`, `completed_exchanges` +1 for both, unlocks ratings, and schedules the thread close at +14 days — asserted as one transaction with an injected failure at each step |
| T37 | unit | R52 | A repository-wide grep asserts no user-facing string, notification template, store copy, or code comment describes the handoff code as verification, security, proof of identity, or fraud prevention. The §8.3 string is asserted verbatim |
| T38 | e2e | R53, R84 | With the device offline, every exchange action is disabled with a visible reason and **no mutation enters the paused queue**; `queryClient.getMutationCache()` is asserted empty for the exchange mutation keys |
| T39 | unit | R54 | `app.digest_equals` timing is measured over 10⁵ comparisons with first-digit and last-digit mismatches; the difference in means is within noise. A short-circuiting implementation fails this test |
| T40 | integration | R56, R63 | Empty and 201-character reasons rejected by the RPC **and** by `sessions_reason_required` when the RPC is bypassed; the 21st cancellation in a day returns `rate_limited` 429 |
| T41 | integration | R57 | Cancel from `scheduling` and `scheduled` succeeds; from `in_progress`, `completed`, `cancelled`, `no_show`, and `disputed` returns `invalid_transition` 409 |
| T42 | integration | R58 | Cancelling at `start − 4 h 1 min` sets `counts_as_late = false`; at `start − 3 h 59 min` sets it true and increments `cancellation_count_90d` by exactly 1; a cancel from `scheduling` (no start yet) is never late |
| T43 | integration | R59 | Cancellation returns the listing to `active` and the item to `listed` in the same transaction, and leaves `expires_at` byte-identical — including when `expires_at` is already in the past |
| T44 | integration | R60 | Both parties get `exchange_cancelled`; the reason is present in the `notifications` row and **absent** from the push body; the notification is delivered during quiet hours |
| T45 | rls | R61 | A suspended user and a user whose verification expired can both call `cancel_session` and `withdraw_exchange_request` and can read the session's time and place; they cannot call `create` or `accept` |
| T46 | integration | R62 | After cancellation the `exchange_requests` row is still `accepted`; an attempt to move it back to `pending` raises `invalid_transition` |
| T47 | integration | R64 | `detect_no_shows` selects only `scheduled`/`in_progress` more than **2 h 15 min** past `scheduled_end`, processes 200 per run with `SKIP LOCKED`, releases the reservation, and notifies both parties. **Boundary case:** a session at exactly `scheduled_end + 2 h` is *not* swept, and a `confirm_handoff` issued at that instant succeeds — asserted by running the sweeper and the confirmation concurrently 200 times with zero `invalid_transition` results |
| T48 | integration | R65, R66 | Owner-confirmed-only → `no_show_by = requester_id`; requester-confirmed-only → `no_show_by = owner_id`; neither confirmed → `no_show_by IS NULL` and neither profile's counters move |
| T48a | integration | R64a, R64c | The marked party clears their marker with one call: `no_show_by` becomes NULL, `no_show_contested_by`/`_at` are set, and **`state` is still `no_show`**. The *unmarked* party, a stranger, a second attempt, and an attempt 8 days after `scheduled_end` each fail with `not_authorized` / `conflict` / `invalid_transition` |
| T48b | integration | R64b, R64d | A contest writes one `no_show_contested` trust signal and one `audit.events` row, notifies the counterparty in the **inbox with no outbox row**, and carries no free-text field anywhere in the request or the notification |
| T49 | integration | R67, R68 | A report against a **`scheduling`**, `scheduled`, `in_progress`, and 71-hour-old `completed` session each freezes it to `disputed`; a report against a 73-hour-old completion does not; no participant RPC transitions out of `disputed`. All four edges are asserted **against the trigger**, not only through the RPC — the original transition table omitted two of them and this test passed only because it never reached the guard |
| T49a | integration | R68a | `disputed → cancelled` via `moderation-action` releases the reservation: listing `active`, item `listed`, `reserved_request_id` NULL, `counts_as_late` false. Asserted as one transaction with an injected failure at each step. A participant attempting the same transition gets `not_authorized` |
| T49b | integration | R68b | `app.finalize_completed_session` called twice on one session increments `completed_exchanges` by exactly 1 per party, leaves the item `exchanged`, and schedules exactly one thread close. `disputed → completed` on a session that already completed is a no-op beyond the state change |
| T49c | integration | R68c, R68d | `dispute_sla_breach` alerts on a 7-day-old dispute and **mutates nothing**; `orphan_reservation_scan` alerts on a listing `reserved` against a terminal session and on one reserved 22 days, and mutates nothing. Both asserted by row-hash before and after |
| T50 | integration | R69 | Confirmation and cancellation issued in the same millisecond, 200 times: the session is `completed` or `cancelled`, never both and never inconsistent, and where they genuinely interleave the confirmation is the winner |
| T51 | integration | R70 | A `no_show` creates zero `reports` rows and one notification per party carrying a report action |
| T52 | integration | R72 (H2) | Acceptance against an item already `reserved` or `exchanged` fails; `listings_one_active_per_item` holds under 50 concurrent publish-then-accept attempts on one item |
| T53 | integration | R73 (H3) | 100 replays of `create_exchange_request` with one key produce one row; 100 concurrent creates with distinct keys against one listing from one requester produce one row, the rest `conflict` |
| T54 | integration | R74 (H4), R42a | 200 paired simultaneous `confirm_handoff` calls, **both sides sending the same pre-read `p_expected_version`**: every session reaches `completed` exactly once, `owner_confirmed_at` and `requester_confirmed_at` are both non-null, no session is stranded at one confirmation, and **zero `stale_state` responses are returned**. The last clause is the point — a variant that restores the strict version check on this RPC fails it, which is what the original spec would have shipped |
| T55 | integration | R75 (H5), R42a | `propose_schedule`, `confirm_schedule`, and `cancel_session` with a version one behind, one ahead, and null each return `stale_state`; the client harness asserts no blind retry follows. **`confirm_handoff` with the same three inputs succeeds**, and the version it echoes back is the post-mutation one |
| T56 | integration | R76 (H6) | Cancel and confirm racing on 200 sessions: exactly one commits, the other gets `invalid_transition`, and the outcome respects R69 |
| T57 | integration | R77 (H7) | Two reciprocal exchanges accepted simultaneously, 200 times: no deadlock under the correct lock order; with a deliberately reversed variant, `40P01` occurs and the client's ×3 jittered retry recovers |
| T58 | integration | R78 (H8) | 200 `reserved` rows with past `expires_at`; after 10 `expire_listings` runs, zero are modified. Concurrently, acceptance of a listing expiring at that instant either succeeds or returns `listing_expired`, never both |
| T59 | integration | R79, R79a | All ordered pairs of `session_state` — the generator enumerates `pg_enum` and counts rows in `private.legal_session_transitions` rather than hard-coding a total, so adding a state cannot leave a stale literal behind. Rows in the table succeed; every other pair raises `invalid_transition` — asserted as `authenticated`, as `service_role`, and from a raw migration statement. Separately, `disputed → cancelled` and `disputed → completed` are asserted to pass the trigger but to be **unreachable from any participant RPC** |
| T60 | integration | R80, R80a | Every one of the eight RPCs replayed with the same key returns the original result and creates nothing; each replayed with different arguments returns `idempotency_conflict` 409; a NULL key returns `validation_failed` 400. `private.idempotency_keys.args_hash` is asserted to be a digest and the table is asserted to carry **no column capable of holding free text** — a verbatim `args` column on `create_exchange_request` would contain the requester's P1 message |
| T60a | integration | R80 | The probe is proven to run **before any lock** on all eight RPCs by inspecting `pg_locks` during a replay, and the record is proven to share the effect's transaction by injecting a failure after the effect and asserting the key is absent afterwards — a key that survives a rollback silently suppresses the retry that would have fixed it |
| T60b | integration | R24 | Accepting the same request twice with two **different** keys returns the same `session_id` from the natural-key lookup, not `idempotency_conflict`: a new key against an already-accepted request is still not a second acceptance |
| T61 | unit | R81 | `scripts/gen-transitions.ts` run against the migration produces `machine.ts` byte-identically; a manual edit fails CI; adding a row to `private.legal_session_transitions` without regenerating fails the type check |
| T62 | e2e | R82 | For each of the seven states × two roles, the rendered action set is asserted to be exactly the legal set. No screen in any state renders an action that produces `invalid_transition` |
| T63 | unit | R83 | `onMutate` applies only legal transitions; every error path rolls back to the pre-mutation cache; `stale_state` triggers refetch-then-re-evaluate and replays only when still legal |
| T64 | unit | R85, R86 | Every code in §7.10 maps to its stated surface and retry policy in `domain/errors/classify.ts`; an unmapped code renders the generic message and emits Sentry; `40P01` retries exactly 3 times with jitter and then falls through to `server_error` |
| T65 | perf | §11 | `accept_exchange_request` p95 under 120 ms at 10× launch volume with 500k listings; participant policies keep `exchange_sessions` reads p95 under 50 ms ([RLS Design §8](../01-architecture/05-rls-design.md)); `EXPLAIN` baselines committed |
| T66 | manual | §12 | VoiceOver and TalkBack over request, accept, schedule, handoff (including code announcement and lockout), cancel, and the disputed state |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T67 | `PATCH /rest/v1/exchange_requests?id=eq.X` with `{"status":"accepted"}` as the owner | Denied — **there is no UPDATE policy on the table at all**. Repeated for every status value and for both participants. This is the single most important negative test in the spec: if it ever passes, every concurrency guarantee here is void |
| T68 | `PATCH /rest/v1/exchange_sessions?id=eq.X` with `{"state":"completed"}` as a participant | Denied for the same reason. Repeated with `{"version": 999}`, `{"handoff_code":"000000"}`, `{"completed_at": …}`, and `{"no_show_by": …}` |
| T69 | Read another user's `exchange_sessions` row by direct id | Zero rows, not 403 — RLS invisibility is a 404-shaped answer, and a 403 would confirm the session exists ([API Contract §3.4](../01-architecture/06-api-contract.md)) |
| T70 | Subscribe to `session:{id}` for a session you are not in, and to `thread:{id}` for a stranger's thread | Zero events over 30 seconds. Realtime evaluates the subscriber's policies before emitting ([Realtime §1.1](../01-architecture/08-realtime-and-notifications.md)) |
| T71 | Brute-force a handoff code: 10,000 attempts across 50 sessions | 5 attempts per session per 15 minutes, then `rate_limited` with both parties notified. Total successful guesses across the run: 0. The test asserts the **notification** fires, because the lockout is only half the control |
| T72 | Guess a handoff code by timing the comparison over 10⁵ requests | No measurable signal (T39's implementation asserted end to end through PostgREST) |
| T73 | Read `handoff_code` for a session in `scheduling`, or for a session you are not in | `rpc.get_handoff_code` raises `invalid_transition` and `not_authorized` respectively. A **direct** `select=handoff_code` is a permission error from the column `REVOKE`, and a `service_role` read returns **ciphertext**, not six digits |
| T73a | Dump the database and grep for a six-digit code | No plaintext code exists anywhere on disk, in a backup, in a PITR snapshot, or on a read replica. Asserted by `pg_dump` of a seeded database with 500 live sessions and a regex sweep for `\b\d{6}\b` in the `exchange_sessions` extract |
| T73b | Rotate `handoff_code_key` following runbook 14 while 200 sessions are `scheduled` | Every session's code is still readable and unchanged afterwards; zero `get_handoff_code` errors during and after. The naive swap (promote without re-encrypting) is run as a negative case and is asserted to break every live session — the reason the runbook exists |
| T73c | Call `get_handoff_code` 50 times on one session | Every call writes an `exchange.code_read` audit row with the caller's id; the rate limit engages at 20/hour/session. A read leaves a trace, so "who has seen this code" is answerable |
| T74 | Capture a full accept → schedule → handoff → complete session in mitmproxy | No `handoff_code` on any realtime frame or push payload; no garden coordinate, `display_point`, `h3_r7`, `h3_r9`, or device position anywhere; the only coordinates are safe-spot public points |
| T75 | Call `accept_exchange_request` for a request where you are the **requester**, not the owner | `not_authorized` 403 from the function's manual check. A definer function bypasses RLS, so this check is the only thing between an attacker and accepting on someone else's behalf |
| T76 | Call every RPC in §7 as `anon` with a forged `apikey` | 401/403 at the grant level before any body executes; asserted for all eight |
| T77 | Accept the same request from two devices with two different idempotency keys | One succeeds, one gets `request_not_pending` 409. Exactly one session, exactly one code, exactly one `request_accepted` notification |
| T78 | Send 500 exchange requests in an hour from one account | 10 succeed, the rest `rate_limited` 429; the 10-open cap engages independently and is **not** defeated by waiting out the rate limit |
| T79 | Send requests from 40 accounts behind one carrier NAT | Each account's Postgres bucket limits it independently; Kong's per-IP layer does not lock out a commuter train ([API Contract §7.1](../01-architecture/06-api-contract.md)) |
| T80 | Propose a schedule at a safe spot that is active but not on the listing | `validation_failed` 400. Asserted through the RPC **and** by a direct definer call, because a membership check enforced only in the happy path is not a check |
| T81 | Propose `p_start` in the past, or `p_end` before `p_start` | `validation_failed` 400 at the RPC, and independently by `sessions_window_length` and the `scheduled_end > scheduled_start` CHECK when the RPC is bypassed |
| T82 | Cancel someone else's session, or cancel a session you were removed from by a block | `not_authorized` 403. After a block, neither party can transition the session; the trigger already cancelled it |
| T83 | Use `cancel_session` to escape a completed exchange and dodge a rating | `invalid_transition` 409. Nothing in this spec moves a session out of `completed` except a report (R67), and a report is not a client-chosen state |
| T84 | Withdraw a request to void an acceptance already committed | `request_not_pending` 409. Terminal is terminal (R20); the exit from an accepted request is `cancel_session`, which is a real action with a real consequence |
| T85 | Move a session `cancelled → scheduled` or `no_show → in_progress` as `service_role` | `invalid_transition` from `trg_guard_session_transition`. The trigger is on the table, so a migration and an admin script fail identically (EC-20) |
| T86 | Set `status = 'reserved'` on a listing directly to park supply outside the sweeper's reach | `not_authorized` 42501 from `guard_listing_client_update` ([SPEC-009 EC-14](SPEC-009-listings-and-offers.md)). Asserted here too, because this spec is the only legitimate writer of that status |
| T87 | Enumerate sessions or requests by scanning uuids | uuid v4 keys make enumeration infeasible; the read limit is 120/min/user; a scan yields only rows the caller is a participant in |
| T88 | Emit a PostHog event carrying `handoff_code`, `scheduled_start`, or `safe_spot_id` | Rejected by the exchange property allow-list and by a lint rule on the source. The time-and-place pair is the highest-value target in the database and is not an analytics property |
| T89 | Trigger a `RAISE EXCEPTION` path and inspect the wire for row data | `details` and `hint` are always null; the message is a stable code and never a Postgres string. CI greps `supabase/migrations/**` for `USING DETAIL` |
| T90 | Suspend a user mid-session and attempt every RPC as them | `create`, `accept`, `propose`, `confirm`, and `confirm_handoff` all `not_verified` 403; `cancel_session` and `withdraw_exchange_request` succeed (R61). Getting out is never gated |
| T91 | Contract sweep over `exchange_requests`, `exchange_sessions`, and all eight RPC return types | No column matching the coordinate regex, and no new entry on the two-line allowlist (API-04). `handoff_code` present on exactly one return type and one explicit select |
| T92 | Replay a captured `confirm_handoff` request 60 minutes after the window closed | `validation_failed` 400 on the window check, which is evaluated against the server clock and cannot be replayed forward |

### 13.3 Manual QA

- [ ] Two real devices, two real accounts, one real listing: request → accept → schedule → meet → confirm → rate, at an actual launch-metro safe spot, during its actual opening hours.
- [ ] Repeat the above with one device in airplane mode at the handoff step; confirm the code stays readable, the button is disabled with a reason, and nothing is queued.
- [ ] Three devices race to accept one listing by hand; confirm one session, two "Just claimed by someone else" toasts, and one listing that leaves the map.
- [ ] Propose a time when the library is shut and confirm the `venue_closed` screen shows that day's real hours, in the venue's timezone, with the device in a different one.
- [ ] Cancel 3 h 55 min before a meeting and confirm the late-cancellation warning appears **before** the confirm tap and the outcome matches it.
- [ ] Cancel 4 h 05 min before and confirm it does not count.
- [ ] Enter five wrong handoff codes and confirm the lockout copy, the countdown, and that the **other** device receives the safety alert.
- [ ] Let a scheduled meeting pass unconfirmed on both sides; confirm both get the no-show notice, neither is blamed, and neither's counters move.
- [ ] Block a counterparty with a session scheduled for tomorrow; confirm the session cancels, both are notified, the blocked party learns nothing about the block, and no late-cancellation penalty is applied to either.
- [ ] Confirm the exchange screens are legible and correct at 200% type in both themes, particularly the handoff code and the state line.
- [ ] Screen-reader pass over all seven session states, with particular attention to digit-by-digit code announcement and the live-region state line.
- [ ] Confirm from a proxy capture that no `handoff_code` rides a websocket frame or a push payload during a full session.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | **None on the lifecycle itself** — without it there is no product, and a flag on the critical section is a second code path through the most concurrency-sensitive function in the system. Two operational switches exist and are not product flags: `exchange.no_show_detection` (disables the `detect_no_shows` cron; sessions simply stay `scheduled`, which is the correct degradation) and `exchange.reminders` (disables `remind_upcoming`). Both are config, both are reversible in seconds, and neither can make a screen show something false. A third, `exchange.completion_model`, selects `dual` (launch) or `dual_with_fallback` (R87–R91); the `single` setting exists in the enum and is unreachable without an ADR (R89). |
| Migration required | Yes. `20260808_0092_exchange_lifecycle.sql` — eight session columns, three CHECK constraints, one transition table with its trigger, four indexes, eight RPCs, ten `app.*` helpers, and four `pg_cron` jobs. RLS policies and pgTAP tests ship in the same PR; a second `DB` CODEOWNERS reviewer is required ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| Backfill required | No. There are no production sessions at MVP. The migration nonetheless asserts zero rows violating `sessions_window_length` and `sessions_reason_required` before adding them, and **fails loudly** rather than adding them `NOT VALID`, because a constraint that is not enforced is a comment. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A bad cron is disabled with `cron.unschedule`, which is safe because no cron in this spec is the guarantee for anything — the crons are tidy-up, the RPCs and the triggers are the contract. A bad RPC is replaced by a `_v2` with the old one kept until `devices.app_version` telemetry clears it ([API Contract §3.2](../01-architecture/06-api-contract.md)); note that **adding a `session_state` value is a breaking change** and requires a new RPC, not a new enum label. Client rollback is an EAS Update, which is why the generated transition table must never lead the migration that defines it. |
| Client version floor | The first release. There is no earlier client. The floor becomes real at the first `session_state` change, at which point the guard trigger — not the client — is what stops an old app from producing an illegal state. |
| Ship order | Migration and triggers → generated `machine.ts` → RPC deployment → client release. The generator runs against the deployed schema in CI, so a client that knows a transition the database does not cannot be built. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Is 72 hours the right request expiry ([Exchange State Machine Q3](../01-architecture/07-exchange-state-machine.md))? It is too short in peak season for someone who checks the app twice a week, and too long for a requester watching a courgette age. A per-listing expiry derived from the listing's own remaining window is the obvious refinement and is also a second countdown for a user to misread. | Product | Post-launch, first season |
| Q2 | Should partial-quantity reservations exist ([Exchange State Machine Q1](../01-architecture/07-exchange-state-machine.md))? Splitting 10 lb of tomatoes between two people is the single most-requested thing we are not building, and it turns H1 from "one winner under a row lock" into a sum-check under a lock with a partial-release path on every cancellation. | Product + Architecture | Phase 2 planning |
| Q3 | Should a no-show automatically file a report (R70)? **Deferred to [Exchange State Machine Q2](../01-architecture/07-exchange-state-machine.md), which is the canonical row.** The same question was open in three documents; it is answered once, there, and this row and [SPEC-012 Q6](SPEC-012-trust-and-safety.md) adopt whatever it decides. | *see arch Q2* | Before launch |
| Q4 | Is 4 hours the right late-cancellation threshold (R58)? It is a guess about travel time that is probably right in a dense metro and wrong for a 30 km rural drive, where the meaningful moment is "before I got in the car". A threshold derived from the counterparty's distance to the spot would be better and would leak how far away they live. | Product | Post-launch, first season |
| Q5 | Should the 2-hour meeting-window cap (R38) be configurable per safe-spot category? A farmers' market pavilion on a Saturday is a genuinely different meeting from a police-station lobby, and a 2-hour cap on the former is arbitrary. Against: every additional window length weakens `detect_no_shows`, which is the only automatic signal we have. | Product | Post-launch data |
| Q6 | Should `venue_closed` be a hard block or a warning (R39)? It is currently a block, which is correct for a locked door and wrong for a spot whose hours are simply stale — and [SPEC-007 R21](SPEC-007-safe-spots.md)'s 180-day auto-suspension means stale hours mostly become *no* spot rather than *wrong* hours. Revisit if `exchange.venue_closed` rates are high against spots with fresh hours. | Product + Ops | Post-launch, first season |
| ~~Q7~~ | **Decided 2026-08-09: dual confirmation ships, and the reversal is pre-built.** See §5.10. | Product + Trust & Safety | *Closed; review at 60 days* |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Backend Engineering | Initial spec |
| 2026-08-09 | 1.1.0 | Backend Engineering | Workflow-architect review fixes ([review](../07-review/01-workflow-architect-review.md)). **R49a is the important one**: `confirm_handoff` now returns failures instead of raising them, because a `RAISE` rolled back the very counter the brute-force lockout depends on — the control did not exist at runtime. R67/R68a–d: four edges into `disputed` (a `scheduled` session was unfreezable), two moderator edges out, and a release path so a dispute stops orphaning its listing and inventory item forever. R71: index corrected to `(reserved_request_id)`; the `(id)` form was a no-op. R42a: `confirm_handoff` exempted from the version guard, which silently defeated H4. R30a: rejection sampling — the old generator would not compile and was 6.25% biased. R80/R80a: real key-based idempotency. R26a, R63a–b, R64 buffer, R79a. Tests T24a, T29a, T35a–c, T49a–c, T60a–b added; T24, T30, T31, T35, T49, T54, T55, T59, T60 rewritten to assert the fixed behaviour |
| 2026-08-09 | 1.2.0 | Backend Engineering | Applied the three deferred review suggestions after a product/security decision. **R30/R45/R54:** the handoff code is encrypted at rest and read only through the audited `rpc.get_handoff_code` — encrypted rather than hashed, because both parties must be able to *read* it at the meeting. **R64a–d:** a no-show marker is now contestable in one tap; attribution clears, the session stays terminal, and the contest itself is a trust signal rather than a hard clear — EC-22's person-with-no-signal finally has an answer. **§5.10 / R87–R91:** Q7 closed in favour of dual confirmation, with `dual_with_fallback` written, tested, and disabled, and the switching threshold committed in advance so it cannot be argued into existence after the data lands. Tests T48a–b, T73a–c |
