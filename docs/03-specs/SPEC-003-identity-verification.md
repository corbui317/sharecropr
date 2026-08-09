# SPEC-003: Identity Verification

| Field | Value |
| --- | --- |
| **Status** | Approved |
| **Version** | 1.0.0 |
| **Owner** | Engineering — Platform, with Security and Legal |
| **Phase** | MVP |
| **Security review** | required |
| **Depends on** | [SPEC-001](SPEC-001-authentication.md) |
| **Depended on by** | [SPEC-002](SPEC-002-two-factor-auth.md) (R45 recovery re-verification), [SPEC-004](SPEC-004-garden-verification.md), [SPEC-009](SPEC-009-listings-and-offers.md), [SPEC-010](SPEC-010-exchange-lifecycle.md), [SPEC-012](SPEC-012-trust-and-safety.md) |
| **Related ADRs** | [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md), [ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

Before a user can publish a listing or arrange a meeting with a stranger, Persona verifies that they are a real, adult human holding a government ID — and Sharecropr never sees the document. This spec defines the `kyc-start` Edge Function that creates the inquiry server-side, the embedded hosted flow, the HMAC-signed webhook that records the outcome, and the deliberately thin set of facts we retain: pass/fail, an opaque inquiry reference, an over-18 boolean, and a two-letter document country. It also defines what happens when the vendor is down, when a user fails five times, when a user has no government ID at all, and how App Store reviewers get through without one.

## 2. Goals

- Verify identity without ever possessing an identity document. The images go user → Persona and never traverse our infrastructure ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)).
- Keep the retained data set so small that a total database compromise discloses nothing about anyone's identity beyond "this account passed a check in March".
- Gate **transacting**, not browsing. A user must be able to install the app, register a garden, and see whether anyone nearby has tomatoes before being asked for a driving licence.
- Make the webhook boundary — which is the entire security perimeter of this feature, because `verify_jwt = false` — provably correct: signature first, replay window second, idempotency third, schema fourth.
- Bound the cost. Every verification is real money against zero revenue, and an uncontrolled growth spike is a five-figure bill in a week ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)).
- Degrade honestly when Persona is down, rather than blocking signup or silently marking people failed.
- Give App Store reviewers a working path that does not require a build flag and does not require a passport.

## 3. Non-Goals

- **Storing, proxying, or even briefly holding an ID image, a document number, a full date of birth, a selfie, or a biometric template.** This is the whole decision ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)). An SDK integration that puts the image in our process was evaluated and rejected for exactly this reason, and we are paying real conversion for it.
- **A native SDK capture flow.** Better UX, fewer drop-offs, and it makes us a biometric-data controller. No.
- **Address verification, database checks, watchlist screening, or sanctions screening.** Every additional check is both cost and collected data we do not want. The Persona inquiry template is document + selfie and nothing else.
- **Tiered trust (browse → email → attested device → ID).** The most serious alternative and the likely Phase 2 successor if the unit economics fail ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) revisit triggers). Not MVP.
- **Re-verification on every high-value action.** Verification is a 24-month fact about a person, not a per-transaction ceremony.
- **Support resolving a verification failure by looking at the document.** We do not have it. Failures resolve as retry-or-escalate-to-vendor, and the copy says so.
- **Phone verification as a substitute or supplement.** Rejected on independent grounds in [ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md).
- **Verifying minors with parental consent.** Under-18 is a hard fail. There is no consent flow and no under-18 account state.
- **Displaying a verification badge with any detail beyond `trust_tier`.** Users see `id_verified`; they never see when, with what, or from where.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **new gardener**, I want to browse the map and see what's nearby before anyone asks for my ID, so that I can decide whether this app is worth the trouble. | P0 |
| US-02 | As a **privacy-conscious gardener**, I want to know exactly what Sharecropr receives from the ID check before I start it, so that I can make an informed decision. | P0 |
| US-03 | As a **gardener meeting a stranger in a car park**, I want to know the other person passed a government-ID check, so that a bad actor cannot simply make a new account after being banned. | P0 |
| US-04 | As a **gardener whose first attempt failed on a blurry photo**, I want to retry immediately and know how many attempts I have left. | P0 |
| US-05 | As a **gardener trying to verify while Persona is down**, I want to be told it's temporarily unavailable and keep using the rest of the app, rather than being marked as failed. | P0 |
| US-06 | As an **App Store reviewer**, I want to evaluate the full product without producing a government ID. | P0 |
| US-07 | As a **user who verified two years ago**, I want warning before my verification expires, so that I'm not blocked mid-season. | P1 |
| US-08 | As a **user without a current government ID**, I want to know that up front and be told what my options are, rather than discovering it three screens into a webview. | P0 |
| US-09 | As **Security**, I want a webhook that cannot be replayed, forged, or reordered into a false pass. | P0 |
| US-10 | As **the person paying the Persona invoice**, I want a hard daily cap so that a press hit is not a five-figure surprise. | P0 |

## 5. Functional Requirements

### 5.1 Vendor boundary and data minimization

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | Verification uses Persona's **hosted** flow. Document and selfie images travel user → Persona directly and MUST NOT traverse, transit, or be buffered by any Sharecropr process, function, storage bucket, or log. |
| R02 | **MUST NOT** | Sharecropr MUST NOT store an ID image, a document number, a full or partial date of birth, a selfie, a biometric template, a document-derived address, or a document expiry date — in any schema, cache, log, telemetry event, or support tool. |
| R03 | **MUST** | The complete client-reachable record is `public.verifications`: `status`, `is_over_18`, `document_country`, `verified_at`, `expires_at`, `failure_reason_code`, `attempt_count` ([Data Model §5](../01-architecture/03-data-model.md)). Nothing is added to it by this spec. |
| R04 | **MUST** | `private.verification_vendor_refs.raw_decision` carries a `CHECK` rejecting any payload containing an image, document-number, date-of-birth, or address key. A vendor payload shape change that introduces one fails the insert loudly rather than storing it quietly. |
| R05 | **MUST** | `is_over_18` is computed **vendor-side** and delivered as a boolean. No date of birth, in any precision, is transmitted to us or derivable from what we hold. |
| R06 | **MUST** | `document_country` is ISO-3166-1 alpha-2 and nothing finer. No state, province, or issuing authority. |
| R07 | **MUST** | `private.verification_vendor_refs.vendor` accepts `'persona'` and `'stripe_identity'` from the first migration. No table, column, function signature, or error code assumes a single vendor ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)). |
| R08 | **MUST NOT** | The client MUST NOT hold the Persona API key, the webhook signing secret, or a template id, in any env var, build profile, remote config value, or OTA bundle. |

### 5.2 Starting a verification — `kyc-start`

| ID | Req | Statement |
| --- | --- | --- |
| R09 | **MUST** | The inquiry is created server-side by Edge Function `kyc-start`, using the API key held in the function's secrets. There is no client-side inquiry creation path. |
| R10 | **MUST** | The response contains **only** `inquiry_id`, a one-time `session_token`, and `expires_at`. It MUST NOT contain the API key, the template id, the webhook secret, a redirect URL that embeds a secret, or any user field. |
| R11 | **MUST** | The `session_token` is valid for 15 minutes, single use, and MUST NOT be persisted client-side — not SecureStore, not MMKV, not the React Query cache, not a navigation param that survives a state restore ([API Contract §2.3](../01-architecture/06-api-contract.md), [Mobile Architecture §5.4](../01-architecture/02-mobile-architecture.md)). |
| R12 | **MUST** | The embedded webview is constrained to an origin allowlist of Persona domains. Any navigation outside it is cancelled and the flow terminates with an error. The webview exposes no JavaScript bridge, no injected script, no shared cookie jar with the app's session, and no file-download handler. |
| R13 | **MUST** | `verifications.attempt_count` is incremented at **inquiry creation**, not at outcome. An abandoned inquiry costs us money and therefore costs an attempt. |
| R14 | **MUST** | `kyc-start` refuses unless the caller has a confirmed email ([SPEC-001-R14](SPEC-001-authentication.md)) and a verified TOTP factor ([SPEC-002-R03](SPEC-002-two-factor-auth.md)). Verification is the most expensive step in the funnel and it goes last. |
| R15 | **MUST** | `kyc-start` is idempotent on `p_idempotency_key`: a replay within the token's 15-minute life returns the **same** `inquiry_id` and `session_token` and does not increment `attempt_count` or create a second inquiry. |
| R16 | **SHOULD** | `kyc-start` requires a passing device-attestation assertion (App Attest / Play Integrity) before creating an inquiry, as the primary control against scripted signups that spend our money ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)). |

### 5.3 Recording the outcome — `kyc-webhook`

> `verify_jwt = false` on this function. **Signature verification is the entire security boundary.** Everything in this subsection is therefore a MUST, and each step is ordered.

| ID | Req | Statement |
| --- | --- | --- |
| R17 | **MUST** | Step 1: HMAC-SHA256 over the **raw request body** with the vendor signing secret, compared in constant time. This happens before the body is parsed, before any field is read, and before any log line is written. |
| R18 | **MUST** | Step 2: the vendor-supplied timestamp must be within a **300-second** replay window of server time. Outside it, the request is rejected. |
| R19 | **MUST** | Step 3: `webhook_idempotency_key` is inserted under a `UNIQUE` constraint. A duplicate returns `200 {"status":"duplicate"}` and mutates nothing. The uniqueness is the mechanism; a `SELECT`-then-`INSERT` check is not acceptable. |
| R20 | **MUST** | Step 4: the payload is validated against a schema before any field is read for business logic. An unrecognised field is ignored; a missing or wrong-typed required field is a rejection. |
| R21 | **MUST NOT** | The function MUST NOT accept a user JWT, a service-role key, or any other credential as an alternative to a valid signature. There is exactly one way in. |
| R22 | **MUST** | The function returns `200` for everything except a signature failure, which returns `401`. A `500` makes Persona retry, and a retry storm against a genuine bug is worse than a dropped event we can reconcile from the vendor. |
| R23 | **MUST** | Only these transitions are applied: `unstarted`/`pending_vendor` → `passed`, `unstarted`/`pending_vendor` → `failed`, and `passed` → `revoked`. An out-of-order or stale event — one whose vendor event timestamp precedes the timestamp recorded on the current row — is acknowledged with `200` and discarded. |
| R24 | **MUST** | Writes to `public.verifications` happen only in this function, running as `service_role`. There is no client-reachable INSERT, UPDATE, or DELETE path (§9). |
| R25 | **MUST** | A `passed` outcome sets `verified_at = now()`, `expires_at = now() + interval '24 months'`, `is_over_18`, `document_country`, clears `failure_reason_code`, enqueues a `verification_result` notification, and writes `audit.events` with `action = 'verification.passed'`. |

### 5.4 Where the gate sits

| ID | Req | Statement |
| --- | --- | --- |
| R26 | **MUST** | Verification gates **transacting only**, through `app.can_transact()`: publishing a listing, sending an exchange request, and accepting one. |
| R27 | **MUST** | An unverified account can sign up, enroll 2FA, register a garden, submit garden verification, browse the map, open safe-spot sheets, search species, and build inventory. None of these consult `verifications.status`. |
| R28 | **MUST** | Reviewer accounts bypass the gate through `private.review_bypass_accounts` — a server-side, time-boxed allowlist read inside `app.can_transact()`. A build flag, an environment variable, a remote-config value, or a hardcoded email list MUST NOT be used, because all of them ship to production ([SPEC-001-R54](SPEC-001-authentication.md), [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)). |
| R29 | **MUST** | A bypass row MUST NOT set `verifications.status = 'passed'` or raise `trust_tier`. Bypass affects `app.can_transact()` and nothing else, so a reviewer account never appears to other users, to analytics, or to the trust score as a verified human. |
| R30 | **MUST** | Bypass rows carry `expires_at` no more than 45 days out, are provisioned per submission, and their creation and deletion write `audit.events`. A cron alert fires 7 days before any bypass row expires. |
| R31 | **MUST** | The gate is enforced in the database (`app.can_transact()` inside RLS `WITH CHECK` clauses and definer RPCs). Client-side gating is a UX affordance; removing it changes nothing about what the server permits. |
| R32 | **MUST** | When blocked, the client presents a sheet naming the specific action that requires verification, with a "Verify my identity" primary action — never a generic error, and never a silent no-op ([Mobile Architecture §8.2](../01-architecture/02-mobile-architecture.md), `not_verified` → sheet). |

### 5.5 Expiry and re-verification

| ID | Req | Statement |
| --- | --- | --- |
| R33 | **MUST** | `expires_at = verified_at + interval '24 months'` ([Data Model §14](../01-architecture/03-data-model.md)). |
| R34 | **MUST** | A `pg_cron` job flips `passed → expired` at `expires_at`, writes `audit.events`, and enqueues a notification. Expiry is a state, not an absence of one. |
| R35 | **MUST** | Reminders are enqueued at 30 days and 7 days before `expires_at`, and again on the day of expiry. |
| R36 | **MUST** | Expiry blocks *new* transactions but MUST NOT cancel an already-`scheduled` exchange session. A user may always finish, cancel, confirm, and rate an exchange they are already in ([API Contract §5.4](../01-architecture/06-api-contract.md)). Stranding a counterparty because a two-year timer elapsed is not an acceptable failure mode. |
| R37 | **MUST** | Successful re-verification resets `attempt_count` to 0. A fresh 24-month cycle gets a fresh attempt budget. |

### 5.6 Vendor outage and cost control

| ID | Req | Statement |
| --- | --- | --- |
| R38 | **MUST** | On a vendor 5xx, timeout, or connection failure at `kyc-start`, `verifications.status` is set to (or left at) `pending_vendor`, `attempt_count` is **not** incremented, `failure_reason_code` is **not** set, and the client shows the temporarily-unavailable copy in §8.3. |
| R39 | **MUST** | `pending_vendor` is not a failure state. It does not consume an attempt, does not affect `trust_tier`, and does not appear to the user as anything other than "not finished yet". |
| R40 | **MUST** | Edge Function `kyc-reconcile`, on a 15-minute `pg_cron` schedule, polls Persona for every inquiry left in `pending_vendor` for more than 30 minutes and applies the authoritative outcome. Webhooks are the fast path; reconciliation is the correct one. |
| R41 | **MUST** | A **daily verification budget cap** is enforced in `kyc-start` against `private.kyc_budget_ledger`. Beyond the cap the function returns `quota_exceeded` (422) with the waitlist copy in §8.3, and no inquiry is created. An alert fires at 70% of the monthly budget ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)). |
| R42 | **SHOULD** | During a declared vendor outage, a remote-config banner on the verification screen names the condition, so users stop retrying and support stops receiving tickets. |

### 5.7 Failure, retry, and the people this excludes

| ID | Req | Statement |
| --- | --- | --- |
| R43 | **MUST** | The hard cap is `attempt_count <= 5`, enforced by a `CHECK` on `public.verifications` and by `kyc-start` returning `quota_exceeded` (422) at the fifth ([Data Model §5](../01-architecture/03-data-model.md)). |
| R44 | **MUST** | `failure_reason_code` is a vendor code. The client maps it to plain copy through a maintained table; the raw code is **never** rendered to a user. An unmapped code falls back to the generic retry message and emits a Sentry event so the mapping gets fixed. |
| R45 | **MUST** | After a failure the screen states the remaining attempts and one concrete corrective action drawn from the code mapping ("more light", "flat surface", "all four corners in frame"). |
| R46 | **MUST** | At the fifth attempt the user reaches a terminal state with a support address and no retry button, because retrying cannot succeed. |
| R47 | **MUST** | Before the flow starts, a disclosure screen states: what is captured, that it goes to Persona and not to Sharecropr, exactly which four facts we receive, how long Persona keeps the document under its own policy, and that support cannot see the document. This is presented once per inquiry, not buried in a legal page. |
| R48 | **MUST** | Support tooling exposes `status`, `failure_reason_code`, `attempt_count`, and `inquiry_id` only. There is no view, export, or console path to a document, and the support macro says so in the user's language. |
| R49 | **SHOULD** | A documented manual-review escape hatch exists for users who cannot produce a government ID. It is a human process with a published response time, not a product surface, and it is the honest acknowledgement that R26 excludes real people — disproportionately those least served by every other system that asks for papers. Its volume is tracked as an equity metric (§11). |
| R50 | **MUST** | A recovery re-verification requested by [SPEC-002-R45](SPEC-002-two-factor-auth.md) is created as a **linked** inquiry against the original Persona account reference, is charged to the recovery budget line, and does **not** increment `verifications.attempt_count`. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| `public.verifications` | read (self, RLS); write `service_role` only | The thin record. Row created at signup with `status = 'unstarted'` by the trigger in [SPEC-001-R10](SPEC-001-authentication.md). |
| `private.verification_vendor_refs` | server-side only | `vendor`, `inquiry_id`, `webhook_idempotency_key`, `raw_decision`. Retained 7 years pseudonymized past account deletion ([Data Model §14](../01-architecture/03-data-model.md)). |
| `private.review_bypass_accounts` | server-side only | Read inside `app.can_transact()`. Never client-reachable. |
| `private.kyc_budget_ledger` | server-side only | New. Per-day spend accounting for R41. |
| `public.profiles` | read | `trust_tier` is maintained by trigger on `verifications.status`; `deleted_at` and `is_suspended` are read by `app.can_transact()`. |
| `public.notifications` | write | `verification_result` on pass, fail, expiry, and each expiry reminder. |
| `audit.events` | write | `verification.started`, `verification.passed`, `verification.failed`, `verification.expired`, `verification.revoked`, `verification.bypass_granted`, `verification.bypass_revoked`, `verification.budget_capped`. |

**New schema objects introduced by this spec:**

```sql
-- supabase/migrations/0004_identity_verification.sql

-- The CHECK that makes R02 structural rather than aspirational.
ALTER TABLE private.verification_vendor_refs
  ADD CONSTRAINT raw_decision_holds_no_documents CHECK (
    NOT (raw_decision ?| ARRAY[
      'image','images','photo','photos','front','back','selfie','frames',
      'document_number','id_number','passport_number','license_number',
      'birthdate','date_of_birth','dob','address','address_line_1','postal_code'
    ])
  );

CREATE INDEX verification_vendor_refs_inquiry_idx
  ON private.verification_vendor_refs (inquiry_id);

-- R50: a recovery re-verification is a separate lineage, not a retry.
ALTER TABLE private.verification_vendor_refs
  ADD COLUMN purpose text NOT NULL DEFAULT 'onboarding'
    CHECK (purpose IN ('onboarding','reverification','mfa_recovery')),
  ADD COLUMN vendor_account_ref text NULL,     -- Persona account id, for linked inquiries
  ADD COLUMN vendor_event_at timestamptz NULL; -- R23 out-of-order guard

-- R41: cost is a first-class constraint, not a dashboard.
CREATE TABLE private.kyc_budget_ledger (
  day             date PRIMARY KEY,
  inquiries       integer NOT NULL DEFAULT 0,
  daily_cap       integer NOT NULL,
  unit_cost_usd   numeric(6,2) NOT NULL,
  capped_at       timestamptz NULL
);

REVOKE ALL ON private.kyc_budget_ledger FROM anon, authenticated, PUBLIC;

-- R28/R29: bypass affects can_transact() and nothing else.
CREATE OR REPLACE FUNCTION app.has_review_bypass(u uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, private AS $$
  SELECT EXISTS (SELECT 1 FROM private.review_bypass_accounts r
                  WHERE r.user_id = u AND r.expires_at > now());
$$;
REVOKE ALL ON FUNCTION app.has_review_bypass(uuid) FROM anon, authenticated;

-- R32: the client needs to know *why* it is blocked, without learning anything else.
CREATE OR REPLACE FUNCTION app.verification_gate_reason()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $$
  SELECT CASE
    WHEN app.has_review_bypass(auth.uid())                     THEN 'ok'
    WHEN (SELECT v.status FROM public.verifications v
           WHERE v.user_id = auth.uid()) = 'passed'            THEN 'ok'
    WHEN (SELECT v.status FROM public.verifications v
           WHERE v.user_id = auth.uid()) = 'pending_vendor'    THEN 'verification_pending'
    WHEN (SELECT v.status FROM public.verifications v
           WHERE v.user_id = auth.uid()) = 'expired'           THEN 'verification_expired'
    WHEN (SELECT v.attempt_count FROM public.verifications v
           WHERE v.user_id = auth.uid()) >= 5                  THEN 'verification_exhausted'
    ELSE 'verification_required'
  END;
$$;
GRANT EXECUTE ON FUNCTION app.verification_gate_reason() TO authenticated;
```

**RLS policies introduced by this spec:**

```sql
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications FORCE ROW LEVEL SECURITY;

CREATE POLICY verifications_select_own ON public.verifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY verifications_select_moderator ON public.verifications
  FOR SELECT TO authenticated
  USING (app.is_moderator());

-- There is deliberately NO INSERT, UPDATE, or DELETE policy on public.verifications.
-- Every write is service_role, from kyc-webhook or kyc-reconcile. The absence of a
-- policy is the enforcement of R24: a user cannot mark themselves verified because
-- there is no statement they could issue that would be permitted to try.
```

**PII touched:** `verifications.is_over_18` (P1), `verifications.document_country` (P1), `verifications.verified_at` / `expires_at` (P1), `verifications.failure_reason_code` (P1), `private.verification_vendor_refs.inquiry_id` (P1 — an opaque pointer to data held by the vendor, which is the entire point), `private.verification_vendor_refs.raw_decision` (P1, constrained by CHECK). **No P0 identity data exists in this system.** Classification per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md).

## 7. API

### Edge Function `kyc-start`

**Invoked by:** client, `authenticated`
**Auth:** valid user JWT. Email confirmed and TOTP verified are preconditions (R14).
**Rate limit:** 5 / day / user (Postgres token bucket), plus the daily budget cap (R41)
**Secrets:** Persona API key, template id

```jsonc
// Request
{ "idempotency_key": "8f14e45f-ceea-4a2f-9c1e-3d0f5a7b2e91",
  "attestation": "<App Attest / Play Integrity assertion>" }
// Response 200
{ "inquiry_id": "inq_9c1e3d0f5a7b",
  "session_token": "…",
  "expires_at": "2026-08-08T14:37:00Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_verified` | 403 | Email unconfirmed or no verified TOTP factor (R14) |
| `conflict` | 409 | `verifications.status` is already `passed` and not expired |
| `quota_exceeded` | 422 | `attempt_count >= 5` (R43) **or** the daily budget cap is reached (R41) — the client distinguishes them by `details.reason` (`attempts` \| `capacity`) |
| `validation_failed` | 400 | Attestation missing or rejected (R16) |
| `rate_limited` | 429 | 5 / day bucket empty; `Retry-After` set |
| `server_error` | 502 | Vendor unavailable → `pending_vendor`, no attempt consumed (R38) |

### Edge Function `kyc-webhook`

**Invoked by:** Persona
**Auth:** **HMAC signature only.** `verify_jwt = false` in `config.toml`.
**Rate limit:** 600 / min / IP at Kong (vendor burst tolerance)

```jsonc
// Vendor request (abridged)
{
  "data": {
    "type": "event",
    "attributes": {
      "name": "inquiry.completed",
      "created-at": "2026-08-08T14:35:11Z",
      "payload": {
        "data": {
          "id": "inq_9c1e3d0f5a7b",
          "attributes": {
            "status": "completed",
            "reference-id": "8f14e45f-…",
            "fields": {
              "identification-class": { "value": "dl" },
              "country-code":         { "value": "US" },
              "is-over-18":           { "value": true }
            }
          }
        }
      }
    }
  }
}
```

```jsonc
// Response 200 — always, except a signature failure
{ "status": "applied" }      // or "duplicate", or "ignored_stale", or "ignored_unknown_inquiry"
```

| Error code | HTTP | When |
| --- | --- | --- |
| — | 401 | HMAC mismatch, or a timestamp outside the 300 s window (R17, R18). **The only non-200.** |

Ordering is normative and testable: signature → replay window → idempotency insert → schema validation → transition check → write. A test exists for each boundary (§13.2).

### Edge Function `kyc-reconcile`

**Invoked by:** `pg_cron`, every 15 minutes
**Auth:** `service_role`. Not reachable with a user JWT.

Polls Persona for every `private.verification_vendor_refs` row whose `public.verifications.status = 'pending_vendor'` and whose inquiry is older than 30 minutes, and applies the authoritative outcome through the same transition guard as R23. Idempotent; a row already resolved by webhook is a no-op. Alerts on any inquiry stuck in `pending_vendor` for more than 24 hours.

### `GET /rest/v1/verifications`

**Auth:** `authenticated`, owner-only via `verifications_select_own`
**Rate limit:** 60 / min / user

```http
GET /rest/v1/verifications?select=status,is_over_18,document_country,verified_at,expires_at,failure_reason_code,attempt_count
```

There is no write path. `POST`, `PATCH`, and `DELETE` return `42501` because no policy grants them (§6).

### `rpc.verification_gate_reason`

**Auth:** `authenticated`
**Rate limit:** 60 / min / user

```jsonc
// Request
{}
// Response 200
{ "reason": "verification_required" }
// one of: ok | verification_required | verification_pending | verification_expired | verification_exhausted
```

Exists so the client can render the correct sheet copy without inferring state from a 403.

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Gate sheet | presented over any route | Names the blocked action; "Verify my identity" primary action |
| Disclosure | `/verify/identity` | R47 — what is collected, by whom, what we get, before anything starts |
| Hosted flow | `/verify/identity/flow` | Full-screen webview, Persona origins only |
| Pending | `/verify/identity/pending` | Shown while the outcome has not arrived |
| Result | `/verify/identity/result` | Pass, fail with corrective guidance, or exhausted |
| Status card | `/(tabs)/profile` | Current state, expiry date, re-verify action |

### 8.2 States

| State | Behaviour |
| --- | --- |
| **Loading** | `kyc-start` shows an inline spinner on the "Continue" button for up to 8 s; the disclosure text stays on screen and readable throughout, because it is the thing the user should be reading. The webview shows Persona's own loading state — we do not overlay ours on top of it, which would produce two spinners and a flash. After the flow closes, the pending screen appears immediately rather than a spinner, because the wait is measured in seconds-to-minutes and a spinner implies otherwise. |
| **Empty** | Not applicable to a single-outcome flow. The profile status card is never empty: an account with `status = 'unstarted'` renders `Not verified yet` with the verify action, never a blank row or a dash. |
| **Error (recoverable)** | Network failure at `kyc-start`, webview load failure, user-cancelled flow, or a vendor `failed` outcome below attempt 5: full-screen state naming the reason, remaining attempts, one corrective action from the code mapping (R45), and a "Try again" button. A user-cancelled flow is **not** an error — the sheet closes and the user returns to the disclosure screen with the attempt already consumed, and the copy says so plainly rather than pretending nothing happened. |
| **Error (terminal)** | `attempt_count = 5`, or `status = 'revoked'`: full-screen state, `support@sharecropr.app` link, **no retry button**. The copy states that support cannot see the document, so the user does not spend a week attaching photos to emails. |
| **Offline** | The verify action is disabled behind a persistent banner. The disclosure text renders from the bundle and is fully readable offline, so a user can decide whether to proceed before they have signal. The webview is never opened offline — a half-loaded hosted flow that fails mid-capture consumes an attempt for nothing. |
| **Permission denied** | Camera permission is requested by Persona *inside* the webview, not by us. If the OS-level camera permission for the app is denied, the hosted flow cannot capture and reports its own error; we detect the resulting cancellation and show the camera-permission copy with a Settings deep link, and **the attempt is refunded** — a permission the user never granted should not cost them one of five. This is the one attempt-refund case in the spec. |
| **Rate limited** | 5 / day bucket empty: the verify button is disabled for exactly `Retry-After` with a live countdown. Daily budget cap reached (R41): a different, non-countdown state — `capacity` is not the user's fault and not the user's problem, so the copy offers a waitlist notification rather than a timer, and tapping it enqueues a `verification_result` notification for when capacity returns. |

### 8.3 Copy

Exact strings. Anything not listed here is a spec gap and must be added before implementation.

**Gate sheet** (rendered from `verification_gate_reason`)

| Reason | Copy |
| --- | --- |
| `verification_required` | `Verify your identity to {publish this listing \| send this request \| accept this request}` / `Everyone who trades on Sharecropr has had their ID checked. It's why meeting a stranger here is safer than meeting one anywhere else. Takes about three minutes.` |
| `verification_pending` | `We're still waiting on your identity check` / `This usually takes a couple of minutes. We'll notify you the moment it's done.` |
| `verification_expired` | `Your ID check has expired` / `We re-check every two years. Same process as last time — about three minutes.` |
| `verification_exhausted` | `We couldn't verify your ID` / `You've used all five attempts. Email support@sharecropr.app and we'll take it from there.` |
| Primary action | `Verify my identity` |
| Secondary action | `Not now` |

**Disclosure (R47)**

| Element | Copy |
| --- | --- |
| Title | `Before we start` |
| Who does it | `A company called Persona runs this check. You'll photograph a government ID and take a selfie. Those images go straight to Persona — they never reach Sharecropr's servers.` |
| What we receive | `All Sharecropr gets back is four things: whether you passed, that you're over 18, the two-letter country your document came from, and a reference number. Not your name from the document, not your date of birth, not your document number, and not the images.` |
| Vendor retention | `Persona keeps your images under their own retention policy, linked at the bottom of this screen. We keep the four facts above for 24 months, then ask you to do this again.` |
| Support caveat | `If the check fails, our support team can't look at your photo to tell you why — we don't have it. They can tell you the reason code and help you retry.` |
| Consent action | `Start ID check` |
| Decline action | `Not now` |

**Result — pass**

| Condition | Copy |
| --- | --- |
| Passed | `You're verified` / `You can publish listings and arrange exchanges now. We'll ask you to do this again on {expiry_date}.` |

**Result — failure and retry**

| Condition | Copy |
| --- | --- |
| Generic failure | `That check didn't pass` |
| Attempts remaining | `{n} attempt(s) left.` |
| Corrective: blur | `The photo came out blurry. Rest your phone on something flat and try again.` |
| Corrective: glare | `There was too much glare on the document. Move away from direct light.` |
| Corrective: crop | `Part of the document was cut off. Get all four corners in the frame.` |
| Corrective: selfie match | `The selfie and the document photo didn't match closely enough. Try again in even lighting, looking straight at the camera.` |
| Corrective: unsupported document | `That document type isn't supported. A passport or driving licence works best.` |
| Corrective: under 18 | `Sharecropr is for adults only. We can't verify this account.` *(terminal, no retry)* |
| Corrective: unmapped code | `That check didn't pass. Try again with better lighting and a flat surface.` |
| User cancelled | `You closed the ID check before it finished. That used one of your five attempts — we're charged for it either way.` |
| Exhausted | `You've used all five attempts` / `We can't run another check on this account automatically. Email support@sharecropr.app — and note that we can't see your ID photos, so please don't send them.` |

**Outage and capacity**

| Condition | Copy |
| --- | --- |
| Vendor unavailable (R38) | `ID checks are temporarily unavailable` / `This isn't your account — it's on our side. Nothing has been counted against you. Keep browsing and try again later; we'll let you know when it's back.` |
| Declared outage banner (R42) | `ID verification is down right now. We're on it.` |
| Budget cap (R41) | `We're at capacity for today` / `We can only run so many ID checks a day. Tap below and we'll notify you as soon as there's room — usually tomorrow morning.` |
| Waitlist action | `Notify me when it's open` |
| Waitlist confirmed | `You're on the list. We'll notify you.` |

**Camera permission**

| Condition | Copy |
| --- | --- |
| Denied | `Sharecropr needs camera access for the ID check` / `The check runs inside your camera. Turn it on in Settings and come back — this attempt hasn't been counted.` |
| Action | `Open Settings` |

**Expiry**

| Condition | Copy |
| --- | --- |
| 30-day reminder | `Your ID check expires on {date}. Re-verifying takes about three minutes and you can do it any time before then.` |
| 7-day reminder | `Your ID check expires in a week, on {date}.` |
| Expired | `Your ID check has expired. You can still finish any exchange you've already arranged.` |

**Empty states**

| Screen | Copy |
| --- | --- |
| Profile status card, `unstarted` | `Not verified yet` |
| Profile status card, `pending_vendor` | `Check in progress` |

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Forge a `passed` outcome and thereby manufacture verified accounts at will — which destroys the only control that makes a ban expensive ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)) and puts unvetted strangers into arranged physical meetings. `kyc-webhook` runs with `verify_jwt = false`, so its HMAC check is not *a* boundary, it is *the* boundary, and R17–R23 are the whole of it. The second-worst is economic: a scripted signup loop that spends $1.50–$2.50 per iteration of our money, which is why R13 charges an attempt at inquiry creation rather than at outcome, why R16 requires device attestation, and why R41 makes a daily cap a code path rather than a dashboard. Third: a stale or reordered webhook that resurrects a `revoked` account into `passed` — R23's `vendor_event_at` guard. Notably **absent** from this list: an ID-image breach, because we do not have any (R01, R02). |
| **Which RLS policies enforce access?** | `verifications_select_own` and `verifications_select_moderator` (Pattern A / moderator overlay, [RLS Design §5](../01-architecture/05-rls-design.md)), both introduced here. **There is no INSERT, UPDATE, or DELETE policy on `public.verifications` at all** — the absence is the enforcement of R24, and it means a user cannot mark themselves verified because no statement they could issue would be permitted to try. `private.verification_vendor_refs`, `private.review_bypass_accounts`, and `private.kyc_budget_ledger` have no grants to any client role and live in a schema absent from PostgREST's `db-schemas`; a table no client can reach cannot be leaked by a missing policy. The gate itself is `app.can_transact()`, which reads `verifications.status` and `private.review_bypass_accounts` as `SECURITY DEFINER` with a pinned `search_path`; `app.has_review_bypass(uuid)` is **not** granted to `authenticated`, so a client cannot ask whether an arbitrary account is on the allowlist. `app.verification_gate_reason()` is granted and takes no parameter — it can only answer about the caller. |
| **Can any response path expose an exact coordinate or PII?** | No coordinate: nothing here reads `private.garden_locations`, and no return type in §7 has a column that could hold a point ([API Contract §9](../01-architecture/06-api-contract.md)). PII: deliberately and minimally — the caller's own `is_over_18` and `document_country` on their own profile screen. `document_country` is the only jurisdictional fact we hold and it is two characters; it is excluded from `profile_cards` and from every analytics event, because "everyone in this metro whose document came from country X" is a targeting query. `inquiry_id` is an opaque vendor reference never rendered to any user. `failure_reason_code` is a vendor code and never a sentence about a person. |
| **What is logged, and is it scrubbed?** | `audit.events` records the eight `verification.*` actions with actor id, timestamp, request id, and `inquiry_id` — never a document fact, never `is_over_18`, never `document_country`. `kyc-webhook` logs the idempotency key, the outcome, and the latency; **it never logs the request body**, because the body is the one place vendor-side fields could appear, and an allowlist rule in the function's logger enforces that rather than a convention. Sentry's `beforeSend` redacts any key matching `/document\|passport\|licen[sc]e\|dob\|birth\|selfie\|ssn/i` at any depth, plus the existing email and JWT rules. The Persona API key and signing secret exist only in Edge Function secrets and are asserted absent from every build artifact by the same CI grep that catches `service_role` ([SPEC-001-R13](SPEC-001-authentication.md)). |
| **Does this need step-up authentication?** | No — and that is deliberate. Starting a verification is not a destructive action, and requiring a TOTP challenge in front of it would add a step to the funnel's narrowest point for no security gain: an attacker who verifies a victim's account has *helped* them. Step-up applies to the operations in [SPEC-002-R18](SPEC-002-two-factor-auth.md). The one adjacent case that **does** need it is granting a `private.review_bypass_accounts` row, which is a `service_role` operation performed from a runbook by a named human with two-person sign-off, not an in-app action at all. |
| **Abuse / rate-limit controls** | `kyc-start` 5 / day per user (Postgres token bucket) and 5 lifetime attempts per verification cycle (`CHECK attempt_count <= 5`). Device attestation before inquiry creation (R16). A hard daily budget cap that refuses inquiries rather than degrading silently (R41), with an alert at 70% of the monthly budget and a hard alert at $3,000/month or $1,500/week ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)). `kyc-webhook` 600 / min per IP at Kong, plus the 300-second replay window and the unique idempotency key, both of which bound a replay flood to one write. Email confirmation and TOTP enrollment as prerequisites (R14) mean a scripted signup must complete two prior gates before it can cost us anything. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | The webhook arrives before `kyc-start` has committed its `private.verification_vendor_refs` row. | The webhook finds no matching inquiry, returns `200 {"status":"ignored_unknown_inquiry"}`, and does **not** create a row — creating one would let a forged-but-correctly-signed event manufacture a verification for a user id of the attacker's choosing. `kyc-reconcile` (R40) picks up the outcome within 15 minutes. This is why reconciliation exists and why it is not optional. |
| EC-02 | Persona delivers `inquiry.completed` twice, 40 ms apart, from two edge regions. | The second insert violates the `webhook_idempotency_key` UNIQUE constraint and returns `200 {"status":"duplicate"}` having mutated nothing (R19). Verified at 50-way concurrency, not just sequentially. |
| EC-03 | A `passed` event arrives after a `revoked` event, out of order. | Rejected by the `vendor_event_at` comparison in R23, acknowledged `200 {"status":"ignored_stale"}`. Without this guard, vendor retry ordering — which no vendor guarantees — could resurrect a banned account. |
| EC-04 | User completes the flow, then kills the app before the webhook lands. | `status` stays `pending_vendor`. The webhook writes regardless of client presence, Realtime pushes the result to `user:{user_id}` when they return, and the in-app inbox holds the `verification_result` notification as the durable record ([Realtime & Notifications §1](../01-architecture/08-realtime-and-notifications.md)). Nothing about the outcome depends on the client being alive. |
| EC-05 | User opens the hosted flow, abandons it at the selfie step, and starts again. | The abandoned inquiry consumed an attempt (R13) — we were billed for it. The retry consumes a second. The cancellation copy in §8.3 states this plainly rather than hiding it, because a user who discovers it at attempt 5 is a support ticket and a one-star review. |
| EC-06 | User has a valid `passed` verification and calls `kyc-start` again. | `conflict` 409. Re-verification before expiry is not offered; there is nothing to improve and it costs $2.50. The exception is R50's recovery lineage, which is a different `purpose` and a different budget line. |
| EC-07 | The daily budget cap is hit at 14:00 on launch day. | `kyc-start` returns `quota_exceeded` with `details.reason = "capacity"`, no inquiry is created, `private.kyc_budget_ledger.capped_at` is stamped, `verification.budget_capped` is audited, and the waitlist copy in §8.3 renders. Users already verified are unaffected; users mid-flow are unaffected because their inquiry already exists. This is a deliberate growth brake and it is better than the alternative, which is discovering the number on an invoice. |
| EC-08 | Persona is down for six hours. | New attempts return 502 → `pending_vendor` with no attempt consumed (R38), the outage banner shows (R42), existing verified users are entirely unaffected, and signup continues ([System Architecture §2](../01-architecture/01-system-architecture.md)). `kyc-reconcile` drains the backlog when the vendor returns. The failure mode is "you can't verify right now", never "you failed". |
| EC-09 | A user's verification expires while they have a `scheduled` exchange 20 minutes from now. | The session proceeds. `confirm_handoff`, `cancel_session`, and `submit_rating` do not require `app.can_transact()` ([API Contract §5.4](../01-architecture/06-api-contract.md)). Only *new* requests and listings are blocked (R36). A counterparty standing in a library lobby is not an acceptable price for a calendar boundary. |
| EC-10 | A user changes their email address after verifying. | `verifications.status` is unchanged ([SPEC-001-R41](SPEC-001-authentication.md)). Verification is bound to the person, not the mailbox. |
| EC-11 | An App Store reviewer's bypass row expires mid-review. | The reviewer hits the verification wall and the submission is at risk. Mitigations: `expires_at` at submission + 45 days (R30), and a cron alert 7 days before any bypass row expires while a submission is in flight. This has bitten other teams; it is a calendar item in [Release & Store Submission](../05-operations/03-release-and-store-submission.md). |
| EC-12 | A reviewer account appears in another user's exchange history as `id_verified`. | It cannot: R29 forbids the bypass from touching `verifications.status` or `trust_tier`. A bypass account shows as `email_verified` to everyone, including analytics. If we made bypass equivalent to verified, our own verified-user count would be wrong and a reviewer account would carry a trust signal it did not earn. |
| EC-13 | Persona changes its webhook payload shape and starts including a `document_number` field. | The `raw_decision_holds_no_documents` CHECK (R04) rejects the insert; the function catches the constraint violation, returns `200` (so Persona does not retry-storm), records `verification.webhook_schema_rejected` in `audit.events`, and pages. We fail loudly and stop verifying rather than quietly becoming a custodian of document numbers. |
| EC-14 | A user has no government ID at all. | They hit R46's terminal state at attempt 5, or they never start. R49's manual-review path is the only answer we have and it is a human process with a queue, not a feature. This is a real exclusion, it falls hardest on people who are already excluded elsewhere, and [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) names it as the strongest argument against the whole decision. We track its volume (§11) because if the number is large, the tiered model is the answer and not a better disclosure screen. |
| EC-15 | Someone attempts to verify two Sharecropr accounts with the same document. | Persona reports a duplicate against the account reference; we apply `failed` with the vendor's code and the generic retry copy. We do **not** tell the user "this ID is already in use", because that discloses the existence of another account tied to a document — an oracle a stalker could use to confirm a person is on the platform. The duplicate is flagged to moderation instead. |
| EC-16 | A user completes a `mfa_recovery` re-verification ([SPEC-002-R45](SPEC-002-two-factor-auth.md)) that fails. | The MFA recovery request moves to `rejected`; `public.verifications` is untouched, `attempt_count` is untouched (R50), and the user's existing `passed` status survives. A failed recovery must never cost someone the verification they already hold. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `kyc.gate_shown` | PostHog | `blocked_action`, `reason` | — |
| `kyc.disclosure_viewed` | PostHog | `dwell_ms` | — |
| `kyc.started` | PostHog + `audit.events` | `attempt_number` | — |
| `kyc.abandoned` | PostHog | `last_step` (`disclosure`\|`webview_open`\|`document`\|`selfie`) | **Drop-off > 35%** of users who reach the disclosure — [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) revisit trigger |
| `kyc.completed` | PostHog + `audit.events` | `outcome`, `attempt_number`, `ms_in_flow` | **Completion < 60%** in any weekly cohort — [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) revisit trigger |
| `kyc.failure_reason` | Metric | `code` (vendor), `mapped` (bool) | `mapped = false` on > 2% of failures → the copy mapping is stale, fix within a week |
| `kyc.attempts_exhausted` | `audit.events` + metric | — | > 3% of users who start → the flow or the guidance is broken, not the users |
| `kyc.pending_vendor_age` | Metric | `p95`, `max` | **Any inquiry > 24 h in `pending_vendor`** — reconciliation is failing, page on-call |
| `kyc.webhook_signature_failure` | Security metric | `source_ip` | **> 5 in 10 min** → someone is probing the one boundary that matters, page security |
| `kyc.webhook_replay_rejected` | Security metric | — | Any sustained rate → investigate |
| `kyc.webhook_duplicate` | Metric | — | Expected and healthy; a rate of **zero** is suspicious (idempotency untested in production) |
| `kyc.webhook_schema_rejected` | Security metric | — | **Any occurrence** (EC-13) — pages, and verification is paused pending review |
| `kyc.vendor_latency` | Metric | `p50`, `p95` on `kyc-start` | p95 > 3 s → the disclosure screen's 8 s spinner budget is at risk |
| `kyc.vendor_availability` | Metric (monthly) | `pct` | **< 99.5% monthly** — exercises the Stripe Identity path ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)) |
| `kyc.spend_usd` | Metric | `daily`, `mtd`, `by_purpose` | **> $3,000 / month or > $1,500 / week** — hard alert, not a review. Warning at 70% of the monthly budget |
| `kyc.cost_per_completed_exchange` | Metric (monthly) | `usd` | **> $8.00** — the number that decides whether universal KYC survives ([ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md)) |
| `kyc.budget_capped` | `audit.events` + metric | `waitlisted_users` | Any occurrence → review the cap against real demand within 24 h |
| `kyc.no_id_escalations` | Support metric | `count` | **The equity metric (R49).** > 1% of users who reach the gate → the tiered model conversation is overdue, not optional |
| `verification.expired` | `audit.events` | `days_since_last_activity` | — |
| `kyc.bypass_expiring` | Cron alert | `user_id`, `days_left` | **7 days before any bypass row expires** (R30) |

## 12. Accessibility

- The disclosure screen (R47) is plain text at body size with no icon-only content, is fully readable by a screen reader in one pass, and is **not** a scrollable region inside a fixed-height card — it is the whole screen, so a user at 200% type reads it by scrolling the page rather than a nested box they may not discover.
- The four facts we receive are marked up as a `list` with `accessibilityRole="list"` so a screen-reader user hears "list, four items" and can navigate them, rather than one 60-word sentence.
- The webview is announced on presentation via `AccessibilityInfo.announceForAccessibility`: `Opening Persona's identity check. Sharecropr can't see this screen.` Handing a screen reader to a third-party document with no warning is disorienting; the announcement also sets the correct expectation about who is responsible for what.
- **Persona's own hosted flow is a third-party accessibility dependency we do not control.** It is audited with VoiceOver and TalkBack before each release, and any regression is a vendor escalation with a documented owner. This is stated as a real limitation rather than assumed away — it is also a standing argument in favour of the manual-review path in R49.
- Failure guidance (R45) is a single sentence with one concrete action, announced on appearance and associated with the retry button through `accessibilityLabelledBy`. Corrective advice like "more light" is genuinely unhelpful to a blind user, which is why the terminal state's support path is reachable from the failure screen at every attempt, not only the fifth.
- The attempts-remaining counter is `accessibilityLiveRegion="polite"` and announces once on change, never on every render.
- Every action — `Verify my identity`, `Not now`, `Try again`, `Open Settings`, `Notify me when it's open` — is a labelled button ≥ 44 × 44 dp with a label that reads correctly out of context ([Mobile Architecture §10.3](../01-architecture/02-mobile-architecture.md)).
- The status card on `/(tabs)/profile` never conveys state by colour alone: `Verified`, `Check in progress`, `Not verified yet`, and `Expired` are always words.
- Full flow verified at 200% dynamic type on both platforms; the disclosure screen holds at that size without truncation or clipping.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01 | Network capture across a full verification: no request from any Sharecropr origin carries image bytes; the only image traffic is client → Persona. |
| T02 | integration | R02 | A synthetic vendor payload containing `document_number` and `birthdate` fails the `raw_decision` insert; no table, log, or storage object contains either value afterwards. |
| T03 | integration | R03 | `information_schema` sweep: `public.verifications` has exactly the seven declared columns plus timestamps. CI fails on an added column. |
| T04 | unit | R04 | Each of the 17 forbidden keys individually triggers the CHECK. |
| T05 | integration | R05 | The vendor payload contains `is-over-18` and no date field; `verifications.is_over_18` is set and no DOB is derivable from any stored value. |
| T06 | unit | R06 | `document_country` accepts `US`; rejects `USA`, `US-MI`, and a 3-character value. |
| T07 | integration | R07 | Migration grep: no function signature, error code, or CHECK hardcodes `'persona'` outside the vendor column's own constraint. |
| T08 | integration | R08 | Built Hermes bundle and every EAS build profile are grepped for the Persona key pattern and the signing-secret env name; build fails on a hit. |
| T09 | integration | R09 | No client-reachable route creates a Persona inquiry; the API key is present only in `kyc-start`'s secret environment. |
| T10 | integration | R10 | `kyc-start` response body is asserted key-by-key against the three permitted keys. |
| T11 | unit | R11 | Post-flow inspection of SecureStore, MMKV, the query-cache persister, and the router state finds no `session_token` value. |
| T12 | e2e | R12 | A navigation attempt to a non-Persona origin inside the webview is cancelled and the flow terminates; no JS bridge is registered. |
| T13 | integration | R13 | `attempt_count` is 1 immediately after `kyc-start` returns, before any outcome. |
| T14 | integration | R14 | `kyc-start` returns `not_verified` for an account with `email_confirmed_at IS NULL`, and again for one with no verified TOTP factor. |
| T15 | integration | R15 | Replay of the same idempotency key returns an identical body and leaves `attempt_count` at 1. |
| T16 | integration | R17 | A body-tampered request with a valid-shaped signature returns 401; the comparison is asserted constant-time by a timing distribution over 1,000 requests. |
| T17 | integration | R18 | Timestamps at ±299 s are accepted; ±301 s returns 401. |
| T18 | integration | R19 | The same `webhook_idempotency_key` posted 50 times concurrently produces exactly one `verifications` write and 49 `duplicate` responses. |
| T19 | integration | R20 | A payload missing `status` returns without mutating; an unknown extra field is ignored. |
| T20 | integration | R21 | Requests bearing a valid user JWT, a valid `service_role` key, and no signature all return 401. |
| T21 | integration | R22 | An injected internal error during the write still returns 200 and records the failure for reconciliation. |
| T22 | integration | R23 | `passed` after `revoked` with an earlier `vendor_event_at` is discarded; the row stays `revoked`. |
| T23 | rls | R24 | `POST`, `PATCH`, and `DELETE` on `/rest/v1/verifications` all fail for `authenticated`; `service_role` succeeds. |
| T24 | integration | R25 | A pass sets all six fields, enqueues one notification, and writes one audit row with `action = 'verification.passed'`. |
| T25 | rls | R26 | `listings` INSERT and `create_exchange_request` both return `not_verified` for `status = 'unstarted'` and succeed at `passed`. |
| T26 | e2e | R27 | An unverified account signs up, enrolls 2FA, registers a garden, submits garden verification, browses the map, opens a safe-spot sheet, searches species, and adds an inventory item — all successfully. |
| T27 | rls | R28 | `app.can_transact()` is true for a user in `private.review_bypass_accounts` with a future `expires_at` and false once expired. Bundle and build-profile grep finds no identifier matching `/bypass\|reviewer/i`. |
| T28 | integration | R29 | After granting a bypass row, `verifications.status` is still `unstarted` and `profile_cards.trust_tier` reads `email_verified`. |
| T29 | integration | R30 | A bypass row with `expires_at` beyond 45 days is rejected; creation and deletion each write one audit row; the 7-day alert fires. |
| T30 | rls | R31 | With the client-side gate stubbed out, the server still refuses every gated write. |
| T31 | e2e | R32 | Each of the three gated actions surfaces a sheet whose copy matches the `verification_gate_reason` value. |
| T32 | integration | R33 | `expires_at - verified_at` is exactly 24 months. |
| T33 | integration | R34 | The cron job flips a row past `expires_at` to `expired`, writes audit, and enqueues a notification. |
| T34 | integration | R35 | Reminders are enqueued at exactly −30 d, −7 d, and 0. |
| T35 | integration | R36 | An expired user's `scheduled` session still accepts `confirm_handoff`, `cancel_session`, and `submit_rating`; `create_exchange_request` returns `not_verified`. |
| T36 | integration | R37 | `attempt_count` is 0 after a successful re-verification that followed three prior failures. |
| T37 | integration | R38 | Vendor mocked to 503: status is `pending_vendor`, `attempt_count` unchanged, `failure_reason_code` null, response 502. |
| T38 | rls | R39 | `pending_vendor` does not change `trust_tier` and does not appear in any user-facing failure copy path. |
| T39 | integration | R40 | An inquiry resolved at the vendor but with no webhook delivered is reconciled within one cron interval; a webhook-resolved row is a no-op on reconcile. |
| T40 | integration | R41 | With the ledger at cap, `kyc-start` returns `quota_exceeded` with `details.reason = "capacity"`, creates no inquiry, and stamps `capped_at`. |
| T41 | integration | R43 | The sixth `kyc-start` call returns `quota_exceeded` with `details.reason = "attempts"`; the CHECK rejects a direct write of 6. |
| T42 | unit | R44 | Every code in the mapping table renders its mapped string; an unknown code renders the generic string and emits a Sentry event. No raw code appears in any rendered string. |
| T43 | e2e | R45 | The failure screen shows remaining attempts and exactly one corrective action. |
| T44 | e2e | R46 | At attempt 5 the screen has no retry affordance and does contain the support address. |
| T45 | e2e | R47 | The disclosure screen appears before every inquiry and contains all five required statements. |
| T46 | integration | R48 | Moderation-console and support queries against verification data return only the four permitted fields; a query for a document field has no column to select. |
| T47 | integration | R50 | A `mfa_recovery` inquiry is created with `purpose = 'mfa_recovery'` and a `vendor_account_ref` linking to the original; `verifications.attempt_count` is unchanged and the spend is booked to the recovery line. |
| T48 | manual | R16, R42, R49 | Reviewed on-device and with support; see §13.3. |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| N01 | Forge a webhook with a correct body but no signature header. | 401. No write, no audit row beyond the signature-failure metric. |
| N02 | Forge a webhook with a signature computed over the *parsed and re-serialized* body rather than the raw bytes. | 401. Asserts that the function verifies against the raw body, which is the single most common implementation error in webhook handling. |
| N03 | Capture a legitimate webhook and replay it 6 minutes later. | 401 (outside the 300 s window). Replay at 4 minutes returns 200 `duplicate` and mutates nothing. |
| N04 | Replay a legitimate webhook 1,000 times within the window. | Exactly one write; 999 `duplicate` responses. Kong caps the flood at 600/min. No `verifications` row is written more than once. |
| N05 | Send a signed webhook whose `reference-id` names a *different* user's id. | The function resolves the user through `private.verification_vendor_refs.inquiry_id`, never through a payload-supplied user id. An inquiry not in our table returns `ignored_unknown_inquiry` (EC-01) and writes nothing. |
| N06 | Send a signed webhook for an inquiry that exists but belongs to another user, claiming `passed`. | The write is scoped to the `user_id` recorded at `kyc-start`, not to anything in the payload. The victim's row is unaffected; the attacker's own row is marked passed only if the attacker actually passed. |
| N07 | Attempt `PATCH /rest/v1/verifications?user_id=eq.<me>` with `{"status":"passed"}`. | `42501` — no UPDATE policy exists. Asserted as a pgTAP negative, and again for `POST` and `DELETE`. |
| N08 | Attempt to read another user's `verifications` row. | Zero rows — `verifications_select_own`. Also asserted for `anon`. |
| N09 | Read `private.verification_vendor_refs` through a PostgREST embed (`select=*,refs:verification_vendor_refs(*)`). | `private` is not in `db-schemas`; the relation is not resolvable. Zero grants asserted for `anon` and `authenticated`. |
| N10 | Call `app.has_review_bypass('<other-user>')` from an authenticated session to enumerate reviewer accounts. | `42501` — the function is not granted to `authenticated`. Only `app.can_transact()` reaches it, and that function's answer is a boolean about the caller. |
| N11 | Call `app.verification_gate_reason()` with a user-id argument. | The function takes no parameters. No signature exists that could target another user. |
| N12 | Script 10,000 signups to burn Persona budget. | Blocked at three layers before an inquiry exists: email confirmation, TOTP enrollment (R14), and device attestation (R16); then the 5/day bucket, then the daily budget cap (R41). Spend is asserted bounded in a load test that runs the full script against staging. |
| N13 | Use `kyc-start`'s idempotency key with different arguments to obtain two inquiries for one attempt charge. | `idempotency_conflict` 409 ([API Contract §3.1](../01-architecture/06-api-contract.md)). |
| N14 | Open the hosted flow, then navigate the webview to an attacker-controlled origin to phish credentials in a trusted-looking frame. | Origin allowlist cancels the navigation and terminates the flow (R12). Verified with a redirect chain that ends off-origin. |
| N15 | Extract the Persona session token from the app and reuse it from a different device. | Single use, 15-minute life, and bound to the inquiry. A second use is refused by the vendor. Also asserted: the token is absent from every on-device store (T11). |
| N16 | Reorder webhook delivery to turn a `revoked` account back into `passed`. | Rejected by the `vendor_event_at` guard (R23). Tested by delivering events deliberately out of order. |
| N17 | Verify the same document against two accounts to establish a sockpuppet. | Vendor duplicate detection fails the second; the failure copy is generic (EC-15) so the flow is not an "is this person on Sharecropr" oracle. The duplicate is flagged to moderation. |
| N18 | Use the failure copy as an oracle to learn something about the document holder. | All corrective copy is about *photo quality*, never about the person. The under-18 message is the one exception, is terminal, and discloses only what the user already knows about themselves. |
| N19 | Grant yourself a bypass row through any client-reachable path. | None exists: `private.review_bypass_accounts` has no grants, no RPC writes it, and the runbook path requires `service_role` plus two-person sign-off. Asserted by a migration grep for any `GRANT` on the table. |
| N20 | Ship a debug build with a `SKIP_KYC` flag and get it into production. | CI greps every source file, build profile, and remote-config schema for identifiers matching `/skip.?kyc\|bypass.?kyc\|fake.?verif/i` and fails the build. R28's whole point is that the allowlist is data, not code. |
| N21 | Trigger the `raw_decision` CHECK deliberately with a crafted signed payload, to stop all verifications as a denial of service. | Requires the signing secret, so the attacker is already inside. The response is still 200 (no retry storm), the event pages, and verification pauses — which is the correct failure direction when the alternative is storing document numbers. |
| N22 | Scrape `document_country` across the user base to target a nationality. | Not selectable by any other user: absent from `profile_cards`, absent from every analytics event, and RLS-limited to self and moderator. A moderator query is audited. |
| N23 | Deliver a webhook with a 10 MB body to exhaust the function. | Kong body-size limit rejects before the function; the function additionally caps at 64 KB before HMAC computation. |
| N24 | Time `kyc-start` responses to determine whether a target email has an account. | `kyc-start` requires an authenticated session; there is no unauthenticated surface here at all. The account-existence oracle question belongs to [SPEC-001-N01](SPEC-001-authentication.md). |

### 13.3 Manual QA

- [ ] Complete a real verification end-to-end on a physical iPhone and a physical Android device, with a real document, on the exact build being submitted.
- [ ] Deliberately fail on blur, on glare, and on a cropped document; confirm each maps to its specific corrective sentence and not the generic one.
- [ ] Cancel the flow at the selfie step; confirm the attempt-consumed copy appears and the counter decrements.
- [ ] Deny camera permission at the OS level, enter the flow, and confirm the attempt is refunded (§8.2 permission-denied row).
- [ ] Airplane-mode: confirm the disclosure text renders from the bundle and the verify button is disabled.
- [ ] Point staging at a Persona sandbox configured to 503 and confirm `pending_vendor`, the banner, and an untouched attempt counter.
- [ ] Force the daily budget cap in staging; confirm the capacity copy, the waitlist action, and that already-verified users are unaffected.
- [ ] Run the reviewer bypass end-to-end on the submitted build, on the day of submission, and confirm the account shows `email_verified` and not `id_verified` to a second test account.
- [ ] Audit Persona's hosted flow with VoiceOver and with TalkBack; file any regression with the vendor and record it in the release notes.
- [ ] Verify the disclosure screen at 200% dynamic type on both platforms with no truncation.
- [ ] Confirm the support console shows only the four permitted fields, and run the "user emailed us their ID photo" support macro to check the response copy.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `kyc.gate_enabled` — remote config. Turning it **off** makes `app.can_transact()` skip the verification clause, converting Sharecropr into an unverified marketplace. It exists for one scenario: Persona is down for longer than we can tolerate blocked new users, and Product plus Security jointly accept the risk for a bounded window. It requires two-person activation, writes `audit.events`, and posts to the security channel. `kyc.daily_cap` and `kyc.outage_banner` are ordinary config values. |
| Migration required | Yes — `0004_identity_verification.sql`: the `raw_decision` CHECK, the three added columns on `private.verification_vendor_refs`, `private.kyc_budget_ledger`, `app.has_review_bypass()`, `app.verification_gate_reason()`, and the two `verifications` SELECT policies. |
| Backfill required | No. Greenfield. `public.verifications` rows already exist from the [SPEC-001-R10](SPEC-001-authentication.md) signup trigger with `status = 'unstarted'`. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A broken `kyc-webhook` is stopped by disabling the vendor's webhook endpoint in the Persona console: inquiries continue, outcomes stall at `pending_vendor`, and `kyc-reconcile` applies them when the function is fixed. **That is the designed failure mode and it is why reconciliation exists as a separate path rather than as a retry.** A broken `kyc-start` is stopped by flipping `kyc.daily_cap` to 0, which returns the capacity state rather than an error. |
| Client version floor | 1.0.0. First release. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | [PRD C3](../00-foundation/02-prd.md) describes what we store as "pass/fail, inquiry reference, timestamp, coarse document-country" and omits `is_over_18`, which [Data Model §5](../01-architecture/03-data-model.md) and [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) both include. R03 follows the data model. The PRD sentence should be amended so the three documents enumerate the same four facts. | Product | Before first store submission |
| Q2 | R13 charges an attempt at inquiry creation, so an abandoned flow costs the user one of five. That is honest about our cost and hostile to a user whose phone rang mid-capture. Should the cap be 5 *paid* attempts with abandonment-before-capture refunded, at the cost of a more complex ledger and a new abuse surface? | Product + Security | Post-launch, first 500 verifications |
| Q3 | R49's manual-review path has no published SLA and no staffing model. It is the only answer we offer someone without a government ID, and "we have a process" is not a process. Who owns it, what does it check, and what is the response time? | Product + Legal | Before first store submission |
| Q4 | Should a failed verification be visible to moderators as a risk signal, or does that make `failure_reason_code` a de facto character judgement about people whose documents photograph badly? Currently moderators can read it (`verifications_select_moderator`). | Security + Trust & Safety | Before the moderation console ships |
| Q5 | The 24-month expiry (R33) is copied from [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) and is not derived from anything. Re-verification is a second full-price check against a user who has already proven themselves and has an exchange history. Is a longer expiry with reputation-based renewal defensible? | Security + Product | Month 18, before the first cohort expires |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering — Platform | Initial spec. Approved with Security and Legal sign-off per [Doc Conventions §6](../00-foundation/06-doc-conventions.md). |
