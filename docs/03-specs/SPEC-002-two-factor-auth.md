# SPEC-002: Two-Factor Authentication

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.0 |
| **Owner** | Engineering — Auth |
| **Phase** | MVP |
| **Security review** | required |
| **Schema depends on** | [SPEC-001](SPEC-001-authentication.md) |
| **Behaviourally coupled with** | SPEC-001, SPEC-003 (recovery re-verification) |
| **Related ADRs** | [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md), [ADR-0006](../01-architecture/adr/ADR-0006-auth-providers.md), [ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md), [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

Every Sharecropr account carries a TOTP second factor, because a compromised session here does not leak a shopping history — it leaks the victim's own home coordinates, their message threads, and the time and place at which a real stranger is expecting to meet them. This spec defines enrollment, the ten single-use recovery codes, the AAL2 step-up gate on every security-sensitive operation, the lockout policy, and the deliberately slow human-reviewed path for a user who has lost both their authenticator and their codes. SMS is not in this document because it is not in this product ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md)).

## 2. Goals

- One factor type, implemented once, with no weaker alternative an attacker can pivot to. A fallback factor sets the security level, not the primary one.
- Enrollment that a person who has never installed an authenticator app can complete on the first try, because this step sits in a funnel that already contains ID verification.
- Recovery codes that are actually saved — which means a screen the user cannot skim past, and *not* blocking the screenshot they were always going to take.
- A step-up gate that is enforced in Postgres, in one place (`app.require_aal2`), so the freshness window cannot drift between call sites.
- A lost-everything recovery path that is survivable for the real owner and expensive, slow, and loud for an impostor.
- Honest accounting of the cost: this is the control most likely to lock out an innocent user, and §11 instruments exactly that.

## 3. Non-Goals

- **SMS or voice OTP, in any role.** Not primary, not fallback, not recovery authorization. There is no phone column and adding one requires an ADR ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md)).
- **Email OTP as a factor.** Email is already the password-reset channel; using it as the second factor is one credential wearing two hats. It stays a *notification* channel only.
- **Push-approval ("tap to approve") using our own app.** Push is best-effort in this architecture ([Realtime & Notifications §1](../01-architecture/08-realtime-and-notifications.md)); a factor that depends on best-effort delivery locks people out on a bad network day, and it cannot work for the first sign-in on a new device.
- **Passkeys / WebAuthn.** The likely successor to this entire spec, deferred because GoTrue support is not mature enough for a *mandatory* factor ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md)).
- **Multiple TOTP factors per account.** GoTrue permits several; we cap at one. Two enrolled authenticators means two devices to steal and a "which one is this?" support conversation.
- **Hardware security keys (FIDO2) as a distinct enrolment type.** A user may put TOTP on a hardware token; we do not implement a separate U2F path.
- **Trusted devices / "don't ask again on this device".** It is the single most requested 2FA feature and it converts a second factor into a cookie. Revisit only with device attestation.
- **Support-initiated factor removal.** There is no console button. See R51 — its absence is the control.
- **Per-organisation or admin-enforced 2FA policy.** There are no organisations.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **new gardener**, I want to be told *why* I need an authenticator app before I'm asked to install one, so that the step feels like protection rather than bureaucracy. | P0 |
| US-02 | As a **gardener without an authenticator app**, I want a manual key I can type as well as a QR code, so that I can enroll from the same phone I'm reading the QR on. | P0 |
| US-03 | As a **careful user**, I want ten recovery codes I can save before I finish enrollment, so that a lost phone is an inconvenience and not an eviction. | P0 |
| US-04 | As a **gardener changing my email**, I want to be asked for a code first, so that someone who picks up my unlocked phone cannot take the account. | P0 |
| US-05 | As a **gardener who got a new phone**, I want to use a recovery code to move my authenticator across, so that I'm not filing a support ticket over a handset upgrade. | P0 |
| US-06 | As a **gardener whose phone was stolen along with my printed codes**, I want a way back into my account that does not depend on my attacker's goodwill. | P0 |
| US-07 | As the **real owner of an account someone is trying to steal**, I want to be told a recovery request was filed and be able to kill it with one tap. | P0 |
| US-08 | As a **user in a hurry at a library counter**, I want the exchange flow to *not* ask for a TOTP code, so that I'm not fumbling with two apps in front of a stranger. | P0 |
| US-09 | As a **gardener whose phone clock is wrong**, I want to be told that's the problem rather than seeing "invalid code" five times. | P1 |
| US-10 | As **support**, I want a recovery queue with the hold timer visible, so that I can answer "when will this be done?" without guessing. | P1 |

## 5. Functional Requirements

### 5.1 Factor policy

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | The second factor is TOTP per RFC 6238 with the interoperable profile: HMAC-SHA1, 6 digits, 30-second period. No other algorithm, digit count, or period is offered or accepted. |
| R02 | **MUST NOT** | SMS, voice, or email one-time codes MUST NOT be offered as a factor, as a fallback, or as recovery authorization. No phone-number column exists in any schema ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md)). |
| R03 | **MUST** | A **verified** TOTP factor is a precondition of `app.can_transact()`. A user with no factor may not publish a listing, send an exchange request, or accept one. |
| R04 | **MUST** | Signing in, browsing the map, registering and verifying a garden, building inventory, and reading taxonomy are available with no factor enrolled. The gate is on transacting, not on presence. |
| R05 | **MUST** | Exactly one active TOTP factor exists per account. An enrollment attempt while a verified factor exists returns `conflict` (409). |
| R06 | **MUST NOT** | The TOTP shared secret MUST NOT be written to device storage — not SecureStore, not MMKV, not the query cache, not a log. The device holds enrollment *state* only ([ADR-0007](../01-architecture/adr/ADR-0007-token-storage.md), [Mobile Architecture §5.4](../01-architecture/02-mobile-architecture.md)). |

### 5.2 Enrollment

| ID | Req | Statement |
| --- | --- | --- |
| R07 | **MUST** | The enrollment URI is exactly `otpauth://totp/Sharecropr:{handle}?secret={base32}&issuer=Sharecropr&algorithm=SHA1&digits=6&period=30`. The label carries the handle, never the email address, so a QR screenshot does not disclose the account's mailbox. |
| R08 | **MUST** | Both a QR code **and** the base32 secret in space-separated groups of four are shown, with a copy-to-clipboard action. The manual key is not behind a disclosure triangle — enrolling from the same device the QR is displayed on is the common case, not the exception. |
| R09 | **MUST** | Enrollment completes only after the user submits one code that verifies. An unverified factor is reaped after 10 minutes and leaves no residue. |
| R10 | **MUST** | Factor verification and recovery-code generation happen in one transaction. An account MUST NOT exist in a state where a factor is verified and no recovery codes were issued. |
| R11 | **MUST** | The recovery-code screen cannot be dismissed by back-gesture, back-button, or navigation. It requires an explicit "I've saved these codes" confirmation. |
| R12 | **SHOULD** | A pre-enrollment explainer states, in one screen, what an authenticator app is, why Sharecropr requires one, and names three widely available options without ranking them. |
| R13 | **MUST NOT** | The recovery-code screen MUST NOT set `FLAG_SECURE` or otherwise block screenshots. Users screenshot recovery codes. Blocking it on the one screen they most need to retain produces users with **no** copy of the codes, which is strictly worse than a copy in a photo library. |

### 5.3 Recovery codes — issuance

| ID | Req | Statement |
| --- | --- | --- |
| R14 | **MUST** | Exactly ten codes are issued, each 100 bits of CSPRNG entropy rendered as `xxxxx-xxxxx` in Crockford base32 (no `I`, `L`, `O`, `U`), each single-use. |
| R15 | **MUST** | Codes are stored only as per-code Argon2id hashes with per-code salts in `private.mfa_recovery_codes`. The plaintext exists exactly once, in the response that renders it, and is never written to any store on either side. |
| R16 | **MUST** | Codes are displayed exactly once. No endpoint, screen, support tool, or export re-displays an issued code. The only remedy for a lost set is regeneration, which invalidates the old set. |
| R17 | **MUST** | **A recovery code is a factor-reset token, not a second factor.** Redeeming one unenrolls the TOTP factor and grants the right to enroll a new one. It MUST NOT, by itself, produce an `aal2` claim or satisfy any step-up gate. |

> R17 is the load-bearing design decision in this section. Treating recovery codes as an alternate second factor means an attacker who obtains the printed sheet has permanent, silent, repeatable AAL2 — ten times. Treating them as a reset token means using one is a loud, single-use, factor-destroying event that revokes every other session and emails the owner. The cost is that a recovery code cannot be used to *quickly* do one privileged thing; the user must re-enroll first. That is the correct trade.

### 5.4 Step-up authentication (AAL2)

| ID | Req | Statement |
| --- | --- | --- |
| R18 | **MUST** | A **fresh** AAL2 elevation, no older than 15 minutes, is required for every one of: change email, change password, disable 2FA, regenerate recovery codes, **viewing** the account security screen at all, `request_account_deletion`, deregistering another device, and changing a garden's location ([SPEC-004-R12](SPEC-004-garden-verification.md)). Enforced by `app.require_aal2(interval '15 minutes')` ([API Contract §2.4](../01-architecture/06-api-contract.md)). |
| R19 | **MUST** | Freshness is measured from the most recent `amr` entry with `method IN ('totp','mfa/totp')`, not from the factor's enrollment time. **Enrollment is not elevation.** |
| R20 | **MUST NOT** | Exchange operations — request, accept, decline, schedule, confirm handoff, cancel, rate — MUST NOT require step-up. Asking for a TOTP code at a library counter is a usability failure that drives the meeting off-platform, which is the outcome the whole product exists to prevent. |
| R21 | **MUST** | A user with no enrolled factor who hits an AAL2 gate receives `aal2_required` (403) and is routed into enrollment with the original destination preserved. It is never a dead end. |
| R22 | **MUST** | After a successful challenge the client replays the original mutation with the **original** idempotency key. Minting a new key on replay defeats [API Contract §3.1](../01-architecture/06-api-contract.md). |
| R23 | **MUST** | Every gated RPC calls `app.require_aal2()` as its first statement after argument validation. The client-side modal is UX; it is not the enforcement, and a client that skips it changes nothing. |
| R24 | **SHOULD** | The challenge prompt names the operation it is authorizing ("to change your email address"), so a user who did not initiate it recognises that fact immediately. |

### 5.5 Challenge, drift, and lockout

| ID | Req | Statement |
| --- | --- | --- |
| R25 | **MUST** | Verification accepts the current period ±1, a 90-second total window. No wider. |
| R26 | **MUST NOT** | A code accepted once MUST NOT be accepted again within its validity window. The consumed `(factor_id, counter)` pair is recorded for 90 seconds. |
| R27 | **MUST** | Five failed TOTP attempts within 15 minutes lock challenges for that account for 1 hour. Enforced server-side in GoTrue and reinforced at Kong; never in the client. |
| R28 | **MUST** | Recovery-code redemption has its own bucket: 5 attempts per hour per account, then a 24-hour lock. A shared bucket would let an attacker exhaust the TOTP allowance to deny the owner their codes. |
| R29 | **MUST** | During a lockout, existing valid sessions continue to work. Only new challenges are refused. Locking a signed-in user out of their own in-flight exchange because someone else guessed at their factor is a self-inflicted denial of service. |
| R30 | **MUST NOT** | The failure response MUST NOT distinguish a wrong code from an expired code from a replayed code from an unknown factor. One code, one message. |
| R31 | **SHOULD** | The client compares device time against the response `Date` header on every challenge failure and, above 30 seconds of skew, shows the clock-drift message in §8.3 instead of the generic one. |

### 5.6 Redeeming a recovery code

| ID | Req | Statement |
| --- | --- | --- |
| R32 | **MUST** | Redemption goes through Edge Function `mfa-recovery-code`, running as `service_role`. No client-reachable path reads, compares, or enumerates a code hash. |
| R33 | **MUST** | Redemption performs, in order: constant-time hash match → set `used_at` → unenroll the TOTP factor → revoke every other session and refresh-token family → write `audit.events` → enqueue the security notice email. A failure after the hash match still burns the code. |
| R34 | **MUST** | The redeeming session is `aal1` afterwards and is confined to `/(auth)/mfa-enroll`, sign-out, and the legal pages until a new factor verifies. |
| R35 | **MUST** | For 24 hours after a redemption, `request_email_change`, `request_account_deletion`, and recovery-code regeneration are refused with `recovery_cooldown` (403). The window exists so a hijack is visible to the real owner before it becomes irreversible. |
| R36 | **MUST** | `remaining_codes` is shown on the security screen, and a persistent banner appears at two or fewer remaining. |

### 5.7 Disabling and re-enrolling

| ID | Req | Statement |
| --- | --- | --- |
| R37 | **MUST** | Disabling 2FA requires a fresh AAL2 elevation **and** re-entry of the account password (or a fresh provider re-authentication for OAuth-only accounts). |
| R38 | **MUST** | Disabling immediately makes `app.can_transact()` false. The confirmation copy states this in plain words before the action, not after it. |
| R39 | **MUST** | Disabling invalidates all outstanding recovery codes and revokes every other session. |
| R40 | **MUST** | Re-enrollment mints a fresh secret. A secret that has ever been enrolled for an account is never reissued to that account. |

### 5.8 Recovery when both the device and the codes are lost

> This is the hard case, and it is the case that decides whether this feature is a security control or a churn machine. It is deliberately slow.

| ID | Req | Statement |
| --- | --- | --- |
| R41 | **MUST** | Recovery is never automated. A request enters `private.mfa_recovery_requests` and is decided by a human. There is no threshold of evidence that resolves it without one. |
| R42 | **MUST** | Mailbox control is proven **first**: a request can only be filed by following a one-time link (15-minute expiry) sent to the account's registered address. Typing an email address into a form proves nothing and files nothing. |
| R43 | **MUST** | An accepted request opens a **72-hour hold**. Existing sessions remain valid for the entire hold — the real owner, if they are still signed in anywhere, keeps full use of their account while an impostor waits. |
| R44 | **MUST** | Notices go to the account address at t = 0, +24 h, +48 h, and on completion. Every notice carries a one-tap **"This wasn't me"** link that voids the request immediately and blocks new requests on that account for 30 days. |
| R45 | **MUST** | Authorization requires a **fresh Persona inquiry linked to the original inquiry's account reference**, returning a positive match ([SPEC-003-R50](SPEC-003-identity-verification.md)). Because we hold no document ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)), "same person" is a question only the vendor can answer, and we ask it rather than approximating it. Mailbox control alone is never sufficient. |
| R46 | **MUST** | An account whose `verifications.status` has never been `passed` has **no recovery path**. There is no identity to re-prove. The user is told plainly, at the point of asking, to create a new account. |
| R47 | **MUST** | Recovery re-verification is charged to a separate budget line and does **not** consume `verifications.attempt_count`. A user must not be unable to recover because they once failed KYC four times. |
| R48 | **MUST** | At most two recovery requests per account per rolling 12 months. The third is refused with a support address. |
| R49 | **MUST** | On completion: the factor is removed, all recovery codes are voided, every session and refresh-token family is revoked, and a new enrollment is forced at the next sign-in. |
| R50 | **MUST** | For 7 days after a completed recovery, `request_email_change` and `request_account_deletion` are refused with `recovery_cooldown`. An attacker who wins should still not be able to lock the owner out or destroy the evidence within a week. |
| R51 | **MUST NOT** | Support staff MUST NOT be able to remove a factor. No moderation-console action, no admin RPC, and no `service_role` script outside the reviewed queue path exists. Two named approvers are required on the queue decision, recorded in `audit.events`. |
| R52 | **MUST** | Every state change of a recovery request — filed, held, cancelled by owner, approved, rejected, completed, expired — writes `audit.events` with both approvers where applicable. |
| R53 | **SHOULD** | First human touch on a recovery request within 2 business days, tracked as a queue-age metric with an alert at 20 open requests ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) revisit trigger). |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| `auth.mfa_factors` | read/write via GoTrue only | Factor id, type, status (`unverified`/`verified`), secret. Managed by GoTrue; never queried by application SQL from a client role. |
| `auth.mfa_challenges` | write via GoTrue only | Challenge lifecycle and the `amr` timestamp R19 reads. |
| `public.profiles` | read | `deleted_at`, `is_suspended` consulted by `app.can_transact()`. No column added by this spec. |
| `public.verifications` | read | R45/R46 read `status` and the vendor linkage. Written by [SPEC-003](SPEC-003-identity-verification.md). |
| `private.mfa_recovery_codes` | server-side only | New. Argon2id hashes. |
| `private.mfa_recovery_requests` | server-side only | New. The queue. |
| `private.rate_buckets` | server-side only | R27, R28 buckets ([API Contract §7.1](../01-architecture/06-api-contract.md)). |
| `audit.events` | write (trigger + function) | `mfa.enrolled`, `mfa.disabled`, `mfa.recovery_code_redeemed`, `mfa.codes_regenerated`, `mfa.locked_out`, `mfa.recovery_requested`, `mfa.recovery_cancelled_by_owner`, `mfa.recovery_approved`, `mfa.recovery_rejected`, `mfa.recovery_completed`. |
| `public.notifications` | write | `safety_alert` for recovery-request notices, which are not suppressible ([Data Model §12](../01-architecture/03-data-model.md)). |

**New schema objects introduced by this spec:**

```sql
-- supabase/migrations/0003_mfa.sql

CREATE TABLE private.mfa_recovery_codes (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,               -- argon2id, per-code salt embedded
  batch_id    uuid NOT NULL,               -- regeneration voids a whole batch
  used_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

CREATE INDEX mfa_recovery_codes_live_idx
  ON private.mfa_recovery_codes (user_id) WHERE used_at IS NULL;

-- Exactly ten live codes per batch (R14), asserted rather than assumed.
CREATE UNIQUE INDEX mfa_recovery_codes_batch_uniq
  ON private.mfa_recovery_codes (user_id, batch_id, code_hash);

CREATE TYPE mfa_recovery_state AS ENUM
  ('held','cancelled_by_owner','awaiting_identity','approved','rejected','completed','expired');

CREATE TABLE private.mfa_recovery_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state           mfa_recovery_state NOT NULL DEFAULT 'held',
  filed_at        timestamptz NOT NULL DEFAULT now(),
  hold_expires_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  cancel_hash     text NOT NULL,          -- sha256 of the "This wasn't me" token
  reverify_inquiry_id text NULL,          -- Persona inquiry for R45
  approver_a      uuid NULL,
  approver_b      uuid NULL,              -- two-person rule (R51)
  decided_at      timestamptz NULL,
  completed_at    timestamptz NULL,
  CONSTRAINT two_person CHECK (
    decided_at IS NULL OR (approver_a IS NOT NULL AND approver_b IS NOT NULL
                           AND approver_a <> approver_b))
);

-- At most one live request per user; at most two per rolling 12 months (R48).
CREATE UNIQUE INDEX mfa_recovery_one_live
  ON private.mfa_recovery_requests (user_id)
  WHERE state IN ('held','awaiting_identity','approved');

CREATE INDEX mfa_recovery_queue_idx
  ON private.mfa_recovery_requests (filed_at)
  WHERE state IN ('held','awaiting_identity');

REVOKE ALL ON private.mfa_recovery_codes, private.mfa_recovery_requests
  FROM anon, authenticated, PUBLIC;

-- The client never touches auth.mfa_factors. It reads this instead.
CREATE OR REPLACE FUNCTION app.mfa_status()
RETURNS TABLE (has_totp boolean, enrolled_at timestamptz,
               remaining_codes smallint, in_recovery_cooldown boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, auth, private AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f
                  WHERE f.user_id = auth.uid() AND f.status = 'verified'),
         (SELECT MIN(f.created_at) FROM auth.mfa_factors f
           WHERE f.user_id = auth.uid() AND f.status = 'verified'),
         (SELECT COUNT(*) FROM private.mfa_recovery_codes c
           WHERE c.user_id = auth.uid() AND c.used_at IS NULL)::smallint,
         EXISTS (SELECT 1 FROM audit.events e
                  WHERE e.actor_id = auth.uid()
                    AND e.action = 'mfa.recovery_code_redeemed'
                    AND e.occurred_at > now() - interval '24 hours');
$$;

GRANT EXECUTE ON FUNCTION app.mfa_status() TO authenticated;

-- Used by app.can_transact() (R03).
CREATE OR REPLACE FUNCTION app.has_verified_totp(u uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f
                  WHERE f.user_id = u AND f.status = 'verified');
$$;
GRANT EXECUTE ON FUNCTION app.has_verified_totp(uuid) TO authenticated;
```

> **`app.can_transact()` must be amended.** The definition in [RLS Design §3](../01-architecture/05-rls-design.md) checks profile, verification, and garden state but not the factor. R03 requires adding `AND app.has_verified_totp(u)` to the predicate. That amendment ships in `0003_mfa.sql` and is recorded in §15 Q1.

**PII touched:** `auth.users.email` (P1, notification target only), `auth.mfa_factors.secret` (P0-equivalent — never read by application code, never leaves GoTrue), `private.mfa_recovery_codes.code_hash` (P1, irreversible), `private.mfa_recovery_requests.reverify_inquiry_id` (P1, an opaque vendor reference and nothing more). Classification per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md).

## 7. API

Enrollment and challenge are GoTrue's `auth.mfa.*` surface and are not redefined here. The four things GoTrue cannot do are ours.

### `rpc.get_mfa_status`

**Auth:** `authenticated` (no AAL2 — you must be able to see *whether* you have a factor without using it)
**Rate limit:** 60 / min / user

```jsonc
// Request
{}
// Response 200
{ "has_totp": true, "enrolled_at": "2026-04-11T08:22:10Z",
  "remaining_codes": 8, "in_recovery_cooldown": false }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `unauthenticated` | 401 | No valid JWT |

### `rpc.regenerate_recovery_codes`

**Auth:** `authenticated` + **AAL2** (≤ 15 min)
**Rate limit:** 3 / day / user

```jsonc
// Request
{ "p_idempotency_key": "8f14e45f-ceea-4a2f-9c1e-3d0f5a7b2e91" }
// Response 200 — the only time plaintext codes exist outside the user's hands
{ "codes": ["7K2M9-QX4TB", "…"], "batch_id": "…", "generated_at": "2026-08-08T14:31:02Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `aal2_required` / `aal2_stale` | 403 | Step-up missing or older than 15 minutes |
| `recovery_cooldown` | 403 | Within 24 h of a recovery-code redemption (R35) |
| `request_not_found` | 404 | No verified factor enrolled |
| `rate_limited` | 429 | |

> A replay of the same `p_idempotency_key` returns the **same** codes, because the alternative — a 409 — leaves a user who lost the response with a batch they have never seen. The idempotency row is reaped after 7 days ([API Contract §3.1](../01-architecture/06-api-contract.md)).

### Edge Function `mfa-recovery-code`

**Invoked by:** client, from the challenge screen
**Auth:** a valid `aal1` session for the account. **Not** `service_role`-callable from a client.
**Rate limit:** 5 / hour / user, then a 24-hour lock (R28)

```jsonc
// Request
{ "code": "7K2M9-QX4TB", "idempotency_key": "…" }
// Response 200
{ "factor_removed": true, "sessions_revoked": 3, "next": "mfa_enroll" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Malformed code shape. **Identical body to a wrong code** (R30) |
| `not_authorized` | 403 | Code unknown, already used, or from a voided batch — same body as above |
| `rate_limited` | 429 | Bucket empty or 24-hour lock active; `Retry-After` set |

### Edge Function `mfa-recovery-request`

**Invoked by:** the emailed one-time link (R42), unauthenticated at the point of landing
**Rate limit:** 3 / day / address at Kong, 2 / 12 months / account (R48)

Flow: address → one-time link (15 min) → request filed → 72-hour hold → Persona re-verification ([SPEC-003](SPEC-003-identity-verification.md)) → two-person approval → completion. States mirror `mfa_recovery_state`.

| Error code | HTTP | When |
| --- | --- | --- |
| `conflict` | 409 | A live request already exists |
| `quota_exceeded` | 422 | Third request in 12 months, or a 30-day block from an owner cancellation |
| `not_verified` | 403 | `verifications.status` has never been `passed` (R46) — terminal, with support copy |

### Edge Function `mfa-recovery-cancel`

**Invoked by:** the "This wasn't me" link in any notice. Token is a single-use SHA-256 preimage; the hash is `mfa_recovery_requests.cancel_hash`.
**Auth:** the token itself. No session required — the owner may be locked out of everything *except* their mailbox, which is exactly the case this serves.

```jsonc
// Response 200
{ "cancelled": true, "blocked_until": "2026-09-07T14:31:02Z" }
```

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Why 2FA | `/(auth)/mfa-intro` | One-screen explainer, authenticator app suggestions |
| Enroll | `/(auth)/mfa-enroll` | QR + manual key + verify field |
| Recovery codes | `/(auth)/mfa-recovery-codes` | Displayed once; undismissable without confirmation |
| Challenge | `/(auth)/mfa-challenge` | Sign-in challenge; "Use a recovery code" secondary action |
| Step-up modal | presented over any route | The 15-minute elevation, with the operation named |
| Security settings | `/(tabs)/profile/security` | AAL2-gated. Factor state, remaining codes, regenerate, disable |
| Lost everything | `/(auth)/mfa-lost-access` | Files a recovery request; explains the 72-hour hold before asking for anything |
| Recovery status | `/(auth)/mfa-recovery-status` | Hold countdown, current state, cancel action |

### 8.2 States

| State | Behaviour |
| --- | --- |
| **Loading** | The verify button shows an inline spinner and disables; the six-digit field stays editable so a user who mistyped can correct while the request is in flight. QR generation is local and synchronous — there is no spinner for it, because a spinner where a QR should be reads as a broken camera. Recovery-request status polls at 30 s with the previous state still rendered, never a skeleton over known data. |
| **Empty** | Security settings with no factor: a single explanatory card and an "Set up two-factor authentication" primary action — not an empty list. Recovery codes at zero remaining: the count is replaced by the regenerate action and the persistent banner from R36, so there is no "0 codes" dead state. |
| **Error (recoverable)** | Wrong code, expired code, clock skew, network failure: inline message under the code field, field cleared and refocused, keypad retained, button re-enabled. Attempt counter shown from the third failure onward ("2 attempts left"). Never a toast — the user must act, and the code field must be visible while they read the message. |
| **Error (terminal)** | Recovery request rejected, 30-day block from an owner cancellation, `verifications.status` never `passed` (R46), or a third request in 12 months: full-screen state naming the reason, a `support@sharecropr.app` mail link, and — for R46 only — a "Create a new account" action. No retry button, because retrying cannot succeed. |
| **Offline** | Challenge and enrollment verification are disabled behind a persistent banner; both require a live server and queuing an authentication attempt is meaningless. The **QR code and the manual key remain readable offline** once fetched, so a user in a basement can still add the account to their authenticator and verify when they surface. An existing valid session opens the app normally. |
| **Permission denied** | No OS permission is involved in this feature. Camera is not used — we display a QR, we never scan one. If a future flow adds camera-based transfer, that state belongs to that spec. Clipboard denial (Android 13+ restricted paste) falls back to a long-press-to-select field with a live-region announcement, never a silent no-op. |
| **Rate limited** | The verify button is disabled for exactly `Retry-After` seconds with a live countdown in its label ("Try again in 58:12"). No auto-retry. During the 1-hour TOTP lock (R27) the "Use a recovery code" action stays **enabled**, because the buckets are independent (R28) and the alternative is an hour of nothing. During the 24-hour recovery-code lock, the "Lost access to everything?" action stays enabled. |

### 8.3 Copy

Exact strings. Anything not listed here is a spec gap and must be added before implementation.

**Enrollment**

| Condition | Copy |
| --- | --- |
| Intro title / body | `One more layer` / `Sharecropr accounts hold your garden's location and the times you've agreed to meet people. A second factor means a stolen password isn't enough to reach any of that. You'll need an authenticator app — most people use Google Authenticator, Microsoft Authenticator, or 1Password.` |
| Enroll title | `Add Sharecropr to your authenticator` |
| Manual key label | `Or enter this key manually` |
| Key copied | `Key copied.` |
| Verify prompt | `Enter the 6-digit code from your app` |
| Verify success | `Two-factor authentication is on.` |
| Already enrolled | `You already have an authenticator set up. Remove it first if you want to use a different one.` |
| Abandon confirm | `Leave without finishing? You'll need to start this step again before you can trade.` |

**Recovery codes**

| Condition | Copy |
| --- | --- |
| Title | `Save these recovery codes` |
| Body | `These ten codes are the only way back in if you lose your phone. Each one works once. We can't show them to you again — if you lose them, you'll have to prove who you are all over again, and that takes three days.` |
| What a code does | `A recovery code doesn't sign you in on its own. It removes your current authenticator so you can set up a new one, and it signs you out everywhere else.` |
| Confirm checkbox | `I've saved these somewhere I can get to without this phone` |
| Confirm button | `Done` |
| Codes copied | `All ten codes copied.` |
| Regenerate warning | `Generating new codes cancels the ten you have now, even the ones you haven't used.` |
| Low codes banner | `{n} recovery code(s) left. Generate a new set before you run out.` |

**Challenge and failures**

| Condition | Copy |
| --- | --- |
| Challenge prompt | `Enter the code from your authenticator app` |
| Step-up prompt | `Enter your code to confirm this change` |
| Step-up prompt, named | `Enter your code to change your email address.` |
| Wrong / expired / replayed code (one message, R30) | `That code didn't work. Codes change every 30 seconds — try the current one.` |
| Attempts remaining | `{n} attempt(s) left before a one-hour pause.` |
| Locked out | `Too many attempts. Try again in {mm:ss}, or use a recovery code.` |
| Recovery-code bucket locked | `Too many recovery code attempts. Try again in {hh:mm}.` |
| Clock drift (R31) | `Your phone's clock is off by about {n} minutes, which breaks these codes. Turn on automatic date and time in Settings, then try again.` |
| Secondary action | `Use a recovery code` |
| Offline | `You're offline. Checking a code needs a connection.` |

**Recovery code redemption**

| Condition | Copy |
| --- | --- |
| Prompt | `Enter one of your recovery codes` |
| Success | `Recovery code accepted. Your old authenticator has been removed and you've been signed out on other devices. Set up a new one now.` |
| Cooldown block | `You used a recovery code in the last 24 hours. For your safety, this change is paused until {time}.` |

**Disabling**

| Condition | Copy |
| --- | --- |
| Title | `Turn off two-factor authentication` |
| Body | `You'll stop being able to publish listings or arrange exchanges until you turn it back on. Your recovery codes will stop working and you'll be signed out on other devices.` |
| Confirm | `Turn it off` |
| Password prompt | `Enter your password to confirm` |

**Lost access to everything**

| Condition | Copy |
| --- | --- |
| Entry point | `Lost your phone and your codes?` |
| Explainer body | `We can get you back in, but not quickly. Here's what happens: we email a link to {masked_email}, then we hold the account for 72 hours, then you verify your identity again with the same document you used before. If someone else started this, the emails give you a one-tap way to stop it.` |
| No KYC on file (R46) | `This account never completed identity verification, so there's nothing for us to check against. We can't recover it. You're welcome to start a new account — your handle will be released in 12 months.` |
| Filed | `Request received. We've emailed {masked_email}. The hold ends {date} at {time}.` |
| Hold in progress | `Holding your account until {date}. Nothing changes until then.` |
| Identity step | `Last step: verify your identity with the same document you used before.` |
| Rejected | `We couldn't confirm this was your account. Email support@sharecropr.app if you think that's wrong.` |
| Quota exceeded | `You've already recovered this account twice this year. Email support@sharecropr.app.` |
| Owner cancel notice (email subject) | `Someone is trying to get into your Sharecropr account` |
| Owner cancel notice (body) | `A request was made to reset the authenticator on your Sharecropr account. If that was you, nothing to do — we'll continue on {date}. If it wasn't, tap here to stop it. We'll also block new requests for 30 days.` |
| Owner cancelled | `Stopped. No one can request this again for 30 days.` |

**Empty states**

| Screen | Copy |
| --- | --- |
| Security settings, no factor | `Two-factor authentication is off. You'll need it before you can trade.` |
| Recovery status, nothing pending | `No recovery request in progress.` |

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Use the recovery path as the front door. Every 2FA system's weakest point is the "I lost my factor" flow, and ours is the one place where a human being makes a judgement call under support pressure. The concrete attack: an attacker with the victim's password and mailbox access files a recovery request, waits 72 hours, and presents a forged or stolen document to Persona. R42 (mailbox-first) does not stop it, which is why R45 (vendor-linked re-verification against the *original* inquiry), R43 (72-hour hold with sessions intact), R44 ("This wasn't me" in four separate emails), and R51 (two-person approval, no support button) all exist as independent layers. Second-worst: obtaining the printed recovery sheet and using it as a silent, repeatable AAL2 — which R17 structurally prevents by making a code destroy the factor and revoke every session, turning a silent capability into a loud event. Third: brute-forcing a six-digit code, bounded by R27 to 5 attempts per 15 minutes, giving an attacker roughly 1 in 3,000 odds per hour against a one-hour lockout. |
| **Which RLS policies enforce access?** | None, in the usual sense — and that is the point. `private.mfa_recovery_codes` and `private.mfa_recovery_requests` have **no policies at all** because they have no grants at all: `REVOKE ALL … FROM anon, authenticated, PUBLIC`, and `private` is absent from PostgREST's `db-schemas`. A table no client role can reach cannot be leaked by a missing policy ([RLS Design §1](../01-architecture/05-rls-design.md)). `auth.mfa_factors` is GoTrue's and is likewise ungranted. The only client-reachable surface is `app.mfa_status()` and `app.has_verified_totp(uuid)`, both `SECURITY DEFINER` with pinned `search_path`, both hard-filtered on `auth.uid()` with no parameter that could name another user. `app.require_aal2(interval)` is the single enforcement point for R18. |
| **Can any response path expose an exact coordinate or PII?** | No coordinate: nothing in this spec reads `private.garden_locations` and no return type here has a column that could hold a point ([API Contract §9](../01-architecture/06-api-contract.md)). PII: the recovery flow displays the account address **masked** (`p***a@e***.org`) on every screen and in the notice bodies, because an attacker who reaches `/(auth)/mfa-lost-access` with only a handle must not learn the full address. `reverify_inquiry_id` is an opaque vendor reference; it is never rendered to a user. Recovery-code plaintext appears in exactly one response body and is excluded from request/response logging by an explicit allowlist rule on `mfa-recovery-code` and `regenerate_recovery_codes`. |
| **What is logged, and is it scrubbed?** | `audit.events` records the ten `mfa.*` actions in §6 with actor id, timestamp, request id, and — for recovery decisions — both approver ids. It never records a code, a code hash, a secret, an `otpauth` URI, or an email address. Sentry's `beforeSend` redacts any string matching a 6-digit-code pattern adjacent to a `code`/`otp`/`totp` key, any `xxxxx-xxxxx` recovery-code shape, any base32 run of 16+ characters, and anything matching an email or JWT pattern. GoTrue's own logs carry email addresses on challenge events; retention is 30 days and access is restricted. **The QR image is generated on-device and never transmitted**, so it cannot appear in a network trace. |
| **Does this need step-up authentication?** | This feature *is* step-up. R18 enumerates the eight gated operations; R19 makes freshness the property that matters; R23 puts enforcement in Postgres. Deliberately **not** gated: viewing `get_mfa_status` (you must be able to learn whether you have a factor without using it), redeeming a recovery code (the whole point is that you cannot produce a factor), `mfa-recovery-cancel` (the owner may have lost everything except their mailbox, and making the *safe* direction harder than the dangerous one is backwards), and every exchange operation (R20). |
| **Abuse / rate-limit controls** | TOTP challenge 5 / 15 min per user then a 1-hour lock (GoTrue + Kong). Recovery-code redemption 5 / hour per user then a 24-hour lock, on an independent bucket. `regenerate_recovery_codes` 3 / day per user. `mfa-recovery-request` 3 / day per address at Kong and 2 per 12 months per account. Owner cancellation blocks new requests for 30 days. Enrollment 10 / day per user, so an attacker cannot use unverified-factor churn to spam a victim's authenticator list. The 72-hour hold is itself the primary abuse control on the recovery path: it converts a fast attack into a slow one the victim can see. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | User scans the QR, then kills the app before entering a code. | The factor stays `unverified` and is reaped at 10 minutes (R09). Their authenticator now shows a Sharecropr entry that will never work. The enroll screen's abandon-confirm copy warns about this; on re-entry we mint a **new** secret rather than resurrecting the old one, and the copy tells them to delete the stale entry. Not resurrecting is deliberate: matching a half-enrolled secret to a returning session is a correctness problem with an account-takeover shape. |
| EC-02 | User enrolls on a device whose clock is 4 minutes fast. | Every code fails. R31's drift check fires on the first failure and shows the clock message rather than "wrong code", which is the difference between a Settings toggle and a support ticket. We do **not** widen the acceptance window to compensate — a wider window is a permanent security cost paid for a transient device problem. |
| EC-03 | User completes enrollment but force-quits on the recovery-code screen before confirming. | The codes were generated in the same transaction as verification (R10) and are already hashed. They are now unrecoverable — the user has a working factor and zero codes they have seen. On next launch the security screen shows the low-codes banner at 10-of-10 unseen, and the app prompts a regeneration. This is the single most likely way a user ends up in §5.8, and it is why R11 makes the screen undismissable by gesture. |
| EC-04 | User redeems a recovery code, then loses the phone again before enrolling the new factor. | Their session is `aal1` and confined to `/(auth)/mfa-enroll` (R34), and they have nine codes left. Redeeming a second one is permitted — the bucket is 5 per hour (R28), not one per lifetime. Each redemption re-revokes sessions and re-emails. |
| EC-05 | Attacker with the victim's password signs in and immediately files a recovery request. | They cannot: R42 requires following a link sent to the victim's mailbox, which a password does not grant. If they *also* hold the mailbox, the 72-hour hold begins and the victim's existing sessions keep working (R43) — the victim's app is fully functional and receives a `safety_alert` notification, which ignores quiet hours and cannot be disabled ([Data Model §12](../01-architecture/03-data-model.md)). |
| EC-06 | The victim taps "This wasn't me" at hour 71. | The request voids immediately, new requests are blocked for 30 days (R44), an `audit.events` row is written, and the security screen shows a persistent notice recommending a password change. The 30-day block is deliberately blunt: a legitimate owner who cancelled by mistake must email support, and that is the correct direction to be wrong in. |
| EC-07 | Persona is unavailable during the identity step of a recovery. | The request sits in `awaiting_identity`; the hold does not restart and does not expire while the vendor is down. Copy: `Identity checks are temporarily unavailable. Your request is still open — we'll email you when you can continue.` Mirrors the `pending_vendor` degradation in [SPEC-003-R37](SPEC-003-identity-verification.md). |
| EC-08 | User has 2FA enrolled and completes a password reset ([SPEC-001-R33](SPEC-001-authentication.md)). | The TOTP challenge still applies. A reset proves mailbox control, not possession of the factor, and the two must remain independent or the second factor is decorative. |
| EC-09 | Two devices submit the same six-digit code within the same 30-second period. | The first succeeds; the second is refused by the replay guard (R26) with the standard failure message. The user on the second device sees "that code didn't work" and enters the next one. Annoying, correct, and preferable to a code that can be replayed off a shoulder-surf. |
| EC-10 | User disables 2FA while holding an accepted exchange with a scheduled meeting. | `app.can_transact()` goes false immediately (R38), so they cannot create new requests or listings — but `cancel_session`, `confirm_handoff`, and `submit_rating` remain available, because [API Contract §5.4](../01-architecture/06-api-contract.md) exempts the exit paths. You can always finish or get out of an exchange you are already in. Leaving a real person waiting in a library lobby because of a settings change is not an acceptable failure mode. |
| EC-11 | Recovery completes for an account that is mid-way through an in-flight exchange. | The exchange is untouched, but the counterparty is not told (telling them would disclose a security event about another user). Instead, the recovered account's in-flight sessions are flagged to moderation for the 7-day cooldown window (R50), so a genuine takeover followed by a meeting is visible to a human before it happens. |
| EC-12 | An App Store reviewer account hits the mandatory-2FA gate. | Reviewers must enroll like anyone else. The KYC bypass in `private.review_bypass_accounts` ([SPEC-003-R28](SPEC-003-identity-verification.md)) does **not** bypass 2FA, because a TOTP enrollment costs the reviewer thirty seconds and an authenticator app they already have, whereas a driving licence is a genuine blocker. The submission checklist includes enrolling the reviewer account and recording its recovery codes ([Release & Store Submission](../05-operations/03-release-and-store-submission.md)). |
| EC-13 | GoTrue returns a factor in `verified` state but the recovery-code insert fails. | R10 makes this impossible in the happy path — both happen in one transaction — but GoTrue's factor write is an admin API call, not a SQL statement, so the true boundary is one call plus one transaction. On transaction failure the function immediately unenrolls the factor and returns `server_error`. Fail-closed: no factor is better than a factor with no codes. A reconciliation job asserts nightly that every `verified` factor has ≥ 1 live code row and alerts on any exception. |
| EC-14 | User regenerates codes twice in quick succession and saves the first set. | The second regeneration voids batch one entirely (R17 batch semantics), including unused codes. The regenerate confirmation copy states this before the action. The idempotency rule means an accidental double-tap returns the *same* batch rather than silently invalidating the sheet the user just wrote down. |
| EC-15 | A user's account is suspended while a recovery request is on hold. | The hold continues and the request can complete. Suspension is a moderation state; it does not suspend the right to control your own account, and a suspended user must still be able to reach `request_account_deletion` ([SPEC-001-R28](SPEC-001-authentication.md)) — which requires AAL2, which requires the factor. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `mfa.enroll_started` | PostHog | `entry_point` (`onboarding`\|`transact_gate`\|`settings`) | — |
| `mfa.enroll_completed` | PostHog + `audit.events` | `ms_to_complete`, `used_manual_key` (bool) | — |
| `mfa.enroll_abandoned` | PostHog | `last_step` (`intro`\|`qr`\|`verify`\|`codes`) | **Enrollment drop-off > 20%** of users who reach `/(auth)/mfa-intro` — the primary [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) revisit trigger |
| `mfa.codes_screen_confirmed` | PostHog | `dwell_ms`, `copied` (bool) | `dwell_ms` p50 < 4 s → the screen is being dismissed unread; escalate to design |
| `mfa.challenge_failed` | Metric | `reason` (`invalid`\|`replayed`\|`locked`), `clock_skew_bucket` | `clock_skew_bucket > 30s` on > 3% of failures → investigate a platform time bug |
| `mfa.locked_out` | `audit.events` + metric | — | > 0.5% of DAU in 24 h → the window or the copy is wrong |
| `mfa.recovery_code_redeemed` | `audit.events` + metric | `codes_remaining_after` | **> 2% of active accounts per month** — [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) revisit trigger |
| `mfa.codes_regenerated` | `audit.events` | `trigger` (`low`\|`manual`\|`post_recovery`) | — |
| `mfa.recovery_requested` | `audit.events` + metric | `had_kyc` (bool) | Any spike > 5× the 7-day baseline in 1 h → possible coordinated takeover, page security |
| `mfa.recovery_cancelled_by_owner` | `audit.events` | `hours_into_hold` | **Any occurrence** → a real takeover attempt was caught; review the account and the source |
| `mfa.recovery_completed` | `audit.events` | `hours_to_complete`, `approver_a`, `approver_b` | — |
| `mfa.recovery_queue_age` | Metric | `p50`, `max`, `open_count` | **Open count > 20**, or median staff effort > 30 min/request — [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) revisit trigger |
| `mfa.recovery_reverify_spend` | Metric (monthly) | `usd` | **> $200 / month** — couples directly to [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) unit economics |
| `mfa.aal2_challenge_shown` | PostHog | `operation` | — |
| `mfa.aal2_challenge_abandoned` | PostHog | `operation` | > 25% abandonment on any single operation → that gate's cost exceeds its benefit; reopen R18 |
| `mfa.factor_without_codes` | Reconciliation metric | `count` | **Any occurrence** (EC-13) — pages on-call |

## 12. Accessibility

- The six-digit field uses `textContentType="oneTimeCode"` / `autoComplete="sms-otp"` equivalents so the OS offers the code from the authenticator app's clipboard hand-off. Autofill is an accessibility feature before it is a convenience.
- The field is a **single** input with `maxLength={6}`, not six boxed inputs. Segmented OTP inputs break VoiceOver's character navigation, break paste on Android, and break external keyboards.
- The manual base32 key is rendered in a monospace face, grouped in fours, and exposed to screen readers with an `accessibilityLabel` that spells it phonetically (`accessibilityLabel="J A 3 K, space, 7 M 2 Q, ..."`), because a screen reader reading `JA3K7M2Q` as a word is unusable.
- The QR code carries `accessibilityRole="image"` and an `accessibilityLabel` of `QR code for setting up two-factor authentication. If you can't scan it, the manual key is below.` A QR with no alternative is a wall.
- Recovery codes are announced individually with `accessibilityLabel="Code 3 of 10, 7 K 2 M 9, dash, Q X 4 T B"`, and the "Copy all" button is the first focusable element after the heading — for a screen-reader user, copying is the realistic save path.
- Countdown timers (lockout, hold, cooldown) are `accessibilityLiveRegion="polite"` and announce at 60 s, 30 s, and 0 s only. Announcing every second is unusable.
- Error text is announced via `AccessibilityInfo.announceForAccessibility` on appearance, associated with the field through `accessibilityLabelledBy` and `accessibilityInvalid`. Colour is never the only error signal.
- The undismissable recovery-code screen (R11) sets `accessibilityViewIsModal` and traps focus, with the confirmation checkbox reachable by keyboard and switch control. An undismissable screen that a switch-control user cannot complete is a lockout we built ourselves.
- Every tappable target — copy buttons, "Use a recovery code", the checkbox — is ≥ 44 × 44 dp ([Mobile Architecture §10.3](../01-architecture/02-mobile-architecture.md)).
- Full flow verified at 200% dynamic type on both platforms. The recovery-code list scrolls; no fixed-height container holds ten codes.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | unit | R01 | A code generated with SHA-256, 8 digits, or a 60 s period is rejected; the SHA-1/6/30 profile is accepted. |
| T02 | integration | R02 | No GoTrue MFA factor of type `phone` can be enrolled; grep asserts no `phone` column in any migration and no SMS provider config. |
| T03 | rls | R03 | `app.can_transact()` returns false for a verified, garden-verified, unsuspended user with **no** factor; true once a factor verifies. |
| T04 | e2e | R04 | A signed-in user with no factor reaches the map, opens a safe-spot sheet, registers a garden, and adds an inventory item. |
| T05 | integration | R05 | Second enrollment attempt with a verified factor present returns `conflict` 409. |
| T06 | unit | R06 | Grep the SecureStore adapter, MMKV cache, and query-cache persister for any key matching `/secret\|totp\|otpauth/i`; a synthetic enrollment leaves no matching key on disk. |
| T07 | unit | R07 | The generated URI matches the exact string in R07, with the handle and not the email in the label. |
| T08 | e2e | R08 | Both the QR and the grouped manual key render without expanding a disclosure; the copy button places the ungrouped secret on the clipboard. |
| T09 | integration | R09 | A factor left unverified is absent from `auth.mfa_factors` at 10 min + 1 s. |
| T10 | integration | R10 | Injected failure in the code-insert path leaves zero verified factors — assert both `auth.mfa_factors` and `private.mfa_recovery_codes` are empty. |
| T11 | e2e | R11 | Android back-button and iOS back-gesture on `/(auth)/mfa-recovery-codes` do not navigate; only the confirmation advances. |
| T12 | e2e | R13 | Screenshot succeeds on the recovery-code screen on both platforms; assert `FLAG_SECURE` is unset. |
| T13 | unit | R14 | 10 codes; each decodes to ≥ 100 bits; alphabet excludes `I L O U`; 100k generated codes have no collision. |
| T14 | integration | R15 | Only Argon2id hashes exist in `private.mfa_recovery_codes`; a plaintext code does not appear in any table, log, or WAL sample. |
| T15 | integration | R16 | No endpoint returns an issued code after the generating response; `regenerate_recovery_codes` replay returns the same batch, a *new* call returns a different one. |
| T16 | integration | R17 | Redeeming a code yields an `aal1` session with no factor; calling an AAL2-gated RPC immediately after returns `aal2_required`. |
| T17 | integration | R18 | Each of the eight gated operations returns `aal2_required` without elevation and succeeds with a ≤ 15-minute-old TOTP `amr`. |
| T18 | integration | R19 | A session that enrolled a factor 2 hours ago but has never challenged returns `aal2_stale` on a gated call. |
| T19 | integration | R20 | All nine exchange RPCs in [API Contract §5.4](../01-architecture/06-api-contract.md) succeed at `aal1`. |
| T20 | e2e | R21 | A factorless user tapping "Change email" lands on `/(auth)/mfa-enroll` and, after enrolling, arrives back at the email-change screen. |
| T21 | integration | R22 | The replayed mutation carries the identical `idempotency_key`; a mutated key is asserted absent. |
| T22 | rls | R23 | Static check: every RPC in the R18 list contains `app.require_aal2` before any `INSERT`/`UPDATE`. CI fails on a new gated RPC without it. |
| T23 | unit | R25 | Codes at t−30 s and t+30 s verify; t−60 s and t+60 s do not. |
| T24 | integration | R26 | The same code submitted twice within one period: first accepted, second refused. |
| T25 | integration | R27 | 5 failures in 15 min → 6th returns 429 with `Retry-After` ≈ 3600; a valid code during the lock also returns 429. |
| T26 | integration | R28 | TOTP bucket exhausted; recovery-code redemption still succeeds. Recovery bucket exhausted at 5/hour → 24-hour lock. |
| T27 | integration | R29 | During a lockout, an existing access token still reads `/rest/v1/inventory_items` successfully. |
| T28 | integration | R30 | Wrong, expired, replayed, and unknown-factor responses are byte-identical in status and body. |
| T29 | integration | R32 | No `authenticated`-callable RPC or PostgREST path references `private.mfa_recovery_codes`; `anon` and `authenticated` have zero privileges on it. |
| T30 | integration | R33 | After redemption: `used_at` set, factor gone, other sessions 401, one `audit.events` row, one queued notification — asserted in that order. |
| T31 | e2e | R34 | Post-redemption navigation to `/map`, `/inventory`, and `/profile` all redirect to `/(auth)/mfa-enroll`. |
| T32 | integration | R35 | `request_email_change`, `request_account_deletion`, and `regenerate_recovery_codes` all return `recovery_cooldown` 403 at redemption + 23 h, and succeed at + 25 h. |
| T33 | e2e | R36 | Security screen shows `8` after two redemptions; the banner appears at 2. |
| T34 | integration | R37 | Disable with valid AAL2 but wrong password fails; with both, succeeds. |
| T35 | rls | R38 | `app.can_transact()` false immediately after disable; a `listings` INSERT returns `not_verified` 403. |
| T36 | integration | R39 | After disable, zero live rows in `private.mfa_recovery_codes` and all other sessions 401. |
| T37 | integration | R40 | Re-enrollment secret differs from the previous one across 100 enroll/disable cycles. |
| T38 | integration | R41 | No code path sets `state = 'completed'` without two distinct approver ids — enforced by the `two_person` CHECK. |
| T39 | e2e | R42 | Submitting an address on `/(auth)/mfa-lost-access` creates no row; only following the emailed link does. |
| T40 | integration | R43 | Approval attempted at hold + 71 h is refused; sessions issued before the request still authenticate throughout. |
| T41 | integration | R44 | Four notices are enqueued at the specified offsets; the cancel token in each is single-use and voids the request. |
| T42 | integration | R45 | Completion is refused when the Persona re-verification is unlinked from the original account reference or returns a negative match. |
| T43 | integration | R46 | A recovery request for a user with `verifications.status = 'unstarted'` returns `not_verified` 403 and creates no row. |
| T44 | integration | R47 | `verifications.attempt_count` is unchanged across a completed recovery re-verification. |
| T45 | integration | R48 | Third request within 12 months returns `quota_exceeded` 422. |
| T46 | integration | R49 | Post-completion: no factor, zero live codes, all refresh-token families revoked, next sign-in lands on enrollment. |
| T47 | integration | R50 | Email change and deletion refused at completion + 6 days, permitted at + 8 days. |
| T48 | integration | R51 | No moderation-console route, RPC, or Edge Function removes a factor outside the queue path — asserted by a route-manifest and migration grep. |
| T49 | integration | R52 | Each of the seven recovery state transitions writes exactly one `audit.events` row with the expected `action`. |
| T50 | manual | R12, R24, R31, R53 | Reviewed on-device; see §13.3. |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| N01 | Brute-force a 6-digit code with 10,000 attempts from 200 IPs against one account. | Locked after 5 (R27) regardless of source IP, because the bucket is keyed on `user_id`, not IP. Kong's IP limit is the second layer, not the first. `mfa.locked_out` alert fires. |
| N02 | Replay a captured valid code within its 30-second window from a second device. | Refused by R26's consumed-counter record. Verified by capturing the code server-side and resubmitting at t+2 s. |
| N03 | Hand-edit the JWT `aal` claim to `aal2` and call `request_email_change`. | Rejected at Kong: the JWT is RS256-signed and an edited claim fails verification before reaching PostgREST. |
| N04 | Present a genuine `aal2` claim whose TOTP `amr` timestamp is 3 hours old. | `aal2_stale` 403 (R19). Enrollment is not elevation and neither is yesterday's challenge. |
| N05 | Enroll a factor, never challenge, then call every R18 operation. | All eight return `aal2_stale`. Asserted individually — a single loop passing eight times is not eight tests. |
| N06 | Call `rpc.regenerate_recovery_codes` for another user by adding a `p_user_id` parameter. | No such parameter exists in the signature; PostgREST rejects unknown named arguments. The function operates on `auth.uid()` only. |
| N07 | Read `private.mfa_recovery_codes` through a PostgREST embed (`select=*,codes:mfa_recovery_codes(*)`). | `private` is not in PostgREST's `db-schemas`; the relation is not resolvable. Also asserted: zero grants to `anon` and `authenticated`. |
| N08 | Enumerate valid recovery codes by timing the `mfa-recovery-code` response for known-bad vs. known-good prefixes. | Argon2id verification runs against a dummy hash when no row matches, and the function pads to a fixed floor. Timing distributions for valid-shape-invalid-code and valid-code are statistically indistinguishable (Mann-Whitney p > 0.05). |
| N09 | Redeem the same recovery code twice concurrently from two clients. | `UPDATE … SET used_at = now() WHERE used_at IS NULL` under `FOR UPDATE`; exactly one succeeds, the other gets the standard `not_authorized`. Run at 50-way concurrency. |
| N10 | File a recovery request by POSTing directly to `mfa-recovery-request` with a victim's user id. | The function derives the subject from the one-time link token exclusively; there is no user-id parameter. A forged body creates nothing. |
| N11 | Replay a captured "This wasn't me" cancel token to void a *later*, legitimate request. | Tokens are single-use and bound to a specific `request_id` via `cancel_hash`; the hash row is deleted on use. |
| N12 | Complete a recovery with a Persona inquiry that passed for a *different* person. | Refused (R45): the inquiry must be linked to the original inquiry's Persona account reference. A fresh, unlinked pass is not sufficient. |
| N13 | Use the recovery path to escalate on an account that never did KYC. | `not_verified` 403 (R46). The most important negative result in this spec: there is no evidence we could weigh, so we refuse rather than improvise. |
| N14 | Social-engineer support into removing a factor. | There is no button (R51). Verified by a route-manifest and migration grep in CI, and by a scripted red-team support request in the quarterly exercise. |
| N15 | Approve a recovery request as a single staff member by supplying the same id twice. | `two_person` CHECK rejects `approver_a = approver_b`. |
| N16 | Exhaust the TOTP bucket deliberately to deny the owner their recovery codes. | Independent buckets (R28): the recovery-code path remains available for its full 5/hour. |
| N17 | Screenshot-scrape the enrollment QR from a Sentry attachment or a network trace. | The QR is rendered on-device from the URI; it is never uploaded. The URI itself is redacted by the `otpauth`/base32 scrubber rules. Verified by firing a synthetic Sentry event containing an `otpauth://` string and asserting its absence in the payload. |
| N18 | Disable 2FA from a briefly unattended, unlocked, signed-in phone. | Requires AAL2 **and** the password (R37). An unlocked phone alone is not enough; the attacker needs the authenticator that is on the same phone *plus* the password. The residual risk — a phone unlocked with the authenticator on it and the password in its manager — is stated honestly in §15 Q3. |
| N19 | Register a second TOTP factor as a persistent backdoor after a takeover. | Refused (R05): one active factor per account. A second enrollment returns `conflict`. |
| N20 | Downgrade attack: strip the `mfa` requirement by calling `app.can_transact()` with a spoofed `u` argument for another user. | The parameter defaults to `auth.uid()`; passing another id is permitted by the signature but the function's `EXISTS` clauses evaluate that user's real state — it answers a question about *them*, and grants nothing to the caller. Policies always call it with the default. Asserted as a pgTAP negative. |
| N21 | Flood a victim's mailbox with recovery notices as harassment. | 3 / day per address at Kong and 2 per 12 months per account; the 4th produces no email. Owner cancellation adds a 30-day block. |
| N22 | Time the `mfa-recovery-request` response to learn whether an address has a Sharecropr account. | The response is `{"status":"link_sent"}` for every syntactically valid address, with a fixed-floor delay. Same oracle discipline as [SPEC-001-R29](SPEC-001-authentication.md). |
| N23 | Recover an account during its 30-day deletion grace to reverse the deletion silently. | Recovery completes, but `cancel_account_deletion` is a separate, deliberate action shown on the restore screen ([SPEC-001-R47](SPEC-001-authentication.md)). Recovery does not implicitly restore, and the deletion schedule survives it. |
| N24 | Extract a factor secret from a device backup or a rooted handset. | Not present: the secret lives in GoTrue only (R06). Asserted by inspecting a full unencrypted Android backup and an iOS device backup after enrollment. |

### 13.3 Manual QA

- [ ] Enroll on a physical device using three different authenticator apps (Google Authenticator, 1Password, Aegis); confirm the URI parses and the issuer renders as `Sharecropr` in each.
- [ ] Enroll by typing the manual key on the same phone that is displaying it — the single most common real-world path.
- [ ] Set the device clock 4 minutes fast and confirm the clock-drift copy appears on the first failure, not the fifth (R31).
- [ ] Complete the recovery-code screen with VoiceOver and again with TalkBack; confirm all ten codes are individually announced and "Copy all" is reachable first.
- [ ] Complete a full lost-everything recovery on a staging account: file, receive all four emails, verify the "This wasn't me" link works from the second email, then run a clean recovery through to a new enrollment.
- [ ] Confirm the recovery-status screen's hold countdown is correct across a device timezone change and a DST boundary.
- [ ] Verify the step-up modal replays the original mutation for each of the eight R18 operations, on a real device with a real 15-minute window (R24 copy check included).
- [ ] Airplane-mode: confirm the QR and manual key stay readable and the verify button is disabled with the offline banner.
- [ ] Confirm the reviewer account can enroll, and record its recovery codes in the submission checklist (EC-12).
- [ ] Attempt to screenshot the recovery-code screen on both platforms and confirm it succeeds (R13).
- [ ] Full flow at 200% dynamic type on both platforms, including the ten-code list.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `auth.mfa.required` — a remote-config kill switch that downgrades R03 from a hard gate to a warning banner **without** disabling enrollment, challenge, or step-up. It exists for exactly one scenario: enrollment drop-off comes in catastrophically high at launch and we need to move to the step-up-only variant in [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) within hours rather than a release cycle. R18's step-up gates are **not** flaggable. |
| Migration required | Yes — `0003_mfa.sql`: `private.mfa_recovery_codes`, `private.mfa_recovery_requests`, `mfa_recovery_state`, `app.mfa_status()`, `app.has_verified_totp()`, and the `app.can_transact()` amendment. |
| Backfill required | No. Greenfield. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). Flipping `auth.mfa.required` off unblocks transacting for factorless users within one config poll; it does **not** remove enrolled factors, and re-enabling it does not re-challenge anyone. A broken recovery queue is stopped by disabling the `mfa-recovery-request` Edge Function, which is safe: requests are refused rather than mishandled, and a refused request is recoverable while a wrongly approved one is not. |
| Client version floor | 1.0.0. First release. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | `app.can_transact()` in [RLS Design §3](../01-architecture/05-rls-design.md) does not check for a verified factor, but [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) says enrollment is mandatory before transacting and [PRD C2](../00-foundation/02-prd.md) says 2FA is "optional for browsing, required to change email…". Three documents, two readings. R03 resolves it as *mandatory to transact* and amends the function in `0003_mfa.sql`. **The architecture doc and the PRD must be updated to match, or R03 must be reduced to step-up-only.** | Architecture + Security | Before `0003_mfa.sql` merges |
| Q2 | [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) lists "changing garden location" as a step-up operation; [API Contract §2.4](../01-architecture/06-api-contract.md) does not. R18 includes it. Should the API contract table absorb it, or is garden relocation better protected by re-verification ([SPEC-004](SPEC-004-garden-verification.md)) than by a code? | Architecture | Before SPEC-004 implementation |
| Q3 | The realistic compromise here is a single unlocked phone holding the password manager *and* the authenticator, which defeats both factors at once. Passkeys with biometric gating would close it; a "require biometric for step-up" toggle would half-close it at the cost of another setting. Do we ship the toggle, or wait for passkeys? | Security | Post-launch, first 5,000 accounts |
| Q4 | R46 tells a user with no KYC that their account is unrecoverable. That is honest and it is also a permanent data loss for someone who did nothing wrong — they enrolled 2FA before reaching the verification step. Should enrollment be *deferred* until after KYC passes, so no account can exist in the unrecoverable state? That reorders the funnel and puts the more expensive step first. | Product + Security | Before first store submission |
| Q5 | Is 72 hours the right hold? Shorter reduces the churn cost of a genuine lost phone; longer increases the chance the real owner sees a notice. No data either way, and the number is copied from [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md) rather than derived. | Security | Post-launch, first 50 recovery requests |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering — Auth | Initial spec. Approved with Security sign-off per [Doc Conventions §6](../00-foundation/06-doc-conventions.md). |
