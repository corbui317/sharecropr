# WP-02b — Adopt Jest (jest-expo) + React Native Testing Library (SCRUM-64; SCRUM-11 AC2 / SCR-0002)

Planner: Opus · Executor: Sonnet (own worktree, do NOT commit) · Integrator: Haiku · Class: do-partial
Repo: corbui317/sharecropr, branch `develop`. Node 22, npm (not pnpm).

**Decision being implemented (Corey, SCRUM-64):** Jest + RNTL for unit and component tests. Maestro stays for E2E.
Docs that say Vitest get amended. This plan does not reopen that decision.

## 0. What the planner verified (2026-10-21, against origin/develop `b2f9638`)

WP-03 (lint seams), WP-04 (profiler + `scripts/map-tests*` + `test:map`) and WP-25 (dependency audit) **have already landed**.
This plan is written against that tree. The planner ran the whole procedure in a throwaway `git worktree` of
`origin/develop`: every verification command in §4 passed, and the worktree was then removed.

**Versions** (checked with `npm view`, against the installed `expo@57.0.15`, `react-native@0.86.2`, `react@19.2.3`):

| Package | Exact version | Why this one |
|---|---|---|
| `jest-expo` | **57.0.4** | Expo 57's `bundledNativeModules.json` pins `~57.0.4`. 57.0.5 and later peer-require `@react-native/jest-preset ^0.86.3`, but RN is 0.86.2. |
| `@react-native/jest-preset` | **0.86.2** | Matches RN 0.86.2 exactly. This is the `jest-expo` 57.0.4 peer (`^0.86.2`). |
| `jest` | **29.7.0** | `jest-expo` 57 depends on the `^29` toolchain (`babel-jest`, `jest-environment-jsdom`, `@jest/globals`). Do **not** use Jest 30. |
| `@jest/globals` | **29.7.0** | Tests import `describe/test/expect/jest` explicitly. That avoids `@types/jest` ambient globals (TS 6 + `types` defaults). RNTL augments `@jest/expect`, so its matchers are typed. |
| `@testing-library/react-native` | **14.1.0** | Peers: `jest >=29`, `react >=19`, `react-native >=0.78`, `test-renderer ^1.0.0`. |
| `test-renderer` | **1.2.0** | **Not 1.3.x.** 1.3.x depends on `react-reconciler ~0.34`, which peers `react ^19.3` and gives an `ERESOLVE overriding peer dependency` warning against react 19.2.3. 1.2.0 uses `react-reconciler ~0.33`, which peers `react ^19.2`. With this pin, `npm install --dry-run` reports 0 ERESOLVE. |

- Lockfile change is purely additive: 252 new `packages` entries, 0 changed, 0 removed. The diff stat looks huge only because entries move.
- `npm audit`: distinct high/critical GHSAs stay at 8, the same set as before. More packages now *reach* those advisories (high: 26 → 57 packages), all via devDeps. The weekly audit issue bodies will list more paths. No new advisories.
- **RNTL 14 is async.** `render`, `fireEvent` and `userEvent` return promises and must be awaited. In the prototype, one un-awaited `fireEvent` caused "overlapping act() calls". After that, every later test in the file saw an empty tree. This plan therefore adds `@typescript-eslint/no-floating-promises` for `__tests__/` files. The planner confirmed the rule flags an un-awaited `fireEvent`.
- The `domain` Jest project has no RN preset. A domain test that imports `react-native` fails with `SyntaxError: Cannot use import statement outside a module`. That gives the purity rule a second, runtime guard alongside lint.
- The 28 tests run in about 2 s warm and about 10 s cold (`--no-cache`), inside the < 30 s budget in Test Strategy §2.

## 1. Decisions in this plan (made here; record them in the report)

1. **One runner for app code.** `npm test` = `jest`. Jest runs every `src/**/__tests__/**/*.test.ts(x)` and `app/**/__tests__/**`.
2. **Two Jest projects** in `jest.config.js`:
   - `domain`: `testEnvironment: 'node'`, plain babel-jest, no preset and no mocks. Roots are `src/domain` only (mobile-arch §1: "Runs in Node under Jest with zero mocks").
   - `app`: `preset: 'jest-expo'` (iOS platform by default; tests may set `Platform.OS`). Roots are `src` and `app`, and it ignores `src/domain/`.
3. **Migrated to Jest; the old scripts are deleted.**
   - `scripts/auth-domain-tests.mjs` moves to `src/domain/{validation,auth}/__tests__/*.test.ts`. Test names keep the `SPEC-001-T0x` IDs.
   - WP-04's `scripts/map-tests.mjs` and `scripts/map-tests/profiler.test.mjs` move to `src/features/map/lib/__tests__/profiler.test.ts`. Assertions are unchanged. The 3 untagged ring tests get `(SPEC-008-T41 tooling)`. The heap test gets `(NFR-09 tooling)`, because SPEC-008 §13 has no memory T-ID.
   - The `test:auth-domain` and `test:map` scripts are removed, along with their two `app.yml` steps.
4. **These stay on `node:test`:**
   - `scripts/doc-gates.test.mjs` and `scripts/dependency-audit.test.mjs`. They test repo tooling, not app code.
   - The doc-gates test runs in `app.yml` **before** `npm ci`.
5. **New RNTL tests** (SCRUM-64 AC3: "at least auth screen and MapCanvas-stub tests"):
   - `SignInScreen` covers the component slice of SPEC-001-T01: Apple is above Google on iOS (native button) and on Android (fallback), and the email path is present. Full T01 stays a Maestro flow.
   - `MapCanvas`, with `@maplibre/maplibre-react-native` replaced by host-View stubs (mobile-arch §4.1, "testable without a map"):
     - SPEC-008-T04: the gesture/programmatic camera-change normalisation slice.
     - SPEC-008-T68: the **R70 half only** — `cluster={false}` on the spot source. The R69 property-list half is **not asserted**, because SCRUM-31 (the R69 property list) is a pending decision.
     - SPEC-008-T69: the component slice — MapCanvas mounts `OsmAttribution` itself.
6. **SPEC-001-T05 is strengthened, not changed.** It adds the spec's own "11-character password rejected" case. The old test passed with `PASSWORD_MIN_LENGTH = 11`; the planner proved that. T05's "200-character accepted" contradicts R06/N18 (reject above 128). It is **reported, not resolved** (see §7). The test keeps asserting 129 → `too_long`, as the code and R06/N18 say.

## 2. Executor setup — **do not symlink node_modules**

The other packages' worktrees symlink `node_modules` to `/home/claude/sharecropr/node_modules`. **This one must not.**
`npm install` would otherwise rewrite the main clone's `node_modules`.

```bash
cd /home/claude/sharecropr && git fetch -q origin
git worktree add -b wp/WP-02b /home/claude/wt/WP-02b origin/develop
cd /home/claude/wt/WP-02b
test ! -e node_modules            # must be absent; if it is a symlink: rm node_modules (the link only)
npm ci --no-audit --no-fund
```

**Precondition check:**

```bash
test -f scripts/map-tests/profiler.test.mjs && test -f scripts/auth-domain-tests.mjs && echo OK
```

- If `scripts/map-tests/` now contains **other** `*.test.mjs` files (WP-05 landed a `follow-mode.test.mjs`), migrate each one the same way as in §3 Step 3. They become `src/features/map/lib/__tests__/<name>.test.ts`: swap `node:assert` for `expect`, use `@/` imports with no `.ts` suffix, type the helper params, and keep the test names.
- If WP-05 is **in flight** (it has a worktree but has not landed), stop and report. WP-05's plan writes node:test files into `scripts/map-tests/` and would collide.

## 3. Steps

Prepared files are at `/tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/work/plans/WP-02b-files/`
(below, `$F`).

### Step 1 — dependencies (exact pins)

```bash
npm install --save-dev --save-exact \
  jest@29.7.0 jest-expo@57.0.4 @react-native/jest-preset@0.86.2 @jest/globals@29.7.0 \
  @testing-library/react-native@14.1.0 test-renderer@1.2.0 --no-audit --no-fund
npm install --dry-run 2>&1 | grep -c ERESOLVE    # expect 0
```

Expected `package.json` `devDependencies` additions:
`"@jest/globals": "29.7.0"`, `"@react-native/jest-preset": "0.86.2"`, `"@testing-library/react-native": "14.1.0"`, `"jest": "29.7.0"`, `"jest-expo": "57.0.4"` and `"test-renderer": "1.2.0"`.
`dependencies` must be unchanged. Do **not** add `@types/jest`.

### Step 2 — red first (TDD): add config and tests before touching scripts

Copy the prepared files verbatim, keeping their relative paths:

```bash
F=/tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/work/plans/WP-02b-files
(cd $F && find . -type f ! -name apply-edits.py) | while read f; do mkdir -p "$(dirname "$f")"; cp "$F/$f" "$f"; done
```

That creates:

| File | Content |
|---|---|
| `jest.config.js` | two projects (`domain`, `app`), as in §1.2 |
| `src/domain/validation/__tests__/email.test.ts` | SPEC-001-T03 |
| `src/domain/validation/__tests__/password.test.ts` | SPEC-001-T05 (+ the 11-char case, + a comment on the T05/R06 spec conflict) |
| `src/domain/auth/__tests__/hibp.test.ts` | SPEC-001-T06 ×3, T07 ×2. Same 5 cases as the `.mjs`; `fetch`/`crypto` are restored in `afterEach` |
| `src/features/auth/screens/__tests__/SignInScreen.test.tsx` | SPEC-001-T01 component slice ×2 (iOS native Apple button above Google; Android fallback above Google) |
| `src/features/map/components/__tests__/MapCanvas.test.tsx` | SPEC-008-T04 slice, T68 (R70 half), T69 slice; MapLibre stubbed via `jest.mock` |
| `src/features/map/lib/__tests__/profiler.test.ts` | 16 tests migrated from `scripts/map-tests/profiler.test.mjs` |

Run `npx jest --ci`. Expected: 6 suites, **28 passed**. These tests characterise existing code, so they are green at once. Prove each new suite can fail, record the red output, then revert each mutation:

| Mutation (revert after) | Expected red |
|---|---|
| `src/domain/validation/password.ts`: `PASSWORD_MIN_LENGTH = 12` → `11` | `password length rules (SPEC-001-T05)` fails |
| `src/features/map/components/MapCanvas.tsx`: `cluster={false}` → `cluster={true}` | `... renderer clustering off (SPEC-008-T68)` fails |
| `src/features/auth/components/ProviderButtons.tsx`: move the Google `<Pressable>` above the Apple conditional | both `(SPEC-001-T01)` tests fail |
| `src/features/map/components/MapCanvas.tsx` `handleRegionDidChange`: pass `!userInteraction` | `(SPEC-008-T04)` fails |

Then `git diff --stat -- src/domain/validation/password.ts src/features` must show **only** `fpsSummary.ts`, after Step 4. Before Step 4 it must show nothing.

### Step 3 — retire the node:test app-code scripts

```bash
git rm -q scripts/auth-domain-tests.mjs scripts/map-tests.mjs scripts/map-tests/profiler.test.mjs
```

Also `git rm` any WP-05 `scripts/map-tests/*.test.mjs` you migrated per §2.

### Step 4 — scripted text edits (package.json scripts, eslint, app.yml, docs, AGENTS, README, one comment)

Run this **after** Step 1, because it re-reads `package.json`:

```bash
python3 -I $F/apply-edits.py      # aborts without writing if any anchor is not found exactly once
```

What it does (exact strings are in the script):

| File | Change |
|---|---|
| `package.json` `scripts` | `"test:auth-domain"` becomes `"test": "jest"` (same position); `"test:map"` is removed |
| `eslint.config.js` | appends block **6**: `files: ['src/**/__tests__/**/*.{ts,tsx}', 'app/**/__tests__/**/*.{ts,tsx}']` → `'@typescript-eslint/no-floating-promises': 'error'`. It does not touch `no-restricted-imports`, so WP-03's one-entry-per-glob rule is respected |
| `.github/workflows/app.yml` | step `Unit — auth domain` becomes `Unit + component — Jest (src/domain, src/features, app)` running `npm test -- --ci`; step `Unit — map` is deleted; `Unit — dependency audit script` stays |
| `src/features/map/lib/fpsSummary.ts` | header comment no longer says scripts/map-tests/strip-types loads it |
| `docs/04-testing/01-test-strategy.md` | v1.1.0. §2 table: Unit → "Jest (`jest-expo`) + React Native Testing Library", Integration → "Jest + Supabase CLI". New "One JavaScript test runner: Jest" paragraph covering the two projects, the `__tests__/` location, namespaced IDs and await-RNTL. New "Not Jest, deliberately" paragraph: Maestro, pgTAP, Deno, `scripts/` node:test. §3 notes the RN-free `domain` project. §7 LP-08 Vitest → Jest. Change-log row added |
| `docs/05-operations/02-cicd.md` | v1.0.2; §2 `unit` row Partial → **Running** (`npm test`); change-log row added |
| `README.md` | drops the strip-types sentence; the quick command uses `npm test` |
| `AGENTS.md` | §4 "CI today" bullet names `npm test`; the Commands row becomes `Unit + component … npm test`; one §7 durable-fact line (SCRUM-64 runner, two projects, await RNTL, scripts/ on node:test) |

Docs already consistent with Jest (verified; no edit needed):
- `02-mobile-architecture.md` §1 ("Runs in Node under Jest with zero mocks") and §4.1 ("Jest renders MapCanvas as a stub")
- ADR-0015 scope ("React Native Testing Library … Jest against src/domain")
- `04-location-privacy.md` LP-08 (Jest)
- `06-api-contract.md` API-07 (Jest)

After Step 4, `grep -rni vitest docs AGENTS.md README.md` must match only the two change-log/history lines.

### Step 5 — commit message file (do not commit)

Write `/home/claude/wt/WP-02b/.wp-commit-msg`:

```
test: adopt Jest (jest-expo) + React Native Testing Library as the one unit runner

Implements Corey's SCRUM-64 decision: Jest + RNTL for unit and component tests,
Maestro stays for E2E. npm test runs Jest; app.yml runs it on every push and PR.

- jest.config.js: "domain" project runs src/domain in plain Node with no React
  Native preset (mobile-architecture §1); "app" project runs everything else
  under jest-expo 57.0.4. Pins: jest 29.7.0, @react-native/jest-preset 0.86.2,
  @testing-library/react-native 14.1.0, test-renderer 1.2.0 (1.3.x needs react 19.3).
- Migrated scripts/auth-domain-tests.mjs (SPEC-001-T03/T05/T06/T07) and WP-04's
  scripts/map-tests profiler suite (SPEC-008-T41/T72 tooling) to Jest; removed
  test:auth-domain, test:map and their app.yml steps. scripts/ tooling tests
  (doc-gates, dependency-audit) stay on node:test.
- New RNTL tests: SignInScreen provider order (SPEC-001-T01 component slice);
  MapCanvas with MapLibre stubbed: gesture normalisation (SPEC-008-T04 slice),
  source clustering off (SPEC-008-T68, R70 half only — R69 waits on SCRUM-31),
  attribution mounted by the seam (SPEC-008-T69 slice).
- SPEC-001-T05 gains the spec's 11-character case (the old test passed with a
  minimum of 11).
- Lint: no-floating-promises in __tests__ (RNTL 14 render/fireEvent are async).
- Docs: Test Strategy §2/§3/§7 name Jest (LP-08 Vitest -> Jest); CI/CD §2 unit
  is Running; README and AGENTS.md commands use npm test.

SCRUM-64
SCRUM-11 (SCR-0002 AC2: a unit runner covers src/domain and src/features)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UF2euBNrCbk64CByxEndVj
```

## 4. Verification (run all in `/home/claude/wt/WP-02b`, report output)

| Command | Expected |
|---|---|
| `npm install --dry-run 2>&1 \| grep -c ERESOLVE` | `0` |
| `npm test -- --ci` | 2 projects, **6 suites, 28 tests passed**, exit 0 |
| `npx jest --ci --selectProjects domain` | 3 suites (email, password, hibp), 7 tests |
| `npx jest --ci --selectProjects app` | 3 suites (SignInScreen 2, MapCanvas 3, profiler 16), 21 tests, no `console.error` (`… 2>&1 \| grep -c "console.error"` → 0) |
| `npx jest --ci --no-cache` | passes in under 30 s (planner: about 10 s) |
| `npm run lint` | exit 0 |
| `npm run lint:fixtures` | `48/48 lint fixtures behaved as expected.` |
| `npm run typecheck` | exit 0 |
| `npm run test:doc-gates && npm run ci:doc-gates` | pass; `doc-gates: OK — 18 specs, 33 schema edges, acyclic; register in sync` |
| `npm run test:dependency-audit` | pass |
| `./scripts/agent-memory-bridge.sh check` | `bridge intact` |
| `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/app.yml'))"` | no error |
| floating-promise guard: temporarily remove one `await` before `fireEvent` in `MapCanvas.test.tsx`; `npm run lint` | `no-floating-promises` error at that line; then restore |
| domain purity at runtime: temporarily add `src/domain/validation/__tests__/zz.test.ts` importing `{ Platform } from 'react-native'`; `npx jest --selectProjects domain` | that suite FAILS (`SyntaxError: Cannot use import statement outside a module`); then delete the file |
| the 4 red mutations in Step 2 | each fails as listed; all reverted |
| `grep -rn "test:auth-domain\|test:map\|map-tests\|auth-domain-tests" --exclude-dir=node_modules --exclude=package-lock.json .` | only the change-log row in `02-cicd.md` and the "Migrated from scripts/map-tests/…" comment in `profiler.test.ts` |
| `git status --short` | M: `.github/workflows/app.yml`, `AGENTS.md`, `README.md`, `docs/04-testing/01-test-strategy.md`, `docs/05-operations/02-cicd.md`, `eslint.config.js`, `package.json`, `package-lock.json`, `src/features/map/lib/fpsSummary.ts`. D: the 3 scripts. New: `jest.config.js` + 6 test files. Nothing else. `node_modules` is ignored, and is a real directory, not a symlink |

After pushing, the integrator checks GitHub: the `app.yml` run on develop shows the step `Unit + component — Jest …` green.

## 5. Acceptance-criteria mapping

| Ticket / AC | Status after WP-02b | Evidence |
|---|---|---|
| SCRUM-64 AC1 "One unit runner is chosen and every doc names it consistently" | **Done** | Test Strategy §2/§7 now say Jest. Mobile-arch, ADR-0015, LP-08 and API-07 already did. `grep -i vitest` finds only history rows |
| SCRUM-64 AC2 "src/domain tests run under it in app.yml" | **Done** | `domain` Jest project; `app.yml` step `npm test -- --ci` |
| SCRUM-64 AC3 "RNTL is installed with at least auth screen and MapCanvas-stub tests" | **Done** | `SignInScreen.test.tsx`, `MapCanvas.test.tsx` |
| SCRUM-64 AC4 "Test names carry namespaced IDs (SPEC-NNN-TNN)" | **Done** | Every Jest test name has a `SPEC-001-Txx`, `SPEC-008-Txx` or `NFR-09` tag. The heap test uses NFR-09 because SPEC-008 §13 has no memory T-ID |
| SCRUM-11 AC2 "A unit test runner covers all of src/domain and src/features (not only auth)" | **Done** (runner) | Jest roots `src` + `app`; `testMatch` covers every `__tests__/` under them; CI runs it. Coverage is still thin; per-feature tests arrive with their packages |
| SCRUM-11 AC1 "Branch protection on main/develop requires the app workflow" | **Open** — Corey, GitHub settings | not code |
| SCRUM-11 AC3 CODEOWNERS | Done earlier (WP-02, `f3a1505`) | — |

Jira summaries for the integrator:
- **SCRUM-64 → Done:** "Done — pushed to develop in <sha>: Jest (jest-expo 57.0.4) + RNTL 14 adopted. npm test runs src/domain (RN-free project) and src/features/app in app.yml. Auth-domain and map node:test suites migrated. SignInScreen + MapCanvas-stub RNTL tests added. Test Strategy/CI-CD/README/AGENTS name Jest."
- **SCRUM-11 → stays In Progress:** "Partial — pushed to develop in <sha>: unit runner (Jest) now covers src/domain and src/features in app.yml (AC2). Open: branch protection on main/develop requiring the app workflow (Corey, GitHub settings)."

## 6. Coordination — integrator and orchestrator **must** read this

1. **Refresh the main clone's node_modules after this lands.**
   - Later worktrees symlink `/home/claude/sharecropr/node_modules`.
   - `tsc` includes `__tests__/*.ts(x)`, which import `@jest/globals` and `@testing-library/react-native`. So once the main clone is fast-forwarded past this commit, `npm run typecheck` fails in every later worktree until `npm ci` has run there.
   - Integrator step 7: after `git merge --ff-only origin/develop`, run `cd /home/claude/sharecropr && npm ci --no-audit --no-fund`.
2. **INTEGRATE.md step 4** ("node_modules is a symlink; don't install") does not apply to this worktree. Its `node_modules` is real and already has the new deps.
3. **Rebase conflicts.** A package that lands between now and integration and touches `package.json` scripts near `test:auth-domain`/`test:map`, or `app.yml` unit steps, will conflict. Resolve as follows:
   - **No** `test:auth-domain` or `test:map` script.
   - `"test": "jest"` where `test:auth-domain` was.
   - One `Unit + component — Jest` step with `npm test -- --ci`.
   - **Keep** any new step or script the other package added, unless it runs node:test over `src/`. If it does, abort and report.
   - In `eslint.config.js`, block 6 is append-only. If the tail conflicts, keep the other side and re-append block 6 before the closing `);`.
4. **Update BRIEF.md.** The line "Until SCRUM-64 is decided, new JS tests use the existing node:test style" is superseded. New tests for `src/**` go in `__tests__/*.test.ts(x)` under Jest. Import from `@jest/globals`, await RNTL calls, and use namespaced IDs in test names. `scripts/*` tooling stays on node:test.
5. **WP-05** (queue `verify: node --experimental-strip-types scripts/map-tests.mjs`) must be re-planned to Jest. Its tests become `src/features/map/lib/__tests__/followMode.test.ts`, and it adds no `scripts/map-tests*`. Its verify line becomes `npm test`. If its plan is already written, amend it before execution.
6. **Unblocked by this package:**
   - WP-07 (T70/T77 geometric attribution tests "after the runner")
   - WP-40 ("RNTL a11y queries after WP-02b")
   - WP-04's follow-up note ("unit-tested milestone logic"), whose tests are now in Jest

   Those packages should copy the MapLibre stub from `MapCanvas.test.tsx`. Promoting it to a shared `__mocks__` file is a reasonable later refactor, not done here.
7. **Changes to MapCanvas.** The MapCanvas test relies only on these stable props:
   - `testID="map.canvas"`
   - `<Map onRegionDidChange>` with `nativeEvent { center, zoom, userInteraction }`
   - `<GeoJSONSource id="spots" cluster={false}>`
   - `OsmAttribution`'s `testID="map.attribution"`

   If WP-05 changes how gestures are reported (e.g. a gesture-start event), update the T04 test in WP-05, not here.

## 7. Findings for the report (out of scope, not fixed)

- **SPEC-001 internal conflict:** T05 says "200-character accepted"; R06 ("no maximum below 128") and N18 ("Rejected at 128 characters") imply rejection above 128, which is what the code does. Needs a spec-owner decision; the test follows the code/R06 and says so in a comment.
- **SPEC-001 §13 has no T-IDs** for the §8 states (offline banner, wrong-credentials copy), so they have no component tests yet. Adding tests without IDs would break the traceability rule.
- SPEC-008 §13 has no memory T-ID (NFR-09 is used as the tag).
- `npm audit` package count rises because of devDeps (no new GHSA). This affects `dependency-audit.yml` issue bodies only.
- Jest 29 is in maintenance. Moving to Jest 30 waits for a `jest-expo` that depends on it (58.x is still on 29 deps).

## 8. What remains after WP-02b

- SCRUM-11 AC1: branch protection (Corey).
- Component tests for the other 7 auth screens and the map hooks arrive with their feature packages (WP-05, WP-07, WP-40, …).
- `spec-traceability` CI gate (N-07) still planned. Test-name IDs are checked by hand until it exists.
