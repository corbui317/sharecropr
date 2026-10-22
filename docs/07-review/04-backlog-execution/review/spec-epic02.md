# EPIC-02 Spec Review: Data Model, RLS & Test Harness

Diff `a5bd5e2...HEAD`. I reviewed by reading the code only. No database was available. The dev-notes session table marks 9 of 12 stories "Done". The evidence supports 1 of them.

## Story status

| Story | Status | Evidence |
|---|---|---|
| 0201 | **Wrong** | 8 files are named `20260822_000N_*.sql`. The Supabase CLI reads the version as the leading digits, so they all get `20260822` and `db reset` fails on a duplicate key. The story requires "the migration convention", but no doc defines one. The story also requires "roles", and the RLS Design's `break_glass` role is never created. |
| 0202 | Done | profiles, verifications, blocks and both stubs have RLS ENABLE + FORCE. 0010 changes privileges to revoke-then-grant per column. |
| 0203 | **Partial (likely break)** | `h3_lat_lng_to_cell(geometry,int)` is the `h3_postgis` overload. 0001 only runs `CREATE EXTENSION h3`, so seeding `garden_locations` probably errors. The nightly `h3_r9` consistency check from ADR-0005 does not exist. |
| 0204 | Partial | The story names `current_user_id`, which does not exist. ADR-0016's examples call it. |
| 0205 | **Partial** | `db.yml` runs `supabase db reset` without `supabase start` and installs the CLI at `version: latest`. pgTAP has never run (commit 710878e). Even so, CI/CD §2 calls `pgtap-rls` "Running". |
| 0206 | Partial | There is no "generator". `ci-assert-negative-ratio.sh` counts label regexes per file, not per table. It counts four `pass()` placeholders (LP-08/09/10/12) as negatives. Some "N" assertions are not negatives at all: gardens N9 is a stability check, and N14 is trivially empty. |
| 0207 | Partial | The table, autovacuum settings and hourly sweep exist. The **"bloat metric on the dashboard"** is missing: no code or doc mentions one. |
| 0208 | **Wrong** | `COMMENT ON FUNCTION vault.get_secret(text)` fails because supabase_vault has no `get_secret`. That also breaks every spec snippet that uses it (SPEC-010, Runbook 14). The migration provisions the placeholder key in **every** environment, but Environments §6 says "never reuse in staging/production". Custody is now documented, but AGENTS.md §6 still says "currently unstated". |
| 0209 | Not started | Blocked by SCR-1210. |
| 0210 | Partial (scaffold) | AC: "runs continuously … enumerates surfaces … REST, RPC, realtime, push, Sentry, PostHog, CSV, moderator views". Actual: a TS script covering REST and RPC only, never scheduled, with `rpc_enumeration` hard-coded `passed: true`. LP-02 is a stub that always passes. LP-13 is absent. LP-04/05/07 use 1–4 gardens, but the spec requires 10,000 gardens and a χ² test. LP-06 calls `MIN(geography)`, an aggregate that does not exist, so it errors. It also reads one row 100 times, so it tests nothing. |
| 0211 | Partial | Append-only is enforced by BEFORE UPDATE/DELETE row triggers only. **TRUNCATE is not guarded**, and no pgTAP test covers the guard. Moderator reads through `gardens_select_moderator` / `verifications_select_moderator` are not audited. NFR-53 requires "Every moderator action and every P1 data access written to an immutable audit trail". A direct `service_role` INSERT would fail, because the CHECK calls `app.jsonb_has_coord_key` and `service_role` has no EXECUTE on it. |
| 0212 | Partial | Each query runs once against about 15 users, so this is not "p95 50 ms at 10× launch volume". RLS Test Plan §6 requires "100k profiles, 500k listings, 2M messages". `supabase/perf/baselines/` does not exist, and verifications and blocks have no timing assertions. |

## Specific checks

- **RLS forced on every public table:** true today. However, `structural_sweeps` checks FORCE for only 3 named tables, so the NFR-46 regression gate is incomplete.
- **Negatives outnumber positives:** true per file, but the count is inflated as described under 0206.
- **Location canary:** scaffold only. Not continuous, not wired into CI (CI/CD §2 says "not wired").
- **Audit guard:** partial (no TRUNCATE guard, no test).
- **Idempotency:** autovacuum is tuned. There is no bloat metric.
- **Vault / handoff_code_key:** the migration breaks, and production would get the placeholder key.
- **Query timing:** structural only.
- **pgTAP in CI:** the workflow exists but would fail, and has never been run.

## Implemented but wrong

The issues above under 0201, 0203, 0208 and 0210 (LP-06), plus `db.yml` missing `supabase start`. All plan counts match the number of assertions in each file.

## Scope creep (minor)

- `app.geohash_encode` and `quantize_lat_lng` are unused. ADR-0005 rejects geohash; the story text does name these helpers.
- The stub `exchange_sessions` already fixes the `handoff_code bytea` column and the state columns ahead of SPEC-010/SCR-1210.
- Migration 0010 bundles EPIC-03 work (email-change reaper, AAL2) into an "EPIC-02 fixes" migration.
- `config.toml` exposes `app` to PostgREST. This is a design choice that enlarges the RPC surface, and it is recorded only in agent memory, not in an ADR.

## Doc drift

- The dev-notes session table overclaims "Done" status.
- CI/CD §2 says "Running".
- AGENTS.md §6 still lists N-03 custody as unstated, though Environments §6 now documents it.
