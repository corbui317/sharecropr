# ADR-0010: Persona hosted flow for identity verification

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security, Product, Legal |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr requires government-ID verification before a user can transact. That requirement comes from [ADR-0009](ADR-0009-safe-spots-only.md)'s companion premise: if we are introducing strangers who will meet in person, we should know that each of them is a real, adult, non-recycled identity, and that a banned user cannot return under a new email in ten minutes. Verification is the only control that raises the cost of account recreation above zero.

That decision immediately creates the single worst data-custody problem in the product. Government ID images and selfies are the most sensitive data class we could possibly hold — worse than the home coordinates, because coordinates are useful only locally while an ID image is useful to a fraudster anywhere. Under most US state biometric and personal-information statutes, and under GDPR Article 9 if we ever touch the EU, a selfie used for identity matching is biometric data with its own consent, retention, and breach-notification obligations.

We have two to four engineers and no security team. We are not going to build document authentication, liveness detection, or a hardened image store, and we should not hold the inputs to any of them.

There is also a cost problem that is easy to underestimate. Per-verification pricing lands in the **$1.00–$2.50** range at low volume for a document-plus-selfie flow. Every signup that reaches verification costs money whether or not that user ever completes an exchange, and Sharecropr has no revenue ([ADR-0002](ADR-0002-barter-only.md)). This is unit economics with a zero in the numerator.

## Decision

**Use Persona's hosted flow. Store pass/fail plus an opaque inquiry reference. Never receive, store, or proxy an ID image.**

### Data boundary

```
public.verifications        →  status, is_over_18, document_country, verified_at,
                               expires_at, failure_reason_code, attempt_count
private.verification_vendor_refs → vendor, inquiry_id, webhook_idempotency_key, raw_decision
```

**What we never store:** ID images, document numbers, full date of birth, selfie images, biometric templates, address from the document. `is_over_18` is a boolean, not a date. `document_country` is ISO-3166-1 alpha-2 and nothing finer. `raw_decision` carries a `CHECK` on key presence that rejects any payload containing image or document-number keys ([Data Model §5](../03-data-model.md#5-identity--profiles)).

### Flow

The images go **user → Persona** and never traverse our infrastructure ([System Architecture §5.3](../01-system-architecture.md#53-verification-webhook)):

1. App calls Edge Function `kyc-start`; the function creates an inquiry with a server-side API key and writes `private.verification_vendor_refs`.
2. App receives a one-time session token only, and opens Persona's hosted flow in an embedded webview.
3. Persona POSTs a webhook to `kyc-webhook`, HMAC-signed. The function verifies the signature in constant time, checks the replay window and idempotency key, and updates `public.verifications.status`.
4. Realtime pushes the result to the user's channel.

### Controls

| Control | Value |
| --- | --- |
| `attempt_count` | Hard cap of **5**, enforced by `CHECK`. Primarily a cost control, secondarily an abuse control |
| Re-verification | Every **24 months** (`expires_at`) |
| Reviewer accounts | `private.review_bypass_accounts` — a server-side, time-boxed allowlist. **Never a build flag**, because a build flag ships to production |
| Vendor abstraction | `verification_vendor_refs.vendor` is `'persona' \| 'stripe_identity'` from day one. The schema does not assume a vendor |
| Gate placement | Verification is required to **transact**, not to browse. Users see the map and inventory first |
| Failure handling | Vendor outage → `pending_vendor`; signup continues, existing verified users unaffected |

### Documented alternate

**Stripe Identity is the pre-approved fallback**, integrated behind the same boundary. The enum value already exists. Switching vendors is an Edge Function change plus a webhook contract, not a schema migration — this is deliberate and is the main reason the abstraction exists before we need it.

## Alternatives considered

### Stripe Identity as primary

**What it is.** Comparable hosted document+selfie verification, similar per-check pricing, excellent docs.

**Why we didn't.** Close call, and it remains the documented alternate. Persona wins on configurability of the verification *policy* — we want a light flow (document + selfie, no database checks, no address verification) and Persona's inquiry templates express that granularity better, which matters because every additional check is both cost and collected data we do not want. Persona's webhook and idempotency semantics are also more explicit. Stripe Identity's advantage is being Stripe, which is worth less to us given [ADR-0002](ADR-0002-barter-only.md) means we will never have a Stripe account for anything else.

### SDK integration instead of hosted flow

**What it is.** Native SDK captures the document in our app and uploads to the vendor.

**Why we didn't.** Better UX — no webview, native camera, fewer drop-offs. Rejected because the image transits our process. Even if we never persist it, it exists in our app's memory and potentially in a crash dump, a screenshot, or a Sentry attachment. "We handle biometric data but promise not to keep it" is a materially worse legal and breach-notification position than "biometric data never reaches us." This is the whole point of the decision and we are paying real conversion for it.

### Build it ourselves

**What it is.** OCR, MRZ parsing, document authentication, liveness detection.

**Why we didn't.** Not a serious option at this team size. Document fraud detection is an adversarial ML problem with full-time teams behind it, and doing it badly is worse than not doing it — it provides false assurance while creating maximal custody risk.

### No KYC — email verification plus community reputation

**What it is.** Skip identity entirely; rely on ratings, reports, and blocks.

**Why we didn't.** Ratings only work if identity is expensive to recreate. Without KYC, a banned harasser is back in ten minutes with a new email and a clean rating history, and every ban is a speed bump. Given that the product ends in a physical meeting, that is not an acceptable trust floor. **This is nonetheless the most serious alternative** and it is the one the unit-economics risk below may force us toward, in the tiered form.

### Phone verification instead of ID

**What it is.** SMS OTP as a weak identity anchor.

**Why we didn't.** Cheap and genuinely raises recreation cost somewhat. But burner and VoIP numbers are trivially available, it verifies nothing about age or realness, and it drags SMS into the product — which [ADR-0014](ADR-0014-totp-not-sms.md) rejects on independent grounds.

## Consequences

### Positive

- **We never possess ID images, document numbers, or biometric templates.** The worst breach we can suffer does not include them.
- Regulatory posture is dramatically simpler: no biometric data controller obligations, no ID-image retention schedule, no separate breach-notification class.
- Identity recreation is expensive, so bans have teeth and ratings mean something.
- `is_over_18` without a date of birth satisfies the age requirement while minimizing collection.
- Vendor swap is a function change; the schema is already vendor-neutral.
- Verification gates transacting, not browsing, so users see value before hitting the wall.

### Negative

- **Cost scales with signups, and signups produce no revenue.** Detailed below; this is the highest-severity consequence in this ADR.
- Webview handoff is a conversion drop. Users are asked to photograph a government ID inside an app they installed to trade zucchini, and a meaningful fraction will not.
- Excludes people without government ID — a real equity cost, disproportionately affecting the users least served by other systems.
- Third party in the critical onboarding path. Persona down means new users cannot complete verification.
- We are trusting Persona's own retention and security practices, and our users are trusting them transitively.

### Neutral / accepted costs

- Support cannot resolve a verification failure by looking at the document, because we do not have it. Failures resolve as retry-or-escalate-to-vendor.
- `failure_reason_code` is a vendor code, so support tooling needs a code-to-explanation mapping maintained per vendor.
- App-store reviewers need a bypass account, provisioned server-side with an expiry, per submission.

### Unit-economics risk — stated explicitly

| Scenario | Signups reaching KYC | Cost @ $1.50 | Cost @ $2.50 |
| --- | --- | --- | --- |
| Launch month, 2 metros | 3,000 | $4,500 | $7,500 |
| Steady state, 2 metros | 1,500 / mo | $2,250 / mo | $3,750 / mo |
| Viral spike (press hit) | 25,000 in a week | $37,500 | $62,500 |
| Year one, 60k verified | 60,000 | $90,000 | $150,000 |

Against **zero revenue**. Two structural exposures follow:

1. **A growth spike is a bill, not a win.** Uncontrolled virality is a five-figure surprise in a week. Mitigation: a **daily verification budget cap** with a waitlist beyond it, plus an alert at 70% of the monthly budget. Rate-limit `kyc-start` per IP and per device.
2. **Abuse is directly monetized against us.** Someone scripting signups costs us real money per attempt. Mitigation: `attempt_count ≤ 5`, device attestation before `kyc-start`, and email verification as a prerequisite.

If cost per *completed exchange* — not per signup — exceeds the thresholds below, the tiered trust model in Phase 2 replaces universal KYC.

## The strongest argument against this decision

We are spending our scarcest resource on the wrong problem, at the worst point in the funnel. Universal ID verification means we pay $1.50–$2.50 for every curious person who downloads the app, including the large majority who will verify, look around, find nothing they want, and never come back — and under [ADR-0002](ADR-0002-barter-only.md) we recover none of it, ever. That is a business model where growth is a liability. Worse, the verification wall sits at exactly the point of maximum drop-off: a user has installed the app, made an account, set up TOTP, and is now asked to photograph a driver's licence before seeing whether anyone nearby has anything they want. In a network-effects product, early liquidity is everything, and we have installed the most aggressive possible filter precisely when we most need volume. The friction is not merely conversion loss — it is *selective* conversion loss, filtering hardest against exactly the users a neighbourhood produce-sharing network should serve: people without a current licence, recent immigrants, older users uncomfortable photographing documents.

And the security benefit is softer than it looks. KYC proves a real person completed a flow once. It does not prevent no-shows, misrepresented produce, harassment, or a verified person behaving badly — all of which are the actual observed harms in peer-to-peer exchange, and all of which the ratings and reports system handles. Its real function is making bans expensive, and there are cheaper ways to get most of that: device attestation, a cooling-off period on new accounts, exchange limits until reputation accrues. A tiered model — browse freely, transact after email plus device attestation, unlock higher-value or higher-volume exchange after ID — would deliver most of the deterrence at a fraction of the cost and a fraction of the funnel damage. We chose the maximal control because the downside of being wrong about safety is catastrophic and the downside of being wrong about conversion is merely fatal-but-slow, and reasonable people would make the opposite call.

## Revisit when

- **Verification spend exceeds $3,000 in any month** or **$1,500 in any week** — hard alert, not a review.
- **Cost per completed exchange exceeds $8.00**, measured monthly. This is the number that decides whether universal KYC survives; it is the ratio of verification spend to completed exchanges, and it is the honest measure of whether we are paying for value or for tourists.
- **KYC-step drop-off exceeds 35%** of users who reach it, or completion falls below **60%** in any cohort.
- **[PRD assumption A1](../../00-foundation/02-prd.md) (users will accept ID verification to transact) is invalidated** by the assumption register — fall back to the [Phase 2 tiered trust model](../../06-roadmap/01-roadmap.md).
- Persona availability drops below **99.5%** monthly, or a pricing change exceeds **20%**, at which point the Stripe Identity path is exercised.
- Any jurisdiction we operate in adopts a rule that makes hosted-flow delegation insufficient for our obligations.
- Persona suffers a breach involving our users' documents. We hold pointers, not images — but we still own the user relationship and the notification.

## Related

- [ADR-0002 Barter only](ADR-0002-barter-only.md), [ADR-0006 Auth providers](ADR-0006-auth-providers.md), [ADR-0008 Edge Functions](ADR-0008-edge-functions.md), [ADR-0009 Safe spots only](ADR-0009-safe-spots-only.md)
- [System Architecture §5.3](../01-system-architecture.md#53-verification-webhook), [Data Model §5](../03-data-model.md#5-identity--profiles), [RLS Design §9](../05-rls-design.md#9-proof-obligations)
