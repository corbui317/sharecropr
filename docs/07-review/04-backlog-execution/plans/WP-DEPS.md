# WP-DEPS: Clear npm audit findings on `develop` without an SDK, RN, Jest-major or MapLibre upgrade

Planner: Opus · Executor: Sonnet (own worktree from `origin/develop`, do NOT commit) · Integrator: Haiku · Class: do
Repo: `/Users/cxb317/Documents/ai/sharecropr`. Planned against `origin/develop` at `964b471`. `main` is `8a05adc`, and its `package.json` and `package-lock.json` are byte-identical to develop's. Node 22.23, npm 10.9.

**Files the executor may change (only these):**
- `package-lock.json`
- `docs/05-operations/06-dependency-risk-register.md` (new)
- `docs/05-operations/02-cicd.md`
- `docs/README.md`
- `.wp-commit-msg`

`package.json` should come out **unchanged**, because the plan needs no `overrides` entry (see §1). Nothing goes in `src/`, `app/`, `supabase/` or `AGENTS.md`, because WP-AUTH-FIX is working there in parallel.

## 0. Context verified

**Audit baseline** (`npm audit --package-lock-only --json` on develop):
- Totals: `{"moderate":10,"high":57,"critical":1,"total":68}`.
- Only **10 packages carry an advisory directly**, adding up to **12 (package, GHSA) pairs**. The other 58 entries are inherited through `via` chains (expo, react-native, metro*, jest*, RNTL, maplibre, reanimated, worklets, patch-package and so on).
- Every `fixAvailable` on those inherited entries is a semver-major *downgrade*: expo@44, react-native@0.72, jest@30, jest-expo@58, RNTL@13, maplibre@11.3.2, reanimated@4.2.2, patch-package@6.0.7. **Never run `npm audit fix` or `npm audit fix --force`.**

**Dependabot alerts** (`gh api repos/corbui317/sharecropr/dependabot/alerts`): alerts 1–14 are open, except 5 and 7, which were auto-dismissed. They give the GHSA ids and first patched versions used below.

**Dependabot PR mapping** (`gh pr view`):

| PR | Title | Base | Disposition |
|---|---|---|---|
| #2 | Bump decode-uri-component and expo-router (57.0.15 → **58.0.25**) | main | **Reject.** expo-router 58 means Expo SDK 58. |
| #3 | js-yaml 4.3.1 → 4.3.2 | main | Superseded by this WP |
| #4 | brace-expansion 5.0.9 → 5.0.12 | main | Superseded |
| #5 | compression 1.8.1 → 1.8.2 | main | Superseded |
| #6 | uuid + @expo/config-plugins 57.0.8 → 57.0.11 | main | Superseded |
| #7 | source-map-js 1.2.1 → 1.2.2 | main | Superseded |
| #8 | shell-quote 1.10.0 → 1.12.0 | main | Superseded |

Dependabot *security* PRs always target the default branch, which is `main`. They ignore `target-branch: develop` in `.github/dependabot.yml`.

**`.github/workflows/dependency-audit.yml`:**
- It runs `npm audit --package-lock-only --audit-level=high --json` with **no `--omit=dev`**.
- `scripts/dependency-audit.mjs` opens one issue per **high or critical** GHSA (labels `security`, `dependency-audit`, `needs-triage`). Moderates get no issue.
- It **auto-closes** an issue when the GHSA is no longer reported, **reopens** a closed issue that is still reported, and **leaves alone** a closed issue labelled `wontfix`.
- `PATCH_SLA_DAYS = 7` (NFR-54).
- Issues open now: #9 shell-quote (critical), #10 js-yaml, #11 source-map-js, #12, #14 brace-expansion, #13 node-forge, #16 compression, #17 braces.
- The schedule runs on the **default branch (main)**.

**Doc locations:**
- No dependency or security-exceptions doc exists yet.
- Dependency audit appears only in `docs/05-operations/02-cicd.md`: §4 row at `:133` and §9 row at `:292`. The current version is 1.0.2 (`:3`) and the change log ends at `:353`.
- Index: `docs/README.md:84-90` (05 — Operations table).
- `scripts/doc-gates.mjs` only parses `docs/03-specs/SPEC-*.md`. Run it anyway.

**`npx expo install --check` already fails on develop:**
- Online, it exits 1 and lists 13 SDK-57 patch drifts.
- Offline (`EXPO_OFFLINE=1`), it exits 0.
- Gate for this WP: the offline check stays exit 0, and the online output is **identical** before and after.

**Planner dry run.** `npm update shell-quote source-map-js brace-expansion compression js-yaml @expo/config-plugins @expo/metro-file-map --dry-run` reports exactly these changes:
- brace-expansion 5.0.9→5.0.12 (×3 nested copies) and 1.1.18→1.1.21
- @expo/config-plugins 57.0.8→57.0.11
- @expo/require-utils 57.0.4→57.0.6
- xcode 3.0.1→4.0.0
- **remove** uuid 7.0.3
- @expo/metro-file-map 57.0.1→57.0.4
- source-map-js 1.2.1→1.2.2
- shell-quote 1.10.0→1.12.0
- js-yaml 4.3.1→4.3.2
- compression 1.8.1→1.8.2

`add lightningcss-*` lines in that dry run are an artefact of the main clone's darwin-only `node_modules`, and must not appear in the real lockfile diff. Do not plan from the main clone's `node_modules`; it also contains Finder duplicate `* 2.js` files.

## 1. Leaf map and classification

| # | Leaf @ installed | GHSA (sev) | First patched | Path to top level | Parent's range | Class | Ships in app bundle? |
|---|---|---|---|---|---|---|---|
| 1 | shell-quote@1.10.0 | GHSA-pqg4-j6r4-53mv (**critical**) | 1.11.0 | react-devtools-core@6.1.5 ← react-native | `^1.6.1` | **(a)** → 1.12.0 | No |
| 2 | source-map-js@1.2.1 | GHSA-68fv-2mgg-jv7q (high) | 1.2.2 | postcss ← @expo/metro-config ← expo | `^1.2.1` | **(a)** → 1.2.2 | No |
| 3 | compression@1.8.1 | GHSA-vc2v-76pw-4v95 (high) | 1.8.2 | @expo/cli ← expo | `^1.7.4` | **(a)** → 1.8.2 | No (dev server) |
| 4 | js-yaml@4.3.1 | GHSA-2883-xcg3-v3hh (high) | 4.3.2 | @eslint/eslintrc; @expo/xcpretty | `^4.3.0`, `^4.1.0` | **(a)** → 4.3.2 | No |
| 5 | brace-expansion@5.0.9 (×3) | GHSA-q2hr-2g5m-vwhr, -qhr7-859c-m2p7, -6j4f-fj2g-mc7p | 5.0.12 | minimatch@10 | `^5.0.8` | **(a)** → 5.0.12 | No |
| 6 | brace-expansion@1.1.18 | GHSA-q2hr (mod) | 1.1.21 | minimatch@3 ← eslint, jest | `^1.1.7` | **(a)** → 1.1.21 | No (dev) |
| 7 | uuid@7.0.3 (`xcode/node_modules/uuid`) | GHSA-w5hq-g745-h8pq (mod) | 11.1.1 | xcode@3.0.1 ← @expo/config-plugins@57.0.8 | none in range | **(a)** via parent: config-plugins 57.0.11 → xcode ^4.0.0 (no uuid) | No |
| 8 | @expo/metro-file-map@57.0.1 | inherited (micromatch→braces) | n/a | @expo/cli | `^57.0.1` | **(a)** → 57.0.4 (drops micromatch) | No |
| 9 | braces@3.0.3 | GHSA-vfj7-8cjw-p6xm (high) | **none** | micromatch ← metro-file-map, jest, find-yarn-workspace-root | `^3.0.3` | **(c) no upstream fix** | No |
| 10 | node-forge@1.4.0 | GHSA-86w9-cpqp-85rv (high) | **none** | @expo/cli, @expo/code-signing-certificates | `^1.3.3` | **(c) no upstream fix** | No |
| 11 | decode-uri-component@0.2.2 | GHSA-vcc3-ghjq-m6fr (mod) | 0.5.0 | query-string@7.1.3 ← expo-router@57.0.15 | `^0.2.2` | **(c) needs SDK 58.** An override is unsafe: 0.5.0 is ESM-only and query-string 7 `require()`s it | **YES** (deep-link parsing) |
| 12 | sprintf-js@1.0.3 | GHSA-hp3w-g68c-fv3c (mod) | **none** | argparse@1.0.10 ← js-yaml@3 ← istanbul ← Jest | `~1.0.2` | **(c) no upstream fix**, dev only | No |

**Class (b) is empty.** Do **not** add an `overrides` block.

**Predicted after-state:** the 12 (package, GHSA) pairs drop to 4 (braces high, node-forge high, decode-uri-component moderate, sprintf-js moderate), and critical goes to 0. Record whatever totals npm reports; the gate is the advisory list in §3.

## 2. Steps

Skills to load: `security-and-hardening`, `incremental-implementation`, `documentation-and-adrs`.

### Step 0: Worktree and baseline
Set `S=$TMPDIR/wp-deps` and `mkdir -p "$S"`.

```bash
npm ci
npm audit --json > "$S/audit-before.json"; echo "audit exit=$?"
CI=1 npx expo install --check > "$S/expo-check-before.txt" 2>&1; echo "online exit=$?"     # expect 1, 13 drifts
EXPO_OFFLINE=1 CI=1 npx expo install --check; echo "offline exit=$?"                         # expect 0
npm audit --audit-level=critical; echo "critical gate exit=$?"                               # expect 1 (red check)
```

Advisory summary:

```bash
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(JSON.stringify(r.metadata.vulnerabilities));const g=new Set();for(const v of Object.values(r.vulnerabilities))for(const a of v.via)if(typeof a==="object")g.add(a.severity+" "+a.name+" "+a.url.split("/").pop());console.log([...g].sort().join("\n"))' "$S/audit-before.json"
```

### Step 1: Re-check that "no fix" still holds
Run `npm view braces version; npm view node-forge version; npm view sprintf-js version; npm view @expo/code-signing-certificates version; npm view expo-router@57 dependencies.query-string`.
- Expected: `3.0.3`, `1.4.0`, `1.1.3`, `0.0.7`, and `^7.1.3` for every 57.x.
- If a newer braces, node-forge or sprintf-js exists, **stop and report**.

### Step 2: In-range lockfile refresh

```bash
npm update shell-quote source-map-js brace-expansion compression js-yaml @expo/config-plugins @expo/metro-file-map
```

`postinstall` runs `patch-package`; `patches/expo-modules-jsi+57.0.5.patch` must still apply.

### Step 3: Diff guard (stop if it fails)

```bash
git diff --exit-code package.json && echo "package.json unchanged"
node -e 'const {execSync}=require("child_process");const a=JSON.parse(execSync("git show HEAD:package-lock.json",{maxBuffer:1e9})).packages,b=require("./package-lock.json").packages;for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){const x=a[k]?.version,y=b[k]?.version;if(x!==y)console.log(k,x??"(new)","->",y??"(removed)")}'
```

Expect exactly these 13 lines, in any order:

```
node_modules/@expo/config-plugins 57.0.8 -> 57.0.11
node_modules/@expo/fingerprint/node_modules/brace-expansion 5.0.9 -> 5.0.12
node_modules/@expo/metro-file-map 57.0.1 -> 57.0.4
node_modules/@expo/require-utils 57.0.4 -> 57.0.6
node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion 5.0.9 -> 5.0.12
node_modules/brace-expansion 1.1.18 -> 1.1.21
node_modules/compression 1.8.1 -> 1.8.2
node_modules/glob/node_modules/brace-expansion 5.0.9 -> 5.0.12
node_modules/js-yaml 4.3.1 -> 4.3.2
node_modules/shell-quote 1.10.0 -> 1.12.0
node_modules/source-map-js 1.2.1 -> 1.2.2
node_modules/xcode 3.0.1 -> 4.0.0
node_modules/xcode/node_modules/uuid 7.0.3 -> (removed)
```

- A few extra *new* transitive entries from config-plugins 57.0.11 or metro-file-map 57.0.4 are acceptable. **List every one in your report.**
- **Hard stop, run `git checkout package-lock.json`, and report** if:
  - any key for a `package.json` dependency changes, or
  - any `metro*`, `@expo/cli`, `@expo/metro*` or `lightningcss*` entry changes.

### Step 4: Clean install
Run `rm -rf node_modules && npm ci`. It must exit 0, and patch-package must apply the expo-modules-jsi patch.

### Step 5: Prebuild smoke for xcode 3 → 4
- Run `npx expo prebuild --no-install --platform all`. It must exit 0.
- `ios/` and `android/` are gitignored, so `git status --porcelain` must show only the expected files.
- If prebuild touched `package.json` or `app.config.ts`, report the diff and then `git checkout -- package.json app.config.ts`.
- Delete `ios/` and `android/` afterwards.

### Step 6: Docs

**6a. NEW `docs/05-operations/06-dependency-risk-register.md`**

Header:

```
# Dependency Risk Register

**Status:** Draft — pending owner acceptance · **Version:** 0.1.0 · **Owner:** Platform Engineering
```

Sections:
1. **Purpose.** NFR-54 requires high and critical CVEs patched within 7 days. This register lists every advisory we cannot patch without an Expo SDK, RN, Jest-major or MapLibre upgrade (deliberate projects per the `.github/dependabot.yml` ignore rules and ADR-0019), with its reason and exit condition. An entry counts as accepted only once "Accepted by" is filled by the product owner; until then it is a *proposed* exception.
2. **Rules.**
   - Never `npm audit fix --force`: every major `fixAvailable` on this tree is a downgrade.
   - Prefer an in-range `npm update <leaf>`.
   - Use `overrides` only when the patched version is API-compatible with the parent's require/import.
   - Re-check entries on every SDK upgrade and at the review date.
   - "Ships in app bundle" means reachable from the Metro production bundle, not Dependabot's runtime scope.
3. **Register table**, columns: `ID | Advisory | Package@version | Severity | Path | Ships in app bundle? | Why not fixed | Exit condition | Tracking | Review by | Accepted by`
   - **DR-01** | GHSA-vfj7-8cjw-p6xm | braces@3.0.3 | high | micromatch@4.0.8 ← metro-file-map 0.84.5 (← @expo/metro ← expo), Jest 29 internals, find-yarn-workspace-root (← patch-package 8) | No. Bundler, test runner and postinstall only; glob patterns come from repo config. | No patched braces exists (3.0.3 is latest) | braces > 3.0.3, then `npm update braces` | issue #17 | 2027-01-22 | _pending_
   - **DR-02** | GHSA-86w9-cpqp-85rv | node-forge@1.4.0 | high | @expo/cli 57.0.17; @expo/code-signing-certificates 0.0.6 | No. CLI code-signing and dev-cert tooling; no expo-updates in the app. | No patched node-forge exists (1.4.0 is latest) | node-forge > 1.4.0, or @expo/cli dropping it | issue #13 | 2027-01-22 | _pending_
   - **DR-03** | GHSA-vcc3-ghjq-m6fr | decode-uri-component@0.2.2 | moderate | query-string@7.1.3 ← expo-router 57.0.15 | **Yes.** expo-router parses every incoming deep link. A crafted link with malformed percent-encoding can stall the JS thread (self-DoS); no data exposure; location invariants unaffected. | The fix (0.5.0) is ESM-only, and query-string 7 `require()`s it, so an override breaks linking. | Expo SDK 58 (expo-router ≥ 58.0.13) | Dependabot alert #2 | SDK 58 or 2027-01-22 | _pending_
   - **DR-04** | GHSA-hp3w-g68c-fv3c | sprintf-js@1.0.3 | moderate | argparse@1.0.10 ← js-yaml@3.15.2 ← @istanbuljs/load-nyc-config ← babel-plugin-istanbul ← Jest 29 | No (dev only) | No patched sprintf-js exists | A sprintf-js fix, or a Jest major that drops babel-plugin-istanbul 6 | none | 2027-01-22 | _pending_
4. **Inherited entries.** The roughly 56 other audit entries carry no advisory of their own; they are flagged because they depend on DR-01…DR-04. Their `fixAvailable` majors are downgrades. Ignore them.
5. **Resolved in-range (2026-10-22, WP-DEPS commit `<sha>`):**
   - shell-quote → 1.12.0 (GHSA-pqg4-j6r4-53mv)
   - source-map-js → 1.2.2 (GHSA-68fv-2mgg-jv7q)
   - compression → 1.8.2 (GHSA-vc2v-76pw-4v95)
   - js-yaml → 4.3.2 (GHSA-2883-xcg3-v3hh)
   - brace-expansion → 1.1.21 / 5.0.12 (GHSA-q2hr-2g5m-vwhr, -qhr7-859c-m2p7, -6j4f-fj2g-mc7p)
   - uuid removed via @expo/config-plugins 57.0.11 (GHSA-w5hq-g745-h8pq)
   - @expo/metro-file-map → 57.0.4
6. **How to re-run.** The advisory-summary one-liner from §2 Step 0, and "`npm audit --audit-level=critical` must exit 0 on develop."
7. **Change log:** `| 2026-10-22 | 0.1.0 | Platform Engineering | Initial register: DR-01…DR-04 proposed after the WP-DEPS in-range refresh |`

The executor writes `<sha>` literally; the integrator replaces it.

**6b. EDIT `docs/05-operations/02-cicd.md`**
- `:3`: change version 1.0.2 to 1.0.3.
- `:133` §4 row: append to "What it catches": ` — residual, unfixable-in-SDK advisories live in the [Dependency Risk Register](06-dependency-risk-register.md)`.
- `:292` §9 row: append to Purpose: `. Advisories we cannot patch without an SDK/major upgrade are listed in the [Dependency Risk Register](06-dependency-risk-register.md); an accepted one is labelled \`wontfix\` so the job stops reopening it`.
- Change log after `:353`: `| 2026-10-22 | 1.0.3 | Platform Engineering | §4 and §9 link the new Dependency Risk Register (WP-DEPS): in-range lockfile refresh cleared 8 of 12 advisories including the critical; 4 with no in-SDK-57 fix are recorded there pending acceptance |`

**6c. EDIT `docs/README.md`.** After `:90` add:
`| [06 Dependency Risk Register](05-operations/06-dependency-risk-register.md) | npm audit advisories we cannot patch in-SDK: reason, exposure, exit condition |`

**6d.** Write the §5 commit message to `.wp-commit-msg`. Do not commit.

## 3. Verification

| # | Command | Expected |
|---|---|---|
| 1 | `rm -rf node_modules && npm ci` | Exit 0; patch-package applies |
| 2 | `npm test -- --ci` | Green, same counts as develop |
| 3 | `npm run lint` | 0 errors, 0 warnings |
| 4 | `npm run lint:fixtures` | All pass, same N as develop |
| 5 | `npm run typecheck` | Exit 0 |
| 6 | `npm run ci:validate-map-style` | Exit 0 |
| 7 | `npm run ci:doc-gates` and `npm run test:doc-gates` | Exit 0 |
| 8 | `npm run test:dependency-audit` | Exit 0 |
| 9 | `./scripts/agent-memory-bridge.sh check` | Intact |
| 10 | `EXPO_OFFLINE=1 CI=1 npx expo install --check` | Exit 0 |
| 11 | Online `expo install --check`, diffed before vs after | No diff |
| 12 | `npm audit --json`, then the summary one-liner | Exactly braces, node-forge, decode-uri-component and sprintf-js; critical 0. Report before and after totals. |
| 13 | `npm audit --audit-level=critical; echo $?` | `0` (it was `1` before Step 2) |
| 14 | `npm ls shell-quote source-map-js compression js-yaml brace-expansion uuid xcode @expo/config-plugins @expo/metro-file-map` | The patched versions; no uuid |
| 15 | Prebuild smoke (Step 5) | Exit 0; no tracked files changed |
| 16 | `git status --porcelain` | Exactly: `M package-lock.json`, `M docs/05-operations/02-cicd.md`, `M docs/README.md`, `?? docs/05-operations/06-dependency-risk-register.md`, `?? .wp-commit-msg` |

## 4. Post-integration (integrator)

1. Commit with `git commit -F .wp-commit-msg` and rebase onto `origin/develop`. If WP-AUTH-FIX changed `package-lock.json`, **stop** and re-run Steps 2–4 rather than hand-merge the lockfile. Push to develop.
2. Replace `<sha>` in register §5 with a follow-up `docs:` commit.
3. Close the Dependabot PRs:

```bash
for n in 3 4 5 6 7 8; do gh pr close $n --comment "Superseded by <sha> on develop (WP-DEPS): an in-range lockfile refresh (npm update, no package.json change) moved this dependency to its patched version. It reaches main with the next develop→main promotion. Dependabot security PRs target main because it is the default branch; dependency changes land via develop. See docs/05-operations/06-dependency-risk-register.md §5."; done

gh pr close 2 --comment "Not merging: this moves expo-router to 58.x, i.e. Expo SDK 58. SDK upgrades are deliberate projects, not dependency bumps (AGENTS.md; .github/dependabot.yml ignore rules). The patched decode-uri-component 0.5.0 is ESM-only and cannot be overridden under query-string 7's require(), so GHSA-vcc3-ghjq-m6fr is recorded as proposed residual risk DR-03 in docs/05-operations/06-dependency-risk-register.md (develop <sha>), with the SDK 58 upgrade as its exit condition."
```

4. **Do not close the `dependency-audit` issues by hand, and do not trigger the workflow on develop.**
   - Main still has the old lockfile until the next promotion, so anything closed now would be reopened.
   - After the next develop→main promotion, the audit run auto-closes #9, #10, #11, #12, #14 and #16.
   - Comment on #13 and #17: `Cannot be patched: no fixed version of <pkg> is published. Proposed as accepted risk <DR-0x> in docs/05-operations/06-dependency-risk-register.md (develop <sha>). Awaiting owner decision; if accepted, label wontfix.`
5. Dependabot alerts 1, 3, 4, 6, 8, 9, 12, 13 and 14 close once `main` has the new lockfile. Alerts 2, 10 and 11 stay open, which is correct.

## 5. Commit message (`.wp-commit-msg`)

```
chore(deps): patch vulnerable transitive deps in range; register residual risk

In-range lockfile refresh (npm update, package.json unchanged, no
overrides) clears 8 of 12 npm audit advisories, including the critical:

- shell-quote 1.10.0 -> 1.12.0 (GHSA-pqg4-j6r4-53mv, critical)
- source-map-js 1.2.1 -> 1.2.2 (GHSA-68fv-2mgg-jv7q)
- compression 1.8.1 -> 1.8.2 (GHSA-vc2v-76pw-4v95)
- js-yaml 4.3.1 -> 4.3.2 (GHSA-2883-xcg3-v3hh)
- brace-expansion 1.1.18 -> 1.1.21, 5.0.9 -> 5.0.12 (GHSA-q2hr-2g5m-vwhr,
  GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p)
- @expo/config-plugins 57.0.8 -> 57.0.11 (xcode 4, drops uuid:
  GHSA-w5hq-g745-h8pq); @expo/metro-file-map 57.0.1 -> 57.0.4

No Expo SDK, React Native, Jest or MapLibre version changes; offline
`expo install --check` still passes.

Four advisories have no fix inside SDK 57 and are recorded as proposed
exceptions in the new docs/05-operations/06-dependency-risk-register.md:
braces and node-forge (high, no patched release; build tooling only),
decode-uri-component (moderate, ships via expo-router; fixed by SDK 58),
sprintf-js (moderate, Jest-only, no patched release). CI/CD §4/§9 and
the docs index link the register.

Supersedes Dependabot #3-#8; #2 (expo-router 58) is declined.
Refs: NFR-54, SCR-0010

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**Jira one-liner:** `Done — develop <sha>: in-range lockfile refresh cleared 8/12 npm audit advisories incl. the critical shell-quote (no package.json/SDK change); braces, node-forge, decode-uri-component, sprintf-js have no SDK-57 fix and are logged as proposed exceptions in docs/05-operations/06-dependency-risk-register.md pending owner acceptance.`

## 6. Open for Corey (not decided here)

- **a. Accepting the residual risk.** DR-01 (braces) and DR-02 (node-forge) are high and breach the NFR-54 7-day SLA. Neither has a patched release anywhere, and both are dev or build tooling only. Either accept them (fill "Accepted by" and label #13 and #17 `wontfix`) or keep the issues open as a live breach.
- **b. DR-03 ships in the app** (deep-link DoS through expo-router's query-string). Options:
  1. Accept until SDK 58.
  2. Pull the SDK 58 upgrade forward.
  3. A patch-package hand-patch of query-string. Not recommended.
- **c. `npx expo install --check` already fails online** (13 SDK-57 patch drifts). Should SDK-57 patch alignment be its own WP? Dependabot PR #20 (expo-sdk group) also bumps react 19.3 and `@react-native/jest-preset` 0.88, a cross-minor jump.
- **d. Issue timing.** Closing #9–#16 waits for the next develop→main promotion.
- **e. Jira key** comes from the orchestrator.
- **f. AGENTS.md memory line** ("never `npm audit fix --force`; residual advisories live in the Dependency Risk Register") is deferred to a follow-up to avoid conflicts with WP-AUTH-FIX.

**Out of scope:**
- Dependabot PRs #15 and #18–#24 against develop, including eslint 10 major (#24) and expo-secure-store 58 (#23, SDK 58, which should be declined like #2).
- The duplicate `* 2.js` files in the main clone's `node_modules`.
