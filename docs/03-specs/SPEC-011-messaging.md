# SPEC-011: Messaging

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.0 |
| **Owner** | Backend Engineering + Trust & Safety |
| **Phase** | MVP |
| **Security review** | required |
| **Schema depends on** | [SPEC-010](SPEC-010-exchange-lifecycle.md) |
| **Behaviourally coupled with** | SPEC-012, SPEC-013, SPEC-900 |
| **Related ADRs** | [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

Messaging lets two people coordinate one specific exchange — when, where, what it looks like — and nothing else. A thread exists only as an attachment to an `exchange_request`, is created when that request is sent, and closes when the exchange is finished or a block is created. There is no inbox of strangers, no contact list, and no way to start a conversation with someone you have no pending or completed exchange with.

## 2. Goals

- Let two parties settle the logistics of a handoff without leaving the app.
- Produce a record that moderators can use when something goes wrong.
- Make harassment structurally difficult rather than merely against the rules.
- Work acceptably on a phone in a car park with one bar of signal.

## 3. Non-Goals

- **General-purpose chat.** Sharecropr is not a messaging app and will not grow into one.
- **Cold DMs.** There is no code path to message someone without a request. This is the single most important non-goal in this spec.
- **Group chat.** Deferred to [SPEC-021](SPEC-021-community-groups.md), where it belongs.
- **Images, voice notes, attachments, reactions, typing indicators, presence.** Each is a moderation surface, a storage cost, and a scope multiplier. Images in particular are a photo-EXIF and CSAM-review problem we are not taking on for a feature whose job is "which door of the library?"
- **Message editing or deletion by the sender.** A conversation that can be rewritten is useless as evidence in a safety report. Users may report a message; they may not unsend it.
- **End-to-end encryption.** We must be able to hand a moderator the contents of a thread attached to an `unsafe_meeting` report. E2E and a trust-and-safety obligation are incompatible, and pretending otherwise would be dishonest to users.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **requester**, I want to ask a question about the crop before we meet, so that I don't drive across town for something unusable. | P0 |
| US-02 | As a **listing owner**, I want to agree a specific time and door with the other person, so that neither of us waits in the wrong place. | P0 |
| US-03 | As a **participant**, I want to see automatic updates in the thread when the exchange state changes, so that the conversation and the transaction don't drift apart. | P0 |
| US-04 | As a **participant**, I want messages to send when I'm back on signal, so that a dead zone doesn't cost me the exchange. | P1 |
| US-05 | As a **user being harassed**, I want blocking to end the conversation immediately and completely, so that I don't have to keep seeing them. | P0 |
| US-06 | As a **moderator**, I want the thread attached to a report, so that I can judge what actually happened. | P0 |
| US-07 | As a **user**, I do not want strangers able to message me at all. | P0 |

## 5. Functional Requirements

### 5.1 Thread lifecycle

| ID | Req | Statement |
| --- | --- | --- |
| R01 | MUST | A `message_threads` row **MUST** have a non-null `request_id` referencing an existing `exchange_requests` row. There is no other way to create a thread. |
| R02 | MUST | `message_threads.request_id` **MUST** be `UNIQUE`. One request, one thread, forever. |
| R03 | MUST | The thread **MUST** be created inside the same transaction as the exchange request, by `create_exchange_request`, not by a separate client call. |
| R04 | MUST | `participant_a` and `participant_b` **MUST** be stored sorted (`LEAST`/`GREATEST`) so the pair key is stable regardless of who initiated. |
| R05 | MUST | A thread **MUST** be closed (`is_closed = true`) 14 days after its session reaches `completed`, by the `close_threads` cron job. **This spec owns that job and is the only place it is created.** [SPEC-010 R50](SPEC-010-exchange-lifecycle.md) *schedules* a close at completion; it does not define the cron. An earlier draft had both specs claiming to create it, which is how two migrations end up racing to `cron.schedule` the same job name and the second one wins silently. |
| R06 | MUST | A thread **MUST** be closed immediately when a block is created between its participants, by the `on_block_created` trigger. |
| R07 | MUST | A thread **MUST** be closed immediately when its request reaches `declined`, `withdrawn`, or `expired` without acceptance. |
| R08 | MUST | A closed thread **MUST** remain readable by its participants until message retention expires, and **MUST NOT** accept new messages. |
| R09 | SHOULD | A thread **SHOULD** display a system message stating why it closed. |

### 5.2 Sending and reading

| ID | Req | Statement |
| --- | --- | --- |
| R10 | MUST | Only a participant of an open thread **MAY** insert a message. Enforced by the `messages_insert_participant` policy via `app.is_thread_participant()`. |
| R11 | MUST | `messages.body` **MUST** be between 1 and 2000 characters after trimming. |
| R12 | MUST | A message **MUST NOT** be editable or deletable by any user, including its sender. |
| R13 | MUST | System messages (`kind = 'system'`) **MUST** have `sender_id IS NULL` and **MUST NOT** be insertable by any client role. |
| R14 | MUST | The system **MUST** emit a system message on each of: request sent, request accepted, schedule proposed, schedule confirmed, handoff confirmed by one party, exchange completed, exchange cancelled, thread closed. |
| R15 | MUST | `read_at` **MUST** be settable only by the recipient, only on messages they did not send, and only forward in time. |
| R16 | SHOULD | The client **SHOULD** mark messages read when the thread is focused and the message is on screen, not merely when the thread is opened. |
| R17 | MUST | Message delivery to an online participant **MUST** use the per-thread Realtime channel described in [Realtime & Notifications §3](../01-architecture/08-realtime-and-notifications.md). |
| R18 | MUST | The client **MUST** refetch the thread on reconnect rather than assuming Realtime backfilled the gap. Realtime is a notification transport, not a sync protocol. |
| R19 | MUST | A message composed while offline **MUST** be queued locally, displayed with an unmistakable pending indicator, and sent on reconnect with its client-generated `id` as the idempotency key. |
| R20 | MUST | A queued message that fails 5 send attempts **MUST** surface a persistent failure state with a manual retry, and **MUST NOT** be silently dropped. |
| R21 | SHOULD | Threads **SHOULD** paginate with keyset pagination on `(thread_id, created_at DESC, id)`, 50 messages per page. |

### 5.3 Rate limiting and abuse

| ID | Req | Statement |
| --- | --- | --- |
| R22 | MUST | Message insertion **MUST** be limited to 30 messages per thread per hour and 120 messages per user per hour, per [API Contract §6](../01-architecture/06-api-contract.md). |
| R23 | MUST | Exceeding a limit **MUST** return `rate_limited` with `Retry-After`, and **MUST NOT** silently discard the message. |
| R24 | MUST | A suspended user (`profiles.is_suspended = true`) **MUST NOT** be able to send messages, even in an open thread. |
| R25 | MUST | An unverified user **MUST NOT** be able to send messages, because they cannot create a request in the first place — `app.can_transact()` gates the thread's existence, not the message. |

### 5.4 Content scanning

| ID | Req | Statement |
| --- | --- | --- |
| R26 | MUST | Every inserted `kind = 'user'` message **MUST** be enqueued for the `content-scan` Edge Function. |
| R27 | MUST | `content-scan` **MUST** detect and set `flagged_reason` for: a street address, a phone number, an email address, a payment solicitation (Venmo, Cash App, PayPal, Zelle, "cash", a currency amount), and a request to meet somewhere that is not a safe spot. |
| R28 | MUST | Flagging **MUST NOT** block, delay, alter, or hide the message. It marks it for moderator review. |
| R29 | MUST | A flagged message **MUST** appear in the moderation console's flagged queue with the surrounding 10 messages of context. |
| R30 | SHOULD | On detecting an address or a payment solicitation, the client **SHOULD** display a non-blocking inline safety notice to the *sender* explaining that exchanges happen at safe spots and that Sharecropr never involves money. |
| R31 | MUST | The scan result **MUST NOT** be visible to either participant. Telling users what triggers the scanner teaches them to evade it. |

> **Honest limitation.** Flagging is detection, not prevention. Someone determined to share an address will write it as "one two seven maple" and the regex will miss it. R27 catches the careless and the accidental, which is most of the volume, and it produces the signal we need to answer the question in [R-09](../06-roadmap/02-open-risks.md): *are users routing around safe spots?* If the flag rate is high, the safe-spot-only policy is buying us friction without safety and [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) must be revisited with that data. It is a measurement instrument as much as a moderation tool.

### 5.5 Moderator access

| ID | Req | Statement |
| --- | --- | --- |
| R32 | MUST | A moderator **MUST** be able to read a thread only when it is attached to a report with `status IN ('open','triaged','escalated')`, or when a message in it carries `flagged_reason`. |
| R33 | MUST | Blanket moderator read access to all threads **MUST NOT** exist. The policy is scoped by report, not by role alone. |
| R34 | MUST | Every moderator read of a thread **MUST** write an `audit.events` row with the report reference. |
| R35 | MUST | Moderators **MUST NOT** be able to write into a user thread. Moderator communication happens through the notification system, not by impersonating a participant. |

### 5.6 Retention

| ID | Req | Statement |
| --- | --- | --- |
| R36 | MUST | Messages **MUST** be hard-deleted 90 days after their thread closes. |
| R37 | MUST | Messages attached to an unresolved report or a `law_enforcement_referral` **MUST** be exempt from R36 until that matter is closed, then retained per the [retention schedule](../02-security/04-privacy-and-data-retention.md). |
| R38 | MUST | Account deletion **MUST** remove the deleted user's message bodies while leaving the counterparty's messages intact and the thread structurally coherent. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| `public.message_threads` | read (participant), insert (system only) | Created by `create_exchange_request` |
| `public.messages` | read/insert (participant), update `read_at` only | No update of `body`, no delete |
| `public.exchange_requests` | read | Thread scoping |
| `public.blocks` | read via `app.is_blocked_either_way` | Teardown |
| `public.reports` | read via policy | Moderator scoping |
| `private.notification_outbox` | insert | New-message push |
| `audit.events` | insert | Moderator access |

**New schema objects introduced by this spec:**

```sql
-- Scope moderator reads to reported or flagged threads only. Never role-alone.
CREATE OR REPLACE FUNCTION app.is_moderatable_thread(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.is_moderator() AND (
    EXISTS (SELECT 1 FROM public.reports r
             WHERE r.status IN ('open','triaged','escalated')
               AND ((r.subject_type = 'message'
                     AND r.subject_id IN (SELECT id FROM public.messages WHERE thread_id = tid))
                 OR (r.subject_type = 'session'
                     AND r.subject_id IN (SELECT s.id FROM public.exchange_sessions s
                                            JOIN public.message_threads t ON t.request_id = s.request_id
                                           WHERE t.id = tid))))
    OR EXISTS (SELECT 1 FROM public.messages m
                WHERE m.thread_id = tid AND m.flagged_reason IS NOT NULL));
$$;

ALTER TABLE public.messages
  ADD COLUMN scan_state text NOT NULL DEFAULT 'pending'
    CHECK (scan_state IN ('pending','clean','flagged','error'));

CREATE INDEX messages_scan_pending_idx ON public.messages (created_at)
  WHERE scan_state = 'pending';

-- Message ids are client-generated so the offline queue is idempotent.
ALTER TABLE public.messages
  ALTER COLUMN id DROP DEFAULT;
```

**PII touched:** `messages.body` (P1 — free text that may contain anything the user typed), `messages.flagged_reason` (P1), `message_threads` participant ids (P1). Message bodies are excluded from all analytics and scrubbed from telemetry.

## 7. API

### `POST /rest/v1/messages`

**Auth:** authenticated, thread participant · **Rate limit:** 30/thread/hour, 120/user/hour

```jsonc
// Request
{ "id": "8f14…", "thread_id": "3c9a…", "body": "I'll be by the west entrance at 4." }
// Response 201
{ "id": "8f14…", "thread_id": "3c9a…", "sender_id": "…", "kind": "user",
  "body": "I'll be by the west entrance at 4.", "created_at": "2026-08-08T16:02:11Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `thread_closed` | 409 | `is_closed = true` |
| `not_participant` | 403 | Policy denies; also returned when blocked |
| `blocked` | 403 | A block exists between the parties |
| `suspended` | 403 | Sender is suspended |
| `body_too_long` | 422 | > 2000 characters |
| `rate_limited` | 429 | Limit exceeded; `Retry-After` set |

Because `id` is client-generated, a retry of the same message is an idempotent no-op via primary-key conflict — R19's offline queue depends on this.

### `GET /rest/v1/messages?thread_id=eq.…&order=created_at.desc&limit=50`

Keyset pagination via `created_at.lt.<cursor>`. Returns `not_participant` (as an empty set, per RLS) if the caller isn't in the thread.

### `rpc.mark_thread_read(p_thread_id uuid, p_up_to timestamptz)`

Sets `read_at = now()` on the caller's unread received messages up to a timestamp. Idempotent, monotonic.

### Edge Function: `content-scan`

Triggered every 15 seconds against `messages WHERE scan_state = 'pending'`, batch of 200. Sets `scan_state` and `flagged_reason`. Runs as `service_role`. A scan failure sets `scan_state = 'error'` and alerts — it never blocks delivery.

### Realtime: `thread:{thread_id}`

Payload is the inserted message row, filtered by RLS. Read receipts broadcast on the same channel as a lightweight `{message_id, read_at}` event rather than a full row update.

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Exchanges list | `/(tabs)/exchanges` | Threads grouped by state, unread badge, last message preview |
| Thread | `/(modals)/thread/[threadId]` | The conversation, plus a pinned exchange summary header |
| Report from thread | `/(modals)/report?subject=message&id=…` | Long-press a message → Report |

The thread header pins the exchange it belongs to: crop, counterparty, state, safe spot, and time. The conversation is a subordinate detail of a transaction, and the layout should say so.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Skeleton bubbles, header renders immediately from cached exchange data |
| Empty | Only the system "request sent" message, plus a suggestion chip row: "When works for you?", "Which entrance?", "Still available?" |
| Error (recoverable) | Inline banner: send failed, tap to retry. Composed text is never lost. |
| Error (terminal) | Thread closed or access lost → read-only view with an explanatory banner |
| Offline | Amber "Offline — messages will send when you reconnect" bar; queued messages show a clock icon; composer stays enabled |
| Permission denied | Not applicable — messaging requires no device permission |
| Rate limited | Composer disabled with a countdown: "You've sent a lot of messages. You can send another in 4:12." |

### 8.3 Copy

| Situation | Exact copy |
| --- | --- |
| Empty thread | "Say hello and sort out when to meet." |
| Send failed | "Couldn't send. Tap to try again." |
| Offline bar | "You're offline. Messages will send when you're back." |
| Thread closed — completed | "This exchange is complete. The conversation closed on 22 August." |
| Thread closed — declined | "This request was declined, so the conversation is closed." |
| Thread closed — block | "This conversation is closed." *(Deliberately gives no reason — see [SPEC-012](SPEC-012-trust-and-safety.md) on not telling a blocked user they were blocked.)* |
| Rate limited | "You've sent a lot of messages in a short time. You can send another in {mm:ss}." |
| Safety notice — address detected | "Sharecropr exchanges happen at safe spots. You don't need to share your address." |
| Safety notice — payment detected | "Sharecropr is trade-only. Never send or accept money for an exchange." |
| System — request sent | "You asked about {crop}." / "{name} asked about your {crop}." |
| System — accepted | "Request accepted. Pick a safe spot and a time." |
| System — schedule confirmed | "Meeting at {spot} on {date} at {time}." |
| System — completed | "Exchange complete. Leave a rating?" |
| System — cancelled | "This exchange was cancelled." |
| Report action | "Report message" → "Thanks. Our team will review this within 24 hours." |

### 8.4 Interaction notes

- Long-press a message → Copy, Report. No Delete, no Edit, no reactions.
- The composer never auto-sends on return; the send button is explicit.
- Read receipts are shown as a single small "Read" under the last read message, not per message.
- No typing indicators. They leak presence and add a realtime channel for no coordination value.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Use it to harass, groom, or socially engineer a location out of someone. The structural defence is that they must first get a legitimate exchange request accepted by that specific person — there is no broadcast surface and no way to reach a stranger. |
| **Which RLS policies enforce access?** | `threads_select_participant` (via `app.is_thread_participant()` OR `app.is_moderatable_thread()`), `messages_select_participant`, `messages_insert_participant`, `messages_update_read_receipt`. No DELETE policy exists on either table — R12's immutability is the absence of a policy, not a check. |
| **Can any response path expose an exact coordinate or PII?** | Message bodies are user-authored free text and could contain anything, including an address the user typed themselves. We cannot prevent that; R27 detects it and R30 discourages it. No *system*-generated content in a thread ever contains a coordinate — system message templates are fixed strings with a safe-spot name, never a point. |
| **What is logged, and is it scrubbed?** | Message ids, thread ids, and timestamps are logged. **Bodies are never logged and never sent to Sentry or PostHog** — the telemetry scrubber drops any property named `body`, `message`, or `text` on messaging events. |
| **Does this need step-up authentication?** | No. |
| **Abuse / rate-limit controls** | R22–R24, block teardown (R06), suspension gate, `content-scan`, and the report path from any message. |

**Threat notes.**

- **Enumeration.** `GET /messages?thread_id=eq.<guess>` on a random UUID returns an empty set, not a 403. RLS gives no oracle for thread existence.
- **Read-receipt forgery.** R15's constraint (recipient only, monotonic) prevents marking your *own* messages read to fake engagement, and prevents un-reading to hide that you saw a safety notice.
- **Realtime leakage.** Supabase Realtime applies RLS to change events, so a client subscribed to a thread channel it doesn't belong to receives nothing. Verified by [T24](#132-negative--security-tests) rather than assumed.
- **Moderator overreach.** R32–R34 exist because "moderators can read messages" is the sort of capability that quietly expands. Scoping it to a report and auditing every read makes expansion visible.

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | User sends a message at the instant the other party blocks them | Insert fails with `not_participant`; the composed text is preserved locally and the thread flips to closed with the neutral copy |
| EC-02 | Both parties send simultaneously | Both succeed. Ordering is by `created_at`, ties broken by `id`. No locking. |
| EC-03 | Offline queue holds 40 messages, then the thread closes before reconnect | All 40 fail with `thread_closed`. One consolidated notice, not 40 error rows. |
| EC-04 | Client clock is 3 hours off, producing an out-of-order `created_at` | Server sets `created_at` with `DEFAULT now()`; the client value is ignored entirely |
| EC-05 | Duplicate send of the same client-generated id | Primary-key conflict → treated as success, returns the existing row |
| EC-06 | `content-scan` is down for 2 hours | Messages deliver normally with `scan_state = 'pending'`; the backlog drains on recovery; an alert fires at a 500-row backlog |
| EC-07 | Message contains 2000 characters of a single emoji sequence | Length is measured in characters, not bytes; renders with a max bubble height and internal scroll |
| EC-08 | A user is suspended mid-conversation | Sends fail with `suspended`; the thread stays readable; the counterparty sees no state change (suspension is not announced) |
| EC-09 | The session is cancelled but the thread is within its 14-day window | Thread closes immediately per R07's sibling rule for cancelled sessions; a system message explains |
| EC-10 | A report is filed on a message in a thread already past its 90-day purge date | R37 exempts it; the purge job skips rows referenced by an open report |
| EC-11 | Deleted account's messages | Bodies replaced with "[deleted]", sender shown as "Former member"; the counterparty's side is untouched |
| EC-12 | Realtime disconnects for 20 minutes on a train | On reconnect the client refetches the last 50 messages (R18) rather than trusting the socket; a "catching up" indicator shows briefly |
| EC-13 | Extremely long single word with no spaces (URL-like) | Wrapped with `break-word`; never overflows the bubble |
| EC-14 | Both parties open the thread simultaneously and mark read | `mark_thread_read` is monotonic and idempotent; no thrash |
| EC-15 | A user reports their own message | Rejected client-side and server-side; `reporter_id <> subject sender` check |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `message_sent` | event | `thread_id`, `kind`, `char_bucket`, `was_queued` — **never `body`** | — |
| `message_send_failed` | event | `error_code`, `attempt` | > 2% of sends over 10 min |
| `thread_opened` | event | `thread_id`, `session_state` | — |
| `content_scan_flag` | event | `flagged_reason` | Flag rate > 8% of messages → escalate to [R-09](../06-roadmap/02-open-risks.md) review |
| `content_scan_backlog` | gauge | pending row count | > 500 rows |
| `content_scan_latency_p95` | histogram | seconds from insert to scan | > 120 s |
| `realtime_resync` | event | `gap_seconds` | p95 > 60 s |
| `messages_per_exchange` | histogram | count at completion | Median > 25 suggests the scheduling UX is failing |
| `moderator_thread_read` | audit | `moderator_id`, `thread_id`, `report_id` | Any read without a `report_id` → page |

> `content_scan_flag` rate is the single most product-relevant metric in this spec. It is the measurement behind the safe-spot policy, not a moderation statistic.

## 12. Accessibility

- Each message bubble is one accessibility element announcing sender, body, and relative time: *"From Maya, 4 minutes ago: I'll be by the west entrance at 4."*
- System messages are announced with a distinct role so they aren't mistaken for the counterparty speaking.
- New incoming messages fire a polite live-region announcement; they never steal focus from the composer.
- The composer keeps a persistent accessible label and reports remaining characters at 1900+.
- Send state (queued, sending, failed) is conveyed by text and icon, never colour alone.
- Minimum 44×44 pt hit targets on send, retry, and the long-press menu.
- Full dynamic-type support to the largest accessibility size; bubbles reflow rather than truncate.
- Thread list rows announce unread count and exchange state, so a screen-reader user doesn't need to open a thread to triage.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01, R02 | A thread cannot be inserted with a null or duplicate `request_id` |
| T02 | integration | R03 | `create_exchange_request` creates request and thread in one transaction; a forced failure rolls back both |
| T03 | unit | R04 | Participants are stored sorted regardless of initiator |
| T04 | integration | R05 | `close_threads` closes a thread exactly 14 days after completion, not 13 |
| T05 | integration | R06 | Block creation closes the thread synchronously in the same transaction |
| T06 | integration | R07 | Decline, withdraw, and expiry each close the thread |
| T07 | rls | R08 | Insert into a closed thread raises `thread_closed`; select still succeeds |
| T08 | rls | R10 | Participant insert succeeds; non-participant insert is denied |
| T09 | unit | R11 | Body length boundaries: 0, 1, 2000, 2001 characters |
| T10 | rls | R12 | UPDATE of `body` and DELETE are denied for the sender |
| T11 | rls | R13 | A client cannot insert `kind = 'system'` |
| T12 | integration | R14 | Each of the 8 lifecycle events emits exactly one system message |
| T13 | rls | R15 | `read_at` cannot be set on own messages, cannot move backwards |
| T14 | e2e | R16 | Scrolling a message into view marks it read; opening without scrolling does not |
| T15 | integration | R17 | A message inserted by A appears on B's thread channel within 2 s |
| T16 | e2e | R18 | Socket killed for 60 s, 3 messages sent by the counterparty, all present after reconnect |
| T17 | e2e | R19 | Airplane mode → send 3 → reconnect → all 3 delivered once, in order |
| T18 | integration | R20 | 5 consecutive failures produce a persistent failure state, not a drop |
| T19 | integration | R21 | Keyset pagination returns no duplicates and no gaps across 500 messages |
| T20 | integration | R22, R23 | 31st message in an hour returns `rate_limited` with `Retry-After` |
| T21 | integration | R26, R27 | Each of the 5 detection categories flags correctly |
| T22 | integration | R28 | A flagged message is delivered unmodified and unhidden |
| T23 | integration | R36 | Purge removes messages 90 days after close and leaves the thread row |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T24 | Non-participant subscribes to `thread:{id}` on the Realtime channel | Receives zero events (RLS-filtered), and the subscription does not error in a way that confirms the thread exists |
| T25 | Non-participant `GET /messages?thread_id=eq.<real id>` | Empty set — no 403, no existence oracle |
| T26 | `GET /messages?thread_id=eq.<random uuid>` | Empty set, indistinguishable from T25 |
| T27 | Blocked user attempts to send | `not_participant`; no row created |
| T28 | Suspended user attempts to send in an open thread | `suspended`; no row created |
| T29 | Sender attempts `PATCH /messages?id=eq.…` on `body` | 403, row unchanged |
| T30 | Sender attempts `DELETE /messages?id=eq.…` | 403, row unchanged |
| T31 | Client inserts `kind = 'system'` with `sender_id = null` | Policy denies |
| T32 | Client attempts to set `flagged_reason` or `scan_state` directly | Column-level revoke denies |
| T33 | Moderator reads a thread with no open report and no flag | `app.is_moderatable_thread()` returns false; empty set |
| T34 | Moderator reads a reported thread | Succeeds **and** writes an `audit.events` row; the test asserts the audit row exists |
| T35 | Moderator attempts to insert into a user thread | Denied |
| T36 | Message body containing a coordinate is sent | Delivered (we do not censor), but the body appears in no log, no Sentry event, and no PostHog property |
| T37 | 10,000-character body via a raw HTTP client bypassing the client-side limit | `body_too_long`, CHECK constraint enforced at the database |
| T38 | Replay of the same client-generated message id 50 times | Exactly one row; 50 successful responses |
| T39 | SQL injection payload in `body` | Stored and rendered as literal text; parameterized queries; no execution |
| T40 | XSS payload in `body` rendered in the moderation console | Escaped; console renders as text, never HTML |
| T41 | User reports their own message | Rejected |
| T42 | Purge job runs against a thread with an open report | Rows retained per R37 |

### 13.3 Manual QA

- [ ] Send a message in a lift with intermittent signal; confirm queue, indicator, and eventual single delivery
- [ ] Confirm no typing indicator or presence signal appears anywhere in the network trace
- [ ] Confirm the block copy gives no indication of a block to the blocked party
- [ ] VoiceOver and TalkBack pass over a 30-message thread including system messages
- [ ] Largest dynamic type size: bubbles reflow, nothing truncates, send button remains reachable
- [ ] Verify a flagged message looks identical to the sender and recipient

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `messaging_enabled` (kill switch only — disabling it makes threads read-only rather than hiding them) |
| Migration required | Yes — `app.is_moderatable_thread`, `messages.scan_state`, client-generated ids |
| Backfill required | No |
| Rollback plan | Flip the flag to read-only. Do not roll back the migration; the `scan_state` column is additive and harmless. |
| Client version floor | 1.0.0 |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Should the safety notice in R30 be shown once per thread or every time? Every time is nagging; once is easy to dismiss and forget. | Product | Before launch |
| Q2 | Is 90-day message retention (R36) right? Shorter is better for privacy; longer is better for a report filed late. Legal input needed. | Legal + Security | Before launch |
| Q3 | Should `content-scan` use an LLM classifier rather than regex for the "meet somewhere else" case, which regex handles badly? Cost and latency vs. recall. | Backend | Phase 2 |
| Q4 | Do we need a "share my ETA" structured message type, given users will otherwise type it and we lose the signal? | Product | Phase 2 |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Backend Engineering + Trust & Safety | Initial spec |
