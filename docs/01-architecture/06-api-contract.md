# API Contract

**Status:** Review · **Version:** 1.0.0 · **Owner:** Architecture

This document is **authoritative for the client-server contract**. Specs describe *why* an endpoint exists; this describes exactly what it accepts, what it returns, and how it fails. A client change that assumes a shape not written here is a bug in the client. A server change that breaks a shape written here is a breaking change and follows §4.

There is no hand-written HTTP layer. Every endpoint below is one of three things: a PostgREST-generated table or view read, a Postgres function invoked over `/rest/v1/rpc/*`, or a Deno Edge Function at `/functions/v1/*`. §1 is the rule for deciding which.

---

## 1. Surface split

### 1.1 Decision rules

Applied in order. The first matching rule wins.

| # | Rule | Surface |
| --- | --- | --- |
| R1 | The operation needs a secret the client must never hold (vendor API key, webhook signing secret, `service_role`). | **Edge Function** |
| R2 | The operation makes an outbound HTTP call, or must retry across process boundaries. | **Edge Function** |
| R3 | The operation processes binary data (images, archives). | **Edge Function** |
| R4 | The operation is triggered by an external system (webhook) or by a schedule. | **Edge Function** (invoked by `pg_cron` or the vendor) |
| R5 | The operation changes the state of a row whose legality depends on the state of *another* row, or must be atomic across more than one table. | **Postgres RPC** (`SECURITY DEFINER`) |
| R6 | The operation reads data derived from the `private` schema. | **Postgres RPC** (`SECURITY DEFINER`) |
| R7 | The operation's authorization cannot be expressed as an RLS predicate over the row being touched. | **Postgres RPC** |
| R8 | The read needs ranking, aggregation, or a spatial predicate that PostgREST cannot express safely. | **Postgres RPC** (`STABLE`) |
| R9 | Everything else — a read whose authorization *is* an RLS predicate, or a single-row write to a table the caller owns outright. | **PostgREST** |

### 1.2 What that produces

| Surface | Contents | Count |
| --- | --- | --- |
| **PostgREST reads** | `profile_cards`, `crop_kingdoms`, `crop_categories`, `crop_species`, `crop_varieties`, `safe_spots`, `inventory_items`, `listings`, `listing_safe_spots`, `exchange_requests`, `exchange_sessions`, `message_threads`, `messages`, `notifications`, `notification_preferences`, `devices`, `gardens`, `verifications`, `media_assets`, `ratings`, `blocks` | 21 |
| **PostgREST writes** | `inventory_items` (INSERT/UPDATE), `listings` (INSERT/UPDATE draft/active only), `gardens` (UPDATE non-derived columns), `profiles` (UPDATE self), `notification_preferences` (UPSERT), `messages` (INSERT), `blocks` (INSERT) | 7 |
| **Postgres RPCs** | Every state transition, every read touching `private`, every spatial or ranked query | 18 |
| **Edge Functions** | KYC start + webhook, media processing, push drain, content scan, moderation action, account deletion, OSM candidate import | 8 |

### 1.3 The load-bearing negatives

Restating the things that are deliberately *absent*, because their absence is the security property:

- **`exchange_requests` and `exchange_sessions` have no client UPDATE policy at all.** Every status change goes through an RPC. If a client could `PATCH /rest/v1/exchange_requests?id=eq.X` with `{"status":"accepted"}`, every concurrency guarantee in [Exchange State Machine §5](07-exchange-state-machine.md) would be void. See [RLS Design §5 Pattern C](05-rls-design.md).
- **`listings` UPDATE is restricted to `status IN ('draft','active')`.** A reserved listing is owned by the state machine, not by its owner.
- **`gardens.display_point`, `h3_r7`, `h3_r9` are not client-writable**, enforced by a trigger that raises `42501`, not by an omitted column in a repository function ([Location Privacy §4.3](04-location-privacy.md)).
- **The `private` schema is not in PostgREST's `db-schemas` setting**, and no role has any grant on it. There is no request that reaches it.
- **`safe_spots` has no client write path.** Staff-only in MVP ([PRD C7](../00-foundation/02-prd.md)).
- **`private.osm_spot_candidates` is not reachable at all.** It is in `private` for the same reason `garden_locations` is: "an unreviewed candidate is never discoverable" is then a property of where the row sits, not of a status filter somebody has to remember in every query ([ADR-0021](adr/ADR-0021-osm-safe-spot-sourcing.md), [SPEC-007-R44](../03-specs/SPEC-007-safe-spots.md)). `GET /rest/v1/osm_spot_candidates` 404s at the API layer before it reaches Postgres.
- **There is no `DELETE` anywhere.** Deletion is soft (`deleted_at` via UPDATE) or goes through `request_account_deletion` → `account-delete`. No table grants `DELETE` to `authenticated`.

---

## 2. Auth model

### 2.1 Token shape

Supabase GoTrue issues an RS256 JWT. The claims the API depends on:

```json
{
  "iss": "https://<project-ref>.supabase.co/auth/v1",
  "sub": "8f14e45f-ceea-4a2f-9c1e-3d0f5a7b2e91",
  "aud": "authenticated",
  "exp": 1786312800,
  "iat": 1786309200,
  "email": "gardener@example.com",
  "phone": "",
  "role": "authenticated",
  "aal": "aal1",
  "amr": [
    { "method": "password", "timestamp": 1786309200 }
  ],
  "session_id": "b1e0c1c2-1f3a-4a0b-9a2b-7cbe1d6f0a11",
  "is_anonymous": false,
  "app_metadata": {
    "provider": "apple",
    "providers": ["apple"],
    "role": "user"
  },
  "user_metadata": {}
}
```

| Claim | Read by | Notes |
| --- | --- | --- |
| `sub` | `auth.uid()` in every policy and RPC | The only identity the database trusts |
| `role` | PostgREST → `SET LOCAL ROLE` | `anon` or `authenticated`. Never `service_role` from a client. |
| `app_metadata.role` | `app.is_moderator()` | `'user'` \| `'moderator'` \| `'admin'`. In the token, not a table, so policies pay no per-row query ([RLS Design §2](05-rls-design.md)). |
| `aal` | Step-up checks (§2.4) | `'aal1'` after password/OAuth, `'aal2'` after a TOTP challenge |
| `amr` | Audit, and the `aal2` freshness check | `[{method:'totp', timestamp}]` gives the age of the second factor |
| `session_id` | Device correlation, forced sign-out | |
| `exp` | Kong, PostgREST | |

> **`app_metadata` is writable only by `service_role`.** `user_metadata` is writable by the user and is therefore treated as untrusted input everywhere. A policy that reads `user_metadata` for authorization is a privilege escalation; CI greps for it.

### 2.2 Roles

| Role | Obtained by | Can reach |
| --- | --- | --- |
| `anon` | The publishable anon key with no JWT | `crop_*` taxonomy, `safe_spots WHERE status='active'`, `kyc-start` (no — see below). Nothing else. |
| `authenticated` | A valid user JWT | Everything, governed entirely by RLS policy |
| `moderator` | `authenticated` + `app_metadata.role IN ('moderator','admin')` | Elevated read on reports, messages in reported threads, garden submissions, plus `moderation-action` |
| `service_role` | The service key, Edge Function and CI secrets only | Bypasses RLS entirely. Never in a client, an artifact, an `EXPO_PUBLIC_*` var, or a log ([RLS Design RLS-3](05-rls-design.md)). |
| `break_glass` | Two-person authorized, 60-minute time box | `private.garden_locations` read, fully audited ([Location Privacy §10](04-location-privacy.md)) |

The `anon` surface is deliberately tiny: taxonomy and safe spots, so the app can render something before sign-in and so the store review build has content. Everything else 401s.

### 2.3 Lifetimes

| Token | Lifetime | Rotation |
| --- | --- | --- |
| Access JWT | **3600 s** | Refreshed at `exp − 300 s` by the SDK, but only while the app is foregrounded ([Mobile Architecture §5.3](02-mobile-architecture.md)) |
| Refresh token | Valid until used | **Rotating**, with a 10-second reuse window for concurrent-refresh races. A reuse outside that window revokes the entire session family and forces re-auth. |
| Session | 30 days inactivity, **90 days absolute** | Absolute expiry is not extendable. |
| `aal2` elevation | **15 minutes** from the `amr` TOTP timestamp | Not a separate token; a freshness check on the existing claim. |
| Persona session token | 15 minutes, single use | Issued by `kyc-start`, never persisted client-side |
| Storage signed URL | 3600 s for originals, 86400 s for thumbnails | |
| `handoff_code` | Life of the session; invalid outside the confirmation window | Encrypted at rest ([Exchange State Machine §3.3](07-exchange-state-machine.md)); fetched via `rpc.get_handoff_code`; never persisted client-side ([Mobile Architecture §5.4](02-mobile-architecture.md)) |

A 1-hour access token means a revoked moderator claim persists for up to an hour. Accepted, and mitigated by also checking `profiles.is_suspended` on every sensitive write ([RLS Design §2](05-rls-design.md)).

### 2.4 Step-up auth (AAL2)

Certain operations require a *fresh* second factor, not merely an enrolled one. The check is a shared helper, so the freshness window exists in one place:

```sql
CREATE OR REPLACE FUNCTION app.require_aal2(p_max_age interval DEFAULT interval '15 minutes')
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_claims jsonb := current_setting('request.jwt.claims', true)::jsonb;
  v_ts     bigint;
BEGIN
  IF COALESCE(v_claims ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'aal2_required' USING ERRCODE = '42501';
  END IF;
  SELECT MAX((e ->> 'timestamp')::bigint) INTO v_ts
    FROM jsonb_array_elements(v_claims -> 'amr') e
   WHERE e ->> 'method' IN ('totp', 'mfa/totp');
  IF v_ts IS NULL OR to_timestamp(v_ts) < now() - p_max_age THEN
    RAISE EXCEPTION 'aal2_stale' USING ERRCODE = '42501';
  END IF;
END; $$;
```

| Operation | Requires AAL2 | Source |
| --- | --- | --- |
| Change email | Yes | [PRD C2](../00-foundation/02-prd.md) |
| Change password | Yes | PRD C2 |
| Disable 2FA / regenerate recovery codes | Yes | PRD C2 |
| View account security settings | Yes | PRD C2 |
| `request_account_deletion` | Yes | Extends PRD C2. Deletion is irreversible after the grace period; a stolen unlocked phone should not be able to do it. |
| Deregister another device | Yes | Same reasoning |
| Everything else | No | Including all exchange operations — requiring a TOTP code at a library counter is a usability failure that would drive people off-platform |

A user with no TOTP enrolled who hits an AAL2-gated operation gets `aal2_required` and is routed to enrollment, not to a dead end.

---

## 3. Conventions

### 3.1 Idempotency

**Every mutating RPC takes an `idempotency_key uuid`, generated client-side, and is unique-indexed.** This is not optional and there is no exception.

```sql
-- The shape, on every mutation-carrying table
CREATE UNIQUE INDEX exchange_requests_idem
  ON public.exchange_requests (requester_id, idempotency_key);
```

Rules:

1. The key is generated **once, when the user's intent is formed** (on button press), and reused across every retry of that intent. Regenerating it on retry defeats the entire mechanism.
2. **A replay returns the original result with the original status code**, not a 409. Idempotency is **key-based**, through the shared `app.idempotency_probe` / `app.idempotency_record` helpers ([Exchange State Machine §4.1](07-exchange-state-machine.md)): the probe runs before any lock, the record commits inside the effect's transaction, and the same key arriving with **different arguments** raises `idempotency_conflict` 409 — which is a client bug and must never be retried. `accept_exchange_request` adds a second layer on top: a natural-key lookup for an existing session on `(request_id, owner_id)`, so a retry that arrives with a *new* key is still not a second acceptance. Declaring a `p_idempotency_key` parameter and never reading it — which the first draft of that function did — satisfies none of this.
3. A key replayed with **different arguments** raises `idempotency_conflict` (409). Silently returning the first result for a different request is worse than an error.
4. Keys are retained for **7 days**, then reaped by `pg_cron`. Retry windows are minutes; 7 days is generous.
5. Rows whose primary key is client-generated (`inventory_items`, `messages`, `media_assets`) use the **PK as the idempotency key** — a replayed INSERT conflicts on PK, and `ON CONFLICT DO NOTHING` plus a `RETURNING` read makes the replay a success.

### 3.2 Versioning

**Additive-only.** Within a major contract version:

| Change | Allowed | Notes |
| --- | --- | --- |
| Add a nullable column to a table or view | Yes | Clients ignore unknown fields |
| Add an optional parameter with a default to an RPC | Yes | Postgres named-argument dispatch makes this safe |
| Add a new enum value | **Careful** | Allowed only if every client handles unknown values as a default case. Client enum parsing uses a `catchall` in zod for exactly this. Adding a `session_state` value is a **breaking** change and requires a new RPC. |
| Add a new RPC | Yes | |
| Add a new error code | Yes | Clients render unknown codes generically |
| Remove or rename a column | **No** | Expand → migrate → contract, across ≥ 2 releases ([Data Model §15](03-data-model.md)) |
| Change a column's type or nullability | **No** | New column, dual-write, switch, drop |
| Change an RPC's parameter names or types | **No** | Parameters are named in the JSON body; renaming one is a break |
| Change an RPC's return shape | **No** | New RPC |
| Tighten a validation rule | **No** | Existing clients start failing on inputs they consider valid |

For a genuinely breaking change: **a new RPC with a `_v2` suffix**, e.g. `accept_exchange_request_v2`. Both exist simultaneously. `_v1` is marked `-- DEPRECATED: remove after <date>` in the migration, keeps working, and is dropped only once `devices.app_version` telemetry shows < 2% of DAU on a version that calls it ([Data Model §15.3](03-data-model.md), [ADR-0017](adr/ADR-0017-release-cadence.md)).

A **two-version compatibility rule** is enforced mechanically: the backend must serve the current mobile release and the one before it. CI runs the previous release's contract test suite against the new migrations, and a failure blocks merge.

The contract version is a header, echoed on every response:

```
x-sc-contract: 1
```

A client seeing a `x-sc-contract` greater than it understands shows a soft "Update available" prompt. A client seeing one *less* than it requires shows a hard block — this can only happen during a rollback and it is better to stop than to guess.

### 3.3 Pagination

**Keyset, never offset.** `OFFSET 4000` makes Postgres scan and discard 4000 rows under an RLS predicate, and it double-shows or skips rows when the underlying set changes between pages — which for a live inbox is constantly.

Every paginated read takes an opaque cursor:

```
cursor = base64url(json({ t: "2026-08-08T14:22:31.442Z", id: "8f14e45f-…" }))
```

Sort is always `(created_at DESC, id DESC)` — `id` breaks ties, because `created_at` is not unique and a non-unique keyset loses rows.

PostgREST form:

```http
GET /rest/v1/notifications
    ?select=id,kind,title,body,deep_link,read_at,created_at
    &order=created_at.desc,id.desc
    &limit=30
    &or=(created_at.lt.2026-08-08T14:22:31.442Z,and(created_at.eq.2026-08-08T14:22:31.442Z,id.lt.8f14e45f-…))
```

RPC form: `p_cursor text DEFAULT NULL, p_limit int DEFAULT 30` with `LEAST(p_limit, 100)` server-side.

Response envelope for RPCs:

```json
{
  "items": [ /* … */ ],
  "next_cursor": "eyJ0IjoiMjAyNi0wOC0wOFQxNDoxMDowMFoiLCJpZCI6IjRhMmYt…"
}
```

`next_cursor` is `null` at the end. Clients never construct or parse a cursor; they pass it back verbatim. This is what lets us change the sort key without a client release.

**Limits:** default 30, max 100 everywhere except `messages` (default 50, max 200) and `safe_spots_near` (fixed 200, non-paginated by design — see §5.2).

### 3.4 Error taxonomy

The client never sees a raw Postgres message. A raw message can contain row data ([Location Privacy §8](04-location-privacy.md)), so `RAISE EXCEPTION` uses a stable code as the message text and PostgREST's SQLSTATE mapping supplies the HTTP status.

| Code | SQLSTATE | HTTP | Meaning |
| --- | --- | --- | --- |
| `validation_failed` | `22023` | 400 | Malformed or out-of-range input |
| `idempotency_conflict` | `22023` | 409 | Key reused with different arguments |
| `unauthenticated` | — | 401 | Missing, expired, or invalid JWT |
| `aal2_required` | `42501` | 403 | Second factor needed |
| `aal2_stale` | `42501` | 403 | Second factor older than 15 minutes |
| `not_authorized` | `42501` | 403 | Caller is not a party to this resource |
| `not_verified` | `42501` | 403 | `app.can_transact()` is false |
| `blocked` | `42501` | 403 | A block exists in either direction |
| `suspended` | `42501` | 403 | `profiles.is_suspended` |
| `request_not_found` | `P0002` | 404 | Gone, or never existed, or invisible under RLS |
| `request_not_pending` | `P0001` | 409 | Already resolved |
| `listing_unavailable` | `P0001` | 409 | Reserved by someone else |
| `listing_expired` | `P0001` | 409 | Past `expires_at` |
| `invalid_transition` | `P0001` | 409 | Illegal state change |
| `stale_state` | `P0001` | 409 | `p_expected_version` mismatch |
| `conflict` | `23505` | 409 | Unique violation not covered by a more specific code |
| `venue_closed` | `P0001` | 422 | Proposed window outside the safe spot's hours |
| `quota_exceeded` | `P0001` | 422 | Cardinality limit (10 open requests, 5 photos, 3 safe spots) |
| `rate_limited` | `P0001` | 429 | Token bucket empty; `Retry-After` set |
| `deadlock` | `40P01` | 500 | Retryable ×3 with jitter |
| `server_error` | — | 500 | Anything unmapped. Logged with a correlation id; the client sees only the id. |

> **RLS invisibility is `404`, not `403`.** A row the caller cannot SELECT does not exist as far as they are concerned. Returning 403 would confirm the row exists, which for `exchange_requests` and `profile_cards` is an enumeration oracle.

Wire shape (PostgREST's, unchanged — we do not wrap it, because wrapping means a translation layer that can drift):

```json
{
  "code": "P0001",
  "message": "listing_unavailable",
  "details": null,
  "hint": null
}
```

`src/api/errors.ts` maps `message` → the domain code union. `details` and `hint` are **always null** from our functions; a `RAISE ... USING DETAIL = ...` that includes row data is caught by a CI grep over `supabase/migrations/**`.

### 3.5 `Retry-After`

Every 429 carries `Retry-After` in **seconds** (integer, never a date — date parsing across platforms is a source of bugs and clock-skew errors).

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
x-sc-ratelimit-limit: 20
x-sc-ratelimit-remaining: 0
x-sc-ratelimit-reset: 1786309247
```

Client obligation ([Mobile Architecture §8.2](02-mobile-architecture.md)): disable the action for exactly that duration with a visible countdown, and do **not** auto-retry a mutation. Auto-retrying into a limit is how a rate limit becomes an outage. Reads may auto-retry once after the interval.

### 3.6 Standard request headers

| Header | Required | Notes |
| --- | --- | --- |
| `apikey` | Yes | The publishable anon key. Not a secret; it is a routing token. |
| `Authorization: Bearer <jwt>` | Yes (except taxonomy/safe-spot anon reads) | |
| `Content-Type: application/json` | On writes | |
| `Prefer: return=representation` | Optional | On writes where the client needs the row back |
| `x-client-info` | Yes | `sharecropr/<version>`; drives the compatibility gate |
| `x-request-id` | Yes | Client-generated uuid, echoed back and joined to `audit.events.request_id` ([Observability](../05-operations/04-observability.md)) |

---

## 4. Endpoint catalog — reads

All reads are `GET /rest/v1/<name>` unless noted. All are RLS-filtered; the "auth" column states the *minimum*, and the policy states the *scope*.

### 4.1 `profile_cards` (view)

| Property | Value |
| --- | --- |
| Auth | `authenticated` |
| Rate limit | 120 / min / user |
| Policy | `security_invoker` view over `profiles`, excluding suspended, deleted, and blocked-either-way ([RLS Design §4](05-rls-design.md)) |

```http
GET /rest/v1/profile_cards?id=eq.<uuid>&select=*
```

```json
{
  "id": "8f14e45f-…",
  "handle": "annarborgrows",
  "display_name": "Priya",
  "avatar_path": "avatars/8f14e45f/a1.jpg",
  "bio": "Raised beds, too many tomatoes.",
  "city_label": "Ann Arbor, MI",
  "trust_tier": "id_verified",
  "rating_avg": 4.83,
  "rating_count": 12,
  "completed_exchanges": 14,
  "created_at": "2026-03-02T18:11:02Z"
}
```

**Never present:** `trust_score`, `cancellation_count_90d`, `home_h3_r7`, `is_suspended`, `email`. These are column-`REVOKE`d from `authenticated` on the base table and absent from the view.

Errors: `unauthenticated` 401. A blocked or suspended subject returns an **empty array**, not 404 — the caller learns nothing.

### 4.2 `crop_species`, `crop_varieties`, `crop_categories`, `crop_kingdoms`

| Property | Value |
| --- | --- |
| Auth | `anon` |
| Rate limit | 60 / min / IP (rarely hit; the client bundles this data) |
| Cache | `Cache-Control: public, max-age=86400`. `staleTime: Infinity` client-side. |

```http
GET /rest/v1/crop_species?is_active=eq.true&select=id,category_id,botanical_category_id,slug,common_name,scientific_name,aliases,allergen_tags,typical_units,season_months&order=common_name.asc
```

```json
[{
  "id": 412,
  "category_id": 2,
  "botanical_category_id": 3,
  "slug": "tomato",
  "common_name": "Tomato",
  "scientific_name": "Solanum lycopersicum",
  "aliases": ["love apple"],
  "allergen_tags": [],
  "typical_units": ["each", "pound", "quart"],
  "season_months": [6,7,8,9,10]
}]
```

`crop_varieties` filters unapproved varieties to their submitter:

```http
GET /rest/v1/crop_varieties?species_id=eq.412&select=id,species_id,slug,name,is_approved
```

Delta sync: `GET /rest/v1/taxonomy_version?select=version,updated_at` returns a single row. If it matches the bundled version, no taxonomy request is made at all.

### 4.3 `safe_spots`

| Property | Value |
| --- | --- |
| Auth | `anon` (read), `moderator` (write) |
| Rate limit | 60 / min / IP |
| Cache | `max-age=3600` |

```http
GET /rest/v1/safe_spots?id=eq.<uuid>&select=id,name,category,address_line,locality,region,postal_code,country,hours,hours_verified_at,accessibility_notes,parking_notes,safety_notes,photo_path,is_indoor,has_cameras
```

Note `point` is **not** in the default select. Coordinates come from `safe_spots_near`, which is the only path that also applies the radius cap and the row cap. Detail reads are by id and don't need the geometry. (`point` is readable — safe-spot coordinates are public data — but keeping it off the detail path keeps bulk-harvesting on the rate-limited RPC.)

### 4.4 `inventory_items`

| Property | Value |
| --- | --- |
| Auth | `authenticated`, owner-only (Pattern A) |
| Rate limit | 120 / min / user read, 60 / min / user write |

```http
GET /rest/v1/inventory_items
    ?owner_id=eq.<me>&deleted_at=is.null&status=in.(available,listed,reserved)
    &select=*,media:media_assets(id,path,blurhash,width,height)
    &order=created_at.desc&limit=50
```

```json
{
  "id": "3d0f5a7b-…",
  "garden_id": "9c1e3d0f-…",
  "owner_id": "8f14e45f-…",
  "species_id": 412,
  "variety_id": 1188,
  "custom_label": null,
  "quantity": 4.00,
  "unit": "pound",
  "condition": "just_picked",
  "harvested_on": "2026-08-07",
  "best_by": "2026-08-12",
  "is_organic_claim": true,
  "notes": "Cherokee Purple, a few split.",
  "status": "available",
  "created_at": "2026-08-07T13:02:11Z",
  "updated_at": "2026-08-07T13:02:11Z",
  "media": [{ "id": "…", "path": "crops/…/1.jpg", "blurhash": "L6PZfSi_.AyE…", "width": 1200, "height": 900 }]
}
```

Writes:

```http
POST  /rest/v1/inventory_items          # id generated client-side (idempotency)
PATCH /rest/v1/inventory_items?id=eq.X  # owner-only; deleted_at set here for soft delete
```

Errors: `validation_failed` 400 (quantity ≤ 0, unknown `species_id`, text over limit), `not_authorized` 403 (garden not owned), `conflict` 409 (PK replay — treated as success by the client).

### 4.5 `listings`

| Property | Value |
| --- | --- |
| Auth | `authenticated` — Pattern D, the most complex policy in the system ([RLS Design §5](05-rls-design.md)) |
| Rate limit | 120 / min / user read, 20 / min / user write |

```http
GET /rest/v1/listings
    ?id=eq.<uuid>
    &select=id,owner_id,species_id,title,description,status,wanted_species_ids,accepts_any,expires_at,published_at,
            item:inventory_items(id,quantity,unit,condition,harvested_on,best_by,is_organic_claim,variety_id),
            spots:listing_safe_spots(safe_spot_id),
            owner:profile_cards(handle,display_name,avatar_path,trust_tier,rating_avg,rating_count)
```

Writes are `POST` (draft) and `PATCH` (draft/active only). Publishing sets `status='active'` and `published_at`. `reserved` and beyond are RPC territory.

Errors: `not_verified` 403 (`app.can_transact()` false on insert), `quota_exceeded` 422 (more than 3 safe spots, expiry beyond 21 days), `conflict` 409 (`listings_one_active_per_item`).

### 4.6 `exchange_requests`

| Property | Value |
| --- | --- |
| Auth | `authenticated`, participant-only (Pattern C) |
| Rate limit | 120 / min / user |
| Writes | **INSERT only, and only via `create_exchange_request`.** No UPDATE policy exists. |

```http
GET /rest/v1/exchange_requests
    ?owner_id=eq.<me>&status=eq.pending
    &select=id,listing_id,requester_id,owner_id,offered_item_id,message,status,proposed_safe_spot_id,expires_at,created_at,
            listing:listings(id,title,species_id),
            offered:inventory_items(id,species_id,variety_id,quantity,unit,condition),
            requester:profile_cards(handle,display_name,avatar_path,trust_tier,rating_avg,rating_count)
    &order=created_at.desc,id.desc&limit=30
```

`idempotency_key` is **not** in any select list. It is an implementation detail of the write path and returning it invites clients to reuse it.

### 4.7 `exchange_sessions`

| Property | Value |
| --- | --- |
| Auth | `authenticated`, participant-only |
| Rate limit | 120 / min / user |
| Writes | RPC only |

```http
GET /rest/v1/exchange_sessions?id=eq.<uuid>
    &select=id,request_id,owner_id,requester_id,state,safe_spot_id,scheduled_start,scheduled_end,
            owner_confirmed_at,requester_confirmed_at,completed_at,cancelled_by,cancelled_reason,cancelled_at,version,
            spot:safe_spots(id,name,category,address_line,hours,accessibility_notes,parking_notes)
```

**`handoff_code` is excluded from the default select and from every list query, and `SELECT` on the column is `REVOKE`d from `authenticated` outright.** The column is `bytea` — encrypted at rest against a Vault key — so even a successful direct read returns ciphertext. It is returned by exactly **one** path: `rpc.get_handoff_code`, which either participant may call only when the session is `scheduled`, and which audits every call as `exchange.code_read`. `accept_exchange_request` does **not** return it — an earlier draft returned "the acceptor's copy" at acceptance, which contradicted the rule two paragraphs of [Exchange State Machine §3.1](07-exchange-state-machine.md) also stated, and left the requester with no specified way to obtain the code at all. Both parties now read it the same way, at the same point in the lifecycle, and it is never persisted client-side.

`version` is mandatory in every select, because every mutating session RPC takes `p_expected_version` (H5).

`scheduled_start` + `safe_spot_id` together are the highest-value target in the database for a stalker ([Data Model §10](03-data-model.md)). They are excluded from all analytics and scrubbed from telemetry.

### 4.8 `messages` and `message_threads`

| Property | Value |
| --- | --- |
| Auth | `authenticated`, thread participant, thread not closed |
| Rate limit | 240 / min / user read, **20 / min / user send** |

```http
GET /rest/v1/messages
    ?thread_id=eq.<uuid>&select=id,thread_id,sender_id,kind,body,read_at,created_at
    &order=created_at.desc,id.desc&limit=50
```

Send is a plain INSERT with a client-generated `id`:

```http
POST /rest/v1/messages
{ "id": "1f3a4a0b-…", "thread_id": "…", "body": "Running about 10 minutes late." }
```

`flagged_reason` is **not** selectable by clients. It is set asynchronously by `content-scan` and visible only to moderators; showing a sender that their message was flagged tells them exactly what evasion to try next.

Errors: `not_authorized` 403 (not a participant, or `is_closed`), `validation_failed` 400 (body empty or > 2000 chars), `rate_limited` 429.

### 4.9 `notifications`

| Property | Value |
| --- | --- |
| Auth | `authenticated`, owner-only |
| Rate limit | 120 / min / user |

```http
GET /rest/v1/notifications
    ?select=id,kind,title,body,deep_link,payload,read_at,created_at
    &order=created_at.desc,id.desc&limit=30
```

`payload` carries a `CHECK` forbidding `lat`/`lng`/`point`/`coordinates` keys ([Data Model §12](03-data-model.md)). Unread count:

```http
GET /rest/v1/notifications?read_at=is.null&select=id
Prefer: count=exact
Range: 0-0
```

→ `Content-Range: 0-0/7`. A count-only request with a zero-row range; cheaper than fetching ids.

### 4.10 Everything else

| Endpoint | Auth | Limit | Notes |
| --- | --- | --- | --- |
| `gardens` | owner-only | 60/min | Derived location columns are read-only; a write attempt raises `42501` |
| `verifications` | owner-only | 60/min | Thin by design: status, `is_over_18`, `document_country`, timestamps, `attempt_count` |
| `notification_preferences` | owner-only | 60/min | UPSERT allowed |
| `devices` | owner-only | 60/min | Read for the device list; writes go through `register_device` |
| `media_assets` | owner or counterparty via listing | 120/min | `exif_stripped_at IS NULL` makes a row invisible in every policy |
| `ratings` | participant, `is_revealed` gated | 60/min | Double-blind until both submit or 7 days ([PRD C12](../00-foundation/02-prd.md)) |
| `blocks` | blocker-only read; INSERT via `create_block` | 30/min | The blocked party can never see the row |
| `listing_safe_spots` | follows `listings` | 120/min | Usually embedded, rarely queried directly |
| `taxonomy_version` | `anon` | 60/min | One row |

---

## 5. Endpoint catalog — RPCs

`POST /rest/v1/rpc/<name>` with a JSON body of named parameters. All are `SECURITY DEFINER` with a pinned `search_path` and re-check authorization as their first act ([RLS Design §7](05-rls-design.md)).

### 5.1 `get_my_garden_location`

| | |
| --- | --- |
| Auth | `authenticated`, owner only |
| Limit | 10 / min / user |
| Reads `private` | **Yes** — the only client-reachable function that returns an exact coordinate, and only the caller's own |

```json
// request
{}
// response
{ "lat": 42.28086, "lng": -83.74304, "accuracy_m": 8.2, "captured_at": "2026-03-02T18:04:55Z", "capture_source": "device_gps" }
```

The caller already knows where they live ([Location Privacy §5](04-location-privacy.md)). The function hard-filters on `auth.uid() = gardens.owner_id`; there is no parameter to pass someone else's garden id. The response is never persisted client-side and never logged.

Errors: `request_not_found` 404 (no garden), `not_authorized` 403.

### 5.2 `safe_spots_near`

| | |
| --- | --- |
| Auth | `authenticated` |
| Limit | **30 / min / user** (Postgres token bucket — the primary anti-scraping control) |
| Shape | Defined verbatim in [Location Privacy §6](04-location-privacy.md) |

```json
// request — lat/lng quantized client-side to ~100 m before transmission
{ "p_lat": 42.281, "p_lng": -83.743, "p_radius_m": 8000, "p_category_ids": [2, 4] }
```

```json
// response
[{
  "safe_spot_id": "…", "name": "Ann Arbor District Library — Downtown",
  "category": "public_library", "lat": 42.28031, "lng": -83.74797,
  "distance_m": 612.4, "listing_count": 7, "top_categories": [2, 4, 6]
}]
```

Structural properties, restated because they are the reason this endpoint is safe:

- `RETURNS TABLE` has **no column that could hold a user coordinate**. A catastrophic bug in the body cannot leak one.
- Radius is capped server-side at 40 km via `LEAST(p_radius_m, 40000)`. A client asking for 10,000 km gets 40.
- `LIMIT 200` bounds both the response and the scraping yield.
- Blocks are applied inside the aggregate, so a blocked user's listings do not contribute to a count.
- Not paginated. Pagination would let an attacker walk past the 200-row cap.

Errors: `validation_failed` 400 (lat/lng out of range), `rate_limited` 429.

### 5.3 `search_listings`

| | |
| --- | --- |
| Auth | `authenticated` |
| Limit | 30 / min / user |

```json
// request
{
  "p_lat": 42.281, "p_lng": -83.743, "p_radius_m": 8000,
  "p_species_ids": [412], "p_category_ids": null, "p_query": "cherokee",
  "p_safe_spot_id": null, "p_cursor": null, "p_limit": 30
}
```

```json
// response
{
  "items": [{
    "listing_id": "…", "title": "Cherokee Purple tomatoes", "species_id": 412, "variety_id": 1188,
    "quantity": 4.0, "unit": "pound", "condition": "just_picked", "expires_at": "2026-08-14T13:02:11Z",
    "owner": { "handle": "annarborgrows", "display_name": "Priya", "avatar_path": "…",
               "trust_tier": "id_verified", "rating_avg": 4.83, "rating_count": 12 },
    "safe_spots": [{ "safe_spot_id": "…", "name": "AADL Downtown", "distance_m": 612.4 }],
    "thumbnail": { "path": "crops/…/thumb.jpg", "blurhash": "L6PZfSi_.AyE…" }
  }],
  "next_cursor": "eyJ0IjoiMjAyNi0wOC0wOFQxMzowMjoxMVoiLCJpZCI6IjRhMmYt…"
}
```

Ranking: trigram similarity on `common_name || aliases` (`p_query`), then distance from the nearest attached safe spot, then `published_at DESC`. Distance is to the **safe spot**, never to the owner's garden — the function has no access to a garden point and no column to return one.

Errors: `validation_failed` 400, `rate_limited` 429.

### 5.4 Exchange lifecycle RPCs

All take `p_idempotency_key uuid`. All session-mutating RPCs take `p_expected_version integer` (H5, [Exchange State Machine §5](07-exchange-state-machine.md)). All are `authenticated` and require `app.can_transact()` except the withdraw/cancel paths, which must remain available to a user who has since been un-verified — you can always get *out*.

| RPC | Actor | Limit | Request | Response |
| --- | --- | --- | --- | --- |
| `create_exchange_request` | Requester | **10 / hour / user** | `{ p_listing_id, p_offered_item_id?, p_message?, p_proposed_safe_spot_id?, p_idempotency_key }` | `{ request_id, thread_id, expires_at }` |
| `accept_exchange_request` | Owner | 30 / hour / user, consumed **before** the locks | `{ p_request_id, p_idempotency_key }` | `{ session_id }` — never the code |
| `decline_exchange_request` | Owner | 60 / hour / user | `{ p_request_id, p_reason?, p_idempotency_key }` | `{ request_id, status: "declined" }` |
| `withdraw_exchange_request` | Requester | 60 / hour / user | `{ p_request_id, p_idempotency_key }` | `{ request_id, status: "withdrawn" }` |
| `propose_schedule` | Either | 30 / hour / user | `{ p_session_id, p_safe_spot_id, p_start, p_end, p_expected_version, p_idempotency_key }` | `{ session_id, state, version, proposed_by }` |
| `confirm_schedule` | The other party | 30 / hour / user | `{ p_session_id, p_expected_version, p_idempotency_key }` | `{ session_id, state: "scheduled", version, scheduled_start, scheduled_end, safe_spot_id }` |
| `confirm_handoff` | Either | **5 / rolling 15 min / session** | `{ p_session_id, p_code, p_expected_version, p_idempotency_key }` — version is **advisory** here ([SPEC-010 R42a](../03-specs/SPEC-010-exchange-lifecycle.md)) | `{ session_id, ok, reason, state, version, attempts_remaining, retry_after_s, both_confirmed }` |
| `get_handoff_code` | Either participant | 20 / hour / session | `{ p_session_id }` | `{ handoff_code }` — only when `state = 'scheduled'`; audited as `exchange.code_read` |
| `contest_no_show` | The marked party | 5 / day / user | `{ p_session_id, p_idempotency_key }` | `{ session_id, cleared }` — clears attribution, state stays `no_show` |
| `cancel_session` | Either | 20 / day / user | `{ p_session_id, p_reason, p_expected_version, p_idempotency_key }` | `{ session_id, state: "cancelled", version, counts_as_late: bool }` |
| `submit_rating` | Either, post-completion | 30 / day / user | `{ p_session_id, p_stars, p_tags?, p_comment?, p_idempotency_key }` | `{ rating_id, is_revealed }` |

Per-RPC error codes:

| RPC | Errors |
| --- | --- |
| `create_exchange_request` | `not_verified` 403 · `blocked` 403 · `listing_expired` 409 · `listing_unavailable` 409 · `conflict` 409 (already a pending request for this listing) · `quota_exceeded` 422 (≥ 10 open requests) · `validation_failed` 400 (self-request, offered item not owned or not `available`) · `rate_limited` 429 |
| `accept_exchange_request` | `request_not_found` 404 · `not_authorized` 403 · `not_verified` 403 · `blocked` 403 · `request_not_pending` 409 · `listing_unavailable` 409 · `listing_expired` 409 · `deadlock` 500 (retryable) |
| `decline_exchange_request` | `request_not_found` 404 · `not_authorized` 403 · `request_not_pending` 409 |
| `withdraw_exchange_request` | `request_not_found` 404 · `not_authorized` 403 · `request_not_pending` 409 |
| `propose_schedule` | `not_authorized` 403 · `invalid_transition` 409 · `stale_state` 409 · `venue_closed` 422 (window outside `safe_spots.hours`) · `validation_failed` 400 (`start < now()+1h`, `start > now()+14d`, spot not in the listing's set, `end <= start`) |
| `confirm_schedule` | `not_authorized` 403 · `invalid_transition` 409 · `stale_state` 409 · `validation_failed` 400 (confirming your own proposal) |
| `confirm_handoff` | **Raises** `not_authorized` 403 · `invalid_transition` 409 · `request_not_found` 404. **Returns 200 with `ok = false`** for `handoff_code_invalid`, `handoff_window_closed`, and `rate_limited` — because each of those must durably record an attempt, and a `RAISE` rolls the record back ([SPEC-010 R49a](../03-specs/SPEC-010-exchange-lifecycle.md)). Never `stale_state`: the version is advisory on this RPC. **5 wrong attempts inside one rolling 15-minute window lock confirmation for 15 minutes and notify both parties** |
| `cancel_session` | `not_authorized` 403 · `invalid_transition` 409 · `stale_state` 409 · `validation_failed` 400 (reason missing or > 200 chars). `counts_as_late` is true when cancelling < 4 h before `scheduled_start`; it increments `cancellation_count_90d`. |
| `submit_rating` | `not_authorized` 403 · `invalid_transition` 409 (session not `completed`) · `conflict` 409 (already rated) · `validation_failed` 400 (stars outside 1–5, tag outside the closed vocabulary, self-rating) |

Note the deliberate asymmetry on `confirm_handoff`'s limit: it is **per session**, not per user, because the abuse case is brute-forcing one six-digit code, not making many calls.

### 5.5 Trust & safety RPCs

| RPC | Auth | Limit | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `create_report` | `authenticated` | 10 / day / user | `{ p_subject_type, p_subject_id, p_reason, p_details?, p_idempotency_key }` | `{ report_id, sla_due_at }` | `validation_failed` 400 · `request_not_found` 404 · `conflict` 409 (duplicate open report on the same subject) · `rate_limited` 429 |
| `create_block` | `authenticated` | 30 / day / user | `{ p_blocked_id, p_reason?, p_idempotency_key }` | `{ blocked: true, sessions_cancelled: int, thread_closed: bool }` | `validation_failed` 400 (self-block) · `conflict` 409 (already blocked, returned as success by the client) |

`create_report` with `reason = 'unsafe_meeting'` forces `severity = 1` and a 1-hour SLA, and **pages on-call rather than queueing** ([PRD C12](../00-foundation/02-prd.md)). The response never differs by reason — a reporter learns nothing about escalation.

`create_block` fires the `on_block_created` trigger, which cancels in-flight sessions, cancels pending requests, closes the thread, and writes an audit event ([RLS Design §6](05-rls-design.md)). The response reports what happened so the client can show "1 exchange was cancelled" — the blocking party should know. **The blocked party is never told**, which is why there is no notification and no state visible to them beyond content quietly disappearing.

### 5.6 Account and device RPCs

| RPC | Auth | Limit | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `submit_garden_verification` | `authenticated`, garden owner | 5 / day / user | `{ p_garden_id, p_media_asset_id, p_captured_lat, p_captured_lng, p_idempotency_key }` | `{ submission_id, distance_from_garden_m, status: "pending_review" }` | `not_authorized` 403 · `validation_failed` 400 (asset not owned, `exif_stripped_at IS NULL`, capture older than 15 min) · `quota_exceeded` 422 (> 5 attempts) |
| `register_device` | `authenticated` | 20 / day / user | `{ p_expo_push_token, p_platform, p_app_version, p_os_version?, p_idempotency_key }` | `{ device_id, push_enabled }` | `validation_failed` 400 (malformed Expo token) · `conflict` 409 (token belongs to another user → **reassigned**, see below) |
| `mark_notifications_read` | `authenticated` | 60 / min / user | `{ p_ids: uuid[] \| null, p_before: timestamptz \| null }` | `{ marked: int, unread_remaining: int }` | `validation_failed` 400 (both params null, or > 500 ids) |
| `request_account_deletion` | `authenticated` + **AAL2** | 3 / day / user | `{ p_reason?, p_idempotency_key }` | `{ scheduled_deletion_at }` | `aal2_required` 403 · `aal2_stale` 403 · `conflict` 409 (already scheduled) |

Notes:

- **`submit_garden_verification` receives a coordinate but never returns one.** The captured lat/lng is compared against `private.garden_locations.exact_point` inside the function, converted to `captured_h3_r9` and `distance_from_garden_m`, and the raw point is discarded. The parameters are excluded from statement logging alongside `safe_spots_near` ([Location Privacy §6.1](04-location-privacy.md)). This is the one inbound coordinate in the API and it is a write-only funnel.
- **`register_device` reassigns a token rather than erroring.** Expo push tokens are per-install; a shared device that two people sign into produces the same token for two users. Delivering A's notifications to B is a privacy incident, so the token is moved to the newest user and the old row deleted. Idempotent on `(user_id, expo_push_token)`.
- **`request_account_deletion` starts a 30-day grace period** and is reversible by signing in during it ([PRD C1](../00-foundation/02-prd.md), Apple Guideline 5.1.1(v)). The actual erasure is the `account-delete` Edge Function, driven by cron.

---

## 6. Endpoint catalog — Edge Functions

`POST /functions/v1/<name>`. Deno. Each has an explicit invocation model, and the ones invoked by `pg_cron` or a vendor are **not reachable with a user JWT**.

### 6.1 `kyc-start`

| | |
| --- | --- |
| Invoked by | Client, `authenticated` |
| Limit | 5 / day / user |
| Secrets | Persona API key |

```json
// request
{ "idempotency_key": "…" }
// response
{ "inquiry_id": "inq_…", "session_token": "…", "expires_at": "2026-08-08T14:37:00Z" }
```

Creates a Persona inquiry server-side and writes `private.verification_vendor_refs`. The client receives **only** a short-lived session token for the embedded hosted flow. The Persona API key never leaves the function ([System Architecture §5.3](01-system-architecture.md)).

Errors: `quota_exceeded` 422 (`verifications.attempt_count >= 5`, a hard cap controlling vendor cost) · `conflict` 409 (already `passed`) · `server_error` 502 (vendor unavailable → the client shows "verification is temporarily unavailable" and the user keeps browsing).

### 6.2 `kyc-webhook`

| | |
| --- | --- |
| Invoked by | Persona |
| Auth | **HMAC signature only.** No JWT. `verify_jwt = false` in `config.toml`, which makes signature verification the *entire* security boundary. |
| Limit | 600 / min / IP (vendor burst tolerance) |

Verification order — all four, before any parsing:

1. HMAC-SHA256 over the raw body with the vendor signing secret, compared in constant time.
2. Timestamp within a **300-second** replay window.
3. `webhook_idempotency_key` inserted with a UNIQUE constraint; a duplicate returns `200 {"status":"duplicate"}` and does nothing.
4. Payload schema validated before any field is read.

Then `UPDATE public.verifications SET status = 'passed'|'failed'`, and enqueue a `verification_result` notification. **ID images and document numbers are never transmitted to us**; a `CHECK` on `private.verification_vendor_refs.raw_decision` rejects a payload containing image or document-number keys ([Data Model §5](03-data-model.md)).

Always returns `200` for anything that isn't a signature failure. A `500` makes Persona retry, and a retry storm against a genuine bug is worse than a dropped event we can reconcile from the vendor.

### 6.3 `media-process`

| | |
| --- | --- |
| Invoked by | Storage `objectCreated` webhook |
| Auth | `service_role` |
| Timeout | 30 s |

Pipeline, in order:

1. **Strip every EXIF/XMP/IPTC block.** A phone photo of a tomato carries the GPS coordinates of someone's back garden. This is the highest-value control in the function.
2. Re-encode to WebP; generate 400 px and 1200 px variants.
3. Compute a blurhash → `media_assets.blurhash`.
4. Record `width`, `height`.
5. Set `exif_stripped_at = now()` **last**. Until it is set, the asset is invisible through every RLS policy, so an unprocessed image can never be served ([Data Model §8](03-data-model.md)).
6. Enqueue `content-scan` for image moderation.

On failure: retry ×3 with backoff, then set `moderation_state = 'rejected'` and notify the owner. **The asset stays unreadable** — the failure mode is "your photo didn't upload", never "your photo uploaded with its GPS intact".

Rejects: files > 10 MB, non-image MIME types, and images whose decoded dimensions exceed 12000 × 12000 (a decompression bomb).

### 6.4 `push-drain`

| | |
| --- | --- |
| Invoked by | `pg_cron`, every 30 s |
| Auth | `service_role`. **Not reachable with a user JWT** — an allow-list on the invoking role. |

Drains `private.notification_outbox` to Expo Push. Batches of 100, exponential backoff, dead-letter after 6 attempts, receipt checking on a follow-up pass. Full contract in [Realtime & Notifications §3](08-realtime-and-notifications.md).

### 6.5 `content-scan`

| | |
| --- | --- |
| Invoked by | Trigger on `messages` INSERT (via `pg_net`), and by `media-process` |
| Auth | `service_role` |

Scans message bodies for shared street addresses, phone numbers, and payment solicitations ([PRD C11](../00-foundation/02-prd.md)); scans images for policy violations. Sets `messages.flagged_reason` and, above a severity threshold, opens a report.

**Asynchronous and advisory.** It does not block delivery. A synchronous scan would put a third-party latency budget in the middle of a chat send, and a false positive would silently drop a message. Flagging is not prevention, and [Location Privacy §12.2](04-location-privacy.md) is honest about that.

`flagged_reason` is never returned to the sender.

### 6.6 `moderation-action`

| | |
| --- | --- |
| Invoked by | Moderation console |
| Auth | `authenticated` + `app_metadata.role IN ('moderator','admin')`, **re-checked inside the function**, not only at the gateway |
| Limit | 120 / min / moderator |

```json
// request
{ "report_id": "…", "action": "listing_removed", "notes": "…", "notify_subject": true, "idempotency_key": "…" }
```

```json
// response
{ "report_id": "…", "status": "actioned", "applied_at": "2026-08-08T14:31:02Z" }
```

Applies a `moderation_action`, resolves the report, writes `audit.events`, and enqueues a `moderation_outcome` notification. Every action is audited with the actor; there is no unaudited moderator write path.

Errors: `not_authorized` 403 · `request_not_found` 404 · `conflict` 409 (already resolved) · `validation_failed` 400 (action not valid for the subject type).

### 6.7 `account-delete`

| | |
| --- | --- |
| Invoked by | `pg_cron` daily, over `profiles` past their 30-day grace, and by the public web deletion URL |
| Auth | `service_role` |

Executes the pipeline in [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md): hard-delete P0/P1 (`private.garden_locations`, media, messages, device tokens), pseudonymize the profile shell for referential integrity, retain `private.verification_vendor_refs` for 7 years pseudonymized (fraud/legal defence), revoke sessions, and write a terminal audit event.

Idempotent and resumable — it processes users one at a time in a transaction each, so a timeout mid-batch loses no work.

### 6.8 `osm-import`

| | |
| --- | --- |
| Invoked by | `pg_cron`, **monthly per active metro** |
| Auth | `service_role`. **Not reachable with a user JWT**, not callable from the moderation console, and not callable from CI — an allow-list on the invoking role, plus an egress allow-list that names the Overpass host for this function and no other ([SPEC-007-R60](../03-specs/SPEC-007-safe-spots.md)) |
| Egress | Overpass API only |
| Writes | `private.osm_spot_candidates` only |

Queries Overpass per launch-metro bounding box, one amenity tag at a time, and writes safe-spot *candidates* for human review ([ADR-0021](adr/ADR-0021-osm-safe-spot-sourcing.md)). On a refresh run it also diffs upstream against linked live spots and raises review flags for deletions, renames, address changes, `opening_hours` changes, and moves over 50 m.

Four properties are the whole contract:

1. **It cannot publish a spot.** The function has no write path to `public.safe_spots` in any status. Promotion is a human action in the moderation console that must satisfy every rule the manual path satisfies, including a separately recorded hours verification ([SPEC-007-R45](../03-specs/SPEC-007-safe-spots.md), [SPEC-007-R49](../03-specs/SPEC-007-safe-spots.md)).
2. **Nothing auto-applies to a live row.** Every upstream diff becomes a review flag carrying a before/after, never an `UPDATE`. An upstream edit is not a verification, and treating it as one would let anyone with an OSM account reset our 90-day hours-staleness clock.
3. **Imported `opening_hours` is a reviewer hint that can never reach a user.** It is stored as `suggested_hours_raw` on the candidate, labelled as unverified in the console, and appears in no client-reachable response shape. The candidate table deliberately has no column named `hours` or `hours_verified_at`, so there is nothing for a careless `INSERT … SELECT` to align with.
4. **Overpass is treated as donated infrastructure with no SLA.** Descriptive `User-Agent` with a contact address, `/api/status` checked before a batch, exponential backoff on `429` and then abandonment rather than retrying past the advertised slot. A failed month delays discovery and affects nothing a user can see.

Failure is recorded as `osm_import_job_result` ([Observability §5.2](../05-operations/04-observability.md)) rather than raised — a monthly discovery job is not something to page anyone about, but a live metro with no successful run in a month is.

---

## 6a. Tiles are not part of this API

The basemap is served outside every mechanism this document describes, and that is deliberate rather than an omission.

| Property | Value |
| --- | --- |
| Surface | Sharecropr tile origin — Cloudflare CDN in front of an R2-hosted PMTiles archive ([ADR-0020](adr/ADR-0020-pmtiles-self-hosting.md)) |
| Method | Plain cacheable HTTPS `GET` with a `Range` header (PMTiles byte offsets) |
| Auth | **None.** No `Authorization` header, no `apikey`, no cookie, no session token |
| Identifiers | **None.** No user id, no device id, no `x-request-id`, no `x-client-info` |
| Addressing | Standard `z/x/y` and byte offsets. **No `?lat=`, no viewport centre, no locality string, no `safe_spot_id`** — in a path, a query parameter, a header, or a body ([SPEC-008-R80](../03-specs/SPEC-008-interactive-map.md)) |
| Rate limiting | CDN-level only. Not in the Kong table (§7.2) and not in a Postgres token bucket |
| Errors | HTTP, handled by the client as "no tiles" — never mapped into the §3.4 taxonomy |
| Style, sprites, glyphs | Same origin. Never fetched from a host we do not control (NFR-102) |

**The absence of a credential is the point.** It means a tile request is not attributable to a user *even by us*, so there is no viewport log to protect, subpoena, or leak. It also means there is no key to rotate, restrict, or accidentally ship in a bundle — one fewer entry in [Environments §6](../05-operations/01-environments.md) and one fewer thing for the secret scanner to catch.

It follows that **§9's location invariant does not need an exception for tiles**. A `z/x/y` address is a public grid index, the same one every client requesting that tile uses; it is not a coordinate in the sense this document means, and the difference is exactly [Location Privacy §6](04-location-privacy.md). The client-side assertion is a wire-level test ([SPEC-008-T79/T80](../03-specs/SPEC-008-interactive-map.md)), because reading imports cannot prove what a transitive dependency puts on the network.

---

## 7. Rate limiting

### 7.1 Two-layer implementation

| Layer | Where | Keyed on | Catches |
| --- | --- | --- | --- |
| **Kong** | Gateway, before PostgREST | IP + route | Unauthenticated floods, credential stuffing, naive scrapers |
| **Postgres token bucket** | Inside the RPC, first statement after auth | `user_id` (or `session_id`) + endpoint | Authenticated abuse — the case that matters, because a scraper with 50 accounts defeats an IP limit |

Kong alone is insufficient: mobile carriers NAT thousands of users behind one IP, so an IP limit tight enough to stop abuse also breaks a commuter train. Postgres buckets alone are insufficient: they require a database round trip, which is exactly what you cannot afford during a flood. Both, at different tightnesses.

```sql
CREATE TABLE private.rate_buckets (
  subject     uuid    NOT NULL,          -- user_id, or session_id for per-session limits
  endpoint    text    NOT NULL,
  tokens      real    NOT NULL,
  refilled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, endpoint)
);

CREATE OR REPLACE FUNCTION app.consume_token(
  p_subject uuid, p_endpoint text, p_capacity real, p_refill_per_sec real
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private AS $$
DECLARE v_tokens real; v_wait int;
BEGIN
  INSERT INTO private.rate_buckets AS b (subject, endpoint, tokens)
  VALUES (p_subject, p_endpoint, p_capacity - 1)
  ON CONFLICT (subject, endpoint) DO UPDATE
    SET tokens = LEAST(p_capacity,
                       b.tokens + EXTRACT(EPOCH FROM (now() - b.refilled_at)) * p_refill_per_sec) - 1,
        refilled_at = now()
  RETURNING b.tokens INTO v_tokens;

  IF v_tokens < 0 THEN
    v_wait := GREATEST(1, CEIL((-v_tokens) / p_refill_per_sec))::int;
    -- Surfaced to the client as Retry-After via PostgREST's response-header GUC.
    PERFORM set_config('response.headers',
                       format('[{"Retry-After": "%s"}]', v_wait), true);
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
END; $$;
```

A token bucket rather than a fixed window because a fixed window lets a user spend an entire quota in the last second of one window and the first second of the next — a 2× burst at every boundary. Buckets also give a meaningful `Retry-After`.

### 7.2 The table

| Endpoint | Limit | Bucket | Rationale |
| --- | --- | --- | --- |
| All `anon` reads | 60 / min | Kong, per IP | |
| All `authenticated` reads (default) | 120 / min | Kong, per IP + user | |
| `safe_spots_near` | **30 / min** | Postgres, per user | The scraping surface. Also bounds the query-pattern side channel in [Location Privacy §12.4](04-location-privacy.md). |
| `search_listings` | 30 / min | Postgres, per user | Expensive: trigram + spatial + RLS |
| `get_my_garden_location` | 10 / min | Postgres, per user | Reads `private`. Any volume here is anomalous and alerts. |
| `create_exchange_request` | **10 / hour** | Postgres, per user | Spam control. Reinforced by the 10-open-request cap. |
| `accept_exchange_request` | 30 / hour | Postgres, per user | |
| `decline` / `withdraw` | 60 / hour | Postgres, per user | |
| `propose_schedule` / `confirm_schedule` | 30 / hour | Postgres, per user | |
| `confirm_handoff` | **5 / 15 min, per session** | Postgres, per session | Anti-brute-force on a 6-digit code. 5 failures also lock confirmation for 15 min and notify both parties. |
| `cancel_session` | 20 / day | Postgres, per user | |
| `submit_rating` | 30 / day | Postgres, per user | |
| `create_report` | 10 / day | Postgres, per user | Report-bombing control. Moderators can raise it per user. |
| `create_block` | 30 / day | Postgres, per user | Generous — blocking is a safety action and should almost never be limited |
| `submit_garden_verification` | 5 / day | Postgres, per user | Also capped at 5 lifetime attempts |
| `register_device` | 20 / day | Postgres, per user | |
| `mark_notifications_read` | 60 / min | Postgres, per user | |
| `request_account_deletion` | 3 / day | Postgres, per user | |
| `messages` INSERT | 20 / min | Postgres, per user | Harassment throttle. Per-thread sub-limit: 10 / min. |
| `inventory_items` write | 60 / min | Kong, per user | |
| `listings` write | 20 / min | Postgres, per user | |
| Media upload | 20 / hour, 50 MB / hour | Kong + Storage | |
| `kyc-start` | 5 / day | Postgres, per user | Vendor cost control |
| `kyc-webhook` | 600 / min | Kong, per IP | Vendor burst tolerance |
| `moderation-action` | 120 / min | Postgres, per moderator | |
| Auth: sign-in | 10 / 5 min per IP, 5 / 15 min per email | GoTrue built-in | Credential stuffing |
| Auth: password reset | 3 / hour per email | GoTrue built-in | |
| Auth: TOTP challenge | 5 / 5 min per user | GoTrue built-in | |

### 7.3 What a client does on 429

1. **Read `Retry-After`.** It is always present, always integer seconds.
2. **Do not auto-retry a mutation.** Disable the action for that duration with a visible countdown. Auto-retrying into a limit turns a limit into an outage.
3. **Reads may auto-retry once**, after the full interval plus jitter.
4. **Surface it honestly.** "You've sent a lot of requests recently. Try again in about 4 minutes." Not "Something went wrong" — an unexplained failure produces a support ticket and a rage-tap loop.
5. **Never queue a rate-limited mutation.** It will hit the same limit on drain.
6. **Report it.** A 429 emits a PostHog event with the endpoint (never the payload). A rising 429 rate on a legitimate endpoint means the limit is wrong, and that signal should not arrive via App Store reviews.

Limits are per-environment config, not hardcoded, so an incident can loosen or tighten one without a deploy ([Runbooks](../05-operations/05-runbooks.md)).

---

## 8. Realtime contract

Summarised here for completeness; the full design, delivery guarantees, and failure modes are in [Realtime & Notifications](08-realtime-and-notifications.md).

### 8.1 Channels

| Channel | Subscribed when | Carries |
| --- | --- | --- |
| `user:{user_id}` | Session active, app foregrounded | `notifications` INSERT, `verifications` UPDATE, `gardens` UPDATE (status), `profiles` UPDATE (self) |
| `thread:{thread_id}` | Thread screen focused | `messages` INSERT, `message_threads` UPDATE (`is_closed`) |
| `session:{session_id}` | Session or exchange detail screen focused | `exchange_sessions` UPDATE, `exchange_requests` UPDATE |

`postgres_changes` subscriptions are **RLS-aware**: Supabase Realtime evaluates the subscriber's policies before emitting, so a client receives change events only for rows it could `SELECT`. That is a property we rely on, and it is verified by an explicit test — a subscriber attempting `thread:{id}` for a thread they are not in receives nothing.

### 8.2 Payload shape

```json
{
  "schema": "public",
  "table": "messages",
  "commit_timestamp": "2026-08-08T14:31:02.117Z",
  "eventType": "INSERT",
  "new": { "id": "…", "thread_id": "…", "sender_id": "…", "kind": "user",
           "body": "Running about 10 minutes late.", "created_at": "2026-08-08T14:31:02Z" },
  "old": {}
}
```

Realtime publications are **column-filtered**, not whole-row. `exchange_sessions` publishes `id, state, version, safe_spot_id, scheduled_start, scheduled_end, updated_at` — and **not `handoff_code`**, which would otherwise be broadcast to both participants' devices on every session update and end up in a websocket frame log.

### 8.3 Deliberately not sent over realtime

| Not sent | Instead |
| --- | --- |
| `handoff_code` | Fetched on demand via `rpc.get_handoff_code` when the handoff screen opens, over HTTPS. Encrypted at rest; the RPC is the only decrypt path |
| Any coordinate, of any kind | Nothing to send — no realtime table has a coordinate column in its publication |
| `safe_spots_near` results / map count changes | Polled at a 60 s `staleTime`. Broadcasting map deltas to every client in a metro is a fanout problem with no product payoff. |
| `trust_score`, `cancellation_count_90d` | Never client-reachable at all |
| `messages.flagged_reason` | Moderator-only, and telling a sender they were flagged teaches evasion |
| Presence / typing indicators | Not in MVP. Presence in an app that arranges physical meetings tells a stalker when their target is awake. |
| Notification *content* for a user's other devices | The inbox row is the record; each device fetches it |

### 8.4 Realtime is not a sync protocol

A dropped websocket loses events with no gap detection. So: **on every reconnect, and on every screen focus, the client refetches** rather than assuming the stream stayed whole. Realtime is an invalidation hint that makes the UI feel live; correctness comes from the refetch.

---

## 9. The location invariant

> **No endpoint in this document accepts or returns a garden coordinate, with exactly two deliberate exceptions, both of which are the caller's own.**

| Exception | Direction | Control |
| --- | --- | --- |
| `get_my_garden_location` | **Out**, to the owner only | Hard-filtered on `auth.uid() = gardens.owner_id`. No parameter names a garden. The caller already knows where they live. |
| `submit_garden_verification` | **In**, from the owner only | Converted to `captured_h3_r9` + `distance_from_garden_m` inside the function; the raw point is discarded. Write-only funnel, never echoed. |

Additionally, `safe_spots_near` and `search_listings` accept the caller's *device* position — unavoidable for a proximity search — quantized client-side to ~100 m, never persisted, excluded from statement logging and from telemetry ([Location Privacy §6.1](04-location-privacy.md)).

Every other endpoint has **no column, parameter, or payload key** capable of carrying a location. `safe_spots.point` is precise and public, because it is a public building.

### 9.1 How this is verified in CI

| # | Check | Mechanism | Blocks merge |
| --- | --- | --- | --- |
| API-01 | No function returning a client-reachable type has a `geography`/`geometry` column sourced from `private` | Static analysis over `supabase/migrations/**` (LP-03) | Yes |
| API-02 | Every `SECURITY DEFINER` function reading `private` is on the reviewed allowlist in `supabase/policy/private-readers.txt` | CI diff against the allowlist; adding a name requires a security reviewer via CODEOWNERS (LP-02) | Yes |
| API-03 | No client role holds any privilege on schema `private` | pgTAP, every migration (LP-01) | Yes |
| API-04 | **Contract sweep:** every table, view, and RPC return type reachable by `anon` or `authenticated` is introspected from `information_schema`; any column named `/lat|lng|latitude|longitude|coord|point|geog|geom|h3_r[89]/i` fails unless it is on a two-line allowlist (`safe_spots.point`, `safe_spots_near.lat/lng`). **This is the check that catches a new endpoint**, because it runs against the live schema rather than against a diff. | pgTAP + a Node introspection script | Yes |
| API-05 | No Expo Router route accepts a param matching the coordinate regex | Static check over the route manifest | Yes |
| API-06 | `notifications.payload` and `audit.events.metadata` reject coordinate keys | pgTAP (LP-11) | Yes |
| API-07 | Telemetry scrubber removes coordinates from a synthetic Sentry event and a synthetic PostHog event | Jest (LP-08) | Yes |
| API-08 | Realtime publication column lists contain no coordinate column and no `handoff_code` | pgTAP over `pg_publication_tables` | Yes |
| API-09 | EXIF absent from every stored asset, checked against a real geotagged JPEG | Integration (LP-09) | Yes |
| API-10 | Production canary: synthetic user A cannot obtain user B's garden coordinate by any documented or undocumented endpoint | Scheduled cron, pages on failure (LP-10) | Alerts |
| API-11 | **Map egress sweep:** every request the map screen makes — tiles, sprites, glyphs, style, geocoding — targets the Sharecropr tile origin or the Sharecropr Supabase origin and nothing else; and no captured tile request carries a credential or a coordinate-shaped value beyond `z/x/y` and byte offsets | Wire-level capture in CI (NFR-102, [SPEC-008-T78…T80](../03-specs/SPEC-008-interactive-map.md)) | Yes |

API-04 and API-10 are the two that matter. Every other check verifies the system we intended to build; those two verify the system we actually deployed. API-11 is in the same family as API-04 — it inspects traffic rather than source, because a dependency phoning home is invisible to an import audit.

---

## 10. Open questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Should `search_listings` support a "notify me when this appears" subscription, or does that wait for SPEC-020 surplus alerts? The endpoint shape differs (a saved query vs. a one-shot). | Product | Phase 2 planning |
| Q2 | Is a 200-row hard cap on `safe_spots_near` correct for a dense metro at peak season, or does it silently truncate a legitimate view? Needs launch data before it is loosened, and loosening it weakens the scraping bound. | Architecture | Post-launch, first season |
| Q3 | Should moderator reads go through a separate PostgREST schema (`moderation`) rather than elevated policies on `public`? Cleaner separation, more surface to maintain. | Architecture + Security | Before the console exceeds 200 reports/day |
| Q4 | Do we need a public, unauthenticated read endpoint for safe spots to support a marketing map on the web? It is the only externally-facing data we have, and it is also a partnership liability ([PRD A3](../00-foundation/02-prd.md)). | Product + Legal | Phase 2 |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Architecture | Initial API contract |
| 2026-08-09 | 1.1.0 | Architecture | §6a added: basemap tiles are unauthenticated, unidentified, cacheable range `GET`s to our own CDN and sit outside the PostgREST/RPC surface entirely ([ADR-0020](adr/ADR-0020-pmtiles-self-hosting.md)). §6.8 `osm-import` added — scheduled, server-side only, writes candidates and cannot publish a spot ([ADR-0021](adr/ADR-0021-osm-safe-spot-sourcing.md)). `private.osm_spot_candidates` added to §1.3. New CI check API-11 |
