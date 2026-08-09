# Open Risks

**Status:** Approved · **Version:** 1.0.0 · **Owner:** CTO

Ranked by expected damage × probability. Risk IDs are `R-##`, permanent, referenced throughout the doc set.

This register is deliberately blunt. A risk register that reads as reassuring is not doing its job.

Risks are things that might go wrong strategically. For the smaller, concrete traps waiting in the build itself — organised by when each one bites — see [Development Notes](../07-review/02-development-notes.md).

---

## Summary

| ID | Risk | Severity | Likelihood | Owner | Review |
| --- | --- | --- | --- | --- | --- |
| [R-01](#r-01--liquidity-not-architecture-decides-whether-this-works) | Liquidity, not architecture, decides success | **Critical** | **High** | CEO | Weekly at launch |
| [R-02](#r-02--safe-spot-curation-is-an-unbounded-operational-cost) | Safe-spot curation is unbounded manual cost | High | High | Ops | Monthly |
| [R-03](#r-03--physical-safety-is-irreducible-and-one-incident-is-existential) | Physical safety is irreducible | **Critical** | Low | CEO | Quarterly |
| [R-04](#r-04--the-map-stack-is-unvalidated) | The map stack is unvalidated | High | Medium | Mobile | **Before any other work** |
| [R-05](#r-05--rls-correctness-fails-silently) | RLS correctness fails silently | **Critical** | Medium | Security | Every PR |
| [R-06](#r-06--plpgsql-is-the-home-of-the-most-critical-code) | PL/pgSQL holds the most critical code | Medium | Medium | Backend | Quarterly |
| [R-07](#r-07--kyc-unit-economics-are-unbounded) | KYC unit economics are unbounded | Medium | Medium | Finance | Monthly |
| [R-08](#r-08--the-privacy-scheme-is-strong-at-the-database-and-weak-at-the-edges) | Privacy is strong at the DB, weak at the edges | **Critical** | Medium | Security | Monthly |
| [R-09](#r-09--users-may-route-around-safe-spots) | Users may route around safe spots | High | **High** | Product | Monthly |
| [R-10](#r-10--release-cadence-coupling) | Release-cadence coupling | Medium | Medium | Platform | Per release |
| [R-11](#r-11--moderation-is-a-staffing-commitment-scoped-as-a-feature) | Moderation is staffing, scoped as a feature | High | High | T&S | Monthly |
| [R-12](#r-12--the-dual-spatial-model-will-produce-a-correctness-bug) | Dual spatial model correctness | Medium | High | Backend | Per spatial change |
| [R-13](#r-13--seasonality-may-kill-retention) | Seasonality may kill retention | High | High | Product | Quarterly |
| [R-14](#r-14--supabase-is-a-single-strategic-dependency) | Single strategic vendor dependency | Medium | Low | CTO | Annually |

---

## R-01 — Liquidity, not architecture, decides whether this works

**Severity: Critical · Likelihood: High**

The entire documentation set is a well-engineered answer to a supply-side question. If a user opens the map and sees three safe spots with zero listings, none of the RLS elegance matters.

**The plan contains roughly 18 weeks of engineering and approximately zero weeks of supply seeding.** That is the single biggest gap in it.

**Mitigation is non-technical.** Before the first build ships: partner with two or three community gardens and a master-gardener chapter per launch metro. Treat **listings per active safe spot** as the north-star metric, displayed on the [product dashboard](../05-operations/04-observability.md) from day one. Consider a concierge mode where staff manually seed listings in the first weeks.

**Trigger:** fewer than 8 active listings per active safe spot at week 4 → pause feature work and move everyone to supply acquisition.

---

## R-02 — Safe-spot curation is an unbounded operational cost

**Severity: High · Likelihood: High**

Every new market needs a human to verify venues, confirm hours, and ideally obtain consent. There is no automation path in this plan. Worse, a library that objects to being listed is both a PR problem and a legal one.

**This could become the actual constraint on growth, not engineering.**

**Mitigation:** pursue formal partnerships — library systems tend to like this kind of programme and it fits their mission. Build the partner-admin flow ([SPEC-021](../03-specs/SPEC-021-community-groups.md)) earlier than Phase 2 if venues push back. Have a 48-hour takedown SLA ready and published before launch.

**Trigger:** more than 2 venue objections, or curation exceeding 40 hours per new metro.

---

## R-03 — Physical safety is irreducible, and one incident is existential

**Severity: Critical · Likelihood: Low**

Safe spots, KYC, ratings, and reports lower the probability of harm. They do not make it zero. The plan has good controls and **no answer for what happens after an assault at a Sharecropr meetup** beyond the playbook in [Trust & Safety §7](../02-security/05-trust-and-safety.md#7-after-a-real-world-incident).

**Mitigation, all blocking before launch:** the incident-response playbook signed off by counsel; liability insurance in force with the policy reviewed against the actual product; a named human on the severity-1 rota with a paging path tested by drill.

Separately, an explicit recorded human decision is needed on whether **both** parties must be KYC-verified without exception. The Phase 2 alternate trust path deliberately weakens this, and that tradeoff deserves a signature, not an architectural assumption. See [Identity Verification §6](../02-security/03-identity-verification.md#6-the-equity-problem).

**Trigger:** any incident involving physical harm → immediate product review, regardless of fault.

---

## R-04 — The map stack is unvalidated

**Severity: High · Likelihood: Medium**

Expo SDK 57 / RN 0.86 / New Architecture / `react-native-maps` is an unvalidated combination, and **the map is the product**. If custom markers, clustering, or the animated avatar have Fabric issues, the flagship screen degrades and the [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md) fallback to `@rnmapbox/maps` costs weeks plus a per-map-load billing model we have not budgeted.

**Mitigation — do this before anything else.** A two-day spike building the actual map screen with 200 clustered custom markers on both platforms under the New Architecture. **Do not start the data model until this passes.**

**Trigger:** the spike fails, or frame rate drops below 45 fps at 200 markers on the reference mid-range device.

---

## R-05 — RLS correctness fails silently

**Severity: Critical · Likelihood: Medium**

A missing negative test on one policy is a data breach with no error, no crash, and no alert. The pgTAP coverage and the definer allowlist are good controls, but they are **process controls** — they hold only while discipline holds under deadline pressure.

**Mitigation:** the [negative-test ratio gate](../04-testing/02-rls-test-plan.md) in CI; an external RLS-focused security review before public launch (a [release gate](../00-foundation/02-prd.md)); and the [production canary](../05-operations/04-observability.md#9-the-location-canary), which is the only control that verifies what we actually deployed rather than what we intended.

**Trigger:** any canary failure, or any PR merged with a policy change and no test change.

---

## R-06 — PL/pgSQL is the home of the most critical code

**Severity: Medium · Likelihood: Medium**

`accept_exchange_request` is roughly 80 lines of the most safety-critical code in the system, written in a language most of the team will not be fluent in. The realistic failure is that someone modifies it badly without understanding lock ordering.

**Mitigation:** the [concurrency harness](../04-testing/01-test-strategy.md#51-the-concurrency-harness) is the real defence — keep it fast enough to run on every PR. A `CODEOWNERS` rule requiring a second `DB`-tagged reviewer on `supabase/migrations/**` is the process defence. The [transition guard trigger](../01-architecture/07-exchange-state-machine.md#6-the-transition-guard-trigger) is the structural one.

**Trigger:** any production incident traced to the exchange engine → consider extracting it, accepting that this is the expensive option.

---

## R-07 — KYC unit economics are unbounded

**Severity: Medium · Likelihood: Medium**

Per-verification cost times a signup funnel we do not control equals an unbounded liability, and a bot wave costs money directly. **There is no rate limit on wanting to verify.**

**Mitigation:** verification offered only after garden verification passes (the highest-leverage control); hard velocity limits; a monthly spend alarm at 130% of forecast; a daily anomaly alert on inquiry starts. Model cost at 10k / 50k / 200k signups **before** signing a vendor contract — the Persona-versus-Stripe decision may flip at volume. See [Identity Verification §7](../02-security/03-identity-verification.md#7-unit-economics).

**Trigger:** spend above 130% of forecast, or inquiry starts above 150% of the 7-day baseline.

---

## R-08 — The privacy scheme is strong at the database and weak at the edges

**Severity: Critical · Likelihood: Medium**

`private.garden_locations` is thoroughly hardened. The realistic leak paths are mundane: a Sentry breadcrumb containing a coordinate, a PostHog event with a raw lat/lng, a support screenshot, a moderator with database access, a CSV export for a growth experiment.

**The telemetry scrubber and the H3-r5 analytics rule are one-line policies protecting the crown jewels**, and they are exactly the sort of thing that quietly breaks after a library upgrade.

**Mitigation:** automated enforcement — a test that fires synthetic events and asserts the scrubber catches coordinates ([LP-08](../04-testing/01-test-strategy.md)); a documented moderator-access audit; the export role having no `private` access; and the response-body sweep across every endpoint.

**Trigger:** any coordinate found in any log, event, or export.

---

## R-09 — Users may route around safe spots

**Severity: High · Likelihood: High**

"No cold DMs" and "safe spots only" are correct safety decisions, and both add friction users will route around: coordinates shared in chat, phone numbers exchanged, meetings moved to driveways. **If the routing-around rate is high, we carry all the friction and none of the safety**, plus the liability of having implied a guarantee.

**Mitigation:** instrument from day one. `content-scan` already detects address sharing ([SPEC-011-R27](../03-specs/SPEC-011-messaging.md)), and its flag rate is the measurement. Be prepared to revisit [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) with data rather than defending it on principle.

**Trigger:** address-sharing flag rate above 8% of messages → formal review of the safe-spot-only policy.

---

## R-10 — Release-cadence coupling

**Severity: Medium · Likelihood: Medium**

A migration lands, adoption of the new binary is slower than expected, and the contract phase runs early. The two-version compatibility rule is the mitigation, but it was originally enforced by a comment convention.

**Mitigation:** the [destructive-migration DAU gate](../05-operations/02-cicd.md#32-the-destructive-migration-gate) reads `devices.app_version` from production and mechanically fails any migration containing `DROP` when more than 2% of DAU are below the contract floor. The rule is now arithmetic rather than etiquette.

**Trigger:** any production incident caused by a client/schema mismatch.

---

## R-11 — Moderation is a staffing commitment scoped as a feature

**Severity: High · Likelihood: High**

A 24-hour SLA is a rota, not software. At launch scale one part-time person suffices; **the plan has no trigger for when that stops being true**, and no on-call rotation for `unsafe_meeting` reports, which must page rather than queue.

The App Store submission asserts this process exists. It needs to actually exist.

**Mitigation:** define the staffing model and escalation path before submission; run a paging drill; add [SLA breach alerting](../05-operations/04-observability.md) with zero error budget for severity 1.

**Trigger:** sustained report volume above 20/day, or any severity-1 SLA breach.

---

## R-12 — The dual spatial model will produce a correctness bug

**Severity: Medium · Likelihood: High**

PostGIS geography plus H3 cells means at least one bug is coming. Most likely: someone queries a single H3 cell instead of `h3_grid_disk`, and users near a cell boundary silently see fewer results. It will not crash, will not error, and will not appear in tests unless the boundary case is written explicitly.

**Mitigation:** [TC-GEO-07 and TC-GEO-08](../04-testing/03-geospatial-test-plan.md) test the recall direction specifically, paired against TC-GEO-25 so that fixing recall does not get "optimised" back into a boundary bug.

**Trigger:** any user report of missing nearby listings.

---

## R-13 — Seasonality may kill retention

**Severity: High · Likelihood: High**

This is a product about garden surplus. In February, in most of the northern hemisphere, there is none. A three-month dead period every year is a retention problem, an engagement-metric problem, and a fundraising-narrative problem.

**Mitigation:** [SPEC-020](../03-specs/SPEC-020-harvest-planning.md) harvest planning is the answer — it makes the app useful *between* harvests. It is currently Phase 2. If winter retention collapses, it moves into MVP.

Also: resist the temptation to fight seasonality with engagement mechanics. A user who opens the app twice a week in August and not at all in February has been served correctly ([Vision §Success](../00-foundation/01-vision.md)).

**Trigger:** D30 retention below 20% in the off-season.

---

## R-14 — Supabase is a single strategic dependency

**Severity: Medium · Likelihood: Low**

Pricing changes, acquisition, or a service change could force a migration. Postgres, PostgREST, and the migrations are portable; Realtime, Storage, and Edge Functions are the sticky parts, and GoTrue user migration is genuinely awkward — Apple private-relay emails are scoped to our team ID and TOTP factors do not migrate.

**Mitigation:** the [escape hatch](../01-architecture/01-system-architecture.md#8-the-escape-hatch) — `@supabase/supabase-js` is imported in exactly one file, so swapping the transport is a single-file change plus type reconciliation. Note that [ADR-0004](../01-architecture/adr/ADR-0004-supabase.md) puts auth migration at 1–2 engineer-months, not the two weeks the architecture doc originally estimated. The ADR is right.

**Trigger:** material pricing change, acquisition announcement, or repeated availability failures.

---

## Review

| Cadence | Attendees | Scope |
| --- | --- | --- |
| Weekly at launch | CEO, CTO, Product | R-01, R-09, R-11 |
| Monthly | Leadership | Full register |
| Quarterly | Leadership + Security | Full register plus new risks |
| Ad hoc | As triggered | Any risk whose trigger fires |

Adding a risk requires an ID, an owner, a severity, and a **concrete trigger**. A risk without a trigger is an anxiety, not a risk — it never gets acted on because nobody knows when to act.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | CTO | Initial risk register |
