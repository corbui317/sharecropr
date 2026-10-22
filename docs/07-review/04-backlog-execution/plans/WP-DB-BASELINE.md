# WP-DB-BASELINE: 14-digit migrations, H3 removed for PostGIS location tiers (ADR-0023), digest/Vault fixes, LP-06

- **Jira:** SCRUM-35 (WP-08, SCR-0201), SCRUM-36 (WP-09, SCR-0208), SCRUM-41 (WP-10, SCR-0203), SCRUM-44 (WP-11, SCR-0210). Related, not closed here: SCRUM-37 (WP-12), SCRUM-18.
- **Base:** `origin/develop` at `a13ada4` (WP-12a landed: CLI 2.120.0 is pinned and db.yml writes the first error to the job summary).
- **Roles:** Opus plans. Sonnet executes in worktree `wp/WP-DB-BASELINE` and does not commit; it snapshots one tree per phase (§0.3). Haiku integrates: it builds the commits from those trees, pushes, opens a **draft PR to develop**, and runs the CI loop (§9).
- **Verification oracle:** CI only. There is no Docker or psql on this Mac and no stand-in harness. db.yml runs on `pull_request` for `supabase/**` and `package.json`.
- **Evidence behind D1:** db.yml runs 39803696654 and 39804036046 (CLI 2.120.0) both failed:
  ```
  Applying migration 20260822_0001_baseline.sql...
  ERROR: extension "h3" is not available (SQLSTATE 0A000)
  At statement: 13
  ```
  Statement 13 is `CREATE EXTENSION h3` (statements are counted from 0). Statements 0–12 succeeded. That includes `postgis WITH SCHEMA extensions`, `pgcrypto` and `pg_cron`.

---

## 0. Scope fence, decisions, sequencing

### 0.1 Decisions applied as given (Corey, 2026-10-22). Do not revisit.
- **D1. PostGIS only.** H3 is removed everywhere. The privacy ladder becomes named PostGIS tiers. The concrete scheme is in §3.
- **D2. Never-applied migrations are edited in place.** That covers 0001–0006. It also covers **0007–0010 and `20261022145504_account_deletions_history.sql`**: none of them has ever applied, in CI (CI stopped at 0001) or on any hosted project (nothing has been `supabase link`ed). This package edits 0001, 0002, 0003, 0004, 0005, 0006, 0009, 0010 and 20261022145504 (comments only in the last). Forward-only (SCRUM-18) starts at the first migration that applies to a non-disposable database. This is recorded in Data Model §15 (rules 1 and 12) and in README open question 1.

### 0.2 In scope, and what is out
- **IN:**
  - (a) WP-08: renames, `break_glass`, the §15 convention.
  - (b) H3 removal.
  - (c) The `extensions.digest` qualification, plus **the full WP-09 scope**.
  - (d) WP-11, adapted to the tiers.
  - (e) pgTAP for the tiers.
  - Absorbing WP-08…WP-11 in `queue.json`.
- **OUT, do not touch:**
  - `.github/workflows/db.yml` and `scripts/run-pgtap.sh` (WP-12a/WP-12 own them).
  - `supabase/config.toml`.
  - The break-glass provisioning script.
  - SPEC-020's surplus matching, beyond renames and a pending banner (open question Q4).
  - The SPEC-004 `home_coarse_cell` derivation (follow-up).

### 0.3 Why WP-09 is included rather than split out
Today, migration 0006 writes the placeholder secret `local-dev-handoff-key-replace-before-production` into **every** database it applies to, hosted ones included. D2's in-place window closes at the first hosted apply. After that the placeholder could only be removed by a corrective migration, and a database that already applied it would keep it. Moving it to `seed.sql` costs almost nothing now and is expensive later. The accessor, the pgTAP test and the doc edits are small, so they stay together in their own commit (C4).

### 0.4 Commit plan
**Recommendation: land six commits, preserved with a rebase-merge, not squashed.**
- C1 must be a pure rename (100% similarity), so the reviewer can see contents did not change.
- C2 is the ADR change, an auditable unit on its own.
- If CI needs fixes, they go on top as `fix(db): … (CI iteration N)` commits.

| # | Commit | Phase |
| --- | --- | --- |
| C1 | WP-08: renames, `break_glass`, §15 convention, filename references | P1 |
| C2 | D1: H3 → location tiers (migrations, tests, canary regex, ADR-0023, docs) | P2 |
| C3 | `extensions.digest` in 000005 | P3 |
| C4 | WP-09: Vault accessor, placeholder moved to seed, pgTAP, docs | P4 |
| C5 | WP-11: LP-06 rewrite and `skip()` placeholders | P5 |
| C6 | Backlog bookkeeping: `queue.json`, README, harness-baseline | P6 |

**How the executor produces several commits without committing.** After each phase Pn, the executor runs:
```bash
git add -A -- . ':!node_modules' ':!.wp-*'
echo "P<n> $(git write-tree)" >> .wp-trees
```
`write-tree` stores a tree object and creates no commit. The executor also writes `.wp-commit-msg-<n>` for each phase (text in §11). The integrator then does:
```bash
git fetch -q origin develop && git checkout -q -B wp/WP-DB-BASELINE origin/develop
while read -r P T; do n=${P#P}
  C=$(git -c user.name="Corey" -c user.email="corbui317@gmail.com" commit-tree "$T" -p HEAD -F ".wp-commit-msg-$n")
  git reset -q --hard "$C"
done < .wp-trees
git diff --stat HEAD~6 HEAD -M | tail -1     # sanity check
git show --stat -M HEAD~5 | grep -c '=>'     # C1: expect 10 renames
```
The `.wp-*` files must sit outside the worktree or be excluded. Keep them in the worktree root and never stage them.

**Fallback.** If anything about the trees looks wrong, make one commit from the final tree with C2's message plus a body listing C1 and C3–C6.

**Resulting migration directory** (`ls supabase/migrations`, 12 files, in order):
```
20260822000001_baseline.sql            20260822000007_audit_events.sql
20260822000002_identity_tables.sql     20260822000008_test_harness_cron.sql
20260822000003_gardens_geospatial.sql  20260828000009_auth.sql
20260822000004_app_helpers_rls.sql     20261021000010_review_fixes.sql
20260822000005_idempotency.sql         20261022145504_account_deletions_history.sql
20260822000006_vault_handoff_key.sql   <TS>_break_glass_role.sql
```
`<TS>` comes from `date -u +%Y%m%d%H%M%S`. It **must be greater than 20261022145504**; the check is in V1.

---

## 1. Phase P1 (C1): WP-08, adjusted

Reuse `plans/WP-08.md` §1–§6, with these changes:

1. **Renames.** `git mv` exactly the ten files in WP-08 §1. `20261022145504_account_deletions_history.sql` already conforms and keeps its name. Make no content edits to the ten renamed files in P1.
2. **`break_glass` migration.** Create `supabase/migrations/<TS>_break_glass_role.sql`. Copy it verbatim from `docs/07-review/04-backlog-execution/plans/WP-08-files/migrations/20261021230000_break_glass_role.sql`, which is the in-repo copy of the `/tmp/...` path the WP-08 plan names.
3. **Test.** Copy `plans/WP-08-files/tests/roles_break_glass.test.sql` → `supabase/tests/roles_break_glass.test.sql` (12 assertions, P=1, N=11).
4. **Reference updates.** The line numbers changed after WP-AUTH-FIX, so re-find them with:
   ```
   git grep -nE "2026082[28]_00|20261021_0010" -- . ':!docs/07-review'
   ```
   | File | Change |
   | --- | --- |
   | `AGENTS.md:70` | → `20260828000009_auth.sql` |
   | `SPEC-001:167`, `:582` | → 14-digit names. **Leave line 602**: that Change Log row is history. Version 1.2.0 → 1.2.1; add a Change Log row: "Migration filenames updated to 14-digit versions; SCR-0201. No behavioural change" |
   | `SPEC-006:699` | → `20260822000001_baseline.sql`. Version 1.1.0 → 1.1.1, plus a row |
   | `docs/05-operations/01-environments.md:112` | → `20260822000006_vault_handoff_key.sql`. Version 1.1.1 → 1.1.2. P4 rewrites this row again |
   | `docs/07-review/02-development-notes.md:275` | Filename only |
   | `supabase/migrations/20261022145504_account_deletions_history.sql:2` | `20260828_0009_auth.sql` → `20260828000009_auth.sql`. Comment only; this file is not renamed |
5. **Data Model §15** (`docs/01-architecture/03-data-model.md`, version 1.3.0 → 1.4.0). Use WP-08 §5's text, with two changes:
   - **Replace rule 1** with:
     > 1. **Forward-only once applied.** No `DOWN` migrations. Once a migration has applied to any **non-disposable** database (a hosted Supabase project or any shared long-lived database), it is never edited: a mistake is fixed by a new corrective migration ([CI/CD §8](../05-operations/02-cicd.md#8-rollback), [ADR-0004](adr/ADR-0004-supabase.md); SCRUM-18). Databases created by `supabase start` / `db reset` locally or in CI are disposable and do not count. A bad contract migration is recovered by point-in-time restore, which is why contract phases are gated.
   - **In rule 8**, use the date 2026-10-22.
   - **Append rule 12:**
     > 12. **A migration that has never applied to a non-disposable database may be corrected in place, on the record** (decided 2026-10-22, D2). Stacking corrective migrations behind a file that cannot apply on a fresh database is impossible, and editing it in place is safe while nothing depends on it. Every such edit is named in its commit message. WP-DB-BASELINE used this for every migration up to and including `20261022145504_account_deletions_history.sql`: CI first reached Postgres on 2026-10-22 (db.yml run 39803696654) and stopped at the first file on `extension "h3" is not available`, and no hosted project was linked. **The window closes permanently at the first hosted apply. Record that migration's version here: first hosted apply: — (none yet).**
   - Change Log row: `| 2026-10-22 | 1.4.0 | Architecture | §15: migration naming convention (14-digit UTC version), forward-only once applied to a non-disposable DB (SCRUM-18), recorded in-place edits for never-applied migrations (D2, rule 12), one concern per file, test in the same PR, idempotent zero-privilege roles. Ten legacy migrations renamed (SCR-0201) |`
6. **RLS Design §2.** Add the note from WP-08 §6 with the real `<TS>`. Version 1.1.0 → 1.1.1, plus a row.
7. **`AGENTS.md` §7.** Add the WP-08 line at the top, with the date 2026-10-22 and "forward-only once applied (Data Model §15 rules 1, 12)". P2 adds the ADR line above it.

---

## 2. Phase P2 (C2): D1, H3 → PostGIS location tiers

### 2.1 Mechanical identifier renames

Run this first, then make the manual edits in §2.2–§2.6. `\b` does not fire between `_` and a letter, so the more specific forms come first.
```bash
perl -pi -e 's/profiles_home_h3_r7_idx/profiles_home_coarse_cell_idx/g;
  s/\bcenter_h3_r7\b/center_coarse_cell/g; s/\bhome_h3_r7\b/home_coarse_cell/g;
  s/\bcaptured_h3_r9\b/captured_fine_cell/g; s/\bowner_h3_r9\b/owner_fine_cell/g;
  s/garden\.h3_r9_selected/garden.fine_cell_selected/g;
  s/\bh3_r9\b/fine_cell/g; s/\bh3_r7\b/coarse_cell/g; s/h3_r\[89\]/fine_cell/g;
  s/`h3_\*`/`*_cell`/g' <FILES>
```
`<FILES>` is the following list. Use real paths and **never** a glob over `docs/07-review` or ADR files.
- `supabase/migrations/2026082200000{2,4}_*.sql`
- `supabase/migrations/20260828000009_auth.sql`
- `supabase/migrations/20261021000010_review_fixes.sql`
- `supabase/tests/rls_{column_privileges,gardens,profiles}.test.sql`
- `packages/location-canary/src/index.ts`
- Every doc file in the §2.6 table except the ADRs.

### 2.2 Term map for prose (manual)
| Old | New |
| --- | --- |
| H3 r5 / r5 (analytics) | region tier (16 km cells, 256 km²); property name `region_cell` |
| H3 r7 / r7 | coarse tier (2.5 km cells, 6.25 km²) |
| H3 r9 / r9 | fine tier (320 m cells, 0.10 km²) |
| `h3-pg`, `h3` extension | (removed) |
| `h3_grid_disk`, `k_for_radius`, k-ring, disk sizing | `ST_DWithin` on geography with GiST; no cell is a proximity filter |
| cell-boundary recall | radius recall (no cell pre-filter) |
| `safe_spots.h3_r8`, `safe_spots_h3_idx` | removed (spots use `safe_spots_gix`) |
| route/deep-link regex `\|h3` | `\|_cell` |

**Not geospatial, leave alone:** "H3" as a hazard ID in `docs/03-specs/SPEC-010-exchange-lifecycle.md` (lines 200 and 1325) and `docs/01-architecture/07-exchange-state-machine.md:457`. Also leave `.cursor/rules/*.mdc` (HTML `<h3>`) and the `package-lock.json` hashes.

### 2.3 Migrations

**`20260822000001_baseline.sql`.** Delete `CREATE EXTENSION IF NOT EXISTS h3;` and put this in its place:
```sql
-- No h3: Supabase's Postgres image does not ship it. PostGIS only (ADR-0023).
```

**`20260822000002_identity_tables.sql`.** After the perl pass, the `home_coarse_cell` column becomes:
```sql
  home_coarse_cell        text CONSTRAINT profiles_home_coarse_cell_tier
                            CHECK (home_coarse_cell IS NULL OR home_coarse_cell ~ '^2500:[0-9]+:[0-9]+$'),
```
The index is now `profiles_home_coarse_cell_idx` (renamed by perl).

**`20260822000003_gardens_geospatial.sql`.** Manual edits:

- Header, after line 1:
  ```sql
  -- Location tiers are PostGIS-only (ADR-0023, supersedes ADR-0005). Edited in place before first
  -- apply (Data Model §15 rule 12): the H3 columns and helpers never existed in any database.
  ```
- `public.gardens`: replace the `h3_r7` and `h3_r9` lines with:
  ```sql
  coarse_cell      text CONSTRAINT gardens_coarse_cell_tier
                     CHECK (coarse_cell IS NULL OR coarse_cell ~ '^2500:[0-9]+:[0-9]+$'),
  fine_cell        text CONSTRAINT gardens_fine_cell_tier
                     CHECK (fine_cell IS NULL OR fine_cell ~ '^320:[0-9]+:[0-9]+$'),
  ```
- **Delete** `CREATE INDEX gardens_h3_r9_idx ...`. No query reads `fine_cell`, and proximity uses the GiST indexes `garden_locations_gix` and `gardens_display_gix`.
- Insert this new section after `REVOKE ALL ON private.garden_locations ...` and before `-- ── Fuzzing`:
  ```sql
  -- ── Location tiers (ADR-0023) ───────────────────────────────────────────────
  -- The ONLY place tier sizes live. Every stored tier column CHECK-pins its id prefix, so changing
  -- a size also requires changing those constraints: a resolution change is a reviewed schema change.
  CREATE OR REPLACE FUNCTION app.location_tier_side_m(p_tier text)
  RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE p_tier
             WHEN 'region' THEN 16000  -- analytics ceiling, 256 km²   (H3 r5 was ~253 km²)
             WHEN 'coarse' THEN 2500   -- owner/server only, 6.25 km² (H3 r7 was ~5.2 km²)
             WHEN 'fine'   THEN 320    -- internal only, 0.10 km²     (H3 r9 was ~0.105 km²)
           END;
  $$;

  -- Banded equal-area square grid on the mean-radius sphere (ADR-0023 §The grid). Rows have constant
  -- height; each ROW's column width comes from the row's centre latitude (not the point's), so the
  -- grid is a true partition and cells are ~side x side on the ground at any latitude.
  -- Id '<side_m>:<row>:<col>' with row, col >= 0. Pure arithmetic: no spatial_ref_sys, no PROJ.
  CREATE OR REPLACE FUNCTION app.location_cell(p_point geography, p_tier text)
  RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = pg_catalog, extensions
  AS $$
  DECLARE
    m_per_deg constant double precision := pi() * 6371008.8 / 180.0;  -- metres per degree of latitude
    v_side    integer := app.location_tier_side_m(p_tier);
    v_lat     double precision;
    v_lng     double precision;
    v_row_h   double precision;
    v_row     bigint;
    v_col_w   double precision;
    v_col     bigint;
  BEGIN
    IF v_side IS NULL THEN
      RAISE EXCEPTION 'unknown location tier' USING ERRCODE = '22023';
    END IF;
    v_lat   := ST_Y(p_point::geometry);
    v_lng   := ST_X(p_point::geometry);
    v_row_h := v_side / m_per_deg;
    v_row   := floor((v_lat + 90.0) / v_row_h)::bigint;
    v_col_w := v_side / (m_per_deg * GREATEST(cos(radians(-90.0 + (v_row + 0.5) * v_row_h)), 1e-9));
    v_col   := floor((v_lng + 180.0) / v_col_w)::bigint;
    RETURN format('%s:%s:%s', v_side, v_row, v_col);
  END;
  $$;

  REVOKE ALL ON FUNCTION app.location_tier_side_m(text) FROM anon, authenticated, PUBLIC;
  REVOKE ALL ON FUNCTION app.location_cell(geography, text) FROM anon, authenticated, PUBLIC;
  ```
- Trigger function, rewritten:
  ```sql
  CREATE OR REPLACE FUNCTION private.sync_garden_derived_location()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, private, extensions
  AS $$
  BEGIN
    UPDATE public.gardens g
       SET display_point = app.derive_display_point(NEW.exact_point, NEW.fuzz_seed),
           coarse_cell   = app.location_cell(NEW.exact_point, 'coarse'),
           fine_cell     = app.location_cell(NEW.exact_point, 'fine'),
           updated_at    = now()
     WHERE g.id = NEW.garden_id;
    RETURN NEW;
  END;
  $$;
  ```
  `trg_sync_garden_location` stays unchanged.
- `reject_client_location_write`, condition:
  ```sql
      IF NEW.display_point IS DISTINCT FROM OLD.display_point
         OR NEW.coarse_cell IS DISTINCT FROM OLD.coarse_cell
         OR NEW.fine_cell IS DISTINCT FROM OLD.fine_cell THEN
  ```
- Helpers section:
  - Retitle it `-- ── Quantization helpers (Location Privacy §6.1) ──`.
  - **Delete** `app.k_for_radius` and its REVOKE.
  - Keep `quantize_lat_lng` and `geohash_encode` unchanged (open question Q6).
- Replace the h3_r9 column revoke with:
  ```sql
  -- fine_cell is never client-readable (0010 also leaves it out of the column grants).
  REVOKE SELECT (fine_cell) ON public.gardens FROM authenticated;
  ```
- Append after `get_my_garden_location`. This is the nightly drift job, the WP-10 scope under the new names:
  ```sql
  -- ── Tier consistency (ADR-0023 §Enforcement 7) ──────────────────────────────
  -- Raises on any garden whose stored cells disagree with its exact_point. Reports a COUNT only:
  -- never a garden id, cell or coordinate (Invariant 1). Failures land in cron.job_run_details.
  CREATE OR REPLACE FUNCTION private.check_location_tiers()
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, private, extensions
  AS $$
  DECLARE v_drift bigint;
  BEGIN
    SELECT count(*) INTO v_drift
      FROM private.garden_locations l
      JOIN public.gardens g ON g.id = l.garden_id
     WHERE g.coarse_cell IS DISTINCT FROM app.location_cell(l.exact_point, 'coarse')
        OR g.fine_cell   IS DISTINCT FROM app.location_cell(l.exact_point, 'fine');
    IF v_drift > 0 THEN
      RAISE EXCEPTION 'location tier drift: % garden(s)', v_drift USING ERRCODE = 'P0001';
    END IF;
  END;
  $$;

  REVOKE ALL ON FUNCTION private.check_location_tiers() FROM PUBLIC, anon, authenticated;

  DO $cron$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
      PERFORM cron.schedule('location_tier_consistency', '45 3 * * *',
                            $$SELECT private.check_location_tiers();$$);
    END IF;
  END;
  $cron$;
  ```

**`20260822000004_app_helpers_rls.sql`.** The perl pass already handles:
- The regex, which becomes `'^(lat|lng|latitude|longitude|point|coordinates|geohash|fine_cell)$'`.
- The `REVOKE SELECT (..., home_coarse_cell, ...)` list.
- The policy condition `display_point IS NULL AND coarse_cell IS NULL AND fine_cell IS NULL`.

Check all three by eye.

**`20260828000009_auth.sql:275`.** Perl produces `home_coarse_cell = NULL,`.

**`20261021000010_review_fixes.sql`.** Perl renames the identifiers in the comments (lines 28, 33 and 144) and in the GRANT on line 35. Also edit line 1 by hand:
```sql
-- Code-review fixes (EPIC-02/03 hardening), written as a forward migration over 0001-0009.
```
`coarse_cell` stays in the gardens SELECT grant, which matches the old `h3_r7` exposure exactly. `fine_cell` is not granted.

**`20261022145504_account_deletions_history.sql:4`.** Change the comment to:
```sql
-- Added as its own forward migration (Data Model §15) rather than an edit to 0009/0010.
```

### 2.4 Tests

**`rls_column_privileges.test.sql`.** After perl, while editing these lines, namespace the bare IDs:
```
'N6: gardens.fine_cell is not selectable (SPEC-004-T23)'
```
and change the header tag `SPEC-004-T23` to read `SPEC-004-T23, ADR-0023`.

**`rls_gardens.test.sql`.**
- Perl handles N4 and N21.
- Change their descriptions to `'N4: fine_cell column revoked (SPEC-004-T23)'` and `'N21: moderator cannot select fine_cell either (SPEC-004-T23)'`.
- Replace the last block (`-- app.k_for_radius ...` and P6) with:
  ```sql
  -- app.location_cell is internal (not granted to clients); exercised as the migration role.
  SELECT tests.clear_authentication();
  SELECT ok(app.location_cell(ST_SetSRID(ST_MakePoint(10, 50), 4326)::geography, 'coarse')
              ~ '^2500:[0-9]+:[0-9]+$',
            'P6: location_cell derives a coarse-tier cell id (ADR-0023)');
  ```
  `plan(30)` is unchanged.

**`rls_profiles.test.sql:57-58`.** After perl, set the description to `'N8: home_coarse_cell not selectable (SPEC-001-N08)'`.

**New `supabase/tests/location_tiers.test.sql`** (P=7, N=12, `plan(19)`). It replaces WP-10's planned `geospatial_h3.test.sql`.
```sql
-- Location tiers, PostGIS only (ADR-0023, supersedes ADR-0005). Tags: ADR-0023, LP-03, LP-11,
-- SPEC-004-T05, SPEC-004-T23, TC-GEO-10. No fine-tier value or garden coordinate reaches TAP output:
-- assertions on stored cells are ok() on booleans or is() on counts. Walk points are synthetic.
BEGIN;
SELECT plan(19);

-- ── Positive ────────────────────────────────────────────────────────────────
SELECT is(ARRAY[app.location_tier_side_m('region'), app.location_tier_side_m('coarse'),
                app.location_tier_side_m('fine')],
          ARRAY[16000, 2500, 320],
  'P1: the tier ladder is region 16 km, coarse 2.5 km, fine 320 m (ADR-0023)');

SELECT ok((SELECT g.coarse_cell = app.location_cell(l.exact_point, 'coarse')
              AND g.fine_cell   = app.location_cell(l.exact_point, 'fine')
             FROM public.gardens g JOIN private.garden_locations l ON l.garden_id = g.id
            WHERE g.id = tests.fixture('owner_garden')),
  'P2: the location trigger derives coarse_cell and fine_cell from exact_point');

SELECT is((SELECT count(*) FROM public.gardens
            WHERE coarse_cell ~ '^2500:[0-9]+:[0-9]+$' AND fine_cell ~ '^320:[0-9]+:[0-9]+$')::int,
  4, 'P3: all four seeded gardens carry one cell per stored tier');

-- Resolution: walk 100 points spaced side/10 (9.9 sides) and count distinct column (E-W) or row
-- (N-S) indices. Square side x side cells give 10-11. A degree grid shrunk by cos(lat) gives 14+ at
-- 42N. ST_Project measures on the spheroid, independently of location_cell's sphere.
SELECT ok((SELECT bool_and(n BETWEEN 9 AND 12) FROM (
    SELECT count(DISTINCT split_part(app.location_cell(
             ST_Project(ST_SetSRID(ST_MakePoint(-83.80, 42.28), 4326)::geography,
                        i * app.location_tier_side_m(t) / 10.0, radians(90)), t), ':', 3)) AS n
      FROM unnest(ARRAY['region','coarse','fine']) AS t CROSS JOIN generate_series(0, 99) AS i
     GROUP BY t) s),
  'P4: every tier is its nominal size east-west at 42N (TC-GEO-10)');

SELECT ok((SELECT bool_and(n BETWEEN 9 AND 12) FROM (
    SELECT count(DISTINCT split_part(app.location_cell(
             ST_Project(ST_SetSRID(ST_MakePoint(-83.80, 42.28), 4326)::geography,
                        i * app.location_tier_side_m(t) / 10.0, radians(0)), t), ':', 2)) AS n
      FROM unnest(ARRAY['region','coarse','fine']) AS t CROSS JOIN generate_series(0, 99) AS i
     GROUP BY t) s),
  'P5: every tier is its nominal size north-south at 42N (TC-GEO-10)');

SELECT ok((SELECT count(DISTINCT split_part(app.location_cell(
             ST_Project(ST_SetSRID(ST_MakePoint(10.75, 59.91), 4326)::geography,
                        i * 250.0, radians(90)), 'coarse'), ':', 3))
             FROM generate_series(0, 99) AS i) BETWEEN 9 AND 12,
  'P6: coarse cells stay 2.5 km wide at 60N (no shrink with latitude)');

SELECT lives_ok($$ SELECT private.check_location_tiers() $$,
  'P7: nightly tier consistency check passes on trigger-derived data');

-- ── Negative ────────────────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT app.location_cell(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 'r9') $$,
  '22023', NULL, 'N1: an unnamed tier is rejected (no ad-hoc resolution)');

SELECT throws_ok($$ UPDATE public.gardens SET coarse_cell = '320:1:1' WHERE id = tests.fixture('owner_garden') $$,
  '23514', NULL, 'N2: coarse_cell rejects a value from any other tier');
SELECT throws_ok($$ UPDATE public.gardens SET fine_cell = '2500:1:1' WHERE id = tests.fixture('owner_garden') $$,
  '23514', NULL, 'N3: fine_cell rejects a value from any other tier');
SELECT throws_ok($$ UPDATE public.profiles SET home_coarse_cell = '320:1:1' WHERE id = tests.fixture('owner') $$,
  '23514', NULL, 'N4: profiles.home_coarse_cell rejects a finer tier');

SELECT is((SELECT count(*) FROM (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public','app') AND c.relkind IN ('v','m') AND NOT a.attisdropped
       AND a.attname IN ('fine_cell','exact_point','fuzz_seed')
    UNION ALL
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public','app')
       AND (pg_get_function_result(p.oid) ~ '(fine_cell|exact_point|fuzz_seed)'
         OR pg_get_function_arguments(p.oid) ~ '(fine_cell|exact_point|fuzz_seed)')) s)::int,
  0, 'N5: no client-reachable view or function exposes fine_cell, exact_point or fuzz_seed (LP-03 forbidden-column sweep)');

SELECT ok(NOT has_function_privilege('authenticated', 'app.location_cell(geography,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.location_cell(geography,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'app.location_tier_side_m(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.location_tier_side_m(text)', 'EXECUTE'),
  'N6: tier functions are not client-callable');

SELECT is((SELECT count(*) FROM pg_extension WHERE extname IN ('h3','h3_postgis'))::int,
  0, 'N7: no h3 extension is installed (ADR-0023)');

SELECT is(((SELECT count(*) FROM information_schema.columns
             WHERE table_schema IN ('public','private','app','audit') AND column_name ~ 'h3')
         + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('public','private','app','audit')
               AND (p.proname ~ '^h3_' OR p.proname = 'k_for_radius')))::int,
  0, 'N8: no h3 column or helper survives (ADR-0023)');

SELECT throws_ok($$ INSERT INTO audit.events (actor_role, action, metadata)
                    VALUES ('test', 'test.bad', '{"fine_cell": "x"}'::jsonb) $$,
  '23514', NULL, 'N9: audit.events rejects a fine_cell metadata key (LP-11)');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ UPDATE public.gardens SET coarse_cell = NULL WHERE id = tests.fixture('owner_garden') $$,
  '42501', NULL, 'N10: owner cannot write coarse_cell (SPEC-004-T05)');
SELECT throws_ok($$ UPDATE public.gardens SET fine_cell = NULL WHERE id = tests.fixture('owner_garden') $$,
  '42501', NULL, 'N11: owner cannot write fine_cell (SPEC-004-T05)');
SELECT tests.clear_authentication();

-- Drift detection: corrupt one stored cell (valid format, wrong value). Rolled back with the file.
UPDATE public.gardens SET fine_cell = '320:0:0' WHERE id = tests.fixture('owner_garden');
SELECT throws_ok($$ SELECT private.check_location_tiers() $$,
  'P0001', NULL, 'N12: the nightly consistency check raises on tier drift');

SELECT * FROM finish();
ROLLBACK;
```

### 2.5 `src/` and scripts
- **`src/` has no h3 references** (verified with `git grep`). Nothing changes there.
- `packages/location-canary/src/index.ts:11`: the perl pass gives `/lat|lng|latitude|longitude|coord|point|geohash|fine_cell/i`.
- `scripts/ci-assert-*.sh` has no h3 references and needs no change. The negative-ratio gate just picks up the new file.

### 2.6 Docs

**Core docs, exact edits.**

**`docs/01-architecture/adr/ADR-0023-postgis-location-tiers.md` (new).** Write it from this outline. Every section is required by the ADR README rules.
- **Front matter:**
  - Status Accepted
  - Date 2026-10-22
  - Deciders: Corey (owner), Architecture, Security (review pending)
  - Supersedes [ADR-0005]
  - Superseded by —
- **Context:**
  - ADR-0005's choice and its own dissent.
  - CI evidence: runs 39803696654 and 39804036046 with the exact error. h3 is absent from Supabase's extension list; the old local harness had it only because it was installed by hand.
  - ADR-0005's revisit trigger "Supabase drops or fails to upgrade `h3-pg`" turned out to be true from the start.
  - D2: no migration has applied, so the change is edits, not a data migration.
  - What must survive: a named, auditable resolution per purpose; an internal tier that is never exposed; the analytics ceiling; the mechanical forbidden-column and egress checks.
- **Decision:**
  1. Geography is the only spatial representation. Distance and matching use `ST_DWithin`/`ST_Distance` on geography with GiST indexes. **No cell is ever used to select proximity candidates.**
  2. The tier table:

     | Tier | Cell | Area | Replaces | Purpose | Exposure | Stored |
     | --- | --- | --- | --- | --- | --- | --- |
     | region | 16 000 m | 256 km² | r5 ~253 km² | analytics and heatmaps; ceiling for anything analytical | yes (aggregates, PostHog `region_cell`) | not stored |
     | coarse | 2 500 m | 6.25 km² | r7 ~5.2 km² | coarse labels, surplus-alert origin | owner and server logic | `gardens.coarse_cell`, `profiles.home_coarse_cell` |
     | fine | 320 m | 0.10 km² | r9 ~0.105 km² | internal bucketing in definer functions | **never** | `gardens.fine_cell` |

     Each tier is at least as coarse as the H3 resolution it replaces, in area and in its smallest ground dimension.
  3. **§The grid:**
     - Formula: R = 6 371 008.8 m and 1° of latitude = 111 195.08 m. `row = floor((lat+90)/h)` with h = side/111195.08. Column width is set per row from the row-centre latitude. `col = floor((lng+180)/w)`.
     - Id is `side:row:col`.
     - Properties: deterministic and IMMUTABLE pure arithmetic, so a PROJ or spatial_ref_sys upgrade cannot move a cell. Cells are about side × side everywhere. The id carries its own resolution, which lets a CHECK pin each column to its tier.
     - Limits: rows are offset like brickwork; tiers do not nest, so roll-ups recompute from `exact_point` inside the database; the antimeridian column is partial; cells widen near the poles.
  4. **Why not `ST_SnapToGrid`:**
     - On degrees, the cell width shrinks with cos(lat): at 42°N it is 1.86 km E-W for 2.5 km N-S, 26% less area.
     - Per-point cos-corrected snapping (the approach in `app.quantize_lat_lng`) is not a partition. That is fine for a transient query origin and wrong for a stored label.
     - `ST_Transform` to EPSG:6933 + `SnapToGrid` is equal-area but the cells are 1.17×/0.86× at 42°N and 2×/0.5× at 60°N, so the smallest dimension shrinks. It also depends on spatial_ref_sys and PROJ.
  5. **Enforcement:**
     - Trigger-only writes; the 42501 reject trigger; no client INSERT/UPDATE grants on the cell columns.
     - A per-tier CHECK on each column.
     - `fine_cell` is column-revoked, swept by `location_tiers` N5, and named in the planned `ci:assert-no-forbidden-columns`.
     - Egress deny-lists: `h3_r[89]` → `fine_cell`; route params reject `_cell`.
     - The PostHog wrapper accepts only a `region_cell` matching `^16000:`.
     - The tier functions are not client-executable, and an unknown tier raises 22023.
     - Nightly `private.check_location_tiers()`.
- **LP mapping table:** copy §4 of this plan.
- **Alternatives considered:**
  - Keep H3 via self-hosting or a support request: not available on managed Supabase, which contradicts ADR-0004.
  - h3-js in Edge Functions: puts spatial logic outside the database (ADR-0003), and a derivation outside the trigger is skippable.
  - Geohash: the ADR-0005 reasoning still holds.
  - `ST_SnapToGrid` variants: as above.
  - No tiers at all: the dissent's extreme. Rejected by D1, which keeps the ladder.
- **Consequences:**
  - Positive: one spatial representation; the boundary-recall bug class is gone; no extension beyond PostGIS; the resolution is in the value; CHECK pins.
  - Negative: a bespoke grid we own (covered by `location_tiers` P1–P6); no hierarchy; `fine_cell` has no consumer yet; SPEC-020 matching must be re-specified.
  - Accepted: the coarse cell is about 20% larger than r7, so surplus targeting is slightly coarser.
- **The strongest argument against:** we replaced a documented, widely reviewed index with about 20 lines of our own arithmetic, in the one place where a silent error is a stalking risk. The grid has no hierarchy, so every aggregate must be recomputed next to `exact_point`. And keeping `fine_cell`, a 320 m box around a home with no consumer, is privacy cost kept only to preserve the shape of a ladder. Then the counter-argument, and a pointer to Q3.
- **Revisit when:**
  - p95 of `safe_spots_near` exceeds 400 ms on GiST. Profile first; any cell pre-filter must be verified with `ST_DWithin` and pass LP-12.
  - The drift check reports anything above 0.
  - A feature needs a tier hierarchy or rendered cells.
  - We have users beyond ±60° latitude or a metro on the antimeridian.
  - Supabase shipping h3 is **not** a trigger on its own.
- **Related:** ADR-0003, ADR-0004, ADR-0005, Location Privacy §3/§4/§7/§11, Data Model §6/§15.

**`ADR-0005-geospatial-model.md`.**
- Insert a banner under the H1, in the ADR-0013 style:
  ```
  > ## ⚠️ Superseded by [ADR-0023](ADR-0023-postgis-location-tiers.md)
  >
  > **Sharecropr is PostGIS-only.** On 2026-10-22 the first real CI run against Supabase's own Postgres image failed at the first migration with `ERROR: extension "h3" is not available (SQLSTATE 0A000)` (db.yml run 39803696654). This ADR's own dissent had already argued for PostGIS alone; ADR-0023 adopts it and keeps the privacy ladder as named PostGIS location tiers (r5 → region, r7 → coarse, r9 → fine).
  >
  > **Its decision is no longer in force.** It is retained because its reasoning about a named, auditable resolution ladder is exactly what ADR-0023 preserves.
  ```
- Front matter: Status `**Superseded**`; Superseded by `[ADR-0023](ADR-0023-postgis-location-tiers.md)`.
- Nothing else changes.

**`adr/README.md`.**
- Row 0005: Status `**Superseded** by [0023](ADR-0023-postgis-location-tiers.md)`, with the one-liner struck through as in row 0013.
- New row: `| [0023](ADR-0023-postgis-location-tiers.md) | **PostGIS location tiers** | Accepted | 2026-10-22 | PostGIS geography only; ST_DWithin + GiST for proximity; named tiers region 16 km / coarse 2.5 km / fine 320 m (never exposed); supersedes [0005](ADR-0005-geospatial-model.md) |`

**ADR-0004, ADR-0016, ADR-0018: a dated note under the front matter only.** Accepted ADRs are not rewritten.
- ADR-0004: `> **Note (2026-10-22):** \`h3-pg\` is not available on Supabase and was removed; see [ADR-0023](ADR-0023-postgis-location-tiers.md).`
- ADR-0016: the same pointer for the test environment line and the H3 line.
- ADR-0018: `> **Note (2026-10-22, [ADR-0023](ADR-0023-postgis-location-tiers.md)):** in the scrubber below, \`h3_r[89]\` is now \`fine_cell\`; the PostHog "H3 r5" cap is now the region tier (\`region_cell\`).`
- **Do not touch** ADR-0001, ADR-0013 or ADR-0019. Their H3 mentions are history.

**`docs/01-architecture/04-location-privacy.md`** (version 1.0.0 → 1.1.0; **this doc requires security review**):
- **§2 table:** row 2 becomes "…computes the fuzzed `display_point` and the location-tier cells (`coarse_cell`, `fine_cell`; [ADR-0023](adr/ADR-0023-postgis-location-tiers.md))". Row 4 becomes "…analytics capped at the region tier (16 km cells)".
- **§3 SQL:** `coarse_cell text, -- coarse tier, 2.5 km cell — safe to expose to the owner` and `fine_cell text; -- fine tier, 320 m cell — NEVER exposed`.
- **§3 callout:** "`fine_cell` is the internal tier. Proximity matching does not need it: `ST_DWithin` on `exact_point` inside definer functions does that exactly. It exists for bucketing inside `SECURITY DEFINER` functions and is never returned to a client: it is column-revoked, absent from every client-facing view and return type, and named in the forbidden-column sweep (`supabase/tests/location_tiers.test.sql`, N5)."
- **§4.3:** both SQL blocks become the §2.3 trigger and reject condition.
- **§5 analytics row:** "Region-tier cells (16 km, 256 km²) and coarser. Nothing finer, ever."
- **§7:** retitle to `## 7. Location tiers` and replace the body. The table maps tier → used for → exposed:
  - PostGIS `geography`: exact distance, all proximity (`ST_DWithin` + GiST), safe-spot distance → only safe-spot points.
  - coarse 2.5 km: `gardens.coarse_cell`, `profiles.home_coarse_cell`, surplus-alert origin → owner and server logic.
  - fine 320 m: internal bucketing → **Never**.
  - region 16 km: analytics and heatmaps (`region_cell`) → Yes.

  Then this paragraph: "**No cell is a proximity filter.** 'What is near X' is answered with `ST_DWithin` on geography, never by comparing cell ids, because a cell lookup silently misses everything just over an edge. This removes the boundary-recall trap rather than testing around it. LP-12 / [TC-GEO-07](../04-testing/03-geospatial-test-plan.md) remain as the regression guard against anyone reintroducing a cell pre-filter."
- **§8:** Sentry regex as in §2.1. PostHog: "Spatial properties are capped at the region tier: only `region_cell` is accepted." CSV: "Growth experiments get the region tier."
- **§11 LP-12:** `| LP-12 | Radius recall: a safe spot 10 m beyond a coarse-cell edge is still returned by \`safe_spots_near\` (no cell pre-filter) | pgTAP |`
- **Change Log:** `| 2026-10-22 | 1.1.0 | Architecture + Security | H3 removed ([ADR-0023](adr/ADR-0023-postgis-location-tiers.md)): location tiers region/coarse/fine replace H3 r5/r7/r9; §2, §3, §4.3, §5, §7, §8 and LP-12 updated. Security review pending (Corey) |`

**`docs/01-architecture/03-data-model.md`** (1.4.0 → 1.5.0):
- **§3:** delete `CREATE EXTENSION IF NOT EXISTS h3;` and add the comment `-- No h3: PostGIS only (ADR-0023)`.
- **§5:** `home_coarse_cell` row: `| \`home_coarse_cell\` | \`text\` | NULL, CHECK \`~ '^2500:[0-9]+:[0-9]+$'\` | P1 | Coarse-tier cell (2.5 km, [ADR-0023](adr/ADR-0023-postgis-location-tiers.md)). For matching and analytics inside the database. Never a point; returned to no client |`. The index rename and callout are already handled by perl.
- **§6 gardens rows:**
  - `coarse_cell`: P2, "Coarse tier (2.5 km). Trigger-derived; owner/moderator-readable; never client-writable".
  - `fine_cell`: P1, "Fine tier (320 m). Internal only: column-revoked, never returned to a client".
  - Both carry their CHECK.
  - Delete the `gardens_h3_r9_idx` line.
  - `captured_fine_cell`: "Fine-tier cell where the photo was taken, compared against the garden's `fine_cell`".
- **§9:** delete the `h3_r8` row and the `safe_spots_h3_idx` line.
- **§14:** "25 months, region tier (16 km) max spatial resolution".
- Change Log row.

**`05-rls-design.md`** (1.1.1 → 1.2.0): perl handles lines 162 and 181. Add a Change Log row.

**`AGENTS.md`:**
- **§3.1:** append "Location is PostGIS-only with named tiers ([ADR-0023](docs/01-architecture/adr/ADR-0023-postgis-location-tiers.md)); `fine_cell` never leaves the database."
- **§4 CI sentence:** replace "…**not green yet**, it stops at the first migration error until WP-08…WP-11 land" with "…its first real runs (2026-10-22) stopped at the `h3` extension, removed in WP-DB-BASELINE (ADR-0023)".
- **§6:** new row `| ~~H3 vs PostGIS-only~~ | **Resolved 2026-10-22**: PostGIS only, named location tiers, [ADR-0023](docs/01-architecture/adr/ADR-0023-postgis-location-tiers.md) (supersedes ADR-0005) |`.
- **§7, new top line:**
  `` - `[2026-10-22] [claude] H3 is gone: Supabase's Postgres image has no h3 extension (db.yml run 39803696654). ADR-0023 supersedes ADR-0005: PostGIS geography only; proximity is ST_DWithin + GiST, never a cell filter. Tiers come from app.location_cell(): region 16 km (analytics), coarse 2.5 km (gardens.coarse_cell, profiles.home_coarse_cell), fine 320 m (gardens.fine_cell, never client-reachable); each column CHECK-pins its tier prefix. Migrations up to 20261022145504 were edited in place because none had applied anywhere (Data Model §15 rule 12); forward-only from the first hosted apply.` ``

  `AGENTS.md` stays around 157 lines.

**Long tail: apply the perl pass, then the §2.2 term map.**
- For each file that has a Version header: bump the minor version where a MUST, MUST NOT or test row changed, the patch version for prose only, and add a Change Log row `H3 removed; renamed to location tiers per ADR-0023`.
- In "Related ADRs" front matter, replace links to ADR-0005 with ADR-0023.

| File | Lines (at a13ada4) / special handling |
| --- | --- |
| `00-foundation/04-glossary.md` | 54: replace with a **Location tier** entry (region/coarse/fine, sizes, "fine never leaves the server"), and keep `\| **H3** \| Removed 2026-10-22 ([ADR-0023](…)); formerly the hexagonal cell index. See Location tier. \|`. 55: becomes **Radius recall** |
| `00-foundation/05-nfr.md` | NFR-61: "capped at the region tier (16 km, ADR-0023)" |
| `01-architecture/01-system-architecture.md` | 183: `\| Geospatial \| PostGIS 3.4 (geography + GiST), named location tiers \| — \| [ADR-0023](…) \|`. 336, item 4: rewrite as "Location tiers are derived labels that could drift from `exact_point`; nightly `private.check_location_tiers()` raises on drift. The boundary-recall bug class ADR-0005 predicted is gone because no query filters by cell ([ADR-0023](…))" |
| `01-architecture/02-mobile-architecture.md` | 512: route regex `\|h3/i` → `\|_cell/i` |
| `01-architecture/06-api-contract.md` | 44, 347, 715, 1029, 1042 |
| `02-security/01-threat-model.md` | 32 (`gardens.fine_cell`, "320 m box around a home"), 118, 146, 227 |
| `02-security/04-privacy-and-data-retention.md` | 38, 57, 79, 119, 172, 214, 218 |
| `03-specs/SPEC-001` | 415, 547 (ride on the P1 version bump; add the row) |
| `03-specs/SPEC-004` | All hits, including "H3 r9 cell" → "fine-tier cell" (R27, R32) and N24 "coarse cells". 1.0.0 → 1.1.0 |
| `03-specs/SPEC-005, 006, 007, 012, 021, 022, 023` | `h3_*` → `*_cell` and the identifier renames |
| `03-specs/SPEC-008` | 73, 469 (EC-05: "Not reachable: `safe_spots_near` uses `ST_DWithin` only, never a cell (ADR-0023)"), 608, plus any perl hits |
| `03-specs/SPEC-009` | 723 and perl hits |
| `03-specs/SPEC-013` | 74 (key list → `fine_cell`), 93 (`\|h3/i` → `\|_cell/i`), 186 (regex) |
| `03-specs/SPEC-020` | Add a banner under the front matter: `> ⚠ **Pending re-specification (2026-10-22).** [ADR-0023](…) removed H3. Columns below are renamed to location tiers, but the candidate-set mechanism (\`cell_set\`, formerly a hexagonal disk) must be re-specified before build. Open question in ADR-0023.` Then: R35 "H3 **r7** cell" → "**coarse**-tier cell", and "r7 parent of a safe spot" → "coarse cell of a safe spot (`app.location_cell(point,'coarse')`)". R37 `h3_grid_disk(center_coarse_cell, k)…` → "the set of coarse cells within `radius_km` of the centre cell (mechanism pending, see banner)". R38 `safe_spots.h3_r8 → r7 parent ∈ cell_set` → "`app.location_cell(safe_spots.point,'coarse')` ∈ `cell_set`". §7.7 line 437 to match. 662 "finer than the region tier". 768 "finer than the coarse tier". 1.0.0 → 1.1.0 |
| `04-testing/01-test-strategy.md` | 54: "distance and location-tier helpers" |
| `04-testing/02-rls-test-plan.md` | 91 |
| `04-testing/03-geospatial-test-plan.md` | 16: "Real PostGIS 3.4". §3 retitled "Radius recall". GEO-07 text "coarse-cell edge"; the SQL is unchanged. TC-GEO-08: `**Retired 2026-10-22** ([ADR-0023](…)): there is no cell disk; proximity is ST_DWithin.` TC-GEO-10: `coarse_cell` may appear (owner/moderator), **`fine_cell` may not**, analytics carries only `region_cell`. TC-GEO-23: "location_cell derivation p95 < 5 ms". TC-GEO-28: "Retired 2026-10-22 (ADR-0023): safe spots carry no cell column". 1.0.0 → 1.1.0 |
| `05-operations/01-environments.md` | 29: drop "+ h3" |
| `05-operations/02-cicd.md` | 93, 129: `fine_cell` replaces `h3_r9`. Patch bump |
| `05-operations/04-observability.md` | 20, 34, 163 (region tier). Replace the 173–175 snippet with: `for (const key of Object.keys(clean)) { if (/_cell$/.test(key) && !(key === 'region_cell' && /^16000:\d+:\d+$/.test(String(clean[key])))) { logger.error('analytics: spatial property finer than the region tier rejected', { event }); delete clean[key]; } }` |
| `06-roadmap/01-roadmap.md` | 104: "Coarse region-tier heatmap" |
| `06-roadmap/02-open-risks.md` | 144: "region-tier analytics rule". R-12: add `**Status: Retired 2026-10-22** ([ADR-0023](…)): there is one spatial model; proximity never filters by cell.` under the heading, and make the first body paragraph read "PostGIS geography plus a hexagonal cell index (ADR-0005, superseded by ADR-0023) meant…" |
| `06-roadmap/03-delivery-backlog.md` | 178: SCR-0203 "…and the location-tier/geohash quantization helpers (ADR-0023)". The key is unchanged |

---

## 3. The tier scheme in one place (what the ADR justifies)
- **Grid.** Banded equal-area square grid on the mean-radius sphere. Constant row height. Each row's column width is fixed from that row's centre latitude, so the grid is a true partition and cells are about side × side on the ground at every latitude. The formula is in §2.3.
- **Id.** `'<side_m>:<row>:<col>'`, e.g. the seed owner's coarse cell is `2500:5883:3168`. Because the resolution is in the value, a CHECK constraint can make a stored column physically unable to hold a finer tier.
- **Sizes.** Each is at least the H3 area it replaces, and the smallest ground dimension is at least as large:

  | Tier | Side | Area | H3 equivalent |
  | --- | --- | --- | --- |
  | region | 16 km | 256 km² | r5 ~253 km² |
  | coarse | 2.5 km | 6.25 km² | r7 ~5.16 km², ~2.1 km across |
  | fine | 320 m | 0.1024 km² | r9 ~0.105 km² |

  Exposable data therefore got no finer.
- **Why not `ST_SnapToGrid`.** Degree grids shrink with latitude. Per-point cos snapping is not a partition. `ST_Transform` to an equal-area SRID distorts shape and depends on PROJ and spatial_ref_sys.

## 4. LP-01…LP-13 under ADR-0023 (goes into ADR-0023 as well)

| LP | Under ADR-0005 | Under ADR-0023 | Where asserted |
| --- | --- | --- | --- |
| LP-01 | No client privilege on `private` | Unchanged | location_privacy LP-01, structural_sweeps |
| LP-02 | Definer allowlist | Unchanged. New definer that reads `private`: `private.check_location_tiers` (add it when the allowlist is built, WP-13/WP-19). `location_cell` is not a definer and reads nothing | `ci:assert-definer-allowlist` (stub) |
| LP-03 | No client function returns private geography; `h3_r9` forbidden column | Unchanged; the forbidden-column sweep now names `fine_cell`, `exact_point`, `fuzz_seed` | location_privacy LP-03; location_tiers N5 |
| LP-04…07 | Fuzz band, stability, averaging, bearing | Unchanged (`display_point` is untouched) | location_privacy |
| LP-08 | Sentry regex `h3_r[89]` | `fine_cell` | Jest (`skip('SCR-1701…')` in pgTAP) |
| LP-09 | EXIF | Unchanged | SCR-0604 |
| LP-10 | Canary `FORBIDDEN_KEY` `h3_r[89]` | `fine_cell` | packages/location-canary |
| LP-11 | jsonb key CHECK `h3_r[89]` | `fine_cell` | location_privacy LP-11; location_tiers N9 |
| LP-12 | Cell-boundary recall (disk sizing) | Radius recall: no cell pre-filter; a spot 10 m across a coarse-cell edge is returned | `skip('SCR-0804…')` until safe_spots exist |
| LP-13 | API response sweep | Unchanged; forbidden names `fine_cell`, `exact_point`, `fuzz_seed` | WP-19 |

New database-enforced controls: per-tier CHECK constraints (location_tiers N2–N4), tier sizes asserted (P1, P4–P6), tier functions not client-callable (N6), nightly drift job (P7, N12).

---

## 5. Phase P3 (C3): `extensions.digest`

In `20260822000005_idempotency.sql`, the plpgsql `idempotency_probe` around line 37 and the SQL `idempotency_record` around line 48 both change `digest(p_args::text, 'sha256')` → `extensions.digest(p_args::text, 'sha256')`. Nothing else changes: `0003` `derive_display_point` already has `extensions` on its search_path.

## 6. Phase P4 (C4): WP-09, Vault

**`20260822000006_vault_handoff_key.sql`, whole file:**
```sql
-- SCR-0208: handoff_code_key accessor (Exchange State Machine §3.3, Environments §6).
-- Edited in place before first apply (Data Model §15 rule 12): the local placeholder secret moved to
-- supabase/seed.sql so no hosted project ever receives it, and the invalid
-- COMMENT ON FUNCTION vault.get_secret (Supabase Vault has no such function) is gone.

CREATE OR REPLACE FUNCTION private.get_handoff_key()
RETURNS text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_key text;
BEGIN
  SELECT s.decrypted_secret INTO v_key
    FROM vault.decrypted_secrets s
   WHERE s.name = 'handoff_code_key'
   LIMIT 1;
  IF v_key IS NULL OR v_key = '' THEN
    -- Fail closed: there is no fallback key, ever (SPEC-010 R30; client mapping is SCR-1216).
    RAISE EXCEPTION 'handoff_key_unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION private.get_handoff_key() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.get_handoff_key() IS
  'The only read path for handoff_code_key, for get_handoff_code / accept_exchange_request. '
  'No client EXECUTE. Raises handoff_key_unavailable (55000) when absent. Custody: Environments §6.';
```

**`supabase/seed.sql`.** Append at the end:
```sql
-- SCR-0208: local/CI placeholder for the handoff key. Never in a migration: hosted projects get their
-- key through the custody procedure (Environments §6), and get_handoff_key() fails closed without it.
SELECT vault.create_secret('local-dev-handoff-key-replace-before-production', 'handoff_code_key',
       'Symmetric key for pgp_sym_encrypt on exchange_sessions.handoff_code (local/CI placeholder)')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'handoff_code_key');
```

**New `supabase/tests/vault_handoff_key.test.sql`** (`plan(8)`: S1, P1, N1–N6):
```sql
-- SCR-0208 (WP-09): private.get_handoff_key() is the only read path for handoff_code_key.
-- Tags: SPEC-010-R30, SCR-1216 (fail closed). Key material never reaches TAP output.
BEGIN;
SELECT plan(8);

SELECT ok((SELECT p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
             FROM pg_proc p WHERE p.oid = 'private.get_handoff_key()'::regprocedure),
  'S1: get_handoff_key is SECURITY DEFINER with a pinned search_path');

SELECT ok(extensions.pgp_sym_decrypt(extensions.pgp_sym_encrypt('424242', private.get_handoff_key()),
                                     private.get_handoff_key()) = '424242',
  'P1: owner round trip with the seeded key returns the plaintext (SPEC-010-R30)');

SELECT ok(NOT has_function_privilege('anon', 'private.get_handoff_key()', 'EXECUTE'),
  'N1: anon cannot execute get_handoff_key');
SELECT ok(NOT has_function_privilege('authenticated', 'private.get_handoff_key()', 'EXECUTE'),
  'N2: authenticated cannot execute get_handoff_key');
SELECT ok((SELECT p.proacl IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
             FROM pg_proc p WHERE p.oid = 'private.get_handoff_key()'::regprocedure),
  'N3: PUBLIC holds no EXECUTE on get_handoff_key');
SELECT ok(NOT has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')
      AND NOT has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT'),
  'N4: client roles cannot read vault.decrypted_secrets directly');

SELECT tests.authenticate_as('owner');
SELECT throws_ok($$ SELECT private.get_handoff_key() $$, '42501', NULL,
  'N5: a signed-in client calling get_handoff_key is denied');
SELECT tests.clear_authentication();

-- Fail closed (SCR-1216). Rolled back with the file.
DELETE FROM vault.secrets WHERE name = 'handoff_code_key';
SELECT throws_ok($$ SELECT private.get_handoff_key() $$, '55000', 'handoff_key_unavailable',
  'N6: get_handoff_key fails closed when the key is absent');

SELECT * FROM finish();
ROLLBACK;
```
**Known CI risk F1.** If `postgres` lacks DELETE on `vault.secrets` in the CLI image, the file aborts at the DELETE. The sanctioned fix is to replace the DELETE and N6 with `SELECT skip('SCR-0208: fail-closed path needs DELETE on vault.secrets; verified by code review only');`. The plan stays 8, and the gate then counts P=1, N=5.

**Docs:** replace `vault.get_secret('handoff_code_key')` with `private.get_handoff_key()` in:
- `07-exchange-state-machine.md`, lines 134, 137, 158 and 305. Line 173: "If the Vault key is unavailable, `private.get_handoff_key()` raises `handoff_key_unavailable` (SQLSTATE 55000) and both … fail…". Keep the SCR-1216 sentence. Version 1.1.0 → 1.2.0.
- `SPEC-010`, lines 358, 379 and 536. Version 1.2.0 → 1.2.1.
- `05-runbooks.md` Runbook 14 step 3: the old key comes from `private.get_handoff_key()`; the new key from `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'handoff_code_key_next')`. Version 1.0.0 → 1.0.1.
- `03-delivery-backlog.md:441` AC wording.
- `01-environments.md:112`: "provisioned locally by `supabase/seed.sql` (placeholder, never in a migration); hosted projects via the custody procedure. Read only through `private.get_handoff_key()` (definer, no client EXECUTE, fails closed)…". Version 1.2.0.
- `AGENTS.md` §6 N-03 row: `| ~~Who can read \`handoff_code_key\`~~ | **Resolved 2026-10-22**: only definer RPCs via \`private.get_handoff_key()\` (no client EXECUTE, fails closed); custody in [Environments §6](docs/05-operations/01-environments.md) |`. Per the queue, this records what Environments §6 already documents; it is not a new decision.

## 7. Phase P5 (C5): WP-11
1. Confirm the current `supabase/tests/location_privacy.test.sql` equals `origin/develop`.
2. `cp docs/07-review/04-backlog-execution/plans/WP-11-files/location_privacy.test.sql supabase/tests/location_privacy.test.sql`. Its sha256 must be `fa746f70c2ac67f3add0bdc849cf78cc9bb909c73ab97db5b43982e70544ab08`.
3. Adapt it to the tiers:
   ```
   perl -pi -e 's/LP-12 cell-boundary recall needs safe_spots/LP-12 radius recall across a coarse-cell edge needs safe_spots/' supabase/tests/location_privacy.test.sql
   ```
4. Result: `plan(15)`, P=0, N=10.

WP-11 §1–§6 explains everything else in this step.

## 8. Phase P6 (C6): backlog bookkeeping

**`queue.json`.** It is serialized exactly as `json.dumps(q, indent=1)`, with ASCII escapes and no trailing newline. Edit it with python3:
- Insert a `WP-DB-BASELINE` entry directly after `WP-12a`:
  - `jira_keys`: ["SCRUM-35","SCRUM-36","SCRUM-41","SCRUM-44"]
  - `backlog_keys`: ["SCR-0201","SCR-0208","SCR-0203","SCR-0210"]
  - `class`: "do"
  - `title`: "DB baseline: 14-digit migrations + break_glass, H3 removed for PostGIS location tiers (ADR-0023), digest + Vault accessor, LP-06"
  - `position_reason`: "Absorbs WP-08..WP-11 (D1/D2, 2026-10-22). db.yml runs 39803696654/39804036046 stop at 20260822_0001 on extension h3."
  - `scope`: a summary of §0.2.
  - `files`: the §12 list.
  - `verify`: ["local gates (plan §10)", "draft PR to develop: app + db green"]
  - `skills`: ["deprecation-and-migration","security-and-hardening","test-driven-development","documentation-and-adrs","ci-cd-and-automation","debugging-and-error-recovery"]
  - `risks`: "Real supabase_vault privileges (F1); run-pgtap uses `supabase db test` (F2, WP-12 owns it). Location Privacy/RLS Design need security review."
  - `remaining_after`: "WP-12 broken-policy fixture; break-glass provisioning (no key); SPEC-020 matching re-spec; alert routing for location_tier_consistency; LP-02 allowlist (WP-13/19)."
- On WP-08, WP-09, WP-10 and WP-11, set `"class": "absorbed"` and add `"absorbed_into": "WP-DB-BASELINE"`. Change nothing else; nothing is deleted.
- WP-12 and WP-14: replace "WP-08/09/10/11" and "WP-11" in `position_reason` with "WP-DB-BASELINE".
- `decided`: add `"D1-2026-10-22": "Drop H3; PostGIS only; ADR-0023 supersedes ADR-0005 (evidence: db.yml run 39803696654)."` and `"D2-2026-10-22": "Edit never-applied migrations in place; forward-only from the first hosted apply (Data Model §15 rules 1, 12)."`
- Check: `python3 -c "import json;s=open(P).read();assert json.dumps(json.loads(s),indent=1)==s"`.

**`README.md` (04-backlog-execution):**
- Decisions table: add rows for D1 and D2.
- Status: WP-08…WP-11 are absorbed into WP-DB-BASELINE (planned in `plans/WP-DB-BASELINE.md`).
- Open question 1: keep the text struck through and add "**Decided 2026-10-22 (D2):** never-applied migrations are edited in place; Data Model §15 rule 12".
- Open question 2: "**Resolved:** WP-DB-BASELINE C3".
- Database findings: add "2026-10-22: h3 is not in the Supabase image (run 39803696654); D1 removed H3 (ADR-0023)."

**`harness-baseline.md`.** Append a `## Superseded (2026-10-22, WP-DB-BASELINE)` section:
- #0 is fixed by the rename.
- #1 and #4 are obsolete (H3 removed).
- #2 is fixed by `extensions.digest`.
- #3 is fixed by `get_handoff_key`.
- LP-06 is fixed by WP-11.
- The harness is no longer the oracle; CI is.

---

## 9. CI loop (integrator)

```bash
BR=wp/WP-DB-BASELINE
git push -u origin HEAD:$BR
gh pr create --draft --base develop --head $BR \
  --title "DB baseline: PostGIS location tiers (ADR-0023), 14-digit migrations, Vault accessor, LP-06" \
  --body-file .wp-pr-body.md
PR=$(gh pr view $BR --json number -q .number)
SHA=$(git rev-parse HEAD)
RID=$(gh run list --workflow db.yml --branch $BR -L5 --json databaseId,headSha \
       -q "map(select(.headSha==\"$SHA\"))[0].databaseId")   # retry for ~60 s until set
gh run watch "$RID" --exit-status        # run in the background or Monitor; it takes up to 30 min
gh pr checks "$PR"                       # app must also be green
```

**When db fails, read the error:**
```bash
gh run view "$RID" --log | grep -E "Applying migration|Seeding|ERROR|SQLSTATE|At statement" | head -40
gh run view "$RID" --log | grep -E "not ok|Failed test|# +(got|expected|have|want)|Parse errors|Dubious|Result:|\.test\.sql" | head -80
gh run view "$RID" --log-failed | tail -80
```
- The last `Applying migration X` line before `ERROR` names the file.
- `At statement: N` is the 0-based statement index inside that file.
- For pgTAP, the `supabase/tests/<file>.test.sql ..` line before `not ok` names the file.

**When app fails:** `gh run view <app-run-id> --log-failed | tail -80`. Fix lint, doc-gates or Jest in place.

**Rules:**
- **Classify** each failure:
  - **(A) Caused by the package:** a SQL, seed, plan-count or test error. Fix it in place (D2 allows this for any migration in this PR), add a commit `fix(db): <what> (CI iteration N)` with the trailer, push, and repeat.
  - **(B) Infrastructure:** CLI download, Docker pull, runner timeout. Run `gh run rerun "$RID"` once. This does not count as an iteration.
  - **(C) Out of bounds: STOP.** The fix would need `db.yml`, `run-pgtap.sh` or `config.toml`; would change a tier name or size, a CHECK, a grant, or location semantics; or would weaken, remove or `skip()` an assertion. The one exception is the documented F1 fallback.
- **Maximum 5 fix iterations.** Stop and report if:
  - 5 iterations are used up;
  - the same error comes back after its fix;
  - a (C) case appears;
  - **F2:** `supabase db test` is not a valid command in CLI 2.120.0, so `db:test` fails before any pgTAP runs. That needs `run-pgtap.sh`, which WP-12 owns.

  The report gives the run id, the failing step, the first `ERROR` line(s), the files touched so far, and a proposed fix.
- **Never paste a coordinate, a `fine_cell` value or key material** from logs into the PR, Jira or the report.
- **Merging.** The PR merges only when `app` is green. **Recommendation: require `db` green as well.** That green run is the whole point of the package and is SCRUM-35's acceptance criterion. Also require Corey's review, because Location Privacy, RLS Design and ADR-0023 are "security review required" docs.
  - When both checks are green, run `gh pr ready "$PR"` and ask Corey to approve.
  - Merge with `gh pr merge "$PR" --rebase`, or `--merge` if rebase-merge is disabled. **Never squash.**
  - If db cannot go green within the limits, leave the PR as a draft, set the Jira tickets to the partial text, and report.

## 10. Local verification (executor; record the outputs)

| # | Command | Expected |
| --- | --- | --- |
| V0 | `ls supabase/.temp; git grep -nE "db push\|supabase link\|PROJECT_REF" -- .github scripts package.json` | no `project-ref`; no matches |
| V1 | `ls supabase/migrations \| sed 's/_.*//' \| sort \| uniq -d \| wc -l`; `… \| grep -cvE '^[0-9]{14}$'`; `ls supabase/migrations \| tail -2` | `0`; `0`; `20261022145504_…` then `<TS>_break_glass_role.sql` |
| V2 | H3 gate: `git grep -n -I -E '(\bh3\b\|\bH3\b\|h3_\|_h3\|h3-pg\|h3Resolution\|k_for_radius)' -- . ':!package-lock.json' ':!.cursor' ':!docs/07-review' ':!docs/01-architecture/adr' \| grep -v -E 'ADR-0023\|### H3 \|\*\*H3 — \|\(H3\)\|^[^:]+:[0-9]+:\| 20[0-9]{2}-'` | **empty**. Then list the lines this filter allowed (`… \| grep -E 'ADR-0023'`) in the report; each must be a retirement note |
| V3 | `git grep -n "create_secret\|get_secret" -- supabase/migrations`; `git grep -n "vault.get_secret" -- . ':!docs/07-review' ':!docs/01-architecture/adr'` | none; none |
| V4 | `git grep -nE "[^.]digest\(" -- supabase/migrations` | only `0003` `derive_display_point` (its search_path includes `extensions`) |
| V5 | For each new or changed test file, compare `plan(N)` with `grep -cE "^SELECT (ok\|is\|isnt\|throws_ok\|lives_ok\|skip\|pass\|col_is_pk\|col_isnt_pk\|cmp_ok)\("` | location_tiers 19/19; vault 8/8; roles 12/12; location_privacy 15/15; rls_gardens 30/30; rls_column_privileges 22/22; rls_profiles unchanged |
| V6 | `npm run ci:assert-negative-ratio` | OK for every file, including `location_tiers P=7 N=12`, `vault_handoff_key P=1 N=6`, `roles_break_glass P=1 N=11`, `location_privacy P=0 N=10` |
| V7 | `npm run ci:assert-no-private-grants && npm run ci:assert-definer-allowlist && npm run ci:assert-rls` | exit 0 |
| V8 | `npm test && npm run lint && npm run lint:fixtures && npm run typecheck` | exit 0 |
| V9 | `npm run ci:doc-gates && npm run test:doc-gates && npm run ci:validate-map-style` | exit 0 |
| V10 | `./scripts/agent-memory-bridge.sh check`; `wc -l AGENTS.md` | intact; ≤ 160 |
| V11 | The queue.json round-trip check (§8) | passes |
| V12 | `cat .wp-trees` | 6 lines, P1…P6 |
| V13 | After the integrator builds C1: `git show -M --stat HEAD~5` | 10 renames at 100%, plus the new migration, test and docs |

## 11. Commit messages

Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**C1**
```
fix(db): unique 14-digit migration versions, migration convention, break_glass role

The Supabase CLI keys supabase_migrations.schema_migrations on the digits
before the first underscore, so the eight 20260822_000N_* files all had
version 20260822. Rename the ten pre-convention migrations to
YYYYMMDD00NNNN_* (date unchanged, HHMMSS = old ordinal), which keeps their
order and short references. Pure renames: contents unchanged in this
commit. 20261022145504_account_deletions_history.sql already conforms.

Data Model §15 now documents the convention: 14-digit UTC versions,
forward-only once a migration has applied to a non-disposable database
(SCRUM-18), recorded in-place edits for migrations that never applied
(decided 2026-10-22), one concern per file, test in the same PR, and
idempotent zero-privilege roles.

Create the break_glass role NOLOGIN with no grants (RLS Design §2);
roles_break_glass.test.sql asserts it holds nothing. Grants come only
from the break-glass provisioning procedure, which is not built.

Refs: SCRUM-35 (SCR-0201), SCRUM-18

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C2**
```
feat(db): replace H3 with PostGIS location tiers (ADR-0023 supersedes ADR-0005)

Supabase's Postgres image has no h3 extension. The first real db.yml run
(39803696654) stopped at 20260822000001_baseline.sql with
ERROR: extension "h3" is not available (SQLSTATE 0A000).

PostGIS geography is now the only spatial model. Distance and matching use
ST_DWithin/ST_Distance on geography with GiST indexes, and no cell is ever
a proximity filter. ADR-0005's privacy ladder becomes named tiers computed
in the database by app.location_cell() on a banded equal-area square grid:
region 16 km (was r5), coarse 2.5 km (was r7), fine 320 m (was r9, never
exposed). Each tier is at least as coarse as the H3 resolution it replaces.

- gardens.h3_r7/h3_r9 become coarse_cell/fine_cell, and
  profiles.home_h3_r7 becomes home_coarse_cell. Each column has a CHECK
  that pins it to its tier.
- private.sync_garden_derived_location derives both cells from
  exact_point. app.k_for_radius and the h3 extension are gone.
- The egress deny-lists (audit jsonb CHECK, Sentry scrubber, location
  canary) block fine_cell where they blocked h3_r[89].
- Nightly private.check_location_tiers() raises on drift and reports a
  count only.
- location_tiers.test.sql covers tier sizes, trigger derivation, CHECK
  pins, the forbidden-column sweep, privileges and drift (P=7, N=12).

Migrations 000001-000004, 000009, 000010 and 20261022145504 (comments only)
are edited in place: none has ever applied anywhere (Data Model §15
rule 12, decided 2026-10-22). Location Privacy 1.1.0, RLS Design 1.2.0
and ADR-0023 need security review.

Refs: SCRUM-41 (SCR-0203), ADR-0023

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C3**
```
fix(db): qualify extensions.digest in idempotency helpers

pgcrypto lives in the extensions schema, but app.idempotency_probe and
app.idempotency_record pin search_path to pg_catalog, private, public, so
digest() did not resolve ("function digest(text, unknown) does not
exist"). Edited in place: 20260822000005 has never applied (Data Model
§15 rule 12).

Refs: SCRUM-41

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C4**
```
fix(db): Vault handoff key accessor that fails closed; placeholder moves to seed

Supabase Vault has no vault.get_secret, so 20260822000006's COMMENT ON
FUNCTION vault.get_secret failed. That file also wrote a placeholder key
into every database it applied to, including hosted ones.

- private.get_handoff_key() is SECURITY DEFINER with search_path =
  pg_catalog, reads vault.decrypted_secrets, and raises
  handoff_key_unavailable (55000) when the key is absent. No client
  EXECUTE.
- The placeholder secret moves to supabase/seed.sql (local/CI only).
- vault_handoff_key.test.sql covers the round trip, privileges and the
  fail-closed path (P=1, N=6).
- SPEC-010, Exchange State Machine §3.3, Runbook 14, Environments §6 and
  the AGENTS.md §6 N-03 row now name the accessor.

Edited in place: 20260822000006 has never applied (Data Model §15 rule 12).

Refs: SCRUM-36 (SCR-0208)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C5:** the WP-11 message from `plans/WP-11.md`, verbatim, with three changes:
- Add the line "LP-12's skip now reads 'radius recall across a coarse-cell edge' (ADR-0023)."
- Drop the `Claude-Session` line.
- Keep `Jira: SCRUM-44`.

**C6**
```
docs(backlog): WP-DB-BASELINE absorbs WP-08..WP-11; D1/D2 recorded

queue.json gains WP-DB-BASELINE after WP-12a. WP-08..WP-11 are marked
absorbed (kept, not deleted). D1 (drop H3) and D2 (edit never-applied
migrations in place) are recorded as decided. README open question 1 is
decided and question 2 is resolved. harness-baseline findings are marked
superseded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**`.wp-pr-body.md`:** a summary of C1–C6, the LP mapping table (§4), "Security review required: Location Privacy 1.1.0, RLS Design 1.2.0, ADR-0023", the open questions (§14), and the db/app run links. It ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 12. Every file to change

- **Renamed, then edited:** `supabase/migrations/20260822000001…000006`. Renamed only: `…000007`, `…000008`. Renamed, then edited: `20260828000009`, `20261021000010`.
- **Edited:** `20261022145504_account_deletions_history.sql` (comments).
- **New:**
  - `supabase/migrations/<TS>_break_glass_role.sql`
  - `supabase/tests/roles_break_glass.test.sql`
  - `supabase/tests/location_tiers.test.sql`
  - `supabase/tests/vault_handoff_key.test.sql`
  - `docs/01-architecture/adr/ADR-0023-postgis-location-tiers.md`
- **Edited tests and seed:** `supabase/tests/{rls_column_privileges,rls_gardens,rls_profiles,location_privacy}.test.sql`, `supabase/seed.sql`.
- **Code:** `packages/location-canary/src/index.ts`.
- **Agent memory:** `AGENTS.md`.
- **Architecture docs:**
  - `docs/01-architecture/{03-data-model,04-location-privacy,05-rls-design,01-system-architecture,02-mobile-architecture,06-api-contract,07-exchange-state-machine}.md`
  - `docs/01-architecture/adr/{ADR-0004,ADR-0005,ADR-0016,ADR-0018,README}.md`
- **Foundation and security:** `docs/00-foundation/{04-glossary,05-nfr}.md`, `docs/02-security/{01-threat-model,04-privacy-and-data-retention}.md`.
- **Specs:** `docs/03-specs/SPEC-{001,004,005,006,007,008,009,010,012,013,020,021,022,023}-*.md`.
- **Testing:** `docs/04-testing/{01-test-strategy,02-rls-test-plan,03-geospatial-test-plan}.md`.
- **Operations:** `docs/05-operations/{01-environments,02-cicd,04-observability,05-runbooks}.md`.
- **Roadmap:** `docs/06-roadmap/{01-roadmap,02-open-risks,03-delivery-backlog}.md`.
- **Review and backlog:** `docs/07-review/02-development-notes.md` (filename only), `docs/07-review/04-backlog-execution/{queue.json,README.md,harness-baseline.md}`.
- **Not touched:** `.github/workflows/*`, `scripts/run-pgtap.sh`, `scripts/ci-assert-*.sh`, `supabase/config.toml`, `supabase/seed_harness.sql`, `src/**`.

## 13. Jira (integrator; substitute `<sha>`, `<PR>`, `<run>`)

- **SCRUM-35, Done.** "Done — merged to develop in <sha> (PR #<PR>): every migration has a unique 14-digit version (ten renamed to YYYYMMDD00NNNN_*, order preserved). db.yml run <run> applies all migrations and both seeds cleanly. Data Model §15 documents the convention: forward-only once applied to a non-disposable DB (SCRUM-18), recorded in-place window for never-applied migrations (D2). break_glass is NOLOGIN with zero grants, plus roles_break_glass pgTAP (P=1, N=11). Open elsewhere: break-glass provisioning has no backlog key."
- **SCRUM-36, Done.** "Done — <sha>: private.get_handoff_key() (SECURITY DEFINER, reads vault.decrypted_secrets, no client EXECUTE, fails closed with handoff_key_unavailable/55000). Placeholder key moved from 20260822000006 to seed.sql (local/CI only). Invalid COMMENT ON vault.get_secret removed. vault_handoff_key pgTAP green in run <run>. SPEC-010, ESM §3.3, Runbook 14 and Environments §6 use the accessor. Open: client error mapping (SCR-1216), rotation rehearsal (SCRUM-39)."
- **SCRUM-41, Done (scope changed by D1).** "Done — <sha>: Supabase's image has no h3 (run 39803696654), so H3 was removed rather than pinned. ADR-0023 supersedes ADR-0005: PostGIS only; tiers region 16 km / coarse 2.5 km / fine 320 m via app.location_cell(), CHECK-pinned columns; nightly private.check_location_tiers() (count-only); extensions.digest fixed; location_tiers pgTAP (P=7, N=12) green in run <run>. Open: alert routing for the nightly job; SPEC-020 surplus-matching re-spec."
- **SCRUM-44, Done.** "Done — <sha>: LP-06 reads display_point 1,000 times through the client path and asserts the mean is >400 m from exact_point and equal to the stored fuzz. LP-08/09/10/12 use skip() with backlog keys (LP-12 is now radius recall, ADR-0023). location_privacy 15/15 in run <run>. Parent SCR-0210 stays open (WP-19)."
- **If db is not green:** set all four to In Progress with "Partial — PR #<PR> (draft) at <sha>: <done>. Open: db.yml run <run> fails at <step>: <first ERROR line>." **Optional:** comment on SCRUM-37 with the first green run id.

## 14. Open questions for Corey (privacy-affecting ones are not guessed)

1. **Security review sign-off.** **Decided (Corey, 2026-10-22): approved.** Location Privacy 1.1.0, RLS Design 1.2.0 and ADR-0023 all say "security review required for any change". Recommendation: this is a merge gate.
2. **Tier sizes.** **Decided (Corey, 2026-10-22): confirmed; sizes stand and `fine_cell` stays.** 16 km / 2.5 km / 320 m are the planner's choice: each is at least the H3 area it replaces. The coarse tier is about 20% larger than r7, so surplus targeting gets coarser. Confirm, especially the exposable coarse tier.
3. **Keep `fine_cell` at all?** **Decided (Corey, 2026-10-22): confirmed; sizes stand and `fine_cell` stays.** It has no consumer, and it is a 320 m P1 box around a home. Dropping it is cheapest now, while D2's window is open. The plan keeps it because D1 says to preserve the ladder.
4. **SPEC-020 surplus matching.** The H3 disk and r8-parent mechanism is gone. The recommendation is `ST_DWithin(safe_spots.point, centre of center_coarse_cell, radius_km × 1000)` over the closed radius set, which needs a cell-centre helper. The spec is marked pending.
5. **`profiles.home_coarse_cell` derivation.** SPEC-004 says the garden trigger derives it, but neither the old nor the new code does. Parity is kept here. Is this a follow-up story?
6. **`app.geohash_encode`** is an unused helper with no tier. ADR-0005 rejected that kind of ad-hoc precision. Retire it now, under D2?
7. **D2 window bookkeeping.** Who records the first hosted apply in Data Model §15 rule 12, and should a CI check enforce it after that point?
8. **Break-glass provisioning** still has no backlog key (carried over from WP-08).
9. **Branch protection.** Should db become a required check (WP-12 remaining)?
10. **F2.** `run-pgtap.sh` calls `supabase db test`. If CLI 2.120.0 rejects that, WP-12 owns the fix and this PR stalls until then.
11. **SQLSTATE 55000 `handoff_key_unavailable`.** Confirm it as the code that SCR-1216 maps to the "we can't verify your code right now" message.

### Critical files for implementation
- /Users/cxb317/Documents/ai/sharecropr/supabase/migrations/20260822_0003_gardens_geospatial.sql (becomes 20260822000003_gardens_geospatial.sql)
- /Users/cxb317/Documents/ai/sharecropr/docs/01-architecture/04-location-privacy.md
- /Users/cxb317/Documents/ai/sharecropr/docs/01-architecture/03-data-model.md
- /Users/cxb317/Documents/ai/sharecropr/supabase/migrations/20260822_0006_vault_handoff_key.sql
- /Users/cxb317/Documents/ai/sharecropr/docs/07-review/04-backlog-execution/plans/WP-08.md (with WP-08-files/ and WP-11-files/)
