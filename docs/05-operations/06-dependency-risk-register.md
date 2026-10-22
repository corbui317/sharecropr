# Dependency Risk Register

**Status:** Draft — pending owner acceptance · **Version:** 0.1.0 · **Owner:** Platform Engineering

## 1. Purpose

NFR-54 requires high and critical CVEs to be patched within 7 days. This register lists every advisory we cannot patch without an Expo SDK, React Native, Jest-major or MapLibre upgrade (deliberate projects per the `.github/dependabot.yml` ignore rules and [ADR-0019](../01-architecture/adr/ADR-0019-openstreetmap-maplibre.md)), with its reason and exit condition.

An entry counts as accepted only once "Accepted by" is filled by the product owner. Until then it is a *proposed* exception.

## 2. Rules

- Never run `npm audit fix --force`: every major `fixAvailable` on this tree is a downgrade.
- Prefer an in-range `npm update <leaf>`.
- Use `overrides` only when the patched version is API-compatible with the parent's require/import.
- Re-check entries on every SDK upgrade and at the review date.
- "Ships in app bundle" means reachable from the Metro production bundle, not Dependabot's runtime scope.

## 3. Register

| ID | Advisory | Package@version | Severity | Path | Ships in app bundle? | Why not fixed | Exit condition | Tracking | Review by | Accepted by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DR-01 | GHSA-vfj7-8cjw-p6xm | braces@3.0.3 | high | micromatch@4.0.8 ← metro-file-map 0.84.5 (← @expo/metro ← expo), Jest 29 internals, find-yarn-workspace-root (← patch-package 8) | No. Bundler, test runner and postinstall only; glob patterns come from repo config. | No patched braces exists (3.0.3 is latest) | braces > 3.0.3, then `npm update braces` | issue #17 | 2027-01-22 | _pending_ |
| DR-02 | GHSA-86w9-cpqp-85rv | node-forge@1.4.0 | high | @expo/cli 57.0.17; @expo/code-signing-certificates 0.0.6 | No. CLI code-signing and dev-cert tooling; no expo-updates in the app. | No patched node-forge exists (1.4.0 is latest) | node-forge > 1.4.0, or @expo/cli dropping it | issue #13 | 2027-01-22 | _pending_ |
| DR-03 | GHSA-vcc3-ghjq-m6fr | decode-uri-component@0.2.2 | moderate | query-string@7.1.3 ← expo-router 57.0.15 | **Yes.** expo-router parses every incoming deep link. A crafted link with malformed percent-encoding can stall the JS thread (self-DoS); no data exposure; location invariants unaffected. | The fix (0.5.0) is ESM-only, and query-string 7 `require()`s it, so an override breaks linking. | Expo SDK 58 (expo-router ≥ 58.0.13) | Dependabot alert #2 | SDK 58 or 2027-01-22 | _pending_ |
| DR-04 | GHSA-hp3w-g68c-fv3c | sprintf-js@1.0.3 | moderate | argparse@1.0.10 ← js-yaml@3.15.2 ← @istanbuljs/load-nyc-config ← babel-plugin-istanbul ← Jest 29 | No (dev only) | No patched sprintf-js exists | A sprintf-js fix, or a Jest major that drops babel-plugin-istanbul 6 | none | 2027-01-22 | _pending_ |

## 4. Inherited entries

The roughly 55 other audit entries carry no advisory of their own; they are flagged because they depend on DR-01…DR-04. Their `fixAvailable` majors are downgrades. Ignore them.

## 5. Resolved in-range (2026-10-22, WP-DEPS commit `<sha>`)

- shell-quote → 1.12.0 (GHSA-pqg4-j6r4-53mv)
- source-map-js → 1.2.2 (GHSA-68fv-2mgg-jv7q)
- compression → 1.8.2 (GHSA-vc2v-76pw-4v95)
- js-yaml → 4.3.2 (GHSA-2883-xcg3-v3hh)
- brace-expansion → 1.1.21 / 5.0.12 (GHSA-q2hr-2g5m-vwhr, -qhr7-859c-m2p7, -6j4f-fj2g-mc7p)
- uuid removed via @expo/config-plugins 57.0.11 (GHSA-w5hq-g745-h8pq)
- @expo/metro-file-map → 57.0.4

## 6. How to re-run

```bash
npm audit --json > audit.json
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(JSON.stringify(r.metadata.vulnerabilities));const g=new Set();for(const v of Object.values(r.vulnerabilities))for(const a of v.via)if(typeof a==="object")g.add(a.severity+" "+a.name+" "+a.url.split("/").pop());console.log([...g].sort().join("\n"))' audit.json
```

`npm audit --audit-level=critical` must exit 0 on develop.

## Change log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-10-22 | 0.1.0 | Platform Engineering | Initial register: DR-01…DR-04 proposed after the WP-DEPS in-range refresh |
