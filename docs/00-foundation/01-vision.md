# Product Vision

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Product

---

## The problem

Home gardens produce in bursts. A single zucchini plant yields more than a household can eat, and it yields it all at once, in the same three weeks that everyone else's zucchini is also ready. The surplus rots on the vine, goes to a compost heap, or gets left in a break room. Meanwhile the same gardener has no tomatoes this year because the blight got them, and buys them at a supermarket that trucked them 1,400 miles.

The mismatch is local and solvable. What's missing is not supply, demand, or goodwill — it's **discovery and trust**. You do not know that the person four streets over has forty pounds of peppers, and if you did, neither of you would be comfortable driving to a stranger's house to find out.

## What Sharecropr is

Sharecropr is a **barter network for garden surplus**, built around a live map. Gardeners inventory what they have, see what's available nearby, and arrange swaps that happen at pre-approved public places — library entrances, town hall lobbies, police-station parking lots, college quads, community centers.

The map is the product. Opening the app should feel like looking out over your neighborhood and seeing what's growing in it.

## What Sharecropr is not

These are commitments, not current limitations:

| Not | Why |
| --- | --- |
| **A marketplace** | No money changes hands. Ever. Introducing currency turns a neighborly exchange into a regulated transaction with tax reporting, dispute handling, fraud liability, and an entirely different kind of user. See [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md). |
| **A social network** | No follower counts, no feeds, no cold DMs. Messaging exists to coordinate a specific exchange and closes when the exchange does. |
| **A delivery service** | We do not move goods. We introduce people who then meet in a public place. |
| **A location-sharing app** | Users are never shown another user's home. The system is architected so that this is impossible, not merely disallowed. See [Location Privacy](../01-architecture/04-location-privacy.md). |
| **A food retailer** | We are not a food business, and produce exchanged is not inspected. Users disclose; users decide. |

## Who it's for

Primary: the **surplus gardener** — someone with a productive backyard plot, raised beds, or an allotment who ends up with more of something than they can use, and who would rather trade it than waste it.

Secondary: the **variety seeker** — a gardener with limited space or a failed crop who wants access to things they can't grow, and the **new gardener** who wants to meet people who know what they're doing.

Full detail in [Personas & Journeys](03-personas-and-journeys.md).

## Why now

Three things converged. Home food gardening participation stayed elevated after its early-2020s surge. Consumer expectations for identity-verified, location-aware apps became normal rather than alarming. And the tooling to build a geospatially serious, security-serious mobile app with a small team — managed Postgres with PostGIS and row-level security, a mature cross-platform runtime, hosted identity verification — got good enough that this is a months-long build rather than a years-long one.

## The bet

**That trust infrastructure, not matching, is the hard part.** Plenty of apps can show you a pin on a map. The reason peer-to-peer produce sharing hasn't worked at scale is that the last twenty feet — walking up to a stranger — is where people bail out. Sharecropr invests disproportionately in that twenty feet: verified identity, verified gardens, public meeting places, dual arrival confirmation, ratings that mean something, and a moderation function staffed from day one.

If we're wrong, we're wrong because the friction we added to make it safe is friction users won't accept. That risk is tracked as [R-09](../06-roadmap/02-open-risks.md) and instrumented from launch.

## Success

### Year one

| Metric | Target | Why this one |
| --- | --- | --- |
| Completed exchanges per active user per season | ≥ 3 | The only metric that means the product worked |
| Listings per active safe spot | ≥ 8 | Liquidity, the actual constraint |
| Request → completed-exchange conversion | ≥ 45% | Measures whether trust friction is fatal |
| Safety incidents per 1,000 exchanges | 0 reported assaults; < 2 no-shows | Existential |
| D30 retention, verified users | ≥ 35% | Whether it's a habit or a novelty |

### Explicitly not success metrics

Daily active users, session length, and messages sent are **anti-goals**. A user who opens Sharecropr twice a week, swaps a bag of beans, and closes it has been served perfectly. Optimising for engagement in an app that arranges in-person meetings would be optimising for the wrong species of behaviour.

## Three-year picture

Sharecropr becomes the default coordination layer for hyperlocal food sharing: individual gardeners first, then garden clubs and community plots ([Phase 2](../06-roadmap/01-roadmap.md)), then adjacent goods with the same exchange mechanics — seeds, cuttings, tools, preserved goods. Municipal library systems and extension offices list themselves as safe spots because it drives foot traffic and fits their mission.

The moat is not software. It's the verified-user graph, the curated safe-spot network, and a reputation for having never had a bad incident.

## Principles

1. **Safety beats growth.** Every time. When in doubt, add friction.
2. **The map is the product.** If the map is slow, ugly, or empty, nothing else matters.
3. **Privacy by architecture, not by policy.** A promise in a privacy policy is a hope. A `REVOKE` on a schema is a guarantee.
4. **Local means local.** Default discovery radius is walking-and-short-driving distance, not "your metro."
5. **Small, seasonal, and real.** Peak season is loud, winter is quiet, and that's correct behaviour for this product.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product | Initial vision |
