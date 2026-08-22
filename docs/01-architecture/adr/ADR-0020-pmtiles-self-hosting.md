# ADR-0020: Self-hosted PMTiles on object storage

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-09 |
| **Deciders** | Architecture, Platform Engineering |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

[ADR-0019](ADR-0019-openstreetmap-maplibre.md) commits to rendering OpenStreetMap vector tiles with MapLibre. MapLibre does not supply tiles — it renders whatever source a style points at. So the tile source is now a decision we have to make and own.

Three constraints narrow it immediately.

**OSM's own tile servers are not an option.** The [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) exists to protect donated infrastructure, and it explicitly rules out what we would need: heavy or app-scale use, and any form of prefetching or offline download. Apps that ignored it have been blocked by User-Agent, breaking their installed base. Using `tile.openstreetmap.org` in a shipping app is not a shortcut with a risk attached; it is a violation with an outage attached.

**Tile requests reveal viewports.** Whoever serves our tiles learns, for every user, which map area they are looking at, at what zoom, when. [ADR-0019](ADR-0019-openstreetmap-maplibre.md) is honest that this is a secondary rather than primary privacy concern — but having spent an entire architecture ensuring that no third party learns where users are ([Location Privacy](../04-location-privacy.md)), voluntarily introducing a new one that receives a continuous stream of viewport coordinates would be a conspicuous inconsistency, and it would need a threat-model entry and a sub-processor disclosure.

**Offline is on the roadmap.** [Roadmap Phase 2](../../06-roadmap/01-roadmap.md) wants offline map packs per launch metro. That requires a tile source whose terms permit bulk download and local storage — which most managed providers restrict or price separately.

What changed since [ADR-0013](ADR-0013-map-library.md) dismissed self-hosting as "an infrastructure project we have no capacity for" is the **PMTiles** format: a single-file tile archive readable over HTTP range requests. No tile server, no database, no container to operate. A file on object storage behind a CDN.

## Decision

**Serve OSM vector tiles from a Protomaps-built PMTiles archive stored in Cloudflare R2, fronted by Cloudflare CDN.**

### The pipeline

```
OSM planet / regional extract  (Geofabrik)
        │
        ▼
  Protomaps basemap build          ← scheduled, monthly
        │
        ▼
  sharecropr-basemap-YYYYMM.pmtiles
        │
        ▼
  Cloudflare R2  (versioned object)
        │
        ▼
  Cloudflare CDN  →  MapLibre client (HTTP range requests)
```

| Property | Value |
| --- | --- |
| Source data | OSM via Geofabrik regional extracts; planet only if we outgrow regions |
| Build tool | Protomaps basemap tooling |
| Refresh cadence | **Monthly**, plus on demand when a launch market needs it |
| Storage | Cloudflare R2, versioned by build date |
| Serving | Cloudflare CDN, HTTP range requests, no origin server |
| Client access | Style JSON points at the current archive URL |
| Rollback | Repoint the style at the previous archive — instant, no client release |
| Estimated cost | **< $10/month at MVP scale.** R2 has no egress fee, which is the whole reason this is cheap |

### Coverage strategy

MVP ships **regional extracts covering the launch metros plus a generous surrounding buffer**, not the planet. A user who pans to another continent sees empty tiles, which is acceptable when the product only functions in two metros and every safe spot is in one of them.

Adding a market means adding its extract to the build. Going national means switching to a planet build, which raises storage cost but not the architecture.

### Versioning and staleness

Archives are immutable and date-stamped. The style references one explicitly. This gives three properties worth having:

- A bad build is reverted by repointing the style, with no app release and no cache-invalidation dance.
- Clients on an old style keep working until they refresh — no thundering herd on a new build.
- **Basemap staleness is measurable.** `basemap_age_days` is a monitored metric with an alert at 45 days, because "we own the basemap" ([ADR-0019](ADR-0019-openstreetmap-maplibre.md) negative consequence) is only safe if someone notices when it rots.

### Attribution

The style carries OSM attribution, and `MapCanvas` renders it unconditionally. This is an ODbL obligation, not a UI preference. See [ADR-0021 §Licence obligations](ADR-0021-osm-safe-spot-sourcing.md#licence-obligations).

## Alternatives considered

### MapTiler or Stadia Maps (managed OSM tiles)

**What it is.** Hosted OSM vector tiles with an API key, good styling tools, generous free tiers, and real support.

**Why we didn't.** It is a genuinely reasonable choice and the closest call in this ADR. Three things decided it: a new sub-processor receiving every user's viewport, requiring a threat-model entry, a DPA, and a privacy-policy disclosure; per-request pricing that scales with map interaction rather than with value delivered; and offline packs that are restricted or separately priced on most tiers. Against a self-hosted option costing under $10/month with none of those, the managed convenience did not justify it.

**It remains the documented fallback.** If serving PMTiles proves operationally annoying, switching is a style-URL change plus a key in EAS secrets — roughly a day.

### `tile.openstreetmap.org`

**What it is.** OSM's community tile servers.

**Why we didn't.** Prohibited by the usage policy for exactly our use case, and enforced by blocking. Not a viable option, listed so nobody proposes it later.

### Self-hosted tileserver-gl on a VM

**What it is.** A real tile server rendering from a `.mbtiles` database.

**Why we didn't.** All of PMTiles' benefits plus a server to patch, monitor, scale, and pay for. PMTiles exists specifically to make this unnecessary. Choosing it would be choosing the 2019 version of this decision.

### Bundle tiles in the app binary

**What it is.** Ship the launch-metro tiles inside the app.

**Why we didn't.** Tens of megabytes of install size against [NFR-08](../../00-foundation/05-nfr.md), and a basemap update would require a store release. Revisit only as part of the Phase 2 offline work, and even then as a download rather than a bundle.

## Consequences

### Positive

- **No third party sees user viewports.** The tile server is ours.
- **Cost is bytes, not map loads** — predictable, and single-digit dollars at MVP scale. R2's zero egress fee is the load-bearing detail.
- **No API key, no rate limit, no vendor account** in the map path.
- **Offline packs become a straightforward extension** — the archive is already a file.
- **Instant basemap rollback** by repointing a URL.
- **Full cartographic control.** The style is ours to make safe spots visually dominant.
- **No server to patch.** The "self-hosting" is an object in a bucket.

### Negative

- **A build pipeline we own.** Monthly extract, build, upload, verify, repoint. Automated, but ours when it breaks.
- **Basemap staleness is now a failure mode.** A new library that opened last month is missing until the next build. Mitigated by monitoring, not eliminated.
- **Cold-start CDN latency** on tiles nobody has requested recently in a region.
- **Storage grows with coverage.** A planet build is meaningfully larger than two metros; a national expansion is a cost conversation.
- **No vendor to call** when tiles look wrong. The failure is ours to diagnose.

### Neutral / accepted costs

- Cloudflare joins the sub-processor register — but as a CDN and object store we already need, not as a map vendor with a view of user behaviour.
- The style JSON becomes a reviewed, versioned artifact.
- Build reproducibility matters: the same extract and tooling version must produce the same archive, or debugging a cartography regression is guesswork.

## The strongest argument against this decision

We have just decided to operate a piece of geospatial infrastructure, on a team that has not yet shipped an MVP, to save roughly forty dollars a month and to close a privacy gap that [ADR-0019](ADR-0019-openstreetmap-maplibre.md) itself concedes is secondary. "It's just a file in a bucket" is the version of this that is true on day one and steadily less true afterwards: someone has to own the monthly build, notice when it silently fails, keep the tooling version pinned, diagnose why one metro's tiles regressed after an upstream schema change, and handle the day a Geofabrik extract format changes. That is a small, permanent, unglamorous operational tax on a team whose own risk register says its binding constraints are liquidity ([R-01](../../06-roadmap/02-open-risks.md)) and safe-spot curation headcount ([R-02](../../06-roadmap/02-open-risks.md)) — neither of which this helps. MapTiler's free tier would very likely cover our entire MVP at zero cost and zero operational surface, with a real company on the hook when tiles break, and we could revisit self-hosting when we had enough usage for it to matter.

The honest counterweight is that the fallback is cheap and the direction of travel favours ownership: switching to a managed provider later is a style-URL change and a day of work, while switching *away* from one after building offline packs, custom cartography, and a bundled-tile flow on its terms is considerably more. We are choosing the reversible option in the direction we intend to travel. But if the monthly build becomes a recurring source of toil in the first two months, that is the signal to take MapTiler's free tier and stop paying the tax — not a reason to build more automation around it.

## Revisit when

- Monthly serving cost exceeds **$50** — investigate before it becomes normal.
- The tile build fails or is skipped **twice in a quarter** — the operational tax is real; take the managed fallback.
- `basemap_age_days` exceeds **45** more than once — same signal.
- Tile p95 latency exceeds **300 ms** at the CDN edge in a launch market.
- We expand beyond **five metros**, at which point planet-versus-regional and storage cost need a fresh look.
- Offline packs ship and materially change the storage or bandwidth profile.

## Related

- [ADR-0019 OpenStreetMap via MapLibre](ADR-0019-openstreetmap-maplibre.md), [ADR-0021 OSM safe-spot sourcing](ADR-0021-osm-safe-spot-sourcing.md)
- [SPEC-008 Interactive map](../../03-specs/SPEC-008-interactive-map.md)
- [Environments](../../05-operations/01-environments.md), [CI/CD](../../05-operations/02-cicd.md), [Observability](../../05-operations/04-observability.md)
- [Privacy & Data Retention §7 Sub-processors](../../02-security/04-privacy-and-data-retention.md#7-sub-processors)
