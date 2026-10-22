# Runbooks

**Status:** Approved · **Version:** 1.0.1 · **Owner:** Platform Engineering

Step-by-step procedures for when something is wrong. Written to be followed by someone tired, at 3 a.m., who did not write the system.

**Every runbook assumes you are stressed.** Steps are ordered, explicit, and safe to follow literally.

---

## Index

| # | Runbook | Severity |
| --- | --- | --- |
| [1](#1--location-exposure) | **Location exposure** | P0 |
| [2](#2--location-canary-failure) | Location canary failure | P0 |
| [3](#3--severity-1-safety-report) | Severity-1 safety report | P0 |
| [4](#4--database-outage) | Database outage | P0 |
| [5](#5--point-in-time-restore) | Point-in-time restore | P0 |
| [6](#6--break-glass-coordinate-access) | Break-glass coordinate access | Controlled |
| [7](#7--suspected-data-breach) | Suspected data breach | P0 |
| [8](#8--kyc-vendor-outage) | KYC vendor outage | P1 |
| [9](#9--notification-backlog) | Notification backlog | P1 |
| [10](#10--exchange-engine-contention) | Exchange engine contention | P1 |
| [11](#11--moderation-console-outage) | Moderation console outage | P1 |
| [12](#12--bad-migration-in-production) | Bad migration in production | P0 |
| [13](#13--compromised-credential) | Compromised credential | P0 |
| [14](#14--tile-serving-outage-or-bad-basemap-build) | Tile serving outage / bad basemap build | P2 |
| [15](#15--osm-import-produced-bad-candidates) | OSM import produced bad candidates | P1 |
| [14](#14--handoff-code-key-rotation) | Handoff-code key rotation | Controlled |

---

## 1 — Location exposure

**Trigger:** any evidence that an exact garden coordinate reached a client, a log, a telemetry system, or a third party.

**This is the worst thing that can happen to this product. Act, then think.**

### Immediate — first 15 minutes

1. **Stop the bleeding.** Identify the path and close it:
   - A bad RPC or view → `REVOKE EXECUTE` / `DROP VIEW`. Breaking a feature is acceptable. Continuing to leak is not.
   - A client bug → republish the previous EAS Update immediately.
   - A telemetry leak → disable the sink at the vendor and stop ingestion.
2. **Page the Security owner and the CEO.** Not Slack. Phone.
3. **Do not delete anything.** Preserve logs, the offending code, and the affected data. Set a legal hold that overrides every retention job.
4. **Snapshot** the database and the relevant log ranges.

### First hour

5. **Scope it.** How many gardens, whose, and to whom? Query the access logs; do not estimate.
6. **Determine whether it was retrieved**, not merely exposed. A coordinate in a response nobody read is different from one in a dataset someone downloaded.
7. Start an incident document. Timestamp everything as you go — reconstruction after the fact is unreliable.
8. Engage counsel.

### First 24 hours

9. **Rotate the fuzz seeds** for every affected garden. This changes the display point and invalidates anything already harvested. It is cheap and there is no reason to hesitate.
10. **Notify affected users individually.** Say exactly what was exposed and to whom. Offer garden re-registration. Tell them plainly that they may wish to take physical precautions. There is no soft version of this conversation.
11. Notify the supervisory authority within **72 hours** if there is a risk to rights and freedoms. A P0 location exposure always meets that bar.
12. Add the regression test **before** the fix. Watch it fail. Then fix.

### Follow-up

13. Blameless post-mortem within 14 days: how did this path exist, and which control should have caught it?
14. Add the missing control to the [location invariant suite](../04-testing/01-test-strategy.md#7-location-invariant-suite).

---

## 2 — Location canary failure

**Trigger:** `location_canary_failure` alert. The canary runs every 15 minutes ([Observability §9](04-observability.md#9-the-location-canary)).

1. **Check which assertion failed.**
   - **Assertion 4** (canary user cannot read its *own* garden) → the API is broken or the canary account is misconfigured. **Not a leak.** Verify the API is up, then fix the canary. Do not skip this check — it is the most common cause and it looks alarming.
   - **Assertions 1–3** → treat as a **confirmed leak**. Go to [Runbook 1](#1--location-exposure) immediately.
2. If ambiguous, assume a leak. The cost of over-reacting is an hour. The cost of under-reacting is Runbook 1 executed a day late.
3. Never silence this alert. If it is noisy, the canary is wrong and gets fixed, not muted.

---

## 3 — Severity-1 safety report

**Trigger:** an `unsafe_meeting` or `underage` report, which pages on-call directly.

1. **Acknowledge within 15 minutes.** Unacknowledged escalates to the T&S lead, then the CTO.
2. **Read the report and the thread.** Access is audited automatically — do not attempt to work around it.
3. **Separate the parties immediately:** bidirectional block, session frozen, notifications between them stopped.
4. **Suspend the subject pending review** if there is any credible allegation of harm. Suspend first, investigate second.
5. **Preserve everything.** Legal hold on both accounts, the session, the thread, and all related records — overriding retention jobs.
6. **Contact the reporter.** A human. By phone if they will take a call. Ask what they need. Do not send them a form.
7. **If there is an allegation of physical harm**, follow [Trust & Safety §7](../02-security/05-trust-and-safety.md#7-after-a-real-world-incident) from step 4 and page the CEO.
8. Log every action with a timestamp. This record may be read by a lawyer.

---

## 4 — Database outage

**Trigger:** API availability alert, or Supabase status page.

1. **Confirm scope** — total, degraded, or a single component (Auth, Storage, Realtime)?
2. **Check the Supabase status page.** If it is a platform incident, open a support ticket at the highest severity and post the incident number in the channel.
3. **Post a status message** in-app if it will last more than 15 minutes. Users mid-exchange need to know it is us, not them.
4. **Verify graceful degradation:** the app should show cached inventory and taxonomy with an offline banner, not a crash or an infinite spinner. If it does not, that is a separate bug — file it.
5. **If connection-pool exhaustion:** check `db_connections_used`, identify the long-running query, terminate it with `pg_terminate_backend`, and investigate why it was long-running.
6. **After recovery:** verify the notification outbox drained, check for orphaned exchange sessions in a non-terminal state, and confirm no cron job was skipped.
7. Post-mortem if longer than 15 minutes.

---

## 5 — Point-in-time restore

**Trigger:** data corruption, a bad contract migration, or accidental deletion.

**Requires CTO approval. This is destructive.**

1. **Stop writes.** Put the app in maintenance mode via feature flag.
2. **Identify the target timestamp.** Be precise — you are choosing which minute of data to lose.
3. **Restore to a new project first**, never over production. Verify the data is what you expect *before* cutting over.
4. **Cut over.** Update connection strings, redeploy Edge Functions.
5. **⚠️ RE-RUN THE ACCOUNT DELETION PIPELINE.**
   ```bash
   npm run ops:rerun-deletion-pipeline -- --since <restore-timestamp>
   ```
   **A restore resurrects rows that were legitimately deleted, including garden coordinates for accounts that exercised their right to erasure.** Skipping this step re-creates data we told users was gone. It is the single most important step in this runbook and the one most likely to be forgotten under pressure.
6. **Re-verify the location invariants** against the restored database.
7. **Reconcile state:** expire stale requests, cancel sessions whose scheduled time has passed, drain the outbox.
8. Lift maintenance mode.
9. **Notify users** whose data was lost in the restore window. Be specific about what and when.

---

## 6 — Break-glass coordinate access

**The only legitimate path to `private.garden_locations` outside automated logic.** Valid reasons: a law-enforcement request with valid process, or an active safety investigation.

1. **Raise a ticket** stating the legal or safety basis and naming the specific garden or user.
2. **Obtain two approvals** — the Security owner plus one of Legal or the CTO. The requester cannot be one of them.
3. **Run the provisioning script.** It requires both approval tokens.
   ```bash
   npm run ops:break-glass -- --ticket SEC-1234 --duration 60m \
     --approver-1 <token> --approver-2 <token>
   ```
4. The script notifies the whole security channel on activation. **It is not possible to do this quietly, by design.**
5. Every statement executed under the `break_glass` role writes to `audit.events` with the ticket reference.
6. **The role expires automatically after 60 minutes.** Do not extend it; re-request if genuinely needed.
7. **Post-hoc review within 5 business days** confirms the access was warranted and proportionate. The review is recorded on the ticket.

If you find yourself doing this routinely, the product is missing a capability. Build it rather than normalising break-glass.

---

## 7 — Suspected data breach

**Trigger:** anomalous access patterns, a vendor notification, an external report, or a leaked-credential alert.

Follow [Privacy §8](../02-security/04-privacy-and-data-retention.md#8-breach-response). Operationally:

1. **Contain within 1 hour:** rotate credentials, disable the affected path, snapshot evidence.
2. **Do not delete anything.** Legal hold immediately.
3. **Assess within 24 hours:** which data classes, how many subjects, was P0 involved.
4. **Engage counsel before any external statement.**
5. **72-hour clock** to the supervisory authority if there is a risk to rights and freedoms.
6. **Any P0 exposure is automatically high risk** — affected users are notified individually. Also execute [Runbook 1](#1--location-exposure).
7. Post-mortem within 14 days, published internally.

---

## 8 — KYC vendor outage

**Trigger:** elevated `kyc-start` failures, or a Persona status notification.

1. **Verify** at the vendor's status page and open a support ticket.
2. **Confirm the degradation is working:** new verifications sit in `pending_vendor`; **existing verified users are unaffected**; signup and browsing continue normally.
3. **Update the in-app copy** for users mid-verification: *"Verification is temporarily unavailable. We'll notify you as soon as it's back — you don't need to do anything."*
4. **Do not** disable the verification gate to let people transact. The gate exists for safety; an outage is not a reason to remove it.
5. **If the outage exceeds 24 hours**, consider activating the Stripe Identity alternate. This is a product decision requiring the CEO, because it changes the vendor relationship mid-flight.
6. On recovery, verify the webhook backlog processed and no inquiry is orphaned.

---

## 9 — Notification backlog

**Trigger:** `notification_outbox_depth > 1000` or any dead-lettered notification.

1. **Check the drain function's logs.** Is it running? Erroring? Rate limited by Expo?
2. **If Expo Push is down:** confirm the in-app inbox is still being written — it is the durable record, and users will see everything on next open. This is a degradation, not a data-loss event.
3. **If the drain is erroring:** identify the failing notification, check for a malformed payload, and fix forward.
4. **If dead-lettered:** inspect `last_error`. `DeviceNotRegistered` is normal churn — the token is deleted and the row resolved. Anything else needs investigation.
5. **Do not manually replay the outbox** without checking `delivered_at` first. Duplicate pushes about an exchange are confusing and erode trust in the notifications people actually need.

---

## 10 — Exchange engine contention

**Trigger:** `accept_request_contention` above 20%, or deadlock errors (SQLSTATE `40P01`) in the logs.

1. **High `listing_unavailable` rate is not necessarily a bug** — it means listings are popular and multiple people are racing. Check whether the *absolute* number of successful acceptances is healthy.
2. **Deadlocks are always a bug.** They mean lock ordering was violated. Find the offending function and check it against the documented global order: `listings → exchange_requests → exchange_sessions`.
3. **Check for a long-running transaction** holding locks:
   ```sql
   SELECT pid, state, wait_event_type, query, now() - xact_start AS age
     FROM pg_stat_activity
    WHERE state <> 'idle' AND now() - xact_start > interval '5 seconds'
    ORDER BY age DESC;
   ```
4. **Verify no duplicate reservations exist:**
   ```sql
   SELECT listing_id, count(*) FROM exchange_sessions s
     JOIN exchange_requests r ON r.id = s.request_id
    WHERE s.state NOT IN ('cancelled','no_show')
    GROUP BY 1 HAVING count(*) > 1;
   ```
   **Any row returned is a serious integrity failure.** Freeze acceptances via feature flag and escalate.
5. Add a concurrency test reproducing whatever you found before fixing it.

---

## 11 — Moderation console outage

**Trigger:** console unreachable, or moderators reporting failures.

1. **Check whether the backend is healthy.** If the database is down, this is [Runbook 4](#4--database-outage).
2. **If only the console is down**, redeploy the previous build.
3. **Fallback for a severity-1 report while the console is unavailable** ([SPEC-900 EC-15](../03-specs/SPEC-900-moderation-console.md)): the T&S lead uses the break-glass **read-only** role to view the report and takes action via a direct `moderation-action` call. The action is audited identically. Do not skip the audit.
4. **SLA clocks do not pause for our outage.** If severity-1 cases are at risk, escalate to the CTO for additional hands.
5. On recovery, verify no case was lost and no claim is stuck.

---

## 12 — Bad migration in production

**Trigger:** errors after a migration, or a data integrity alert.

1. **Assess the phase.**
   - **Expand phase** (additive) → **roll forward** with a corrective migration. Safe and fast.
   - **Contract phase** (destructive) → this is why contract phases are DAU-gated. You may need [Runbook 5](#5--point-in-time-restore).
2. **Never write a `DOWN` migration on the fly.** Reversing a migration on a live database with concurrent writes is more dangerous than the original problem.
3. **If the app is erroring** because of a schema mismatch, consider republishing the previous EAS Update while you fix the database — an older client against the current schema is exactly what the two-version rule is meant to make safe.
4. **If data was lost**, stop writes immediately and go to Runbook 5. Every minute of continued writes makes the restore point worse.
5. Post-mortem: why did CI's production-shaped-seed run not catch it?

---

## 13 — Compromised credential

**Trigger:** secret scanner alert, leaked-credential notification, or suspicious access.

| Credential | Action |
| --- | --- |
| **`handoff_code_key`** | Run runbook 14. Do **not** rotate with a plain key swap — every live session's code becomes undecryptable and every scheduled meeting loses its handoff |
| **`service_role` key** | Rotate **immediately** in Supabase. Redeploy Edge Functions and update CI secrets. Then audit all access since the suspected exposure. **Assume everything was readable.** |
| Persona API key | Rotate at the vendor; update Edge Function secrets; check for unexpected inquiries (they cost money and could forge a verification) |
| Persona webhook secret | Rotate; verify no forged webhook flipped a verification to `passed` — check `audit.events` for verification outcomes in the window |
| A moderator account | Force-revoke sessions; disable the account; audit every action and every thread read by that account |
| An engineer's SSO | Revoke; audit; rotate any secret they could have accessed |
| A user's session | Revoke all their sessions; notify them; check for unusual activity |

Then, always: rotate, audit, notify, post-mortem — **in that order**. Rotating first stops the bleeding; auditing first is how the bleeding continues while you read logs.

---

## 14 — Handoff-code key rotation

**Trigger:** scheduled rotation (annual), suspected exposure of `handoff_code_key`, or a Vault migration.

**Why this needs a runbook at all.** `exchange_sessions.handoff_code` is encrypted with a symmetric Vault key ([Exchange State Machine §3.3](../01-architecture/07-exchange-state-machine.md)). Swapping the key without re-encrypting makes every existing code undecryptable — and a session in `scheduled` whose code cannot be read is two people standing in a library with no way to complete an exchange. **The naive rotation is a customer-facing outage with no error message.**

### Procedure

1. **Add the new key alongside the old.** `vault.create_secret('handoff_code_key_next', …)`. Both exist; nothing reads the new one yet.
2. **Identify the working set.** Only **non-terminal** sessions matter:
   ```sql
   SELECT count(*) FROM public.exchange_sessions
    WHERE state IN ('scheduling','scheduled','in_progress','disputed');
   ```
   Terminal sessions are deliberately left on the old key — nobody will ever read those codes again, and re-encrypting them multiplies the transaction size for no benefit. At launch volume the working set is small enough to do in one transaction.
3. **Re-encrypt in one transaction**, holding a row lock so no acceptance or confirmation interleaves:
   ```sql
   BEGIN;
   SELECT id FROM public.exchange_sessions
    WHERE state IN ('scheduling','scheduled','in_progress','disputed')
      FOR UPDATE;
   UPDATE public.exchange_sessions
      SET handoff_code = pgp_sym_encrypt(
            pgp_sym_decrypt(handoff_code, private.get_handoff_key())::text,
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'handoff_code_key_next'))
    WHERE state IN ('scheduling','scheduled','in_progress','disputed');
   COMMIT;
   ```
4. **Verify before promoting.** Decrypt a sample of 20 rows with the new key and assert all are six digits. **If any fails, roll back and stop** — do not promote a key that cannot read what it just wrote.
5. **Promote.** Rename `handoff_code_key_next` to `handoff_code_key`. The read path picks it up on the next call; no deploy is needed because the function resolves the secret by name.
6. **Confirm in the product.** Open a real `scheduled` session's handoff screen and read the code. `exchange.code_read` errors must be zero for 15 minutes before the rotation is called done.

### If it goes wrong mid-flight

The old key is still present until step 5, so the rollback is to stop using the new one. If step 3 partially committed — it should not, it is one transaction — the tell is `pgp_sym_decrypt` errors on the `get_handoff_code` path. Re-run step 3; it is idempotent only against a consistent key, so identify which key each row is under by attempting both.

**Never:** rotate during a metro's peak exchange hours, or with an open severity-1 dispute in the working set.

> **Rehearse this before you need it.** SPEC-010-T73b covers the mechanics; it does not cover an operator reading this page at 2am. Run it once against a seeded staging database with live `scheduled` sessions before the first production rotation ([Development Notes N-03](../07-review/02-development-notes.md#n-03--vault-is-now-on-the-critical-path-of-a-physical-meeting)).

---

## 14 — Tile serving outage or bad basemap build

**Trigger:** `tile_error_rate` or `tile_request_p95_ms` alert, `tile_build_result` failure, `basemap_age_days` > 45, or reports of a blank/wrong map.

**Severity is P2, and that is deliberate.** The basemap is context, not function. Markers stay correctly positioned on a neutral background and the exchange flow is unaffected ([SPEC-008](../../docs/03-specs/SPEC-008-interactive-map.md) §5.10). **Do not page for this.** If someone reports "the map is broken" and exchanges still work, this is the runbook.

1. **Establish which failure it is.** Blank tiles for everyone (serving), wrong or ugly cartography (bad build), or slow tiles in one region (CDN edge)?
2. **Confirm the client degraded correctly** — neutral background, markers present and tappable, attribution still rendered. If markers vanished too, that is a *client* bug and a different, more serious problem.
3. **If it is a bad build — roll back by repointing the style at the previous dated archive.** This is the whole reason archives are immutable and date-stamped. No app release, no cache invalidation, effective in minutes.
   ```bash
   npm run ops:set-basemap -- --archive sharecropr-basemap-2026-07.pmtiles --env production
   ```
4. **If it is a serving outage**, check the R2 bucket and Cloudflare status. There is no origin server to restart — if the object is intact and the CDN is healthy, the problem is the style URL or DNS.
5. **If it is latency in one region only**, it is likely a cold edge. Confirm it warms; if it persists, that is an [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md) revisit trigger, not an incident.
6. **Verify** the attribution still renders after any change. A rollback that silently drops attribution is a licence breach.
7. **Root-cause the build.** Pinned tooling version? Upstream Geofabrik schema change? Extract that failed to download? Fix the pipeline, not just the artifact.
8. **Count it.** Two build failures or skips in a quarter is the [R-15](../06-roadmap/02-open-risks.md) trigger to take the managed-provider fallback. Resist the urge to write more automation instead — that is the exact trap [ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md)'s steel-man names.

---

## 15 — OSM import produced bad candidates

**Trigger:** a reviewer reports nonsense candidates, `osm_candidate_approval_rate` outside the 30–90% band, or — the serious case — a **live safe spot** is found to carry wrong OSM-derived data.

**This is P1 rather than P2 because of one scenario: bad data that got past a human and is now sending people to a real place.**

1. **Halt the scheduled import** before anything else, so the queue stops growing while you work.
   ```bash
   npm run ops:osm-import -- --disable
   ```
2. **Determine whether anything was promoted.** This is the question that sets the severity.
   ```sql
   SELECT s.id, s.name, s.status, s.osm_type, s.osm_id, s.approved_by, s.approved_at
     FROM public.safe_spots s
    WHERE s.source = 'osm_import'
      AND s.approved_at > :suspect_window_start;
   ```
3. **If a live spot is wrong**, treat it as a safety matter, not a data matter:
   - Set `status = 'suspended'` immediately — it disappears from discovery.
   - Check for **scheduled sessions** at that spot. If any exist, notify both parties directly and help them re-schedule. Someone may otherwise drive to a locked door.
   - Only then investigate.
4. **Purge unreviewed candidates** from the affected import run. They are in `private.osm_spot_candidates` and were never client-visible, so this is safe and reversible by re-running the import.
   ```sql
   UPDATE private.osm_spot_candidates
      SET review_state = 'rejected', rejection_reason = 'bad import run <ref>'
    WHERE review_state = 'pending' AND first_seen_at > :run_start;
   ```
5. **Find the cause.** Overpass returning unexpected geometry? Way/relation centroid landing off-site? A retag upstream? **Vandalism?** If the source data was deliberately falsified, that is [THR — OSM as an untrusted external source](../02-security/01-threat-model.md) and worth reporting upstream to OSM.
6. **Audit the human gate.** If bad data reached `active`, the verification requirement was bypassed or performed carelessly. That is [R-02](../06-roadmap/02-open-risks.md)'s rubber-stamping failure mode arriving in production — review the reviewer's recent approvals, not just this one.
7. **Re-enable the import** only after the filter is fixed and a sample run has been eyeballed.
8. **Post-mortem if anything reached `active`.** Blameless, but the question is specific: what made it possible to approve a spot without verifying it?

---

## On-call expectations

| Item | Value |
| --- | --- |
| Rotation | Weekly, engineering |
| P0 acknowledgement | 15 minutes, any hour |
| P1 acknowledgement | 1 hour during hours, next morning overnight |
| Escalation | On-call → engineering lead → CTO → CEO |
| **Severity-1 safety reports** | Separate T&S rota, **not** the engineering on-call |
| Handover | Written, covering open incidents and anything watched |

**You are never in trouble for escalating.** You are in trouble for not escalating.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Platform Engineering | Initial runbooks |
| 2026-10-22 | 1.0.1 | Platform Engineering | Runbook 14 step 3: the old key comes from `private.get_handoff_key()`, the new key from `vault.decrypted_secrets` (SCR-0208). |
