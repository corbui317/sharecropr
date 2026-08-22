# Feature Spec Register

Every capability in Sharecropr has a numbered spec. Numbers are permanent and never reused. Before writing a new spec, **claim a number here in a small PR** — this is what prevents two people picking `SPEC-024` in the same week.

Rules for writing specs: [Doc Conventions](../00-foundation/06-doc-conventions.md). Structure to copy: [Spec Template](../00-foundation/07-spec-template.md).

---

## Number ranges

| Range | Meaning |
| --- | --- |
| `001`–`019` | MVP capabilities |
| `020`–`039` | Phase 2 — specified, not built |
| `040`–`059` | Phase 3 — specified, not built |
| `060`+ | Unallocated |
| `900`+ | Internal / staff tooling |

---

## MVP — SPEC-001 … SPEC-013

| ID | Spec | Capability | Status | Sec. review | Depends on |
| --- | --- | --- | --- | --- | --- |
| 001 | [Authentication](SPEC-001-authentication.md) | C1 | Approved | required | — |
| 002 | [Two-Factor Authentication](SPEC-002-two-factor-auth.md) | C2 | Approved | required | 001 |
| 003 | [Identity Verification](SPEC-003-identity-verification.md) | C3 | Approved | required | 001 |
| 004 | [Garden Verification](SPEC-004-garden-verification.md) | C4 | Approved | required | 001, 003 |
| 005 | [Crop Taxonomy](SPEC-005-crop-taxonomy.md) | C5 | Approved | not required | — |
| 006 | [Crop Inventory](SPEC-006-crop-inventory.md) | C6 | Approved | not required | 004, 005 |
| 007 | [Safe Spots](SPEC-007-safe-spots.md) | C7 | Approved | not required | — |
| 008 | [Interactive Map](SPEC-008-interactive-map.md) | C8 | Approved | not required | 007, 009 |
| 009 | [Listings & Offers](SPEC-009-listings-and-offers.md) | C9 | Approved | not required | 006, 007 |
| 010 | [Exchange Lifecycle](SPEC-010-exchange-lifecycle.md) | C10 | Approved | required | 003, 006, 007, 009 |
| 011 | [Messaging](SPEC-011-messaging.md) | C11 | Approved | required | 010, 012 |
| 012 | [Trust & Safety](SPEC-012-trust-and-safety.md) | C12 | Approved | required | 010 |
| 013 | [Notifications](SPEC-013-notifications.md) | C13 | Approved | not required | 010, 011, 012 |

## Future

| ID | Spec | Capability | Phase | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| 020 | [Harvest Planning & Surplus Alerts](SPEC-020-harvest-planning.md) | C20 | Phase 2 | Approved | 005, 006, 013 |
| 021 | [Community Groups & Garden Clubs](SPEC-021-community-groups.md) | C21 | Phase 2 | Approved | 007, 010, 012 |
| 022 | [Gamification](SPEC-022-gamification.md) | C22 | Phase 3 | Approved | 010, 012, 021 |
| 023 | [Crop ID & Food Safety](SPEC-023-crop-id-and-food-safety.md) | C23 | Phase 3 | Approved | 005, 006 |

> **Open register question.** SPEC-022 currently carries `security review: not required`, and its author disputes that: gamification reads `trust_score`, publishes user data to other users via leaderboards, and is almost entirely an adversarial-control surface. Resolve before Phase 3 planning. See SPEC-022 §15 Q1.

## Internal tooling

| ID | Spec | Capability | Status | Sec. review | Depends on |
| --- | --- | --- | --- | --- | --- |
| 900 | [Moderation Console](SPEC-900-moderation-console.md) | C90 | Approved | required | 004, 011, 012 |

---

## Build order

Dependencies constrain the order more than priority does — but only one *kind* of dependency does.

### Two relations, and only one of them orders anything

Every spec's front matter carries two rows, and conflating them is how a plan becomes unbuildable on paper:

| Row | Means | Property |
| --- | --- | --- |
| **Schema depends on** | Needs tables, types, or functions that another spec's **migration** creates | **Must be a DAG.** This is the only relation that constrains build order |
| **Behaviourally coupled with** | Calls into, or is called by, at runtime | **May cycle freely.** Says nothing about ordering |

The exchange calls the notification outbox and the notification catalog describes exchange events; messaging closes threads the exchange opened and the exchange writes system messages into them. Those are real couplings and they are mutually recursive, which is fine — they are satisfied by the shared baseline in [Data Model](../01-architecture/03-data-model.md) and [RLS Design](../01-architecture/05-rls-design.md), both of which land before any feature migration. Written as one undifferentiated "Depends on", they looked like a five-way cycle across SPEC-001/002/003 and SPEC-010/011/012/013, and the first person to topologically sort them would have concluded the plan could not be built.

**CI enforces both properties**: the schema graph must be acyclic, and every `Behaviourally coupled with` edge must be symmetric — if A names B, B names A ([CI/CD §4](../05-operations/02-cicd.md)).

### The critical path

```mermaid
flowchart LR
    S001[001 Auth] --> S002[002 2FA]
    S001 --> S003[003 ID Verify]
    S001 --> S004[004 Garden]
    S003 --> S004
    S001 --> S007[007 Safe Spots]
    S001 --> S013[013 Notifications]
    S005[005 Taxonomy] --> S006[006 Inventory]
    S004 --> S006
    S006 --> S009[009 Listings]
    S007 --> S009
    S005 --> S008[008 Map]
    S007 --> S008
    S009 --> S008
    S003 --> S010[010 Exchange]
    S006 --> S010
    S007 --> S010
    S009 --> S010
    S010 --> S011[011 Messaging]
    S011 --> S012[012 Trust & Safety]
    S003 --> S012
    S010 --> S012
    S011 --> S900[900 Moderation]
    S012 --> S900
    S004 --> S900
```

Generated from `Schema depends on` only. A valid order: **001 → 002 → 003 → 004 → 005 → 006 → 007 → 009 → 008 → 010 → 011 → 012 → 013 → 900.**

**Before any of it**, run the **reset** map spike from [R-04](../06-roadmap/02-open-risks.md): build the SPEC-008 map screen with 200 clustered symbols on both platforms under the New Architecture, on `@maplibre/maplibre-react-native` over self-hosted OSM tiles ([ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)). The map is the product, and if the renderer misbehaves under Fabric, that changes the plan before the data model is written, not after. **The earlier `react-native-maps` spike passed but no longer validates the shipping stack** — do not carry its result forward.

**Parallelizable early:** SPEC-005 (taxonomy) depends on nothing at all, and SPEC-007 (safe spots) depends only on auth. Both are mostly data curation — start them on day one. SPEC-007 in particular has a long lead time because it requires physically verifying venue hours in two metros.

**A note on SPEC-007 and the moderation console.** SPEC-007's front matter used to claim a schema dependency on SPEC-900, which contradicted the "day one" advice directly and closed a 007 → 900 → 012 → 010 → 007 loop. The real relationship is behavioural: curation *happens through* the console, but the `safe_spots` tables do not need it to exist. Seeding for the first two metros is manual data entry against the schema, and the console affordance can land with SPEC-900. If that proves painful in practice, the fix is to pull a thin curation slice forward — not to make the whole console a prerequisite for the product's supply side.

---

## Traceability

Every `MUST` requirement in every spec maps to at least one test ID in that spec's §13. CI enforces this ([CI/CD §4](../05-operations/02-cicd.md)) — a spec with an untested `MUST` fails the build.

| Want to know… | Look at |
| --- | --- |
| Which spec owns a table | Each spec's §6 Data |
| Which spec owns an endpoint | [API Contract](../01-architecture/06-api-contract.md), cross-referenced to specs |
| Which tests prove a requirement | The spec's §13.1 coverage matrix |
| Which RLS policies a feature relies on | The spec's §9 Security & Privacy |
| Why a design is the way it is | The ADRs listed in the spec's front matter |

---

## Claiming a number

1. Add a row to the appropriate table above with status `Draft`.
2. Open a PR containing only that change.
3. Once merged, the number is yours. Create `SPEC-###-your-slug.md` from the template.

Retired specs keep their number and their file. Set status to `Superseded by SPEC-###` and leave a banner at the top pointing to the replacement. Nothing is ever deleted — deleted history is how a team relearns the same lesson three times.
