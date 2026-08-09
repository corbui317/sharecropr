# Glossary

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Product

Canonical vocabulary. These terms mean exactly this in specs, code, database columns, and user-facing copy. Where a term has a different meaning to users than to engineers, both are given.

**Using a synonym instead of the canonical term is a review comment.** Vocabulary drift is how two engineers build two subtly different features.

---

## Product terms

| Term | Definition |
| --- | --- |
| **Exchange** | A completed or in-progress trade of crops between two users. Never "transaction" (implies money), never "sale", never "order". |
| **Exchange request** | An expression of interest against a listing, before acceptance. Table: `exchange_requests`. |
| **Exchange session** | The object representing an actual in-person meeting, created on acceptance. Table: `exchange_sessions`. Distinct from the request — see [State Machine §1](../01-architecture/07-exchange-state-machine.md). |
| **Safe spot** | A curated public location where exchanges happen — library, police station lobby, town hall, community centre, college campus, fire station, farmers' market site, park pavilion. Two words, never "safespot" or "meetup point". |
| **Handoff** | The physical moment of exchange at a safe spot. |
| **Handoff code** | The shared six-digit code both parties enter to confirm the handoff. A **coordination device, not an anti-fraud control** — never describe it as the latter. |
| **Listing** | An inventory item published and offered for exchange at one to three safe spots. |
| **Inventory item** | Something a user has, whether or not it is offered. Private by default. |
| **Garden** | A user's growing space. One per user in MVP. The location of a garden is the most sensitive data in the system. |
| **Surplus** | Crops beyond what a household will use. The product's reason for existing. |
| **Wishlist** | Species a listing owner is hoping to receive. Drives match suggestions. Not a shopping list. |
| **Barter** | Goods for goods. **No money is ever involved**, anywhere, ever. |

---

## Trust and identity

| Term | Definition |
| --- | --- |
| **Trust tier** | One of `unverified`, `email_verified`, `id_verified`, `trusted`. See [Identity Verification §2](../02-security/03-identity-verification.md). |
| **Trust score** | An internal 0–100 composite. **Never shown to users as a number** — only as a tier badge. Column-revoked from `authenticated`. |
| **ID verified** | Passed the third-party KYC flow **and** garden verification. The badge says "ID verified", never "trusted" or "safe". |
| **Verification (KYC)** | Third-party identity verification via Persona. We store pass/fail and an inquiry reference. **Never ID images, document numbers, or full date of birth.** |
| **Garden verification** | Camera-only geotagged photo plus a distance check plus human review. A friction mechanism, not proof. |
| **Can transact** | The composite gate: verified, not suspended, garden verified. Function: `app.can_transact()`. |
| **Step-up auth (AAL2)** | Requiring TOTP proof for a sensitive operation within the current session. |
| **Break-glass** | The two-person, time-boxed, fully audited procedure for reading exact coordinates. See [Location Privacy §10](../01-architecture/04-location-privacy.md). |
| **Reviewer bypass** | A server-side allowlist letting app-store reviewers skip KYC. **Never a build flag** — a build flag ships to production. |

---

## Location and privacy

| Term | Definition |
| --- | --- |
| **Exact point** | A garden's true coordinate. Lives only in `private.garden_locations.exact_point`. Class **P0**. Never leaves the database in raw form. |
| **Display point** | The fuzzed coordinate derived from the exact point — 400–1200 m offset, deterministic. Column: `gardens.display_point`. |
| **Fuzz seed** | The stable per-garden UUID that makes fuzzing deterministic. **This is what defeats the averaging attack.** Never leaves `private`. |
| **Averaging attack** | Reading a naively-fuzzed point many times and averaging the noise away to recover the true location. Defeated by the stable fuzz seed. |
| **H3** | Uber's hexagonal geospatial index. Resolution rules: **r5** for analytics, **r7** may be exposed, **r9 never leaves the server**. |
| **Cell-boundary recall** | The silent bug where querying one H3 cell instead of a disk makes users near a cell edge see fewer results. |
| **PII class** | P0 (critical: exact location, identity documents), P1 (sensitive: email, meeting times), P2 (personal: display name, ratings), P3 (non-personal). |
| **Scrubbing** | Removing coordinates, credentials, and message content from telemetry before it leaves the device or server. |

---

## Architecture

| Term | Definition |
| --- | --- |
| **RLS** | Row-Level Security. **The** authorization layer — there is no service tier that could enforce access control instead. |
| **FORCE RLS** | `FORCE ROW LEVEL SECURITY`. Required alongside `ENABLE`, because without it the table owner bypasses policies silently. |
| **Definer function** | A `SECURITY DEFINER` Postgres function. Runs as its owner and therefore **bypasses RLS**, so it must re-check authorization as its first action. |
| **Definer allowlist** | The reviewed list of functions permitted to read `private`. Enforced in CI. |
| **`private` schema** | The schema no client role has any privilege on. Holds exact coordinates and vendor references. The keystone of the privacy model. |
| **`app` schema** | Holds `SECURITY DEFINER` helper functions. `EXECUTE` granted per-function, never wholesale. |
| **Transactional outbox** | `private.notification_outbox`. Notifications are written in the same transaction as the state change and drained separately, so an HTTP call never happens inside a database transaction. |
| **Transition guard** | The trigger enforcing the legal state-transition table at the storage layer, independent of the RPCs. |
| **Lock order** | The global ordering `listings → exchange_requests → exchange_sessions`. Violating it produces deadlocks. |
| **Expand → migrate → contract** | The three-phase migration pattern. The contract phase is gated on production adoption. |
| **MapCanvas** | The single file importing `react-native-maps`. The isolation seam that makes the Mapbox fallback affordable. |
| **Negative test** | A test proving the system **refuses**. Counted separately in CI; must outnumber positives per RLS file. |
| **Location invariant suite** | LP-01 … LP-13. The tests enforcing that no coordinate escapes. Owned by Security. |
| **Location canary** | The production job every 15 minutes verifying that user A cannot read user B's garden. Verifies what we deployed, not what we intended. |

---

## Trust & Safety

| Term | Definition |
| --- | --- |
| **Report** | A user-submitted flag against a user, listing, message, or session. Six categories plus severity. |
| **Severity 1** | `unsafe_meeting` or `underage`. **Pages on-call rather than queueing.** 1-hour SLA. |
| **Block** | One-directional as an action, bidirectional in effect. Tears down the thread and cancels in-flight exchanges. **The blocked user is never told.** |
| **Teardown** | The cascade triggered by a block: thread closed, session cancelled, requests cancelled, mutual invisibility. |
| **Double-blind rating** | Neither party sees the other's rating until both submit or seven days pass. Kills retaliatory rating. |
| **Enforcement ladder** | The eight rungs from no-action to law-enforcement referral. |
| **Two-person rule** | Permanent bans and law-enforcement referrals require a second moderator. The proposer cannot approve their own proposal. |
| **Content scan** | The Edge Function flagging addresses, phone numbers, and payment solicitations in messages. **Detection, not prevention** — and it is a measurement instrument for [R-09](../06-roadmap/02-open-risks.md) as much as a moderation tool. |
| **Appeal** | Review of an enforcement action by a moderator who is **never** the original actor. |

---

## Crop taxonomy

| Term | Definition |
| --- | --- |
| **Kingdom** | Top level: Plant, Fungus. |
| **Category** | Culinary grouping: Vegetable, Fruit, Herb, Leafy Green, Root, Legume, Grain, Nut, Flower, Mushroom. |
| **Species** | e.g. Tomato, Zucchini, Basil. Curated. **Users cannot create these.** |
| **Variety** | e.g. Cherokee Purple, Black Beauty. Users may propose one under an existing species. |
| **Culinary vs botanical** | **Culinary is authoritative for browsing.** A tomato is a fruit botanically and a vegetable in every kitchen; the botanical fact is retained as metadata. Getting this backwards makes the app feel broken to normal people. |

---

## Operations

| Term | Definition |
| --- | --- |
| **EAS Update** | Over-the-air JS-only update. **Never used to change what the app does with permissions or personal data.** |
| **Contract floor** | The app version below which a destructive migration is unsafe. Enforced in CI against real `devices.app_version` data. |
| **Preview environment** | An ephemeral Supabase branch project plus EAS channel, per PR. |
| **Production-shaped** | Staging data matching production's volume and distribution, entirely synthetic. |
| **Soak** | The mandatory 24 hours a release candidate spends on staging. |
| **Quarantine** | Automatic removal of a Maestro flow exceeding a 2% failure rate over 30 days. |

---

## Words we deliberately don't use

| Avoid | Use | Why |
| --- | --- | --- |
| Transaction, sale, order, purchase, buyer, seller | Exchange, listing owner, requester | Implies money. There is none. |
| Safe (of a user) | ID verified | We do not and cannot certify that a person is safe |
| Friend, follow, connection | Counterparty, exchange partner | Not a social network |
| Meetup, rendezvous | Exchange, handoff | Precision |
| Location (of a user) | Safe spot, or display point | "Location" is ambiguous in a system where the distinction is the whole architecture |
| Anonymous | Pseudonymous | Accuracy — a UUID is not anonymity |
| Delete (of a message) | Report | Messages are immutable by design |
| Engagement | Completed exchanges | The metric we optimize for |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product | Initial glossary |
