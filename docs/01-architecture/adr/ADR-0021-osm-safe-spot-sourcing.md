# ADR-0021: OSM as the safe-spot candidate source

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-09 |
| **Deciders** | Architecture, Operations, Trust & Safety, Legal |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

[R-02](../../06-roadmap/02-open-risks.md#r-02--safe-spot-curation-is-an-unbounded-operational-cost) says safe-spot curation is an unbounded manual operational cost and **may be the actual constraint on growth, not engineering**. [SPEC-007](../../03-specs/SPEC-007-safe-spots.md) requires ≥ 40 verified safe spots per launch metro as a [release gate](../../00-foundation/02-prd.md#7-release-gates), and the [roadmap](../../06-roadmap/01-roadmap.md) allots twelve weeks of manual curation starting on day one — the longest lead-time item in the whole plan.

The manual work has two distinct halves that were never separated:

1. **Discovery** — finding every library, town hall, police station, community centre, fire station, and college campus in a metro, with names, addresses, and coordinates.
2. **Verification** — confirming opening hours, checking the physical space is actually suitable for a handoff, assessing lighting and staffing, and where appropriate obtaining venue consent.

The first half is a data problem someone has already solved. OpenStreetMap tags exactly these features — `amenity=library`, `amenity=police`, `amenity=townhall`, `amenity=community_centre`, `amenity=fire_station`, `amenity=college`, `amenity=marketplace` — and in dense US metros the coverage of civic buildings is excellent. [ADR-0019](ADR-0019-openstreetmap-maplibre.md) makes OSM our map substrate, which means this data is already in our world.

The second half is irreducibly human. A library that exists in OSM tells us nothing about whether its entrance is well lit, whether staff object, or whether its posted hours are current.

## Decision

**Use the Overpass API to bulk-import OSM civic POIs as safe-spot *candidates* into `private.osm_spot_candidates` with `review_state = 'pending'`. A human must verify every candidate before it is promoted into `public.safe_spots` and becomes discoverable. OSM supplies discovery; humans supply verification.**

> Candidates live in the `private` schema, not as `proposed`-status rows in `public.safe_spots`. That makes "an unreviewed candidate is not discoverable" a property of where the data sits rather than of remembering a status filter in every query — the same reasoning as [Location Privacy §2](../04-location-privacy.md).

### The pipeline

```
Overpass query (per metro bounding box, per amenity tag)
        │
        ▼
private.osm_spot_candidates          ← raw import, never client-visible
        │
        ├── dedupe against existing safe_spots (50 m proximity + name similarity)
        ├── reject: no name, no address, private/restricted access tags
        ▼
Moderation console review queue      ← SPEC-900
        │
        ├── human confirms hours (phone / website / visit)
        ├── human assesses suitability, lighting, parking, accessibility
        ├── venue consent where policy requires it
        ▼
public.safe_spots  status = 'active' ← discoverable
```

### What we import and what we ignore

| OSM tag | Imported as | Notes |
| --- | --- | --- |
| `amenity=library` | `public_library` | Highest-quality category; excellent OSM coverage |
| `amenity=police` | `police_station` | Import, but flag — lobby access varies enormously |
| `amenity=townhall` | `city_hall` | |
| `amenity=community_centre` | `community_center` | |
| `amenity=fire_station` | `fire_station` | Flag — many are unstaffed |
| `amenity=college` / `university` | `college_campus` | Campus polygons need a specific entrance chosen by a human |
| `amenity=marketplace` | `farmers_market` | Frequently seasonal; hours unreliable |
| `name` | `name` | **Required.** No name → rejected, not queued |
| `addr:*` | address fields | Best-effort; a human corrects |
| Node/way centroid | `point` | Ways and relations reduced to a representative point |
| **`opening_hours`** | **imported as a hint only, never as the live value** | See below |
| `wheelchair` | accessibility hint | Human confirms |
| `access=private`, `access=no` | **auto-rejected** | |

### `opening_hours` is a hint, never a source of truth

This was the sharpest question in the decision and it resolves against convenience. [SPEC-007](../../03-specs/SPEC-007-safe-spots.md) requires `hours_verified_at` and alerts at 90 days precisely because **stale hours are the single largest generator of no-shows**, and a no-show is a wasted trip for a real person who drove somewhere. OSM `opening_hours` coverage on civic buildings is patchy and frequently years out of date.

So: the value is imported into the candidate record and shown to the reviewer as a starting point, but `safe_spots.hours` is only written by a human who has confirmed it, and `hours_verified_at` is only set by that human action. **An imported hours string can never reach a user.**

### Refresh, not just import

A monthly job re-queries Overpass for each active metro and diffs against current safe spots:

| Diff | Action |
| --- | --- |
| New POI appears | New candidate in the review queue |
| POI deleted from OSM | Flag the spot for re-verification — the building may have closed |
| Name or address changed | Flag for review; do not auto-apply |
| `opening_hours` changed | Flag for review; **never auto-apply** |
| POI moved > 50 m | Flag for review |

Nothing auto-applies to a live safe spot. OSM is an input to a human queue, in both directions.

### Licence obligations

OSM data is licensed **ODbL 1.0**, which is a share-alike licence, and importing POI data into our database has consequences that importing tiles does not.

| Obligation | How we meet it |
| --- | --- |
| Attribution | "© OpenStreetMap contributors" rendered on the map ([ADR-0019](ADR-0019-openstreetmap-maplibre.md)) **and** on any screen displaying OSM-derived safe-spot data, plus a credits screen |
| Provenance tracking | `safe_spots.osm_id`, `osm_type`, `osm_source_licence`, `osm_last_synced_at` — we always know which records are OSM-derived ([Data Model §9](../03-data-model.md#9-safe-spots)) |
| Share-alike on Derivative Databases | If we ever publish a database derived from OSM data, it must be under ODbL. **We do not publish our safe-spot database**, so this does not currently bite — but any future "export safe spots" or public API feature triggers a legal review first |
| Produced Works | The rendered map and the in-app spot list are Produced Works, which require attribution but not share-alike |
| Contributing back | We **may** contribute corrections (e.g. confirmed hours) upstream. Not MVP scope; noted as a good-citizen item |

> **The share-alike clause is a real constraint with a future trigger, not a formality.** A safe-spot export, a public API, or a partner data feed would each need counsel's view before it ships. It is recorded here so that whoever proposes one finds this note rather than discovering ODbL afterwards.

### Overpass usage

Overpass is donated community infrastructure with per-IP rate limiting and load shedding. We treat it accordingly:

- Queries run **server-side from an Edge Function on a schedule**, never from a client.
- Metro-scale bounding boxes, one amenity tag at a time, with a descriptive `User-Agent` identifying Sharecropr and a contact address.
- Backoff on `429`; check `/api/status` before a batch.
- **Monthly cadence, not continuous.** Civic buildings do not move.
- If our volume ever becomes non-trivial, we run our own Overpass instance from a Geofabrik extract rather than leaning harder on the public one.

## Alternatives considered

### Fully manual curation (the status quo)

**Why we didn't.** It is twelve weeks of lead time per launch and it does not amortise — every new metro pays it again. [R-02](../../06-roadmap/02-open-risks.md) already identifies this as a plausible binding constraint on growth. Keeping it manual when a good open dataset exists is choosing a bottleneck.

### Google Places API

**What it is.** Commercial POI data with generally better hours coverage.

**Why we didn't.** Per-request cost, terms that restrict storing and redistributing results, a new vendor in a path we have just deliberately opened, and hours data still not reliable enough to skip human verification — which is where the actual cost is. If hours must be human-confirmed either way, the marginal value over OSM is small.

### Import OSM and trust the data (no human gate)

**What it is.** Auto-publish imported spots.

**Why we didn't.** A safe spot is a place we tell a stranger to meet another stranger. A wrong one is a safety problem, not a data-quality problem. OSM cannot tell us whether a police-station lobby is publicly accessible after 6 p.m., and no import volume is worth removing the human from that judgement.

### Crowdsource from users at MVP

**Why we didn't.** [Phase 2](../../06-roadmap/01-roadmap.md), deliberately. User-proposed spots need a review queue that does not exist yet and an abuse model — a malicious user proposing a bad "safe" spot is a direct attack on the product's central safety claim.

## Consequences

### Positive

- **Discovery becomes a review queue instead of a blank page.** The expensive, unbounded half of [R-02](../../06-roadmap/02-open-risks.md) is largely removed; the human half remains and is bounded and predictable.
- **New-market lead time drops substantially.** Candidate generation for a metro is minutes of compute rather than weeks of searching.
- **Coverage is more complete than manual research.** OSM knows about the branch library nobody on the team had heard of.
- **Ongoing change detection** — a closed building shows up as a diff rather than as a no-show report.
- Consistent with [ADR-0019](ADR-0019-openstreetmap-maplibre.md): the same substrate renders the map and populates it.

### Negative

- **A new moderation surface.** The candidate queue needs console UI ([SPEC-900](../../03-specs/SPEC-900-moderation-console.md)) and reviewer time. The work moves; it does not vanish.
- **OSM data quality varies geographically.** Excellent in our launch metros; a sparse future market gets less benefit and the team may over-rely on the pipeline there.
- **ODbL share-alike is a permanent constraint** on future data-publishing features.
- **A dependency on donated infrastructure.** Overpass has no SLA and owes us nothing.
- **Import bugs are safety-adjacent.** A mis-parsed coordinate that survives review sends someone to the wrong place. The human gate is the control; it is not infallible.

### Neutral / accepted costs

- Provenance columns and a `private.osm_spot_candidates` table are new schema.
- Reviewers need training on what OSM tags mean and, more importantly, on **not trusting `opening_hours`**.
- Monthly refresh is a scheduled job to monitor.

## The strongest argument against this decision

This optimises the cheap half of the problem and calls it a solution to the expensive one. Finding libraries in a metro was never the hard part — a person with a browser and an afternoon can list every library, town hall, and community centre in Ann Arbor, and would produce a better list than an Overpass query because they would notice which ones are actually suitable. The genuinely expensive work is phoning each venue to confirm hours, visiting to assess whether the entrance is lit and staffed, and negotiating consent — none of which OSM touches, and all of which still gates the release. So we have added a data pipeline, a candidate table, a moderation queue, a monthly job, and a permanent ODbL obligation, in exchange for automating the part a temp could do in a week. Worse, the queue creates a subtle failure mode: a reviewer working through eighty auto-generated candidates is in a fundamentally different cognitive mode from someone researching a neighbourhood, and rubber-stamping is what queues produce. The manual process forced a kind of attention that a review queue actively erodes — and this is a safety-critical judgement.

The counter is narrower than the claim in the Positive section above, and this ADR should not overstate it: **the value is in the refresh loop, not the initial import.** A one-time list is genuinely cheap to produce by hand. Detecting, every month and across every market, that a building closed or moved or was retagged is not something anyone will do manually once the novelty wears off, and it is precisely the failure that shows up later as a no-show report from a user standing outside a shut building. The initial import is a convenience; the diff is the durable win. The rubber-stamping risk is real and is answered in [SPEC-007](../../03-specs/SPEC-007-safe-spots.md) by requiring an explicit, separately-recorded hours-verification action rather than a single approve button — a reviewer cannot approve a spot without having done something that only a phone call or a visit makes possible.

## Revisit when

- OSM coverage in a target market yields **fewer than 20 usable candidates** per metro — that market needs manual sourcing and possibly a different launch decision.
- Candidate approval rate exceeds **90%** — reviewers are rubber-stamping; tighten the gate or audit a sample.
- Candidate approval rate falls below **30%** — the import filter is too loose and is wasting reviewer time.
- Any no-show is traced to imported data that a reviewer approved without verification — treat as an incident, not a bug.
- We propose exporting or publishing safe-spot data in any form — **legal review before implementation**, because of ODbL share-alike.
- Overpass rate limiting affects the monthly job twice — stand up our own instance.

## Related

- [ADR-0019 OpenStreetMap via MapLibre](ADR-0019-openstreetmap-maplibre.md), [ADR-0020 PMTiles self-hosting](ADR-0020-pmtiles-self-hosting.md)
- [SPEC-007 Safe spots](../../03-specs/SPEC-007-safe-spots.md), [SPEC-900 Moderation console](../../03-specs/SPEC-900-moderation-console.md)
- [Data Model §9](../03-data-model.md#9-safe-spots), [R-02](../../06-roadmap/02-open-risks.md#r-02--safe-spot-curation-is-an-unbounded-operational-cost)
