# Sharecropr

Home gardeners inventory surplus crops and barter with nearby gardeners — meeting only at pre-approved public safe spots.

**Current phase:** EPIC-01 map spike (go/no-go pending device profiling), EPIC-02 data model + RLS harness, and EPIC-03 authentication are in-repo. The app boots through sign-in into the map spike screen (MapLibre + self-hosted OSM PMTiles, ADR-0019/0020). Live status: [AGENTS.md §5](AGENTS.md#5-current-state).

## Prerequisites

- Node.js 20+
- iOS Simulator (Xcode) and/or Android emulator or device
- **Expo dev client** — MapLibre does not run in Expo Go

## Commands

npm only. The full table, including database and CI gates, is in [AGENTS.md § Commands](AGENTS.md#commands).

```bash
npm run lint && npm run typecheck && npm run test:auth-domain
npm run db:start && npm run db:reset && npm run db:test   # needs Docker + Supabase CLI
```

## Quick start

```bash
npm install
npx expo prebuild                            # generates ios/ and android/ with New Architecture
npx expo run:ios                             # or: npx expo run:android
```

Optional tile CDN overrides (defaults point at staging):

```bash
export TILE_ORIGIN=https://tiles.staging.sharecropr.com
export BASEMAP_ARCHIVE=sharecropr-basemap-202608.pmtiles
```

On a physical device (required for SCR-0103 profiling):

```bash
npx expo run:ios --device
npx expo run:android --device
```

## EPIC-01 spike checklist

| Story | What to verify |
| --- | --- |
| SCR-0101 | 200 markers via GeoJSON layers; clusters via `supercluster` (MapLibre clustering off) |
| SCR-0102 | Avatar follows location; pan breaks follow; Recentre restores follow + 200ms camera animation |
| SCR-0103 | Record FPS while panning, zooming, expanding clusters on reference Android hardware |
| SCR-0104 | File results in [docs/07-review/03-map-spike-go-no-go.md](docs/07-review/03-map-spike-go-no-go.md) |
| SCR-0105 | MapLibre renderer behind `MapCanvas` seam; no `@maplibre/*` imports outside that file |
| SCR-0106 | Versioned PMTiles style (`sharecropr-basemap.json`); `scripts/tile-build.sh` scaffold |
| SCR-0107 | `© OpenStreetMap contributors` attribution always visible (NFR-99) |

**Exit criteria (all required):** 60 fps sustained pan/zoom at 200 markers on reference Android hardware · GPU marker layers correct on both platforms · cluster expansion works · avatar animates without blowing frame budget · memory under 250 MB · ODbL attribution unobscured.

## Documentation

Full specs and architecture live in [`docs/`](docs/README.md). Agent memory: [`AGENTS.md`](AGENTS.md).
