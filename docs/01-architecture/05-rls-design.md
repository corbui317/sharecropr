# Row-Level Security Design

**Status:** Review · **Version:** 1.2.0 · **Owner:** Architecture + Security
**Security review:** required for any change.

RLS *is* the authorization layer in Sharecropr. There is no service tier that could enforce access control instead, which means a missing or wrong policy is a data breach with no error, no crash, and no alert. This document defines the patterns, the helper functions, the performance traps, and the proof obligations.

---

## 1. Non-negotiable rules

| # | Rule |
| --- | --- |
| RLS-1 | **Every table in `public` has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.** CI fails any migration that creates a table without both. |
| RLS-2 | **Every policy has a positive test and at least one negative test.** A policy proven to allow but not proven to deny is not tested. |
| RLS-3 | **The `service_role` key never appears in client code, in an artifact, in an env var read by the app, or in a log.** It exists in Edge Function secrets and CI secrets only. |
| RLS-4 | **Policies never call a function that queries the same table.** That is infinite recursion, and Postgres reports it as a confusing error at runtime rather than at migration time. |
| RLS-5 | **Every column referenced in a policy predicate is indexed.** An unindexed policy predicate turns every query into a sequential scan under an authorization filter. |
| RLS-6 | **Subqueries in policies are wrapped in `(SELECT …)`** so the planner evaluates them once as an InitPlan rather than per row. |
| RLS-7 | **Blocks are enforced in policy, not in the client.** Blocked content must not enter the result set. |
| RLS-8 | **`SECURITY DEFINER` functions always pin `search_path`.** An unpinned `search_path` on a definer function is a privilege-escalation vector. |

---

## 2. Roles

| Role | Who | Access |
| --- | --- | --- |
| `anon` | Unauthenticated | Crop taxonomy and active safe spots. Nothing else. |
| `authenticated` | Signed-in user | Governed entirely by policy. |
| `moderator` | Staff, via the console | Elevated read on reports, messages in reported threads, garden submissions. Granted through `app.is_moderator()`, backed by a JWT claim. |
| `service_role` | Edge Functions, migrations | Bypasses RLS. Used for webhook writes, outbox drain, cron. |
| `break_glass` | Two-person authorized, time-boxed | Read on `private.garden_locations`. Fully audited. |

> `break_glass` is a real Postgres role, created `NOLOGIN` with no grants by migration `20261022154625_break_glass_role.sql` and asserted empty by `supabase/tests/roles_break_glass.test.sql`. It gains read on `private.garden_locations` only through the provisioning procedure in [Runbooks §6](../05-operations/05-runbooks.md), which is not built yet. `anon`, `authenticated` and `service_role` are Supabase-provided.

Moderator status lives in a JWT custom claim (`app_metadata.role`), not in a table lookup, so policies don't pay a query per row. Claims are refreshed on token refresh, giving a worst-case 1-hour lag on revocation — acceptable, and mitigated by also checking `profiles.is_suspended` on sensitive writes.

---

## 3. Helper functions

All in schema `app`, all `SECURITY DEFINER`, all `STABLE`, all with pinned `search_path`. These exist so policies stay simple and so recursive lookups happen once rather than per row.

```sql
-- Is the caller a moderator? Reads the JWT claim; no table access.
CREATE OR REPLACE FUNCTION app.is_moderator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'role') IN ('moderator','admin'),
    false);
$$;

-- Is the caller blocked with `other`, in either direction? Caller-scoped: it can only
-- answer about auth.uid() vs `other`, so it is safe to expose. This is the form policies use.
CREATE OR REPLACE FUNCTION app.is_blocked_with(other uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks b
     WHERE (b.blocker_id = auth.uid() AND b.blocked_id = other)
        OR (b.blocker_id = other AND b.blocked_id = auth.uid()));
$$;
-- app.is_blocked_either_way(a uuid, b uuid) remains as a definer-internal two-argument form
-- with NO client grant: a client-callable two-argument form lets any user probe whether two
-- other users are blocked.

-- Can the caller transact? Verified, not suspended, garden verified. No parameter: a
-- client-callable `can_transact(u)` would let any user query any other user's state.
-- app.can_transact_for(u uuid) is the ungranted, definer-internal form.
CREATE OR REPLACE FUNCTION app.can_transact_for(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.verifications v ON v.user_id = p.id
     WHERE p.id = u
       AND p.deleted_at IS NULL
       AND p.is_suspended = false
       AND (v.status = 'passed'
            OR EXISTS (SELECT 1 FROM private.review_bypass_accounts r
                        WHERE r.user_id = u AND r.expires_at > now()))
       AND EXISTS (SELECT 1 FROM public.gardens g
                    WHERE g.owner_id = u AND g.status = 'verified' AND g.deleted_at IS NULL));
$$;

CREATE OR REPLACE FUNCTION app.can_transact() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private, app AS $$
  SELECT app.can_transact_for(auth.uid());
$$;

-- Is the caller a participant in this exchange?
CREATE OR REPLACE FUNCTION app.is_session_participant(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exchange_sessions s
     WHERE s.id = sid
       AND auth.uid() IN (s.owner_id, s.requester_id));
$$;

CREATE OR REPLACE FUNCTION app.is_thread_participant(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.message_threads t
     WHERE t.id = tid
       AND auth.uid() IN (t.participant_a, t.participant_b)
       AND t.is_closed = false);
$$;
```

Grants are explicit and minimal:

```sql
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.is_blocked_with(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.can_transact()        TO authenticated;
-- Policies run as the invoker, and EXECUTE is checked when a policy expression is
-- initialised, so every helper a policy calls needs this grant. is_moderator only reads
-- the caller's own JWT.
GRANT EXECUTE ON FUNCTION app.is_moderator()        TO authenticated;
-- NOT granted: is_blocked_either_way(uuid,uuid), can_transact_for(uuid),
-- idempotency_probe/record, require_aal2_if_enrolled, derive_display_point. The `app` schema
-- is exposed by PostgREST, so every EXECUTE grant above is a public RPC; anything that
-- takes a user id, or is only called from SECURITY DEFINER RPCs, stays ungranted.
```

> **Why `SECURITY DEFINER` helpers instead of inline subqueries?** Two reasons. First, `blocks` itself has RLS, so an inline subquery against it from another table's policy would be filtered by *that* table's policy and silently return the wrong answer. A definer function sees the raw table. Second, one function called once beats the same three-way join pasted into eleven policies and drifting.

---

## 4. The column-privacy problem

RLS is row-level. `profiles.trust_score` and `cancellation_count_90d` must never be visible to other users, and a row-level policy cannot express that. Decision record: [ADR-0022](adr/ADR-0022-profiles-other-user-reads.md).

> **A column-level `REVOKE` does nothing while a table-level grant exists.** Supabase default privileges grant `ALL` on `public` tables to `anon` and `authenticated`, so `REVOKE SELECT (trust_score) ON public.profiles FROM authenticated` is a silent no-op. The same grant lets any user `PATCH` their own `is_suspended`, `trust_tier`, or a garden's `status`. The pattern is therefore **revoke the table, grant the columns**:

```sql
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, handle, display_name, avatar_path, bio, city_label, trust_tier,
              rating_avg, rating_count, completed_exchanges, created_at)
  ON public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_path, bio, locale, timezone, onboarding_completed_at)
  ON public.profiles TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
```

Rows and columns are then decided separately:

```sql
-- Own row (including during deletion grace)
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));

-- Other users' rows: live, not suspended, not blocked either way.
CREATE POLICY profiles_select_visible ON public.profiles
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_suspended = false AND NOT app.is_blocked_with(id));
```

**Every column granted `SELECT` is visible for every other visible user's row** — through `profiles` and through `profile_cards` alike. Adding a column to that grant is a privacy decision.

Owner-only columns (`locale`, `timezone`, `onboarding_completed_at`, `deleted_at`, `is_suspended`, `suspended_until`) are read through a no-argument definer RPC, `public.get_my_profile()`. `trust_score`, `cancellation_count_90d`, and `home_coarse_cell` are returned to no client ([SPEC-012-R48](../03-specs/SPEC-012-trust-and-safety.md)).

`public.profile_cards` remains a `security_invoker` projection:

```sql
CREATE OR REPLACE VIEW public.profile_cards
WITH (security_invoker = on) AS
SELECT p.id, p.handle, p.display_name, p.avatar_path, p.bio,
       p.city_label, p.trust_tier, p.rating_avg, p.rating_count,
       p.completed_exchanges, p.created_at
  FROM public.profiles p
 WHERE NOT app.is_blocked_with(p.id);

REVOKE ALL ON public.profile_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_cards TO authenticated;
```

> `security_invoker = on` is essential. Without it the view runs as its owner and **bypasses RLS on `profiles` entirely**. It is checked by a pgTAP assertion on every view in `public`. Because an invoker view needs `SELECT` on every column it references, it cannot reference `is_suspended` or `deleted_at`; those filters live in `profiles_select_visible`.

Clients must name their columns: `SELECT *` on `profiles` or `gardens` fails with `42501` because some columns are not granted. The same revoke-then-grant pattern applies to `gardens` (`fine_cell` unreadable; `status` and derived columns RPC-only), `verifications` (read-only), and `blocks` (select + insert).

---

## 5. Policy patterns

Five patterns cover nearly every table. New tables should fit one of these, and a table that fits none deserves a design discussion.

### Pattern A — Owner-only (private data)

`inventory_items`, `gardens`, `devices`, `notification_preferences`, `notifications`

```sql
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items FORCE ROW LEVEL SECURITY;

CREATE POLICY inventory_select_own ON public.inventory_items
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);

CREATE POLICY inventory_insert_own ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.gardens g
                 WHERE g.id = garden_id AND g.owner_id = (SELECT auth.uid())));

CREATE POLICY inventory_update_own ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- No DELETE policy. Deletion is soft, via UPDATE. Absence of a policy is the denial.
```

> `(SELECT auth.uid())` rather than bare `auth.uid()` is not stylistic. Wrapping it lets the planner hoist it into an InitPlan evaluated once, instead of calling the function once per row. On a 50,000-row scan this is the difference between 8 ms and 900 ms.

### Pattern B — Public read, staff write

`safe_spots`, `crop_species`, `crop_categories`, `crop_varieties`

```sql
CREATE POLICY safe_spots_read ON public.safe_spots
  FOR SELECT TO anon, authenticated
  USING (status = 'active');

CREATE POLICY safe_spots_staff_write ON public.safe_spots
  FOR ALL TO authenticated
  USING (app.is_moderator()) WITH CHECK (app.is_moderator());
```

### Pattern C — Participant-scoped (the exchange)

`exchange_requests`, `exchange_sessions`, `message_threads`, `messages`

```sql
CREATE POLICY requests_select_participant ON public.exchange_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IN (requester_id, owner_id)
    AND NOT app.is_blocked_with(
      CASE WHEN requester_id = (SELECT auth.uid()) THEN owner_id ELSE requester_id END));

CREATE POLICY requests_insert_requester ON public.exchange_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = (SELECT auth.uid())
    AND app.can_transact()
    AND NOT app.is_blocked_with(owner_id)
    AND EXISTS (SELECT 1 FROM public.listings l
                 WHERE l.id = listing_id
                   AND l.status = 'active'
                   AND l.expires_at > now()
                   AND l.owner_id <> (SELECT auth.uid())));

-- No direct UPDATE policy at all. Status changes go exclusively through
-- SECURITY DEFINER RPCs so the state machine cannot be bypassed. See §7.
```

> **The absence of an UPDATE policy on `exchange_requests` is load-bearing.** If a client could `UPDATE status = 'accepted'` directly, every concurrency guarantee in [the state machine](07-exchange-state-machine.md) would be void. State transitions are RPC-only, and the RPC runs as definer.

### Pattern D — Discoverable-with-conditions (listings)

The most complex policy in the system. Public-ish, but filtered by block, suspension, and expiry.

```sql
CREATE POLICY listings_select_discoverable ON public.listings
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (
      status IN ('active','reserved')
      AND expires_at > now()
      AND NOT app.is_blocked_with(owner_id)
      AND EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = owner_id
                     AND p.is_suspended = false
                     AND p.deleted_at IS NULL)));

CREATE POLICY listings_insert_own ON public.listings
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND app.can_transact());

CREATE POLICY listings_update_own ON public.listings
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND status IN ('draft','active'))
  WITH CHECK (owner_id = (SELECT auth.uid()));
```

Required indexes for this policy to be affordable:

```sql
CREATE INDEX listings_owner_idx     ON public.listings (owner_id);
CREATE INDEX listings_discover_idx  ON public.listings (status, expires_at)
  WHERE status IN ('active','reserved');
CREATE INDEX blocks_blocker_idx     ON public.blocks (blocker_id, blocked_id);
CREATE INDEX blocks_blocked_idx     ON public.blocks (blocked_id, blocker_id);
CREATE INDEX profiles_active_idx    ON public.profiles (id)
  WHERE is_suspended = false AND deleted_at IS NULL;
```

### Pattern E — Write-only-by-subject (reports)

A reporter may create a report and see their own. They may **not** see its resolution details, and the subject may not see the report at all.

```sql
CREATE POLICY reports_insert_own ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));

CREATE POLICY reports_select_own ON public.reports
  FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()) OR app.is_moderator());

REVOKE SELECT (resolved_by, action_taken, severity) ON public.reports FROM authenticated;
```

---

## 6. Enforcing blocks

Blocking is not a UI filter. When A blocks B:

| Surface | Effect | Enforced by |
| --- | --- | --- |
| Listings | B's listings vanish from A's queries and vice versa | `listings_select_discoverable` |
| Safe-spot counts | B's listings don't contribute to counts A sees | `NOT app.is_blocked_with` inside `safe_spots_near` |
| Profiles | Neither can load the other's `profiles` / `profile_cards` row | `profiles_select_visible` policy + view predicate |
| Messages | Thread `is_closed = true`; `app.is_thread_participant` returns false | Trigger + policy |
| In-flight exchange | Cancelled with reason `blocked`, both notified | `on_block_created` trigger |
| New requests | Insert fails the `WITH CHECK` | `requests_insert_requester` |

```sql
CREATE OR REPLACE FUNCTION public.on_block_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.exchange_sessions
     SET state = 'cancelled', cancelled_by = NEW.blocker_id,
         cancelled_reason = 'blocked', cancelled_at = now(), version = version + 1
   WHERE state IN ('scheduling','scheduled')
     AND ((owner_id = NEW.blocker_id AND requester_id = NEW.blocked_id)
       OR (owner_id = NEW.blocked_id AND requester_id = NEW.blocker_id));

  UPDATE public.exchange_requests SET status = 'cancelled'
   WHERE status = 'pending'
     AND ((requester_id = NEW.blocker_id AND owner_id = NEW.blocked_id)
       OR (requester_id = NEW.blocked_id AND owner_id = NEW.blocker_id));

  UPDATE public.message_threads SET is_closed = true
   WHERE (participant_a = LEAST(NEW.blocker_id, NEW.blocked_id)
      AND participant_b = GREATEST(NEW.blocker_id, NEW.blocked_id));

  INSERT INTO audit.events (actor_id, actor_role, action, subject_type, subject_id)
  VALUES (NEW.blocker_id, 'authenticated', 'block.created', 'user', NEW.blocked_id);

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_on_block_created
AFTER INSERT ON public.blocks FOR EACH ROW EXECUTE FUNCTION public.on_block_created();
```

> **Deliberate asymmetry:** blocking is one-directional as an action but bidirectional in effect. B is never told they were blocked — they simply stop seeing A. Telling someone they've been blocked is a known escalation trigger in harassment cases.

---

## 7. Why state transitions bypass policy

Policies express *who may see or touch a row*. They cannot express *which state transitions are legal, in what order, under what locks*. Attempting to encode a state machine in `WITH CHECK` clauses produces policies nobody can read and races nobody can reason about.

So: **all state transitions are `SECURITY DEFINER` RPCs, and the corresponding tables have no client-facing UPDATE policy.**

```sql
CREATE OR REPLACE FUNCTION public.accept_exchange_request(
  p_request_id uuid, p_idempotency_key uuid)
RETURNS TABLE (session_id uuid, handoff_code char(6))
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_req  public.exchange_requests;
  v_uid  uuid := auth.uid();
BEGIN
  -- The definer function re-implements authorization explicitly, because
  -- it runs as owner and therefore is NOT subject to RLS.
  SELECT * INTO v_req FROM public.exchange_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.owner_id <> v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- … lock ordering, state assertions, and the transition itself
  -- are specified in 07-exchange-state-machine.md §4.
END; $$;
```

> **This is the sharpest edge in the architecture.** A `SECURITY DEFINER` function runs with the owner's privileges and RLS does not apply to it. Every one of them must re-check authorization by hand, as the first thing it does, before touching anything. The review checklist for any new definer function is in [Test Strategy §6](../04-testing/01-test-strategy.md), and `CODEOWNERS` requires a second reviewer on `supabase/migrations/**`.

---

## 8. Performance

### Traps and their fixes

| Trap | Symptom | Fix |
| --- | --- | --- |
| Bare `auth.uid()` in a policy | Function call per row; 100× slowdown on scans | Wrap: `(SELECT auth.uid())` |
| Unindexed policy column | Sequential scan on every query | Index every column in every predicate |
| Policy querying its own table | `infinite recursion detected in policy` at runtime | `SECURITY DEFINER` helper |
| Correlated `EXISTS` per row | Quadratic behaviour | Denormalize the key (this is why `owner_id` is on `listings` and `exchange_requests`) |
| `JOIN` to an RLS-protected table | Both policies evaluate; the inner one may filter unexpectedly | Definer helper, or denormalize |
| Multiple `PERMISSIVE` policies | All are OR-ed and all evaluate | One policy per action per role wherever possible |

### Budget

Every policy must keep its table's p95 query under **50 ms** at 10× projected launch volume. Measured in CI against a seeded database with 100k profiles, 500k listings, and 2M messages. A regression fails the build.

`EXPLAIN (ANALYZE, BUFFERS)` output for the six hottest queries is committed to `supabase/perf/baselines/` and diffed on each migration, so a plan change is visible in review rather than in production.

---

## 9. Proof obligations

Every table needs all of these before it can ship. Full matrix in [RLS Test Plan](../04-testing/02-rls-test-plan.md).

| # | Assertion |
| --- | --- |
| 1 | `rowsecurity` and `forcerowsecurity` are both true |
| 2 | Owner can read their own row |
| 3 | **A non-owner cannot read it** (negative) |
| 4 | **`anon` cannot read it** (negative) |
| 5 | Owner can perform each permitted write |
| 6 | **Non-owner cannot perform any write** (negative) |
| 7 | **A blocked user cannot read counterparty content** (negative) |
| 8 | **A suspended user cannot write** (negative) |
| 9 | **An unverified user cannot transact** (negative) |
| 10 | Moderator can read what they are supposed to, and **nothing more** |
| 11 | Every column in every predicate is indexed |
| 12 | The table appears in no view lacking `security_invoker = on` |

> The negative tests are the point. Positive tests tell you the feature works. Negative tests tell you the feature is safe, and they are the ones people skip under deadline pressure. CI counts them: a table whose test file has fewer negative than positive assertions fails the build.

---

## 10. Review checklist for any RLS change

- [ ] `ENABLE` **and** `FORCE ROW LEVEL SECURITY` present
- [ ] A policy exists for every action the client needs; **no policy exists for actions it doesn't**
- [ ] All `auth.uid()` calls wrapped in `(SELECT …)`
- [ ] Every predicate column indexed; index included in the same migration
- [ ] No policy references its own table, directly or through a function
- [ ] Any new `SECURITY DEFINER` function pins `search_path` and re-checks authorization first
- [ ] Any new view sets `security_invoker = on`
- [ ] Block enforcement considered and applied if the table carries user content
- [ ] Positive and negative pgTAP tests in the same PR
- [ ] `EXPLAIN` baseline updated if a hot path changed
- [ ] Second reviewer with the `DB` CODEOWNERS tag has approved

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Architecture + Security | Initial RLS design |
| 2026-10-21 | 1.1.0 | Architecture + Security | §3: caller-scoped `is_blocked_with()` / `can_transact()`, two-argument forms made internal, `is_moderator` grant explained. §4 rewritten: revoke-then-grant column privileges, `profiles_select_visible`, `get_my_profile()` ([ADR-0022](adr/ADR-0022-profiles-other-user-reads.md)) |
| 2026-10-22 | 1.1.1 | Architecture + Security | §2: `break_glass` role exists with no privileges (SCR-0201) |
| 2026-10-22 | 1.2.0 | Architecture + Security | H3 removed; renamed to location tiers per [ADR-0023](adr/ADR-0023-postgis-location-tiers.md). Cell column names and the coordinate-key CHECK deny-list use `fine_cell`. Security review pending (Corey). |
