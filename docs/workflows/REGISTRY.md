# Workflow Registry

**Status:** Active · **Version:** 0.3 · **Date:** 2026-08-09 · **Owner:** Workflow Architect

The authoritative index of every workflow in Sharecropr — not a list of spec files. It maps components, user journeys, and entity states so anyone can look up anything from any angle.

**Read this alongside** [the pre-development review](../07-review/01-workflow-architect-review.md) and the [development notes](../07-review/02-development-notes.md), which flag what to watch during the build. All 21 findings from that review are now fixed in the documents; the review is retained as the record of what was wrong and why. The `Discovery gaps` table at the foot of this file is the live list of what still has no spec.

## How to use it

- Building a feature → **View 1**, find the workflow, read its spec.
- Changing a file → **View 2**, see every workflow that file participates in.
- Debugging what a user saw → **View 3**, find the journey, follow it down.
- Wondering how a row got into a state → **View 4**, see what can enter and exit it.

## Maintenance rules

1. Update this file whenever a workflow is discovered, specced, or changed. Never optional.
2. `Missing` means it exists in the design or the code but has no spec. Red flag; surface it in the next review.
3. Never delete a row. Deprecate.
4. Keep the four views cross-referenced: a component in View 2 must have its workflows in View 1.
5. **`Last verified`** is the date the spec was last checked against running code. Blank means never. CI should mark any row stale after 30 days once code exists — see [review P-2](../07-review/01-workflow-architect-review.md).

**Status values:** `Approved` · `Review` · `Draft` · `Missing` · `Deprecated`
**Note on status:** all 18 specs and every `01-architecture/` document now carry `Review`, matching this registry. The entry gate for `Approved` is [Doc Conventions §6.1](../00-foundation/06-doc-conventions.md) and is enforced by [CI/CD §5.1](../05-operations/02-cicd.md): no launch-blocking open question outstanding, every `MUST` tested, no contradiction with a normative architecture document, and a `Last verified` date in this file. Promote here and in the front matter together, never separately.

---

## View 1 — By workflow

### Identity and access

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Email/password sign-up | SPEC-001 | Review | `POST /auth/v1/signup` | Supabase Auth | — |
| OAuth sign-in (Apple, Google) | SPEC-001 · ADR-0006 | Review | Provider redirect | Supabase Auth | — |
| Session refresh / token rotation | SPEC-001 · ADR-0007 | Review | Access-token expiry | Mobile client | — |
| Password reset | SPEC-001 | Review | `POST /auth/v1/recover` | Supabase Auth | — |
| Email change | SPEC-001 | Review | `rpc.request_email_change` | Auth service | — |
| TOTP enrolment | SPEC-002 · ADR-0014 | Review | User, security settings | Auth service | — |
| TOTP challenge at AAL2 | SPEC-002 | Review | Step-up-gated action | Auth service | — |
| Recovery-code generation and burn | SPEC-002 | Review | `rpc.regenerate_recovery_codes` | Auth service | — |
| Account recovery without a device | SPEC-002 §7 · SPEC-003 | Review | Support path | T&S + vendor | — |
| Account deletion | `02-security/04` §4 | Review | `rpc.request_account_deletion` | `account-delete` EF | — |
| Deletion cancellation inside grace window | `02-security/04` §4 | Review | `rpc.cancel_account_deletion` | Auth service | — |
| Data subject access request | `02-security/04` §5 | **Missing** | Support inbound | Ops (manual) | — |

### Verification

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Identity verification (KYC) | SPEC-003 · ADR-0010 | Review | `kyc-start` EF | Persona (vendor) | — |
| KYC result ingestion | SPEC-003 | Review | `kyc-webhook` EF | Vendor webhook | — |
| KYC re-verification / revocation | `02-security/03` §8 | Review | Expiry cron, moderator | T&S | — |
| Garden capture | SPEC-004 | Review | `rpc.start_garden_capture` | Mobile client | — |
| Garden submission | SPEC-004 | Review | `rpc.submit_garden_verification` | Mobile client | — |
| Garden review decision | SPEC-004 · SPEC-900 | Review | `rpc.review_garden_submission` | Moderator | — |
| Transact-gate evaluation | SPEC-003 · SPEC-004 | Review | `app.can_transact()` | Database | — |

### Catalogue and supply

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Species / variety search | SPEC-005 | Review | `rpc.search_species` | Database | — |
| Taxonomy delta sync to device | SPEC-005 | Review | `rpc.taxonomy_delta` | Mobile client | — |
| Community variety proposal | SPEC-005 | Review | `rpc.propose_crop_variety` | Requester | — |
| Variety proposal review | SPEC-005 · SPEC-900 | Review | `rpc.review_crop_variety` | Moderator | — |
| Inventory item create / update | SPEC-006 | Review | Client write, `guard_inventory_write` | Owner | — |
| Photo upload and processing | SPEC-006 | Review | `media-process` EF | Media pipeline | — |
| Image content scan | SPEC-006 · SPEC-012 | Review | `content-scan` EF | Moderation pipeline | — |
| Garden location set / fuzz | `01-architecture/04` | Review | `rpc.set_garden_location` | Database | — |
| Break-glass exact-coordinate access | `01-architecture/04` §10 | **Missing** | Legal / safety incident | Security + counsel | — |

### Safe spots and discovery

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Safe-spot curation and seeding | SPEC-007 | Review | Manual, pre-launch | Ops | — |
| Safe-spot proximity query | SPEC-007 · ADR-0005 | Review | `rpc.safe_spots_near` | Database | — |
| Venue-hours evaluation | SPEC-007 | Review | `app.venue_open_during` | Database | — |
| Safe-spot suspension fanout | SPEC-007 R28 | Review | Moderator / partner | Database trigger | — |
| Stale-hours auto-suspension (180 d) | SPEC-007 R21 | Review | Cron | Database | — |
| Partner-managed spot update | SPEC-007 · SPEC-021 | Review | `rpc.partner_update_safe_spot` | Partner org | — |
| Map viewport query | SPEC-008 · ADR-0013 | Review | Map pan/zoom | Mobile client | — |
| Listing search | SPEC-008 · SPEC-009 | Review | `rpc.search_listings` | Database | — |
| Match suggestion | SPEC-009 | Review | `rpc.suggest_matches` | Database | — |

### The exchange — the critical path

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Listing publish | SPEC-009 | Review | `rpc.publish_listing` | Owner | — |
| Listing safe-spot set (1–3) | SPEC-009 R18 | Review | `rpc.set_listing_safe_spots` | Owner | — |
| Listing withdraw | SPEC-009 R40 | Review | `rpc.withdraw_listing` | Owner | — |
| Listing expiry sweep | SPEC-009 R33 | Review | `expire_listings` cron | Database | — |
| Send exchange request | SPEC-010 §5.1 | Review | `rpc.create_exchange_request` | Requester | — |
| Decline request | SPEC-010 R15 | Review | `rpc.decline_exchange_request` | Owner | — |
| Withdraw request | SPEC-010 R17 | Review | `rpc.withdraw_exchange_request` | Requester | — |
| Request expiry sweep | SPEC-010 R11 | Review | `expire_requests` cron | Database | — |
| **Accept request (critical section)** | SPEC-010 §5.3 · arch §4 | Review | `rpc.accept_exchange_request` | Owner | — |
| Bulk auto-decline of losers | SPEC-010 R29 | Review | Inside acceptance | Database | — |
| Propose schedule | SPEC-010 R35–R41 | Review | `rpc.propose_schedule` | Either party | — |
| Confirm schedule | SPEC-010 R40 | Review | `rpc.confirm_schedule` | The *other* party | — |
| Upcoming-meeting reminders | SPEC-010 R43 | Review | `remind_upcoming` cron | Database | — |
| **Handoff confirmation** | SPEC-010 §5.5 | Review | `rpc.confirm_handoff` | Either party | — |
| Handoff lockout after 5 failures | SPEC-010 R49, R49a | Review | 5th wrong code in a rolling 15 min | Database | — |
| Completion finalisation | SPEC-010 R50, R68b | Review | `app.finalize_completed_session` (idempotent) | Database | — |
| Handoff code read | SPEC-010 R45 · arch §3.3 | Review | `rpc.get_handoff_code` at `state = 'scheduled'` | Either party | — |
| Contest a no-show marker | SPEC-010 R64a–d | Review | `rpc.contest_no_show` | The marked party | — |
| Cancel session | SPEC-010 §5.6 | Review | `rpc.cancel_session` | Either party | — |
| Reservation release | SPEC-010 §6 | Review | `app.release_reservation` | Database | — |
| No-show detection | SPEC-010 R64–R66 | Review | `detect_no_shows` cron (2h15m buffer) | Database | — |
| Dispute freeze | SPEC-010 R67 | Review | Report against a session (4 source states) | Database | — |
| **Dispute resolution → reservation release** | arch §3.2 · SPEC-010 R68a–d · SPEC-012 §5.7 · SPEC-900 R39–R41 | Review | `moderation-action` resolves | Moderator | — |
| Session anonymization (90 d) | arch §7 | Review | `anonymize_sessions` cron | Database | — |
| Handoff-code key rotation | Runbook 14 | Review | Annual, or suspected key exposure | Platform + Security | — |

All ⚠ markers in this section are cleared: findings B-1 through B-4, H-1 through H-4 and M-4 are fixed in the documents. See the [review](../07-review/01-workflow-architect-review.md) resolution table for where each fix lives.

### Communication

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Thread creation | SPEC-010 R10 · SPEC-011 | Review | Inside request creation | Database | — |
| Send message | SPEC-011 | Review | Client insert | Participant | — |
| Mark thread read | SPEC-011 | Review | `rpc.mark_thread_read` | Participant | — |
| System messages on state change | SPEC-010 §6 · SPEC-011 | Review | State transition | Database | — |
| Thread close 14 d after completion | SPEC-011 R21 | Review | `close_threads` cron | Database | — |
| Moderator thread read | SPEC-011 · SPEC-900 | Review | `rpc.moderator_read_thread` | Moderator | — |
| Realtime channel subscribe | `01-architecture/08` §1 | Review | Client subscribe | Realtime | — |
| Notification enqueue (outbox) | `01-architecture/08` §3 | Review | `app.enqueue_notification` | Database | — |
| Outbox drain to Expo Push | `01-architecture/08` §4 | Review | `push-drain` EF, 30 s | Edge Function | — |
| Dead-letter after 6 attempts | `01-architecture/08` §7 | Review | Drain failure | Edge Function | — |
| Device registration | SPEC-013 | Review | `rpc.register_device` | Mobile client | — |
| Preference / quiet-hours evaluation | SPEC-013 · `08` §6 | Review | `app.should_deliver()` | Database | — |
| Mark notifications read | SPEC-013 | Review | `rpc.mark_notifications_read` | Client | — |

### Trust and safety

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Submit rating | SPEC-012 | Review | `rpc.submit_rating` | Participant | — |
| Double-blind rating reveal | SPEC-012 | Review | `reveal_ratings` cron / 2nd rating | Database | — |
| Trust-score recomputation | SPEC-012 | Review | `recompute_trust` cron | Database | — |
| File report | SPEC-012 | Review | `rpc.create_report` | Any user | — |
| Report severity + SLA assignment | SPEC-012 | Review | `trg_report_severity` | Database trigger | — |
| Evidence snapshot | SPEC-012 | Review | Inside report creation | Database | — |
| Severity-1 on-call page | SPEC-012 | Review | `private.oncall_pages` insert | Ops | — |
| Create block | SPEC-012 | Review | `rpc.create_block` | Any user | — |
| Block fanout (cancel session, requests, thread) | SPEC-012 · RLS §6 | Review | `on_block_created` trigger | Database | — |
| Remove block | SPEC-012 | Review | `rpc.remove_block` | Blocker | — |
| Moderator case claim / release | SPEC-900 | Review | `rpc.claim_case` / `release_case` | Moderator | — |
| Moderation action | SPEC-900 | Review | `moderation-action` EF | Moderator | — |
| Enforcement ladder application | `02-security/05` §3 | Review | Moderator decision | T&S | — |
| Appeal decision | SPEC-900 | Review | `rpc.decide_appeal` | Second moderator | — |
| Post-incident response | `02-security/05` §7 | Review | Real-world incident | T&S + counsel | — |
| Law-enforcement request | `02-security/05` §8 | Review | Legal inbound | Counsel | — |
| Breach response | `02-security/04` §8 | Review | Security detection | Security | — |

### Phase 2 / 3

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| Planting record / harvest calendar | SPEC-020 | Draft | `rpc.upsert_planting` | Owner | — |
| Harvest prediction | SPEC-020 | Draft | `rpc.record_prediction` | Database | — |
| Surplus-alert subscription and match | SPEC-020 | Draft | `rpc.set_surplus_subscription` | Database | — |
| Group create / join / moderate | SPEC-021 | Draft | `rpc.create_group` et al. | Group admin | — |
| Partner-org spot management | SPEC-021 | Draft | `rpc.partner_suspend_safe_spot` | Partner | — |
| Badge evaluation and release | SPEC-022 | Draft | `evaluate_badges` nightly | Database | — |
| Leaderboard build | SPEC-022 | Draft | `build_leaderboards` nightly | Database | — |
| Crop ID assistance | SPEC-023 | Draft | Client capture | ML service | — |
| Food-safety disclosure | SPEC-023 | Draft | `rpc.set_food_safety_disclosure` | Owner | — |
| Foodborne-illness incident runbook | SPEC-023 R60 | **Missing** | Illness report | Support + counsel | — |

### Platform and operations

| Workflow | Spec | Status | Trigger | Primary actor | Last verified |
|---|---|---|---|---|---|
| CI pipeline | `05-operations/02` | Review | PR / merge | CI | — |
| Migration apply | `03-data-model` §15 | Review | Deploy | CI | — |
| EAS Update (client hotfix) | ADR-0017 · `05-operations/03` | Review | Release decision | Platform | — |
| Store submission | `05-operations/03` | Review | Release train | Platform | — |
| Environment provisioning | `05-operations/01` | Review | New environment | Platform | — |
| Observability / alert routing | ADR-0018 · `05-operations/04` | Review | Threshold breach | On-call | — |
| Runbook execution | `05-operations/05` | Review | Incident | On-call | — |
| Telemetry scrubbing | `01-architecture/04` §8 | Review | Every event | Client + Sentry | — |
| Retention sweeps | `02-security/04` §3 | Review | Daily crons | Database | — |

---

## View 2 — By component

| Component | File(s) | Workflows it participates in |
|---|---|---|
| Auth RPCs | `supabase/migrations/**` auth functions | Sign-up, OAuth, refresh, password reset, email change, deletion |
| MFA functions | 2FA migration | TOTP enrolment, AAL2 challenge, recovery codes, account recovery |
| `app.can_transact()` | RLS helpers | Send request, accept request, publish listing, propose schedule, confirm handoff |
| `app.is_blocked_either_way()` | RLS helpers | Every read path, send request, accept request, thread read, profile card |
| `app.is_moderator()` | RLS helpers | Every moderator surface, SPEC-900 console |
| `accept_exchange_request` | Exchange migration | Accept request, auto-decline, session creation, thread creation, reservation, notification enqueue, audit |
| `confirm_handoff` | Exchange migration | Handoff confirmation, lockout (R49a — returns rather than raises, so the counter survives), completion finalisation, audit |
| `cancel_session` | Exchange migration | Cancel, reservation release, late-cancellation accounting, notification |
| `app.release_reservation` | Exchange migration | Cancel, no-show, **and `disputed → cancelled`** (R68a). Nulls `reserved_request_id`, which `listings_reservation_coherent` now requires |
| `app.finalize_completed_session` | Exchange migration | Completion: listing, inventory, counters, ratings unlock, thread close scheduling |
| `private.guard_session_transition` | Exchange migration | Every session transition, including `service_role` and migrations |
| `private.guard_request_transition` | Exchange migration | Every request transition |
| `listings_single_reservation` | Data-model migration | Accept request (H1 backstop). One definition, on `(reserved_request_id)`, stated identically in all three documents |
| `listings_one_active_per_item` | Data-model migration | Publish listing, accept request (H2) |
| `app.venue_open_during()` | Safe-spots migration | Propose schedule, confirm schedule, map spot rendering |
| `app.enqueue_notification()` | Notification migration | Every workflow that a human needs to know about — 20+ call sites |
| `app.should_deliver()` | Notification migration | Outbox drain, quiet hours, `safety_alert` bypass |
| `app.consume_token()` | Rate-limit migration | Create request, accept, decline, withdraw, propose, confirm, handoff, cancel, report, KYC start. Always consumed **before** any lock (R63b) |
| `app.digest_equals()` | Exchange migration | Handoff code comparison (constant time, on decrypted plaintext) |
| `public.get_handoff_code()` | Exchange migration | The **only** decrypt path for `handoff_code`. Gated on `scheduled`, audited as `exchange.code_read` |
| `public.contest_no_show()` | Exchange migration | Clears a no-show marker, records a trust signal |
| Vault key `handoff_code_key` | Supabase Vault | Handoff code at rest. Rotation is [Runbook 14](../05-operations/05-runbooks.md) — a plain swap breaks every live session |
| `on_block_created` | T&S migration | Block fanout: session cancel, request cancel, thread close |
| `trg_report_severity` | T&S migration | Report creation, SLA assignment, on-call page |
| `kyc-start` / `kyc-webhook` EF | `supabase/functions/` | Identity verification, result ingestion, gate unlock |
| `media-process` EF | `supabase/functions/` | Photo upload, EXIF strip, thumbnailing |
| `content-scan` EF | `supabase/functions/` | Image moderation, listing text scan |
| `push-drain` EF | `supabase/functions/` | Outbox drain, Expo Push, dead-letter |
| `moderation-action` EF | `supabase/functions/` | Moderator decisions, enforcement ladder, dispute resolution (the only caller of `disputed → cancelled`/`completed`) |
| `account-delete` EF | `supabase/functions/` | Account deletion, retention cascade |
| `src/domain/exchange/machine.ts` | Mobile client (generated) | Every exchange screen's action gating, optimistic updates |
| `scripts/gen-transitions.ts` | Build tooling | Client/server transition-table sync (R81) |
| Map screen | `01-architecture/02` §4 | Viewport query, clustering, spot rendering, listing search |
| Secure storage / MMKV allow-list | `01-architecture/02` §5 · ADR-0007 | Token storage, offline cache, handoff-code exclusion |
| React Query cache | ADR-0011 | Optimistic updates, rollback, realtime invalidation, offline gating |
| pg_cron schedule | Migrations | 13 jobs — see View 1 and the cron table below |

### Scheduled jobs

| Job | Cadence | Owning spec | Workflow |
|---|---|---|---|
| `expire_requests` | */5 min | SPEC-010 | Request expiry |
| `expire_listings` | */15 min | SPEC-009 | Listing expiry |
| `detect_no_shows` | */15 min | SPEC-010 | No-show detection, 2 h 15 m past `scheduled_end` |
| `remind_upcoming` | */15 min | SPEC-010 | 24 h / 2 h reminders |
| `reveal_ratings` | hourly | SPEC-012 | Double-blind reveal |
| `close_threads` | daily | SPEC-011 R05 | Thread close. Ownership settled: SPEC-011 creates the job, SPEC-010 only schedules a close |
| `recompute_trust` | nightly | SPEC-012 | Trust score, 90-day cancellation window |
| `drain_notification_outbox` | */30 s | SPEC-013 | Push delivery |
| `anonymize_sessions` | daily | `02-security/04` | 90-day session anonymization |
| Retention sweeps | daily | `02-security/04` | Per-table retention schedule |
| `settle_sessions` | hourly | SPEC-022 (P3) | Badge eligibility |
| `evaluate_badges` | nightly 04:00 | SPEC-022 (P3) | Badge award queue |
| `build_leaderboards` | nightly 04:30 | SPEC-022 (P3) | Leaderboard snapshots |

---

## View 3 — By user journey

### Gardener (owner) journeys

| What they experience | Underlying workflows | Entry point |
|---|---|---|
| Signs up and gets ready to trade | Sign-up → Identity verification → Garden capture → Garden review | `/onboarding` |
| Records what's ripe | Inventory create → Photo upload → Content scan | `/inventory/new` |
| Offers a surplus | Listing publish → Safe-spot set → Map appearance | `/listings/new` |
| Sees who's asking | Request received notification → Request list | `/exchanges` |
| Picks someone | Accept request → Auto-decline losers → Session created → Thread opened | `/exchanges/[requestId]` |
| Agrees a place and time | Propose schedule → Venue-hours check → Counterparty confirms | `/(modals)/schedule/[sessionId]` |
| Meets and confirms | Reminders → Handoff code → Confirm handoff → Completion | `/(modals)/handoff/[sessionId]` |
| Rates the exchange | Submit rating → Double-blind reveal | `/exchanges/session/[id]/rate` |
| Cancels because plans changed | Cancel session → Late-cancellation accounting → Reservation release | `/exchanges/session/[id]` |
| Blocks someone who worried them | Create block → Session cancel → Request cancel → Thread close | Profile card |
| Reports an unsafe meeting | File report → Severity assignment → Dispute freeze | `/report` |
| Deletes their account | Deletion request → Grace window → Retention cascade | `/settings/account` |

### Requester journeys

| What they experience | Underlying workflows | Entry point |
|---|---|---|
| Finds something nearby | Map viewport query → Listing search → Spot proximity | `/map` |
| Asks for it | Send exchange request → Thread first message → Owner notified | `/listings/[id]` |
| Learns they lost | Auto-decline → `request_declined` (identical to a manual decline, R21) | Notification |
| Changes their mind | Withdraw request | `/exchanges/[requestId]` |
| Waits too long | Request expiry → Inbox notice | Cron |
| Goes to meet | Schedule confirm → Reminders → Handoff | `/(modals)/handoff/[sessionId]` |
| Gets stood up | No-show detection → Both notified → One-tap report offered | Cron |
| Was there, but had no signal | No-show marker accrued → one-tap contest → attribution cleared, trust signal recorded | Session detail |

### Operator / moderator journeys

| What they do | Underlying workflows | Entry point |
|---|---|---|
| Reviews a garden submission | Garden review decision → `garden_review_result` notification | Console `/gardens` |
| Works the report queue | Case claim → Evidence read → Moderation action → Appeal path | Console `/reports` |
| Reads a thread for context | Moderator thread read (audited) | Console `/threads/[id]` |
| Applies the enforcement ladder | Moderation action → Suspension → Request/session cancel fanout | Console |
| Resolves a dispute | Moderation action → session to `cancelled` or `completed` → reservation released | Console |
| Curates a safe spot | Safe-spot curation → Hours verification → Consent record | Console `/spots` |
| Suspends a safe spot | Suspension fanout → Sessions returned to `scheduling` → Parties notified | Console `/spots/[id]` |
| Reviews a variety proposal | Variety review → Taxonomy delta → Client sync | Console `/taxonomy` |
| Handles a law-enforcement request | LE request workflow → Counsel review → Audited disclosure | Off-platform |
| Responds to a severity-1 page | On-call page → Runbook → Post-incident workflow | PagerDuty target |

### System-to-system journeys

| What happens automatically | Underlying workflows | Trigger |
|---|---|---|
| A request goes unanswered for 72 h | Request expiry → Requester inbox notice | `expire_requests` */5 min |
| A listing ages out | Listing expiry → Owner notice with one-tap relist | `expire_listings` */15 min |
| Nobody presses confirm | No-show detection → Attribution → Reservation release → Both notified | `detect_no_shows` */15 min |
| A meeting approaches | Reminders at 24 h and 2 h (2 h ignores quiet hours) | `remind_upcoming` */15 min |
| Both parties rate | Double-blind reveal, or 7-day timeout | `reveal_ratings` hourly |
| A completed exchange goes quiet | Thread close at +14 days | `close_threads` daily |
| A notification is enqueued | Outbox drain → Expo Push → retry with backoff → dead-letter at 6 | `push-drain` */30 s |
| Verification comes back from the vendor | KYC webhook → Gate unlock → `verification_result` notification | Persona webhook |
| A session ages past 90 days | Anonymization: participants and times nulled | `anonymize_sessions` daily |
| A block is created | Session cancel + request cancel + thread close, one transaction | `on_block_created` trigger |
| A severity-1 report arrives | Evidence snapshot → on-call page | `trg_report_severity` |
| Venue hours go stale for 180 days | Auto-suspension → Listing spot-set fanout | Safe-spot cron |

---

## View 4 — By state

### `exchange_requests.status`

| State | Entered by | Exits to | Workflows that trigger exit |
|---|---|---|---|
| `pending` | `create_exchange_request` | `accepted`, `declined`, `withdrawn`, `expired`, `cancelled` | Accept, decline, withdraw, expiry cron, block/withdraw/suspension fanout |
| `accepted` | `accept_exchange_request` | — terminal | — (the session carries the outcome, R62) |
| `declined` | `decline_exchange_request` or auto-decline | — terminal | — |
| `withdrawn` | `withdraw_exchange_request` | — terminal | — |
| `expired` | `expire_requests` cron | — terminal | — |
| `cancelled` | Block, listing withdrawal, suspension | — terminal | — |

5 legal edges. `trg_guard_request_transition` rejects the other 25 of 30 ordered pairs.

### `exchange_sessions.state`

| State | Entered by | Exits to | Workflows that trigger exit |
|---|---|---|---|
| `scheduling` | Acceptance | `scheduled`, `cancelled`, `disputed` | Propose+confirm schedule, cancel, report freeze |
| `scheduled` | `confirm_schedule` | `in_progress`, `cancelled`, `no_show`, `disputed` | Handoff, cancel, no-show cron, report freeze — **the freeze that matters most**, and the edge the table originally lacked |
| `in_progress` | First handoff confirmation | `completed`, `no_show`, `disputed` | Second confirmation, no-show cron, report freeze |
| `completed` | Second handoff confirmation | `disputed` | Report within 72 h |
| `cancelled` | `cancel_session`, block fanout | — terminal | — |
| `no_show` | `detect_no_shows` | — terminal | Attribution (`no_show_by`) is separately clearable via `contest_no_show` (R64a) — the **state** stays terminal, only the blame moves |
| `disputed` | Report freeze | `cancelled`, `completed` | **Moderator only**, via `moderation-action` (arch §3.2). `disputed → cancelled` releases the reservation. `dispute_sla_breach` pages at 7 days; nothing auto-resolves |

**13 legal edges**, 36 illegal, of 7 × 7 = 49 ordered pairs. `trg_guard_session_transition` rejects everything not in `private.legal_session_transitions`, including `service_role` writes and migrations. The test generator counts the table and enumerates `pg_enum` rather than hard-coding either number.

### `listings.status`

| State | Entered by | Exits to | Workflows that trigger exit |
|---|---|---|---|
| `draft` | Listing create | `active`, `withdrawn` | Publish, withdraw |
| `active` | `publish_listing` | `reserved`, `withdrawn`, `expired` | Accept request, withdraw, expiry cron |
| `reserved` | Acceptance | `active`, `completed` | Cancel, no-show release, completion, and `disputed → cancelled`. `orphan_reservation_scan` alerts on any `reserved` row whose session is terminal |
| `completed` | Completion finalisation | — terminal | — |
| `withdrawn` | `withdraw_listing` | — terminal | — |
| `expired` | `expire_listings` cron | — terminal | — |

Invariant: `listings_reservation_coherent CHECK ((status = 'reserved') = (reserved_request_id IS NOT NULL))` — the status and the pointer move together, so a release path cannot clear one and forget the other.

### `inventory_items.status`

| State | Entered by | Exits to | Workflows that trigger exit |
|---|---|---|---|
| `available` | Item create | `listed`, `archived` | Publish listing, archive |
| `listed` | Listing publish | `reserved`, `available`, `archived` | Accept request, listing withdraw/expire, archive |
| `reserved` | Acceptance | `exchanged`, `listed` | Completion, cancel, no-show release, and `disputed → cancelled` |
| `exchanged` | Completion | — terminal | — |
| `archived` | Archive (incl. `composted`) | — terminal | Open: `composted` exists as both a status and an `archive_reason` (SPEC-006 Q3). A product decision, not a defect — but an `ALTER TYPE` later, so cheap now |

### Verification and trust states

| State | Entered by | Exits to | Workflows that trigger exit |
|---|---|---|---|
| `verifications.status` `pending` | `kyc-start` | `passed`, `failed` | KYC webhook |
| `verifications.status` `passed` | KYC webhook | `expired`, `revoked` | Re-verification cron, moderator |
| Garden submission `pending` | `submit_garden_verification` | `approved`, `rejected` | Moderator review |
| Trust tier `unverified` | Sign-up | `verified` | Both verifications pass |
| Trust tier `verified` | Gate unlock | `trusted`, `suspended` | 10 completed exchanges (SPEC-012 Q7 — whether `trusted` ships at MVP is open), enforcement ladder |
| Trust tier `suspended` | Enforcement | `verified`, `banned` | Appeal, escalation |
| Trust tier `banned` | Enforcement | — terminal | — |
| `reports.status` `open` | `create_report` | `resolved` | Moderation action |
| `media_assets.moderation_state` `pending` | Upload | `approved`, `rejected` | `content-scan`. Open: the asset is visible while `pending` (SPEC-006 Q4) |

---

## Discovery gaps

Workflows implied by the design that have no spec section describing their branches, failure modes, or cleanup:

| # | Workflow | Implied by | Severity | Note |
|---|---|---|---|---|
| 1 | ~~Dispute resolution → reservation release~~ | — | **Resolved** | Specced 2026-08-09: arch §3.2, SPEC-010 R68a–d, SPEC-012 §5.7, SPEC-900 R39–R41. Kept per rule 3 — never delete a row |
| 2 | Data subject access request | `02-security/04` §5 | High | Regulatory obligation; currently a manual Ops path with no runbook |
| 3 | Break-glass exact-coordinate access | `01-architecture/04` §10 | High | The most sensitive operation in the system; described as a policy, not a workflow |
| 4 | Foodborne-illness incident | SPEC-023 R60 | High | R60 says the runbook MUST exist before launch. It does not exist |
| 5 | Suspension fanout | SPEC-010 R19, EC-05 | Medium | Cited by three specs; owned by none. Which trigger, which order, which notifications? |
| 6 | Vendor outage degradation (Persona, Expo) | ADR-0010, `08` §8 | Medium | Failure behaviour described per call site; no end-to-end degradation workflow |
| 7 | Metro launch / seeding | `02-open-risks.md` R-01, R-02 | Medium | The largest identified risk and the least specified process |
| 8 | Moderator rota and escalation | SPEC-900, R-11 | Medium | "A staffing commitment, not a software feature" — needs a named workflow before App Store submission |
| 9 | ~~`close_threads` ownership~~ | SPEC-011 R05 | **Resolved** | SPEC-011 creates the job; SPEC-010 only schedules a close |

---

## Change Log

| Date | Version | Author | Change |
|---|---|---|---|
| 2026-08-09 | 0.1 | Workflow Architect | Initial registry, built from a full-set documentation audit |
| 2026-08-09 | 0.3 | Workflow Architect | The three decided suggestions registered: handoff-code encryption and its key-rotation workflow, and the no-show contest path |
| 2026-08-09 | 0.2 | Workflow Architect | Review findings applied across the doc set; ⚠ markers cleared. Dispute resolution and `close_threads` ownership move from discovery gaps to specced. Seven gaps remain, four of them safety- or regulation-facing |
