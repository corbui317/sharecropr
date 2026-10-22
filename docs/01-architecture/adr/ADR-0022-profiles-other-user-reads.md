# ADR-0022: Other-user profile reads — a row policy plus column grants

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-21 |
| **Deciders** | Architecture, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

[RLS Design §4](../05-rls-design.md) said the client reads its own profile from `public.profiles` and everyone else's from `public.profile_cards`, a `security_invoker = on` view over `profiles`. The two halves contradict each other. A `security_invoker` view evaluates the base table's RLS as the *caller*, and `profiles` had only `profiles_select_own` (`id = auth.uid()`). So every `profile_cards` query for another user returned zero rows; the view could only ever show the caller's own card. Exchange, listing, and rating surfaces that embed `owner:profile_cards(...)` would all have rendered empty.

Two related defects surfaced in the same review. First, the column-level `REVOKE SELECT (trust_score, …)` in migration 0004 was a no-op: Supabase default privileges grant `ALL` on `public` tables to `authenticated`, and Postgres ignores a column-level revoke while a table-level grant exists. Second, the same table-level grant let a user `PATCH` their own `is_suspended`, `trust_tier`, or `deleted_at`.

The structural sweep requires every `public` view to set `security_invoker = on`, so "make the view a definer view" is a rejected shape unless the sweep is relaxed.

## Decision

**Option (a): add a `profiles` SELECT policy that lets `authenticated` read other users' rows, and make the column grants the privacy boundary.**

1. `profiles_select_visible` (`FOR SELECT TO authenticated`) admits rows where `deleted_at IS NULL AND is_suspended = false AND NOT app.is_blocked_with(id)`. `profiles_select_own` still admits the caller's own row, including during deletion grace.
2. `REVOKE ALL` on `profiles` (and `gardens`, `verifications`, `blocks`, the stub exchange tables, `profile_cards`) from `anon, authenticated`, then explicit column `GRANT`s. `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES` makes future public tables start closed.
3. `SELECT` is granted only on card-safe columns: `id, handle, display_name, avatar_path, bio, city_label, trust_tier, rating_avg, rating_count, completed_exchanges, created_at`.
4. Owner-only columns (`locale, timezone, onboarding_completed_at, deleted_at, is_suspended, suspended_until, updated_at`) are not table-selectable. The caller reads them through the no-argument `SECURITY DEFINER` RPC `public.get_my_profile()`. `trust_score`, `cancellation_count_90d`, and `home_h3_r7` are returned to nobody ([SPEC-012-R48](../../03-specs/SPEC-012-trust-and-safety.md)).
5. `UPDATE` is granted only on `display_name, avatar_path, bio, locale, timezone, onboarding_completed_at`. `handle` changes go through a future RPC ([SPEC-001-R11](../../03-specs/SPEC-001-authentication.md)).
6. `profile_cards` keeps `security_invoker = on`. Its deleted/suspended filters moved into the policy, because an invoker view needs `SELECT` on every column it references and `is_suspended` / `deleted_at` are owner-only ([SPEC-001-N08](../../03-specs/SPEC-001-authentication.md)).

## Alternatives considered

| Option | Why not |
| --- | --- |
| **(b) A definer view or function for card reads, with an exception in the `security_invoker` sweep** | Moves authorization out of RLS into a view body that bypasses it, which is the footgun [RLS Design §4](../05-rls-design.md) warns about. It needs a permanent exception to a sweep that today has none, and every future "viewer-dependent" projection would cite it as precedent. [ADR-0003](ADR-0003-database-centric-authz.md) prefers policies the planner and the proof obligations can see. |
| Keep the self-only policy and document that cards work only for self | Not a design; the product reads other users' cards on every exchange surface. |

## Consequences

- **Every column granted `SELECT` on `profiles` is visible for every other visible user's row, through the base table as well as through `profile_cards`.** `profile_cards` is now a convenience projection, not the privacy boundary. Adding a column to the `SELECT` grant is a privacy decision and needs Security review.
- [SPEC-012-R17](../../03-specs/SPEC-012-trust-and-safety.md) (`rating_avg` NULL below three ratings) can no longer be enforced in the view alone, since `profiles.rating_avg` is directly selectable. The aggregate recompute must store `NULL` below the threshold.
- `deleted_at` / `is_suspended` no longer reach the client via table reads; the app uses `get_my_profile()` and `get_account_deletion_status()`.
- Any client query must name its columns. `SELECT *` on `profiles` or `gardens` fails with `42501`.
- Future policies must not call the two-argument `app.is_blocked_either_way`; it is no longer client-executable. Use the caller-scoped `app.is_blocked_with(other)`.
- A `profiles` read costs one `blocks` lookup per row; `blocks_blocker_idx` / `blocks_blocked_idx` cover it.
- A moderator can read exactly what any user can read. A moderator-wide profile policy needs its own decision (SPEC-900).
