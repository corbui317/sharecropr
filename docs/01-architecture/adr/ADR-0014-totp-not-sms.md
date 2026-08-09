# ADR-0014: TOTP-only 2FA, no SMS

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Security, Product |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr requires 2FA for every account. That is unusual for a consumer app about vegetables, and it follows from what an account compromise actually yields here: the attacker can read the victim's own exact garden coordinates via `rpc.get_my_garden_location()`, read message threads with named counterparties, see scheduled exchange times and locations, and — most dangerously — *impersonate the victim in an arranged meeting with a real person who is expecting them*. That last one has no analogue in a normal consumer breach. This is an account whose compromise puts a third party in a parking lot with a stranger.

SMS is the default second factor because it is the one users already understand. It is also the one with a well-documented, industrially-exploited failure mode: **SIM swap**. An attacker socially engineers a carrier into porting the victim's number to their own SIM, and every SMS code goes to them. This is not theoretical or rare; it is a commodity attack with a known price, and carriers remain the weak link because the control is a customer-service representative's judgement. NIST SP 800-63B deprecated SMS as a restricted authenticator for exactly this reason.

The relevant comparison is not "SMS versus TOTP in the abstract" but "what does defeating each factor cost the attacker we care about." Our threat model ([Location Privacy §1](../04-location-privacy.md#1-the-threat-we-are-defending-against)) names the stalker and the ex-partner. That attacker is targeted, patient, and — critically — often has the personal information a carrier uses to authenticate a port request, because they know their victim. SIM swap is not a generic risk for this attacker; it is the most accessible attack they have.

There is also a secondary consideration that would be sufficient on its own: SMS means phone numbers, phone numbers mean a P1 PII column with a retention obligation, and outbound SMS means per-message cost and exposure to SMS pumping fraud — a scaled version of the same unit-economics problem as [ADR-0010](ADR-0010-kyc-vendor.md).

## Decision

**TOTP (RFC 6238) is the only second factor. SMS is not offered, not as a primary factor, not as a fallback, not for account recovery.**

| Element | Rule |
| --- | --- |
| Algorithm | TOTP, SHA-1, 6 digits, 30 s period — the interoperable profile every authenticator app supports |
| Enrollment | Mandatory before a user can transact. QR code plus a manual secret string |
| Drift tolerance | ±1 period (90 s total window) |
| Verification rate limit | **5 attempts per 15 minutes** per account, then a 1-hour lockout. Enforced server-side in GoTrue and at Kong |
| Secret storage | Supabase GoTrue MFA factors. **Never on the device**; the device holds enrollment state only ([ADR-0007](ADR-0007-token-storage.md)) |
| Recovery codes | **10 single-use codes**, shown exactly once at enrollment, stored as hashes. Regenerable from an authenticated session |
| Step-up | Re-verification required for: changing garden location, disabling 2FA, changing email, account deletion |
| Phone numbers | **No phone number column exists** in `public.profiles`. Adding one requires an ADR |
| Recovery without codes | Human review, mandatory cooling-off, and re-verification through Persona. Never automated, never fast |

The recovery path is the honest weak point and is designed deliberately slow. A user who loses both their authenticator and their recovery codes submits a request; the account enters a **72-hour hold** during which its existing sessions remain valid and a notice is sent to the registered email; recovery then requires passing a fresh Persona inquiry matching the original verification. The hold and the notification exist so that a hijack attempt is visible to the real owner before it succeeds. This is friction on purpose — recovery is the attack surface that replaces the factor.

## Alternatives considered

### SMS as the primary second factor

**What it is.** OTP delivered to a phone number.

**Why we didn't.** SIM swap, against a threat actor who knows the victim personally and therefore knows their carrier security answers. Adding a P1 phone number column, per-message costs, SMS pumping exposure, and international delivery unreliability are all secondary reasons that would not have been enough on their own.

### SMS as an optional fallback alongside TOTP

**What it is.** Offer both; let the user choose.

**Why we didn't.** **A fallback factor sets the security level, not the primary one.** An account with TOTP *and* SMS enabled is an account defeated by SIM swap — the attacker simply chooses the weaker path. Offering both is offering SMS with extra marketing. This is the option that will be proposed when support tickets pile up, and it is the one to refuse.

### Email OTP as the second factor

**What it is.** Code to the registered email address.

**Why we didn't.** For accounts where email is also the primary credential or the password-reset channel, this is one factor wearing two hats. It is meaningfully better than SMS against SIM swap and meaningfully worse than TOTP against credential stuffing and mailbox compromise. Retained only as a signal channel — recovery *notifications* go to email; recovery *authorization* does not.

### Passkeys / WebAuthn instead of password + TOTP

**What it is.** Platform-bound public-key credentials; phishing-resistant; no shared secret; biometric-gated.

**Why we didn't.** Better than everything here on security and on UX, and it is the likely successor. Not MVP because Supabase GoTrue support is not mature enough for a mandatory factor, cross-device and lost-device recovery still bottom out in a platform account we do not control, and making it mandatory on an already long onboarding funnel ([ADR-0010](ADR-0010-kyc-vendor.md)) is too much change at once. Explicitly flagged as the superseding decision.

### Push-based approval (our own app as the authenticator)

**What it is.** Approve-this-login prompt via Expo Push.

**Why we didn't.** Push is explicitly best-effort in this architecture ([System Architecture §2](../01-system-architecture.md#external-dependencies-and-what-happens-when-they-fail)) — the in-app inbox is the durable record. A factor that depends on best-effort delivery is a factor that locks users out on a bad day. It also does not work for the first sign-in on a new device, which is the case that matters.

### No 2FA at all

**What it is.** Password plus KYC only.

**Why we didn't.** Credential stuffing against reused passwords is the single most common account compromise vector, and KYC verifies the person at signup, not the session. Given what a compromised session can do here, this is not a defensible floor.

## Consequences

### Positive

- **SIM swap is not an attack path against Sharecropr.** The single most relevant attack for our named threat actor is structurally unavailable.
- No phone numbers collected, so no phone-number PII to protect, retain, or breach, and one fewer field in the privacy disclosure.
- Zero per-authentication cost and no SMS pumping exposure — meaningful given zero revenue ([ADR-0002](ADR-0002-barter-only.md)).
- Works offline and internationally; no carrier dependency, no delivery failures, no roaming issues.
- Standard TOTP means users can use any authenticator they already trust, including a hardware token.

### Negative

- **Recovery-code support burden is the real cost of this decision, and it is significant.** Users lose phones. Users skip the recovery-code screen. Users screenshot the codes into a photo library on the phone they then lose. Every one of those becomes a manual, human-reviewed, 72-hour recovery with a re-verification fee we pay to Persona.
- Enrollment friction at signup: "install an authenticator app" is a genuine barrier for users who have never used one, arriving in a funnel that already includes ID verification.
- Users who do not have or want a second app on their phone have no alternative. There is no lighter option by design.
- Clock drift on a device with a badly wrong time causes verification failures that look like server errors to the user.

### Neutral / accepted costs

- Enrollment UX must be unusually good: an explanation of why, a link to recommended authenticator apps, and a recovery-code screen the user cannot skip past without an explicit confirmation.
- Recovery is a documented human runbook, not a feature.
- Support tooling needs a recovery-request queue with the hold timer visible.

## The strongest argument against this decision

Mandatory TOTP on a consumer app about trading vegetables is a security control calibrated for a bank, applied to a product whose users are gardeners, and it is very likely that the number of accounts we protect from SIM swap is smaller than the number of users we lose at the enrollment screen — and smaller still than the number we permanently lock out when they get a new phone and discover their authenticator did not migrate. That last group is the one that should worry us most, because their failure is total and it is our fault: they did nothing wrong, they lost a phone, and the account holding their exchange history and their reputation is now behind a 72-hour hold and a second ID verification. Every one of them is a user who churns and tells people the app is a hassle. Against that, SIM swap is a targeted attack requiring a motivated adversary to social-engineer a carrier — and if we genuinely have an adversary that determined and that personally connected to a victim, that adversary has better routes to their target than compromising a produce-barter account, starting with the fact that they probably already know where the victim lives.

The stronger form of the objection is about proportionality across the whole design. We have stacked mandatory TOTP on top of mandatory KYC on top of a mandatory safe-spot meeting, and each control was justified in isolation against the worst-case incident. Compounded, they produce an onboarding funnel that only the most motivated users complete — which in a network-effects product means the network may never form, at which point every control is protecting nobody. A defensible alternative is TOTP *optional but strongly encouraged*, mandatory only for the actions that actually carry risk (arranging an exchange, changing garden location), letting users browse and build inventory without it. That preserves the protection where it matters and removes it from the funnel's narrowest point.

We keep it mandatory because the compromised-account harm here is not financial and not reversible — it is a real person meeting an impostor at an arranged time and place — and because a step-up-only design means the factor is enrolled under time pressure at the exact moment the user is trying to do something, which is when people choose the weakest option available. But the enrollment drop-off number below is the one that should decide this, and if it comes in high, the step-up-only variant is the first thing to try.

## Revisit when

- **TOTP enrollment drop-off exceeds 20%** of users who reach the step.
- **Account recovery requests exceed 2% of active accounts per month**, or the recovery queue exceeds **20 open requests**, or median recovery handling time exceeds **30 minutes of staff effort** per request.
- Recovery-related Persona re-verification spend exceeds **$200/month** — this couples directly to [ADR-0010](ADR-0010-kyc-vendor.md)'s unit economics.
- Supabase GoTrue ships production-grade passkey support with a clear cross-device recovery story. Passkeys likely **supersede** this ADR rather than amend it.
- Any credible proposal to add SMS: **new ADR, security sign-off, no exceptions.** "Just as a fallback" is the failure mode this ADR exists to prevent.
- A confirmed account compromise occurs despite TOTP — investigate the vector before assuming the factor is the problem; credential phishing of a TOTP code is possible and points at passkeys, not at SMS.

## Related

- [ADR-0006 Auth providers](ADR-0006-auth-providers.md), [ADR-0007 Token storage](ADR-0007-token-storage.md), [ADR-0009 Safe spots only](ADR-0009-safe-spots-only.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md)
- [System Architecture §2](../01-system-architecture.md#2-system-context), [Location Privacy §1](../04-location-privacy.md#1-the-threat-we-are-defending-against), [Data Model §5](../03-data-model.md#5-identity--profiles)
