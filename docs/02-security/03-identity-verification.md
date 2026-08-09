# Identity Verification & Trust Tiers

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Security + Trust & Safety

The trust architecture above [SPEC-003](../03-specs/SPEC-003-identity-verification.md) and [SPEC-004](../03-specs/SPEC-004-garden-verification.md). Those specs describe how verification works; this describes what it is for, what it costs, and what it fails to do.

---

## 1. What verification is actually for

It is tempting to say identity verification makes Sharecropr safe. It doesn't. A verified ID does not predict whether someone will behave well at a library car park.

What it does is **raise the cost of anonymity and create traceability**. Someone who harasses a user under a verified identity can be banned in a way that is expensive to circumvent, and if something serious happens, there is a real person to identify. Verification is a deterrent and a forensic tool. It is not a character reference, and the product should never imply that it is.

The distinction matters for copy: the badge says *"ID verified"*, never *"trusted"* or *"safe"*.

---

## 2. Trust tiers

| Tier | How reached | Can browse map | Can register a garden | Can publish a listing | Can send/accept a request | Can message | Badge shown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `unverified` | Signed up | ✅ | ✅ | ❌ | ❌ | ❌ | None |
| `email_verified` | Email confirmed | ✅ | ✅ | ❌ | ❌ | ❌ | None |
| `id_verified` | KYC passed **and** garden verified | ✅ | ✅ | ✅ | ✅ | ✅ | "ID verified" |
| `trusted` | `id_verified` + ≥ 10 completed exchanges + rating ≥ 4.5 + no upheld reports in 180 days | ✅ | ✅ | ✅ | ✅ | ✅ | "Established member" |

Three deliberate choices:

**Verification gates transacting, not browsing.** A new user can install the app, see what's growing nearby, and understand the product before being asked to photograph their driver's licence. Asking for ID at signup would collapse the funnel and, worse, would ask for it before we've earned any trust in return.

**Both KYC and garden verification are required for `id_verified`.** They test different things. KYC says *a real person is behind this account*. Garden verification says *this person actually grows things*. Either alone is weak; together they make a fake account meaningfully expensive.

**`trusted` confers no additional permissions.** It is purely a social signal. A tier that unlocked capability would create an incentive to farm it, which is exactly the dynamic [SPEC-022](../03-specs/SPEC-022-gamification.md) is written to avoid.

---

## 3. The vendor relationship

**Primary: Persona.** Documented alternate: Stripe Identity. Both provide a hosted flow — document capture, authenticity checks, and a liveness selfie — that runs in their surface, not ours.

### 3.1 What each party holds

| Data | Vendor holds | We hold |
| --- | --- | --- |
| Government ID image | ✅ | **Never** |
| Document number | ✅ | **Never** |
| Full date of birth | ✅ | **Never** — only an `is_over_18` boolean |
| Selfie / biometric template | ✅ | **Never** |
| Face-match score | ✅ | **Never** |
| Pass/fail outcome | ✅ | ✅ |
| Inquiry reference | ✅ | ✅ (in `private.verification_vendor_refs`) |
| Document issuing country | ✅ | ✅ (ISO-3166 alpha-2, coarse) |
| Verification timestamp | ✅ | ✅ |
| Failure reason code | ✅ | ✅ (vendor code, not free text) |

> **This asymmetry is the entire reason for choosing a hosted vendor flow.** A breach of Sharecropr's database yields no identity documents, because there are none. We took on a per-verification cost and a vendor dependency specifically to not be the company that leaked ten thousand driver's licences. [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md).

A `CHECK` constraint on `private.verification_vendor_refs.raw_decision` rejects any payload containing image or document-number keys, so a vendor SDK change that starts sending us more data fails loudly rather than silently accumulating liability.

### 3.2 Contractual obligations

| Obligation | Requirement |
| --- | --- |
| Role | Sub-processor under our DPA; listed publicly in the [sub-processor register](04-privacy-and-data-retention.md) |
| Data residency | US processing for US users; documented and disclosed |
| Retention | Vendor-side retention disclosed to users at the point of capture, in their language, before capture |
| Deletion | Vendor must honour a deletion instruction within 30 days of our request |
| Breach notice | To us within 24 hours of discovery |
| Audit | SOC 2 Type II report provided annually |
| Termination | 90 days' notice; export of inquiry references, not documents |
| Sub-processing | No onward sub-processing without notice and a right to object |

### 3.3 Exit portability

Honest assessment: **verification does not port.** If we leave Persona, every verified user must re-verify with the new vendor, because we hold pass/fail and not the underlying evidence — the same design decision that protects users creates the lock-in.

The migration plan is therefore a product plan, not a technical one: run both vendors in parallel, verify new users on the new vendor, and re-verify existing users lazily at their 24-month expiry rather than forcing a re-verification wave. Budget 18 months for a clean transition. This is the real cost of ADR-0010, and it is worth paying.

---

## 4. The garden verification trust chain

```
Camera-only photo (no library import)
  → device location captured at shutter, not chosen
  → EXIF stripped server-side before the asset is readable
  → capture cell compared to declared garden cell (tolerance ~150 m)
  → ML garden-likeness score (advisory)
  → human review
  → gardens.status = 'verified'
```

**How strong is this?** Weaker than it looks, and we should be clear about it internally:

- The distance check is defeated by a mock-location app on a rooted or developer-mode device. Play Integrity and App Attest are Phase 2, not MVP ([THR-22](01-threat-model.md)).
- The photo check is defeated by walking to a neighbour's garden.
- The ML score is a hint. It will confidently score a well-kept flower bed as a vegetable garden and a genuine three-pot balcony as not-a-garden.

What it *does* achieve is that faking a garden requires physically going somewhere with plants and passing a human reviewer, which filters out remote sockpuppet farming — the actual volume threat. It is a friction mechanism, not proof.

The reviewer instruction reflects this: reject only when the photo is clearly not a growing space, and use "request another angle" for anything ambiguous. A false rejection costs us a real gardener; a false acceptance costs us a marginal amount of trust signal.

---

## 5. Bypass surface

| Attack | Cost to attacker | Our control | Residual |
| --- | --- | --- | --- |
| Stolen physical ID | Moderate | Vendor liveness face-match against the document photo | Moderate — works if the attacker resembles the document |
| Purchased ID scan | Low | Liveness defeats a flat scan | Low |
| Deepfaked liveness | Rising, currently moderate | Vendor's injection and presentation-attack detection | **Moderate and worsening.** Contractual for them, reputational for us. A vendor-selection criterion at every renewal. |
| Paid "verification service" (a real person verifies on your behalf) | Low | Device and IP velocity signals; document reuse detection | **Moderate — the hardest one** |
| Household member's ID | Very low | Document reuse detection flags a second account on the same document | Moderate |
| Ban evasion by re-registration | Moderate | `private.verification_vendor_refs` retained **7 years past account deletion** specifically so a returning document is recognisable | Moderate |
| Reviewer-bypass allowlist abuse | Low if leaked | Server-side table, time-boxed `expires_at`, audited, never a build flag | Low |

> **The reviewer bypass deserves a note.** App reviewers will not photograph their driver's licence, and a stalled KYC flow reads as a broken app and gets rejected. The bypass must be a server-side allowlist with an expiry — never a build-time flag, because a build-time flag ships to production and becomes a permanent hole. [SPEC-003-R28](../03-specs/SPEC-003-identity-verification.md).

---

## 6. The equity problem

**A government-ID requirement excludes people.** Not hypothetically — in the United States, single-digit percentages of adults lack a current government photo ID, concentrated among people who are older, poorer, disabled, unhoused, recently immigrated, or who have recently changed their name after a marriage or a gender transition. Several of those groups overlap substantially with the people most likely to benefit from a free source of fresh produce.

This is not a footnote. It is a cost we are choosing to pay, and it should be named as such:

- The requirement is a **product decision to prioritise physical safety over reach**, made because the failure mode on the other side is someone getting hurt.
- It is **regressive**. It excludes some of the people the product would help most.
- It is **not obviously the right call**. A reasonable team could weigh it the other way.

### 6.1 The Phase 2 alternate path

A `trusted`-equivalent tier reachable without government ID:

1. Garden verification passed, plus
2. **Two vouches** from `trusted` members who have each completed an exchange with the user, plus
3. 60 days of account age with no upheld reports, plus
4. Phone verification (weak, but non-zero, and available to people without ID)

Its own abuse risk is obvious: a ring of colluding accounts vouching each other in. Controls — vouchers must have completed exchanges with *different* counterparties, a voucher whose vouchee is later banned loses vouching ability, and vouching is rate-limited to two per voucher per year — reduce but do not eliminate it.

Whether the residual abuse risk is acceptable is a question for a human, not an architect. It is [R-03](../06-roadmap/02-open-risks.md) and needs an explicit recorded decision before Phase 2.

---

## 7. Unit economics

Per-verification pricing sits in a roughly **$1.00–$2.50** band depending on vendor, volume tier, and whether a failed attempt is billed. Assume $1.50 and that **failed attempts bill**.

| Signups | Reach verification (est. 55%) | Attempts at 1.25 avg | Cost at $1.50 |
| --- | --- | --- | --- |
| 10,000 | 5,500 | 6,875 | ~$10,300 |
| 50,000 | 27,500 | 34,375 | ~$51,600 |
| 200,000 | 110,000 | 137,500 | ~$206,000 |

Two things fall out of this table:

**The 55% assumption is doing enormous work and is unvalidated.** If it's 75%, costs rise by a third. If it's 30%, the product has a conversion problem far more serious than the bill. Instrument the funnel from day one.

**The vendor decision may flip at volume.** Persona and Stripe Identity price differently as volume grows and differ on whether failures bill. Model both at the 200k row before signing anything longer than a year.

### 7.1 Cost controls

| Control | Effect |
| --- | --- |
| Verification only offered **after** garden verification passes | Filters out drive-by signups before they cost money — the single highest-leverage control |
| 5 lifetime attempts per account | Caps the worst case per account |
| Velocity limits per IP and per device | Blunts a scripted signup wave |
| Signup rate limit (10/hour/IP) | Upstream of the cost entirely |
| Monthly spend alarm at 130% of forecast | Catches an attack in hours, not at the invoice |
| Daily anomaly alert on inquiry starts | Same, faster |

Even with all of these, **there is no rate limit on a legitimate-looking user wanting to verify**, so the cost is bounded by the signup funnel rather than by policy. That is [R-07](../06-roadmap/02-open-risks.md).

---

## 8. Re-verification and revocation

| Event | Effect |
| --- | --- |
| 24 months since `verified_at` | Status → `expired`. User keeps browsing and inventory; transacting is blocked until re-verified. Notified at 30, 7, and 1 days. |
| Vendor reports a retroactive failure (fraud discovered later) | Status → `revoked`; in-flight exchanges cancelled with a neutral reason; account flagged for moderation review |
| Permanent ban | Status → `revoked`; vendor reference retained 7 years for evasion detection |
| Account deletion | Public verification row deleted; `private.verification_vendor_refs` **retained, pseudonymized**, for fraud defence — disclosed in the privacy policy |
| Vendor outage | New verifications sit in `pending_vendor`; existing verified users are entirely unaffected; signup and browsing continue |

Expiry is deliberately not a hard cliff at 24 months for someone mid-exchange: an expiry that lands between accepting a request and meeting does not cancel the session. It blocks the *next* one.

---

## 9. Threat mapping

| Threat | Control here |
| --- | --- |
| [THR-15](01-threat-model.md) stolen ID | Vendor liveness face-match; 5-attempt cap |
| [THR-16](01-threat-model.md) deepfaked liveness | Vendor capability; renewal criterion; 24-month re-verification |
| [THR-17](01-threat-model.md) ban evasion | 7-year vendor-reference retention; document reuse detection |
| [THR-22](01-threat-model.md) spoofed garden location | Distance check + human review; App Attest in Phase 2 |
| [THR-30](01-threat-model.md) KYC cost attack | §7.1 controls |
| [THR-45](01-threat-model.md) minor on the platform | `is_over_18` enforced through KYC before any transacting |

---

## 10. Open questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Is the 55% verification-conversion assumption right? Everything in §7 depends on it. | Product | Instrument at launch |
| Q2 | Should the Phase 2 alternate path exist at all, given it weakens the one control that makes a physical-meeting product defensible? Needs an explicit human decision, recorded. | CEO + Legal + Security | Phase 2 planning |
| Q3 | Do we require KYC for **both** parties without exception, or does one verified party suffice for an exchange? Currently both. | Trust & Safety | Before launch |
| Q4 | What is our position if a vendor's liveness check is publicly defeated mid-operation? Do we pause transacting? | Security | Before launch |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Security + Trust & Safety | Initial trust architecture |
