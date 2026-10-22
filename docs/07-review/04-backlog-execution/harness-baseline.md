# Sharecropr local Postgres harness: baseline

> CI note (2026-10-22, WP-DBCI): before this fix `db.yml` never started Supabase, so CI never applied a migration. The failures below come from the local harness, and CI should now reproduce them.

Repo state tested: `/home/claude/sharecropr` (develop HEAD, not modified). Everything lives in this directory.

## Usage

```
cd /tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/harness

./reset.sh                                    # repo as-is: stops at first error (currently 0003, see below)
MIG_DIR=$PWD/work/migrations ./reset.sh       # patched scratch copy: runs to "reset OK"
./test.sh                                     # repo tests as-is
TESTS_DIR=$PWD/work/tests ./test.sh           # patched scratch tests
./test.sh rls_profiles.test.sql               # one file
./up.sh                                       # just (re)create the empty cluster
```
Per-file TAP and stderr land in `results/<name>.tap|.err`. Connect: `psql -h 127.0.0.1 -p 54329 -U postgres postgres` (trust auth; `-U supabase_admin` for superuser).

How it works
- `up.sh`: creates OS user `pgh`, `initdb -U supabase_admin` (PG 16.15), port 54329, `shared_preload_libraries=pg_cron`, `cron.database_name=postgres`. The scratchpad is mode 0700 root, so the real data dir is `/var/lib/pgh-harness/pgdata` and `harness/pgdata` is a symlink to it. Wipes and recreates every run.
- `up.sh` also touches system files (outside the repo): appends `trusted = true` to the postgis, postgis_raster, h3, h3_postgis and pg_cron `.control` files (emulates supautils, so the non-superuser `postgres` can create them) and installs the `supabase_vault` stand-in extension from `vault/`.
- `supabase-stub.sql` (run as supabase_admin) then `reset.sh` applies migrations as `postgres` and seeds in `config.toml [db.seed]` order (`seed_harness.sql` then `seed.sql`; the task text had the reverse, config.toml wins). Each file is one transaction (`psql -1`), like the CLI's batch execution.
- `test.sh`: `CREATE EXTENSION pgtap WITH SCHEMA extensions` (what `supabase test db` does), then `pg_prove -v` per file as `postgres`.
- `work/migrations`, `work/tests`: scratch copies with the minimal fixes below. Repo files are never touched.

## Stub fidelity

Faithful:
- `postgres` is NOT a superuser (CREATEROLE CREATEDB REPLICATION BYPASSRLS, role search_path `"$user", public, extensions`); `supabase_admin` is the superuser and owns the DB. Roles anon/authenticated (NOLOGIN NOINHERIT), service_role (BYPASSRLS), authenticator, supabase_auth_admin, supabase_storage_admin, dashboard_user; postgres is a member of the API roles (so `SET LOCAL ROLE authenticated` works).
- Default privileges: ALL on tables/functions/sequences in `public` to postgres, anon, authenticated, service_role, set FOR ROLE postgres and FOR ROLE supabase_admin. Confirmed that 0010's revoke-then-grant works: after migrations anon/authenticated have only column-level grants on `public.profiles`, service_role keeps table grants.
- `extensions` schema (pgcrypto and uuid-ossp preinstalled there; postgis requested `WITH SCHEMA extensions` by 0001), `auth` schema owned by supabase_auth_admin with GoTrue-shaped `users` (incl. generated `confirmed_at`, `is_sso_user`, `deleted_at`, `is_anonymous`, partial unique email index), `sessions`, `identities`, `refresh_tokens`, `mfa_factors` (+ enums), `mfa_challenges`; `auth.uid()/role()/email()/jwt()` read `request.jwt.claim.*` then `request.jwt.claims` like GoTrue.
- pg_cron: `grant_pg_cron_access` event trigger as Supabase ships it.

Gaps vs real Supabase
- `supabase_vault` is a stand-in extension: same table/view/`create_secret`/`update_secret` surface, but no pgsodium, secrets are stored UNENCRYPTED, `key_id` unused. It is preinstalled in the stub, so 0001's `CREATE EXTENSION supabase_vault CASCADE` is a no-op here. It deliberately has no `vault.get_secret`.
- No supautils (reserved-role guards, default extension schema override), no GoTrue/PostgREST/Realtime/Storage (storage and graphql_public are empty schemas), no `pg_graphql`, `pgsodium`, `pgjwt`, no PostgREST event triggers, no `supabase_migrations.schema_migrations` bookkeeping (duplicate versions are only detected and reported).
- Extensions created without `WITH SCHEMA` land in `public` (search_path `"$user", public, extensions`). Real Supabase may place them in `extensions` (supautils); not verified offline.
- Not exercised: PostgREST (`request.jwt.claims` is set by hand in tests, as in the repo's own harness), pg_cron job execution, statement_timeout role settings are set but short-lived tests rarely hit them.

## Findings: migration/seed errors

Applying the repo as-is, with the CLI's own rule (version = digits before the first `_`):

0. Duplicate CLI versions. Files `20260822_0001` ... `20260822_0008` all have CLI version `20260822`. `supabase db reset` records each applied migration in `schema_migrations(version)` (primary key), so the real CLI would fail at the second file. The harness reports it and carries on in filename order. Fix in repo: rename to unique numeric prefixes (e.g. `20260822000001_baseline.sql`). Not applied in scratch copy.

Then, in filename order (each fix applied in `work/migrations` before the next error showed):

| # | File:line | Error (exact) | Minimal fix in scratch copy |
|---|---|---|---|
| 1 | `20260822_0003_gardens_geospatial.sql:122` (`app.k_for_radius`, LANGUAGE sql, validated at create time) | `ERROR: function h3_get_hexagon_edge_length_avg(integer, unknown) does not exist ... HINT: No function matches the given name and argument types.` Cause: 0001's bare `CREATE EXTENSION IF NOT EXISTS h3;` installs into `public` (role search_path), but the function pins `search_path = pg_catalog, extensions`. | 0001: `CREATE EXTENSION IF NOT EXISTS h3 WITH SCHEMA extensions;` |
| 2 | `20260822_0005_idempotency.sql:50` (`app.idempotency_record`; the plpgsql sibling `idempotency_probe` at line 37 has the same latent bug) | `ERROR: function digest(text, unknown) does not exist` pgcrypto is in `extensions` (0001 says so) but both functions use `search_path = pg_catalog, private, public`. | Qualify as `extensions.digest(...)` at lines 37 and 48 |
| 3 | `20260822_0006_vault_handoff_key.sql:19` | `ERROR: function vault.get_secret(text) does not exist` Supabase Vault has no `get_secret`; the `COMMENT ON FUNCTION` is invalid (and `postgres` is not the owner of vault objects anyway). The secret insert via `vault.create_secret` is fine. | Delete the `COMMENT ON FUNCTION vault.get_secret ...` statement (a table comment can not be set by postgres either) |
| 4 | Surfaced by `seed.sql:96` (garden_locations insert fires `private.sync_garden_derived_location`), originates in `20260822_0003_gardens_geospatial.sql` (trigger body) | `ERROR: function h3_lat_lng_to_cell(geometry, integer) does not exist` plpgsql is lazy, so migrations apply cleanly and it only breaks at first insert. Core `h3` takes `point`; the `geometry` overload comes from `h3_postgis`, which no migration creates. | 0001: `CREATE EXTENSION IF NOT EXISTS h3_postgis WITH SCHEMA extensions CASCADE;` |

Migrations 0004, 0007, 0008, 0009, 0010 and both seeds apply cleanly once the above are fixed (0008's `cron.schedule` calls work as `postgres`).

Important caveat on #1/#4: per https://supabase.com/docs/guides/database/extensions, `h3`/`pg_h3` is not in Supabase's extension list (postgis, pg_cron, pgtap are; `supabase_vault` is only documented under the Vault guide). `CREATE EXTENSION h3` is therefore very likely to fail on real Supabase (hosted and the local CLI image, which is also the target `supabase db reset` runs in CI). I could not verify this against the actual image offline, and the harness has h3 because it was provided. Treat this as the biggest open risk the harness can not settle.

## Findings: pgTAP

Repo tests as-is (`./test.sh`, against the patched migrations): 179 ok, 0 not ok, 1 file errored.

| File | Result | Notes |
|---|---|---|
| auth_account_deletion | PASS 18/18 | |
| auth_email_change | PASS 19/19 | |
| location_privacy | FAIL: script error after 4 of 13 | `location_privacy.test.sql:48: ERROR: function min(geography) does not exist` (LP-06). PostGIS has no `min` aggregate for geography/geometry on any PG version, so this is a test bug, not a harness artefact. Fix in scratch: `(array_agg(truth))[1]` instead of `MIN(truth)` -> 13/13 pass. Side note: LP-06's `CROSS JOIN generate_series(1,100)` repeats the same point 100 times, so the "averaging" check is vacuous. |
| query_timing | PASS 8/8 | wall-clock budgets, may be machine-sensitive |
| rls_blocks | PASS 19/19 | |
| rls_column_privileges | PASS 22/22 | |
| rls_gardens | PASS 30/30 | |
| rls_profiles | PASS 38/38 | |
| rls_verifications | PASS 13/13 | |
| structural_sweeps | PASS 8/8 | |

With the one-line test fix (`TESTS_DIR=$PWD/work/tests`): 188 ok, 0 not ok, 10/10 files pass.

Static CI gates (`scripts/ci-assert-*.sh`) were run too: no-private-grants and negative-ratio pass; definer-allowlist and rls are stubs that print "stub pass" (rls says the Supabase CLI is unavailable), so they prove nothing.

## PG16 vs PG15 (production is 15)

No difference was hit in any error above; all four migration errors and the test error would occur on PG15 as well. Things to be aware of: PG16 role-membership grants carry INHERIT/SET options (harness grants use defaults, which allow `SET ROLE`); extension versions here are postgis 3.4.2, h3 4.1.3, pg_cron 1.6, which may differ from the Supabase image; `pg_stat_*` and error-message wording can differ slightly.
