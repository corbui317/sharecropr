# Backlog execution — handoff (2026-10-21)

Session notes for continuing the SCRUM backlog in Claude Code (VS Code). Session-scoped, per AGENTS.md §7 — not durable agent memory.

## How the work runs

Tickets live in Jira project **SCRUM** (corbui317.atlassian.net, board 1): epics SCRUM-5…9 (SCRUM-9 = Bugs), tickets SCRUM-10…71, all labelled `code-review-2026-10-21`. They came from a two-axis code review (spec + standards) of `develop` on 2026-10-21.

Per package, in queue order:
1. **Opus plans** — reads `BRIEF.md`, the package entry in `queue.json`, the Jira ticket, the skills it lists; writes `plans/WP-XX.md` (exact edits, tests first, verification commands, commit message). Read-only on the repo.
2. **Sonnet executes** — in its own git worktree on branch `wp/WP-XX`, implements the plan, runs every verification, does not commit.
3. **Haiku integrates** — follows `INTEGRATE.md`: commit, rebase onto `origin/develop`, re-run checks, push to `develop`, update Jira (Done / In Progress + comment), remove the worktree.

Packages that don't depend on each other run in parallel (separate worktrees); integration is always one at a time.

Skills used: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) and [mattpocock/skills engineering](https://github.com/mattpocock/skills/tree/main/skills/engineering). Each package's `skills` field names which.

**Path note:** plans were written in a cloud session and reference `/tmp/claude-0/.../scratchpad/work/...`. Those paths map to this folder: `.../scratchpad/work/plans/` → `plans/`, `.../work/queue.json` → `queue.json`, `.../work/BRIEF.md` → `BRIEF.md`, `.../work/INTEGRATE.md` → `INTEGRATE.md`, `.../review/` → the review reports summarised in Jira. Worktree paths `/home/claude/wt/WP-XX` → use any local worktree dir.

## Decisions Corey made (2026-10-21)

| Ticket | Decision |
| --- | --- |
| SCRUM-64 | Jest (jest-expo) + React Native Testing Library for unit/component; Maestro stays for E2E. Amend test-strategy §2 and LP-08. (WP-02b) |
| SCRUM-62 | Move the AppState listener out of `src/api` into an app boot hook calling exported start/stopAutoRefresh; amend mobile-arch §5. (WP-03b) |
| SCRUM-32 | Accept the EPIC-01 gate breach retroactively; keep hardening EPIC-00/02/03; freeze EPIC-04+ until SCR-0104 go/no-go; add a `__DEV__`-only spike route that bypasses auth. (WP-01b) |
| SCRUM-18 | Forward-only migrations; amend SCR-0007 to "forward apply on a disposable DB + rehearsed roll-forward". (WP-12b) |
| SCRUM-31 | Amend SPEC-008 R69: point features carry exactly (id, listing_count, category, label, selected); cluster features (id, cluster_id, point_count); category_glyph derived in-style. (WP-05b) |

## Status

### Pushed to `develop`

| Package | Commit | Jira |
| --- | --- | --- |
| WP-01 Node pin, seed docs | 46111e3 | SCRUM-10 In Progress — open: time a fresh clone → green local run |
| WP-02 CI on develop + CODEOWNERS | f3a1505 | SCRUM-11 In Progress — open: branch protection (Corey), Jest runner (WP-02b) |
| WP-22 ci:doc-gates (schema cycle + register sync) | 4734854 | SCRUM-12 **Done** |
| WP-25 Dependabot + weekly audit issues | 2fa769e | SCRUM-20 In Progress — open: activates on `main`; enable Dependabot in repo settings |
| WP-03 RN-import ban fixed + single supabase-js import | 0a49f76 | SCRUM-69 **Done**; SCRUM-15 In Progress — open: AppState (WP-03b) |
| WP-04 FPS profiler + render milestones | b2f9638 | SCRUM-30 **Done**; SCRUM-26 In Progress — open: device capture (SCRUM-27), R73 rule sign-off |

CI: App workflow green on develop. Database workflow red: until f4e5aba (WP-DBCI) it never started Supabase (`db reset` without `start`), so no migration or pgTAP had ever run in CI; the "red because of migrations" expectation was never observed. Now it is red at the first real migration error, until WP-08…WP-11 land.

### Planned by Opus, ready for Sonnet (start here)

- **WP-12a** (SCRUM-37, partial): db.yml runs `supabase start` with a pinned CLI so GitHub Actions is the real Postgres verifier for WP-08…WP-11 (no local Docker needed). Lands first. `plans/WP-12a.md`
- **WP-08** (SCRUM-35) — 14-digit migration versions, forward-only convention doc, break_glass role. **Do first among DB work**; WP-09/WP-10 edit the same migration files after the rename. `plans/WP-08.md`
- **WP-11** (SCRUM-44) — LP-06 rewritten (display_point is stable per garden; asserts 1,000 reads never converge on exact_point), LP-08/09/10/12 → `skip()` with backlog keys. Validated SQL: `plans/WP-11-files/location_privacy.test.sql`. Independent of WP-08.
- **WP-06** (SCRUM-24) — label/POI/sprite layers + `ci:validate-map-style`. Validated drafts in `plans/WP-06-files/`. Independent.
- **WP-02b** (SCRUM-64, SCRUM-11 AC2) — Jest + RNTL adoption, fully prototyped (npm test 28/28 against b2f9638). Exact pins, `jest.config.js`, migrated tests and an exact-match edit script in `plans/WP-02b-files/`. Migrates `test:auth-domain` and `test:map` into Jest; tooling tests (doc-gates, dependency-audit) stay on node:test. **After it lands, run `npm ci`** (new devDependencies). **Do this before WP-05** — WP-05's tests must be written in Jest, not `scripts/map-tests/`.

### Not yet planned
Everything else in `queue.json` (`packages`), in order. Next after the above: WP-05 (follow mode — after WP-04, shares MapCanvas), WP-09, WP-10, WP-12 (broken-policy fixture + first green db.yml run + CI/CD §2 verified state; the first real Supabase run and the h3 answer come from WP-12a), WP-13…WP-21, WP-23 (note: 13 asymmetric "Behaviourally coupled with" edges exist today and must be fixed in the same change), WP-24, WP-26…WP-42, plus WP-01b/03b/05b/12b from the decisions.

### Needs Corey (hardware / accounts) — `queue.json` → `external`
SCRUM-14 (EAS), 21 (rollback rehearsal), 22 (R2 tiles), 23/27/29 (device runs + go/no-go), 39 (Vault rotation on staging), 54 (public web deletion — hosting), 59 (leaked-password protection on hosted Supabase). Also: GitHub branch protection, Dependabot settings, merging `develop` → `main` so scheduled workflows activate.

## Open questions for Corey (raised by planners, not resolved)

1. **Forward-only vs. broken early migrations.** Migrations 000003/000005/000006 fail on a fresh DB, so a later corrective migration can never run. WP-09/WP-10 must edit those files in place. Planner recommends a one-time, recorded exception for never-applied migrations (record it in Data Model §15 when approved).
2. **`digest()` search_path error in 000005** has no owner in WP-09/WP-10 scope — assign it to WP-10.
3. **Break-glass provisioning** (access grant, 60-min expiry, two-person approval, audit — Runbooks §6) has no backlog key; allocate one. WP-08 only creates the inert role.
4. **R73 claim rule** (first-full-frame p95 < 1.0 s) proposed in WP-04 — needs mobile-lead sign-off.
5. **SPEC-008 R74 vs. reality**: the dated basemap archive lives in app config/env, not the style file, so rollback is a config change + OTA, not a style edit as ADR-0020 implies. Record which is intended (overlaps WP-42).
6. **Solo maintainer vs. two-reviewer rule** (ADR-0003, THR-03, RLS Design §7): GitHub won't let you approve your own PR, so required code-owner review would block every migration PR. Recruit a reviewer or amend the docs.
7. **SPEC-001 T05 vs R06/N18**: T05 says a 200-char password is accepted; R06/N18 cap at 128 (code rejects >128). WP-02b's migrated test follows the code and comments the conflict — amend one of them.

## Database findings (local PG16 stand-in, 2026-10-21)

See `harness-baseline.md`. Migrations as written fail in four places before pgTAP can run:
1. Duplicate CLI versions (`20260822_000N` → all `20260822`) → WP-08.
2. `CREATE EXTENSION h3` lands in `public` but functions use `search_path = pg_catalog, extensions` → WP-10.
3. `digest()` called without `extensions` on the search_path (0005) → WP-10/WP-09.
4. `vault.get_secret` doesn't exist in Supabase Vault (0006) → WP-09; `h3_lat_lng_to_cell(geometry,…)` needs `h3_postgis` → WP-10.
With those patched, 188/188 pgTAP assertions passed (after the LP-06 fix). **Open risk:** Supabase's documented extension list doesn't include `h3`; WP-12a's real `supabase start` run decides — if absent, stop and raise an ADR-0005 decision.

On a Mac with Docker you don't need the stand-in: `npm run db:start && npm run db:reset && npm run db:test`.
