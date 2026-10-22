# WP-12a: make db.yml actually start Supabase and fail for the real reason

Planner: Opus. Executor: Sonnet, in its own worktree from `origin/develop` (`539482b` or later). The executor does **not** commit; it writes `.wp-commit-msg`. Integrator: Haiku, following INTEGRATE.md plus §6.
Jira: **SCRUM-37** (SCR-0205), partial. This comes from queue.json `WP-12` and line 3 of plans/WP-08.md. The integrator re-reads SCRUM-37 before commenting.

## 0. Root cause: verified

- `gh run list -w db.yml` shows 8 runs, all failures:
  - develop: 539482b, 964b471, a278ff4, 3d30cc7, f3a1505
  - main: 8a05adc
  - Dependabot: #18, #15
- Run 39800524285 (539482b): step "Start Supabase and apply migrations" runs only `supabase db reset` and stops after about 0.8 s with `supabase start is not running.` and exit code 1. Run 39718306145 (f3a1505) fails the same way.
- So **no migration was ever applied and no pgTAP test ever ran in CI**. The "red until WP-08…12 because 0003/5/6 break" claim was never observed.
- Other facts from the log:
  - `setup-cli@v1` and `checkout@v4` trigger the Node 20 deprecation warning.
  - `[inbucket]` is deprecated in favour of `[local_smtp]`. Harmless, out of scope.
- `scripts/run-pgtap.sh` starts Supabase if `supabase status` fails, then runs `supabase db test`. No change is needed.
- The npm scripts db.yml calls are bash only (`ci:assert-*` is grep or echo; `db:test` is run-pgtap.sh). So **no `npm ci`**, which also avoids the `postinstall: patch-package`.
- There is no `supabase` npm package in package.json or the lockfile. That matters for setup-cli v3's version detection.
- Migrations and tests don't use storage, realtime, graphql, pg_net or pgsodium. They do use `auth.users`, so **gotrue stays on**.
- `config.toml` sets `[db.seed] sql_paths = ["./seed_harness.sql", "./seed.sql"]`. `supabase start` on a fresh volume applies migrations and then those seeds, so a `db reset` after `start` is redundant. **Drop it.**
- The `paths:` filter already includes db.yml. Add `package.json` and `.nvmrc`, which db.yml now depends on.

## 1. Decisions

| Item | Decision | Why |
|---|---|---|
| CLI version | **2.120.0** | Released 2026-10-06, the newest release at least 2 weeks old. 2.121.0 is 8 days old. |
| setup-cli | **v3, `45a513f8c64c0bc8e0e3dfe572b5c95be85f6359 # v3.0.1`** | The README documents only v3. Without `version` it falls back to `latest` (we have no supabase in the lockfile), so `version: 2.120.0` must be explicit. v3 is a composite action, so no Node 20 warning, and it keeps the registry fallback. SHA-pinned as a third-party action. |
| PR #18 (setup-cli 1→3) | Close as superseded after the push | WP-12a includes it |
| checkout | Stay on `@v4` here. Leave #15 open. | #15 bumps checkout in all three workflows together. Keeps this diff to the verifier. |
| #15 / #19 | Leave open. Comment `@dependabot rebase` after WP-12a. Merge when `app` is green. | Separate `ci(deps)` change |
| setup-node | `actions/setup-node@v4`, `node-version-file: .nvmrc`, no cache, no npm ci | npm for setup-cli v3 and for `npm run` |
| Excludes | `-x studio,postgres-meta,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,storage-api` | Keep gotrue, kong and postgrest. Re-check the names against 2.120.0 (V3). |
| `db reset` after start | Removed | See §0. `npm run db:reset` stays for local use. |
| Legibility | `tee` the start log. On failure, write the migration and seed error lines to `$GITHUB_STEP_SUMMARY`. `--debug` is opt-in through `workflow_dispatch`. | The default output already names the migration and statement. `--debug` floods the log. |
| Static gates | Run them before `supabase start` | They need no database |
| Other | Add `workflow_dispatch` (input `debug`), `permissions: contents: read`, and step timeouts (start 15 min, pgTAP 10 min). Concurrency unchanged. | `workflow_dispatch` only works once db.yml is on main |

## 2. Exact `.github/workflows/db.yml` (replace the whole file)

```yaml
name: Database (pgTAP + RLS)

on:
  push:
    branches: [main, develop]
    paths:
      - 'supabase/**'
      - 'scripts/run-pgtap.sh'
      - 'scripts/ci-assert-*.sh'
      - '.github/workflows/db.yml'
      - 'package.json'
      - '.nvmrc'
  pull_request:
    paths:
      - 'supabase/**'
      - 'scripts/run-pgtap.sh'
      - 'scripts/ci-assert-*.sh'
      - '.github/workflows/db.yml'
      - 'package.json'
      - '.nvmrc'
  # Manual re-run. GitHub only offers this once db.yml is on the default branch (main).
  workflow_dispatch:
    inputs:
      debug:
        description: 'Run supabase start with --debug'
        type: boolean
        default: false

permissions:
  contents: read

# One run per workflow+ref. PR runs supersede each other (only the head matters);
# pushes to main/develop are never cancelled, because each push on develop is a
# separately integrated package and every one of them must be verified.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  db:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      # Node only for npm itself (the npm scripts below are bash; no npm ci) and for
      # setup-cli v3, which installs the CLI from npm.
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      # Pinned: bump deliberately (a release at least two weeks old), never `latest`.
      - name: Install Supabase CLI
        uses: supabase/setup-cli@45a513f8c64c0bc8e0e3dfe572b5c95be85f6359 # v3.0.1
        with:
          version: 2.120.0

      - name: Tool versions
        run: |
          supabase --version
          node --version
          docker --version

      # No database needed, so these run (and report) even when migrations fail.
      - name: Static CI gates
        run: |
          npm run ci:assert-no-private-grants
          npm run ci:assert-negative-ratio
          npm run ci:assert-definer-allowlist

      # On a fresh runner `supabase start` creates the database, applies every
      # migration in filename order, then seeds per config.toml [db.seed]
      # (seed_harness.sql, then seed.sql). No `db reset` afterwards: it would redo all of it.
      # Excluded services are not needed by pgTAP; gotrue, kong and postgrest stay up.
      - name: Start Supabase (migrations + seed)
        timeout-minutes: 15
        shell: bash
        env:
          DEBUG_FLAG: ${{ inputs.debug && '--debug' || '' }}
        run: |
          supabase start $DEBUG_FLAG \
            -x studio,postgres-meta,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,storage-api \
            2>&1 | tee "$RUNNER_TEMP/supabase-start.log"

      - name: Show first migration / seed error
        if: failure()
        shell: bash
        run: |
          log="$RUNNER_TEMP/supabase-start.log"
          [[ -f "$log" ]] || { echo "supabase start did not run"; exit 0; }
          pattern='Applying migration|Seeding|ERROR|SQLSTATE|At statement|error running'
          lines="$(grep -nE "$pattern" "$log" | tail -n 40 || true)"
          [[ -n "$lines" ]] || lines="$(tail -n 40 "$log")"
          echo "$lines"
          {
            echo '### supabase start failed'
            echo
            echo '```'
            echo "$lines"
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"

      - name: pgTAP tests
        timeout-minutes: 10
        run: npm run db:test

      - name: Stop Supabase
        if: always()
        run: supabase stop --no-backup || true
```

Executor notes:
- `shell: bash` gives `-eo pipefail`, so `tee` doesn't hide start's exit code. Keep it.
- `inputs.debug` is empty on push and PR events.
- `$DEBUG_FLAG` stays unquoted on purpose.
- Do not change `scripts/run-pgtap.sh` or `config.toml`.

## 3. Doc and queue updates (these files only)

Allowed files:
- `.github/workflows/db.yml`
- `docs/07-review/04-backlog-execution/harness-baseline.md`
- `docs/07-review/04-backlog-execution/README.md`
- `docs/07-review/04-backlog-execution/queue.json`
- `docs/07-review/04-backlog-execution/plans/WP-12a.md`
- `docs/05-operations/02-cicd.md`
- `AGENTS.md`
- `.wp-commit-msg`

Nothing in `supabase/`.

**3.1 `harness-baseline.md`.** Append:

```
## CI reality check (2026-10-22, WP-12a)

Until WP-12a, `db.yml` never reached Postgres. Its only DB step was `supabase db reset`, which needs a running stack and exited immediately with "supabase start is not running" on every run (f3a1505 … 539482b, run 39800524285). So the findings above were never reproduced in CI; "db.yml is red because of the migrations" was an inference, not an observation. WP-12a makes db.yml run `supabase start` (CLI 2.120.0 pinned), so the first real migration error, and whether `h3` exists in the Supabase image, now shows up in the "Start Supabase" step and its job summary.
```

**3.2 Backlog `README.md`.**
- Replace the CI status line (`CI: App workflow green on develop. Database workflow red until WP-08…WP-12 land (expected).`) with:
  `CI: App workflow green on develop. Database workflow red: until WP-12a it never started Supabase (\`db reset\` without \`start\`), so no migration or pgTAP had ever run in CI; the "red because of migrations" expectation was never observed. After WP-12a it is red at the first real migration error, until WP-08…WP-11 land.`
- In "Planned by Opus, ready for Sonnet", add a first bullet:
  `**WP-12a** (SCRUM-37, partial): db.yml runs \`supabase start\` with a pinned CLI so GitHub Actions is the real Postgres verifier for WP-08…WP-11 (no local Docker needed). Lands first. \`plans/WP-12a.md\``
- In "Not yet planned", change the WP-12 text to:
  `WP-12 (broken-policy fixture + first green db.yml run + CI/CD §2 verified state; the first real Supabase run and the h3 answer come from WP-12a)`
- In "Database findings", change `WP-12's real \`supabase start\` run decides` to `WP-12a's real \`supabase start\` run decides`.

**3.3 `queue.json`.** Edit with Python so formatting round-trips: `json.dumps(q, indent=1)` with no trailing newline.
- Insert immediately before `WP-08`:
  ```json
  {"id":"WP-12a","jira_keys":["SCRUM-37"],"backlog_keys":["SCR-0205"],
   "title":"db.yml: supabase start + pinned CLI so CI reaches Postgres (expected red at first real migration error)",
   "class":"do-partial",
   "position_reason":"db.yml never started Supabase (`db reset` alone fails with \"supabase start is not running\"), so no migration or pgTAP ever ran in CI. Lands before WP-08 so GitHub Actions verifies WP-08..WP-11 without local Docker.",
   "scope":"Workflow only: setup-cli v3.0.1 (SHA) with CLI 2.120.0; setup-node from .nvmrc (no npm ci); static gates before start; supabase start -x non-DB services, no db reset; failure summary of migration/seed errors; workflow_dispatch(debug); paths + package.json/.nvmrc; doc corrections.",
   "files":[".github/workflows/db.yml","docs/05-operations/02-cicd.md","docs/07-review/04-backlog-execution/harness-baseline.md","docs/07-review/04-backlog-execution/README.md","docs/07-review/04-backlog-execution/queue.json","AGENTS.md"],
   "verify":["actionlint .github/workflows/db.yml","git push; gh run watch <id> --exit-status  # expect red past supabase start, first migration error captured"],
   "skills":["ci-cd-and-automation","debugging-and-error-recovery"],
   "risks":"If CI shows h3/h3_postgis unavailable, STOP and raise ADR-0005 with Corey; do not change migrations here.",
   "remaining_after":"WP-12: broken-policy fixture, first green run, CI/CD §2 verified state."}
  ```
- `WP-12`:
  - `title` becomes `"db.yml broken-policy fixture + first green run + CI/CD §2 verified state"`.
  - `position_reason` becomes `"Needs WP-12a (working db.yml) and WP-08/09/10/11 (clean migrations + pgTAP). It is the green-run gate that unblocks SCR-0206/0210/0212 and the FORCE sweep."`.
  - Delete `Pin setup-cli to an exact version; run supabase start then db reset; run db:test.` from `scope`.
- In the WP-08, WP-09 and WP-10 `verify` lists, replace the `"WP-12 GitHub run…"` strings with `"db.yml GitHub run (WP-12a)"`. Keep WP-09's `(real supabase_vault)` suffix.
- The order is WP-12a, WP-08, WP-09, WP-10, WP-11, WP-12. Don't reorder anything else.

**3.4 `docs/05-operations/02-cicd.md` §2.**
- Change the header `State (2026-10-21)` to `State (2026-10-22)`.
- `migrate`: `**Partial**: \`db.yml\` \`supabase start\` applies migrations + seed (CLI pinned); **not passing**, it stops at the first migration error until WP-08…WP-11; no production-shaped seed`.
- `pgtap-rls`: `**Wired, not passing**: \`db.yml\` runs pgTAP only after \`supabase start\` succeeds, which it has not yet; \`ci:assert-negative-ratio\` runs`.
- `pgtap-geo`: `**Wired, not passing**: \`db.yml\` runs every \`supabase/tests/*.test.sql\` once migrations apply`.
- `security-static`: `**Partial**: \`db.yml\` private-grant gate runs; definer-allowlist is a stub`.
- Bump the version to 1.0.4 and add a change-log row:
  `| 2026-10-22 | 1.0.4 | Platform Engineering | §2 db.yml rows corrected: before WP-12a the workflow ran \`supabase db reset\` without \`supabase start\` and never reached Postgres, so pgTAP had never run in CI. It now starts Supabase with a pinned CLI and is red at the first real migration error (SCRUM-37) |`

**3.5 `AGENTS.md`.**
- In the §4 "CI today" bullet, replace `` `db.yml` (pgTAP, RLS negative ratio, private-grant and definer allowlist gates) `` with `` `db.yml` (`supabase start` applies migrations + seed, then pgTAP; RLS negative-ratio, private-grant and definer-allowlist gates; **not green yet**, it stops at the first migration error until WP-08…WP-11 land) ``.
- Add one line at the top of the §7 list:
  `` - `[2026-10-22] [claude] db.yml is the real-Supabase oracle when there is no local Docker. On a fresh runner \`supabase start\` itself applies migrations and the [db.seed] files; \`supabase db reset\` alone needs a running stack and exits at once ("supabase start is not running"), which is why no migration or pgTAP ran in CI before WP-12a. The CLI version is pinned in db.yml: bump it deliberately, never \`latest\` — [CI/CD §2](docs/05-operations/02-cicd.md).` ``

**Out of scope (report only):**
- `docs/07-review/02-development-notes.md:279` marks SCR-0205 "Done". That belongs to WP-12.
- The `[inbucket]` → `[local_smtp]` deprecation.

## 4. What the first real run should hit, in order

1. **`20260822_0001_baseline.sql:21`: `CREATE EXTENSION IF NOT EXISTS h3;`** This comes before the version collision.
   - If h3 is missing: **STOP. Do not edit migrations, swap in geohash, or drop H3. Surface it to Corey (ADR-0005).** WP-10 is blocked; WP-08, WP-09 and WP-11 can still go ahead.
2. **If h3 exists:** expect the duplicate CLI version `20260822` (`schema_migrations_pkey`, SQLSTATE 23505, or a pre-apply rejection). This is WP-08.
3. After WP-08:
   - 000003 `h3_get_hexagon_edge_length_avg(integer, unknown)` (WP-10). It may not occur if h3 lands in `extensions`; record which.
   - 000005 `digest(text, unknown)` (WP-09/10).
   - 000006 `vault.get_secret`, or a "must be owner" error (WP-09).
   - Seed `h3_lat_lng_to_cell(geometry, integer)`, which needs `h3_postgis` (WP-10). The same ADR-0005 stop rule applies.
4. Then pgTAP: LP-06 `min(geography)` (WP-11), real GoTrue `auth.users` differences, and `query_timing` budgets on the runner.

## 5. Executor steps and verification

- **V0.** Confirm the worktree HEAD is origin/develop.
- **V1.** Write db.yml (§2), make the §3 edits, and write `.wp-commit-msg` (§7).
- **V2.**
  - Run `brew install actionlint && actionlint .github/workflows/db.yml`. It must be clean. As a fallback, try `npx -y actionlint@2.0.6`. If neither works, say "not run".
  - YAML parse via `NODE_PATH=/Users/cxb317/Documents/ai/sharecropr/node_modules node -e "…require('yaml')…"`.
  - `grep -nE 'version: latest|db reset'` on `run:` lines must print nothing.
- **V3.** `npx -y supabase@2.120.0 start --help | grep -- '--exclude'`. All 10 names must appear. Then `git checkout -- supabase/.temp`.
- **V4.** The three `ci:assert-*` scripts pass locally.
- **V5.** The queue.json round-trip assertion passes, WP-12a sits directly before WP-08, and `git diff --stat` touches only allowed files.
- **V6.** `npm run ci:doc-gates` and `./scripts/agent-memory-bridge.sh check` pass.
- **V7.** `git status --short` shows only allowed files plus `.wp-commit-msg`.

## 6. Integrator: real verification

1. Follow INTEGRATE.md steps 1–5.
   - Never stage `supabase/.temp/*`.
   - If queue.json conflicts, re-apply §3.3 with Python.
   - If AGENTS.md has an add-only conflict, keep both sides.
2. Find the db.yml run for the pushed SHA and run `gh run watch <id> --exit-status`. Red is expected; don't retry.
3. Capture the error: `gh run view <id> --log-failed | grep -nE 'Applying migration|Seeding|ERROR|SQLSTATE|At statement' | head -20`.
4. Classify:
   - **E1:** red at Start Supabase after at least one `Applying migration`. WP-12a is done.
   - **E2:** h3 or h3_postgis unavailable. WP-12a is done. STOP WP-10 and report to Corey (ADR-0005).
   - **E3:** red before any migration. WP-12a is not done; report it, and fix in a follow-up `ci(db):` commit.
   - **E4:** green. Unexpected; report it and don't mark docs "passing".
5. PRs:
   - `gh pr close 18 --comment "Superseded by <sha> (WP-12a): db.yml uses supabase/setup-cli v3.0.1, SHA-pinned, with CLI 2.120.0."`
   - Comment `@dependabot rebase` on #15 and #19.
6. Jira SCRUM-37: stays In Progress, with the §7 comment.
7. Follow-up docs commit: add `First real db.yml run (<run id>, <sha>): <migration file>: <ERROR line>` to README "Database findings".

Report format:
```
WP-12a  sha=<short>  push=ok|failed  rebase-conflicts=<none|files+resolution>
db.yml run: <id>  url=<url>  conclusion=<failure|success>  outcome=E1|E2|E3|E4
Reached: Tool versions ✓ | Static gates ✓/✗ | Start Supabase ✗ (after N migrations applied)
Last applied OK: <file or none>
First failing: <file>  →  <exact ERROR line incl. SQLSTATE>
At statement: <first 120 chars, or n/a>
h3: available | NOT AVAILABLE (ADR-0005 → Corey) | not reached
PRs: #18 closed|auto-closed; #15/#19 rebase requested
Jira SCRUM-37: comment added, status In Progress
```

## 7. Commit message (`.wp-commit-msg`)

```
ci(db): start Supabase in db.yml so migrations and pgTAP actually run (WP-12a)

db.yml has failed on every run since f3a1505 without touching Postgres:
its only DB step was `supabase db reset`, which needs a running stack and
exits at once with "supabase start is not running". No migration was
ever applied in CI and no pgTAP test ever ran; the "red until WP-08..12"
expectation was never observed.

- `supabase start` applies migrations, then seed_harness.sql and seed.sql
  per config.toml; studio, postgres-meta, imgproxy, mailpit, edge-runtime,
  logflare, vector, supavisor, realtime and storage-api are excluded. The
  redundant `db reset` is gone.
- Supabase CLI pinned to 2.120.0 via supabase/setup-cli v3.0.1 (SHA),
  replacing v1 + `version: latest` (supersedes Dependabot #18).
- setup-node from .nvmrc; no npm ci (the npm scripts used are bash only).
- Static gates run before start so they report even when migrations fail.
- On failure the migration/seed error lines go to the job summary.
- workflow_dispatch with optional --debug, contents: read, step timeouts;
  paths also cover package.json and .nvmrc.

Expected: still red, now at the first real migration error. Docs:
harness-baseline.md, backlog README and queue.json (WP-12a added ahead of
WP-08; WP-12 keeps the broken-policy fixture and first green run), CI/CD
§2 db.yml rows corrected (v1.0.4), AGENTS.md §4 + memory line.

Refs: SCRUM-37 (SCR-0205), partial
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Jira (SCRUM-37, partial): "Partial — pushed to develop in <sha>: db.yml now runs `supabase start` (CLI 2.120.0 pinned, setup-cli v3.0.1), so migrations, seed and pgTAP actually execute in CI; earlier runs never reached Postgres (`db reset` without `start`). First real error (run <id>): <file>: <ERROR line>. Open: WP-08/09/10/11 migration and test fixes, broken-policy fixture, first green run, CI/CD §2 verified state (WP-12)."

## 8. Open questions for Corey

1. **h3 / h3_postgis (ADR-0005), conditional (stays conditional; not decided).** If the image lacks them, the geospatial model needs a decision. WP-10 stops until then.
2. **Jira shape.** WP-12a is a partial of SCRUM-37 and gets a comment. Do you want a sub-task instead?
   **Decided (Corey, 2026-10-22): default** (comment on SCRUM-37, not a sub-task).
3. **Action bumps and pinning policy.** Merge #15 (checkout v7) and #19 (setup-node v7) after WP-12a? SHA-pin all actions?
   **Decided (Corey, 2026-10-22): default** (merge #15 and #19 after WP-12a once `app` is green).
4. **Required check.** Once WP-12 is green, should `db` become a required check on develop and main?
   **Decided (Corey, 2026-10-22): default** (make `db` required once WP-12 is green).
5. **workflow_dispatch** needs db.yml on `main`. Promote after WP-12a?
6. **`[inbucket]` → `[local_smtp]`.** Which package renames it?
7. **SCR-0205 "Done"** in Development Notes is inaccurate. Fix it in WP-12 (default) or now?
   **Decided (Corey, 2026-10-22): default** (fix in WP-12).
