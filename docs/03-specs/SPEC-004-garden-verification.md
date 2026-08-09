# SPEC-004: Garden Registration & Verification

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.0 |
| **Owner** | Engineering — Platform, with Security (location) |
| **Phase** | MVP |
| **Security review** | required |
| **Schema depends on** | [SPEC-001](SPEC-001-authentication.md), [SPEC-003](SPEC-003-identity-verification.md) |
| **Behaviourally coupled with** | SPEC-013, SPEC-900 |
| **Related ADRs** | [ADR-0005](../01-architecture/adr/ADR-0005-geospatial-model.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md), [ADR-0013](../01-architecture/adr/ADR-0013-map-library.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

A Sharecropr user registers exactly one garden, whose precise coordinate is captured on-device and written straight into `private.garden_locations` where no client role can ever reach it, and proves the garden exists by taking a photograph in the app — camera only, from within a defined distance of the declared point. This spec defines that capture, the server-side EXIF strip that must complete before the image is readable by anything, the distance tolerance and its bands, the ML-assisted human review queue, and the rejection and resubmit loop. It also carries the full derived-location requirements — the fuzzing function, the 400–1200 m offset band, the stable per-garden seed that defeats the averaging attack, and the two triggers that make all of it unskippable — because this is the spec that first writes a coordinate, and [Location Privacy](../01-architecture/04-location-privacy.md) is the document it is accountable to.

## 2. Goals

- Get an exact home-adjacent coordinate into the one place it belongs and nowhere else, on the first write, with no code path that could put it anywhere else.
- Prove a garden is real without proving where it is to anybody, using a photograph the user takes in front of it.
- Make the fuzzing invariant structural rather than remembered: a trigger that cannot be skipped, a return type with no coordinate column, a column the client cannot read.
- Keep the review loop fast enough that a new user is not blocked for a weekend — 24 hours, ML-assisted, human-decided.
- Make rejection recoverable and specific. "Rejected" with no reason produces a resubmission of the identical photo.
- Support the location-denied user as a first-class case for everything except the one screen that genuinely cannot work without it.

## 3. Non-Goals

- **Multiple gardens per account.** One garden, enforced by a partial unique index ([Data Model §6](../01-architecture/03-data-model.md)). Community plots, second properties, and "my mum's garden" are Phase 2 and need a different ownership model, not a loosened index.
- **Rendering any garden on the map.** Not the user's own, not anyone else's. Listings attach to safe spots ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)). **The strongest privacy control in this product is that there is nothing to render** ([Location Privacy §5](../01-architecture/04-location-privacy.md)); the fuzzing exists as defence-in-depth for the matching layer and for the day someone proposes a "gardens near me" view.
- **Photo library import for verification, ever.** A library import defeats the entire point of the exercise ([Location Privacy §9](../01-architecture/04-location-privacy.md)).
- **Background or "always" location.** Not requested, and the entitlement is absent from `app.json` so it cannot be requested by accident ([Mobile Architecture §7](../01-architecture/02-mobile-architecture.md)).
- **Address entry, geocoding, or reverse geocoding to a street address.** We never hold an address, so we never leak one. `city_label` is derived coarsely and is the finest textual location that exists.
- **Automated crop or plant identification as a verification signal.** ML scores garden-*likeness* only, advisory only ([SPEC-023](SPEC-023-crop-id-and-food-safety.md) is Phase 3).
- **Verifying the user *owns* the land.** We verify a garden exists at a place the user can stand. Tenancy, allotment agreements, and property records are out of scope and would require documents we have made a point of not holding.
- **Continuous or periodic re-verification of a garden.** A garden verified once stays verified until its location changes.
- **Appeals to a second reviewer.** Rejection is resubmission, not litigation. Three rejections routes to a human-only path (R42), which is the appeal.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **new gardener**, I want to register my garden by standing in it and tapping a button, so that I never type my address into anything. | P0 |
| US-02 | As a **privacy-conscious gardener**, I want certainty that no other user can see where my garden is, so that trading vegetables does not tell a stranger where I sleep. | P0 |
| US-03 | As a **gardener**, I want to photograph my beds in the app and be done, so that verification is one minute and not a form. | P0 |
| US-04 | As a **gardener whose submission was rejected**, I want to know exactly what was wrong so that my second attempt is different from my first. | P0 |
| US-05 | As a **gardener with location switched off**, I want to still create an account, browse, and build inventory, so that a permission decision is not an eviction. | P0 |
| US-06 | As a **gardener who has moved house**, I want to update my garden's location and re-verify, so that my listings are near the right safe spots. | P1 |
| US-07 | As a **moderator**, I want a queue with the photo, a distance band, and an ML score — and no exact coordinate — so that I can decide quickly without holding data I shouldn't. | P0 |
| US-08 | As **Security**, I want proof that the same garden read a thousand times returns a byte-identical fuzzed point, so that the averaging attack is closed rather than mitigated. | P0 |
| US-09 | As an **App Store reviewer**, I want to complete garden registration in an office with no garden, so that I can evaluate the rest of the app. | P0 |
| US-10 | As a **gardener in a flat with a balcony**, I want `containers` to be a valid size band, so that the product does not assume a quarter acre. | P1 |

## 5. Functional Requirements

### 5.1 Registration and cardinality

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | A user has at most one non-archived garden, enforced by the partial unique index `gardens_one_per_owner` ([Data Model §6](../01-architecture/03-data-model.md)). The constraint is in the database, not in the client. |
| R02 | **MUST** | A garden is created as `draft` and progresses `draft → pending_review → verified | rejected`. Only `verified` satisfies the garden clause of `app.can_transact()`. |
| R03 | **MUST** | `name` is required (1–60 characters). `description`, `grow_zone`, and `size_band` are optional, and `size_band` includes `containers` because a balcony is a garden. |
| R04 | **MUST** | Archiving a garden frees the one-per-user slot and cascades to `private.garden_locations`. Archiving is an UPDATE; there is no client `DELETE` on any table ([API Contract §1.3](../01-architecture/06-api-contract.md)). |
| R05 | **MUST NOT** | The client MUST NOT write `display_point`, `h3_r7`, or `h3_r9`. An attempt raises `42501` from `trg_reject_client_location_write` (R23). |
| R06 | **MUST** | Garden registration and verification are available to a user who has not completed identity verification ([SPEC-003-R27](SPEC-003-identity-verification.md)). The two gates are independent and neither implies the other. |

### 5.2 On-device location capture

| ID | Req | Statement |
| --- | --- | --- |
| R07 | **MUST** | Location is requested as **while-in-use only**. Background/always location is never requested and its entitlement is absent from `app.json` and `AndroidManifest.xml`, asserted by a CI check on the built `Info.plist` and manifest ([Mobile Architecture §7](../01-architecture/02-mobile-architecture.md)). |
| R08 | **MUST** | The permission is requested contextually, at the garden-registration step, with the justification copy from [Location Privacy §9](../01-architecture/04-location-privacy.md) shown **before** the OS dialog. A pre-prompt that explains why is the difference between one denial and a permanent one. |
| R09 | **MUST** | Capture takes a single foreground fix and records `accuracy_m`. A fix with `accuracy_m > 100` is refused client-side with a retry affordance; a fix older than 60 seconds is discarded. |
| R10 | **MUST** | The exact point is written **only** to `private.garden_locations`, only through `rpc.set_garden_location` (`SECURITY DEFINER`), with `capture_source` recorded as `device_gps` or `manual_pin`. No other statement in the system inserts into that table. |
| R11 | **MUST** | A `manual_pin` garden is permitted — a user in a basement flat with no GPS lock must be able to proceed — but a garden whose `capture_source` is `manual_pin` is **never** eligible for auto-approval (R31) and always goes to a human. |
| R12 | **MUST** | Changing the location of a `verified` garden requires a fresh AAL2 elevation ([SPEC-002-R18](SPEC-002-two-factor-auth.md)) **and** resets `status` to `pending_review`, clears `verified_at`, and requires a new photo submission. Relocation without re-verification is how a verified account moves itself next to a target. |
| R13 | **MUST NOT** | The client MUST NOT persist, cache, or log the captured coordinate. It exists in memory for the duration of one RPC call. It is not written to MMKV, not put in a query cache, not placed in a navigation param, and not attached to a Sentry breadcrumb ([Location Privacy §8](../01-architecture/04-location-privacy.md)). |

### 5.3 Photo capture

| ID | Req | Statement |
| --- | --- | --- |
| R14 | **MUST** | Verification photos are captured **in-app, camera only**. No photo-library picker is mounted on any verification route, no library permission is requested by this flow, and there is no "choose existing" affordance. A library import defeats the entire point of the exercise ([Location Privacy §9](../01-architecture/04-location-privacy.md)). |
| R15 | **MUST** | The capture screen obtains a single-use `capture_nonce` from `rpc.start_garden_capture`, valid 15 minutes and bound to `(user_id, garden_id)`. `submit_garden_verification` refuses without a live nonce. |
| R16 | **MUST** | `submit_garden_verification` refuses a `media_asset` whose `exif_stripped_at IS NULL`. Until `media-process` has run, the asset is unreadable through every RLS policy and unusable as evidence ([Data Model §8](../01-architecture/03-data-model.md)). |
| R17 | **MUST** | `media-process` strips every EXIF, XMP, and IPTC block **before** setting `exif_stripped_at`, which is set last ([API Contract §6.3](../01-architecture/06-api-contract.md)). A phone photo of a tomato carries the GPS coordinates of someone's back garden; this is the highest-value control in the pipeline. |
| R18 | **MUST** | The capture timestamp must be within 15 minutes of submission; older returns `validation_failed` ([API Contract §5.6](../01-architecture/06-api-contract.md)). |

> **What R15 does and does not prove.** The nonce proves the submission came from a session that opened the in-app capture screen within the last 15 minutes. It does **not** prove the pixels came from the camera sensor — a determined user can photograph a screen, and no client-side attestation available to us changes that. The real controls are the ones a screen photograph does not survive: a live location fix taken server-side-adjacent at submission (R09, R27), the 15-minute freshness window (R18), and a human looking at whether the image is plausibly an outdoor scene (R33). This limitation is stated here rather than discovered later.

### 5.4 Derived location — the fuzzing invariant

> This subsection is normative for [Location Privacy §4](../01-architecture/04-location-privacy.md). Every requirement here is a MUST and every one has a test, because this is the mechanism that makes storing thousands of home coordinates acceptable.

| ID | Req | Statement |
| --- | --- | --- |
| R19 | **MUST** | `app.derive_display_point(exact geography, seed uuid)` is `IMMUTABLE` and deterministic: the same `(exact, seed)` pair yields a byte-identical point, always, on every call, forever. |
| R20 | **MUST** | The offset is **≥ 400 m and ≤ 1200 m**, with distance drawn as `400 + 800 · sqrt(u1)` so the result is uniform over the annulus rather than clustered near the centre, and bearing drawn uniformly over `[0, 2π)`. A fixed or biased bearing would let an attacker subtract it. |
| R21 | **MUST** | The offset is derived from `private.garden_locations.fuzz_seed`, a **stable, per-garden** uuid generated once at insert and never regenerated. **This is what defeats the averaging attack.** Per-request random noise is not privacy; it is a slow information leak, because an attacker who reads a fuzzed point 500 times computes the mean and recovers the true point to within a few metres. A stable seed means every read returns the same value and averaging gains nothing. |
| R22 | **MUST** | Derivation happens in `trg_sync_garden_location`, an `AFTER INSERT OR UPDATE OF exact_point` trigger on `private.garden_locations`. **There is no code path that writes a garden location without fuzzing, because the trigger cannot be skipped.** Application-level derivation is forbidden — a developer can forget a function call; they cannot forget a trigger. |
| R23 | **MUST** | `trg_reject_client_location_write`, a `BEFORE UPDATE` trigger on `public.gardens`, raises `42501` if a caller running as `authenticated` changes `display_point`, `h3_r7`, or `h3_r9`. The derived columns are read-only to every client, enforced by a trigger rather than by an omitted column in a repository function. |
| R24 | **MUST** | `h3_r9` (~0.1 km²) is **never** returned to a client. Because `public.gardens` is owner-readable, this requires an explicit column revoke: `REVOKE SELECT (h3_r9) ON public.gardens FROM authenticated`. Without it, a garden's owner could select their own r9 cell over PostgREST and the API-04 contract sweep would fail ([API Contract §9.1](../01-architecture/06-api-contract.md)). |
| R25 | **MUST** | Derived values are recomputed **only** when `exact_point` changes. Moving the display point around a stationary garden leaks that the garden is stationary and hands an attacker multiple samples of the same secret. |
| R26 | **MUST** | `rpc.get_my_garden_location()` is the only path by which an exact coordinate leaves the database, and only to the garden's owner, hard-filtered on `auth.uid() = gardens.owner_id` with no parameter that names a garden. `rpc.submit_garden_verification` is the only path by which one enters, and it is a write-only funnel that never echoes ([API Contract §9](../01-architecture/06-api-contract.md)). |

### 5.5 Distance tolerance and scoring

| ID | Req | Statement |
| --- | --- | --- |
| R27 | **MUST** | `submit_garden_verification` computes `distance_from_garden_m` and the captured H3 r9 cell **inside** the function, against `private.garden_locations.exact_point`, and discards the raw capture point. The parameters are excluded from statement logging alongside `safe_spots_near` ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)). |
| R28 | **MUST** | Distance bands are: **≤ 150 m** eligible for auto-approval; **> 150 m and ≤ 400 m** routed to human review flagged `distance_marginal`; **> 400 m** auto-rejected with `capture_too_far`. 150 m absorbs urban-canyon GPS error and a long plot; 400 m is beyond any plausible same-property error and sits at the floor of the fuzz band (R20), so a submission outside it could not describe the same neighbourhood. |
| R29 | **MUST** | Auto-approval additionally requires the submission's own `accuracy_m ≤ 50`. A 90-metre-accurate fix that happens to land 40 m away has told us nothing. |
| R30 | **MUST NOT** | `ml_confidence` MUST NOT cause a rejection on its own, at any threshold. It is advisory: it can promote a submission to auto-approval and it can flag one for attention, but the negative decision is always a human's. |
| R31 | **MUST** | Auto-approval requires **all** of: `capture_source = 'device_gps'`, `distance_from_garden_m ≤ 150`, `accuracy_m ≤ 50`, `ml_confidence ≥ 0.85`, and no prior rejection on this user's account. Any one missing routes to human review. |
| R32 | **MUST** | The captured H3 r9 cell is stored in `private.garden_capture_cells`, **not** in `public.garden_verification_submissions`. An r9 cell is a ~0.1 km² box around the user's home and is forbidden on any client-reachable surface (R24, [API Contract §9.1](../01-architecture/06-api-contract.md)). |

### 5.6 Human review

| ID | Req | Statement |
| --- | --- | --- |
| R33 | **MUST** | Submissions not auto-approved enter a moderator queue with a **24-hour target decision time** ([PRD C4](../00-foundation/02-prd.md)), measured p95 and alerted at 20 hours. |
| R34 | **MUST** | The reviewer sees the photo, the distance **band** (not the metre value), `ml_confidence`, `capture_source`, the garden's `city_label`, and its `display_point`. The reviewer MUST NOT see `exact_point`, `captured_h3_r9`, or the metre-precise distance. Reading the exact point requires the two-person break-glass procedure ([Location Privacy §10](../01-architecture/04-location-privacy.md)). |
| R35 | **MUST** | Every decision writes `audit.events` with `action = 'garden.review_decided'`, the moderator id, the submission id, and the outcome. There is no unaudited decision path. |
| R36 | **MUST** | A decision enqueues a `garden_review_result` notification and, on approval, sets `gardens.status = 'verified'` and `verified_at` in the same transaction. |
| R37 | **MUST** | `rejection_reason` is chosen from a closed vocabulary — `capture_too_far`, `not_a_garden`, `image_unusable`, `duplicate_submission`, `indoor_scene`, `screen_photograph`, `location_implausible` — and is never free text. Free-text rejection reasons drift into judgements about people. |
| R38 | **MUST** | Verification photos are deleted 90 days after the decision by a Storage lifecycle rule ([Data Model §14](../01-architecture/03-data-model.md)). The decision is the durable record; the photograph of someone's garden is not. |

### 5.7 Rejection and resubmission

| ID | Req | Statement |
| --- | --- | --- |
| R39 | **MUST** | A rejected garden returns to `draft` with `rejection_reason` set. Resubmission is permitted immediately; there is no cooling-off period on an honest mistake. |
| R40 | **MUST** | Submissions are capped at **5 per garden per rolling 90 days** and 5 per day per user ([API Contract §7.2](../01-architecture/06-api-contract.md)). The 90-day window, rather than a lifetime cap, exists because a legitimate user who moves house in year two must not be permanently locked out. |
| R41 | **MUST** | The rejection screen states the specific reason from R37's vocabulary as a plain sentence and one concrete corrective action. "Rejected" with no reason produces a resubmission of the identical photo, and then a support ticket. |
| R42 | **MUST** | After three rejections on one garden, further submissions bypass auto-approval permanently for that garden and are routed to a named senior reviewer. This is the appeal path (§3). |
| R43 | **MUST** | The submission counter is keyed on `user_id`, not `garden_id`. Archiving a rejected garden and registering a new one does **not** reset the count, because otherwise the cap is one tap away from meaningless. |

### 5.8 Permission denial and degraded paths

| ID | Req | Statement |
| --- | --- | --- |
| R44 | **MUST** | With location permission denied, the user can still register a garden by `manual_pin` on a map they pan themselves. Verification submission is blocked with an explicit screen, the reason, and a deep link to OS settings — never a silent failure and never a disabled button with no explanation. |
| R45 | **MUST** | With camera permission denied, submission is blocked with the same treatment. Nothing is consumed from the R40 counter, because a permission the user never granted must not cost them an attempt. |
| R46 | **MUST** | With location denied, every screen in the app except the garden-capture step remains fully functional: the map centres on a locality the user types, the radius selector works, inventory and taxonomy are unaffected ([Mobile Architecture §7](../01-architecture/02-mobile-architecture.md)). **Location denial is a first-class supported state, not a dead end.** |
| R47 | **MUST** | If `media-process` fails, the asset stays unreadable, no submission row is created, and the owner is notified that the photo did not upload. The failure mode is "your photo didn't upload", **never** "your photo uploaded with its GPS intact" ([API Contract §6.3](../01-architecture/06-api-contract.md)). |
| R48 | **MUST** | Offline: the photo and fix can be captured, but submission is not queued for later delivery. The 15-minute freshness window (R18) means a queued submission would arrive stale and consume nothing but the user's patience. The user is told to submit when they have signal, with the capture retained locally for the window's duration and discarded after. |
| R49 | **SHOULD** | If `accuracy_m` is degrading rather than improving after 20 seconds of acquisition, the screen offers the manual-pin path rather than spinning. A user under tree cover will not get a better fix by waiting. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| `public.gardens` | read/write (owner, non-derived columns) | `name`, `description`, `status`, `grow_zone`, `size_band`, `rejection_reason`, `verified_at`, `deleted_at`. Derived columns are trigger-maintained and client-rejected (R05, R23). |
| `private.garden_locations` | server-side only | `exact_point` (**P0**), `accuracy_m`, `captured_at`, `capture_source`, `fuzz_seed` (**P0**). The most sensitive table in the system ([Data Model §6](../01-architecture/03-data-model.md)). |
| `public.garden_verification_submissions` | read (owner + moderator); write via RPC only | `photo_path`, `distance_from_garden_m`, `ml_confidence`, `reviewed_by`, `reviewed_at`, `decision`. **`captured_h3_r9` moves out of this table** — see below. |
| `private.garden_capture_cells` | server-side only | New. Holds `captured_h3_r9` (R32). |
| `private.garden_capture_nonces` | server-side only | New. R15. |
| `public.media_assets` | read (owner); write on upload | `exif_stripped_at IS NULL` makes the row invisible in every policy ([Data Model §8](../01-architecture/03-data-model.md)). |
| `public.profiles` | write (trigger) | `city_label` and `home_h3_r7` are derived from the garden's location by the same trigger that fuzzes it. Both are coarse by construction. |
| `public.notifications` | write | `garden_review_result`. |
| `audit.events` | write | `garden.registered`, `garden.location_set`, `garden.location_changed`, `garden.submitted`, `garden.auto_approved`, `garden.review_decided`, `garden.archived`. |

**New schema objects introduced by this spec:**

```sql
-- supabase/migrations/0005_garden_verification.sql

-- R24. public.gardens is owner-readable, so h3_r9 needs a column-level revoke or the
-- owner can select their own ~0.1 km² cell over PostgREST and API-04 fails.
REVOKE SELECT (h3_r9) ON public.gardens FROM authenticated;

-- R32. An r9 cell is a box around someone's home. It does not belong in `public`.
CREATE TABLE private.garden_capture_cells (
  submission_id   uuid PRIMARY KEY
                    REFERENCES public.garden_verification_submissions(id) ON DELETE CASCADE,
  captured_h3_r9  text NOT NULL,
  accuracy_m      real NOT NULL,
  captured_at     timestamptz NOT NULL
);
ALTER TABLE public.garden_verification_submissions DROP COLUMN captured_h3_r9;

-- R15. Proves the submission came from a session that opened the capture screen.
CREATE TABLE private.garden_capture_nonces (
  nonce       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  garden_id   uuid NOT NULL REFERENCES public.gardens(id) ON DELETE CASCADE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  consumed_at timestamptz NULL
);
CREATE INDEX garden_capture_nonces_live_idx
  ON private.garden_capture_nonces (user_id, garden_id)
  WHERE consumed_at IS NULL;

-- R43. Keyed on the user, so archiving a rejected garden resets nothing.
CREATE TABLE private.garden_submission_counters (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start  date NOT NULL,
  submissions   smallint NOT NULL DEFAULT 0,
  rejections    smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);

REVOKE ALL ON private.garden_capture_cells, private.garden_capture_nonces,
              private.garden_submission_counters
  FROM anon, authenticated, PUBLIC;

CREATE TYPE garden_rejection_reason AS ENUM (
  'capture_too_far','not_a_garden','image_unusable','duplicate_submission',
  'indoor_scene','screen_photograph','location_implausible');

ALTER TABLE public.garden_verification_submissions
  ADD COLUMN rejection_reason garden_rejection_reason NULL,
  ADD COLUMN decided_by_rule  text NULL
    CHECK (decided_by_rule IN ('auto_approved','human','senior_review'));
```

The fuzzing function, the sync trigger, and the client-write rejection trigger are defined verbatim in [Location Privacy §4](../01-architecture/04-location-privacy.md) and ship in `0005_garden_verification.sql` unchanged. They are reproduced there rather than here because the architecture document is authoritative for them and duplicated definitions drift silently ([Doc Conventions §8](../00-foundation/06-doc-conventions.md)).

**RLS policies introduced by this spec** (Pattern A, [RLS Design §5](../01-architecture/05-rls-design.md)):

```sql
CREATE POLICY gardens_select_own ON public.gardens
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);

CREATE POLICY gardens_select_moderator ON public.gardens
  FOR SELECT TO authenticated
  USING (app.is_moderator());

CREATE POLICY gardens_insert_own ON public.gardens
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid())
              AND status = 'draft'
              AND display_point IS NULL AND h3_r7 IS NULL AND h3_r9 IS NULL);

CREATE POLICY gardens_update_own ON public.gardens
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (owner_id = (SELECT auth.uid()));
-- Derived-column protection is the trigger (R23), not this policy: a WITH CHECK
-- comparing OLD and NEW cannot be expressed, which is exactly why it is a trigger.

CREATE POLICY garden_submissions_select_own ON public.garden_verification_submissions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.gardens g
                  WHERE g.id = garden_id AND g.owner_id = (SELECT auth.uid()))
         OR app.is_moderator());

-- No INSERT, UPDATE, or DELETE policy on garden_verification_submissions.
-- Submission is submit_garden_verification(); decision is garden_review_decide().
-- Both are SECURITY DEFINER. The absence of a policy is the enforcement.
```

**PII touched:** `private.garden_locations.exact_point` (**P0**), `private.garden_locations.fuzz_seed` (**P0** — it is a key to the P0 value), `private.garden_capture_cells.captured_h3_r9` (**P0**-adjacent, ~0.1 km²), `gardens.display_point` (P2, fuzzed), `gardens.h3_r7` (P2), `gardens.h3_r9` (P1, column-REVOKEd), `profiles.city_label` (P2), `profiles.home_h3_r7` (P1, column-REVOKEd in [RLS Design §4](../01-architecture/05-rls-design.md)), `garden_verification_submissions.photo_path` (P1), `distance_from_garden_m` (P1). Classification per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md).

## 7. API

### `rpc.set_garden_location`

**Auth:** `authenticated`, garden owner. **AAL2 required when the garden is already `verified`** (R12).
**Rate limit:** 5 / day / user
**Reads/writes `private`:** yes — the only insert path into `private.garden_locations`

```jsonc
// Request — the exact point, at full precision, deliberately not quantized
{ "p_garden_id": "9c1e3d0f-…", "p_lat": 42.28086, "p_lng": -83.74304,
  "p_accuracy_m": 8.2, "p_capture_source": "device_gps",
  "p_idempotency_key": "…" }
// Response 200 — no coordinate of any kind
{ "garden_id": "9c1e3d0f-…", "status": "draft", "requires_reverification": false }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Caller does not own the garden |
| `aal2_required` / `aal2_stale` | 403 | Garden is `verified` and elevation is missing or stale (R12) |
| `validation_failed` | 400 | Lat/lng out of range, `accuracy_m > 100`, or `capture_source` outside the enum |
| `rate_limited` | 429 | |

> **The response has no coordinate column.** Like `safe_spots_near`, the safety property is structural: even a catastrophic bug in the function body cannot echo the point, because there is nowhere to put it.

### `rpc.start_garden_capture`

**Auth:** `authenticated`, garden owner
**Rate limit:** 20 / day / user

```jsonc
// Request
{ "p_garden_id": "9c1e3d0f-…" }
// Response 200
{ "capture_nonce": "4a2f7b1e-…", "expires_at": "2026-08-08T14:46:00Z",
  "attempts_remaining": 4 }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not the owner |
| `invalid_transition` | 409 | Garden has no location set yet |
| `quota_exceeded` | 422 | 5 submissions in the rolling 90-day window (R40) |

### `rpc.submit_garden_verification`

**Auth:** `authenticated`, garden owner
**Rate limit:** 5 / day / user ([API Contract §7.2](../01-architecture/06-api-contract.md))
**Reads `private`:** yes — compares against `exact_point`, returns a scalar distance

```jsonc
// Request — p_capture_nonce added by this spec (R15)
{ "p_garden_id": "9c1e3d0f-…", "p_media_asset_id": "3d0f5a7b-…",
  "p_captured_lat": 42.28091, "p_captured_lng": -83.74299,
  "p_captured_accuracy_m": 6.4, "p_capture_nonce": "4a2f7b1e-…",
  "p_idempotency_key": "…" }
// Response 200
{ "submission_id": "…", "distance_from_garden_m": 41.7,
  "status": "pending_review", "auto_approved": false }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Asset or garden not owned by the caller |
| `validation_failed` | 400 | `exif_stripped_at IS NULL` (R16), capture older than 15 min (R18), nonce missing/expired/consumed (R15), `accuracy_m > 100` |
| `invalid_transition` | 409 | Garden already `verified` and its location has not changed |
| `quota_exceeded` | 422 | R40 cap reached |
| `rate_limited` | 429 | |

`distance_from_garden_m` is returned to the **owner only**, because they already know where their garden is and the number is the one piece of feedback that makes a rejection actionable. It is not present in the moderator view (R34), not in any list query, and not in any analytics event.

### `rpc.get_my_garden_location`

Defined in [API Contract §5.1](../01-architecture/06-api-contract.md). Restated here only for its invariant: it is the sole outbound coordinate path, it is hard-filtered on `auth.uid() = gardens.owner_id`, and it takes **no parameter that names a garden** (R26). Limit 10 / min / user; any volume here is anomalous and alerts.

### `rpc.garden_review_decide`

**Auth:** `authenticated` + `app.is_moderator()`, re-checked inside the function
**Rate limit:** 120 / min / moderator

```jsonc
// Request
{ "p_submission_id": "…", "p_decision": "rejected",
  "p_rejection_reason": "not_a_garden", "p_idempotency_key": "…" }
// Response 200
{ "submission_id": "…", "garden_status": "draft", "decided_at": "…" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not a moderator |
| `conflict` | 409 | Already decided |
| `validation_failed` | 400 | Reason missing on a rejection, or outside `garden_rejection_reason` |

### Edge Function `media-process`

Defined in [API Contract §6.3](../01-architecture/06-api-contract.md). The obligation this spec places on it: EXIF/XMP/IPTC strip runs first and `exif_stripped_at` is set **last** (R17), so no window exists in which a geotagged original is readable.

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Garden details | `/garden/new` | Name, optional description, size band, grow zone |
| Location permission pre-prompt | `/garden/new/location` | Why we need it, before the OS dialog |
| Capture location | `/garden/new/location/capture` | Live accuracy readout, "Use this spot", manual-pin fallback |
| Manual pin | `/garden/new/location/pin` | Pannable map, no search-by-address |
| Verify | `/garden/verify` | Explains the photo requirement and the distance rule |
| Camera | `/garden/verify/camera` | Camera only. No library affordance exists on this route |
| Submitted | `/garden/verify/pending` | Queue position is not shown; a target time is |
| Result | `/garden/verify/result` | Approved, or rejected with reason and corrective action |
| Garden settings | `/(tabs)/profile/garden` | Status, re-verify, change location, archive |

### 8.2 States

| State | Behaviour |
| --- | --- |
| **Loading** | Location acquisition shows a live `accuracy_m` readout rather than a spinner, because the user can act on "±40 m and improving" and cannot act on a spinner. The "Use this spot" button enables at ≤ 100 m and changes label to reflect quality. Photo upload shows determinate progress, then a distinct "Checking your photo" state while `media-process` runs — two different waits, two different messages, because collapsing them makes a 20-second EXIF strip look like a stalled upload. The review queue state polls at 60 s and always renders the last known status; never a skeleton over data we already have. |
| **Empty** | No garden yet: the profile tab shows a single card with `Add your garden` and one sentence on why, not an empty list with a plus button. A garden in `draft` with no location shows `Location not set` and the resume action — never a blank field. The submissions list on a garden with no submissions is not rendered at all rather than rendered empty. |
| **Error (recoverable)** | GPS accuracy stuck above 100 m, upload failure, `media-process` failure, a rejected submission below three: full-screen or inline state naming the cause and the one thing to change. After 20 s of non-improving accuracy the manual-pin path is offered inline (R49). A rejection always shows the reason sentence and the corrective action (R41), plus remaining attempts. |
| **Error (terminal)** | Five submissions in the rolling 90-day window (R40): full-screen state, the date the window rolls, and `support@sharecropr.app`. No retry button, because retrying cannot succeed until a date that is stated. |
| **Offline** | Registration fields are editable and held locally; location capture works (GPS needs no network); the camera works. **Submission is disabled behind a persistent banner and is not queued** (R48) — the 15-minute freshness window means a queued submission arrives dead. The capture is retained for the remainder of that window and discarded after, with copy that says so. Everything else in the app follows the normal offline strategy ([Mobile Architecture §6](../01-architecture/02-mobile-architecture.md)). |
| **Permission denied** | **Location:** the pre-prompt is shown once; a denial routes to the manual-pin path with an explanation, and a persistent inline note that a manual pin means a human reviews the submission (R11). A second denial after a Settings visit is not re-prompted — the OS will not show the dialog again and pretending otherwise is a loop. **Camera:** submission is blocked with a full-screen state, the reason, and an `Open Settings` deep link; nothing is consumed from the attempt counter (R45). Both states name which permission, why this screen needs it, and what still works without it. |
| **Rate limited** | `submit_garden_verification` at 5/day: the submit button is disabled for exactly `Retry-After` with a live countdown. `start_garden_capture` at the 90-day cap: the terminal state above, not a countdown, because a countdown measured in weeks is a taunt. |

### 8.3 Copy

Exact strings. Anything not listed here is a spec gap and must be added before implementation.

**Location permission and capture**

| Condition | Copy |
| --- | --- |
| Pre-prompt title / body | `Where's your garden?` / `We'll ask for your location once, while you're standing in it. Your exact spot is stored where no other user can reach it — nobody on Sharecropr ever sees where you are. We only use it to work out which safe spots are near you.` |
| Pre-prompt action | `Use my location` |
| Pre-prompt decline | `I'll place it on a map instead` |
| Acquiring | `Finding your position… accurate to about {n} m` |
| Accuracy too low | `Still {n} m out. Step into the open if you can, or place it on the map yourself.` |
| Good enough | `Use this spot` |
| Slow acquisition (R49) | `This is taking a while. Under trees or indoors, GPS often won't improve. You can place your garden on the map instead.` |
| Manual pin intro | `Drag the map so the pin sits on your garden. A pin means a person reviews your photo rather than our automatic check — it just takes a little longer.` |
| Denied | `Location is off for Sharecropr` / `You can still place your garden on the map by hand. Everything else in the app works normally without location.` |
| Denied, action | `Place it on the map` / `Open Settings` |
| Set (no coordinate echoed) | `Garden location saved.` |

**Photo capture**

| Condition | Copy |
| --- | --- |
| Verify intro title / body | `Show us your garden` / `Take one photo of your garden while you're standing in it. It has to be taken here, in the app, right now — we don't accept photos from your library, because that would defeat the point.` |
| Distance rule | `Take it within about 150 m of the spot you set. GPS drifts, so we allow some room.` |
| What happens to it | `We strip the photo's hidden location data before it's stored, and we delete it 90 days after the decision.` |
| Camera action | `Take photo` |
| No library, if asked | `Verification photos have to come from the camera. Library photos aren't accepted.` |
| Uploading | `Uploading your photo…` |
| Processing | `Checking your photo…` |
| Camera denied | `Sharecropr needs the camera for this step` / `This is the one screen that needs it. Turn it on in Settings and come back — nothing has been counted against you.` |
| Camera denied, action | `Open Settings` |
| Offline | `You're offline. We can't send this photo yet — and we can't hold it for long, because the check needs a recent photo. Try again when you have signal.` |
| Submitted | `Photo received` / `Most gardens are reviewed within 24 hours. We'll notify you.` |

**Decision**

| Condition | Copy |
| --- | --- |
| Approved | `Your garden is verified` / `You can publish listings and arrange exchanges now.` |
| Rejected: `capture_too_far` | `That photo was taken too far from the spot you set.` / `Stand in your garden and take a new one, or update your garden's location first if you set it in the wrong place.` |
| Rejected: `not_a_garden` | `We couldn't see a garden in that photo.` / `Take a photo that shows your beds, pots, or plants — a wide shot works better than a close-up of one plant.` |
| Rejected: `image_unusable` | `That photo was too dark or too blurry to review.` / `Try again in daylight, holding still.` |
| Rejected: `indoor_scene` | `That photo looks like it was taken indoors.` / `We need an outdoor shot of the growing space itself. A windowsill or balcony is fine — just show it from outside the glass.` |
| Rejected: `screen_photograph` | `That looks like a photo of a screen.` / `Take the photo directly with the camera.` |
| Rejected: `duplicate_submission` | `We've seen this photo before.` / `Take a fresh one.` |
| Rejected: `location_implausible` | `We couldn't match that photo to the location you set.` / `Check your garden's location is right, then take a new photo while you're standing there.` |
| Attempts remaining | `{n} attempt(s) left before {date}.` |
| Third rejection (R42) | `A member of our team will look at your next submission personally.` |
| Exhausted (R40) | `You've used all five submissions` / `You can try again after {date}. If something's wrong, email support@sharecropr.app.` |

**Garden settings and relocation**

| Condition | Copy |
| --- | --- |
| Change location warning | `Moving your garden means verifying it again. Your listings will pause until it's approved.` |
| AAL2 prompt | `Enter your authenticator code to move your garden.` |
| Archive warning | `Archiving deletes your garden's saved location and withdraws your listings. You can register a new garden afterwards.` |
| Status: pending | `Waiting for review — usually under 24 hours` |
| Status: rejected | `Needs another photo` |
| Status: verified | `Verified {date}` |

**Empty states**

| Screen | Copy |
| --- | --- |
| Profile, no garden | `You haven't added a garden yet. You'll need one before you can trade.` |
| Garden with no location | `Location not set` |

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Recover a named, photographed person's home coordinates and then arrange to be somewhere they are — which is the whole threat model ([Location Privacy §1](../01-architecture/04-location-privacy.md)). The subtle version, and the one most implementations get wrong, is the **averaging attack**: if the display point were re-randomized per read, an attacker reading one garden 500 times would compute the mean and recover the true point to within metres. R21's stable per-garden `fuzz_seed` closes it structurally rather than statistically. The second attack is a leak through a side door rather than the front: a coordinate in an EXIF block (R17), in a log line (R13, R27), in an r9 cell selected from the owner's own garden row (R24), or in an r9 cell sitting in a `public` table (R32). Three of those four were live gaps in the schema as written and are closed by this migration. The third is relocation: a verified account that can move its declared garden without re-verification can position itself beside a target and then use proximity features. R12 makes relocation an AAL2-gated re-verification. |
| **Which RLS policies enforce access?** | `gardens_select_own`, `gardens_select_moderator`, `gardens_insert_own`, `gardens_update_own`, and `garden_submissions_select_own` — all introduced here, all Pattern A ([RLS Design §5](../01-architecture/05-rls-design.md)). **There is no INSERT, UPDATE, or DELETE policy on `public.garden_verification_submissions`**; submission is `submit_garden_verification()` and decision is `garden_review_decide()`, both `SECURITY DEFINER` with pinned `search_path` and both re-checking authorization as their first act ([RLS Design §7](../01-architecture/05-rls-design.md)). There are **no policies at all** on `private.garden_locations`, `private.garden_capture_cells`, `private.garden_capture_nonces`, or `private.garden_submission_counters`, because they have no grants at all and `private` is absent from PostgREST's `db-schemas` — a table no client role can reach cannot be leaked by a missing policy. Column-level: `REVOKE SELECT (h3_r9) ON public.gardens FROM authenticated` (R24), because RLS is row-level and this is a column problem. The definer functions involved are `app.derive_display_point` (granted to **nobody**), `private.sync_garden_derived_location`, `public.reject_client_location_write`, `app.can_transact`, `app.is_moderator`, `app.consume_token`, `public.set_garden_location`, `public.start_garden_capture`, `public.submit_garden_verification`, `public.get_my_garden_location`, and `public.garden_review_decide`. |
| **Can any response path expose an exact coordinate or PII?** | Exactly one, deliberately: `rpc.get_my_garden_location()`, to the garden's owner, who already knows where they live. It is hard-filtered on `auth.uid() = gardens.owner_id` and has no parameter that could name another garden (R26). Every other return type in §7 is structurally incapable of carrying a point — `set_garden_location` returns three scalars, `submit_garden_verification` returns a distance and a status, `garden_review_decide` returns a status and a timestamp. `submit_garden_verification` is the one **inbound** coordinate in the entire API and it is a write-only funnel: the raw point is converted to a scalar distance and an r9 cell inside the function and discarded (R27), and its parameters are excluded from statement logging ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)). `distance_from_garden_m` is a scalar about the owner's own garden, returned only to them, and absent from the moderator view (R34). |
| **What is logged, and is it scrubbed?** | `audit.events` records the seven `garden.*` actions with actor id, garden id, submission id, decision, and moderator id — and never a coordinate, an r9 cell, an accuracy value, or a distance, enforced by the `metadata` CHECK forbidding `lat`/`lng`/`point`/`coordinates` keys ([Data Model §12](../01-architecture/03-data-model.md)). Sentry's `beforeSend` deletes any key matching `/lat|lng|latitude|longitude|coord|point|geohash|h3_r[89]/i` at any depth, verified by firing a synthetic event containing a coordinate ([Location Privacy §8](../01-architecture/04-location-privacy.md)). PostHog's wrapper rejects any property that parses as a coordinate and caps spatial properties at H3 r5. `set_garden_location` and `submit_garden_verification` are on the statement-logging exclusion list. Postgres exception messages are mapped to codes before reaching the client, because a raw message can contain row data. |
| **Does this need step-up authentication?** | Yes, for one operation: changing the location of a `verified` garden (R12, [SPEC-002-R18](SPEC-002-two-factor-auth.md)). Deliberately **not** step-up: initial location capture (the account has nothing to protect yet and the friction lands on every single new user), photo submission, and archiving (which destroys the location rather than moving it, and making the safe direction harder than the dangerous one is backwards). |
| **Abuse / rate-limit controls** | `submit_garden_verification` 5 / day per user and 5 per rolling 90 days per user (R40, R43), which is also the vendor-free cost control on the ML scorer and the moderator queue. `set_garden_location` 5 / day per user — relocation churn is the signal that someone is probing proximity behaviour. `start_garden_capture` 20 / day per user. `get_my_garden_location` 10 / min per user, with **any** sustained volume alerting, because it reads `private` and a legitimate client calls it approximately never. The 15-minute single-use nonce (R15) bounds replay of a submission. The `gardens_one_per_owner` index bounds how much of the map surface one account can claim. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | A user reads their own `display_point` 1,000 times over six months. | Byte-identical every time (R19, R21). Verified by pgTAP quantization-invariance (LP-05) and averaging-resistance (LP-06) property tests over 1,000 reads and 10,000 generated gardens. This is the check that proves the averaging attack is closed, and it runs on every migration. |
| EC-02 | Two gardens are registered at the same coordinate — a duplex, or a shared allotment. | Different `fuzz_seed` values produce different display points, which is correct: the seed is per-garden, not per-location. Neither user learns anything about the other, and neither garden is rendered to anyone regardless. |
| EC-03 | A user updates their garden's `name` via PostgREST and the client accidentally echoes back `display_point` in the PATCH body. | `trg_reject_client_location_write` raises `42501` (R23) even though the value is unchanged-in-intent, because the trigger compares `IS DISTINCT FROM` and a round-tripped `geography` may not serialize identically. The client is expected to PATCH only the columns it changed — and this failing loudly is better than a silent overwrite. |
| EC-04 | A user moves house and updates their location. | AAL2 required (R12); `status` drops to `pending_review`; `verified_at` clears; listings pause; the trigger recomputes `display_point`, `h3_r7`, `h3_r9`, `city_label`, and `home_h3_r7` from the new point with the **same** `fuzz_seed`. Reusing the seed is correct: the seed is a per-garden secret, not per-location, and rotating it would produce a second sample of the offset function for an attacker who observed both. |
| EC-05 | `media-process` fails on a 12000 × 12000 decompression bomb. | Rejected before decode; the asset stays `exif_stripped_at IS NULL` and therefore invisible to every read path; no submission row is created; the owner is notified that the photo did not upload (R47). The attempt is not consumed, because nothing was reviewed. |
| EC-06 | The user submits within 150 m but their `accuracy_m` is 85. | Not auto-approved (R29) — an 85-metre-accurate fix that lands 40 m away has told us nothing — but routed to human review rather than rejected. The human sees the band and the photo and decides. |
| EC-07 | ML scores a genuine garden at 0.31 because it is a winter allotment of bare soil. | Routed to human review (R31); **never auto-rejected** (R30). This case is precisely why R30 is a MUST NOT rather than a threshold: an ML model trained on summer photographs will be systematically wrong about February, and a model that can reject silently will reject a season. |
| EC-08 | An attacker submits a photograph of a laptop screen showing someone else's garden. | The nonce, the freshness window, and the live fix all pass — none of them prove the pixels came from the sensor (§5.3 note). A human catches it and rejects with `screen_photograph`; if they do not, the attacker has verified a garden at their **own** location, which is what they had to prove anyway. The residual value of the attack is close to zero, which is why we did not build attestation for it. |
| EC-09 | A user registers by manual pin in the middle of a lake, 300 m from where they photograph. | `distance_marginal` band routes to human review (R28); `manual_pin` forbids auto-approval regardless (R11); the reviewer rejects with `location_implausible`. The plausibility judgement is a human's because encoding "is this a residence" requires data we do not hold. |
| EC-10 | Location permission is granted, then revoked in Settings between capture and submission. | The submission carries a live fix taken before revocation and within the freshness window, so it proceeds. A *new* capture after revocation hits R44's blocked state with the Settings deep link. We do not re-request a permission the OS will no longer prompt for. |
| EC-11 | An App Store reviewer completes registration from an office with no garden. | They set a location, photograph whatever is in front of them, and land in `pending_review` — which does **not** block them, because `private.review_bypass_accounts` satisfies `app.can_transact()` independently of garden status for allowlisted accounts ([SPEC-003-R28](SPEC-003-identity-verification.md)). This is a deliberate widening of the bypass beyond KYC, recorded in §15 Q2, and it is why the reviewer checklist includes it. |
| EC-12 | A user archives a rejected garden and registers a new one to reset their attempts. | The counter is on `user_id` (R43), so it does not reset. `gardens_one_per_owner` permits the new garden because the old one is archived; the submission cap does not care. |
| EC-13 | Two devices submit a verification for the same garden concurrently. | The nonce is single-use under `UPDATE … SET consumed_at = now() WHERE consumed_at IS NULL`; exactly one submission is created and the second returns `validation_failed`. Tested at 50-way concurrency. |
| EC-14 | A moderator needs the exact coordinate for a live safety investigation. | Not available in the console (R34). It requires the two-person, 60-minute, fully audited break-glass procedure that pages the whole security channel on activation ([Location Privacy §10](../01-architecture/04-location-privacy.md)). It is not possible to do this quietly, and that is the design. |
| EC-15 | A garden's owner deletes their account. | `private.garden_locations` cascades on `gardens` delete, and the deletion pipeline hard-deletes it explicitly rather than relying on the cascade ([SPEC-001-R48](SPEC-001-authentication.md)). Verification photos are removed with all media objects. The pseudonymized `profiles` shell retains `city_label = NULL` and `home_h3_r7 = NULL`. |
| EC-16 | The review queue exceeds 24 hours during a launch spike. | Alert at p95 > 20 h (R33). The mitigation is staffing, not loosening auto-approval — R31's five conditions exist because each one caught something in design review, and relaxing them under queue pressure is how a verification system becomes a formality. Auto-approval thresholds are **not** remote-config values, deliberately. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `garden.registration_started` | PostHog | — | — |
| `garden.location_permission_result` | PostHog | `result` (`granted`\|`denied`\|`denied_previously`) | **Denial > 25%** → the pre-prompt copy is not working |
| `garden.location_capture_accuracy` | Metric | `p50`, `p95` of `accuracy_m` | p95 > 60 m → the ≤ 50 m auto-approval gate is starving the fast path |
| `garden.manual_pin_used` | PostHog | — | > 20% of registrations → investigate; manual pins all cost a human review |
| `garden.location_set` | `audit.events` | `capture_source` | — |
| `garden.location_changed` | `audit.events` | `days_since_verified` | **> 3 changes by one user in 90 days** → possible proximity probing, review |
| `garden.submission_created` | `audit.events` + PostHog | `attempt_number`, `distance_band`, `ml_confidence_bucket` | — |
| `garden.auto_approved` | `audit.events` + metric | — | Auto-approval rate **< 40%** → the gate is too tight and the queue will drown; **> 85%** → the gate is too loose and review is theatre |
| `garden.review_latency` | Metric | `p50`, `p95` hours to decision | **p95 > 20 h** (against the 24 h target, R33) |
| `garden.review_queue_depth` | Metric | `count`, `oldest_hours` | Oldest > 24 h → page the moderation rota |
| `garden.rejected` | `audit.events` + metric | `reason` | Any single reason > 40% of rejections → the copy or the guidance upstream is wrong |
| `garden.resubmitted_after_rejection` | PostHog | `same_reason_again` (bool) | `same_reason_again` > 30% → R41's corrective copy is not landing |
| `garden.submissions_exhausted` | Metric | — | > 2% of users who start → the flow is broken, not the users |
| `garden.media_process_failed` | Sentry + metric | `stage` (`decode`\|`strip`\|`encode`\|`blurhash`) | > 1% of uploads |
| `garden.exif_present_post_process` | **Security metric** | — | **Any occurrence** — pages immediately. This is LP-09 in production, and it means a geotagged original was readable |
| `garden.derived_write_rejected` | Security metric | — | Any occurrence → a client is attempting to write derived columns; investigate the client build |
| `garden.h3_r9_selected` | Security metric | — | **Any occurrence** — a client selected a revoked column and something granted it. Pages |
| `location.get_my_garden_location` | Metric | `calls_per_user_per_day` | **> 20 / user / day** → anomalous; the legitimate client calls it approximately never |
| `garden.fuzz_offset_distribution` | pgTAP (CI) | `min_m`, `max_m`, `bearing_chi2_p` | Build fails outside 400–1200 m, or χ² p ≤ 0.01 over 36 bearing bins (LP-04, LP-07) |

## 12. Accessibility

- The location-accuracy readout is a `accessibilityLiveRegion="polite"` text element that announces on meaningful change only (crossing 100 m, 50 m, and on "good enough"), not on every GPS tick. A region that announces four times a second is a reason to turn the screen reader off.
- "Use this spot" carries a dynamic `accessibilityLabel` including the accuracy — `Use this spot, accurate to about 12 metres` — because the number is the decision and putting it only in adjacent text means a screen-reader user makes the decision blind.
- The manual-pin map has a **non-map alternative**: a coarse locality search plus nudge controls (`Move pin north 50 metres`) as labelled buttons, following the map's accessible-alternative pattern ([Mobile Architecture §10.4](../01-architecture/02-mobile-architecture.md)). A drag-only map is unusable with a screen reader or with switch control, and this is the one screen where a user cannot route around it.
- The camera screen announces framing guidance on entry (`Camera open. Point at your garden and take one wide photo.`) and the shutter is a labelled button at ≥ 44 × 44 dp, never an unlabelled circle.
- **We deliberately do not require the user to frame anything specific.** Instructions like "get all four corners of the bed in shot" are inaccessible to a blind user and we have no way to guide them; the ML score is advisory and the human reviewer is told to weigh framing generously (R30, R34).
- Rejection reasons are announced on appearance via `AccessibilityInfo.announceForAccessibility` and are always a full sentence, never an icon or a colour. `Needs another photo` is text, not an amber dot.
- Permission-denied states announce which permission, why this screen needs it, and what still works without it — in that order, because the third part is the one that stops a user abandoning the app.
- The garden status on `/(tabs)/profile/garden` is always words (`Verified`, `Waiting for review`, `Needs another photo`, `Location not set`), never colour or an icon alone.
- Full flow verified at 200% dynamic type on both platforms, including the rejection screen with the longest reason string (`location_implausible`), which is the one most likely to clip.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01 | Second non-archived garden INSERT for one owner violates `gardens_one_per_owner`. |
| T02 | rls | R02 | `app.can_transact()` is false with a `draft`, `pending_review`, or `rejected` garden and true at `verified`. |
| T03 | unit | R03 | 0- and 61-character names rejected; `containers` accepted as a `size_band`. |
| T04 | integration | R04 | Archiving frees the slot for a new garden and cascades the `private.garden_locations` row. |
| T05 | rls | R05, R23 | `PATCH /rest/v1/gardens` setting `display_point`, `h3_r7`, or `h3_r9` returns `42501` for each column individually. |
| T06 | e2e | R06 | A KYC-unverified account completes registration and submits verification successfully. |
| T07 | integration (CI) | R07 | Built `Info.plist` contains no `NSLocationAlwaysAndWhenInUseUsageDescription`; `AndroidManifest.xml` contains no `ACCESS_BACKGROUND_LOCATION`. Build fails on a hit, including one introduced transitively by a dependency. |
| T08 | e2e | R08 | The pre-prompt renders before the OS dialog on a fresh install, on both platforms. |
| T09 | unit | R09 | A fix with `accuracy_m = 101` is refused; one 61 s old is discarded. |
| T10 | integration | R10 | Grep every migration: `private.garden_locations` is written by exactly one function. A direct client INSERT fails on schema grants. |
| T11 | integration | R11 | A `manual_pin` submission meeting every other auto-approval condition still lands in `pending_review`. |
| T12 | integration | R12 | `set_garden_location` on a `verified` garden without AAL2 returns `aal2_required`; with it, `status` becomes `pending_review` and `verified_at` is null. |
| T13 | unit | R13 | After a full capture-and-submit cycle, MMKV, the query-cache persister, the router state, and the Sentry breadcrumb buffer contain no value matching the coordinate regex. |
| T14 | e2e | R14 | No library-picker component is mounted on any `/garden/verify/*` route; the route bundle contains no image-picker import; no library permission is requested. |
| T15 | integration | R15 | Submission without a nonce, with an expired nonce, with a consumed nonce, and with another garden's nonce all return `validation_failed`. |
| T16 | integration | R16 | Submission referencing an asset with `exif_stripped_at IS NULL` returns `validation_failed` and creates no row. |
| T17 | integration | R17 | A real geotagged JPEG is uploaded; the stored object has no EXIF, XMP, or IPTC block, and `exif_stripped_at` is confirmed to be the last field written (LP-09). |
| T18 | integration | R18 | A capture timestamped 16 minutes ago returns `validation_failed`. |
| T19 | pgTAP | R19 | `app.derive_display_point` declared `IMMUTABLE`; the same `(point, seed)` returns byte-identical output across 1,000 calls and across a session restart. |
| T20 | pgTAP | R20 | Over 10,000 generated gardens: every offset is ≥ 400 m and ≤ 1200 m (LP-04); bearing distribution is uniform by χ² over 36 bins, p > 0.01 (LP-07); radial distribution matches the `sqrt` area law. |
| T21 | pgTAP | R21 | **Averaging resistance:** the mean of 1,000 reads of one garden is > 400 m from the true point (LP-06). **Quantization invariance:** 1,000 reads are byte-identical (LP-05). `fuzz_seed` is unchanged across an `exact_point` update. |
| T22 | pgTAP | R22 | A direct INSERT into `private.garden_locations` as `service_role`, bypassing every application path, still populates `display_point`, `h3_r7`, and `h3_r9` on the `gardens` row. There is no way in that skips the trigger. |
| T23 | rls | R24 | `GET /rest/v1/gardens?select=h3_r9` returns `42501` for the garden's own owner. `information_schema` sweep confirms no client-reachable view or RPC return type exposes an r9 cell (API-04). |
| T24 | pgTAP | R25 | Updating `name`, `description`, and `size_band` leaves `display_point` byte-identical; updating `exact_point` changes it. |
| T25 | integration | R26 | `get_my_garden_location` has no garden-id parameter; a second user's call returns their own or 404, never another's. Contract sweep confirms no other reachable type carries a coordinate column (API-01, API-04). |
| T26 | integration | R27 | `submit_garden_verification` returns a distance but no coordinate; Postgres statement log for the call contains no parameter values. |
| T27 | integration | R28 | Submissions at 149 m, 151 m, 399 m, and 401 m produce auto-eligible, `distance_marginal`, `distance_marginal`, and `capture_too_far` respectively. |
| T28 | integration | R29 | 40 m distance with `accuracy_m = 51` routes to review, not auto-approval. |
| T29 | integration | R30 | `ml_confidence = 0.02` with every other condition met routes to review and is **not** rejected. No code path rejects on ML alone. |
| T30 | integration | R31 | Each of the five auto-approval conditions removed individually routes the submission to review. Five separate assertions, not one loop. |
| T31 | rls | R32 | `public.garden_verification_submissions` has no `captured_h3_r9` column; `private.garden_capture_cells` has zero grants to `anon` and `authenticated`. |
| T32 | integration | R33 | Non-auto-approved submissions appear in the moderator queue; the p95 latency metric is emitted. |
| T33 | rls | R34 | The moderator-scoped query returns the photo, band, `ml_confidence`, `capture_source`, `city_label`, and `display_point` — and errors or returns null for `exact_point`, `captured_h3_r9`, and the metre-precise distance. |
| T34 | integration | R35 | Every decision writes exactly one `audit.events` row with the moderator id; no code path decides without one. |
| T35 | integration | R36 | Approval sets `status`, `verified_at`, and enqueues one `garden_review_result` notification in a single transaction; a rollback leaves none of the three. |
| T36 | unit | R37 | `rejection_reason` outside the enum is rejected at the type level; free text is impossible. |
| T37 | integration | R38 | An object 91 days past its decision is absent from Storage; one at 89 days is present. |
| T38 | integration | R39 | A rejection returns `gardens.status` to `draft` with the reason set, and an immediate resubmission is accepted. |
| T39 | integration | R40 | Sixth submission in a 90-day window returns `quota_exceeded`; the sixth in one day returns `rate_limited`. |
| T40 | e2e | R41 | Each of the seven rejection reasons renders its specific sentence and corrective action from §8.3. |
| T41 | integration | R42 | A fourth submission after three rejections bypasses auto-approval regardless of scores and is tagged `senior_review`. |
| T42 | integration | R43 | Archiving a garden with 4 submissions and registering a new one leaves the counter at 4. |
| T43 | e2e | R44 | With location denied: registration by manual pin succeeds, submission is blocked with the reason and the Settings deep link. |
| T44 | e2e | R45 | With camera denied: submission blocked, `private.garden_submission_counters.submissions` unchanged. |
| T45 | e2e | R46 | With location denied, the map centres on a typed locality, the radius selector works, and inventory and taxonomy are unaffected. |
| T46 | integration | R47 | An injected `media-process` failure leaves the asset unreadable, creates no submission, and enqueues an owner notification. |
| T47 | e2e | R48 | Offline: capture succeeds, submission is disabled with the banner, and the local capture is discarded after 15 minutes. |
| T48 | manual | R49 | Verified on-device under tree cover; see §13.3. |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| N01 | **The averaging attack.** Read one garden's `display_point` 1,000 times over a simulated six months and compute the mean. | The mean is > 400 m from `exact_point` (LP-06) because every read is identical (R21). This is the single most important negative test in the product; it runs on every migration, not on a schedule. |
| N02 | Read `private.garden_locations` directly as `authenticated`, as `anon`, and through a crafted PostgREST request. | Denied on all three. `REVOKE ALL ON SCHEMA private` and absence from `db-schemas`. Asserted as pgTAP LP-01. |
| N03 | Reach `private.garden_locations` through a PostgREST embed (`select=*,loc:garden_locations(*)`) from `gardens`. | The relation is not resolvable. Repeated for `garden_capture_cells`, `garden_capture_nonces`, and `garden_submission_counters`. |
| N04 | Select `h3_r9` from your own garden row. | `42501` (R24). Repeated for `home_h3_r7` on `profiles`, which is already revoked. Both asserted as pgTAP negatives, because both were selectable before this migration. |
| N05 | `PATCH /rest/v1/gardens` with a `display_point` 5 m from the true point, to make the fuzz useless against yourself and then leak it. | `42501` from `trg_reject_client_location_write` (R23). Asserted for all three derived columns, and again for a `service_role`-shaped request from a client role. |
| N06 | Write a garden location through a path that skips the fuzzing trigger — a direct `service_role` INSERT, a `COPY`, a bulk seed script. | Derived columns are populated regardless (T22, R22). CI static check LP-02 additionally asserts every `SECURITY DEFINER` function reading `private` is on the reviewed allowlist. |
| N07 | Call `app.derive_display_point` directly to test candidate points against a known display point and solve for the true one. | `42501` — the function is granted to **nobody** ([RLS Design §3](../01-architecture/05-rls-design.md)). Even with access, the seed is required and lives in `private`. |
| N08 | Obtain `fuzz_seed` and invert the offset. | The seed is `private`-only and never appears in any response, log, audit row, or telemetry event. Asserted by an `information_schema` sweep and a log grep. If it leaked, the offset would be invertible — which is why it is classified P0 alongside the coordinate itself. |
| N09 | Read another user's garden by any documented or undocumented endpoint. | Zero rows via `gardens_select_own`; nothing rendered on the map by product design ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)); no RPC accepts another user's garden id. Continuously verified in production by the LP-10 canary, which is the check that tests the system we deployed rather than the one we designed. |
| N10 | Upload a geotagged JPEG and fetch the original before `media-process` completes. | The row is invisible in every RLS policy while `exif_stripped_at IS NULL` (R16, R17); the signed URL cannot be minted for an unreadable row. Verified with a real geotagged photograph, not a synthetic one. |
| N11 | Strip-resistant metadata: embed coordinates in an XMP sidecar block and in an IPTC field rather than EXIF GPS. | All three blocks are removed (R17). Tested with a file carrying coordinates in EXIF, XMP, and IPTC simultaneously. |
| N12 | Submit another user's `media_asset_id`. | `not_authorized` — the RPC checks `media_assets.owner_id = auth.uid()` before anything else. |
| N13 | Replay a consumed `capture_nonce`. | `validation_failed`. Concurrency-tested at 50 simultaneous submissions with one nonce; exactly one succeeds (EC-13). |
| N14 | Relocate a verified garden next to a target, then use proximity behaviour to infer something about them. | Relocation requires AAL2 and drops the garden to `pending_review` with listings paused (R12), so the account is non-functional until a human approves the new location. Repeated relocations alert (§11 `garden.location_changed`). |
| N15 | Probe the tolerance boundary by submitting at 100 m, 200 m, 300 m, 400 m to infer the true point's position. | Bounded to 5 submissions per 90 days (R40) — four probes cost the attacker their whole budget and reveal only the band, which is coarser than the fuzz offset they already have. |
| N16 | Extract a coordinate from a Sentry event, a PostHog property, a notification payload, or an audit metadata blob. | Scrubbed at four independent layers: `beforeSend` regex, the PostHog property wrapper, the `notifications.payload` CHECK, and the `audit.events.metadata` CHECK (LP-08, LP-11). Each verified by firing a synthetic payload containing a coordinate and asserting absence. |
| N17 | Read a coordinate from a Postgres error message by forcing a constraint violation on `garden_locations`. | Exception messages are mapped to stable codes before reaching the client; `details` and `hint` are always null from our functions, enforced by a CI grep for `USING DETAIL` over `supabase/migrations/**` ([API Contract §3.4](../01-architecture/06-api-contract.md)). |
| N18 | Pass a garden id belonging to another user to `get_my_garden_location`. | No such parameter exists. The function reads `auth.uid()` only (R26). No signature could target another user. |
| N19 | Call `submit_garden_verification` with coordinates far outside any plausible range (`lat = 91`, `lng = 200`) to probe error behaviour. | `validation_failed` before any `private` read. No timing or error difference reveals whether a garden exists at the queried location. |
| N20 | Use the `distance_from_garden_m` return value as an oracle: submit from many known points and trilaterate the true coordinate. | Bounded by R40 to 5 submissions per 90 days — trilateration needs three good points and the attacker must physically travel to each. Additionally, `distance_from_garden_m` is returned only to the garden's **owner**, who already knows the answer. An attacker would need to own the garden they are locating. |
| N21 | Scrape display points in bulk to build a location dataset. | There is no endpoint that returns another user's garden at all — not fuzzed, not coarse, not aggregated below H3 r5. The scraping surface is `safe_spots_near`, which returns public buildings and counts ([Location Privacy §6](../01-architecture/04-location-privacy.md)). |
| N22 | Escalate to moderator and read exact coordinates from the review queue. | `garden_review_decide` and the queue view expose the band and `display_point` only (R34). Exact access requires two-person break-glass that pages the security channel on activation and cannot be done quietly ([Location Privacy §10](../01-architecture/04-location-privacy.md)). |
| N23 | Submit an image containing a decompression bomb or a polyglot file with an image header. | Rejected by `media-process` at > 10 MB, non-image MIME, or decoded dimensions > 12000 × 12000 ([API Contract §6.3](../01-architecture/06-api-contract.md)). The asset stays unreadable. |
| N24 | Register 200 gardens across 200 accounts to map which H3 r7 cells are populated. | Each account costs an ID verification ([SPEC-003](SPEC-003-identity-verification.md)) and a TOTP enrollment. `h3_r7` is ~5 km² and is not readable for any garden but your own in any case. The economics of this attack are the KYC decision working as intended. |

### 13.3 Manual QA

- [ ] Register a garden outdoors on a physical device with real GPS; confirm the accuracy readout updates and the "Use this spot" label reflects quality.
- [ ] Register under heavy tree cover and confirm the manual-pin path is offered within 20 seconds rather than spinning (R49).
- [ ] Deny location on a fresh install, complete registration by manual pin, and confirm the map, radius selector, inventory, and taxonomy all still work (R46).
- [ ] Deny camera, attempt submission, and confirm nothing is consumed from the attempt counter (R45).
- [ ] Take a verification photo with a real geotagged camera app, upload it, download the stored original, and inspect it with `exiftool` for EXIF, XMP, and IPTC. This is the one check that must be done by hand on real bytes, every release.
- [ ] Submit from ~200 m away and confirm the submission lands in review with `distance_marginal` and the correct copy.
- [ ] Walk through all seven rejection reasons in the moderation console and read each user-facing string on a device.
- [ ] Relocate a verified garden; confirm the AAL2 prompt, the status drop, the paused listings, and the unchanged `fuzz_seed`.
- [ ] Confirm the manual-pin map is fully operable with VoiceOver and with switch control using the non-map alternative controls.
- [ ] Complete the whole flow at 200% dynamic type on both platforms, including the `location_implausible` rejection screen.
- [ ] Airplane-mode: capture a photo, confirm submission is disabled and not queued, and confirm the local capture is discarded after 15 minutes.
- [ ] Complete registration as the App Store reviewer account in an office, and confirm they can transact while the garden is still `pending_review` (EC-11).

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | **None on the privacy mechanism.** `app.derive_display_point`, both triggers, and the column revoke are not flaggable — there is no meaningful "off" for a control whose absence is a data breach. Flaggable: `garden.review.ml_enabled` (falls back to human-only review, which is slower and equally correct) and `garden.review.auto_approve_enabled` (falls back to human-only). **The auto-approval thresholds themselves are not remote config**, deliberately: they are the kind of number that gets loosened at 2 a.m. under queue pressure and never tightened again. |
| Migration required | Yes — `0005_garden_verification.sql`: `app.derive_display_point`, `trg_sync_garden_location`, `trg_reject_client_location_write`, the `h3_r9` column revoke, `private.garden_capture_cells` (and the `captured_h3_r9` column drop from `public`), `private.garden_capture_nonces`, `private.garden_submission_counters`, `garden_rejection_reason`, the five RLS policies, and the four RPCs. |
| Backfill required | No. Greenfield. If it were not, the `captured_h3_r9` column move would be an expand → migrate → contract across two releases ([Data Model §15](../01-architecture/03-data-model.md)) — worth stating, because the same move on a live system is not a single migration. |
| Rollback plan | Forward-only. Disabling ML or auto-approval is a config flip with a slower but correct fallback. **A defect in the fuzzing path is not rolled back — it is rolled forward and every affected garden's derived columns are recomputed**, because the failure mode of a broken fuzz is a leaked coordinate and leaving it in place while a revert deploys is not an option. The runbook step is: revoke `SELECT` on `gardens.display_point` from `authenticated` first, then fix, then recompute, then restore the grant. |
| Client version floor | 1.0.0. First release. `p_capture_nonce` is added to `submit_garden_verification` with a `DEFAULT NULL` signature so the parameter addition is contract-additive ([API Contract §3.2](../01-architecture/06-api-contract.md)), but it is required in practice from 1.0.0 — there is no prior client. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | [Data Model §6](../01-architecture/03-data-model.md) places `captured_h3_r9` on `public.garden_verification_submissions`, which makes an r9 cell client-reachable and would fail the API-04 contract sweep ([API Contract §9.1](../01-architecture/06-api-contract.md)). R32 moves it to `private.garden_capture_cells`. Likewise `gardens.h3_r9` is selectable by the garden's owner today; R24 adds a column revoke. **Both are schema corrections, not spec choices, and the data model must be amended to match.** | Architecture + Security | Before `0005_garden_verification.sql` merges |
| Q2 | EC-11 widens the `private.review_bypass_accounts` bypass from the KYC clause of `app.can_transact()` to the garden clause as well, so a reviewer can transact with a `pending_review` garden. That is necessary for review and it is a broader bypass than [SPEC-003-R28](SPEC-003-identity-verification.md) describes. Should the allowlist carry a per-clause scope, or is one time-boxed flag acceptable? | Security | Before first store submission |
| Q3 | [API Contract §7.2](../01-architecture/06-api-contract.md) describes `submit_garden_verification` as "capped at 5 lifetime attempts". R40 makes it 5 per rolling 90 days, because a lifetime cap permanently locks out a user who moves house in year two. One of the two documents is wrong. | Architecture | Before implementation |
| Q4 | Is 150 m the right auto-approval tolerance? It is chosen to absorb urban-canyon GPS error, and it is also the width of a city block — a submission from a neighbour's garden passes. Tightening it raises the human-review rate; loosening it makes the check meaningless. No field data yet. | Security + Ops | Post-launch, first 500 submissions |
| Q5 | Should `manual_pin` be permitted at all? It is the accessibility and no-signal escape hatch (R11, R44) and it is also the path an attacker takes, since it requires no physical presence at the declared point. Removing it would exclude basement flats, dense urban cores, and anyone who declines location permission. Currently mitigated by forcing human review. | Security + Product | Post-launch, first 90 days |
| Q6 | The ML garden-likeness model has no defined training set, no bias evaluation, and no owner. R30 keeps it advisory precisely because of that, but "advisory" still shapes queue priority and therefore who waits longer. Who owns the model, and what does its evaluation look like before it influences anything? | Engineering + Product | Before ML is enabled in production |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Engineering — Platform | Initial spec. Approved with Security sign-off per [Doc Conventions §6](../00-foundation/06-doc-conventions.md). |
