# Sharecropr — Agent Memory

**This file is the single source of truth for AI coding agents on this repo.**
`CLAUDE.md` is a symlink to this file. Cursor reads it natively and via `.cursor/rules/00-agent-memory.mdc`.
Edit **this** file. Never edit `CLAUDE.md` — you would be editing this file anyway, but through a name that hides that fact.

Run `./scripts/agent-memory-bridge.sh check` before committing. CI runs the same command.

---

## 1. What this project is

Sharecropr is an iOS and Android app that lets home gardeners inventory surplus crops and barter them with nearby gardeners, **meeting only at pre-approved public safe spots**. No money changes hands, ever.

Stack: React Native (Expo, New Architecture) · Supabase (Postgres + PostGIS + RLS + Edge Functions) · Expo push.

---

## 2. Read these before you write code

`docs/` is the source of truth. Code that contradicts it is a bug in one of the two — resolve it, don't ignore it.

| Before you touch… | Read |
| --- | --- |
| **Anything location-related** | [Location Privacy](docs/01-architecture/04-location-privacy.md) — **before a single line** |
| The database | [Data Model](docs/01-architecture/03-data-model.md) → [RLS Design](docs/01-architecture/05-rls-design.md) |
| A feature | Its [SPEC](docs/03-specs/) → §13 Test Plan |
| The exchange flow | [Exchange State Machine](docs/01-architecture/07-exchange-state-machine.md) |
| Anything, on your first day | [Development Notes](docs/07-review/02-development-notes.md) |
| Planning or picking up work | [Delivery Backlog](docs/06-roadmap/03-delivery-backlog.md) |

Full index: [docs/README.md](docs/README.md).

---

## 3. Invariants — do not violate, do not "temporarily" work around

1. **No exact garden coordinate** in any response, log, telemetry event, push payload, export, or moderator view. Only derived/fuzzed location is persisted. (NFR-45, LP-01…LP-13, continuously asserted by the location canary.) Location is PostGIS-only with named tiers ([ADR-0023](docs/01-architecture/adr/ADR-0023-postgis-location-tiers.md)); `fine_cell` never leaves the database.
2. **No payments of any kind.** [ADR-0002](docs/01-architecture/adr/ADR-0002-barter-only.md). Reconsidering requires a new ADR and legal review.
3. **No home-address meetings.** No code path may produce one.
4. **No background location.**
5. **Every `public` table has RLS enabled *and* forced**, with negative tests outnumbering positive ones. (NFR-46, NFR-47.)
6. **Refresh tokens in hardware-backed secure storage only.** Never `AsyncStorage`, never a log, never a crash report. (NFR-48.)
7. **TOTP only — no SMS second factor.** ([ADR-0014](docs/01-architecture/adr/ADR-0014-totp-not-sms.md).)
8. **All EXIF stripped server-side before an asset is readable.** Not "shortly after upload." (NFR-52.)
9. **No cold DMs.** Threads exist only to coordinate an exchange and close with it.
10. **No infinite spinners.** Every loading state resolves to content, a cached view, or an actionable error.
11. **`src/domain` and `src/api` must not import React Native.** That constraint is what makes a web client possible later; CI enforces it.
12. **Authorization lives in the database** ([ADR-0003](docs/01-architecture/adr/ADR-0003-database-centric-authz.md)), not in the client and not in a service layer.

---

## 4. Working agreements

- **Traceability is required.** Every spec `MUST` maps to a test ID in that spec's §13, and the test source echoes the namespaced ID (`// SPEC-001-T34`, never a bare `T34`). `npm run ci:spec-traceability` enforces it in `app.yml` against a shrink-only baseline of known gaps (`scripts/spec-traceability.baseline.json`): a new gap fails, and so does a closed gap still listed — run it with `-- --update-baseline` and commit the shrink. The baseline never grows ([CI/CD §5](docs/05-operations/02-cicd.md)).
- **CI today is three workflows:** `app.yml` (bridge check, doc-gates (schema graph acyclic, coupling symmetric, register sync) + its fixture self-test, spec-traceability + its fixture self-test, lint incl. the import seams, `lint:fixtures`, typecheck, Jest unit + component tests via `npm test`, dependency-audit script tests), `db.yml` (`supabase start` applies migrations + seed, then pgTAP; RLS negative-ratio, private-grant and definer-allowlist gates; its first real runs (2026-10-22) stopped at the `h3` extension, removed in WP-DB-BASELINE (ADR-0023)), and `dependency-audit.yml` (weekly + manual `npm audit`; opens/updates one `security` issue per GHSA, never blocks a PR). Every other check in [CI/CD §2](docs/05-operations/02-cicd.md) is planned, not running — do not assume it will catch you.
- **Two dependency relations, and only one orders work.** `Schema depends on` must be a DAG and is the only thing that constrains build order. `Behaviourally coupled with` may cycle freely and must be symmetric. Both properties are enforced by `ci:doc-gates`. Conflating them makes the plan look unbuildable. See [Spec Register](docs/03-specs/README.md#build-order).
- **Spec numbers are permanent and never reused.** Claim one in a small PR before writing.
- **Backlog keys (`SCR-EENN`) are permanent and never reused.**
- **ADRs capture *why*, not *what*.** A design change without an ADR is a decision nobody can audit.
- **Nothing is deleted.** Superseded specs keep their number and get a banner.

---

## 5. Current state

**EPIC-01 spike, EPIC-02 baseline, and EPIC-03 auth code are in-repo. Map go/no-go is still open.**

- **EPIC-02** (data model, RLS, pgTAP harness): story status in [Development Notes § Session notes](docs/07-review/02-development-notes.md#session-notes). SCR-0209 deferred; SCR-0210 canary is a scaffold.
- **EPIC-03** (SPEC-001 auth): code landed in `c0b9be7` — auth routes, session storage, `20260828000009_auth.sql`. Story-by-story status and which SPEC-001 §13 tests exist are **not yet recorded**; only a handful of T-IDs have tests.
- **Map:** the app boots through auth into the `MapCanvas` seam (`@maplibre/maplibre-react-native`, client-side `supercluster`, GPU GeoJSON layers, ODbL attribution). `react-native-maps` is removed. SCR-0105/0106 scaffolding is in-repo; the launch-metro PMTiles archive is not yet published to R2.

**Blocking next action:** run SCR-0101…0103 on physical hardware and file [docs/07-review/03-map-spike-go-no-go.md](docs/07-review/03-map-spike-go-no-go.md) (SCR-0104). Do not treat any prior `react-native-maps` result as evidence.


---

## 6. Open decisions an agent must not silently resolve

If your work runs into one of these, **stop and surface it**. Picking a side in code is how an unrecorded decision becomes a convention.

| Decision | Where it lives |
| --- | --- |
| ~~`react-native-maps` vs Mapbox~~ | **Resolved 2026-08-09** — MapLibre over OpenStreetMap, [ADR-0019](docs/01-architecture/adr/ADR-0019-openstreetmap-maplibre.md). The reset spike now decides only whether that holds; `react-native-maps` is the documented fallback |
| Does MapLibre RN's New Architecture interop hold at Expo 57? | Blocked on the **reset** map spike. [ADR-0019](docs/01-architecture/adr/ADR-0019-openstreetmap-maplibre.md), [R-04](docs/06-roadmap/02-open-risks.md) |
| Is the monthly PMTiles build routine or toil? | Two failures/skips in a quarter → take the managed fallback. [ADR-0020](docs/01-architecture/adr/ADR-0020-pmtiles-self-hosting.md), [R-15](docs/06-roadmap/02-open-risks.md) |
| Any export or public API of safe-spot data | **ODbL share-alike — legal review before implementation, not after.** [ADR-0021](docs/01-architecture/adr/ADR-0021-osm-safe-spot-sourcing.md) |
| Does the alternate trust path exist at MVP? | [R-03](docs/06-roadmap/02-open-risks.md), [Identity §6.1](docs/02-security/03-identity-verification.md) |
| SPEC-022's security-review classification | [Spec Register](docs/03-specs/README.md), SPEC-022 §15 Q1 |
| ~~`composted` exists in two vocabularies~~ | **Resolved 2026-10-21** — `inventory_status` only; dropped from `archive_reason`. [SPEC-006 Q3](docs/03-specs/SPEC-006-crop-inventory.md#15-open-questions) |
| ~~H3 vs PostGIS-only~~ | **Resolved 2026-10-22**: PostGIS only, named location tiers, [ADR-0023](docs/01-architecture/adr/ADR-0023-postgis-location-tiers.md) (supersedes ADR-0005) |
| ~~Who can read `handoff_code_key`~~ | **Resolved 2026-10-22**: only definer RPCs via `private.get_handoff_key()` (no client EXECUTE, fails closed); custody in [Environments §6](docs/05-operations/01-environments.md) |

---

## Commands

npm, not pnpm — `pnpm …` scripts named in `docs/` are planned and mostly do not exist yet.

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Run (dev client; Expo Go cannot run MapLibre) | `npx expo run:ios` · `npx expo run:android` |
| Lint · typecheck | `npm run lint` · `npm run typecheck` |
| Unit + component (Jest + RNTL; `src/domain` runs RN-free) | `npm test` |
| Database: start · reset · pgTAP | `npm run db:start` · `npm run db:reset` · `npm run db:test` |
| RLS / grant gates | `npm run ci:assert-rls` · `ci:assert-negative-ratio` · `ci:assert-no-private-grants` · `ci:assert-definer-allowlist` |
| Location canary | `npm run location-canary` |
| Agent memory | `./scripts/agent-memory-bridge.sh check` |

---

## Agent skills

### Issue tracker

GitHub Issues on `corbui317/sharecropr` via the `gh` CLI. Story keys (`SCR-EENN`) from the Delivery Backlog go in issue titles. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: glossary at `docs/00-foundation/04-glossary.md`, ADRs at `docs/01-architecture/adr/`. See `docs/agents/domain.md`.

---

## 7. Agent memory protocol

Both Claude Code and Cursor read this file. Neither can see the other's chat history, so **this file is the handoff**.

**Append a durable fact here when** you make a decision a future agent would otherwise re-litigate, discover a non-obvious constraint, or resolve an item in §6. Keep it to one or two lines and link the doc that holds the detail.

**Do not append** anything the repo already records — code structure, git history, or a restatement of a spec. If it belongs in a spec, put it in the spec and link it from here.

**Session-scoped notes go in `docs/07-review/`, not here.** This file is loaded into every agent session in both tools; it earns its size back only if everything in it is durable.

- `[2026-10-22] [claude] H3 is gone: Supabase's Postgres image has no h3 extension (db.yml run 39803696654). ADR-0023 supersedes ADR-0005: PostGIS geography only; proximity is ST_DWithin + GiST, never a cell filter. Tiers come from app.location_cell(): region 16 km (analytics), coarse 2.5 km (gardens.coarse_cell, profiles.home_coarse_cell), fine 320 m (gardens.fine_cell, never client-reachable); each column CHECK-pins its tier prefix. Migrations up to 20261022145504 were edited in place because none had applied anywhere (Data Model §15 rule 12); forward-only from the first hosted apply.`
- `[2026-10-22] [claude] db.yml is the real-Supabase oracle when there is no local Docker. On a fresh runner `supabase start` itself applies migrations and the [db.seed] files; `supabase db reset` alone needs a running stack and exits at once ("supabase start is not running"), which is why no migration or pgTAP ran in CI before f4e5aba. The CLI version is pinned in db.yml: bump it deliberately, never `latest` — [CI/CD §2](docs/05-operations/02-cicd.md).`
- `[2026-10-22] [claude] Never put tests or helpers under app/: expo-router makes every .ts(x) there a route (node_modules/expo-router/_ctx-shared.js), so route logic lives in src/features/*/screens and app/ files only re-export. auth-js signOut() returns early WITHOUT clearing storage when the session needs a refresh it cannot do (offline + expired token), and scope 'local' takes the same path: sign out through signOutWithLocalFallback in src/api/supabase.ts (SPEC-001-T19).`
- `[2026-10-22] [claude] Migration versions are 14-digit YYYYMMDDHHMMSS (UTC, `supabase migration new`); the CLI keys schema_migrations on the leading digits, so duplicates break db reset. The ten legacy files were renamed to YYYYMMDD00NNNN_* (HHMMSS = old ordinal). Forward-only once applied to a non-disposable DB, no DOWN files (SCRUM-18); break_glass exists NOLOGIN with zero grants, grants come only from the (unbuilt) provisioning procedure — [Data Model §15](docs/01-architecture/03-data-model.md#15-migration-rules) rules 1, 12.`
- `[2026-10-21] [claude] SCRUM-64: the one unit/component runner is Jest (jest-expo 57.0.4) + React Native Testing Library 14, not Vitest. jest.config.js has a domain project (src/domain, plain Node, no RN preset) and an app project (everything else, jest-expo). RNTL 14 render/fireEvent are async: always await them (lint enforces it in __tests__). Only scripts/ repo tooling stays on node:test — [Test Strategy §2](docs/04-testing/01-test-strategy.md).`
- `[2026-10-21] [claude] ESLint flat config REPLACES no-restricted-imports options per matching block — never merges. eslint.config.js therefore gives each glob one complete entry built from shared constants, has no global ignores, and seam files restate the list minus their one exemption. Prove any change with npm run lint:fixtures (must-fail + must-pass cases). src/api has no react-native exemption (SCRUM-62): the AppState listener is the useAuthAutoRefresh boot hook in src/features/auth, calling startAutoRefresh/stopAutoRefresh exported by supabase.ts — [mobile-arch §1.1a, §5.3](docs/01-architecture/02-mobile-architecture.md).`
- `[2026-10-21] [claude] Client privileges on public tables are revoke-then-grant (a column REVOKE is a no-op under Supabase's default table grants); new public tables start with no client grants. Other users' profiles are readable via profiles_select_visible, so every column granted on profiles is public to visible users; owner-only columns come from get_my_profile(). Client-callable app helpers are caller-scoped (can_transact(), is_blocked_with(other)) because the app schema is PostgREST-exposed. Step-up is AAL2 only when a factor is enrolled. The pgTAP harness lives in supabase/seed_harness.sql, not a migration — [ADR-0022](docs/01-architecture/adr/ADR-0022-profiles-other-user-reads.md).`
- `[2026-10-21] [claude] N-15 resolved: `composted` is an inventory_status value only and is not in the archive_reason vocabulary — SPEC-006 v1.1.0 Q3.`
- `[2026-10-21] [claude] Docs claimed CI gates that did not exist. Added .github/workflows/app.yml (bridge, lint, typecheck, auth unit); everything else in CI/CD §2 is labelled planned. Treat any "CI enforces" claim as unverified until you find the workflow step.`
- `[2026-08-10] [cursor] EPIC-01 spike ported to MapLibre: MapCanvas is the sole @maplibre/* import site; supercluster client-side (R70); Camera center+zoom; GPU GeoJSON layers; OsmAttribution; style JSON + tile-build scaffold. Prior react-native-maps spike invalidated — re-run go/no-go on device.`
- `[2026-08-09] [claude] OSM is the map substrate end to end. ADR-0019 (MapLibre RN over OSM vector tiles, supersedes ADR-0013), ADR-0020 (self-hosted Protomaps PMTiles on Cloudflare R2 — no tile vendor, no API key, no per-load billing), ADR-0021 (Overpass seeds safe-spot candidates into private.osm_spot_candidates; humans verify before anything goes live).`
- `[2026-08-09] [claude] THE MAP SPIKE IS RESET. The existing src/features/map/ code is react-native-maps and no longer validates the shipping stack. Port cost 4–6 days. Do not treat the earlier green result as evidence — docs/07-review/03-map-spike-go-no-go.md.`
- `[2026-08-09] [claude] Clustering is CLIENT-SIDE supercluster, and this is a privacy decision, not a performance one: a server cluster index needs high-precision viewport on every pan (SPEC-008 §3). MapLibre's built-in source clustering must stay disabled (SPEC-008-R70). An earlier ADR-0019 draft got this wrong by copying ADR-0013 verbatim.`
- `[2026-08-09] [claude] OSM opening_hours is a REVIEWER HINT ONLY. No automated path may write safe_spots.hours or hours_verified_at — a human confirms by phone, website, or visit. Stale hours are the top no-show cause. Column is deliberately named suggested_hours_raw so the two cannot be confused.`
- `[2026-08-09] [claude] ODbL attribution ("© OpenStreetMap contributors") is a licence obligation, not a design preference. It is NFR-99, rendered unconditionally on the map and anywhere OSM-derived spot data appears, and verified in CI.`
- `[2026-08-09] [cursor] EPIC-01 spike code landed: Expo 57 + MapCanvas seam + 200-marker supercluster spike screen. Go/no-go doc at docs/07-review/03-map-spike-go-no-go.md — outcome pending physical-device FPS profiling. **Superseded by the ADR-0019 reset above.**`
- `[2026-08-09] [claude] Shared agent memory established: AGENTS.md canonical, CLAUDE.md symlinked, Cursor rule generated by scripts/agent-memory-bridge.sh. .cursor/ is gitignored, so the Cursor-side rule is generated rather than committed — run the script after cloning.`
