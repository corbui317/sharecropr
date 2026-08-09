# ADR-0002: Barter only — no money, ever

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Product, Legal |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr coordinates strangers exchanging home-grown produce in person. The obvious adjacent product is a marketplace: let people sell surplus, take a cut. That product is a different company with a different risk surface, and the difference is not incremental.

Introducing currency changes what we are, legally and operationally, in one step:

| Consequence of accepting money | What it actually costs |
| --- | --- |
| Money transmission / payment facilitation | State-by-state MTL analysis in the US, or a PayFac partner with their own compliance regime |
| Tax reporting | 1099-K issuance above thresholds; W-9 collection; a support burden every January |
| Cottage food law | Selling food is regulated per state and often per county; giving it away frequently is not |
| Chargebacks and disputes | A dispute process, a refund policy, a fraud team, and negative-balance recovery |
| Fraud economics | Payments create a reason to attack the platform at scale. Barter does not — there is nothing to cash out |
| Store rules | Physical-goods payments avoid IAP, but Apple and Google both scrutinize marketplace apps far more heavily |

There is also a product argument, and it is the stronger one. The behaviour we want is *neighbourliness*: a person with too many zucchini gives them to someone with too many tomatoes. The moment a price exists, every exchange gets evaluated against it, users compare their zucchini to the market rate, and the interaction becomes a transaction between counterparties rather than a meeting between neighbours. The safety model depends on the second framing. Someone meeting a neighbour at a library behaves differently from someone meeting a seller.

What we don't know: whether barter alone produces enough liquidity. Barter has a double-coincidence-of-wants problem that money exists to solve. Our bet is that surplus garden produce is low-stakes enough that people accept imperfect matches, and that the safe-spot map creates enough incidental discovery to compensate.

## Decision

**No currency anywhere in the product, the schema, the API, or the roadmap.**

Enforced structurally, not by policy memory:

- **No money column exists.** [Data Model §1](../03-data-model.md#1-conventions) states it: "There is no currency column anywhere and adding one requires an ADR." A CI check greps migrations for `numeric(*, 2)` named `price|amount|cost|fee|total` and fails the build.
- **No payment SDK is a dependency.** No Stripe, no PayPal, no Apple Pay, no IAP. A CI check on `package.json` fails if one appears.
- **No fees, no subscriptions, no premium tier, no ads** in MVP or Phase 2. Monetization, if it ever exists, is B2B (municipal/extension-office partnerships) and requires its own ADR.
- **Message content scanning flags payment solicitation** — "venmo", "cashapp", "$", "paypal", "zelle" — as a policy violation surfaced to moderation, alongside the existing address-disclosure scan ([Location Privacy §12](../04-location-privacy.md#12-residual-risk)).
- **Terms of service prohibit selling.** Repeat solicitation is a suspension reason under `moderation_action`.

This is also codified as rule 4 of [the five rules](../../README.md#the-five-rules-that-govern-this-codebase): "No money, ever. Any proposal that introduces currency requires a new ADR and a legal review."

## Alternatives considered

### Full marketplace with payments

**What it is.** Listings carry prices; the platform processes card payments and takes a percentage.

**Why we didn't.** It converts a two-person team's compliance surface from "privacy and safety" to "privacy, safety, money transmission, tax, and food-sale regulation," in every jurisdiction we operate. It also removes the strongest fraud deterrent we have, which is that there is nothing here worth stealing.

### Optional "tip" or donation

**What it is.** Free by default, with a voluntary payment button.

**Why we didn't.** This is a marketplace with extra steps. It carries the full payments compliance surface for a fraction of the revenue, and it introduces exactly the price-comparison dynamic we are trying to avoid — a tip that is expected is a price.

### Platform credits / points currency

**What it is.** An internal non-cash unit earned by giving and spent on receiving, solving the double-coincidence problem.

**Why we didn't.** Genuinely tempting, and the closest call here. Rejected for MVP because (a) a closed-loop currency with earnable value has attracted regulatory attention in several jurisdictions once it becomes transferable or has a cash-out path, (b) it needs anti-inflation design, balance ledgers, and a dispute process — real engineering against unproven demand, and (c) points reintroduce scorekeeping, which is the psychological thing we said we didn't want. Revisitable, with legal review, if liquidity data demands it.

### Money-free but with in-app "wish lists" that price implicitly

**What it is.** Ranked want-lists to improve matching without currency.

**Why we didn't.** Not rejected — deferred. This is a matching improvement, not a monetization one, and it belongs with harvest planning in Phase 2.

## Consequences

### Positive

- Zero payments compliance surface. No MTL, no PCI, no 1099-K, no chargebacks, no negative balances.
- The fraud model collapses to social abuse (no-shows, misrepresentation, harassment), which the trust and safety system already addresses.
- Store review is materially simpler; we are a social app, not a marketplace.
- The schema is smaller and the exchange state machine is simpler: no escrow, no refund states, no partial payment ([Exchange State Machine §3](../07-exchange-state-machine.md)).
- The product's framing — neighbours, not counterparties — is the framing the safety model needs.

### Negative

- **No revenue path in MVP.** The company is funded, not earning. That is a real strategic exposure and this ADR is part of why.
- **Liquidity risk is unhedged.** Money exists to solve double-coincidence-of-wants; we removed the solution and kept the problem.
- Some users will transact off-platform anyway, and we lose visibility into those exchanges — including the safety signals attached to them.
- We cannot use pricing as a quality or scarcity signal. Everything else must carry that load: ratings, trust tiers, condition tags.

### Neutral / accepted costs

- Content scanning for payment solicitation is ongoing work with false positives.
- "Why can't I sell?" is a permanent support and App Store review question. Answer it once, in the FAQ and the review notes.
- Barter valuation disputes ("your two zucchini aren't worth my tomatoes") get resolved socially, via ratings, not by us.

## The strongest argument against this decision

Barter networks have failed repeatedly for a reason that is not a design flaw and cannot be fixed with better UX: the double coincidence of wants. For an exchange to happen, A must have what B wants **and** want what B has, **at the same time**, **within walking distance**, **during a two-week harvest window**. Money was invented specifically because that conjunction is rare. In a dense metro with thousands of active gardeners the matching graph might be thick enough — but at launch, in a neighbourhood with forty users, most of whom grow tomatoes in August because that is what everyone grows in August, the graph is nearly empty. The failure mode is quiet and terminal: users open the app, see nothing they want, and stop opening the app. And the fix that would work is precisely the one we have foreclosed, in the schema, with a CI check. A credits system would let a user give away a glut of tomatoes in August and claim squash in October, decoupling the two halves of the trade across time — the single mechanism most likely to make hyperlocal barter actually function. We ruled it out on regulatory caution and an aesthetic preference for non-scorekeeping, and we may be trading the product's viability for a compliance risk we could have managed with a lawyer and a non-transferable, non-cash-out design.

We hold the line because reversing this decision later is cheap (add a table, add a spec, add an ADR) while reversing the opposite decision — having become a regulated payments business — is not. But if Year One liquidity metrics come in below the thresholds below, the credits design is the first thing we reopen, and this ADR should be superseded rather than argued around.

## Revisit when

- **Match rate** — the share of active listings that receive at least one request within 14 days — is below **35%** for two consecutive harvest seasons in a metro with >2,000 verified users.
- **Off-platform payment solicitation** appears in more than **5% of message threads**, indicating users are routing around us rather than using us.
- Users report double-coincidence failure as the top reason for churn in exit surveys (>30% of responses).
- A B2B revenue path (municipal partnerships, extension offices) proves out, in which case this ADR is *reinforced*, not revisited.
- Any proposal to add currency: **new ADR + legal review, no exceptions.** This one stays Accepted until superseded in writing.

## Related

- [ADR-0009 Safe spots only](ADR-0009-safe-spots-only.md), [ADR-0010 KYC vendor](ADR-0010-kyc-vendor.md)
- [Vision — "What Sharecropr is not"](../../00-foundation/01-vision.md), [PRD §1](../../00-foundation/02-prd.md)
- [Data Model §1](../03-data-model.md#1-conventions), [Exchange State Machine](../07-exchange-state-machine.md)
