# Spec review — EPIC-03 Authentication (SPEC-001) @ develop HEAD e5e8563

## Story status
| Key | Status | Evidence |
|---|---|---|
| 0301 email signup | Partial | `auth-service.ts` signUp works; R11 "editable exactly once… not reusable for 12 months" — no handle RPC, `private.retired_handles` never written; no §11 events |
| 0302 password rules | Partial | 12/128 + HIBP k-anon (`hibp.ts`, T05–T07). Enforcement is client-only; `config.toml` leaves server HIBP to an unconfigured hosted toggle. "A match blocks signup" is bypassable by calling GoTrue directly. |
| 0303 Apple | Partial | Native button + `signInWithIdToken`; no `[auth.external.apple]`; R05 name written by client *after* session resolves (spec: "before the sign-in callback resolves"); custom Pressable replaces native button when busy/offline (§12 "never re-implemented") |
| 0304 Google | Partial | PKCE + `openAuthSessionAsync` (R03 ok); no provider config, no T02 |
| 0305 verify email | Partial | No `emailRedirectTo`, no `app/auth/*` route, `detectSessionInUrl:false`, no Linking handler → link lands on `site_url` 127.0.0.1:3000; app never re-reads `email_confirmed_at`. Resend cooldown hard-coded 3600 s after the first resend (R18 says 3/hour; countdown should follow `Retry-After`). Per-address 3/h unenforced (config comment admits) |
| 0306 sessions | Partial | Chunked SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY` ok. AC "no token is ever written to AsyncStorage, a log line, or a crash report — asserted by a test, not by review" — no such test. `processLock` not passed (R24); `refreshSessionSingleFlight` unused; no 401→refresh (R27); torn write mixing old/new chunks undetected (R21); no T15/T18/T19/T20, no 6 KB CI gate (R26), no `allowBackup=false` (N04) |
| 0307 reset/change pw | Partial/Wrong | `redirectTo: sharecropr://auth/reset-password` not in `additional_redirect_urls` and no route/code exchange → reset link cannot open the screen. Security screen calls `updateUser({password})` with no current password and no AAL2 — R32 "requires the current password **and** a fresh AAL2 elevation". R31 revoke-other-sessions absent |
| 0308 email change | **Wrong** | Confirmed: `request_email_change` inserts `sha256(gen_random_uuid())` for confirm/revoke and discards the raw values; `supabase/functions/` does not exist; no confirm/revoke RPC. R37 "change commits only when the new address is confirmed" can never happen. UI maps every error (incl. `conflict`, `validation_failed`) to the AAL2 copy |
| 0309 request/cancel deletion | Partial | RPCs, AAL2-if-enrolled, idempotency, audit, pgTAP T34/T35 ok. Missing: §7 rate limits (3/day, 10/day — no token bucket anywhere); R46 cascade (listings/requests/sessions); success navigates to Restore screen instead of "Scheduled confirmation" copy; in-flight warning absent; Security/Delete not AAL2-gated (§8.1); restore check only in `app/index.tsx`, not `(tabs)/_layout` |
| 0310 pipeline | Not started | `private.execute_account_deletion` is a stub with no caller (no Edge Fn, no cron). Doesn't touch garden_locations, media, messages, devices, auth.users, sessions; audit INSERT unguarded so re-run writes a 2nd row (R51/T40) |
| 0311 web deletion | Not started | No web page, no `web-delete-request` |
| 0312 reviewer | Partial | Bypass row only in `supabase/seed.sql` (local/CI). No prod provisioning, credentials doc, or EC-13 expiry alert. `query_timing.test.sql:26` claims T42 "covered elsewhere" — it is not |

## Cross-cutting
- **§11 observability: zero events emitted** — no PostHog/Sentry dependency; `auth.unexplained_signout`, `auth.hibp_skipped`, `account_delete.overdue` absent. DoD #4 fails for every story.
- **§12 a11y:** no `announceForAccessibility`, `accessibilityInvalid/LabelledBy`, password Show/Hide toggle, or countdown cadence limit; Security password field lacks `autoComplete`. DoD #5 fails.
- **§8.3 copy:** sign-in `rate_limited` falls through to wrong-credentials copy (spec: "Too many sign-in attempts. Try again in {mm:ss}.").
- **Test traceability:** of T01–T45 only T03, T05–T07, T09, T21, T28, T30, T31, T34, T35 have tests.
- Spec inconsistency: T05 "200-character accepted" vs R06/N18 128 cap (code rejects 200).

## Scope creep
None material.

## Implemented-but-wrong (summary)
1. Email-change token discard (0308). 2. Password change missing current-pw + AAL2 (R32). 3. Reset/verify redirect URLs unroutable. 4. Resend cooldown 1 h after one send. 5. Pipeline audit non-idempotent. 6. Delete success → restore screen. 7. Error-copy mapping in Security & Sign-in.
