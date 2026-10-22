# SPEC-007: Safe Spot Network

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.1.1 |
| **Owner** | Product + Ops (Venue Relations) |
| **Phase** | MVP |
| **Security review** | not required |
| **Schema depends on** | [SPEC-001](SPEC-001-authentication.md) |
| **Behaviourally coupled with** | SPEC-900 (curation console), SPEC-021 (partner-managed spots) |
| **Related ADRs** | [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md), [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) |
| **Last updated** | 2026-08-09 |

---

## 1. Summary

The safe spot network is the curated set of public, staffed-or-surveilled venues where every Sharecropr exchange physically happens. It is the only precise coordinate data the client ever receives, and it is the operational obligation created by [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) — the schema cannot represent a home meeting, so if the network is thin or its data is wrong, the product simply does not work in that neighbourhood. This spec defines what a safe spot is, what metadata it must carry, who may create one, how hours are kept fresh, and how a spot is suspended or retired without stranding scheduled exchanges.

## 2. Goals

- Define the eligibility rules for a venue, so curation is a checklist and not a judgement call made by whoever is on shift.
- Guarantee that every `active` safe spot carries the metadata a user needs to actually find it and decide whether they can use it: hours, accessibility, parking, indoor/outdoor, cameras, safety notes, photo.
- Keep hours fresh. Stale hours are the single largest controllable no-show generator in the product, and a no-show is a trust event that damages a real person's score ([SPEC-012](SPEC-012-trust-and-safety.md)).
- Give staff a safe suspension and retirement path that never leaves a scheduled exchange pointing at a venue that is closed, demolished, or has asked to be removed.
- Meet the launch coverage bar: ≥ 40 verified spots per launch metro with hours verified in the last 30 days ([PRD §7](../00-foundation/02-prd.md)), and 90% of metro population within 3 km of an `active` spot ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)).
- Give venues a consent record and a same-day takedown path, because [PRD A3](../00-foundation/02-prd.md) — "libraries will not object to being listed" — is an assumption and not a fact.

## 3. Non-Goals

- **User-proposed safe spots.** `safe_spot_status` includes `proposed` and `under_review` so the workflow exists, but there is no client write path in MVP. User proposals are Phase 2 and require a moderation queue we do not have headcount for.
- **Partner-administered spots.** `safe_spots.partner_org_id` is a stub column. Libraries administering their own hours arrives with [SPEC-021](SPEC-021-community-groups.md).
- **In-app navigation or directions.** Out of scope per [PRD §1](../00-foundation/02-prd.md). We render an address and a photo; the user's own maps app does the rest.
- **Real-time occupancy, crowding, or "is anyone there now".** Presence in an app that arranges physical meetings tells a stalker when their target is out ([Realtime & Notifications §8 Q4](../01-architecture/08-realtime-and-notifications.md)).
- **Automated hours ingestion, from OSM or anywhere else.** Rejected, permanently rather than for MVP: third-party hours for municipal buildings are wrong often enough that we would be laundering bad data into a no-show. §5.7 imports OSM `opening_hours` as a **reviewer hint that no automated path may promote** (R47, R48). A human phones the library. This is the single most important rule added in 1.1.0, and [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) resolved it against convenience deliberately.
- **Auto-publishing imported spots.** OSM supplies discovery; humans supply verification ([ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)). No import path produces an `active` row (R45). A safe spot is a place we tell a stranger to meet another stranger; a wrong one is a safety problem, not a data-quality problem.
- **Private businesses as safe spots.** No cafés, no supermarket car parks. `safe_spot_category` is a closed enum and there is no `private_business` member.
- **Ratings or reviews of safe spots.** Users report problems (§7.4); they do not star-rate a public library.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener**, I want to see the hours of the spot I'm meeting at so that I don't arrive at a locked door. | P0 |
| US-02 | As a **gardener with a mobility impairment**, I want to know whether a spot has step-free access and accessible parking so that I can decide whether to propose it. | P0 |
| US-03 | As a **gardener meeting a stranger**, I want to know whether the exchange point is indoors, staffed, and camera-covered so that I can judge my own comfort. | P0 |
| US-04 | As a **gardener arriving at an unfamiliar building**, I want a photo of the meeting point so that I recognise it. | P1 |
| US-05 | As **Sharecropr ops**, I want a single queue of spots whose hours are older than 90 days so that re-verification is a shift's work and not an archaeology project. | P0 |
| US-06 | As a **library branch manager**, I want a way to be removed from the app the same day I ask so that we are never listing a venue against its will. | P0 |
| US-07 | As **Sharecropr ops**, I want to suspend a spot for a renovation without breaking exchanges already scheduled there. | P0 |
| US-08 | As a **launch owner**, I want a coverage report per metro so that I know before launch which neighbourhoods have no usable spot. | P0 |

## 5. Functional Requirements

### 5.1 Eligibility and categories

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | A safe spot's `category` MUST be one of the `safe_spot_category` enum values in [Data Model §4](../01-architecture/03-data-model.md). There is no `other` free-text category and no private-business category. |
| R02 | **MUST** | A venue MUST satisfy all four eligibility criteria before reaching `active`: (a) publicly accessible without purchase or membership, (b) staffed during its published hours **or** under continuous camera coverage, (c) has a defined, describable meeting point (a lobby, a desk, a marked pavilion), (d) nobody resides at the address. |
| R03 | **MUST NOT** | A safe spot MUST NOT be created at a residential address, a private business, or an unattached car park. |
| R04 | **SHOULD** | A spot categorised `park_pavilion` SHOULD carry `is_indoor = false` and a `safety_notes` value that names its lighting and after-dark condition explicitly. |
| R05 | **MUST** | `other_municipal` MUST carry a `safety_notes` value describing what kind of venue it is; it is the escape hatch category and an unexplained one is unusable to a user. |

### 5.2 Required metadata

| ID | Req | Statement |
| --- | --- | --- |
| R06 | **MUST** | A safe spot MUST NOT transition to `active` unless all of the following are non-null and non-empty: `name`, `category`, `point`, `address_line`, `locality`, `region`, `postal_code`, `country`, `hours`, `hours_verified_at`, `accessibility_notes`, `parking_notes`, `is_indoor`. Enforced by a `BEFORE UPDATE` trigger, not by console validation. |
| R07 | **MUST** | `hours` MUST conform to the schema in §6.2 and MUST validate against a `CHECK` constraint using `jsonb_matches_schema`. Malformed hours are worse than absent hours because they render as confident and wrong. |
| R08 | **SHOULD** | A safe spot SHOULD carry a `photo_path` before reaching `active`. It is `SHOULD` rather than `MUST` only because a spot with correct hours and no photo is still usable; a curator MUST record a reason in the audit trail when activating without one. |
| R09 | **MUST** | `has_cameras` MUST be recorded as an explicit `true` or `false` where the curator has confirmed it, and left `NULL` where they have not. `NULL` renders as "Not confirmed", never as "No". Overstating surveillance is a safety claim we cannot back. |
| R10 | **MUST** | `safety_notes` MUST describe the venue's honest condition, including its weaknesses (e.g. "Lobby is staffed until 6pm; the exterior lot is unlit after dark"). A `safety_notes` value that reads as marketing is a review failure. |
| R11 | **SHOULD** | `accessibility_notes` SHOULD state, in this order: step-free entrance, accessible parking, restroom availability, and the location of the meeting point relative to the entrance. |
| R12 | **MUST** | `point` MUST be the coordinate of the **meeting point** — the lobby door, the pavilion, the desk — not the centroid of the parcel. A pin in the middle of a college campus is a 15-minute walk from where the user needs to be. |

### 5.3 Creation, approval, and authority

| ID | Req | Statement |
| --- | --- | --- |
| R13 | **MUST** | Only a caller for whom `app.is_moderator()` is true MUST be able to INSERT or UPDATE `public.safe_spots`. Enforced by the `safe_spots_staff_write` policy ([RLS Design §5 Pattern B](../01-architecture/05-rls-design.md)). |
| R14 | **MUST NOT** | The client MUST NOT have any write path to `public.safe_spots`. There is no RPC, no Edge Function, and no PostgREST write grant for role `authenticated` ([API Contract §1.3](../01-architecture/06-api-contract.md)). |
| R15 | **MUST** | Every INSERT and every UPDATE to `public.safe_spots` MUST write an `audit.events` row with `action` in (`safe_spot.created`, `safe_spot.updated`, `safe_spot.status_changed`, `safe_spot.hours_verified`), the actor, and a `metadata` diff of the changed columns. |
| R16 | **MUST** | A transition to `active` MUST set `approved_by` and `approved_at`, and `approved_by` MUST NOT equal the row's original creator where the creator is a non-admin moderator. Two-person curation for anything that becomes a place strangers meet. |
| R17 | **MUST** | Role `anon` and role `authenticated` MUST be able to read only rows where `status = 'active'`. Rows in `proposed`, `under_review`, `suspended`, and `retired` are invisible to clients. |

### 5.4 Hours, staleness, and openness

| ID | Req | Statement |
| --- | --- | --- |
| R18 | **MUST** | `hours_verified_at` MUST be set to `now()` only by an explicit "hours confirmed" action in the console, and MUST NOT be updated as a side effect of editing any other column. Touching a row is not verifying it. |
| R19 | **MUST** | A daily job `alert_stale_safe_spot_hours` MUST raise an ops alert listing every `active` spot whose `hours_verified_at` is older than **90 days**. |
| R20 | **MUST** | The client MUST render a "Hours may be out of date" note on any spot whose `hours_verified_at` is older than 90 days, on the map sheet, in the list view, and on the scheduling screen. |
> **Curation is recurring, not one-off.** R21's 180-day auto-suspension means verifying a spot's hours is a subscription, not a purchase: the operational cost scales with the number of live spots, not the number of metros launched. [R-02](../06-roadmap/02-open-risks.md) rates this the most likely real constraint on growth, ahead of engineering ([Development Notes N-09](../07-review/02-development-notes.md#n-09--safe-spot-curation-is-the-growth-constraint-not-engineering)).

| R21 | **MUST** | A spot whose `hours_verified_at` is older than **180 days** MUST be automatically transitioned to `suspended` with `suspension_reason = 'hours_unverified'` by the same job. Unverified for six months means we do not know whether it is open, and guessing produces no-shows. |
| R22 | **MUST** | `app.venue_open_during(p_safe_spot_id, p_start, p_end)` MUST return `false` when any part of `[p_start, p_end)` falls outside the venue's weekly hours or inside a listed exception, and MUST be the single authority used by [SPEC-010-R31](SPEC-010-exchange-lifecycle.md) to raise `venue_closed`. |
| R23 | **MUST** | `app.venue_open_during` MUST evaluate hours in the safe spot's local timezone (`hours.timezone`), never the server's and never the caller's. |
| R24 | **SHOULD** | Ops SHOULD re-verify hours for every launch-metro spot on a rolling **30-day** cadence, which is tighter than the 90-day alert so that the alert is an exception rather than the process. |
| R25 | **MUST** | `hours.exceptions` MUST support both full-day closures and altered windows, with an `until` date; an exception without an end date is a permanent hours change and MUST be entered as such. |

### 5.5 Suspension, retirement, and takedown

| ID | Req | Statement |
| --- | --- | --- |
| R26 | **MUST** | Transitioning a spot to `suspended` or `retired` MUST NOT delete or rewrite any `exchange_sessions` row that references it. |
| R27 | **MUST** | Transitioning a spot to `suspended` or `retired` MUST enqueue a `safety_alert` notification to both participants of every `exchange_sessions` row in state `scheduling` or `scheduled` that references it. `safety_alert` is chosen deliberately over `exchange_cancelled` because it is not suppressible ([SPEC-013-R09](SPEC-013-notifications.md)) and someone may be about to drive there. |
| R28 | **MUST** | Transitioning a spot to `suspended` or `retired` MUST remove it from every `listing_safe_spots` row, and MUST transition any listing left with **zero** remaining safe spots to `withdrawn`, notifying its owner. A listing offered nowhere is not a listing. |
| R29 | **MUST** | A session already in `scheduled` at a suspended spot MUST remain schedulable-out: both parties retain `propose_schedule` and `cancel_session`, and a cancellation caused by a venue suspension MUST NOT count as a late cancellation regardless of timing ([SPEC-010-R44](SPEC-010-exchange-lifecycle.md)). |
| R30 | **MUST** | A venue takedown request MUST be actionable within **one business day** and MUST result in `status = 'retired'` with `retirement_reason = 'venue_request'`. |
| R31 | **MUST NOT** | A `retired` spot MUST NOT be reactivated by an UPDATE. Re-listing a venue that previously asked to be removed requires a new row and a new consent record. |
| R32 | **SHOULD** | Ops SHOULD record a venue-consent state for every spot in `private.safe_spot_consents` before activation: `not_contacted`, `informed`, `consented`, or `objected`. A spot whose consent state is `objected` MUST NOT be `active`. |
| R33 | **MUST** | `suspension_reason` and `retirement_reason` MUST be drawn from a closed vocabulary (§6.3) so that the coverage report can distinguish "temporarily closed for renovation" from "the library asked us to stop". |

### 5.6 Coverage

| ID | Req | Statement |
| --- | --- | --- |
| R34 | **MUST** | A launch metro MUST have ≥ **40** `active` safe spots with `hours_verified_at` within 30 days before it opens ([PRD §7](../00-foundation/02-prd.md)). |
| R35 | **MUST** | A launch metro MUST have ≥ **90%** of its population within 3 km of an `active` safe spot, measured against census block-group centroids ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)). |
| R36 | **SHOULD** | Every launch metro SHOULD have at least one `active` spot open past 18:00 on a weekday and at least one open on a Saturday, in each of its coverage quadrants. Weekday-daytime-only coverage excludes everyone with a job. |
| R37 | **MUST** | A weekly `safe_spot_coverage_report` MUST be produced per metro covering: `active` count, count by category, count with stale hours, population-within-3km percentage, and the ten `active` spots with the fewest attached listings. |
| R38 | **SHOULD** | Coverage dropping below the R35 threshold in a live metro SHOULD open a P2 ops incident, not a backlog ticket. |

### 5.7 OSM candidate sourcing

Curation has two halves that this spec previously treated as one. **Discovery** — finding every library, town hall, police station, community centre, fire station, and campus in a metro — is a data problem OpenStreetMap has already solved. **Verification** — confirming hours, judging whether the entrance is lit and staffed, obtaining consent — is irreducibly human and is where the actual cost sits. [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) automates only the first half, and this section is careful to keep it there.

Two things are worth stating plainly before the requirements. First, **the durable value is the monthly diff, not the initial import**: a person with a browser and an afternoon can list every library in Ann Arbor, but nobody will notice, every month across every market, that a building closed or moved — and that failure arrives later as a user standing outside a shut door. Second, **a review queue erodes the attention the manual process forced**. Rubber-stamping is what queues produce, and this is a safety-critical judgement. R49 and R50 are the answer to that, and they are deliberately inconvenient.

| ID | Req | Statement |
| --- | --- | --- |
| R39 | **MUST** | Candidate import MUST query the Overpass API per launch-metro bounding box, one amenity tag at a time, and write results to `private.osm_spot_candidates` (§6.4). |
| R40 | **MUST** | The OSM tag → `safe_spot_category` mapping MUST be exactly the table in §6.4. An element whose tags map to no entry MUST be dropped at import and MUST NOT be mapped to `other_municipal`. The escape-hatch category exists for a human who has seen a venue, not for an importer that did not recognise a tag. |
| R41 | **MUST** | An element with no `name` tag MUST be rejected at import and MUST NOT create a candidate row. An unnamed civic building is not reviewable — a reviewer cannot phone it, and a user cannot recognise it. |
| R42 | **MUST** | An element carrying `access=private` or `access=no` MUST be auto-rejected with `rejection_reason = 'access_restricted'`. R02(a) requires public accessibility without purchase or membership; an explicit upstream statement to the contrary is dispositive and does not need reviewer time. |
| R43 | **MUST** | A candidate within **50 m** of an existing `public.safe_spots` row whose `name` has trigram similarity **≥ 0.6** to it MUST be written with `review_state = 'duplicate'` and MUST NOT enter the review queue. Re-import of the same OSM element MUST update `last_seen_at` on the existing candidate rather than create a second row — the unique index on `(osm_type, osm_id)` makes that structural. |
| R44 | **MUST** | Candidates MUST land in `private.osm_spot_candidates` with `review_state = 'pending'` and MUST NOT be reachable by role `anon` or `authenticated` through any table, view, RPC, or grant. **An unreviewed candidate is never discoverable.** It is in `private` rather than in `safe_spots` with a status filter precisely so that this is structural rather than a filter somebody must remember. |
| R45 | **MUST** | A candidate MUST NOT become a `public.safe_spots` row with `status = 'active'` without an explicit human promotion action. Promotion MUST satisfy every rule already in §5.1–§5.4 without exception — the R06 completeness trigger, the R16 second approver, R12's meeting-point pin (not the OSM centroid), and R02's eligibility criteria. **The import path has no privileges the manual path lacks**; it just fills in a form's first draft. |
| R46 | **MUST** | A promoted row MUST carry `source = 'osm_import'`, `osm_type`, `osm_id`, `osm_source_licence = 'ODbL-1.0'`, and `osm_last_synced_at`, and the candidate MUST have `promoted_safe_spot_id`, `reviewed_by`, and `reviewed_at` set in the same transaction. |

#### Hours: the rule this section exists to enforce

| ID | Req | Statement |
| --- | --- | --- |
| R47 | **MUST** | `private.osm_spot_candidates.suggested_hours_raw` is a **reviewer hint only**. It MUST be displayed in the console review UI explicitly labelled as unverified OSM data with the element's `last_seen_at`, and it MUST NOT be rendered to an end user on any surface, at any time, in any state. |
| R48 | **MUST NOT** | **No automated path — trigger, function, scheduled job, console action, migration, or backfill — may copy `suggested_hours_raw` into `public.safe_spots.hours`, nor set `hours_verified_at` from an import or a refresh.** Those two columns are written only by the explicit human verification action of R18. This is why the staging column is named differently from the live one ([Data Model §9](../01-architecture/03-data-model.md#9-safe-spots)): making the values structurally hard to confuse is cheaper than a code review that catches somebody copying them across. The reason is R-02 and the whole of §5.4 — **stale hours are the single largest controllable generator of no-shows**, OSM `opening_hours` on civic buildings is patchy and frequently years out of date, and a no-show is a real person's wasted afternoon and a trust event on somebody's score ([SPEC-012](SPEC-012-trust-and-safety.md)). An imported hours string that reached a user would be us laundering a stranger's guess into a confident claim. |
| R49 | **MUST** | Promotion MUST require an hours-verification action recorded **separately** from the approval: an `audit.events` row with `action = 'safe_spot.hours_verified'` carrying `verification_method` in (`phone`, `visit`, `official_website`) and the source detail (number called, URL, date of visit). Activation MUST fail if no such event exists for the candidate within the promotion transaction's history. |
| R50 | **MUST NOT** | The console MUST NOT offer any single control that approves a candidate and activates a spot. The hours form MUST start **empty**; `suggested_hours_raw` is displayed beside it and MUST NOT pre-populate it, and there MUST be no "accept suggested hours" button. Retyping hours after a phone call is a human act; accepting a pre-filled form is not, and the difference is the entire control. [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)'s strongest argument against itself is queue-induced rubber-stamping; R49 and R50 are the answer, and they are answerable only by someone who actually made the call. |

#### Monthly refresh and the diff

| ID | Req | Statement |
| --- | --- | --- |
| R51 | **MUST** | A monthly job MUST re-query Overpass for every active metro, join results to `public.safe_spots` and `private.osm_spot_candidates` on `(osm_type, osm_id)`, and update `last_seen_at` and `osm_last_synced_at` on every element it sees. |
| R52 | **MUST** | An element present upstream with no matching spot or candidate MUST create a new candidate with `review_state = 'pending'`, subject to R40–R43 exactly as at initial import. |
| R53 | **MUST** | An element that has disappeared from OSM but has a linked `active` spot MUST raise a re-verification flag in the ops queue with reason `osm_element_deleted`. It MUST NOT change `status` automatically. The building may have closed — or the element may have been retagged, merged, or vandalised, and auto-suspending on an upstream edit hands a stranger the ability to remove our supply. |
| R54 | **MUST** | A change upstream to `name`, any `addr:*` tag, or `opening_hours` on a linked spot MUST raise a review flag carrying the before/after diff, and MUST NOT auto-apply to the live row. An `opening_hours` change specifically MUST NOT touch `hours`, `hours_verified_at`, or the staleness clock (R48) — an upstream edit is not a verification, and treating it as one would let anyone with an OSM account reset our 90-day counter. |
| R55 | **MUST** | An element that has moved **> 50 m** MUST raise a review flag; the live `point` MUST NOT be moved automatically. R12 requires the pin to be the meeting point a human chose, not the OSM centroid, so an upstream geometry change is evidence to look at rather than a value to copy. |
| R56 | **MUST NOT** | **Nothing auto-applies to a live safe spot, in either direction.** The refresh job's only permitted writes to `public.safe_spots` are `osm_last_synced_at`; everything else it produces is a flag in a human queue. |

#### Licence obligations (ODbL 1.0)

| ID | Req | Statement |
| --- | --- | --- |
| R57 | **MUST** | Every row with `source = 'osm_import'` MUST have `osm_type`, `osm_id`, and `osm_source_licence` non-null, enforced by a `CHECK` constraint rather than by the import code. We must be able to answer "which of our records are OSM-derived" from the database at any time, including for rows written before whatever bug we are investigating. |
| R58 | **MUST** | "© OpenStreetMap contributors" MUST be rendered on every surface displaying OSM-derived spot data — the safe-spot sheet at every detent that shows spot fields, the list row context, both spot pickers, and the credits screen — and on the map ([SPEC-008-R75](SPEC-008-interactive-map.md)). The rendered sheet and list are ODbL **Produced Works**: they require attribution, not share-alike. |
| R59 | **MUST** | Any feature that exports, publishes, syndicates, or exposes a public API over safe-spot data MUST have a **recorded legal review of ODbL share-alike completed before implementation begins**, not before launch. A database derived from OSM data must itself be ODbL if published; we do not publish ours today, which is the only reason this does not currently bite. The obligation is recorded here so that whoever proposes a "share our safe spots" feature finds this line rather than discovering ODbL afterwards ([ADR-0021 §Licence obligations](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md#licence-obligations), [Q1](#15-open-questions)). |

#### Overpass usage

Overpass is donated community infrastructure with per-IP rate limiting and load shedding. It owes us nothing and has no SLA.

| ID | Req | Statement |
| --- | --- | --- |
| R60 | **MUST** | Overpass MUST be queried only from a scheduled server-side Edge Function. No client, no moderation console action, no CI job, and no user-triggered path may issue an Overpass query. |
| R61 | **MUST** | Every request MUST send a descriptive `User-Agent` identifying Sharecropr with a contact address, MUST check `/api/status` before starting a batch, and MUST back off exponentially on `429`, abandoning the run rather than retrying past the advertised slot. A run abandoned this month is a run that succeeds next month; a blocked User-Agent is an outage we cannot fix from our side. |
| R62 | **MUST** | Cadence MUST be **monthly** per metro. Civic buildings do not move. An ad-hoc run is permitted only for a new-market import and MUST be limited to one per metro per day, enforced in the function rather than by convention. |
| R63 | **SHOULD** | If the monthly job is rate-limited twice, Ops SHOULD stand up a Sharecropr Overpass instance from a Geofabrik extract rather than lean harder on the public one ([ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)). |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.safe_spots`](../01-architecture/03-data-model.md#9-safe-spots) | read (all roles, `active` only) / write (moderator) | The whole spec |
| `public.listing_safe_spots` | write (definer, on suspension) | R28 detaches listings from a suspended spot |
| `public.listings` | write (definer, on suspension) | R28 withdraws orphaned listings |
| `public.exchange_sessions` | read (definer, on suspension) | R27 finds affected participants. Never written by this spec. |
| `public.notifications` / `private.notification_outbox` | write via `app.enqueue_notification` | R27 |
| `audit.events` | write | R15, R49 |
| [`private.osm_spot_candidates`](../01-architecture/03-data-model.md#9-safe-spots) | write (import Edge Function, service role) / read (moderator, via the console) | §5.7. **No grant to `anon` or `authenticated` at all** (R44) |

**New schema objects introduced by this spec:** migration `20260808_0071_safe_spot_curation.sql`

```sql
ALTER TABLE public.safe_spots
  ADD COLUMN suspension_reason text CHECK (suspension_reason IN
      ('temporary_closure','renovation','venue_request','safety_concern',
       'hours_unverified','data_error','seasonal')),
  ADD COLUMN retirement_reason text CHECK (retirement_reason IN
      ('venue_request','permanently_closed','ineligible_on_review',
       'superseded_by_row','safety_incident')),
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN status_changed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN metro_slug text CHECK (length(metro_slug) <= 40);

CREATE INDEX safe_spots_metro_idx ON public.safe_spots (metro_slug) WHERE status = 'active';
CREATE INDEX safe_spots_hours_stale_idx ON public.safe_spots (hours_verified_at)
  WHERE status = 'active';

-- Venue consent. Private: it contains named contacts at municipal organisations.
CREATE TABLE private.safe_spot_consents (
  safe_spot_id  uuid PRIMARY KEY REFERENCES public.safe_spots(id) ON DELETE CASCADE,
  state         text NOT NULL CHECK (state IN ('not_contacted','informed','consented','objected')),
  contact_role  text CHECK (length(contact_role) <= 120),   -- role, never a person's name
  contacted_at  timestamptz,
  responded_at  timestamptz,
  notes         text CHECK (length(notes) <= 1000),
  updated_by    uuid NOT NULL REFERENCES public.profiles(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.safe_spot_consents FROM anon, authenticated;
```

Also introduced: `app.venue_open_during(uuid, timestamptz, timestamptz) → boolean` (definer, `STABLE`, granted to `authenticated`), the `trg_safe_spot_activation_guard` BEFORE UPDATE trigger enforcing R06/R16/R31, the `trg_safe_spot_status_fanout` AFTER UPDATE trigger implementing R27/R28, and two `pg_cron` jobs: `alert_stale_safe_spot_hours` (daily 08:00 UTC) and `safe_spot_coverage_report` (weekly Monday 07:00 UTC).

**Added in 1.1.0 for §5.7:** migration `20260809_0072_osm_spot_sourcing.sql`. The column and table definitions are authoritative in [Data Model §9](../01-architecture/03-data-model.md#9-safe-spots); this migration adds them plus the constraints this spec requires.

```sql
-- Provenance. safe_spot_source and the columns themselves are defined in Data Model §9.
ALTER TABLE public.safe_spots
  ADD COLUMN source             safe_spot_source NOT NULL DEFAULT 'manual',
  ADD COLUMN osm_type           text CHECK (osm_type IN ('node','way','relation')),
  ADD COLUMN osm_id             bigint,
  ADD COLUMN osm_last_synced_at timestamptz,
  ADD COLUMN osm_source_licence text DEFAULT 'ODbL-1.0';

-- R57: provenance is a constraint, not a convention.
ALTER TABLE public.safe_spots
  ADD CONSTRAINT safe_spots_osm_provenance CHECK (
    source <> 'osm_import'
    OR (osm_type IS NOT NULL AND osm_id IS NOT NULL AND osm_source_licence IS NOT NULL)
  );

CREATE UNIQUE INDEX safe_spots_osm_key ON public.safe_spots (osm_type, osm_id)
  WHERE osm_id IS NOT NULL;

-- R44: the staging table lives in private so that "not discoverable" is structural.
CREATE TABLE private.osm_spot_candidates ( /* Data Model §9 */ );
REVOKE ALL ON private.osm_spot_candidates FROM anon, authenticated;
```

Also introduced: the `osm_spot_import` Edge Function (scheduled monthly per metro, R39/R51/R60–R62), the `trg_safe_spot_hours_verification_guard` BEFORE UPDATE trigger enforcing R49, and a CI schema assertion that `private.osm_spot_candidates` has no column named `hours` or `hours_verified_at` — there is deliberately no column on that table that a careless `INSERT … SELECT` could align with `safe_spots.hours` (R48).

**PII touched:** none of the spot data itself — `safe_spots` is classified **P3, public** throughout ([Data Model §1](../01-architecture/03-data-model.md)). `private.safe_spot_consents.contact_role` and `notes` are **P1** and live in `private` because they describe named organisations' internal positions; the schema deliberately stores a role ("Branch Manager") rather than a person's name. R27's fanout reads `exchange_sessions.owner_id` / `requester_id` (**P1**) inside a `SECURITY DEFINER` function and returns nothing to any client. `private.osm_spot_candidates` is **P3** throughout — it describes public buildings and carries no user data — and lives in `private` for discoverability reasons (R44) rather than confidentiality ones. Its `raw_tags` may nonetheless contain upstream `contact:*` and `operator` tags naming individuals at small venues, which is a second reason not to expose it and a reason the console renders it as inspectable JSON rather than mapping it into fields.

## 7. API

### 7.1 `GET /rest/v1/safe_spots` (PostgREST read)

**Auth:** `anon` or `authenticated`
**Rate limit:** 60 / min / IP
**Cache:** `max-age=3600`

Shape and select list are fixed in [API Contract §4.3](../01-architecture/06-api-contract.md). `point` is deliberately absent from the detail path; coordinates arrive via `safe_spots_near`, which carries the radius cap and the 200-row cap. Detail reads are by id and do not need geometry.

```jsonc
// Response 200 — one row
{
  "id": "3f2a9c11-…",
  "name": "Ann Arbor District Library — Downtown",
  "category": "public_library",
  "address_line": "343 S Fifth Ave",
  "locality": "Ann Arbor", "region": "MI", "postal_code": "48104", "country": "US",
  "hours": { /* §6.2 */ },
  "hours_verified_at": "2026-07-21T15:02:00Z",
  "accessibility_notes": "Step-free entrance on Fifth Ave. Two accessible bays in the surface lot. Restrooms on the ground floor, left of the desk.",
  "parking_notes": "Free 2-hour surface lot on the north side; street metered until 6pm.",
  "safety_notes": "Lobby is staffed until 9pm. The surface lot is lit but not camera-covered.",
  "photo_path": "safe-spots/3f2a9c11/entrance.webp",
  "is_indoor": true,
  "has_cameras": true
}
```

| Error code | HTTP | When |
| --- | --- | --- |
| `request_not_found` | 404 | Id does not exist, or `status <> 'active'` — the two are indistinguishable to a client by design |

### 7.2 `rpc.safe_spots_near`

Owned by [SPEC-008](SPEC-008-interactive-map.md) and specified verbatim in [Location Privacy §6](../01-architecture/04-location-privacy.md). Named here only to state the coupling: it filters on `s.status = 'active'`, so R17 and every suspension in §5.5 take effect on the map within one `staleTime` window (60 s) with no client change.

### 7.3 `app.venue_open_during` (internal definer function)

**Auth:** `authenticated` (EXECUTE granted); called by `propose_schedule` and by the client's read-only preview.

```sql
CREATE OR REPLACE FUNCTION app.venue_open_during(
  p_safe_spot_id uuid, p_start timestamptz, p_end timestamptz
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_hours jsonb; v_tz text; v_d date; v_local_start time; v_local_end time;
  v_dow text; v_win jsonb; v_ok boolean := false;
BEGIN
  SELECT hours, hours ->> 'timezone' INTO v_hours, v_tz
    FROM public.safe_spots WHERE id = p_safe_spot_id AND status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;

  -- A window that crosses local midnight is never open: venues in scope close at night.
  v_d          := (p_start AT TIME ZONE v_tz)::date;
  IF (p_end AT TIME ZONE v_tz)::date <> v_d THEN RETURN false; END IF;
  v_local_start := (p_start AT TIME ZONE v_tz)::time;
  v_local_end   := (p_end   AT TIME ZONE v_tz)::time;
  v_dow         := lower(to_char(v_d, 'dy'));

  -- Exceptions win over the weekly schedule, always.
  SELECT e INTO v_win FROM jsonb_array_elements(v_hours -> 'exceptions') e
   WHERE (e ->> 'date')::date = v_d
      OR (e ? 'until' AND v_d BETWEEN (e ->> 'date')::date AND (e ->> 'until')::date)
   LIMIT 1;
  IF FOUND THEN
    IF (v_win ->> 'closed')::boolean THEN RETURN false; END IF;
    RETURN v_local_start >= (v_win ->> 'open')::time
       AND v_local_end   <= (v_win ->> 'close')::time;
  END IF;

  SELECT bool_or(v_local_start >= (w ->> 'open')::time
             AND v_local_end   <= (w ->> 'close')::time)
    INTO v_ok
    FROM jsonb_array_elements(v_hours -> 'weekly' -> v_dow) w;
  RETURN COALESCE(v_ok, false);
END; $$;
```

Returns `false` — never raises — for an unknown, suspended, or retired spot. The caller decides whether that is `venue_closed` or `validation_failed`; conflating them inside this function would make it unusable for the client's preview.

### 7.4 "Report a problem with this spot"

Not a new endpoint. It is `rpc.create_report` with `p_subject_type = 'safe_spot'` and a `report_reason` of `unsafe_meeting` or `other`, specified in [SPEC-012 §7](SPEC-012-trust-and-safety.md). Reports against a safe spot route to the venue-relations queue in [SPEC-900 §5.3](SPEC-900-moderation-console.md) rather than to user moderation, because the subject is a building and no moderation action in the `moderation_action` enum applies to it.

### 7.5 Staff writes

Staff create and edit spots through the moderation console, which writes via PostgREST as a moderator JWT under the `safe_spots_staff_write` policy. There is no bespoke RPC. Console UX, the queue, and the audit surface are [SPEC-900 §5.3](SPEC-900-moderation-console.md).

### 6.2 `hours` JSON schema

*(Numbered as data, referenced from R07. Placed here because it is the API's payload shape.)*

```jsonc
{
  "timezone": "America/Detroit",          // IANA. Required. Never inferred from the point.
  "weekly": {
    "mon": [{ "open": "09:00", "close": "21:00" }],
    "tue": [{ "open": "09:00", "close": "21:00" }],
    "wed": [{ "open": "09:00", "close": "21:00" }],
    "thu": [{ "open": "09:00", "close": "21:00" }],
    "fri": [{ "open": "09:00", "close": "18:00" }],
    "sat": [{ "open": "10:00", "close": "18:00" }],
    "sun": []                              // empty array = closed. Never a missing key.
  },
  "exceptions": [
    { "date": "2026-11-26", "closed": true, "label": "Thanksgiving" },
    { "date": "2026-12-24", "closed": false, "open": "09:00", "close": "13:00", "label": "Christmas Eve" },
    { "date": "2027-01-05", "until": "2027-02-28", "closed": true, "label": "HVAC replacement" }
  ]
}
```

Two windows per day are permitted (a midday closure), which is why `weekly.<dow>` is an array. A missing day key is a validation failure, not "closed" — the difference between "we know it's shut" and "we forgot to ask" is exactly the difference this spec exists to preserve.

### 6.3 Closed vocabularies

| Field | Values |
| --- | --- |
| `suspension_reason` | `temporary_closure`, `renovation`, `venue_request`, `safety_concern`, `hours_unverified`, `data_error`, `seasonal` |
| `retirement_reason` | `venue_request`, `permanently_closed`, `ineligible_on_review`, `superseded_by_row`, `safety_incident` |
| `private.safe_spot_consents.state` | `not_contacted`, `informed`, `consented`, `objected` |
| `private.osm_spot_candidates.review_state` | `pending`, `approved`, `rejected`, `duplicate` |
| `private.osm_spot_candidates.rejection_reason` | `unnamed`, `access_restricted`, `unmapped_tag`, `out_of_bbox`, `implausible_geometry`, `not_eligible`, `venue_declined` |
| `audit.events` `verification_method` (R49) | `phone`, `visit`, `official_website` |

### 6.4 OSM tag → category mapping (R40)

Exactly this table, from [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md). An element matching no row is dropped with `rejection_reason = 'unmapped_tag'`.

| OSM tag | `safe_spot_category` | Reviewer note carried into the queue |
| --- | --- | --- |
| `amenity=library` | `public_library` | Highest-quality category; OSM coverage is excellent |
| `amenity=police` | `police_station` | **Flagged.** Lobby access varies enormously, and see [Q5](#15-open-questions) — a segment of users will not enter one |
| `amenity=townhall` | `city_hall` | |
| `amenity=community_centre` | `community_center` | |
| `amenity=fire_station` | `fire_station` | **Flagged.** Many are unstaffed |
| `amenity=college`, `amenity=university` | `college_campus` | **Flagged.** A campus is a polygon; a human MUST choose a specific entrance (R12), because the centroid is a fifteen-minute walk from anywhere useful |
| `amenity=marketplace` | `farmers_market` | **Flagged.** Frequently seasonal; hours are the least reliable in the set |

Additional tags read but never trusted: `name` (**required**, R41), `addr:*` (best-effort, a human corrects), `wheelchair` (an accessibility *hint*; R11's notes are written by a human), `opening_hours` (R47, R48), `access` (R42). Node geometry is used directly; ways and relations are reduced to a representative centroid, which R12 then requires a human to move to the actual meeting point.

There is no mapping to `park_pavilion` or `other_municipal`. `leisure=park` is far too broad to import — most parks have no describable meeting point and fail R02(c) — and `other_municipal` is the human escape hatch (R05), not an importer's default.

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Safe-spot sheet (map) | `/(modals)/safe-spot/[safeSpotId]` | Three-detent bottom sheet on the map; full modal elsewhere ([Mobile Architecture §4.6](../01-architecture/02-mobile-architecture.md)) |
| Safe-spot row (list view) | `/map/list` | Same data, distance-sorted, screen-reader-first ([SPEC-008 §8](SPEC-008-interactive-map.md)) |
| Spot picker (scheduling) | `/(modals)/schedule/[sessionId]` | Choose among the listing's 1–3 spots; shows hours and open/closed for the proposed window |
| Spot picker (publishing) | `/(modals)/listing-new/[itemId]` | Choose 1–3 spots for a listing ([SPEC-009 §8](SPEC-009-listings-and-offers.md)) |
| Report a problem | `/(modals)/report?subjectType=safe_spot&subjectId=…` | Venue-relations queue |

Sheet content by detent:

| Detent | Content |
| --- | --- |
| 25% (peek) | Name, category, distance, total available count, open/closed pill |
| 55% (default) | Above + today's hours, accessibility notes, parking notes, indoor/outdoor and camera pills, the listing list |
| 92% | Above + photo, safety notes, full weekly hours with exceptions, "Report a problem" |

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Sheet opens immediately at the 55% detent with the name, category, and distance already known from the map marker; hours, notes, and listings render as skeleton rows. The sheet never waits on the network to appear — the user already tapped a marker and expects a response inside 150 ms. |
| Empty | Spot exists, zero listings currently offered there. Body: the spot's full details, plus the empty-state copy in §8.3. This is the common case in a cold-start metro and it must not read as an error. |
| Error (recoverable) | Detail fetch failed but the marker data is cached: render name, category, distance, and an inline row "Couldn't load details — Retry". The map stays fully interactive behind the sheet. |
| Error (terminal) | Spot returns 404 (suspended, retired, or never existed): the sheet closes, the marker is removed from the local cluster index, and a toast fires. The map is invalidated so the marker does not return on the next frame. |
| Offline | Full render from the 7-day `safe_spots` cache with a "Showing saved details" chip. Hours, accessibility, parking, and the photo are all cached and are the fields most needed at a venue with one bar of signal. The listing list at the spot is greyed with a staleness timestamp. |
| Permission denied | Not applicable to the spot detail itself. With location denied there is no `distance_m`; the distance line is omitted rather than showing "— km", and the sheet is reached from the locality-search list ([SPEC-008 §5.6](SPEC-008-interactive-map.md)). |
| Rate limited | 60/min/IP is effectively unreachable through the UI. If hit, the sheet renders from cache with the recoverable-error row and the retry button is disabled for `Retry-After` seconds with a visible countdown. |

Two additional states specific to this spec:

| State | Behaviour |
| --- | --- |
| Stale hours (`hours_verified_at` > 90 days) | A persistent amber note directly beneath the hours block, present at every detent that shows hours, and repeated on the scheduling screen. It is never a dismissible toast. |
| Closed right now | The open/closed pill reads "Closed · Opens Tue 9:00 AM". A spot being closed now does not hide it or its listings — people schedule for later. |

### 8.3 Copy

Exact strings.

**Open / closed pill**
- `Open until 9:00 PM`
- `Closed · Opens Tue at 9:00 AM`
- `Closed today`
- `Hours not available` — only reachable if hours validation regressed; treated as a bug, not a state.

**Stale hours note**
> **Hours may be out of date.** We last confirmed these on 21 Apr 2026. Call ahead if you're cutting it close.

**Empty — no listings at this spot**
> **Nothing here yet.** No one is offering crops at this spot right now. Widen your radius, or publish something of your own here — a spot with one listing gets a lot more traffic than a spot with none.

**Terminal error — spot gone**
> This spot isn't available anymore.

**Recoverable error — details failed**
> Couldn't load the details for this spot. **Retry**

**Offline chip**
> Showing saved details

**Camera / indoor pills**
- `Indoor` / `Outdoor`
- `Cameras on site` (when `has_cameras = true`)
- `Camera coverage not confirmed` (when `has_cameras IS NULL`) — never rendered as "No cameras", which we cannot assert.
- `No camera coverage` (when `has_cameras = false`)

**Accessibility block header**
> Getting in

**Safety block header**
> What to expect here

**Suspension `safety_alert` to a scheduled participant** (`title` / `body`)
> **Meeting place unavailable**
> {safe_spot_name} is no longer available for exchanges. Open your exchange to pick a new place and time.

**Listing withdrawn because its last spot was suspended**
> **Listing withdrawn**
> {listing_title} was offered only at {safe_spot_name}, which is no longer available. Publish it again at another spot when you're ready.

**OSM attribution (R58 — rendered on every surface showing spot data, exact string)**
> © OpenStreetMap contributors

Rendered whether or not the specific spot on screen is OSM-derived. Attribution that appears on some rows and not others invites the question "which of these came from OSM?", which is a question about our data pipeline that no user has, and it makes the notice something a layout change can accidentally remove for the row that needed it. Identical string, capitalisation, and rules as [SPEC-008 §8.3](SPEC-008-interactive-map.md).

**Report a problem — entry point label**
> Report a problem with this spot

**Report a problem — reason options** (subset of `report_reason` valid for `subject_type = 'safe_spot'`)
- `Hours are wrong`
- `This place doesn't exist / I couldn't find it`
- `It didn't feel safe here` → maps to `unsafe_meeting`
- `Accessibility information is wrong`
- `Something else`

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | Two things. (1) **Inject a hostile venue.** A safe spot the attacker controls — a private address dressed as a "community center" — converts the entire safety architecture into a lure. This is why there is no client write path at all (R14), why writes require `app.is_moderator()` (R13), and why activation requires a second approver (R16). (2) **Bulk-harvest the network** as a proxy for where Sharecropr users are. Safe-spot coordinates are public data about public buildings, so the harm is low, but the `listing_count` attached to each spot is a supply signal; that is bounded by the 200-row cap and the 30/min limit on `safe_spots_near`, not by anything in this spec. (3) **Poison the candidate queue upstream.** OSM is world-editable, so an attacker can tag their own address `amenity=community_centre` and wait for our monthly import to queue it — a variant of (1) that arrives through a channel we do not control. The controls are the same ones and they are the reason §5.7 changes none of them: a candidate is never discoverable (R44), promotion requires eligibility assessment plus a second approver (R45), and R49's hours verification requires contacting a venue that, in this attack, does not exist. The residual risk is a reviewer who approves without doing the work, which is what R50 is built against and what the approval-rate alert in §11 is watching for. |
| Which RLS policies enforce access? | `safe_spots_read` (`FOR SELECT TO anon, authenticated USING (status = 'active')`) and `safe_spots_staff_write` (`FOR ALL TO authenticated USING (app.is_moderator()) WITH CHECK (app.is_moderator())`) — [RLS Design §5 Pattern B](../01-architecture/05-rls-design.md). `private.safe_spot_consents` and `private.osm_spot_candidates` have no policy at all; the schema-level `REVOKE ALL ON SCHEMA private FROM anon, authenticated` is the denial, and it is why an unreviewed OSM candidate cannot be reached by any client request however malformed (R44). Definer functions: `app.is_moderator()`, `app.venue_open_during()`, `app.enqueue_notification()`. |
| Can any response path expose an exact coordinate or PII? | It exposes `safe_spots.point`, which is exact, precise, and deliberately public — a public building. It is one of two entries on the coordinate-column allowlist for the CI contract sweep (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)). No path in this spec touches `private.garden_locations`, `gardens.fine_cell`, or any user coordinate. The R27 fanout reads participant ids inside a definer function and returns nothing. |
| What is logged, and is it scrubbed? | Every write to `safe_spots` writes `audit.events` with a column diff (R15). Coordinates in `metadata` would fail the `CHECK` forbidding `lat`/`lng`/`point` keys, so the diff records `point` as a boolean "changed" flag rather than a value — a deliberate consequence of applying the same rule uniformly rather than exempting public data. Consent notes are never logged outside `private`. |
| Does this need step-up authentication? | No. Curation writes are moderator-role operations behind console SSO; AAL2 is reserved for account-security operations ([API Contract §2.4](../01-architecture/06-api-contract.md)). A moderator's session compromise is handled by session revocation and the audit trail, not by a TOTP prompt per row edit. |
| Abuse / rate-limit controls | Reads: 60/min/IP at Kong. Writes: 120/min/moderator via `moderation-action` limits. `create_report` against a spot: 10/day/user, shared with all other report types ([API Contract §7.2](../01-architecture/06-api-contract.md)). No user-facing write surface exists to abuse. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | A library announces a two-week closure mid-season, and 14 sessions are scheduled there. | Curator sets `suspended` / `temporary_closure`. R27 fires 28 `safety_alert` notifications. R28 detaches the spot from all attached listings; listings with other spots survive, listings with none are withdrawn (R28). No session is auto-cancelled — the parties reschedule, and cancellations arising from it are exempt from the late-cancel penalty (R29). |
| EC-02 | A spot's `hours_verified_at` crosses 90 days on a Saturday, when nobody is on shift. | Client-side staleness rendering (R20) is computed from `hours_verified_at` at render time, not from a server flag, so the note appears immediately without a job run. The ops alert (R19) fires Monday. |
| EC-03 | A spot reaches 180 days unverified and is auto-suspended (R21) while a session is scheduled there for tomorrow. | Auto-suspension takes the same R27/R28 path as manual suspension. Both parties get a `safety_alert`. This is the intended outcome: we would rather move a meeting than send someone to a building we have not confirmed is open. |
| EC-04 | A curator activates a spot with no photo. | Permitted (R08 is `SHOULD`), but the activation trigger requires a non-null `metadata.no_photo_reason` in the audit event and the coverage report counts it in a "missing photo" column. |
| EC-05 | A college campus spot is pinned at the campus centroid; users arrive and cannot find each other. | R12 violation. Surfaces as `unsafe_meeting`/`other` reports and as a no-show cluster on one `safe_spot_id`. The observability rule in §11 alerts on ≥ 3 no-shows at one spot in 14 days, which is the detection path for a bad pin. |
| EC-06 | Two moderators edit the same spot's hours concurrently. | Last write wins on the row; both writes appear in `audit.events` with diffs, so the loss is visible and recoverable. No optimistic-concurrency column on `safe_spots` — the write volume does not justify one, and a lost hours edit is caught by re-verification. |
| EC-07 | The venue's timezone differs from the user's (a metro spanning a timezone boundary, or a traveller). | `app.venue_open_during` evaluates in `hours.timezone` (R23). The client renders hours in the **venue's** timezone with the abbreviation shown (`9:00 AM ET`) whenever it differs from the device timezone. Rendering venue hours in the viewer's timezone is a bug that sends people to a locked door. |
| EC-08 | A window is proposed that spans local midnight (23:30–00:30). | `app.venue_open_during` returns `false`. Every eligible category closes at night, so a midnight-spanning window is always an error; the client shows the `venue_closed` copy in [SPEC-010 §8.3](SPEC-010-exchange-lifecycle.md) rather than a special case. |
| EC-09 | A branch manager emails asking to be delisted at 16:50 on a Friday. | Retirement is a one-business-day obligation (R30). Ops sets `retired` / `venue_request`, R27 and R28 fire, `private.safe_spot_consents.state` moves to `objected`, and the row can never be reactivated (R31). |
| EC-10 | A spot is retired in error and needs to come back. | It cannot be reactivated (R31). A new row is created, re-approved under R16, and the old row's `retirement_reason` is set to `superseded_by_row` with the new id in the audit metadata. Sessions referencing the old id keep referencing it; they are historical facts. |
| EC-11 | Coverage in a live metro drops below 90%-within-3km because three spots suspended in one week. | Weekly report (R37) detects it; a P2 ops incident opens (R38). Product does not gate new signups in that metro — a user who cannot reach a spot is better served by an honest empty map than by a closed door at signup. |
| EC-12 | An `active` spot has hours that validate but are semantically absurd (`open: "09:00", close: "09:00"`). | Passes the `CHECK` and produces an always-closed venue, which surfaces as `venue_closed` on every scheduling attempt. Detected by the §11 alert on `venue_closed` rate per spot. A zero-length window is a data-entry error, not a schema problem, and the fix is the alert rather than a cleverer constraint. |
| EC-13 | A user's device clock is wrong, so the client's open/closed pill disagrees with the server's `venue_open_during`. | The server is authoritative. `propose_schedule` raises `venue_closed` and the client shows the venue's hours from the response rather than from its own computation. The pill is decoration; the RPC is the rule. |
| EC-14 | A spot is the only one attached to 40 listings and is suspended. | All 40 are withdrawn (R28) and 40 owners are notified. This is a visible supply cliff and is exactly why R36 exists — a metro whose supply concentrates on one venue is one renovation away from having no product. |
| EC-15 | The `alert_stale_safe_spot_hours` cron job silently stops running after a migration. | Detected by the post-migration smoke check asserting every scheduled job exists ([Realtime & Notifications §8](../01-architecture/08-realtime-and-notifications.md)); additionally, the weekly coverage report includes a "stale hours" count that would climb monotonically. |
| EC-16 | An element is retagged upstream: `amenity=library` becomes `amenity=community_centre`. | For a **pending candidate**, the next run rewrites `suggested_category` and `raw_tags` in place — nothing has been promoted, so there is nothing to protect. For a **linked `active` spot**, it is an R54 review flag showing the tag diff; `category` is not auto-changed. A retag is frequently a correction to OSM's model of the building rather than a change to the building, and our `category` was chosen by a human who stood in the lobby. |
| EC-17 | A campus imports as a way whose centroid lands in the middle of a quad, 400 m from any door. | The candidate carries the centroid; R12 forbids promoting it unchanged and the console requires the reviewer to move the pin before the row can be activated. This is the failure EC-05 already describes, arriving now at higher volume — which is why `college_campus` is flagged in §6.4 rather than treated as a routine import. |
| EC-18 | The same venue exists in OSM as both a node and a building way, and both are tagged. | Two candidates, each unique on `(osm_type, osm_id)` so neither collapses the other. R43's 50 m + name-similarity check catches the second **only after the first is promoted**; before that, both sit in the queue. The console groups candidates within 50 m of each other so the reviewer sees the pair, and the loser is closed as `review_state = 'duplicate'`. We accept a small amount of reviewer time here rather than auto-merging two elements we cannot tell apart. |
| EC-19 | A candidate is under review when its element is deleted from OSM. | The refresh leaves `last_seen_at` behind and the console shows "no longer in OpenStreetMap" beside the candidate. The reviewer may still promote it — the building may exist perfectly well and the OSM edit may be wrong — but doing so requires the same R49 verification as any other promotion, which is precisely the action that would establish whether the venue is real. |
| EC-20 | Overpass is down, rate-limiting, or shedding load for the entire monthly window. | The run backs off, abandons, and alerts (R61, §11). **No degraded mode, no partial import, no fallback source.** A month with no refresh is a month with slightly staler flags; a half-completed diff would produce false "disappeared from OSM" flags for every element in the untried half, which is worse than no diff at all. Twice in a quarter is the [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) trigger to run our own instance (R63). |
| EC-21 | An element's coordinate is in the sea, at `(0,0)`, or outside the metro bounding box. | Rejected at import with `rejection_reason = 'implausible_geometry'` or `'out_of_bbox'`. This is the check that matters most in the whole import: a mis-parsed coordinate that survives review sends a real person to the wrong place, and the human gate is the control but is not infallible ([ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)). A coordinate outside the queried bbox is by definition a parsing bug, not a data finding, and it alerts rather than merely rejecting. |
| EC-22 | An element's `name` is non-ASCII, has diacritics, or exists only as `name:es`. | The candidate stores `name` verbatim as UTF-8 with no transliteration; a name present only under a language-suffixed key is treated as absent for R41 purposes and the element is rejected as `unnamed`, because a venue whose only recorded name is in a language the reviewer may not read is not reviewable from the queue. R43's trigram similarity runs on `unaccent(lower(name))`, so "Café Municipal" and "Cafe Municipal" dedupe against each other rather than producing two rows. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `safe_spot.created` | audit event | `actor_id`, `safe_spot_id`, `category`, `metro_slug` | — |
| `safe_spot.status_changed` | audit event | `actor_id`, `safe_spot_id`, `from`, `to`, `reason` | Any transition to `retired` with reason `safety_incident` pages Trust & Safety |
| `safe_spot.hours_verified` | audit event | `actor_id`, `safe_spot_id`, `previous_verified_at` | — |
| `safe_spot_hours_stale_count` | gauge, per metro | `metro_slug`, `count` | > 10% of a metro's `active` spots, or any spot > 150 days |
| `safe_spot_coverage_pct` | gauge, per metro | `metro_slug`, `pct_population_within_3km` | < 90% → P2 incident (R38) |
| `safe_spot_active_count` | gauge, per metro | `metro_slug` | < 40 in a launch metro → release gate failure |
| `venue_closed_rate` | counter | `safe_spot_id`, per day | > 20 `venue_closed` errors on one spot in 24 h ⇒ suspected bad hours |
| `no_show_by_safe_spot` | counter | `safe_spot_id`, 14-day window | ≥ 3 ⇒ investigate the pin, the signage, or the meeting-point description (EC-05) |
| `safe_spot_report_count` | counter | `safe_spot_id`, `reason` | ≥ 2 `unsafe_meeting` reports on one spot in 30 days ⇒ immediate `suspended` / `safety_concern` pending review |
| `spot_sheet_open` | product event | `safe_spot_id`, `category`, `listing_count`, `source` (`marker`\|`list`\|`deep_link`) | — |
| `spot_sheet_paint_ms` | histogram | `warm` boolean | p95 > 150 ms warm, > 600 ms cold |
| `listings_orphaned_by_suspension` | counter | `safe_spot_id`, `count` | > 20 in one action ⇒ notify Product; a supply cliff (EC-14) |
| `osm_candidate_queue_depth` | gauge, per metro | `metro_key`, `review_state` | `pending` > 150 for 14 days ⇒ the queue is not being worked and the pipeline is generating backlog rather than spots |
| `osm_candidate_approval_rate` | gauge, 30-day rolling per reviewer and per metro | `metro_key`, `reviewer_id`, `approved / reviewed` | **> 90% ⇒ suspected rubber-stamping** — audit a sample and tighten the gate. **< 30% ⇒ the import filter is too loose** and is spending reviewer time on candidates that were never eligible. Both thresholds are [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) revisit triggers, and the per-reviewer breakdown is the point: a healthy metro average can hide one reviewer approving everything |
| `osm_import_job_result` | event, per metro per run | `metro_key`, `outcome` (`success`\|`backoff_abandoned`\|`error`), `elements_seen`, `candidates_created`, `duration_s` | **Any month with no successful run for a live metro.** Two abandoned runs in a quarter ⇒ R63 |
| `osm_refresh_flags_raised` | counter | `metro_key`, `kind` (`element_deleted`\|`name_changed`\|`address_changed`\|`hours_changed`\|`moved`) | A single run raising flags on > 20% of a metro's linked spots ⇒ suspect an upstream schema or parsing change, not twenty buildings moving |
| `osm_import_rejected` | counter | `metro_key`, `rejection_reason` | `implausible_geometry` or `out_of_bbox` > 0 ⇒ **investigate as a parsing bug** (EC-21), not as upstream data quality |
| `osm_hours_verification_method` | counter | `method` (`phone`\|`visit`\|`official_website`) | `official_website` > 70% of verifications ⇒ the cheapest method is crowding out the reliable ones (R49) |

**`basemap_age_days` is deliberately not in this table.** Basemap freshness belongs to the tile pipeline ([ADR-0020](../01-architecture/adr/ADR-0020-pmtiles-self-hosting.md), [Observability](../05-operations/04-observability.md)), not to the safe-spot network. They share a data source and nothing else: a stale basemap means a new building is missing from the picture, while a stale safe spot means we are sending someone to a door we have not checked. Putting them on the same dashboard would invite treating one as a proxy for the other.

No event in this table carries a user identifier alongside a `safe_spot_id` except the audit events and the per-reviewer approval rate, which are moderator actions. `spot_sheet_open` is deliberately not joined to a user in analytics: "which user looked at which meeting place" is a movement-pattern dataset we have no use for.

## 12. Accessibility

- The safe-spot sheet is reachable and fully operable from `/map/list`, which is a first-class screen rather than a fallback ([Mobile Architecture §10.4](../01-architecture/02-mobile-architecture.md)). Every requirement below holds on both surfaces.
- Each spot renders as **one** accessible element in list contexts, with a composed label: `"Ann Arbor District Library, Downtown. Public library. 1.2 kilometres away. 7 items available. Open until 9 PM. Step-free entrance. Double tap to see what's available."`
- Accessibility information is a **first-class content block with its own heading** ("Getting in") at the 55% detent, not a footnote at the bottom of the 92% detent. A wheelchair user should not have to fully expand a sheet to learn whether they can enter the building.
- The open/closed pill carries a text label, never colour alone. Amber for "closing soon" is accompanied by the words.
- The stale-hours note uses `accessibilityLiveRegion="polite"` when it appears after a data refresh, and is announced as part of the hours block, not after the listing list.
- The spot photo has `accessibilityLabel` describing the meeting point (`"Photo: the library's Fifth Avenue entrance, a glass door under a green awning"`), authored by the curator and stored as `photo_alt_text`. A decorative-image treatment would be wrong here: the photo exists precisely so a user can recognise a place, which is information.
- Hours render as a table with day names spelled out for screen readers (`"Monday, 9 AM to 9 PM"`), never as an abbreviated grid that reads as `"mon 9 21"`.
- Sheet detent changes move accessibility focus to the newly revealed content's heading, and dismissing the sheet returns focus to the marker or row that opened it.
- Dynamic type to 200% on every field. The hours table reflows to stacked rows above 130%; nothing truncates.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01, R17 | `anon` and `authenticated` read only `status = 'active'` rows; `proposed`, `under_review`, `suspended`, `retired` return zero rows |
| T02 | unit | R02, R03 | Eligibility checklist encoded as a curator-console validator; residential and private-business inputs rejected |
| T03 | rls | R05 | Activation with `category = 'other_municipal'` and null `safety_notes` raises |
| T04 | rls | R06 | Activation trigger raises when any required column is null; parameterised over all 13 columns |
| T05 | integration | R07 | 14 malformed `hours` payloads rejected by the `CHECK`; 6 valid ones accepted, including two-window days and open-ended exceptions |
| T06 | integration | R08 | Activation without `photo_path` succeeds only when the audit event carries `no_photo_reason` |
| T07 | unit | R09 | `has_cameras IS NULL` renders "Camera coverage not confirmed"; `false` renders "No camera coverage" |
| T08 | manual | R10, R11 | Curator review checklist: `safety_notes` names at least one weakness; `accessibility_notes` covers all four ordered facts |
| T09 | manual | R12 | Spot-check: pin is within 30 m of the described meeting point for 20 sampled spots per metro |
| T10 | rls | R13 | Moderator INSERT/UPDATE succeeds; `authenticated` non-moderator INSERT/UPDATE fails |
| T11 | rls | R14 | No grant exists for `authenticated` on `public.safe_spots` for INSERT/UPDATE/DELETE; asserted from `information_schema.role_table_grants` |
| T12 | integration | R15 | Every INSERT/UPDATE produces an `audit.events` row with a column diff and the actor |
| T13 | integration | R16 | Activation by the row's creator (non-admin) raises; activation by a second moderator succeeds and sets `approved_by`/`approved_at` |
| T14 | integration | R18 | UPDATE of `parking_notes` leaves `hours_verified_at` untouched; the explicit verify action sets it |
| T15 | integration | R19 | Job emits one alert row per `active` spot older than 90 days; boundary at exactly 90 days is not alerted |
| T16 | e2e | R20 | Sheet, list row, and scheduling screen all render the stale-hours note for a spot at 91 days |
| T17 | integration | R21 | Job transitions a 181-day spot to `suspended` / `hours_unverified`; a 179-day spot is untouched |
| T18 | unit | R22, R23 | `app.venue_open_during` truth table: 24 cases across weekly windows, two-window days, exceptions, ranged exceptions, DST spring-forward and fall-back, and a venue timezone differing from the server's |
| T19 | integration | R25 | Ranged exception (`date` + `until`) closes every day in the range inclusive |
| T20 | integration | R26 | Suspending a spot leaves all referencing `exchange_sessions` rows byte-identical except nothing — asserted by a row hash before and after |
| T21 | integration | R27 | Suspension enqueues exactly one `safety_alert` per participant of each `scheduling`/`scheduled` session; `completed` and `cancelled` sessions produce none |
| T22 | integration | R28 | Suspension detaches `listing_safe_spots`; a listing with 2 other spots stays `active`; a listing with 0 remaining becomes `withdrawn` and its owner is notified |
| T23 | integration | R29 | `cancel_session` on a session at a suspended spot returns `counts_as_late = false` even 30 minutes before `scheduled_start` |
| T24 | integration | R31 | UPDATE from `retired` to `active` raises `invalid_transition` |
| T25 | integration | R32 | Activation with consent state `objected` raises |
| T26 | integration | R33 | `suspension_reason`/`retirement_reason` outside the closed vocabulary rejected by `CHECK` |
| T27 | integration | R34, R35 | Coverage report computes `active` count and population-within-3km against a fixture metro with known census centroids |
| T28 | integration | R37 | Weekly report contains all five required sections and the ten lowest-listing spots |
| T29 | e2e | R20, §8.2 | Offline: airplane mode, open a previously viewed spot, assert full details render with the "Showing saved details" chip |
| T30 | e2e | §8.2 | Terminal error: spot suspended server-side while the sheet is open → sheet closes, marker removed, toast shown, map invalidated |
| T31 | unit | §8.2 | Open/closed pill formatting across all seven copy variants including "Closed today" and "Closed · Opens Tue at 9:00 AM" |
| T32 | manual | §12 | VoiceOver and TalkBack pass over the sheet at all three detents, at 200% type, with focus return on dismiss |
| T49 | integration | R39, R62 | Import runs per metro bbox, one amenity tag per query; the scheduler is monthly; a second ad-hoc run for the same metro inside 24 h is refused by the function, not by convention |
| T50 | unit | R40 | Mapping table asserted row-by-row against §6.4 for all seven entries; twelve unmapped-tag fixtures (`leisure=park`, `amenity=cafe`, `shop=*`, …) are dropped with `unmapped_tag` and **none** becomes `other_municipal` |
| T51 | integration | R41 | An element with no `name` produces zero candidate rows; one with only `name:es` is likewise rejected as `unnamed` (EC-22) |
| T52 | integration | R42 | `access=private` and `access=no` elements are recorded with `review_state='rejected'`, `rejection_reason='access_restricted'`, and never appear in the pending queue |
| T53 | integration | R43 | A candidate 30 m from an existing spot with name similarity 0.8 is marked `duplicate`; one 300 m away, and one with similarity 0.3, both stay `pending`; re-importing the same `(osm_type, osm_id)` updates `last_seen_at` and creates no second row |
| T54 | rls | R44 | Import writes land with `review_state='pending'`; `anon` and `authenticated` receive permission-denied on `private.osm_spot_candidates` via PostgREST, direct SQL, and any view |
| T55 | integration | R45 | The import job, run end to end against a fixture metro, produces **zero** rows in `public.safe_spots` in any status. Promotion of a candidate is then asserted to raise on each of R06's null columns, on R16's same-approver case, and on an unmoved campus centroid |
| T56 | integration | R46 | A promoted row carries `source='osm_import'`, `osm_type`, `osm_id`, `osm_source_licence='ODbL-1.0'`, `osm_last_synced_at`; the candidate carries `promoted_safe_spot_id`, `reviewed_by`, `reviewed_at`; a forced failure mid-promotion leaves neither side written |
| T57 | unit | R47 | Console renders `suggested_hours_raw` labelled as unverified OSM data with `last_seen_at`. Contract sweep: the string appears in no client-reachable response shape — not in `GET /rest/v1/safe_spots`, not in `safe_spots_near`, not in any view |
| T58 | integration | R48 | **No automated path copies imported hours.** (a) Static analysis: no source file, migration, or function body references `suggested_hours_raw` together with `safe_spots.hours` or `hours_verified_at`. (b) Run the full import and monthly refresh over a fixture metro with hours-bearing elements: no `safe_spots.hours` value changes and no `hours_verified_at` is written. (c) The guard trigger raises when `hours_verified_at` is set in the same statement that sets `hours` from a promotion payload with no verification event |
| T59 | integration | R49 | Activation with no `safe_spot.hours_verified` audit event for the candidate raises; activation with one carrying a `verification_method` and source detail succeeds; an event with a `verification_method` outside the closed vocabulary is rejected |
| T60 | e2e | R50 | Console review screen: no control approves and activates in one action; the hours form renders empty with `suggested_hours_raw` beside it and no copy-across affordance; a UI test asserting the presence of an "accept suggested hours" button **fails**, and is kept as the regression guard against somebody adding one for velocity |
| T61 | integration | R51, R52 | Monthly refresh joins on `(osm_type, osm_id)`, updates `last_seen_at`/`osm_last_synced_at` for seen elements, and creates `pending` candidates for genuinely new POIs while re-applying R40–R43 |
| T62 | integration | R53 | An element removed from the fixture upstream raises an `osm_element_deleted` flag against its linked spot; the spot's `status` is byte-identical before and after |
| T63 | integration | R54 | Upstream `name`, `addr:street`, and `opening_hours` changes each raise a flag carrying the before/after diff; `public.safe_spots` `name`, address columns, `hours`, and `hours_verified_at` are all unchanged, and the 90-day staleness clock does not reset |
| T64 | integration | R55 | An element moved 80 m raises a flag; one moved 30 m does not; `point` is unchanged in both cases |
| T65 | integration | R56 | Row hash of every linked `safe_spots` row before and after a full refresh differs **only** in `osm_last_synced_at`, asserted column-wise rather than by eyeballing a diff |
| T66 | integration | R57 | `CHECK safe_spots_osm_provenance` rejects `source='osm_import'` with any of `osm_type`, `osm_id`, `osm_source_licence` null; accepts a `manual` row with all three null |
| T67 | e2e | R58 | "© OpenStreetMap contributors" is present on the sheet at all three detents, on list rows, in both spot pickers, and on the credits screen — including for a spot whose `source='manual'` |
| T68 | integration | R59 | CI gate: any diff touching a safe-spot export, feed, or public-API surface fails unless the change carries a recorded ODbL legal-review artifact. Asserted by adding such a surface to a fixture branch and confirming the gate fails |
| T69 | integration | R60, R61 | Overpass calls originate only from the scheduled Edge Function (egress allowlist asserted); the `User-Agent` matches the required pattern including a contact address; `/api/status` is called before a batch; a stubbed `429` produces exponential backoff and then abandonment, never a retry past the advertised slot |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T33 | `authenticated` user `POST /rest/v1/safe_spots` with a residential address | 403; no row created; policy `safe_spots_staff_write` denies |
| T34 | `authenticated` user `PATCH /rest/v1/safe_spots?id=eq.X` changing `point` | 403; row unchanged |
| T35 | `authenticated` user `PATCH` setting `status = 'active'` on a `proposed` row | 403 |
| T36 | `anon` reads a `suspended` spot by id | Empty result, **404** semantics — not 403. A 403 would confirm the row exists ([API Contract §3.4](../01-architecture/06-api-contract.md)) |
| T37 | `authenticated` user selects `hours_verified_at`, `approved_by`, `suspension_reason` on an `active` row | Permitted — these are P3. Asserted so that a future column addition does not silently become readable: the test enumerates the full readable column set and fails on any addition |
| T38 | `authenticated` or `anon` attempts any read on `private.safe_spot_consents` | Permission denied at the schema level; `has_schema_privilege('authenticated','private','USAGE')` is false |
| T39 | Moderator attempts `DELETE FROM public.safe_spots` | No `DELETE` grant exists for any role including `moderator`; retirement is the only removal path |
| T40 | JWT with forged `app_metadata.role = 'moderator'` (unsigned / wrong key) | Rejected at the gateway; `app.is_moderator()` never evaluates |
| T41 | JWT with `user_metadata.role = 'moderator'` (user-writable claim) | `app.is_moderator()` returns false — it reads `app_metadata` only ([API Contract §2.1](../01-architecture/06-api-contract.md)) |
| T42 | `app.venue_open_during` called with a `safe_spot_id` that is `suspended` | Returns `false`, does not raise, does not leak the row's existence |
| T43 | `hours` payload containing a `lat`/`lng` key | Rejected by the JSON schema `CHECK`; the coordinate-key rule applies even to a P3 table so that the rule has no exceptions to remember |
| T44 | Audit event written for a `point` change | `audit.events.metadata` contains `{"point":"changed"}` and no numeric coordinate; the coordinate-key `CHECK` (LP-11) would have rejected the alternative |
| T45 | Bulk enumeration: 500 sequential `GET /rest/v1/safe_spots?id=eq.<random uuid>` | Kong 60/min/IP limit engages; `Retry-After` present; no timing difference between "exists but suspended" and "never existed" |
| T46 | Suspension fanout triggered for a spot with 5,000 scheduled sessions | Completes inside the statement timeout, or the trigger enqueues a batched job; asserted so that a large suspension cannot lock the table during a business-hours edit |
| T47 | A moderator suspends a spot, and a concurrent `propose_schedule` targets it | Whichever commits first wins; the losing `propose_schedule` gets `venue_closed` (the spot is no longer `active`), never a partially applied schedule |
| T48 | `retired` spot's `photo_path` requested from Storage by a direct signed-URL guess | Storage policy denies: safe-spot photos are served through a path bound to `status = 'active'` |
| T70 | Attempt every plausible route by which an imported hours string could reach `safe_spots.hours`: a `INSERT … SELECT` from the candidate table, a console payload echoing the hint verbatim, a migration backfill, a refresh-job write | All fail or are absent. Additionally, a promotion whose submitted `hours` is byte-identical to `suggested_hours_raw` is **flagged for audit rather than blocked** — genuinely correct OSM hours do exist, and blocking that case would train reviewers to retype a character and change it back. The flag feeds the approval-rate audit in §11, which is the honest control here: this test bounds the damage, R50 prevents it, and neither is airtight on its own (R48) |
| T71 | Query `safe_spots_near` over a viewport dense with pending candidates | Zero candidate-derived rows. `safe_spots_near` reads `public.safe_spots` with `status='active'` only and has no join to `private`. `GET /rest/v1/osm_spot_candidates` 404s at the API layer before reaching Postgres, exactly as `private.garden_locations` does (R44) |
| T72 | Feed the importer a fixture Overpass response containing an unnamed element, an `access=private` element, a `shop=supermarket`, and an element at `(0,0)` | Zero candidates enter the pending queue; four rejection rows are recorded with reasons `unnamed`, `access_restricted`, `unmapped_tag`, `implausible_geometry`; the last alerts (EC-21) |
| T73 | An attacker tags their own home address `amenity=community_centre` in OSM and waits for the monthly import | The candidate queues — we cannot prevent that, and the honest answer is that we do not try. It cannot reach `active`: R45 applies R02's eligibility criteria, R16 requires a second approver, and R49 requires a recorded hours verification against a venue that cannot be phoned. Asserted end to end, including that a single reviewer acting alone cannot activate it in any sequence of console actions |
| T74 | A reviewer approves 40 candidates in 20 minutes | Permitted mechanically — we do not rate-limit judgement — but each still requires its own R49 event, and the per-reviewer `osm_candidate_approval_rate` crosses the 90% alert. Asserted so that the rubber-stamping control is the audit trail and the alert, not an artificial delay somebody would route around |
| T75 | Trigger an Overpass query from the moderation console, from a client, or from CI | No egress path exists: the Overpass host is absent from every allowlist except the scheduled function's (R60). Asserted from the deployed network policy rather than from source, so a new function inherits the denial by default |

### 13.3 Manual QA

- [ ] Curate one real spot end-to-end in staging: propose → under review → second-approver activation → appears on the map within 60 s.
- [ ] Phone one real launch-metro library and confirm hours against what the console holds. Any mismatch is a finding about the process, not about that library.
- [ ] Walk to a curated spot with the app and confirm the pin lands at the meeting point, the photo is recognisable, and the parking note is true.
- [ ] Verify the stale-hours note appears on a spot artificially aged to 91 days, on both platforms, in both the sheet and the list view.
- [ ] Suspend a staging spot with two scheduled sessions and confirm four `safety_alert` notifications arrive on real devices, including one with quiet hours enabled (they must arrive anyway).
- [ ] Confirm a listing attached only to the suspended spot is withdrawn and its owner is notified.
- [ ] Confirm a retired spot cannot be reactivated from the console UI, and that the console explains why rather than showing a disabled button with no reason.
- [ ] Screen-reader pass on the sheet at all three detents on iOS and Android, at 200% type.
- [ ] Confirm hours render in the venue's timezone with the abbreviation shown when the device timezone differs.
- [ ] Run the importer against one real launch metro and read the whole pending queue by hand. The question is not "did it work" but **"would a reviewer working through this at speed make a mistake?"** — count how many candidates are obviously ineligible, and compare the list against what a person with a browser and an afternoon produces for the same metro.
- [ ] Promote one candidate end to end, including a real phone call to the venue, and confirm the hours you were told differ from `suggested_hours_raw`. If they match for the first ten spots, say so — it is evidence about R48's premise and it belongs in the record either way.
- [ ] Attempt to activate a candidate without recording an hours verification, and confirm the console explains why rather than showing a disabled button with no reason.
- [ ] Delete a fixture element from a staging Overpass mirror and confirm the next refresh flags the linked spot for re-verification without changing its status.
- [ ] Confirm "© OpenStreetMap contributors" is visible on the sheet, the list row, and both spot pickers on both platforms, at 200% type.
- [ ] Reviewer training: confirm every curator can state, unprompted, why `suggested_hours_raw` may not be copied. [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) names this as a training requirement, and a control nobody understands is a control that gets routed around.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | None. The safe-spot network is not optional; there is no product without it. The curation console is behind `console.safe_spots` for staff only. |
| Migration required | Yes — `20260808_0071_safe_spot_curation.sql` (columns, `private.safe_spot_consents`, `app.venue_open_during`, two triggers, two cron jobs) and `20260809_0072_osm_spot_sourcing.sql` (provenance columns and constraint, `private.osm_spot_candidates`, the hours-verification guard trigger, the monthly import schedule) |
| Backfill required | Yes — `metro_slug` on all seeded spots, and a `private.safe_spot_consents` row per seeded spot with state `not_contacted` at minimum. Existing hand-curated rows get `source = 'manual'` by column default and **no OSM provenance**; they are not retro-matched to OSM elements, because a match we inferred rather than imported is provenance we cannot stand behind (R57). |
| Sourcing rollout | The importer is Ops tooling, not a product surface, and ships behind `console.osm_candidates`. It runs against one launch metro first and its output is reviewed by hand in full (§13.3) before the second metro's import runs at all. **Manual curation continues in parallel** for the first metro rather than being stood down on the pipeline's promise — [R-02](../06-roadmap/02-open-risks.md) is a release-gate risk, and discovering in week ten that the queue is unusable would cost the launch. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). The triggers are the risky part: if `trg_safe_spot_status_fanout` misbehaves, disable it with a follow-up migration and run the fanout as a one-off script. Suspensions remain correct; only the notification and detach side effects would be deferred. |
| Client version floor | None. Older clients that do not render the stale-hours note still receive correct hours; the note is additive. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Should a spot's `listing_count` be visible to `anon`? It is the only externally-facing supply signal we have, useful for a marketing map and useful to a competitor ([API Contract §10 Q4](../01-architecture/06-api-contract.md)). | Product + Security | Phase 2 |
| Q2 | Is 90 days the right staleness alert for a municipal venue? Libraries change hours seasonally (summer hours, holiday weeks) more often than quarterly, which suggests 60. Tighter costs ops time we may not have. | Ops + Product | Post-launch, first season |
| Q3 | Should auto-suspension at 180 days (R21) instead auto-*flag* and require a human to suspend? Auto-suspension can remove supply in a metro over a weekend with no one watching. | Ops | Before second metro launch |
| Q4 | Do we need a `meeting_point_description` free-text column distinct from `safety_notes` ("meet at the reference desk on the second floor")? EC-05 suggests the pin alone is not enough on campuses. | Product | Post-launch, first 100 no-shows |
| Q5 | What is our position if a police-station lobby is a category we list and a segment of users will not enter one? Naming this openly may require a category-level filter default rather than a curation change. | Product + Trust & Safety | Before launch |
| Q6 | Do we contribute confirmed hours back to OSM? We will hold phone-verified hours for hundreds of civic buildings — better data than the source we took it from. [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) calls it a good-citizen item and explicitly out of MVP scope. It also has a downside worth naming: publishing which venues we verified discloses our operating footprint. | Product + Legal | Phase 2 |
| Q7 | Does R50's empty-form rule survive contact with a reviewer processing eighty candidates? It is the answer to [ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)'s strongest self-criticism, and it is also the requirement most likely to be quietly relaxed for velocity. If it is going to be relaxed, that should be an ADR and not a console ticket. | Ops + Trust & Safety | After the first metro's queue is worked |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-09 | 1.1.0 | Product + Ops | **OSM candidate sourcing** ([ADR-0021](../01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md)). Requirements added, none invalidated: no existing rule is relaxed and every promotion still passes the full §5.1–§5.4 gate. New §5.7 (R39–R63) covers Overpass import per metro per amenity tag, the §6.4 tag mapping, rejection of unnamed and access-restricted elements, dedupe, the never-discoverable candidate table, the human promotion gate, the monthly refresh diff (nothing auto-applies), ODbL provenance and attribution, share-alike as a pre-implementation legal trigger for any future export, and Overpass etiquette. The load-bearing rule is R47/R48: imported `opening_hours` is a reviewer hint that **no automated path may promote** to `safe_spots.hours` — stale hours are the top no-show cause. R49/R50 are the anti-rubber-stamping controls ADR-0021's own steel-man demands. §6 adds the provenance columns, `private.osm_spot_candidates`, and migration `20260809_0072`; §10 adds EC-16–EC-22; §11 adds queue depth, approval-rate alerts at > 90% / < 30%, and job success; §13 adds T49–T75. §3 clarifies that automated *hours* ingestion is rejected permanently, not just for MVP. Q6 and Q7 raised. |
| 2026-08-08 | 1.0.0 | Product + Ops | Initial spec |
| 2026-10-22 | 1.1.1 | Product + Ops | H3 removed; renamed to location tiers per [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md). Related ADR link updated. |
