# SPEC-001: Account Creation & Authentication

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.2.1 |
| **Owner** | Engineering — Auth |
| **Phase** | MVP |
| **Security review** | required |
| **Schema depends on** | — (root capability) |
| **Behaviourally coupled with** | SPEC-002 (R32, R36, R44 cite R18), SPEC-013 |
| **Related ADRs** | [ADR-0004](../01-architecture/adr/ADR-0004-supabase.md), [ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md), [ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md), [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) |
| **Last updated** | 2026-10-22 |

---

## 1. Summary

Sharecropr accounts are created with email + password, Sign in with Apple, or Google, and every path terminates in one identical Supabase GoTrue session so that no downstream code branches on provider. This spec defines signup, email verification, the session and token model, password reset, email change, and account deletion — including the 30-day grace period and the public web deletion URL both stores require. It does not define the second factor ([SPEC-002](SPEC-002-two-factor-auth.md)) or identity verification ([SPEC-003](SPEC-003-identity-verification.md)); it defines the account those attach to.

## 2. Goals

- Three independent working sign-in paths, so no single provider outage locks a user out ([ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md)).
- A session model where a stolen refresh token is bounded in time and detectable on reuse, because a Sharecropr session unlocks a home coordinate and a meeting schedule.
- Email ownership proven before the account can do anything beyond `/verify-email`.
- Account deletion that is reachable in three taps in-app, reachable without the app at a public URL, reversible for 30 days, and irreversible after.
- Satisfy App Store Guidelines 4.8 and 5.1.1(v) and the Play Console data-deletion requirement on **first** submission, not after a rejection.
- One `public.profiles` row per `auth.users` row, always, created by trigger and never by client code.

## 3. Non-Goals

- **Passkeys / WebAuthn.** The right destination, explicitly deferred in [ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md). Adding a fourth mechanism to this funnel is the wrong experiment for MVP.
- **Facebook and X OAuth.** Phase 2, gated on the auth-screen abandonment number in ADR-0006.
- **Magic links.** Deep-link handling plus email-forwarding attacks, for no gain alongside three working paths.
- **Phone number as an identifier or a factor.** There is no phone column and adding one requires an ADR ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md)).
- **Multiple emails, or an email different from the login identifier.** One address, one account.
- **Account merging.** Two accounts that turn out to be the same human stay two accounts. Merging exchange history, ratings, and verification state is a data-integrity problem with no MVP payoff.
- **Enterprise/SSO, org accounts, shared accounts.** A garden belongs to a person.
- **Re-enabling a hard-deleted account.** After the grace period the data is gone; the user signs up again as a new person and re-verifies.
- **Biometric gate on app launch.** Reserved for step-up, not for session unlock ([ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md)).

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **new gardener**, I want to sign up with one tap using Apple or Google so that I don't create another password. | P0 |
| US-02 | As a **privacy-minded gardener**, I want to use Apple's Hide My Email so that Sharecropr never learns my real address. | P0 |
| US-03 | As a **gardener without a social account**, I want to sign up with email and a password so that I don't need a Google account to trade zucchini. | P0 |
| US-04 | As a **returning gardener**, I want the app to still be signed in after a week so that I'm not re-authenticating to check my inbox. | P0 |
| US-05 | As a **gardener who forgot my password**, I want a reset link emailed to me so that I can get back in without contacting support. | P0 |
| US-06 | As a **gardener changing email providers**, I want to move my account to a new address so that I keep my ratings and exchange history. | P1 |
| US-07 | As a **gardener leaving the platform**, I want to delete my account from inside the app so that my data and my garden location are erased. | P0 |
| US-08 | As a **gardener who deleted by mistake**, I want signing back in within 30 days to cancel the deletion so that one bad tap isn't final. | P0 |
| US-09 | As a **former user who deleted the app**, I want a web page where I can request deletion so that I don't have to reinstall to erase my data. | P0 |
| US-10 | As an **App Store reviewer**, I want a working account with no ID-verification wall so that I can review the app without a driver's licence. | P0 |
| US-11 | As a **user whose provider is down**, I want to be told *which* path is broken so that I try the email path instead of assuming the app is dead. | P1 |

## 5. Functional Requirements

### 5.1 Signup and provider paths

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | The app offers exactly three sign-in paths at MVP: email + password, Sign in with Apple, and Google. Facebook and X are absent from the UI entirely — not disabled, not "coming soon". |
| R02 | **MUST** | Sign in with Apple is presented on iOS whenever Google is presented, at equal or greater visual prominence, satisfying App Store Guideline 4.8. |
| R03 | **MUST** | Every OAuth flow uses PKCE and the native browser/auth sheet (`expo-auth-session`, native Apple button). An embedded webview MUST NOT be used for any OAuth provider. |
| R04 | **MUST** | Apple private-relay addresses (`@privaterelay.appleid.com`) are stored and treated as ordinary email addresses. No validation, deliverability check, or product rule may reject one or require a "real" address. |
| R05 | **MUST** | On the first Apple authorization only, the returned `fullName` is written to `profiles.display_name` before the sign-in callback resolves. Apple returns the name exactly once and never again. |
| R06 | **MUST** | Passwords are a minimum of 12 characters, with no composition rules, no maximum below 128, and no rotation policy. |
| R07 | **MUST** | A candidate password is checked against the HIBP range API by k-anonymity (first 5 hash chars sent, never the password or the full hash). A match blocks signup and password change. |
| R08 | **SHOULD** | If the HIBP API is unreachable within 1500 ms, the check is skipped and the signup proceeds. Availability of a breach oracle must not be a prerequisite for account creation. |
| R09 | **MUST** | Account linking happens only by email, and only when the provider asserts that email is verified. An unverified provider email MUST NOT merge into an existing account. |
| R10 | **MUST** | Exactly one `public.profiles` row is created per `auth.users` row, by an `AFTER INSERT` trigger on `auth.users`. No client code path inserts a profile. |
| R11 | **MUST** | `profiles.handle` is auto-generated at signup as a unique slug and is editable exactly once thereafter. A handle that has been released is not reusable for 12 months. |
| R12 | **SHOULD** | The sign-in screen shows a provider-status banner when a provider's error rate exceeds 2% over 15 minutes, naming the affected provider and pointing at the email path. |
| R13 | **MUST NOT** | The client MUST NOT hold the `service_role` key, in any form, in any env var, build profile, or OTA bundle. |

### 5.2 Email verification

| ID | Req | Statement |
| --- | --- | --- |
| R14 | **MUST** | An account created via email + password is `email_confirmed_at IS NULL` until the user follows the verification link. |
| R15 | **MUST** | An unverified account is confined to `/(auth)/verify-email`, sign-out, and the legal pages. Every other route redirects there. |
| R16 | **MUST** | Apple and Google signups are treated as verified at creation, because the provider asserts the address. No second verification email is sent. |
| R17 | **MUST** | The verification link is single-use and expires after 24 hours. A consumed or expired link renders a resend affordance, never a dead end. |
| R18 | **MUST** | Resend is rate-limited to 3 per hour per email address, enforced in GoTrue, and the UI shows the remaining cooldown as a countdown. |
| R19 | **SHOULD** | The verification screen shows the address the mail went to and offers "Wrong address? Change it" which re-runs signup rather than editing a half-created account. |

### 5.3 Session and token model

| ID | Req | Statement |
| --- | --- | --- |
| R20 | **MUST** | The session is persisted through the chunked `expo-secure-store` adapter with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` ([ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md)). It MUST NOT be written to `AsyncStorage`, MMKV, or any unencrypted store. |
| R21 | **MUST** | A torn or partial read of the chunked session deletes the whole entry and forces re-authentication. Handing `supabase-js` a truncated session is forbidden. |
| R22 | **MUST** | Access JWT lifetime is 3600 s. Refresh tokens rotate on use, with a 10-second reuse window; reuse outside that window revokes the entire session family. |
| R23 | **MUST** | Sessions expire after 30 days of inactivity and 90 days absolutely. The absolute expiry is not extendable by activity. |
| R24 | **MUST** | Auto-refresh is driven by `AppState`: `startAutoRefresh()` on `active`, `stopAutoRefresh()` otherwise. A single-flight lock (`processLock`) prevents concurrent refreshes. |
| R25 | **MUST** | Sign-out deletes the SecureStore session entry **and** deletes the MMKV query-cache file. Clearing keys individually is insufficient; the cache holds counterparty names and scheduled meeting times, both P1. |
| R26 | **MUST NOT** | The serialized session MUST NOT exceed 6 KB. A CI assertion fails the build if it does. |
| R27 | **SHOULD** | On a 401 the client attempts exactly one silent refresh before signing out to `/sign-in` with a `returnTo` parameter. |
| R28 | **MUST** | A suspended user (`profiles.is_suspended = true`) may still authenticate and read their own data, but every write path returns `suspended` (403). Blocking sign-in entirely would prevent them from deleting their account, which is a legal obligation. |

### 5.4 Password reset and password change

| ID | Req | Statement |
| --- | --- | --- |
| R29 | **MUST** | Password reset is initiated by email address and the response is identical whether or not that address has an account. Reset MUST NOT be an account-existence oracle. |
| R30 | **MUST** | Reset links are single-use, expire after 60 minutes, and are rate-limited to 3 per hour per address. |
| R31 | **MUST** | Completing a password reset revokes every other session for that user and every refresh token in the family. |
| R32 | **MUST** | Changing a password from an authenticated session requires the current password **and** a fresh AAL2 elevation per [SPEC-002-R18](SPEC-002-two-factor-auth.md) and [API Contract §2.4](../01-architecture/06-api-contract.md). |
| R33 | **MUST** | A password reset MUST NOT bypass 2FA. After setting a new password the user still faces the TOTP challenge. Reset proves mailbox control, not possession of the factor. |
| R34 | **MUST** | An account with no password credential (Apple- or Google-only) that requests a reset receives the same neutral response and an email explaining which provider the account uses. It does not gain a password by this route. |
| R35 | **SHOULD** | Every password change and reset sends a notification email to the address on file, including the approximate time and the client platform, with no IP address and no location. |

### 5.5 Email change

| ID | Req | Statement |
| --- | --- | --- |
| R36 | **MUST** | Changing the account email requires a fresh AAL2 elevation (≤ 15 minutes old) when a second factor is enrolled, before the request is accepted. 2FA is optional ([SPEC-002-R04](SPEC-002-two-factor-auth.md)); an account with no verified factor is not blocked from changing its email. |
| R37 | **MUST** | Email change is double-confirmed: a confirmation link to the **new** address, and a notice-with-revoke link to the **old** address. The change commits only when the new address is confirmed. |
| R38 | **MUST** | Until the new address confirms, the old address remains the account's login identifier and the account continues to function. |
| R39 | **MUST** | A pending email change expires after 24 hours and leaves no residue. |
| R40 | **MUST NOT** | An email change MUST NOT be permitted to an address already attached to another account, deleted-but-in-grace included. |
| R41 | **MUST** | Changing email does not change `verifications.status`. Identity verification is bound to the person, not the mailbox. |
| R42 | **SHOULD** | An Apple relay address may be replaced by a normal address. The reverse is not offered — we cannot mint a relay address. |

### 5.6 Account deletion

| ID | Req | Statement |
| --- | --- | --- |
| R43 | **MUST** | Deletion is initiated in-app at `/profile/delete-account`, reachable from the profile tab in no more than three taps (App Store Guideline 5.1.1(v)). |
| R44 | **MUST** | `request_account_deletion` requires a fresh AAL2 elevation when a second factor is enrolled. A stolen unlocked phone must not be able to erase an account that has 2FA; an account without 2FA must still be deletable in-app (R43, App Store 5.1.1(v)). |
| R45 | **MUST** | Requesting deletion sets `profiles.deleted_at = now()` and schedules hard deletion at `now() + 30 days`. It does not delete anything immediately. |
| R46 | **MUST** | During the grace period the account is invisible to every other user: excluded from `public.profile_cards`, its listings are withdrawn, its pending requests are cancelled, and its in-flight sessions are cancelled with reason `account_deleted`, with both parties notified. |
| R47 | **MUST** | Signing in during the grace period presents a "Restore your account?" screen. Confirming clears `deleted_at` and the schedule; declining signs the user out and leaves the schedule intact. |
| R48 | **MUST** | At the end of the grace period, `account-delete` hard-deletes `private.garden_locations`, all media objects, all message bodies, and all device tokens; pseudonymizes the `profiles` shell for referential integrity; retains `private.verification_vendor_refs` pseudonymized for 7 years for fraud and legal defence; revokes all sessions; and writes a terminal `audit.events` row. |
| R49 | **MUST** | A public web URL at `https://sharecropr.app/delete-account` accepts a deletion request without the app installed, satisfying the Play Console data-deletion requirement. It authenticates by emailed one-time link and then imposes the same 30-day grace. |
| R50 | **MUST** | The web deletion flow MUST NOT bypass AAL2 for accounts with 2FA enrolled; it presents a TOTP challenge in the browser after the emailed link. |
| R51 | **MUST** | `account-delete` is idempotent and resumable, processing one user per transaction, so a timeout mid-batch loses no work and re-running is harmless. |
| R52 | **MUST** | Deletion is not blocked by an in-flight exchange. The exchange is cancelled and the counterparty notified; a user's right to erasure does not wait on a stranger's zucchini. |
| R53 | **SHOULD** | The deletion screen states plainly, in the confirmation copy, what is erased, what is retained and why, and the exact date after which it is irreversible. |

### 5.7 Store-compliance and reviewer access

| ID | Req | Statement |
| --- | --- | --- |
| R54 | **MUST** | App Store reviewer accounts are granted KYC bypass through `private.review_bypass_accounts` — a server-side, time-boxed allowlist. A build flag, an env var, or a hardcoded email list MUST NOT be used ([SPEC-003-R28](SPEC-003-identity-verification.md)). |
| R55 | **MUST** | Reviewer bypass rows carry an `expires_at` no more than 45 days out and are provisioned per submission. |
| R56 | **MUST** | The app is fully navigable — map, safe spots, taxonomy, inventory — for a signed-in, unverified account, so a reviewer can evaluate the product without an ID. |
| R57 | **SHOULD** | The privacy-label disclosure lists exactly: email address, name (optional), coarse location, photos, and identifiers. It MUST NOT list precise location, because we do not export one. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| `auth.users` | read (via GoTrue), indirect write | Managed by GoTrue. Never written directly by application SQL except in the deletion pipeline running as `service_role`. |
| `public.profiles` | read / write (self) | `display_name`, `handle`, `avatar_path`, `bio`, `locale`, `timezone`, `onboarding_completed_at`, `deleted_at`. See [Data Model §5](../01-architecture/03-data-model.md). |
| `public.verifications` | read | Read-only here; written by [SPEC-003](SPEC-003-identity-verification.md). Row created by the same signup trigger with `status = 'unstarted'`. |
| `public.devices` | write (delete on sign-out) | Sign-out deregisters the current device's push token so a shared handset does not receive the previous user's notifications. |
| `private.review_bypass_accounts` | read (server-side only) | Reviewer allowlist. Never client-reachable. |
| `private.verification_vendor_refs` | retained through deletion | Pseudonymized, retained 7 years. |
| `audit.events` | write (via trigger) | `auth.signup`, `auth.email_changed`, `auth.password_changed`, `account.deletion_requested`, `account.deletion_restored`, `account.deleted`. |

**New schema objects introduced by this spec:**

```sql
-- supabase/migrations/20260828000009_auth.sql
CREATE TABLE private.pending_email_changes (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  new_email      citext NOT NULL,
  confirm_hash   text   NOT NULL,          -- sha256 of the token; the token itself is never stored
  revoke_hash    text   NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT pending_email_not_taken CHECK (length(new_email) BETWEEN 3 AND 254)
);

CREATE TABLE private.account_deletions (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  scheduled_at   timestamptz NOT NULL,     -- requested_at + 30 days
  reason         text NULL CHECK (length(reason) <= 500),
  source         text NOT NULL CHECK (source IN ('in_app','web')),
  cancelled_at   timestamptz NULL,
  executed_at    timestamptz NULL
);

CREATE INDEX account_deletions_due_idx ON private.account_deletions (scheduled_at)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;
-- Amended by 20261022145504_account_deletions_history.sql (SPEC-001-T50): user_id is no longer the key.
-- Each request is a row (id identity PK); at most one open row per user
-- (UNIQUE (user_id) WHERE cancelled_at IS NULL AND executed_at IS NULL); cancelled rows are history.

-- Released handles cannot be recycled for 12 months (R11).
CREATE TABLE private.retired_handles (
  handle       citext PRIMARY KEY,
  released_at  timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now() + interval '12 months'
);

REVOKE ALL ON private.pending_email_changes, private.account_deletions, private.retired_handles
  FROM anon, authenticated;
```

Both `private` tables exist there and not in `public` for the same reason `garden_locations` does: nothing in them is a client's business, and a table the client cannot reach cannot be leaked by a missing policy.

**RLS policies introduced by this spec** (Pattern A, [RLS Design §5](../01-architecture/05-rls-design.md)):

```sql
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- Added by ADR-0022: other users' live, unblocked rows (card-safe columns only).
CREATE POLICY profiles_select_visible ON public.profiles
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_suspended = false AND NOT app.is_blocked_with(id));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (id = (SELECT auth.uid()));

-- No INSERT policy: profiles are created by trigger only (R10).
-- No DELETE policy anywhere: deletion is the pipeline, not a statement.
```

Other users are read through `public.profile_cards` (`security_invoker = on`) or, for the same card-safe columns, `profiles` itself ([ADR-0022](../01-architecture/adr/ADR-0022-profiles-other-user-reads.md)). Owner-only columns (`locale`, `timezone`, `onboarding_completed_at`, `deleted_at`, `is_suspended`, `suspended_until`) are not table-selectable; the client reads them with `rpc.get_my_profile()`. Client `UPDATE` on `profiles` is column-granted to `display_name, avatar_path, bio, locale, timezone, onboarding_completed_at` only; `handle` (R11) and `deleted_at` (R45) change through RPCs.

**PII touched:** `auth.users.email` (P1), `auth.users.encrypted_password` (P1, never read by us), `profiles.display_name` (P2), `profiles.handle` (P2), `profiles.timezone` (P2), `profiles.is_suspended` (P1, not column-granted), `devices.expo_push_token` (P1). Classification per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md).

## 7. API

Authentication itself is GoTrue, not our surface. Only the three things GoTrue cannot do are ours.

### `rpc.request_account_deletion`

**Auth:** `authenticated` + **AAL2** (≤ 15 min) *when a verified second factor is enrolled* (`app.require_aal2_if_enrolled()`)
**Rate limit:** 3 / day / user (Postgres token bucket)

```jsonc
// Request
{ "p_reason": "Moved away", "p_idempotency_key": "8f14e45f-ceea-4a2f-9c1e-3d0f5a7b2e91" }
// Response 200
{ "scheduled_deletion_at": "2026-09-07T14:31:02Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `aal2_required` | 403 | A verified factor is enrolled and the `aal` claim is `aal1` (never returned to an account with no factor) |
| `aal2_stale` | 403 | TOTP `amr` timestamp older than 15 minutes |
| `conflict` | 409 | A non-cancelled deletion is already scheduled |
| `validation_failed` | 400 | `p_reason` longer than 500 characters |
| `rate_limited` | 429 | Bucket empty; `Retry-After` set |

### `rpc.cancel_account_deletion`

**Auth:** `authenticated` (no AAL2 — restoring is the safe direction)
**Rate limit:** 10 / day / user

```jsonc
// Request
{ "p_idempotency_key": "…" }
// Response 200
{ "restored": true, "restored_at": "2026-08-19T09:02:11Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `request_not_found` | 404 | No pending deletion |
| `invalid_transition` | 409 | Grace period already elapsed; the account is gone |

### `rpc.request_email_change`

**Auth:** `authenticated` + **AAL2** *when a verified second factor is enrolled*
**Rate limit:** 3 / day / user

```jsonc
// Request
{ "p_new_email": "priya@example.org", "p_idempotency_key": "…" }
// Response 200 — deliberately uninformative
{ "status": "confirmation_sent" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `aal2_required` / `aal2_stale` | 403 | Step-up missing or stale |
| `validation_failed` | 400 | Not a syntactically valid address, or > 254 characters |
| `conflict` | 409 | An **unexpired** pending change already exists for this user (expired rows are reaped first, R39) |
| `rate_limited` | 429 | |

> **The response is `confirmation_sent` even when the target address already belongs to another account.** Returning a distinct error would turn this endpoint into an account-existence oracle for arbitrary addresses. Nothing is inserted in that case, and the rejection (R40) is also enforced at confirmation time and is reported only to the requesting user's *current* address by email.

### Edge Function `account-delete`

**Invoked by:** `pg_cron` daily, and by the public web deletion form.
**Auth:** `service_role`. Not reachable with a user JWT.

Pipeline per [API Contract §6.7](../01-architecture/06-api-contract.md). One user per transaction; idempotent; resumable.

### Web endpoint `GET/POST https://sharecropr.app/delete-account`

Static page + a form that calls a public Edge Function `web-delete-request`. Flow: email address → one-time link (15-minute expiry) → TOTP challenge if enrolled → confirmation screen showing the deletion date. Rate-limited 3 / hour / IP and 3 / day / address at Kong.

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Sign in | `/(auth)/sign-in` | Apple, Google, email+password, "Forgot password" |
| Sign up | `/(auth)/sign-up` | Same three paths; password field with the 12-character rule stated up front |
| Verify email | `/(auth)/verify-email` | Holding screen with resend and cooldown |
| Forgot password | `/(auth)/forgot-password` | Address entry; always the same success screen |
| Reset password | `/(auth)/reset-password` | Deep-link target; new password + confirm |
| Security settings | `/(tabs)/profile/security` | AAL2-gated. Email, password, 2FA, active sessions |
| Delete account | `/(tabs)/profile/delete-account` | AAL2-gated. Consequences, confirmation, date |
| Restore account | `/(auth)/restore-account` | Shown on sign-in during grace |
| Web deletion | `https://sharecropr.app/delete-account` | Outside the app entirely |

### 8.2 States

| State | Behaviour |
| --- | --- |
| **Loading** | Provider buttons show an inline spinner and become non-interactive; the rest of the screen stays live so the user can switch paths. Cold-start session hydration shows `BootSplash` for at most 3 s, then falls through to `/sign-in` rather than hanging. |
| **Empty** | Not applicable to sign-in. The security screen's "Active sessions" list is never empty — the current session is always listed, labelled "This device". |
| **Error (recoverable)** | Wrong password, expired link, network failure: inline message under the relevant field, form retains input except the password, primary button re-enabled. Never a toast — the user must act. |
| **Error (terminal)** | Account suspended, provider permanently unlinked, grace period elapsed: full-screen state with the reason, a support mail link, and a "Sign in with a different account" action. No retry button, because retrying cannot succeed. |
| **Offline** | Provider buttons and submit are disabled with a persistent banner: sign-in requires a live server, and there is no honest way to queue it. An existing valid session is hydrated from SecureStore and the app opens normally offline. |
| **Permission denied** | Not applicable to sign-in (no OS permission is involved). OAuth cancellation by the user is not an error: the sheet closes and the screen returns to rest, silently. |
| **Rate limited** | Submit disabled for exactly `Retry-After` seconds with a live countdown on the button label ("Try again in 4:12"). No auto-retry. Applies to sign-in (5 / 15 min per email), reset (3 / hour), and resend (3 / hour). |

### 8.3 Copy

Exact strings. Anything not listed here is a spec gap and must be added before implementation.

**Sign-in and signup errors**

| Condition | Copy |
| --- | --- |
| Wrong email or password | `That email and password don't match. Check both and try again.` |
| Sign-in rate limited | `Too many sign-in attempts. Try again in {mm:ss}.` |
| Sign-in rate limited, no `Retry-After` available *(interim until the §8.2 countdown is built)* | `Too many sign-in attempts. Wait a few minutes and try again.` |
| Network failure | `We couldn't reach Sharecropr. Check your connection and try again.` |
| Password too short | `Passwords need at least 12 characters. Length beats complexity.` |
| Password found in a breach | `This password has appeared in a known data breach. Pick a different one — it doesn't have to be complicated, just not this one.` |
| Provider cancelled | *(no copy — silent return to the form)* |
| Provider failed | `{Apple\|Google} sign-in didn't complete. You can try again, or sign in with your email and password.` |
| Provider degraded banner | `{Google} sign-in is having problems right now. The email and password option is working normally.` |
| Account suspended | `This account is suspended. Email support@sharecropr.app if you think that's a mistake.` |
| Offline | `You're offline. Signing in needs a connection.` |

**Email verification**

| Condition | Copy |
| --- | --- |
| Holding screen | `Check your email` / `We sent a confirmation link to {email}. Tap it and you're in.` |
| Resend available | `Didn't arrive? Resend` |
| Resend cooldown | `You can resend in {mm:ss}.` |
| Link expired | `That link has expired. Links are good for 24 hours — here's a fresh one.` |
| Link already used | `This link was already used. Try signing in.` |
| Wrong address | `Wrong address? Start over` |
| Return without a session | `Back to sign in` |

**Password reset**

| Condition | Copy |
| --- | --- |
| Success (always, regardless of existence) | `If there's an account for {email}, a reset link is on its way. It expires in 60 minutes.` |
| OAuth-only account email body | `Your Sharecropr account signs in with {Apple\|Google}, so there's no password to reset. Open the app and use the {Apple\|Google} button.` |
| Reset complete | `Password updated. You've been signed out everywhere else.` |
| Still needs 2FA | `One more step — enter the code from your authenticator app.` |
| Link invalid (expired, used, other device) | `That reset link didn't work` / `Reset links work once, expire after 60 minutes, and open only on the device that asked for them. Request a new one.` / action `Request a new link` |

**Email change**

| Condition | Copy |
| --- | --- |
| Request submitted | `Confirmation sent to {new_email}. Your current address stays active until you confirm.` |
| Notice to old address (subject) | `Someone requested an email change on your Sharecropr account` |
| Notice to old address (body) | `A request was made to change your Sharecropr email to {masked_new_email}. If that was you, no action is needed. If it wasn't, tap here to cancel it and secure your account.` |
| Target address taken | `We couldn't complete that change. Try a different address.` *(deliberately vague — see §7)* |
| Expired | `That confirmation link expired. Request the change again from Security settings.` |

**Account deletion**

| Condition | Copy |
| --- | --- |
| Screen title | `Delete your account` |
| Body | `We'll erase your garden location, your photos, your messages, and your profile. It happens 30 days from now. Sign in any time before then and we'll stop it.` |
| Retention disclosure | `We keep a record that a verification was completed — not your ID, which we never had — for 7 years, because we're required to. Everything else goes.` |
| In-flight exchange warning | `You have {n} exchange(s) in progress. They'll be cancelled and the other person will be told.` |
| Confirm button | `Delete my account` |
| Confirmation input prompt | `Type DELETE to confirm` |
| Scheduled confirmation | `Your account will be deleted on {date}. You can still sign in until then to cancel.` |
| AAL2 required | `Enter the code from your authenticator app to confirm this.` |
| Restore screen title | `Welcome back — want to keep your account?` |
| Restore screen body | `You asked us to delete this account on {request_date}. We haven't yet. Deletion is scheduled for {scheduled_date}.` |
| Restore actions | `Keep my account` / `Continue with deletion` |
| Grace elapsed | `This account was deleted and can't be recovered. You're welcome to start a new one.` |
| Account status unavailable | `We couldn't check your account` / `Check your connection and try again.` / actions `Try again` / `Sign out` |
| Restore failed | `We couldn't restore your account just now. Try again.` |

**Empty states**

| Screen | Copy |
| --- | --- |
| Active sessions (only this device) | `You're only signed in here.` |

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Take over an account by chaining a weak password reset with a missing 2FA re-challenge, then call `rpc.get_my_garden_location()` and read the victim's home coordinates, their message threads with named counterparties, and the time and place of their next in-person meeting. Second-worst: enumerate which email addresses have Sharecropr accounts through a reset or email-change oracle, which for a stalker is a "is my target on this app" query. Third: schedule a malicious deletion from a briefly unattended unlocked phone. R29/R33/R44 and the uniform `confirmation_sent` response exist for exactly these three. |
| **Which RLS policies enforce access?** | `profiles_select_own`, `profiles_select_visible` (ADR-0022) and `profiles_update_own` (Pattern A, introduced by this spec — note that [RLS Design §5](../01-architecture/05-rls-design.md) enumerates Pattern A tables without naming the `profiles` policies; these names are established here). Other-user reads go exclusively through the `public.profile_cards` view with `security_invoker = on`. `trust_score`, `cancellation_count_90d`, `home_h3_r7`, and `is_suspended` are column-`REVOKE`d from `authenticated` on the base table. `private.pending_email_changes`, `private.account_deletions`, and `private.retired_handles` have no grants to any client role at all — the strongest available control, and the reason they are not in `public`. There is **no `DELETE` policy on `profiles`**; its absence is the enforcement of "deletion is a pipeline, not a statement". |
| **Can any response path expose an exact coordinate or PII?** | No coordinate: nothing in this spec reads `private.garden_locations`, and none of its RPC return types has a column that could hold a point ([API Contract §9](../01-architecture/06-api-contract.md)). PII: yes, deliberately and narrowly — the user's own email on their own security screen. `request_email_change` never echoes the target address back; the notice email to the old address masks it (`p***a@e***.org`). `profile_cards` carries no email at all. |
| **What is logged, and is it scrubbed?** | `audit.events` records `auth.signup`, `auth.email_changed` (with a hash of the new address, never the address), `auth.password_changed`, `account.deletion_requested`, `account.deletion_restored`, `account.deleted` — actor id, timestamp, request id, no credentials, no addresses. GoTrue's own logs carry email addresses; retention is 30 days and access is restricted. Sentry's `beforeSend` redacts anything matching an email pattern or a JWT before transmission. Passwords, reset tokens, and confirmation tokens are never written anywhere — `private.pending_email_changes` stores SHA-256 hashes, not tokens. |
| **Does this need step-up authentication?** | Yes, for four operations: change email (R36), change password (R32), request account deletion (R44), and viewing the security screen at all. All route through `app.require_aal2(interval '15 minutes')` ([API Contract §2.4](../01-architecture/06-api-contract.md)). Deliberately **not** step-up: sign-in itself, `cancel_account_deletion` (R47 — restoring must be easy; the failure mode of friction here is an unwanted permanent deletion), and sign-out. |
| **Abuse / rate-limit controls** | Sign-in 10 / 5 min per IP and 5 / 15 min per email (GoTrue). Password reset 3 / hour per address. Verification resend 3 / hour per address. `request_account_deletion` 3 / day per user, `request_email_change` 3 / day per user, `cancel_account_deletion` 10 / day per user (Postgres token buckets). Web deletion 3 / hour per IP and 3 / day per address at Kong. HIBP check blocks credential-stuffing-friendly passwords at the source. Refresh-token rotation with reuse detection turns a stolen token into a detectable event rather than a silent persistent foothold. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | User signs up with Apple, deletes the app, reinstalls, signs in with Apple again. | Signed into the same account. `display_name` is **not** re-returned by Apple (R05) — the existing value is retained. If the first authorization failed before we persisted the name, the profile is nameless and the user is prompted to set one during onboarding. This is unrecoverable from Apple and is documented as such. |
| EC-02 | User signs up with Google using `p@gmail.com`, later signs in with Apple which returns the same verified `p@gmail.com`. | Linked to the same account (R09), because Apple asserts the email is verified. Both providers now appear in `app_metadata.providers`. |
| EC-03 | Same as EC-02 but the provider reports the email as **unverified**. | A new, separate account is created. Merging on an unverified assertion is an account-takeover primitive (R09). The user sees "That address already has an account — sign in with {provider}" only after they authenticate, never before. |
| EC-04 | User uses Apple Hide My Email, then disables email forwarding in Apple ID settings. | Every transactional email silently fails to deliver. Bounce handling marks the address undeliverable and the app shows an in-app banner: `We can't reach your email address. Update it in Security settings.` The in-app inbox continues to work, which is why it is the durable record. |
| EC-05 | Two devices refresh the same session within milliseconds of each other. | `processLock` serialises them on one device; across devices, the 10-second reuse window absorbs it (R22). Outside that window the family is revoked and both devices re-authenticate. This is the intended, if annoying, behaviour. |
| EC-06 | App is killed mid-`setItem` on the chunked SecureStore adapter. | Next `getItem` sees a missing chunk, deletes the whole entry, returns `null`, and the user lands on `/sign-in` (R21). Fail-closed. Instrumented as an `auth.unexplained_signout` event because [ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md) makes the rate the revisit trigger. |
| EC-07 | User requests deletion, then sends a message or accepts an exchange during the grace period. | Not possible: `profiles.deleted_at IS NOT NULL` fails `app.can_transact()` and the write policies filter on `deleted_at IS NULL`. The app shows the restore prompt instead of the action. |
| EC-08 | User requests deletion in-app, then also submits the web form. | `private.account_deletions` holds at most one *open* request per `user_id` (partial unique index); the second request returns `conflict` (409), which the web flow renders as "Deletion is already scheduled for {date}". No double-scheduling. A request after a restore is a new row, and the cancelled one is kept (T50). |
| EC-09 | Deletion grace period elapses while the user has an active session on another device. | `account-delete` revokes all sessions as part of the pipeline (R48). The other device's next request 401s, the silent refresh fails, and it signs out to a terminal state screen. |
| EC-10 | User changes email to an address, then that address is deleted by its provider and reassigned to a stranger who requests a password reset. | Out of scope to prevent — mailbox control is the reset credential by design. Mitigated only by 2FA remaining required after reset (R33), which is precisely why R33 exists and is a MUST. |
| EC-11 | HIBP is down during signup. | Check is skipped after 1500 ms and signup proceeds (R08). A breach oracle is not allowed to be a dependency of account creation. Logged as `auth.hibp_skipped` and alerted above 5% of signups. |
| EC-12 | User's device clock is wrong by two hours; JWT `exp` appears already elapsed. | GoTrue validates against server time, so the token is fine; the client's local expiry heuristic is the problem. The client trusts a 401 from the server over its own clock and refreshes on 401 rather than pre-emptively on local time alone. |
| EC-13 | App Store reviewer's bypass row expires mid-review. | The reviewer hits the verification wall. Mitigation: `expires_at` is set to submission date + 45 days (R55), and a cron alert fires 7 days before any bypass row expires while a submission is in flight. This has bitten other teams; it is a calendar item in [Release & Store Submission](../05-operations/03-release-and-store-submission.md). |
| EC-14 | Suspended user tries to delete their account. | Allowed, and this is deliberate (R28). Suspension is a moderation action; it does not suspend the right to erasure. |
| EC-15 | User signs in on a shared family tablet, signs out, and the next family member signs in. | Sign-out deletes the session **and** the MMKV cache file (R25) and deregisters the push token from `devices`. Without both, the second user sees the first user's cached counterparty names and receives their notifications. |
| EC-16 | A user's only credential is Google, and they unlink Google. | Refused. Unlinking is permitted only when a second credential exists ([ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md)). Copy: `That's your only way to sign in. Add a password first.` |
| EC-17 | Deletion pipeline fails partway (storage 500 on media delete). | The transaction for that user rolls back; `executed_at` stays `NULL`; the next daily run retries. `account-delete` is idempotent (R51). Alert fires if any row is more than 3 days past `scheduled_at`. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `auth.signup_started` | PostHog event | `method` (`email`\|`apple`\|`google`) | — |
| `auth.signup_completed` | PostHog event | `method`, `ms_to_complete` | — |
| `auth.signup_abandoned` | PostHog event | `method`, `last_step` | Auth-screen abandonment > 15% over 7 days (ADR-0006 revisit trigger) |
| `auth.provider_error` | PostHog + Sentry | `provider`, `error_code` | Any provider's error rate > 2% of attempts over 7 days (ADR-0006 revisit trigger) |
| `auth.email_verification_sent` / `_confirmed` | PostHog | — | Confirmation rate < 70% over 24 h |
| `auth.signin_failed` | Metric | `reason` (`bad_credentials`\|`rate_limited`\|`suspended`) | `bad_credentials` > 30% of attempts in 15 min → credential-stuffing alert |
| `auth.unexplained_signout` | Sentry + metric | `cause` (`torn_chunk`\|`refresh_reuse`\|`absolute_expiry`) | **> 1% of sessions per week** — the primary [ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md) revisit trigger |
| `auth.refresh_reuse_detected` | Security metric | `user_id` (hashed) | Any occurrence > 5 / hour globally → possible token theft, page security |
| `auth.hibp_skipped` | Metric | — | > 5% of signups in 1 h |
| `auth.password_reset_requested` / `_completed` | Audit + metric | — | Completion rate < 40% → the email is not arriving |
| `account.deletion_requested` | `audit.events` | `source`, `has_inflight_exchange` | > 2% of MAU in 7 days → product problem, not an auth problem |
| `account.deletion_restored` | `audit.events` | `days_into_grace` | — |
| `account.deleted` | `audit.events` | — | — |
| `account_delete.overdue` | Metric | `count` | **Any row > 3 days past `scheduled_at`** — legal exposure, pages on-call |
| `auth.session_size_bytes` | Metric (CI + runtime) | `p95` | p95 > 5 KB (approaching the 6 KB CI ceiling, R26) |

## 12. Accessibility

- Every field on `/sign-in`, `/sign-up`, and `/reset-password` has a `textContentType` / `autoComplete` value that lets the OS password manager fill it (`emailAddress`, `password`, `newPassword`). Autofill is an accessibility feature before it is a convenience.
- The password field's requirements are stated **before** the field, not as an error after submission, so a screen-reader user does not discover the 12-character rule by failing.
- Password visibility toggle is a labelled button (`Show password` / `Hide password`), never an unlabelled eye glyph, with a 44 × 44 dp target.
- The Sign in with Apple button uses the native `AppleAuthenticationButton` at the required minimum dimensions so it inherits VoiceOver behaviour and Apple's own contrast guarantees; it is never re-implemented.
- Error text is announced via `AccessibilityInfo.announceForAccessibility` on appearance and is associated with its field through `accessibilityLabelledBy` and `accessibilityInvalid`. Colour is never the only error signal.
- The resend and rate-limit countdowns are `accessibilityLiveRegion="polite"` and announce at 60 s, 30 s, and 0 s only — not every second, which would be unusable.
- The delete-account confirmation requires typing `DELETE`; the field accepts any case and trims whitespace, because a case-sensitive confirmation with a screen keyboard is a hostile pattern.
- Focus after modal dismissal returns to the element that opened it via `setAccessibilityFocus` on a ref.
- Full flow verified at 200% dynamic type on both platforms; no fixed-height container holds text on any auth screen.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | e2e | R01, R02 | Sign-in screen on iOS renders Apple, Google, and email paths; Apple button is at or above Google in the layout tree. Facebook/X strings absent from the bundle. |
| T02 | integration | R03 | OAuth request URL contains `code_challenge` and `code_challenge_method=S256`; no `WebView` component is mounted during the flow. |
| T03 | unit | R04 | `@privaterelay.appleid.com` passes every email validator in `domain/validation`. |
| T04 | integration | R05 | Apple callback with `fullName` writes `profiles.display_name`; a second callback without it leaves the value unchanged. |
| T05 | unit | R06 | 11-character password rejected; 12 accepted; 200-character accepted; no composition rule fires. |
| T06 | integration | R07 | Known-breached password rejected; only the first 5 SHA-1 hex chars appear in the outbound request. |
| T07 | integration | R08 | HIBP mocked to hang; signup completes after ~1500 ms and emits `auth.hibp_skipped`. |
| T08 | integration | R09 | Provider payload with `email_verified: false` creates a new account rather than linking. |
| T09 | rls | R10 | Inserting into `auth.users` creates exactly one `profiles` row and one `verifications` row. Direct client INSERT on `profiles` fails — no INSERT policy exists. |
| T10 | integration | R11 | Handle auto-generated and unique; second edit attempt rejected; a released handle is unavailable for 12 months via `private.retired_handles`. |
| T11 | e2e | R14, R15 | Unverified account is redirected to `/verify-email` from `/map`, `/inventory`, `/exchanges`, and `/profile`. |
| T12 | integration | R16 | Google signup yields `email_confirmed_at NOT NULL` and sends no verification email. |
| T13 | integration | R17 | Verification link consumed twice: second attempt returns the "already used" state, not an error page. Link at 24 h + 1 min is rejected. |
| T14 | integration | R18 | 4th resend within an hour returns 429 with `Retry-After`. |
| T15 | unit | R20, R21 | Chunked adapter round-trips a 5 KB session; a deleted middle chunk causes `getItem` to return `null` and purge all chunks. |
| T16 | integration | R22 | Refresh token reused at t+11 s revokes the family; reused at t+5 s succeeds. |
| T17 | integration | R23 | Session at 30 days idle is rejected; a session actively used for 91 days is rejected. |
| T18 | unit | R24 | `AppState` transition to `background` calls `stopAutoRefresh`; two concurrent refresh calls result in one network request. |
| T19 | integration | R25 | After sign-out, the MMKV cache file does not exist and the SecureStore session key returns `null`. Unit slice: when global sign-out fails, the stored session is purged before the local sign-out. |
| T20 | unit (CI gate) | R26 | Serialized session with moderator claim and OAuth metadata is under 6 KB. |
| T21 | integration | R28 | Suspended user: `GET /rest/v1/profiles` succeeds; `POST /rest/v1/inventory_items` returns `suspended` 403; `rpc.request_account_deletion` succeeds. |
| T22 | integration | R29 | Reset for a nonexistent address returns byte-identical body and status, and within 50 ms of the timing for an existing address (timing-oracle guard). |
| T23 | integration | R30 | Reset link at 61 minutes rejected; second use of a consumed link rejected; 4th request in an hour returns 429. |
| T24 | integration | R31 | After reset, a previously issued access token on another device 401s and its refresh token is revoked. |
| T25 | integration | R32 | For an enrolled account, password change without a fresh AAL2 claim returns `aal2_required`; with a 16-minute-old TOTP `amr` returns `aal2_stale`. |
| T26 | e2e | R33 | Full reset flow on a 2FA-enrolled account still presents the TOTP challenge before reaching the tabs. |
| T27 | integration | R34 | Reset requested for an Apple-only account returns the standard success body; the delivered email is the provider-explanation template. |
| T28 | integration | R36 | For an enrolled account, `request_email_change` with `aal1` returns `aal2_required` and a stale TOTP `amr` returns `aal2_stale`; an account with no verified factor succeeds at `aal1`. |
| T29 | e2e | R37, R38 | Change requested → old address still logs in → new address confirms → new address logs in and old does not. |
| T30 | integration | R39 | Pending change at 24 h + 1 min is expired and the row is reaped; the old address is untouched. |
| T31 | integration | R40 | Confirming a change to an address held by another account (including one in deletion grace) fails and leaves the original address in place. |
| T32 | integration | R41 | `verifications.status` is unchanged across a completed email change. |
| T33 | e2e | R43 | From `/map`, the delete-account screen is reachable in ≤ 3 taps. Asserted by a Maestro tap counter. |
| T34 | integration | R44 | For an enrolled account, `request_account_deletion` without a fresh AAL2 returns 403 and writes no `private.account_deletions` row; an account with no verified factor can request deletion at `aal1`. |
| T35 | integration | R45 | After request: `profiles.deleted_at` set, `private.account_deletions.scheduled_at = requested_at + 30 days`, and no user data is yet removed. |
| T36 | rls | R46 | A second user's `GET /rest/v1/profile_cards?id=eq.<deleting_user>` returns `[]`; the deleting user's listings are `withdrawn`; their pending requests are `cancelled`. |
| T37 | e2e | R47 | Sign-in during grace shows the restore screen; "Keep my account" clears `deleted_at`; "Continue with deletion" signs out with the schedule intact. |
| T38 | integration | R48 | After pipeline execution: zero rows in `private.garden_locations`, zero storage objects, `messages.body` nulled, zero `devices` rows, `profiles` row pseudonymized, `private.verification_vendor_refs` row present with a pseudonymized `user_id`, terminal `audit.events` row written. |
| T39 | e2e | R49, R50 | Web form → emailed link → TOTP challenge → deletion scheduled, all without the app. Skipping the TOTP step returns 403. |
| T40 | integration | R51 | Running `account-delete` twice over the same user produces no error and no second audit row. |
| T41 | integration | R52 | Deletion requested with an in-flight `scheduled` session: session is `cancelled` with reason `account_deleted` and the counterparty receives an `exchange_cancelled` notification. |
| T42 | rls | R54, R55 | `app.can_transact()` returns true for a user in `private.review_bypass_accounts` with a future `expires_at`, false once expired. No build flag or env var named `*BYPASS*` exists in the bundle. |
| T43 | e2e | R56 | Unverified account can reach the map, open a safe-spot sheet, browse taxonomy, and add an inventory item. |
| T44 | manual | R57 | Privacy-label submission reviewed against the actual data flow before each store submission. |
| T45 | integration | R13 | Grep the built Hermes bundle and every EAS build profile for a service-role JWT structure; build fails on a hit. |
| T46 | unit | R47, Invariant 10 | After the session arrives, `/` shows the splash until `get_account_deletion_status` answers for *that* user, then redirects to `/restore-account` when pending, never to `/map` first. A server error renders an actionable retry (Invariant 10). Unreachable, or no answer in 8 s, opens the app normally (§8.2 Offline; EC-07 holds server-side). The restore screen renders the same retry instead of a blank screen. |
| T47 | unit | R30 | Reset uses `redirectTo: sharecropr://reset-password`, listed in `config.toml` `additional_redirect_urls` and resolving to `/(auth)/reset-password`. The screen exchanges the PKCE `code` exactly once before showing the form. An error param, a failed exchange, or no code and no session renders 'Request a new link'. |
| T48 | unit | R18, R19 | After a sessionless `signUp` (`enable_confirmations = true`), `/verify-email` shows the address from the route params and resend calls GoTrue `resend` for it without a session. With neither a session nor an address it redirects to `/sign-in`. |
| T49 | unit | R15, §8.2, §8.3 | `mapAuthError` derives `email_not_confirmed`, `network`, `rate_limited`, `suspended` and `bad_credentials` from GoTrue's `code`/`status`/`name`, with the message as fallback. Sign-in shows distinct copy for each and routes `email_not_confirmed` to `/verify-email`. |
| T50 | rls | R45, R47, EC-08 | request → cancel → request schedules a new deletion. The cancelled row is kept. At most one open row per user (partial unique index, also outside the RPC). A second open request returns `conflict`. |
| T51 | unit | R47 | 'Keep my account' navigates only when `cancel_account_deletion` succeeds. An error shows inline copy and keeps the screen. `invalid_transition` shows the grace-elapsed state. |
| T52 | unit | R03, §8.2 | Apple cancel (`err.code === 'ERR_REQUEST_CANCELED'`) and Google sheet dismissal return silently: no error copy, no navigation. |
| T53 | unit + rls | §7 `p_idempotency_key` | One user intent (delete, restore, email change) sends the same `p_idempotency_key` on every retry. A new intent, a remount or an edited email sends a new key. The server replays the stored result for a repeated key and rejects a reused key with different arguments. |
| T54 | unit | R25 | Concurrent first `getQueryCache()` calls generate and persist one encryption key and open one MMKV instance. A failed open can be retried. |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| N01 | Password reset used as an account-existence oracle: request resets for 1,000 addresses, 500 real, and compare status, body bytes, and response-time distributions. | Identical status and body; response-time distributions statistically indistinguishable (Mann-Whitney p > 0.05). |
| N02 | `request_email_change` used as an oracle: target an address known to belong to another account. | `{"status":"confirmation_sent"}`, 200. No information about the target. |
| N03 | Credential stuffing: 200 sign-in attempts across 40 emails from one IP. | Kong limits at 10 / 5 min per IP; GoTrue at 5 / 15 min per email. `auth.signin_failed` alert fires. No account is disclosed as existing. |
| N04 | Steal a refresh token from a device backup and use it on a second device. | `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and `allowBackup=false` mean it is not in the backup at all. If injected manually, first use rotates and the legitimate device's next refresh triggers reuse detection, revoking the family and alerting. |
| N05 | Replay a consumed email-verification token. | 400, "already used" state. The token hash row is deleted on first use. |
| N06 | Forge a `profiles` INSERT to claim a chosen `id` or a moderator `app_metadata`. | INSERT denied (no policy). `app_metadata` is writable only by `service_role`; a client PATCH on `user_metadata` claiming `role: moderator` does not affect `app.is_moderator()`, which reads `app_metadata` only. |
| N07 | Client attempts `PATCH /rest/v1/profiles?id=eq.<other_user>` with a valid own JWT. | 0 rows updated — `profiles_update_own` `USING` clause. Verified as a negative pgTAP assertion. |
| N08 | Client attempts to select `trust_score`, `cancellation_count_90d`, `home_h3_r7`, or `is_suspended` from `profiles` or `profile_cards`. | 42501 on the base table (no table-level grant; these columns are simply not in the column `GRANT`); column absent from the view. |
| N09 | `anon` role attempts any read of `profiles`, `private.pending_email_changes`, or `private.account_deletions`. | Denied on all three. `private` has no grant to `anon` at all. |
| N10 | Call `rpc.request_account_deletion` with a JWT whose `aal` claim has been hand-edited to `aal2`. | Rejected: the JWT is RS256-signed and an edited claim fails verification at Kong before reaching PostgREST. |
| N11 | Call `rpc.request_account_deletion` with a genuine `aal2` claim whose TOTP `amr` timestamp is 3 hours old. | `aal2_stale` 403. Enrollment is not elevation. |
| N12 | Call `rpc.cancel_account_deletion` as a different authenticated user, passing the victim's id in any parameter position. | The RPC takes no user parameter; it operates on `auth.uid()` only. No signature exists that could target another user. |
| N13 | Deletion-grace bypass: sign in during grace and attempt `create_exchange_request` without restoring. | `not_verified` / `suspended` 403 — `app.can_transact()` requires `deleted_at IS NULL`. |
| N14 | Link a second account by asserting a verified email that the provider actually reported unverified (tampered client payload). | The assertion is read from the provider's signed ID token server-side, not from the client. Tampering fails signature verification. |
| N15 | Register a handle matching an existing one with Unicode confusables or trailing whitespace. | `handle` is `citext` with `~ '^[a-z0-9_]{3,20}$'`; non-ASCII and whitespace are rejected at the CHECK constraint, not in the client. |
| N16 | Sign out, then read the MMKV cache file from a rooted device for counterparty names and scheduled meeting times. | File is deleted on sign-out (R25); while present it is encrypted with a SecureStore-held key. Root access defeats this — stated honestly in [Mobile Architecture §12.3](../01-architecture/02-mobile-architecture.md). |
| N17 | Trigger 500 password resets against one address to flood the mailbox as harassment. | 3 / hour per address at GoTrue; the 4th returns 429 with no email sent. |
| N18 | Submit a 100 MB password to exhaust bcrypt CPU. | Rejected at 128 characters before hashing. Kong body-size limit is a second layer. |
| N19 | Web deletion endpoint invoked with a forged email address to delete someone else's account. | The emailed one-time link is the authentication; the requester never proves anything by typing an address. The link goes only to the address on file, and a 2FA-enrolled account additionally needs the TOTP code. |
| N20 | Timing attack on sign-in to distinguish "no such user" from "wrong password". | GoTrue performs a dummy bcrypt comparison for nonexistent users. Asserted with a timing distribution test. |
| N21 | Attempt to reach `private.account_deletions` through a PostgREST embed (`select=*,deletions:account_deletions(*)`). | `private` is not in PostgREST's `db-schemas` list; the relation is not resolvable. |
| N22 | Retain a session across a deletion execution by refreshing continuously. | `account-delete` revokes the session family as part of the pipeline; the next refresh fails regardless of timing. |

### 13.3 Manual QA

- [ ] Sign in with Apple on a physical iPhone using Hide My Email; confirm the relay address is accepted everywhere and that transactional mail arrives.
- [ ] Sign in with Apple on Android (web flow) and confirm the fallback is functional, if clunky.
- [ ] Delete and reinstall the app after an Apple signup; confirm the display name survives and that Apple does not re-supply it.
- [ ] Full password-reset flow on a real mail client, including tapping the link from the mail app rather than in-app.
- [ ] Email change with the old address open in a second client; confirm the notice arrives and the revoke link works.
- [ ] Delete an account with an in-flight exchange from a second test account; confirm the counterparty's notification copy reads correctly.
- [ ] Restore an account on day 29 of the grace period.
- [ ] Complete the web deletion flow on a desktop browser with no app installed, on a 2FA-enrolled account.
- [ ] Verify VoiceOver and TalkBack on all six auth screens at 200% type scale.
- [ ] Confirm the reviewer bypass account works end-to-end on the exact build submitted, on the day of submission.
- [ ] Airplane-mode sign-in shows the offline banner and disabled buttons, not a spinner that never resolves.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | None. Authentication is not flaggable — there is no meaningful "off". Provider-level kill switches (`auth.provider.apple.enabled`, `auth.provider.google.enabled`) exist as remote config so a broken provider can be hidden without a release. |
| Migration required | Yes — `20260828000009_auth.sql` (the profile/verification tables and signup trigger landed earlier in `20260822000002_identity_tables.sql`): the signup trigger, `profiles` policies, `private.pending_email_changes`, `private.account_deletions`, `private.retired_handles`, and the deletion cron job. |
| Backfill required | No. Greenfield. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A broken provider is disabled by remote config within minutes. A broken deletion pipeline is stopped by disabling the `pg_cron` job, which is safe: pending deletions accumulate and execute late rather than incorrectly. **Late deletion is recoverable; wrong deletion is not**, and the runbook reflects that asymmetry. |
| Client version floor | 1.0.0. First release. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Should the 30-day grace period be shorter (7 days) to reduce the window in which a stalker could restore a victim's account after coercing a deletion? Longer grace protects against regret; shorter protects against coercion. No data either way yet. | Security + Product | Before first store submission |
| Q2 | Do we email the *old* address after a completed email change, or only before? Post-change notice to a mailbox the user may have abandoned is noise; not sending it means a successful takeover is silent to the original owner. | Security | Before first store submission |
| Q3 | `profiles` RLS policy names are established in this spec rather than in [RLS Design §5](../01-architecture/05-rls-design.md), which lists Pattern A tables without naming them. Should the architecture doc absorb these names, or do specs own policy naming for tables they introduce? | Architecture | Before the second spec introduces a table |
| Q4 | Is a 12-character minimum with an HIBP check the right trade against a 15-character minimum with no HIBP dependency? The HIBP call is a third party in the signup path (EC-11). | Security | Post-launch, first 1,000 signups |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering — Auth | Initial spec. Approved with Security sign-off per [Doc Conventions §6](../00-foundation/06-doc-conventions.md). |
| 2026-10-21 | 1.1.0 | Architecture | R36 and R44 now require AAL2 only when a second factor is enrolled (2FA is optional, SPEC-002 R04; otherwise no one without 2FA could delete their account, R43); T25/T28/T34 updated. `request_email_change` treats expired pending rows as absent, is reaped hourly, and returns the neutral response without inserting for a taken address (R39, R40, N02). `profiles` other-user reads and column privileges per [ADR-0022](../01-architecture/adr/ADR-0022-profiles-other-user-reads.md); `rpc.get_my_profile` added |
| 2026-10-21 | 1.0.1 | Architecture | §6 and §14 name the real migration files (`20260822_0002_identity_tables.sql`, `20260828_0009_auth.sql`); no behavioural change |
| 2026-10-22 | 1.2.0 | Engineering — Auth | WP-AUTH-FIX: `private.account_deletions` keeps history with one open row per user (EC-08, T50); §8.3 copy for network, interim rate-limit, invalid reset link, account-status and restore failures; T46–T54 added for the boot deletion gate, reset deep link, sessionless verify, error mapping, provider cancel, per-intent idempotency keys and query-cache single-flight; T19 gains a unit slice |
| 2026-10-22 | 1.2.1 | Architecture | Migration filenames updated to 14-digit versions; SCR-0201. No behavioural change |
