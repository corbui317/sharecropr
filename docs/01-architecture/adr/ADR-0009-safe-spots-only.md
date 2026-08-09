# ADR-0009: Exchanges happen only at curated public safe spots

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Product, Security, Legal |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr's product is a stranger introduction that ends in a physical meeting. That is the whole thing. Every other decision in this document set — the `private` schema, the fuzzing trigger, TOTP, KYC — exists to make that meeting survivable.

The natural design is the one every marketplace uses: the two parties agree a place in chat. It is flexible, it is zero engineering, and it is what users will ask for. It is also how you get people meeting at each other's houses, because gardens are at houses and "just come by, it's easier" is the path of least resistance for two agreeable people. Once that is the norm, the location-privacy architecture is theatre: we spent enormous effort ensuring exact coordinates cannot leave the database while the product's happy path has users typing their address into a chat box.

The threat model ([Location Privacy §1](../04-location-privacy.md#1-the-threat-we-are-defending-against)) names the two attackers this matters most for. The stalker needs one thing: to get a target to disclose or accept a home meeting. The burglar needs two: to know a house has something worth taking, and to know when the occupant will be away — and **a scheduled exchange is an announcement that someone will be elsewhere at a known time**. Home meetings hand both attackers their objective through the product's intended flow, with no exploit required.

Municipal venues offer an unusual property here: libraries, town halls, police-station lots, community centres, fire stations, and college quads are staffed, lit, camera-covered, publicly accessible, free, and mission-aligned with exactly this kind of civic activity. They are also, conveniently, places nobody lives.

What we do not know is the cost. Requiring a trip to a third location is real friction for an exchange whose value might be six tomatoes, and it may simply be more than the transaction is worth to most people.

## Decision

**Exchanges occur only at safe spots. There is no product surface, and no code path, that produces a home meeting.**

| Element | Rule |
| --- | --- |
| Listing → location | A listing attaches to **up to three** safe spots via `public.listing_safe_spots`. It has no free-text location field |
| Scheduling | An exchange session's location is a `safe_spot_id` FK. There is **no column** for an arbitrary address or coordinate ([Data Model §10](../03-data-model.md#10-listings--the-exchange)) |
| Curation | Only staff create or approve safe spots in MVP. `safe_spot_status` runs `proposed → under_review → active`. User proposals are Phase 2 |
| Eligible categories | `public_library`, `police_station`, `city_hall`, `community_center`, `college_campus`, `fire_station`, `farmers_market`, `park_pavilion`, `other_municipal`. No private businesses, no residences, no parking lots that are not attached to a staffed venue |
| Gardens on the map | **Never rendered.** The map shows safe spots only. There is nothing to click through to a person's home ([Location Privacy §5](../04-location-privacy.md#5-what-each-audience-can-see)) |
| Address disclosure in chat | `content-scan` flags address-shaped strings; repeated disclosure is a moderation action |
| Handoff | Dual confirmation with a short code at the spot ([Exchange State Machine §3.1](../07-exchange-state-machine.md#31-the-handoff-code)) |

The structural point, and the reason this is an architecture decision rather than a policy: **the schema cannot represent a home meeting.** `exchange_sessions` references a curated row in `safe_spots`. There is no free-text location, no lat/lng pair, no "other" option. A future engineer cannot accidentally ship one; they would have to write a migration to make it possible, and that migration would be reviewed.

Coverage is the operational obligation this creates. Launch requires seeded safe spots such that **90% of the launch metro's population is within 3 km of one**, verified before the metro opens.

## Alternatives considered

### Free-text meeting location agreed in chat

**What it is.** Users type a place. Maximum flexibility, zero engineering.

**Why we didn't.** It makes home meetings the default by convenience, defeats the entire location-privacy architecture through the intended flow, and gives us no record of where anything happened — which matters enormously the first time there is a safety incident and we are asked what we knew.

### Safe spots recommended but not required

**What it is.** Suggest safe spots; allow an override with a warning.

**Why we didn't.** This is the option most likely to be proposed as a compromise, and it is the worst one. An override that exists will be used, and it will be used disproportionately by the users least attuned to risk and by the ones being socially pressured into it — "we don't need to do the library thing, just come over." Warnings do not protect people against a counterparty who is being persuasive. A safety control with an opt-out protects the users who did not need protecting.

### Any public place, user-pinned, no curation

**What it is.** Let users drop a pin at any café or park.

**Why we didn't.** "Public" is doing too much work. An empty park at 9pm is public. A quiet corner of a parking garage is public. Curation is what makes the category mean *staffed, lit, and observed*, and it is also what lets us maintain a relationship with venues rather than surprising them. It additionally reintroduces an arbitrary coordinate into the schema, which is the thing we are structurally preventing.

### Courier or drop-box exchange (no meeting at all)

**What it is.** Asynchronous handoff at a locker or a doorstep.

**Why we didn't.** Removes the safety problem and the product with it — the social contact is the point, and it is what makes people forgive an imperfect trade. Also introduces food-safety and custody questions we are not equipped for. Revisitable for a Phase 3 "porch pickup" variant among users who have already exchanged and mutually opt in.

## Consequences

### Positive

- The most dangerous outcome in the product — a stranger at your door — is not expressible in the data model.
- Meetings occur in staffed, lit, camera-covered public places, which deters the behaviour we most fear and provides evidence if something happens.
- We know where every exchange was scheduled, which makes incident response and law-enforcement cooperation tractable.
- The map has a coherent design: safe spots are the only spatial objects, so there is no "should we render gardens" question to get wrong later.
- Venue partnerships become a real acquisition channel — libraries want foot traffic and this fits their mission.
- Legal exposure is materially lower than a product that facilitates home visits between strangers.

### Negative

- **Real friction on a low-value transaction.** A trip to a library for six tomatoes may not be worth it, and this is the most plausible reason the product fails.
- Coverage is an operational burden per metro: someone must physically curate spots before launch, and thin coverage in a neighbourhood is invisible to us and fatal to users there.
- Users with limited mobility or no transport are disadvantaged — an equity problem we should name rather than elide.
- Scheduling is harder: two people must agree a time *and* both travel, rather than one person being home.
- Venue hours constrain exchange windows. A library closed on Sunday removes Sunday.

### Neutral / accepted costs

- Safe-spot data needs maintenance: hours, closures, renovations, seasonal changes. `safe_spot_status` includes `suspended` for this.
- Some users will arrange home meetings off-platform regardless. We cannot prevent that, only decline to build it and flag it when it appears in chat.
- Venue relations is a function someone owns. It has no engineering component and it is on the critical path for every launch.

## The strongest argument against this decision

We may be solving a rare problem by making the common case not worth doing. The realistic Sharecropr exchange is worth about four dollars of produce. Requiring both parties to drive to a third location, coordinate on a shared window inside library opening hours, park, meet, and exchange a bag of squash is a twenty-to-forty-minute round trip each — for something they would happily have left on a porch. Neighbourhood produce sharing already happens constantly, informally, at doorsteps and driveways and over fences, without incident, at enormous volume; the base rate of harm in "neighbour gives neighbour vegetables" is very low. We have taken the safest activity in the product and applied the friction appropriate to a Craigslist electronics sale to it, and the likely result is not safer exchanges but *fewer* exchanges — and, worse, exchanges that migrate off-platform to text messages where we have no visibility, no reporting, no ratings, and none of the safety infrastructure we built. A control that pushes users to an unmonitored channel has made things worse, not better, and it will do so invisibly because the exchanges we lose do not appear in any funnel we measure.

There is a paternalism objection layered on top. Adults are permitted to decide who comes to their house. The product's position is that they cannot make that choice even after a mutual exchange history, mutual five-star ratings, and mutual ID verification — and there is no path to earning it. Every other trust system we built (trust tiers, ratings, verification) exists to let trust accumulate, and this is the one place where accumulated trust buys nothing at all.

We hold the line for MVP because the asymmetry is stark: the friction cost is distributed, recoverable, and measurable, while the harm cost is concentrated, irreversible, and lands on one person. A single serious incident at a home meeting ends the company, and it would end it having been foreseeable in writing. We would rather ship a product used by fewer people than one that hurts one. **But this is a bet, not a principle**, and we commit to revisiting it with the data below rather than defending it out of habit.

## Revisit when

- **Exchange completion rate** — accepted requests that reach `completed` — is below **55%**, and post-hoc surveys attribute the gap primarily to travel or scheduling.
- More than **20% of users within 3 km of an active safe spot** never complete an exchange after making a request.
- **Off-platform coordination signals exceed 10% of threads** (address-shaped strings, "just come by", phone-number exchange). This means the control has become a routing problem, not a safety one.
- Safe-spot coverage in a metro drops below **90% of population within 3 km**, which is a launch blocker rather than a revisit.
- After **12 months and 10,000 completed exchanges**, the incident rate at safe spots is measured. That is the first point at which we have any evidence about the counterfactual.
- A credible trusted-pair design exists — mutual opt-in, both `trusted` tier, three prior completed exchanges, both parties confirming separately outside a chat thread, with an audit record. This would be a **new ADR superseding this one**, not an exception granted in a PR.

## Related

- [ADR-0002 Barter only](ADR-0002-barter-only.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md), [ADR-0014 TOTP not SMS](ADR-0014-totp-not-sms.md)
- [Location Privacy §1, §5](../04-location-privacy.md), [Data Model §9, §10](../03-data-model.md#9-safe-spots), [Exchange State Machine](../07-exchange-state-machine.md), [Vision](../../00-foundation/01-vision.md)
