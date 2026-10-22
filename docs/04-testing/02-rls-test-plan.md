# RLS Test Plan

**Status:** Approved · **Version:** 1.0.1 · **Owner:** Backend + Security

RLS is the entire authorization layer ([ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md)). A wrong policy does not crash — it returns data. This plan defines how every policy is proven, with a deliberate emphasis on proving **refusal**.

---

## 1. Tooling and harness

pgTAP against a real Postgres started by the Supabase CLI. No mocks, no in-memory substitutes — a mocked policy engine tests our mock.

### 1.1 Authenticating as a real user

The single most common way to write a useless RLS test is `SET LOCAL role authenticated`. That sets the role but leaves `request.jwt.claims` empty, so `auth.uid()` returns null and half the policies evaluate against nothing. Tests must set the claims too:

```sql
CREATE OR REPLACE FUNCTION tests.authenticate_as(p_handle text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_role text;
BEGIN
  SELECT id, COALESCE(staff_role,'authenticated') INTO v_id, v_role
    FROM tests.fixtures_users WHERE handle = p_handle;
  IF v_id IS NULL THEN RAISE EXCEPTION 'no fixture user %', p_handle; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_id, 'role', 'authenticated', 'aal', 'aal2',
    'app_metadata', json_build_object('role', v_role)
  )::text, true);
END; $$;

CREATE OR REPLACE FUNCTION tests.authenticate_as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', NULL, true);
END; $$;
```

### 1.2 Fixture users

| Handle | Properties | Used to prove |
| --- | --- | --- |
| `owner` | Verified, garden verified, has listings | Positive owner access |
| `requester` | Verified, garden verified | Counterparty access |
| `stranger` | Verified, no relationship to anyone | **The default negative case** |
| `unverified` | Email verified only | Transacting is gated |
| `no_garden` | KYC passed, no verified garden | `app.can_transact()` composite |
| `suspended` | Verified but `is_suspended = true` | Suspension blocks writes |
| `blocker` / `blocked` | Mutual block exists | Block enforcement |
| `moderator` | `app_metadata.role = 'moderator'` | Scoped elevation |
| `admin` | `app_metadata.role = 'admin'` | Admin-only paths |
| `deleted` | `deleted_at` set | Soft-delete filtering |

Fixtures are built by a seed script, are deterministic, and are torn down per test file. Every table's test file uses the same cast, which makes the negative tests copy-pasteable in the good way — the same twelve questions asked of every table.

---

## 2. The twelve-point proof obligation

Every table in `public` proves all twelve. A table that cannot is a design problem, not a testing problem.

| # | Assertion | Polarity |
| --- | --- | --- |
| 1 | `rowsecurity` AND `relforcerowsecurity` are both true | structural |
| 2 | Owner can read their own row | positive |
| 3 | **A non-owner cannot read it** | **negative** |
| 4 | **`anon` cannot read it** | **negative** |
| 5 | Owner can perform each permitted write | positive |
| 6 | **Non-owner cannot perform any write** | **negative** |
| 7 | **A blocked user cannot read counterparty content** | **negative** |
| 8 | **A suspended user cannot write** | **negative** |
| 9 | **An unverified user cannot transact** | **negative** |
| 10 | Moderator reads exactly what they should, **and nothing more** | both |
| 11 | Every column in every predicate is indexed | structural |
| 12 | The table appears in no view lacking `security_invoker = on` | structural |

`FORCE ROW LEVEL SECURITY` in #1 matters more than it looks: without it, the table owner — which is who migrations and some functions run as — bypasses policies silently.

---

## 3. Per-table matrix

Test file: `supabase/tests/rls_<table>.test.sql`. `P` = positive, **`N`** = negative, `S` = structural.

| Table | Total | P | **N** | Notable cases |
| --- | --- | --- | --- | --- |
| `profiles` | 22 | 8 | **11** | Column revoke on `trust_score`; `profile_cards` is `security_invoker`; blocked user invisible |
| `verifications` | 14 | 4 | **8** | Only self and moderator; client cannot write `status` |
| `gardens` | 26 | 8 | **15** | `display_point` not client-writable; `fine_cell` column-revoked; one garden per owner |
| `garden_verification_submissions` | 16 | 5 | **9** | Moderator read; submitter read; nobody else |
| `crop_kingdoms` / `categories` / `species` | 10 each | 4 | **4** | `anon` may read active rows only; nobody but staff writes |
| `crop_varieties` | 14 | 5 | **7** | Unapproved variety visible **only** to its submitter |
| `inventory_items` | 24 | 8 | **13** | Counterparty sees the item behind a listing but not `notes` |
| `media_assets` | 20 | 6 | **12** | **`exif_stripped_at IS NULL` → unreadable by everyone** |
| `safe_spots` | 12 | 5 | **5** | `anon` reads active; staff-only write; retired spots hidden |
| `listings` | 30 | 10 | **17** | The most complex policy: block + suspension + expiry + draft |
| `listing_safe_spots` | 12 | 4 | **6** | Cardinality 1–3 enforced |
| `exchange_requests` | 28 | 8 | **17** | **No UPDATE policy exists at all** — direct status writes must fail |
| `exchange_sessions` | 30 | 9 | **18** | Participants only; transition guard; no client UPDATE |
| `message_threads` | 20 | 6 | **12** | Moderator scoped to reported/flagged threads only |
| `messages` | 26 | 8 | **15** | Immutability; no existence oracle; realtime RLS filtering |
| `ratings` | 20 | 7 | **11** | Double-blind: unrevealed rating invisible to the ratee |
| `reports` | 18 | 5 | **11** | Subject never sees the report; reporter never sees the resolution |
| `blocks` | 14 | 4 | **8** | Blocked user cannot detect the block |
| `devices` / `notification_preferences` / `notifications` | 14 each | 5 | **7** | Self only; payload coordinate CHECK |
| `moderation_cases` / `approvals` / `appeals` | 18 each | 5 | **10** | No self-approval; no original reviewer on appeal |
| **Total** | **≈ 430** | ≈ 150 | **≈ 260** | |

**Negatives outnumber positives roughly 1.7 : 1, and CI enforces that ratio per file.**

---

## 4. Worked example — `listings`

The hardest policy in the system, so its test file is the reference for the others.

```sql
BEGIN;
SELECT plan(30);

-- ── Structural ──────────────────────────────────────────────────────────
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE tablename = 'listings'),
          'S1: RLS enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'listings'),
          'S2: RLS forced');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes
                   WHERE tablename = 'listings' AND indexname = 'listings_owner_idx'),
          'S3: policy predicate column owner_id is indexed');
SELECT is((SELECT count(*) FROM pg_policies
            WHERE tablename = 'listings' AND cmd = 'DELETE')::int, 0,
          'S4: no DELETE policy — deletion is soft, by design');

-- ── Positive ────────────────────────────────────────────────────────────
SELECT tests.authenticate_as('owner');
SELECT is((SELECT count(*) FROM listings WHERE id = tests.fixture('draft_listing')), 1::bigint,
          'P1: owner sees own draft');
SELECT lives_ok($$ UPDATE listings SET title = 'Updated'
                    WHERE id = tests.fixture('active_listing') $$,
          'P2: owner can update own active listing');

SELECT tests.authenticate_as('requester');
SELECT is((SELECT count(*) FROM listings WHERE id = tests.fixture('active_listing')), 1::bigint,
          'P3: any verified user sees an active listing');

-- ── Negative — the point of this file ───────────────────────────────────
SELECT tests.authenticate_as('stranger');
SELECT is((SELECT count(*) FROM listings WHERE id = tests.fixture('draft_listing')), 0::bigint,
          'N1: stranger CANNOT see a draft listing');
SELECT is((SELECT count(*) FROM listings WHERE id = tests.fixture('expired_listing')), 0::bigint,
          'N2: stranger CANNOT see an expired listing');
SELECT throws_ok($$ UPDATE listings SET title = 'Hijacked'
                     WHERE id = tests.fixture('active_listing') $$,
          '42501', NULL, 'N3: stranger CANNOT update another user''s listing');
SELECT throws_ok($$ INSERT INTO listings (owner_id, inventory_item_id, species_id, title, expires_at)
                    VALUES (tests.fixture('owner'), tests.fixture('item_a'), 1, 'Forged', now() + '7d') $$,
          '42501', NULL, 'N4: cannot insert a listing owned by someone else');

SELECT tests.authenticate_as('blocked');
SELECT is((SELECT count(*) FROM listings WHERE owner_id = tests.fixture('blocker')), 0::bigint,
          'N5: blocked user sees ZERO listings from the blocker');
SELECT tests.authenticate_as('blocker');
SELECT is((SELECT count(*) FROM listings WHERE owner_id = tests.fixture('blocked')), 0::bigint,
          'N6: block is bidirectional in effect');

SELECT tests.authenticate_as('unverified');
SELECT throws_ok($$ INSERT INTO listings (owner_id, inventory_item_id, species_id, title, expires_at)
                    VALUES (tests.fixture('unverified'), tests.fixture('item_u'), 1, 'Nope', now() + '7d') $$,
          '42501', NULL, 'N7: unverified user CANNOT publish');

SELECT tests.authenticate_as('no_garden');
SELECT throws_ok($$ INSERT INTO listings (owner_id, inventory_item_id, species_id, title, expires_at)
                    VALUES (tests.fixture('no_garden'), tests.fixture('item_n'), 1, 'Nope', now() + '7d') $$,
          '42501', NULL, 'N8: KYC alone is insufficient — garden verification also required');

SELECT tests.authenticate_as('suspended');
SELECT throws_ok($$ UPDATE listings SET title = 'x' WHERE owner_id = tests.fixture('suspended') $$,
          '42501', NULL, 'N9: suspended user CANNOT write');

SELECT tests.authenticate_as('requester');
SELECT is((SELECT count(*) FROM listings
            WHERE owner_id = tests.fixture('suspended') AND status = 'active'), 0::bigint,
          'N10: a suspended user''s listings are invisible to everyone else');

SELECT tests.authenticate_as_anon();
SELECT is((SELECT count(*) FROM listings), 0::bigint,
          'N11: anon sees NOTHING');
SELECT throws_ok($$ INSERT INTO listings (owner_id, inventory_item_id, species_id, title, expires_at)
                    VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'x', now() + '7d') $$,
          NULL, NULL, 'N12: anon cannot insert');

SELECT * FROM finish();
ROLLBACK;
```

---

## 5. Cross-cutting suites

### 5.1 Every-table sweeps

Generated from the catalogue, so a new table is covered the moment it exists:

```sql
-- No table in public may lack RLS.
SELECT is(
  (SELECT count(*) FROM pg_tables t
     WHERE t.schemaname = 'public' AND NOT t.rowsecurity)::int,
  0, 'SWEEP: every public table has RLS enabled');

-- No view may bypass RLS.
SELECT is(
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND NOT COALESCE((c.reloptions::text LIKE '%security_invoker=on%'), false))::int,
  0, 'SWEEP: every public view sets security_invoker = on');

-- No client role may touch private.
SELECT is(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'private' AND grantee IN ('anon','authenticated'))::int,
  0, 'SWEEP: no client grants on schema private');

-- Every definer function pins search_path.
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','app') AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}'))
                       AS cfg WHERE cfg LIKE 'search_path=%'))::int,
  0, 'SWEEP: every SECURITY DEFINER function pins search_path');
```

These four sweeps catch the majority of RLS mistakes before anyone writes a table-specific test. They should be the first thing added to a new project.

### 5.2 Definer authorization sweep

Every definer function is called by `stranger` with a valid-looking argument belonging to someone else. All must raise `42501`. Generated from the allowlist, so a new function that forgets its authorization check fails immediately.

### 5.3 Block-teardown suite

| # | Assertion |
| --- | --- |
| B1 | Creating a block closes the thread in the same transaction |
| B2 | An in-flight session is cancelled with reason `blocked` |
| B3 | Pending requests between the pair are cancelled |
| B4 | Neither can load the other's `profile_cards` row |
| B5 | Neither sees the other's listings |
| B6 | The blocked user's listings do not contribute to `safe_spots_near` counts |
| B7 | A new request between them fails the `WITH CHECK` |
| B8 | **The blocked user receives no notification and no observable state change** |
| B9 | An `audit.events` row is written |

### 5.4 Realtime RLS

Supabase Realtime claims to apply RLS to change events. We verify rather than assume:

| # | Assertion |
| --- | --- |
| RT1 | A non-participant subscribed to `thread:{id}` receives zero events |
| RT2 | A blocked user receives no events on a shared channel |
| RT3 | A user removed from a session mid-subscription stops receiving events |
| RT4 | The subscription itself does not confirm the channel's existence |

---

## 6. Performance assertions

A policy that is correct but slow is a policy someone will "optimise" incorrectly under pressure. Every table's file asserts its budget against the seeded dataset (100k profiles, 500k listings, 2M messages):

```sql
SELECT tests.assert_query_under_ms(
  $$ SELECT * FROM listings WHERE status = 'active' LIMIT 50 $$,
  50, 'listings select stays under 50ms with policy applied');
```

`EXPLAIN (ANALYZE, BUFFERS)` baselines for the six hottest queries live in `supabase/perf/baselines/` and are diffed on every migration, so a plan change surfaces in review.

---

## 7. CI gates

| Gate | Rule |
| --- | --- |
| All pgTAP green | Blocking |
| Negative ≥ positive per table file | Blocking |
| New table without RLS enabled and forced | Blocking |
| New view without `security_invoker = on` | Blocking |
| New `GRANT` on `private` | Blocking |
| New definer function without a pinned `search_path` | Blocking |
| New definer function absent from the allowlist | Blocking |
| Any predicate column unindexed | Blocking |
| Performance budget regression | Blocking |
| Migration without a test file in the same PR | Blocking |

---

## 8. Maintenance

- **Adding a table:** copy the template test file, fill the twelve obligations, add the sweep entry. The test file merges in the same PR as the migration — not the next one.
- **Changing a policy:** the change and its tests are one commit. A policy diff with no test diff is rejected in review.
- **Quarterly:** re-run the full suite against a production-shaped seed and review the fixture cast for gaps — a fixture user we never added means a case we never test.
- **After any security finding:** add a regression test *first*, watch it fail, then fix.

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Backend + Security | Initial RLS test plan |
| 2026-10-22 | 1.0.1 | Backend + Security | H3 removed; renamed to location tiers per [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md). |
