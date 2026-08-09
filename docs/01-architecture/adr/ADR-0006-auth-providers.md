# ADR-0006: Auth providers at MVP — email, Apple, Google

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Product, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Signup is the narrowest point in the funnel and Sharecropr's is already long: account, then TOTP enrollment ([ADR-0014](ADR-0014-totp-not-sms.md)), then government-ID verification ([ADR-0010](ADR-0010-kyc-vendor.md)), then garden registration with a photo review. Every additional step before the map compounds. Social sign-in removes the password-creation step and, more importantly, removes the email-verification round trip for two of the three paths.

Three forces bound the choice:

**App Store Guideline 4.8.** If an app offers any third-party login service (Google, Facebook, X, etc.) as its *only* or primary login option, it must also offer an equivalent privacy-preserving option. Sign in with Apple qualifies. In practice, offering Google without Apple on iOS is a rejection. This is not negotiable and not a judgement call.

**Each provider is a permanent surface.** A provider is not a checkbox. It is an OAuth client to register and rotate, a redirect and deep-link configuration, a set of consent-screen review obligations, a data-handling disclosure on both stores' privacy labels, an account-linking edge case matrix, and a login path that can break independently. Adding a provider is cheap on day one and costs forever.

**Identity is verified downstream anyway.** Because every transacting user passes KYC, the sign-in provider carries much less trust weight than in a typical consumer app. A Google account tells us almost nothing; Persona tells us the thing that matters. So the choice of providers is a conversion question far more than a security one.

## Decision

**MVP ships email+password, Sign in with Apple, and Google. Facebook and X are deferred to Phase 2 and require conversion data to justify.**

| Provider | MVP | Platforms | Notes |
| --- | --- | --- | --- |
| Email + password | Yes | Both | Mandatory fallback when a provider is down ([System Architecture §2](../01-system-architecture.md#external-dependencies-and-what-happens-when-they-fail)) |
| Sign in with Apple | Yes | **iOS required**, Android via web flow | Guideline 4.8 |
| Google | Yes | Both | Highest-volume provider |
| Facebook | Phase 2 | — | Deferred |
| X | Phase 2 | — | Deferred; low expected volume, high review friction |
| Phone / SMS OTP | **Never as a factor** | — | See [ADR-0014](ADR-0014-totp-not-sms.md) |
| Magic link | No | — | Deep-link handling plus email-forwarding attacks; not worth it alongside three working paths |

Implementation commitments:

- **All OAuth uses PKCE with the native flow** (`expo-auth-session` / native Apple button), never an embedded webview. Tokens land in `expo-secure-store` ([ADR-0007](ADR-0007-token-storage.md)).
- **Apple's "Hide My Email" is fully supported.** The private relay address is stored and used exactly as a real address; nothing in the product may reject it or require a "real" email. Note the trap: **Apple returns the user's name only on the first authorization**, so `profiles.display_name` must be captured at that moment or it is gone. A user who deletes and reinstalls does not get it back.
- **Apple relay addresses are scoped to the OAuth client ID.** Rotating or changing the Apple client ID orphans every Hide-My-Email account. This is a documented constraint on any future auth migration ([ADR-0004](ADR-0004-supabase.md)).
- **Account linking is by verified email**, and only when the provider asserts the email is verified. An unverified provider email must never merge into an existing account — that is an account-takeover primitive.
- **Password rules:** minimum 12 characters, checked against the HIBP k-anonymity range API, no composition rules, no rotation. Rate-limited at Kong and per-account.
- **Every path terminates in the same session model**, so downstream code never branches on provider.

Password reset, provider unlinking (only when a second credential exists), and re-authentication for sensitive operations are specified in the auth spec, not here.

## Alternatives considered

### Email + password only

**What it is.** One path, no OAuth clients, no store disclosures.

**Why we didn't.** Measurably worse conversion at the exact point where our funnel is already fragile, and it forces password management onto users who will reuse a breached password. The operational simplicity is real but small.

### Social only, no password

**What it is.** Apple + Google, no email path.

**Why we didn't.** A provider outage becomes a total sign-in outage with no fallback, and users who lose access to their Google account lose their Sharecropr account and their exchange history. The email path is a resilience requirement, not a preference.

### Add Facebook at MVP

**What it is.** A fourth provider with genuine reach in the gardening demographic.

**Why we didn't.** Meta's app review for `email` permission is a real process with a video walkthrough and a data-use questionnaire, plus an ongoing platform-terms obligation and an additional third-party data-sharing disclosure on both stores' privacy labels. Apple and Google cover the overwhelming majority of signups. If Phase 2 data shows a meaningful cohort abandoning at the auth screen, we revisit — that is a measurable claim, not a taste one.

### Passkeys / WebAuthn

**What it is.** Platform-bound public-key credentials; phishing-resistant, no shared secret.

**Why we didn't.** Strategically the right destination and the successor to both the password path and possibly TOTP. Not MVP because cross-platform recovery is still awkward, Supabase GoTrue support is not mature enough to be a primary path, and adding a fourth mechanism to an already long onboarding funnel is the wrong place to experiment. Explicitly flagged as the likely superseding decision.

## Consequences

### Positive

- Three working paths, so no single provider outage locks users out.
- Apple + Google covers the practical majority of mobile signups with no password to create or remember.
- Guideline 4.8 satisfied on the first submission rather than after a rejection.
- Fewer providers means a smaller privacy-label disclosure and fewer third parties in the data-flow diagram — relevant to a product that markets itself on privacy discipline.
- No SMS anywhere in the auth system, which also means no SMS pumping fraud and no per-message cost.

### Negative

- Users who habitually use Facebook login see an unfamiliar screen and some will abandon. We are choosing to eat that.
- Apple's one-shot name return is a genuine footgun; get it wrong and profiles are permanently nameless.
- Sign in with Apple on Android goes through a web flow that is noticeably clunkier than the native sheet.
- Three paths means the account-linking matrix has real edge cases (same email, different providers; provider email changes; unlink-last-credential) and each needs a test.

### Neutral / accepted costs

- OAuth client secrets and Apple key rotation are calendar items, not code. They belong in the runbooks.
- Password-reset flow must exist and be tested even though most users will never use it.
- Provider-specific deep-link configuration must be re-verified after any Expo SDK upgrade.

## The strongest argument against this decision

Deferring Facebook is a decision made from architectural taste rather than user data, and the user data we do have points the other way. Sharecropr's target user is not a twenty-five-year-old; it is a home gardener, skewing older, and that demographic's default social identity is disproportionately Facebook — it is where garden clubs, seed swaps, and neighbourhood plant groups actually live, and it is plausibly our best organic acquisition channel. Someone arriving from a Facebook gardening group, tapping a link, and being asked to create a password or use a Google account they associate with work is being asked to switch identity contexts at the highest-friction moment in the funnel. Meta's app review is two days of work, once. Trading a permanent conversion loss in our core demographic for two days of avoided integration work is the kind of trade that looks disciplined in a document and looks like a mistake in a funnel chart. And the reasoning is a little self-serving: "each provider is a permanent surface" is true, but the surface for a provider we have already built the generic OAuth plumbing for is thin — it is a client registration, a button, and a row in the linking matrix.

We accept the risk because the cost of being wrong is bounded and recoverable: add the provider in Phase 2, existing users link it, nobody is stranded. But this should be decided by the auth-screen abandonment number below, not by re-arguing it.

## Revisit when

- **Auth-screen abandonment exceeds 15%** of users who reach it, or the email+password path exceeds **40%** of signups (indicating the offered providers do not match our users).
- Post-launch survey or support data shows **>10%** of signup complaints referencing a missing provider.
- Any provider's sign-in error rate exceeds **2%** of attempts over a 7-day window.
- Apple changes Guideline 4.8, or ships a change to relay-address scoping.
- Supabase GoTrue ships production-grade passkey support **and** cross-device recovery is unambiguous — at which point passkeys likely supersede both the password path and part of [ADR-0014](ADR-0014-totp-not-sms.md).
- We enter a market where a different provider dominates (e.g. Kakao, LINE), which would arrive with localization work anyway.

## Related

- [ADR-0007 Token storage](ADR-0007-token-storage.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md), [ADR-0014 TOTP not SMS](ADR-0014-totp-not-sms.md), [ADR-0004 Supabase](ADR-0004-supabase.md)
- [PRD §C1](../../00-foundation/02-prd.md), [System Architecture §2](../01-system-architecture.md#2-system-context), [Data Model §5](../03-data-model.md#5-identity--profiles)
