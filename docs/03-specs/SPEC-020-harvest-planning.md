# SPEC-020: Harvest Planning & Surplus Alerts

| Field | Value |
| --- | --- |
| **Status** | Approved |
| **Version** | 1.0.0 |
| **Owner** | Product + Backend Engineering |
| **Phase** | Phase 2 |
| **Security review** | not required |
| **Depends on** | [SPEC-005](SPEC-005-crop-taxonomy.md), [SPEC-006](SPEC-006-crop-inventory.md), [SPEC-013](SPEC-013-notifications.md) |
| **Depended on by** | — |
| **Related ADRs** | [ADR-0005](../01-architecture/adr/ADR-0005-geospatial-model.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0011](../01-architecture/adr/ADR-0011-state-management.md) |
| **Last updated** | 2026-08-08 |

> **Not built.** This spec is Approved and specified; no code exists. It describes Phase 2 behaviour and the empty table stubs shipped in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)).

---

## 1. Summary

Harvest planning lets a gardener record what is actually in the ground — species, variety, sow date, plant count, bed label — and turns that into a coarse, honestly-hedged forecast of when each planting is likely to produce, so that the app is useful in April rather than only in the ten days a year someone has too many courgettes. Surplus alerts are the demand side of the same loop: a standing subscription that says "tell me when {crop} appears at a safe spot near me", targeted by **H3 r7 cell and never by point**, delivered through the existing notification outbox under a hard per-user daily cap. Together they are the retention engine — they solve the cold-start answer to "I have nothing to trade today" and give the product a reason to be opened between exchanges.

## 2. Goals

- Give a user something true and useful to do in the app on a day when they have nothing to trade, which is most days.
- Convert a planting into an `inventory_items` row in one tap when it actually produces, so the marketplace is fed by the planner rather than competing with it.
- Predict harvest windows **as ranges with stated confidence**, from sow date, days-to-maturity, and hardiness zone, and improve them from the user's own recorded outcomes rather than from anybody else's data.
- Warn the demand side early enough to be worth an exchange: a subscriber should hear about a glut while it is still a glut.
- Keep surplus alerts under a cap tight enough that the feature never becomes the reason someone turns off notifications entirely.
- Preserve the location invariant absolutely: nothing in this feature moves a coordinate, and the matching key is a **public building's** cell, not a person's.
- Be honest, in the product surface and not only in this document, that a forecast from three inputs is frequently wrong.

## 3. Non-Goals

- **A garden-management app.** No watering schedules, no fertiliser logs, no pest diaries, no companion-planting advice, no weather integration, no soil tests. Every field on `plantings` exists because the forecast or the inventory hand-off reads it. This is the non-goal that will be argued with most, and the answer is that Sharecropr's job is the exchange; the planner exists to feed it.
- **Yield prediction.** We forecast *when*, not *how much*. Quantity depends on variety, spacing, water, and luck, and a number we cannot defend would be read as a promise. `plant_count` is stored for the user's own recall and is not an input to any forecast.
- **Sharing plantings with other users.** A planting is private to its owner, forever, with no visibility control to configure. A browsable list of who is growing what, near where, is a shopping list for a burglar and a de-anonymization vector for a stalker ([Location Privacy §1](../01-architecture/04-location-privacy.md)). If Phase 3 wants social planting, it starts from a blank page and a security review.
- **A calendar that syncs to the OS calendar.** An EventKit / Calendar Provider integration is a permission prompt, a store-review justification, and a two-way sync bug surface, in exchange for putting an admittedly-unreliable date range into a system the user trusts.
- **Alerts on a person.** There is no "notify me when {user} lists something". That is a following feature, and following is a stalking primitive in a product that introduces strangers.
- **Alerts by drawn area, address, or arbitrary radius.** Radius is a small closed set of values snapped to H3 disk rings (R37). A free-form radius plus a movable origin is a probing tool.
- **Cross-hemisphere seasonality.** `crop_species.season_months` remains a Northern-hemisphere default ([SPEC-005 §3](SPEC-005-crop-taxonomy.md)). The zone model in R17 is USDA and therefore North American. Both are wrong outside that, and this spec does not fix it — see [Q5](#15-open-questions).
- **Machine learning.** The forecast is arithmetic with a median correction. There is no model to train, serve, or version beyond `model_version` as an audit string. Crop ID ML is [SPEC-023](SPEC-023-crop-id-and-food-safety.md).
- **Backfilling forecasts for past seasons.** A forecast for a window that has already closed has no consumer.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener in March**, I want to log what I've sown so that the app has a reason to exist before anything is ripe. | P0 |
| US-02 | As a **gardener**, I want a rough idea of when each bed will come in, so that I can plan which library run is worth making. | P0 |
| US-03 | As a **gardener**, I want the app to tell me it is guessing, so that I don't plan around a date it invented. | P0 |
| US-04 | As a **gardener whose beans came in three weeks early last year**, I want the app to learn that from *my* garden rather than from an average. | P1 |
| US-05 | As a **gardener with a full bed**, I want to turn "I picked this" into a listing in one tap so that logging the harvest and offering it are the same action. | P0 |
| US-06 | As a **user with nothing to trade**, I want to be told when tomatoes appear near me, so that I have a reason to come back. | P0 |
| US-07 | As a **user**, I want at most a small number of these alerts a day, so that I don't mute the app. | P0 |
| US-08 | As a **privacy-conscious user**, I want to set up an alert without telling the app where I live any more precisely than it already knows. | P0 |
| US-09 | As a **gardener**, I want to see this season's plantings on a calendar that fits on a phone screen. | P1 |
| US-10 | As a **gardener whose crop failed**, I want to mark it failed without deleting it, so that next year's forecast knows. | P2 |
| US-11 | As a **product owner**, I want to measure whether our forecasts are any good, so that we can either improve them or stop making them. | P0 |
| US-12 | As a **screen-reader user**, I want a harvest window announced as a range in words, not as a coloured bar. | P0 |

## 5. Functional Requirements

### 5.1 Plantings

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | A `public.plantings` row **MUST** belong to exactly one `gardens` row owned by the caller, and `owner_id` **MUST** be denormalized from that garden for RLS performance, matching the pattern used by `inventory_items` ([Data Model §8](../01-architecture/03-data-model.md#8-inventory)). |
| R02 | **MUST** | A planting **MUST** carry a `species_id` from the curated taxonomy. A free-text crop name is not accepted here for the same reason it is not accepted in [SPEC-005 R40](SPEC-005-crop-taxonomy.md) — the forecast keys on `species_id` and a typo silently disables it. |
| R03 | **MUST** | `sown_on` **MUST** be a date within `current_date - 3 years` and `current_date + 1 year`. A sow date in 2019 or 2041 is a typo, and a typo produces a forecast that is confidently absurd. |
| R04 | **MUST** | `bed_label` **MUST** be free text of at most 40 characters and **MUST NOT** be used for classification, matching, search, or forecasting. It is a memory aid ("side bed by the fence") and nothing reads it but the user. |
| R05 | **MUST** | `plant_count` **MUST** be an optional integer 1–2000 and **MUST NOT** be an input to any forecast (§3). |
| R06 | **MUST** | A planting's status **MUST** be one of `planned`, `sown`, `growing`, `harvesting`, `finished`, `failed`, and transitions **MUST** be free-form — this is a user's own notebook, not a state machine with concurrency ([Exchange State Machine](../01-architecture/07-exchange-state-machine.md) governs the parts that matter). |
| R07 | **MUST** | Marking a planting `failed` **MUST** retain the row and **MUST** exclude it from all forecast recomputation, from the calendar's active view, and from the personal-history correction (R21). A failure is data; deleting it loses the only honest signal we get. |
| R08 | **MUST** | A user **MUST** be able to hold at most **200 non-deleted plantings** per garden. Beyond that the calendar is unusable and the nightly recompute cost per user stops being bounded. |
| R09 | **MUST** | `rpc.record_harvest` **MUST** create an `inventory_items` row prefilled with the planting's `garden_id`, `species_id`, `variety_id`, and `harvested_on = current_date`, set `inventory_items.planting_id` to the source planting, and set the planting's `first_harvest_on` if it is null and `last_harvest_on` unconditionally. |
| R10 | **MUST** | `rpc.record_harvest` **MUST NOT** publish a listing. It creates inventory; publishing remains [SPEC-009](SPEC-009-listings-and-offers.md)'s `publish_listing` with its own `app.can_transact()` gate. Two consequences follow deliberately: an unverified user may plan and log harvests, and no forecast can cause a listing to appear without a human action. |
| R11 | **SHOULD** | The client **SHOULD** offer "Log harvest → Offer it" as a single flow with two server calls, so that R10's separation is a technical fact and not a usability tax. |
| R12 | **MUST** | Deleting a planting **MUST** be a soft delete (`deleted_at`) and **MUST NOT** cascade to the `inventory_items` rows it produced. An item already promised to someone cannot vanish because its planner tidied up. |

### 5.2 Forecasting

| ID | Req | Statement |
| --- | --- | --- |
| R13 | **MUST** | A forecast **MUST** be produced server-side by `app.forecast_harvest_window(planting_id)` and stored in `public.harvest_forecasts`. The client **MUST NOT** compute a window; two implementations of an already-shaky heuristic diverge and produce a support ticket that reads "the app said two different things". |
| R14 | **MUST** | The forecast **MUST** be a `[window_start, window_end]` date interval representing an approximate 20th-to-80th-percentile band, plus a `confidence` of `low`, `medium`, or `high`. There is no point estimate anywhere in the schema, the API, or the UI (R27). |
| R15 | **MUST** | Base maturity **MUST** be `COALESCE(crop_varieties.days_to_maturity, crop_species.days_to_maturity)`, both new nullable columns introduced by this spec (§6). |
| R16 | **MUST** | Where `sown_on` is present and base maturity is non-null, the centre **MUST** be `sown_on + base_maturity + zone_offset_days`, with `transplanted_on` replacing `sown_on` and base maturity reduced by `crop_species.days_to_maturity_from_transplant` when both are present. |
| R17 | **MUST** | `zone_offset_days` **MUST** come from `public.grow_zone_offsets`, a curated lookup keyed on `gardens.grow_zone`, expressed as days relative to the reference zone `6a`. A missing or unrecognised zone **MUST** yield offset 0 and **MUST** cap `confidence` at `low`. |
| R18 | **MUST** | The half-width of the band **MUST** be `clamp(ceil(0.25 × base_maturity), 10, 35)` days before any correction. A window narrower than ten days is a promise we cannot keep; one wider than seventy is not information. |
| R19 | **MUST** | Where base maturity is null, the forecast **MUST** fall back to `crop_species.season_months` projected onto the current year, widened by 14 days at each end, with `method = 'season_window'` and `confidence = 'low'`. |
| R20 | **MUST** | Where neither base maturity nor `season_months` is available, **no forecast row is written** and the UI **MUST** render the "we don't know" state (§8.2) rather than a fabricated window. |
| R21 | **MUST** | The personal correction **MUST** be the median signed residual, in days, between predicted centre and observed `inventory_items.harvested_on` over the owner's own **last 5 seasons of the same `species_id`**, computed only from plantings with a linked harvest, requiring **n ≥ 3** pairs, and clamped to **±21 days**. |
| R22 | **MUST** | The personal correction **MUST** use only the owner's own data. No cross-user pooling, no neighbourhood averaging, no "gardeners in your area" aggregate — each is a channel through which one user's garden timing informs another user's screen, and timing plus a cell is a fingerprint. |
| R23 | **MUST** | `confidence` **MUST** be derived exactly as: `high` when `method = 'blend'` with n ≥ 5 and residual interquartile range ≤ 14 days; `medium` when `method = 'maturity_days'` or `'blend'` with n ≥ 3; `low` otherwise, including every `season_window` forecast and every unknown zone. |
| R24 | **MUST** | Forecasts **MUST** be recomputed by the nightly `recompute_harvest_forecasts` cron for every planting whose status is `planned`, `sown`, `growing`, or `harvesting`, and immediately on insert or on a change to `sown_on`, `transplanted_on`, `species_id`, `variety_id`, or `status`. |
| R25 | **MUST** | Superseded forecasts **MUST** be retained with `superseded_at` set, keyed to their `model_version`, because forecast quality (§11) cannot be measured against a table that only remembers its latest opinion. |
| R26 | **MUST** | Every forecast row **MUST** record `method`, `model_version`, and an `inputs` jsonb containing the exact values used. A forecast we cannot reconstruct is a forecast we cannot debug or calibrate. |

### 5.3 Communicating uncertainty

> This subsection is the reason the feature is worth building rather than a liability. A harvest forecast from three inputs will be wrong by more than a fortnight a meaningful fraction of the time. The design commitment is that **being wrong is a supported outcome, not a failure state**.

| ID | Req | Statement |
| --- | --- | --- |
| R27 | **MUST NOT** | The UI **MUST NOT** render a single harvest date, a countdown to a day, a "harvest on" label, or a progress bar toward a date, anywhere, in any state, including in a notification body. |
| R28 | **MUST** | A window **MUST** be rendered in thirds-of-month language — "late July to mid August" — computed by `formatHarvestWindow()`, never as `d MMM – d MMM`. Day precision on a ±25-day band is a lie told in a typeface. |
| R29 | **MUST** | Every rendered window **MUST** carry its confidence as **text**, using the exact strings in §8.3, and **MUST NOT** convey confidence by colour, opacity, or bar width alone. |
| R30 | **MUST** | A `low`-confidence forecast **MUST** be labelled as a rough guess and **MUST** state which input was missing ("we don't know how long {species} takes in your zone"). |
| R31 | **MUST** | Where the personal correction was applied, the UI **MUST** say so ("adjusted from your last 4 harvests"). Users forgive a wrong answer far more readily than an unexplained one. |
| R32 | **SHOULD** | When a window opens without a recorded harvest, the app **SHOULD** ask once — "Anything ready?" — with `Not yet` / `Picked some` / `It failed`, and **SHOULD NOT** ask again for that planting for 14 days. |
| R33 | **MUST** | If the observed harvest falls outside the forecast band, the app **MUST NOT** apologise, explain, or surface the miss as an error. It records the residual (R21) and the next forecast is better. A product that flinches at its own error rate teaches users to distrust everything it says. |

### 5.4 Surplus alerts

| ID | Req | Statement |
| --- | --- | --- |
| R34 | **MUST** | A `surplus_alert_subscriptions` row **MUST** specify exactly one of `species_id` or `category_id`, enforced by a `CHECK`. "Everything within 25 km" is a firehose, not a subscription. |
| R35 | **MUST** | The subscription's origin **MUST** be an H3 **r7** cell (`center_h3_r7`), derived **server-side** from either `profiles.home_h3_r7` or the r7 parent of a safe spot the user selects. `rpc.set_surplus_subscription` **MUST NOT** accept a latitude, longitude, geohash, or any cell finer than r7. |
| R36 | **MUST NOT** | `center_h3_r7` and `cell_set` **MUST NOT** be client-writable, and **MUST** be column-`REVOKE`d from `authenticated`, with the client reading its own subscriptions through the `public.surplus_subscription_cards` view (§6). r7 is P1 ([Data Model §5](../01-architecture/03-data-model.md#5-identity--profiles)) and stays that way even when it is the caller's own. |
| R37 | **MUST** | `radius_km` **MUST** be drawn from the closed set `{2, 5, 8, 15, 25}`, and `cell_set` **MUST** be generated as `h3_grid_disk(center_h3_r7, k)` with `k` fixed per radius by a curated mapping. Arbitrary radii turn a subscription into a ruler. |
| R38 | **MUST** | Matching **MUST** be `listing_safe_spots.safe_spot_id → safe_spots.h3_r8 → r7 parent ∈ subscription.cell_set`. **The matched cell belongs to a public building, never to a garden or a person.** Matching on a lister's `gardens.h3_r7` was considered and rejected: it would make another user's home region the join key of a standing query, which is precisely the capability [Location Privacy §2](../01-architecture/04-location-privacy.md) exists to deny. |
| R39 | **MUST** | Matching **MUST** apply the same visibility rules as `listings_select_discoverable` — active, unexpired, owner not suspended or deleted, and `NOT app.is_blocked_either_way(subscriber, owner)` — re-implemented explicitly inside the definer matcher, because a `SECURITY DEFINER` function inherits no policy ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| R40 | **MUST** | A subscriber **MUST NOT** be alerted about their own listing. |
| R41 | **MUST** | A user **MUST** hold at most **10** subscriptions, enforced server-side with `quota_exceeded`. |
| R42 | **MUST** | Alerts **MUST** be delivered exclusively via `app.enqueue_notification(user, 'surplus_alert', payload)` inside the matcher's transaction, per [SPEC-013 R01/R03](SPEC-013-notifications.md). No push is sent from this feature by any other path. |
| R43 | **MUST** | A matcher run **MUST** collapse all matches for one user into **one** notification per run, naming at most three species and a count ("Tomato, Zucchini and 4 more nearby"). |
| R44 | **MUST** | The **daily cap MUST be 3 `surplus_alert` notifications per user per rolling 24 hours**, enforced in the matcher against `public.notifications` and not in the drain, so that a suppressed alert also costs no inbox row. This is the one place in the product where suppression removes the record rather than only the buzz, and it is deliberate: an inbox of forty "tomatoes nearby" rows is the same spam by a quieter route. |
| R45 | **MUST** | The matcher **MUST NOT** re-alert on a `(subscription_id, listing_id)` pair already alerted, enforced by a unique index on `private.surplus_alert_sends`. A listing that stays active for three weeks is announced once. |
| R46 | **MUST** | `surplus_alert` **MUST** remain **off by default** in `notification_preferences` ([SPEC-013 R29](SPEC-013-notifications.md)) and **MUST** remain quiet-hours suppressible ([Realtime & Notifications §5](../01-architecture/08-realtime-and-notifications.md)). Nothing about surplus is urgent. |
| R47 | **MUST** | Creating a subscription **MUST** be possible without granting device location: the origin falls back to `profiles.home_h3_r7`, and where that is null the user picks a safe spot from a list. Location denial is a first-class state ([Location Privacy §9](../01-architecture/04-location-privacy.md)). |
| R48 | **SHOULD** | The matcher **SHOULD** run every 15 minutes. Faster buys nothing — a courgette is not a limit order — and multiplies the cap-checking read volume. |

### 5.5 The retention loop, and how it degrades

| ID | Req | Statement |
| --- | --- | --- |
| R49 | **MUST** | The harvest calendar **MUST** be reachable in one tap from the primary tab bar and **MUST** render usefully with zero plantings, offering the seasonal seed list for the user's zone as its empty state (§8.3). |
| R50 | **MUST** | Every screen in this feature **MUST** work fully offline against cached data, with forecasts read from the cache and marked with their `computed_at` date, because forecasts are server-computed (R13) and a stale window is still a useful window. |
| R51 | **MUST** | A planting **MUST NOT** require identity or garden verification to create. Planning is the pre-verification hook: it is the thing a brand-new user can do on the day they install, and gating it behind KYC removes the only reason for them to come back before they finish it. |
| R52 | **MUST** | If `recompute_harvest_forecasts` has not succeeded in 48 hours, the calendar **MUST** display the staleness banner (§8.3) rather than silently showing month-old bands. |
| R53 | **SHOULD** | The app **SHOULD** prompt a user whose window has opened to log a harvest at most once per planting per 14 days (R32), and **SHOULD** deliver that prompt in-app rather than as a push in Phase 2. |
| R54 | **MUST** | Turning off forecasting (`harvest.forecasts_enabled` flag, §14) **MUST** leave plantings, the calendar, and `record_harvest` fully functional. The notebook has standalone value; the forecast is the part most likely to need switching off. |
| R55 | **MUST** | Forecast accuracy **MUST** be measured and reported (§11). A forecast nobody scores is a forecast nobody can defend, and if the hit rate is at chance we remove the bands rather than tune them forever. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.plantings`](../01-architecture/03-data-model.md#13-future-feature-stubs) | read/write (owner) | Stub filled in by this spec |
| `public.harvest_forecasts` | read (owner) | Written only by definer functions |
| `public.surplus_alert_subscriptions` | read via view / write via RPC | `center_h3_r7`, `cell_set` column-REVOKE'd |
| `public.grow_zone_offsets` | read (`anon`, `authenticated`) | **New.** Curated reference data, Pattern B |
| `public.crop_species` | read | `season_months`, plus new `days_to_maturity` columns |
| `public.crop_varieties` | read | New `days_to_maturity` override |
| `public.gardens` | read | `grow_zone`, `h3_r7` (server-side only) |
| `public.inventory_items` | insert via `record_harvest`; read for R21 | New `planting_id` column |
| `public.listings` / `public.listing_safe_spots` | read (definer, in matcher) | Match source |
| `public.safe_spots` | read | `h3_r8` → r7 parent is the match key (R38) |
| `public.notifications` / `private.notification_outbox` | insert via `app.enqueue_notification` | R42, R44 |
| `private.surplus_alert_sends` | insert (service only) | Dedupe ledger, R45 |
| `public.profiles` | read (definer) | `home_h3_r7`, `timezone` |

**New schema objects introduced by this spec:** migration `20261102_0090_harvest_planning.sql`

```sql
CREATE TYPE planting_status AS ENUM
  ('planned','sown','growing','harvesting','finished','failed');
CREATE TYPE forecast_method AS ENUM
  ('maturity_days','season_window','personal_history','blend');

-- Maturity data. Nullable on purpose: we would rather have no forecast than a
-- forecast built on a number a curator guessed. R20 depends on the nulls.
ALTER TABLE public.crop_species
  ADD COLUMN days_to_maturity                smallint CHECK (days_to_maturity BETWEEN 7 AND 400),
  ADD COLUMN days_to_maturity_from_transplant smallint CHECK (days_to_maturity_from_transplant BETWEEN 7 AND 400);
ALTER TABLE public.crop_varieties
  ADD COLUMN days_to_maturity smallint CHECK (days_to_maturity BETWEEN 7 AND 400);

CREATE TABLE public.grow_zone_offsets (
  zone         text PRIMARY KEY CHECK (length(zone) <= 8),
  offset_days  smallint NOT NULL CHECK (offset_days BETWEEN -60 AND 60),
  notes        text CHECK (length(notes) <= 200)
);  -- reference zone 6a has offset_days = 0

CREATE TABLE public.plantings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garden_id        uuid NOT NULL REFERENCES public.gardens(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  species_id       integer NOT NULL REFERENCES public.crop_species(id),
  variety_id       integer REFERENCES public.crop_varieties(id),
  bed_label        text CHECK (length(bed_label) <= 40),
  sown_on          date CHECK (sown_on BETWEEN current_date - 1095 AND current_date + 365),
  transplanted_on  date CHECK (transplanted_on >= sown_on),
  plant_count      smallint CHECK (plant_count BETWEEN 1 AND 2000),
  status           planting_status NOT NULL DEFAULT 'sown',
  notes            text CHECK (length(notes) <= 300),
  first_harvest_on date,
  last_harvest_on  date CHECK (last_harvest_on >= first_harvest_on),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plantings_owner_idx   ON public.plantings (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX plantings_garden_idx  ON public.plantings (garden_id) WHERE deleted_at IS NULL;
CREATE INDEX plantings_species_idx ON public.plantings (owner_id, species_id) WHERE deleted_at IS NULL;
CREATE INDEX plantings_active_idx  ON public.plantings (status)
  WHERE deleted_at IS NULL AND status IN ('planned','sown','growing','harvesting');

CREATE TABLE public.harvest_forecasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planting_id   uuid NOT NULL REFERENCES public.plantings(id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_start  date NOT NULL,
  window_end    date NOT NULL CHECK (window_end >= window_start),
  confidence    text NOT NULL CHECK (confidence IN ('low','medium','high')),
  method        forecast_method NOT NULL,
  correction_days smallint NOT NULL DEFAULT 0 CHECK (correction_days BETWEEN -21 AND 21),
  sample_n      smallint NOT NULL DEFAULT 0,
  inputs        jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text NOT NULL CHECK (length(model_version) <= 20),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

-- One live forecast per planting; history retained for calibration (R25).
CREATE UNIQUE INDEX harvest_forecasts_live
  ON public.harvest_forecasts (planting_id) WHERE superseded_at IS NULL;
CREATE INDEX harvest_forecasts_owner_window_idx
  ON public.harvest_forecasts (owner_id, window_start) WHERE superseded_at IS NULL;

-- The forecast row may not carry a coordinate, ever, including inside `inputs`.
ALTER TABLE public.harvest_forecasts
  ADD CONSTRAINT harvest_forecasts_no_coords
  CHECK (NOT app.jsonb_has_coord_key(inputs));

CREATE TABLE public.surplus_alert_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  species_id     integer REFERENCES public.crop_species(id),
  category_id    smallint REFERENCES public.crop_categories(id),
  center_h3_r7   text NOT NULL,
  origin_kind    text NOT NULL CHECK (origin_kind IN ('home','safe_spot')),
  origin_spot_id uuid REFERENCES public.safe_spots(id),
  radius_km      smallint NOT NULL CHECK (radius_km IN (2,5,8,15,25)),
  cell_set       text[] NOT NULL,
  is_paused      boolean NOT NULL DEFAULT false,
  last_matched_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_one_target CHECK (num_nonnulls(species_id, category_id) = 1)
);

CREATE INDEX sas_user_idx  ON public.surplus_alert_subscriptions (user_id);
CREATE INDEX sas_cells_gin ON public.surplus_alert_subscriptions USING GIN (cell_set)
  WHERE is_paused = false;
CREATE UNIQUE INDEX sas_no_duplicates ON public.surplus_alert_subscriptions
  (user_id, COALESCE(species_id, -1), COALESCE(category_id, -1), center_h3_r7, radius_km);

-- r7 is P1 even when it is your own (R36).
REVOKE SELECT (center_h3_r7, cell_set) ON public.surplus_alert_subscriptions FROM authenticated;

CREATE VIEW public.surplus_subscription_cards WITH (security_invoker = on) AS
SELECT s.id, s.species_id, s.category_id, s.radius_km, s.is_paused,
       s.origin_kind, s.origin_spot_id, s.created_at,
       CASE WHEN s.origin_kind = 'safe_spot'
            THEN (SELECT name FROM public.safe_spots WHERE id = s.origin_spot_id)
            ELSE (SELECT city_label FROM public.profiles WHERE id = s.user_id)
       END AS origin_label
  FROM public.surplus_alert_subscriptions s
 WHERE s.user_id = (SELECT auth.uid());
GRANT SELECT ON public.surplus_subscription_cards TO authenticated;

-- Dedupe ledger. private, because it is a per-user record of what was near them.
CREATE TABLE private.surplus_alert_sends (
  subscription_id uuid NOT NULL REFERENCES public.surplus_alert_subscriptions(id) ON DELETE CASCADE,
  listing_id      uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, listing_id)
);

ALTER TABLE public.inventory_items
  ADD COLUMN planting_id uuid REFERENCES public.plantings(id) ON DELETE SET NULL;
CREATE INDEX inventory_planting_idx ON public.inventory_items (planting_id)
  WHERE planting_id IS NOT NULL;
```

RLS — Pattern A throughout ([RLS Design §5](../01-architecture/05-rls-design.md)), with writes to forecasts reserved to definer functions:

```sql
ALTER TABLE public.plantings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantings FORCE  ROW LEVEL SECURITY;

CREATE POLICY plantings_select_own ON public.plantings
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);

CREATE POLICY plantings_insert_own ON public.plantings
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid())
              AND EXISTS (SELECT 1 FROM public.gardens g
                           WHERE g.id = garden_id
                             AND g.owner_id = (SELECT auth.uid())
                             AND g.deleted_at IS NULL));

CREATE POLICY plantings_update_own ON public.plantings
  FOR UPDATE TO authenticated
  USING  (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
-- No DELETE policy. R12's soft delete is an UPDATE.

CREATE POLICY forecasts_select_own ON public.harvest_forecasts
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND superseded_at IS NULL);
-- No INSERT/UPDATE/DELETE policy at all: R13 is enforced by absence.

CREATE POLICY sas_select_own ON public.surplus_alert_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY sas_update_pause ON public.surplus_alert_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
-- Narrowed to `is_paused` by the guard_subscription_columns trigger; no INSERT
-- policy, because the origin cell must be server-derived (R35).
```

Also introduced: `app.forecast_harvest_window(uuid)`, `app.personal_residual(uuid, integer)`, `app.subscription_cells(text, smallint)`, `app.recompute_harvest_forecasts()`, `app.match_surplus_alerts()`, the `guard_subscription_columns` BEFORE UPDATE trigger, the `trg_planting_touch_forecast` trigger implementing R24's immediate recompute, and two `pg_cron` jobs.

**PII touched:** `plantings.*` is **P2** — a private notebook, owner-only, never rendered to another user. `surplus_alert_subscriptions.center_h3_r7` and `cell_set` are **P1** (a ~5 km² cell around the user's home) and are column-`REVOKE`d (R36). `harvest_forecasts.inputs` is P2 and carries a coordinate-key `CHECK`. `inventory_items.harvested_on` is already P2 ([Data Model §8](../01-architecture/03-data-model.md#8-inventory)). Nothing in this spec introduces a P0 column, and no function here reads `private.garden_locations`.

## 7. API

### 7.1 `rpc.upsert_planting`

**Auth:** `authenticated` (verification **not** required, R51) · **Rate limit:** 60 / hour / user

```jsonc
// Request
{ "p_id": null, "p_garden_id": "3c9a…", "p_species_id": 412, "p_variety_id": 1188,
  "p_bed_label": "Side bed by the fence", "p_sown_on": "2027-04-12",
  "p_transplanted_on": null, "p_plant_count": 12, "p_status": "sown", "p_notes": null }
// Response 200
{ "planting_id": "b71f…",
  "forecast": { "window_start": "2027-07-19", "window_end": "2027-08-12",
                "confidence": "medium", "method": "maturity_days",
                "correction_days": 0, "sample_n": 0, "model_version": "hf-1" } }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_found` | 404 | `p_garden_id` is not the caller's, or is deleted |
| `validation_failed` | 400 | `p_sown_on` out of range (R03); unknown or inactive `p_species_id`; variety not under that species; `bed_label` > 40 chars |
| `quota_exceeded` | 422 | 200 plantings already on that garden (R08) |
| `rate_limited` | 429 | Bucket empty; integer `Retry-After` |

`forecast` is `null` when R20 applies. It is not an error, and the client must render the "we don't know" state rather than a spinner.

### 7.2 `rpc.record_harvest`

**Auth:** `authenticated` · **Rate limit:** 60 / hour / user

```jsonc
// Request
{ "p_planting_id": "b71f…", "p_quantity": 4.5, "p_unit": "pound",
  "p_condition": "just_picked", "p_idempotency_key": "8f14e45f-…" }
// Response 201
{ "inventory_item_id": "d20c…", "planting_status": "harvesting",
  "residual_days": -6, "window_hit": true }
```

`residual_days` and `window_hit` are returned for the client's own "how did we do" copy and are the same values fed to R21 and to `harvest.forecast_residual` (§11). A negative residual means early.

| Error code | HTTP | When |
| --- | --- | --- |
| `not_found` | 404 | Not the caller's planting |
| `conflict` | 409 | Planting is `failed`; un-fail it first |
| `validation_failed` | 400 | Quantity ≤ 0, or unit outside `quantity_unit` |
| `rate_limited` | 429 | Bucket empty |

### 7.3 `rpc.harvest_calendar`

**Auth:** `authenticated` · **Rate limit:** 120 / hour / user

```jsonc
// Request
{ "p_from": "2027-06-01", "p_to": "2027-10-31" }
// Response 200
[{ "planting_id": "b71f…", "species_id": 412, "common_name": "Tomato",
   "variety_name": "Cherokee Purple", "bed_label": "Side bed by the fence",
   "status": "growing", "window_start": "2027-07-19", "window_end": "2027-08-12",
   "confidence": "medium", "method": "maturity_days", "correction_days": 0,
   "sample_n": 0, "computed_at": "2027-06-14T03:15:00Z" }]
```

The range is capped server-side at 18 months. The return type has no coordinate column and no `grow_zone`, deliberately: zone is close enough to a coarse region that it does not need to ride on every row when the client already knows its own garden's.

### 7.4 `rpc.set_surplus_subscription`

**Auth:** `authenticated` · **Rate limit:** 20 / day / user

```jsonc
// Request — origin is a choice between two server-known anchors, never a point
{ "p_id": null, "p_species_id": 412, "p_category_id": null,
  "p_origin_kind": "home", "p_origin_spot_id": null, "p_radius_km": 8 }
// Response 200
{ "subscription_id": "77ac…", "radius_km": 8, "cell_count": 19,
  "origin_label": "Ann Arbor, MI" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Both or neither of species/category; `p_radius_km` outside the closed set; `p_origin_kind = 'safe_spot'` with an inactive or unknown spot; **any latitude/longitude parameter present** |
| `precondition_failed` | 409 | `p_origin_kind = 'home'` and `profiles.home_h3_r7` is null — the client must offer the safe-spot origin instead (R47) |
| `quota_exceeded` | 422 | 10 subscriptions already (R41) |
| `conflict` | 409 | Identical subscription exists; returns the existing id as a success |
| `rate_limited` | 429 | Bucket empty |

`cell_count` is returned so the UI can say "about 19 neighbourhood cells" if it ever wants to. It is a count, not a list; the cells themselves never leave the server (R36).

### 7.5 `rpc.delete_surplus_subscription(p_id uuid)`

Hard delete; cascades `private.surplus_alert_sends`. Idempotent — deleting an already-deleted subscription returns 200.

### 7.6 Cron: `recompute_harvest_forecasts`

`pg_cron`, daily at 03:15 UTC. Recomputes every active planting (R24) in batches of 2,000, writes new `harvest_forecasts` rows, and sets `superseded_at` on the previous live row in the same statement. Runs as `service_role`. Idempotent: a second run on the same day produces identical rows and supersedes nothing, because the input hash in `inputs` is compared first.

### 7.7 Cron: `match_surplus_alerts`

`pg_cron`, every 15 minutes (R48).

```
FOR each subscription WHERE NOT is_paused
  candidate listings :=
      active, unexpired, owner not suspended/deleted/blocked, owner <> subscriber
      AND species/category matches
      AND EXISTS (safe spot of that listing whose h3_r8 r7-parent ∈ cell_set)
      AND NOT EXISTS (private.surplus_alert_sends row)
GROUP BY subscriber
  IF count(notifications WHERE kind='surplus_alert' AND created_at > now()-'24h') >= 3 → skip (R44)
  app.enqueue_notification(subscriber, 'surplus_alert', {species_names, count, radius_km})
  INSERT private.surplus_alert_sends for every listing counted
```

The `sends` insert and the `enqueue_notification` call are in one transaction, so a crash between them cannot produce a silent gap or a duplicate.

### 7.8 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| Any endpoint returning another user's planting | §3. There is no visibility flag to get wrong. |
| A "gardeners near me growing X" aggregate | Even at r7, a count of growers per cell per species is a spatial dataset about people's homes, and it is exactly the kind of harmless-looking aggregate [Location Privacy §12.4](../01-architecture/04-location-privacy.md) warns about. |
| The subscription's `cell_set` | R36 |
| A realtime channel for forecasts | A value that changes once a night does not need a socket ([Realtime & Notifications §8](../01-architecture/08-realtime-and-notifications.md)). |
| An "alert me about this specific user" endpoint | §3 |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Harvest calendar | `/(tabs)/plan` | Season timeline of every active planting's window |
| Planting list | `/(tabs)/plan/plantings` | Flat list grouped by bed, with status |
| Add / edit planting | `/(modals)/planting/[id]` | Species picker, variety, sow date, count, bed label |
| Planting detail | `/(modals)/planting/[id]/detail` | Window, confidence, "how we worked this out", harvest history |
| Log harvest | `/(modals)/planting/[id]/harvest` | Quantity, unit, condition → inventory item |
| Surplus alerts | `/profile/alerts` | Subscription list, add, pause, delete |
| Add alert | `/(modals)/alerts/new` | Crop or category, origin (home / safe spot), radius chips |

The calendar is a vertical list of month bands, not a horizontal Gantt chart. A Gantt is the obvious design and it is wrong here: it needs pixel-precise bar edges to be legible, and pixel-precise edges on a ±25-day estimate is exactly the false precision R27 forbids. Month bands with a two-word label degrade gracefully at 200% type and read correctly aloud.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Calendar renders month bands and the user's planting names immediately from the TanStack Query cache; only the window pills show a 1-line shimmer. Because plantings change rarely, a warm cache is the normal case and a full-screen skeleton would appear only on first ever open. |
| Empty | Two distinct empties, and conflating them is the most likely design mistake here. **No plantings:** a seasonal seed list for the garden's `grow_zone` — "Sowing now in zone 6a: bush beans, carrots, chard" — with a one-tap "I planted this" for each. **No forecast for an existing planting** (R20): the planting still renders in the list with the copy in §8.3; it is not hidden and it is not shown with an invented band. |
| Error (recoverable) | `harvest_calendar` 5xx or timeout: the cached calendar stays on screen with a thin inline banner and Retry. A failed `upsert_planting` keeps the form populated and offers Retry; nothing typed is lost. |
| Error (terminal) | Only reachable if the garden itself is gone (deleted or archived mid-session). The plan tab shows "This garden is no longer available" with a link to garden settings. Plantings are not orphaned in the UI while their garden is missing. |
| Offline | Fully readable (R50). Every window pill shows "as of {date}" when `computed_at` is more than 3 days old. Creating and editing plantings is queued as an offline mutation keyed on the client-generated `p_id`, so a reconnect replays it exactly once; `record_harvest` is **not** queued, because it creates inventory that may immediately be listed and a silently-deferred harvest is a listing that does not exist. |
| Permission denied | Not applicable to plantings and the calendar — no device permission is used anywhere in this feature. For the *alert* flow, "permission denied" means notification permission is off: the subscription still saves, and the screen shows the banner in §8.3 with a link to OS settings ([SPEC-013 R36](SPEC-013-notifications.md)). The subscription is never blocked on a permission. |
| Rate limited | `upsert_planting` 429 is reachable only by a scripted client; the form disables Save with a countdown. `set_surplus_subscription` 429 (20/day) shows the quota copy in §8.3. Neither ever discards user input. |

Two feature-specific states:

| State | Behaviour |
| --- | --- |
| Forecasts stale (R52) | A dismissible banner across the top of the calendar: windows keep rendering, each labelled "as of {date}". We do not blank the calendar — a fortnight-old estimate of a three-week window is barely different from a fresh one, and hiding it would be a bigger lie than showing it. |
| Forecasts disabled (R54) | The `harvest.forecasts_enabled` flag is off: every window pill disappears, the calendar collapses to a sow-date-ordered list, and one line explains that harvest estimates are off. Plantings, editing, and `record_harvest` all still work. |

### 8.3 Copy

Exact strings.

**Calendar empty, zone known**
> **Nothing planted yet.**
> Add what's in the ground and we'll estimate when it comes in.
>
> Sowing now in zone {zone}: {crop_1} · {crop_2} · {crop_3}

**Calendar empty, zone unknown**
> **Nothing planted yet.**
> Add what's in the ground and we'll estimate when it comes in.

**Window pill — medium or high confidence**
> Likely {early|mid|late} {Month} to {early|mid|late} {Month}

**Window pill — low confidence**
> Rough guess: {early|mid|late} {Month} to {early|mid|late} {Month}

**Confidence line, `high`**
> Based on your last {n} {species} harvests.

**Confidence line, `medium`**
> Based on typical days to maturity for zone {zone}.

**Confidence line, `low` — no maturity data**
> We don't know how long {species} usually takes, so this is based on the general season. Expect it to be off.

**Confidence line, `low` — unknown zone**
> We don't have a hardiness zone for your garden, so this is a general estimate. Expect it to be off.

**Personal correction applied (R31)**
> Adjusted {n} days {earlier|later} from your own harvests.

**No forecast possible (R20)**
> **No estimate for this one.**
> We don't have maturity or season data for {species}. Log the harvest when it comes and we'll learn from it.

**Stale forecasts banner (R52)**
> Estimates haven't updated in a few days. The windows below are as of {date}.

**Forecasts disabled (R54)**
> Harvest estimates are off right now. Your plantings are unaffected.

**Window-opened prompt (R32)**
> **Anything ready in {bed_label}?**
> Buttons: `Not yet` · `Picked some` · `It failed`

**After logging a harvest inside the window**
> Logged. That was about when we expected.

**After logging a harvest outside the window**
> Logged. We'll use this for next time.
> *(Never an apology. R33.)*

**Harvest → offer handoff (R11)**
> Added to your inventory. Offer it to someone?
> Buttons: `Not now` · `Create listing`

**Planting quota (R08)**
> You've got 200 plantings on this garden. Finish or remove some to add more.

**Alerts empty**
> **No alerts set up.**
> Get a nudge when something you're after shows up at a safe spot near you.
>
> Button: `Add an alert`

**Add alert — origin picker**
> **Where should we look?**
> Near home ({city_label}) · Near a safe spot

**Add alert — origin unavailable (R47 / `precondition_failed`)**
> We don't have a home area for you yet. Pick a safe spot to search around instead.

**Add alert — radius chips**
> 2 km · 5 km · 8 km · 15 km · 25 km

**Add alert — privacy line, always shown under the origin picker**
> We only ever use your rough neighbourhood — about a 5 km² area — never your address.

**Alert quota (R41)**
> You have 10 alerts. Remove one to add another.

**Alert daily cap explanation, on the alerts screen**
> We'll send you at most 3 of these a day, however many alerts you set up.

**Surplus alert notification — one species**
> Title: `{species} available nearby`
> Body: `{count} new {listing|listings} within {radius} km`

**Surplus alert notification — several species**
> Title: `New crops nearby`
> Body: `{species_1}, {species_2} and {n} more within {radius} km`

**Notification permission off, on the alerts screen**
> Notifications are off for this app, so these alerts will only appear in your inbox.
> Button: `Open settings`

**Duplicate subscription (`conflict`)**
> You already have that alert.

**Accessibility label — window pill**
> {species}, {bed_label}. Likely {early|mid|late} {Month} to {early|mid|late} {Month}. Confidence {low|medium|high}.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | **Turn a standing subscription into a spatial probe.** The theoretical attack is to create many subscriptions with different origins and radii, observe which ones fire, and intersect the results to narrow where a particular listing — and therefore, indirectly, its owner's travel pattern — sits. Four things bound it. First, the match key is `safe_spots.h3_r8` rolled up to r7, so every cell that can ever appear in a match belongs to a **public building whose coordinate we already publish**; the probe learns nothing that `safe_spots_near` does not already return ([Location Privacy §6](../01-architecture/04-location-privacy.md)). Second, the origin is not attacker-chosen in any fine sense: `origin_kind = 'home'` resolves to `profiles.home_h3_r7`, and `'safe_spot'` resolves to a public building, so a subscription cannot be centred on an arbitrary point. Third, radius is a five-value closed set snapped to disk rings (R37), so the intersection lattice is coarse by construction. Fourth, 10 subscriptions per user and 20 writes per day cap the sampling rate. The residual is the one already accepted in [Location Privacy §12.4](../01-architecture/04-location-privacy.md) — safe-spot choice narrows a lister's plausible region — and this feature does not widen it. The second-worst outcome is **notification fatigue as self-inflicted denial of service**: an uncapped matcher trains the entire user base to disable push, which would silently break `exchange_reminder` and degrade `safety_alert` reach. R44's hard cap of 3/24 h is a safety control wearing a product hat. |
| **Which RLS policies enforce access?** | `plantings_select_own`, `plantings_insert_own`, `plantings_update_own` (Pattern A, no DELETE policy — R12's soft delete is an UPDATE); `forecasts_select_own` with **no write policy of any kind**, which is the enforcement of R13; `sas_select_own` and `sas_update_pause`, narrowed to `is_paused` by `guard_subscription_columns`, with **no INSERT policy** so that R35's server-derived origin cannot be bypassed. Reads of a user's own subscriptions go through `public.surplus_subscription_cards` (`security_invoker = on`) because the base table's `center_h3_r7` and `cell_set` are column-`REVOKE`d. Definer functions: `app.forecast_harvest_window`, `app.personal_residual`, `app.subscription_cells`, `app.recompute_harvest_forecasts`, `app.match_surplus_alerts`, `app.enqueue_notification`, `app.should_deliver`, `app.jsonb_has_coord_key`, `app.is_blocked_either_way`, `app.consume_token`, plus `public.upsert_planting`, `public.record_harvest`, `public.harvest_calendar`, `public.set_surplus_subscription`, `public.delete_surplus_subscription`. Every one runs as owner, bypasses RLS, and re-checks authorization as its first statement; `match_surplus_alerts` in particular re-implements the whole of `listings_select_discoverable` in its `WHERE` (R39). |
| **Can any response path expose an exact coordinate or PII?** | No. **How this feature preserves the location invariant:** (1) no function in this spec reads `private.garden_locations`, and none is added to the [LP-02](../01-architecture/04-location-privacy.md) definer allowlist; (2) no return type declared here has a `geography`, `geometry`, `lat`, `lng`, `h3_r9`, or `display_point` column — `harvest_calendar` returns dates and names, `set_surplus_subscription` returns a count and a label; (3) the only spatial value the feature stores about a user is `center_h3_r7`, which is r7 (~5 km², the resolution [Location Privacy §7](../01-architecture/04-location-privacy.md) explicitly permits) and is column-`REVOKE`d anyway; (4) the matching join key is a **safe spot's** cell, not a garden's (R38); (5) `harvest_forecasts.inputs` carries the same `app.jsonb_has_coord_key` `CHECK` used on `notifications.payload` and `audit.events.metadata`, so a future contributor cannot quietly stash a point in the audit blob; (6) the surplus notification template is a row in `private.notification_templates` and names a radius and a species, never a place. `plantings` is P2 and owner-only; a planting is never rendered to another user by any path. |
| **What is logged, and is it scrubbed?** | Forecast computations log `planting_id`, `species_id`, `method`, `confidence`, and the residual in days — no dates of the user's own harvests beyond the residual, and no bed labels, which are free text and could contain anything. Matcher runs log counts and durations, never a subscriber id alongside a cell. `bed_label` and `plantings.notes` are on the telemetry scrubber's drop list alongside `body` and `message`. Analytics spatial resolution stays capped at H3 r5 ([Location Privacy §8](../01-architecture/04-location-privacy.md)); r7 never leaves the database. |
| **Does this need step-up authentication?** | No. Nothing here is an account-security operation, and requiring a TOTP code to log a row of carrots would be friction with no matching threat ([API Contract §2.4](../01-architecture/06-api-contract.md)). |
| **Abuse / rate-limit controls** | `upsert_planting` 60/h, `record_harvest` 60/h, `harvest_calendar` 120/h, `set_surplus_subscription` 20/day, 200 plantings per garden (R08), 10 subscriptions per user (R41), 3 surplus notifications per 24 h (R44), one alert per `(subscription, listing)` ever (R45), matcher cadence 15 min (R48). All are Postgres token buckets via `app.consume_token`, consistent with [API Contract §6](../01-architecture/06-api-contract.md). |

**Threat notes.**

- **Forecast as an absence oracle.** A harvest window is a statement about a *garden*, and gardens are homes. If a forecast were ever visible to another user, "the Smiths' tomatoes come in the second week of August" is a scheduling hint for a burglar in exactly the way [Location Privacy §1](../01-architecture/04-location-privacy.md) describes. This is why §3's "no sharing plantings" is a non-goal with a security rationale and not a scope decision.
- **Cross-user pooling is the tempting mistake.** "Gardeners near you are picking beans" is a genuinely better forecast and a genuinely worse product: it is a per-cell, per-species, per-week timing signal derived from private notebooks. R22 forbids it, and the forbidding is load-bearing rather than cautious.
- **Enumeration.** `harvest_calendar` and the subscription card view filter on `auth.uid()`; a guessed `planting_id` returns an empty set, not a 403, giving no existence oracle.
- **Quota as a privacy control.** R41's limit of 10 reads as anti-spam and is really anti-probing (§9 row 1).

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | User logs a planting with a sow date two weeks in the future. | Accepted (R03 permits +365 days). Status defaults to `planned`; the forecast is computed from the future sow date and the calendar shows it in the right month. Planning ahead is the point. |
| EC-02 | Species has no `days_to_maturity` and no `season_months`. | R20: no forecast row, the "No estimate for this one" copy, and the planting still appears in the list. The species is added to the maturity-curation backlog (§11) automatically. |
| EC-03 | Garden has no `grow_zone` (user skipped it, or the geocode failed). | R17: offset 0, confidence forced to `low`, and the unknown-zone copy names the missing input. We do not guess a zone from `city_label`. |
| EC-04 | User's own history says beans come 25 days early. | R21 clamps the correction to −21 days. The clamp is deliberate: a 25-day residual from three samples is more likely a data-entry error than a microclimate, and an unclamped correction compounds one bad row into a wrong forecast for years. |
| EC-05 | User records a harvest for a planting they had marked `failed`. | `conflict` 409 with copy offering to un-fail it. Silently reviving the planting would corrupt R07's exclusion and quietly re-enter it into the residual set. |
| EC-06 | Two devices log the same harvest simultaneously. | `p_idempotency_key` is unique per `(user_id, key)`; the second call returns the first call's `inventory_item_id` as a success. One item, not two, and no double-listing of the same box of tomatoes. |
| EC-07 | A species is merged in the taxonomy while a planting references the losing id. | The planting resolves through `taxonomy_tombstones` to the replacement ([SPEC-005 R37](SPEC-005-crop-taxonomy.md)) and the next nightly recompute uses the winner's maturity data. `plantings.species_id` is repointed by the merge transaction, which must be extended to cover this table — noted in §14 as a required amendment to [SPEC-005 R35](SPEC-005-crop-taxonomy.md). |
| EC-08 | User deletes the garden that holds 40 plantings. | `ON DELETE CASCADE` removes the plantings and their forecasts. The `inventory_items` produced by `record_harvest` survive with `planting_id` set to `NULL` (R12), so a live listing is untouched. |
| EC-09 | Subscription's origin safe spot is retired. | The subscription keeps working on its stored `cell_set` — the cells are geography, not a foreign key to a venue's status — and the alerts screen shows the spot's name with "(no longer listed)". Silently disabling the subscription would look like the feature broke. |
| EC-10 | Matcher finds 60 matching listings for one user in a single run. | R43: one notification naming three species and a count of 60. R45 records all 60 in `surplus_alert_sends`, so the next run about the same listings is silent. |
| EC-11 | User has 10 subscriptions and 4 of them match in the same run. | Still one notification (R43), and it counts as one against the 3/24 h cap (R44). The cap is per user, not per subscription — which is the whole reason it is enforceable. |
| EC-12 | A blocked user lists tomatoes 300 m from the subscriber's chosen safe spot. | No alert. R39 applies `app.is_blocked_either_way` inside the matcher, so the listing never enters the candidate set — the same "not filtered, never present" property [RLS Design §6](../01-architecture/05-rls-design.md) requires everywhere else. |
| EC-13 | `match_surplus_alerts` fails for six hours. | Nothing is lost. Alerts are computed from current listing state plus the `sends` ledger, not from a queue, so the next successful run alerts on everything still active and unnotified. Listings that expired in the gap are simply never announced, which is correct. |
| EC-14 | The nightly recompute overruns and overlaps its next run. | `pg_cron` jobs are serialized by an advisory lock taken as the first statement; the second invocation exits immediately and increments `harvest.recompute_skipped`. Two concurrent recomputes would race on the `harvest_forecasts_live` partial unique index. |
| EC-15 | A user in the southern hemisphere logs a February sowing. | The forecast is computed and is **wrong** — `season_months` is a Northern default and `grow_zone_offsets` is USDA. `method = 'season_window'` forecasts in particular will be six months out. This is a known, unfixed limitation ([Q5](#15-open-questions)); it is not a crash and not a data-integrity problem, and there are no Southern-hemisphere metros in Phase 2. |
| EC-16 | `days_to_maturity` is later corrected for a species from 75 to 95 days. | Every active planting of that species is recomputed on the next nightly run and its window moves. The old forecast is retained with `superseded_at` (R25), so calibration is measured against what we actually told the user at the time, not against what we would say now. |
| EC-17 | User records three harvests from the same planting across five weeks. | `first_harvest_on` is set once, `last_harvest_on` moves each time (R09), and R21 uses only the **first** harvest as the residual anchor. Using the last would make every indeterminate crop look chronically late. |
| EC-18 | User turns off `surplus_alert` in notification preferences but keeps their subscriptions. | The matcher still records `surplus_alert_sends` rows and still writes the inbox notification; `app.should_deliver` suppresses the push. Turning the category off means "stop buzzing me", and the alerts screen says so rather than implying the subscriptions are dead. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `harvest.planting_created` | product event | `species_id`, `has_sow_date`, `has_variety`, `source` (`manual`\|`seed_list`) | — |
| `harvest.planting_failed_marked` | product event | `species_id`, `days_since_sow` | — |
| `harvest.forecast_computed` | product event | `method`, `confidence`, `band_days`, `sample_n`, `model_version` | `confidence = 'low'` > 45% of forecasts ⇒ the maturity seed data is too thin to ship the feature |
| `harvest.forecast_absent` | counter | `species_id` | Top-20 list drives the maturity-curation backlog (EC-02) |
| **`harvest.forecast_residual`** | histogram | signed days between `window` centre and observed `harvested_on`, bucketed by `method` and `confidence` | **The number that decides this feature's future.** See below. |
| `harvest.window_hit_rate` | gauge | share of harvests landing inside their band, by `confidence` | `high` < 60%, `medium` < 45%, or `low` < 30% over a full season ⇒ the confidence labels are dishonest and must be re-derived or removed (R55) |
| `harvest.recompute_duration` | histogram | seconds, rows | p95 > 300 s |
| `harvest.recompute_skipped` | counter | advisory-lock contention (EC-14) | > 2 per week |
| `harvest.recompute_stale_hours` | gauge | hours since last success | > 48 ⇒ page; drives R52's banner |
| `harvest.record_harvest` | product event | `species_id`, `window_hit`, `residual_days`, `led_to_listing` | `led_to_listing` < 20% ⇒ the harvest→offer handoff (R11) is not working |
| `surplus.subscription_created` | product event | `target_kind` (`species`\|`category`), `radius_km`, `origin_kind` | — |
| `surplus.match_run` | product event | `subscriptions_scanned`, `matches`, `notifications_sent`, `duration_ms` | p95 `duration_ms` > 20 s |
| `surplus.capped` | counter | users skipped by R44 in a run | > 15% of alerting users daily ⇒ the cap is doing the feature's job for it; reduce match sensitivity rather than raise the cap |
| `surplus.alert_to_open` | funnel | notification → app open → listing view → request | < 5% request rate ⇒ alerts are noise and the radius defaults are wrong |
| `surplus.unsubscribe_after_alert` | counter | subscriptions deleted within 1 h of an alert | Rising ⇒ the alert content is misleading |
| `notification.opt_out_after_surplus` | counter | users disabling **all** push within 24 h of a surplus alert | **Any sustained rise pages.** This is the feature damaging the notification channel every other spec depends on. |

> `harvest.forecast_residual` and `harvest.window_hit_rate` exist to make R55 enforceable. If a full season's data shows `medium` windows hitting at 45%, the honest response is to widen the bands or delete them — not to add a fourth input and hope. That decision is scheduled, not aspirational: the first end-of-season review is a dated item in [the roadmap](../06-roadmap/01-roadmap.md).

**Never emitted:** a bed label, a planting note, a subscriber id alongside a cell id, any H3 resolution finer than r5, or a user's harvest dates as a series.

## 12. Accessibility

- Every calendar row is **one** accessible element with a composed label (§8.3) — species, bed, window in words, confidence in words — not separate stops for icon, name, and bar.
- Confidence is text in the accessibility label and in the visual design (R29). The colour treatment on window pills is redundant with the label, and the app is fully usable in greyscale.
- The calendar is a list with month headings, navigable by heading in VoiceOver's rotor and by TalkBack's heading navigation. A horizontal timeline would not be.
- Date ranges are announced in words — "late July to mid August" — never as "7/19–8/12", which screen readers pronounce as arithmetic.
- The window-opened prompt (R32) is an inline card with three real buttons, never a swipe action and never an auto-dismissing toast.
- Radius selection is a labelled radio group (`accessibilityRole="radio"`, `accessibilityState={{ checked }}`), not a slider. A slider over five discrete values is worse for everyone and unusable with a switch control.
- The origin picker announces the privacy line (§8.3) as part of the group label, so a screen-reader user hears the "rough neighbourhood" guarantee before choosing, not after.
- Dynamic type to 200% with no truncation: window pills wrap to two lines and the month band grows.
- Reduced motion: the calendar's month-to-month scroll snap becomes an instant jump; no parallax, no animated bar growth.
- Minimum 44 × 44 dp on every row, chip, radius option, and the three prompt buttons.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01 | Insert with a `garden_id` the caller does not own is denied; `owner_id` mismatch is denied |
| T02 | integration | R02 | `upsert_planting` with an unknown or inactive `species_id` returns `validation_failed`; no free-text crop parameter exists on the RPC signature |
| T03 | unit | R03 | Sow dates at −1096, −1095, +365, +366 days: boundaries accepted and rejected correctly |
| T04 | integration | R04 | Static check: `bed_label` appears in no forecast, match, or search query |
| T05 | integration | R05 | Two plantings differing only in `plant_count` produce byte-identical forecasts |
| T06 | integration | R06 | Every ordered pair of statuses transitions without error |
| T07 | integration | R07 | A `failed` planting is excluded from recompute, from the active calendar, and from `app.personal_residual` |
| T08 | integration | R08 | 201st planting on a garden returns `quota_exceeded` 422 |
| T09 | integration | R09 | `record_harvest` creates the item with correct garden/species/variety/date, links `planting_id`, sets `first_harvest_on` once and `last_harvest_on` every time |
| T10 | integration | R10 | `record_harvest` creates no `listings` row; an unverified user can call it successfully |
| T11 | integration | R12 | Soft-deleting a planting leaves its inventory items intact and readable |
| T12 | rls | R13 | Direct INSERT and UPDATE on `harvest_forecasts` as `authenticated` are denied — no policy exists |
| T13 | unit | R14 | Every forecast row has `window_end >= window_start` and a confidence in the closed set; no point-estimate column exists in the table or the API shape |
| T14 | unit | R15 | Variety maturity overrides species maturity; species is used when the variety's is null |
| T15 | unit | R16 | Centre arithmetic with and without `transplanted_on`, against a fixture of 30 cases |
| T16 | unit | R17 | Zone `6a` → 0; a known warm zone shifts earlier; unknown zone → offset 0 and `confidence = 'low'` |
| T17 | unit | R18 | Half-width clamps at 10 and 35 for maturity values of 20 and 300 days |
| T18 | unit | R19 | Null maturity → `season_window` from `season_months`, widened 14 days each side, `confidence = 'low'` |
| T19 | integration | R20 | Species with neither input produces **no** forecast row, and `upsert_planting` returns `forecast: null` |
| T20 | unit | R21 | Median signed residual over 5 seasons; n = 2 applies no correction; a 40-day residual clamps to 21 |
| T21 | integration | R22 | Another user's harvest history changes nothing in the caller's forecast, asserted by a differential run |
| T22 | unit | R23 | The full confidence truth table, all branches |
| T23 | integration | R24 | Editing `sown_on` recomputes synchronously; the nightly job recomputes exactly the four active statuses |
| T24 | integration | R25 | A recompute sets `superseded_at` on the prior row and leaves it readable to the calibration query |
| T25 | integration | R26 | Every forecast row carries `method`, `model_version`, and an `inputs` blob sufficient to reproduce the window byte-for-byte |
| T26 | e2e | R27, R28 | Screen sweep across calendar, detail, and notification: no `d MMM` date string and no countdown renders anywhere; snapshot-asserted |
| T27 | unit | R28 | `formatHarvestWindow()` fixture: 40 windows → thirds-of-month strings, including cross-month and cross-year |
| T28 | e2e | R29, R30, R31 | Confidence text present in every state; low-confidence copy names the missing input; corrected forecasts state the adjustment |
| T29 | e2e | R32 | The prompt appears once when the window opens and not again for 14 days |
| T30 | e2e | R33 | A harvest 30 days outside the band produces the neutral copy and no error, banner, or apology |
| T31 | integration | R34 | Both-null and both-set targets are rejected by the `CHECK` |
| T32 | integration | R35 | `set_surplus_subscription` has no lat/lng parameter; the origin cell equals `profiles.home_h3_r7` or the spot's r7 parent |
| T33 | rls | R36 | `SELECT center_h3_r7` and `SELECT cell_set` as `authenticated` raise 42501; the columns are absent from `surplus_subscription_cards` |
| T34 | unit | R37 | Each of the five radii maps to its fixed `k`; a sixth value is rejected |
| T35 | integration | R38 | A listing matches only through its safe spots' r7 parents; a listing whose owner's garden cell is inside `cell_set` but whose spots are not does **not** match |
| T36 | integration | R39 | Suspended owner, expired listing, blocked pair, and deleted owner each produce zero matches |
| T37 | integration | R40 | The subscriber's own listing never matches |
| T38 | integration | R41 | 11th subscription returns `quota_exceeded` 422 |
| T39 | integration | R42 | Every alert path writes exactly one `notifications` row and one outbox row in the same transaction; no other push path exists |
| T40 | integration | R43 | 12 matches across 5 species in one run produce exactly one notification naming three species and a count |
| T41 | integration | R44 | 4th alert in 24 h is not sent and **no** inbox row is written; the 25th hour allows one again |
| T42 | integration | R45 | A listing active across 20 matcher runs is alerted exactly once per subscription |
| T43 | integration | R46 | A user with no preferences row receives no surplus push; quiet hours suppress it |
| T44 | e2e | R47 | With location permission denied and `home_h3_r7` null, a subscription is created via the safe-spot origin |
| T45 | e2e | R49, R50 | Plan tab reachable in one tap; airplane mode renders the cached calendar with "as of" labels |
| T46 | e2e | R51 | A brand-new, unverified, garden-unverified account creates a planting and sees a forecast |
| T47 | integration | R52 | Forcing `last_success` 49 hours back renders the staleness banner |
| T48 | e2e | R54 | With `harvest.forecasts_enabled` off: no windows render; plantings, editing, and `record_harvest` all still work |
| T49 | integration | R55 | The calibration query produces residual and hit-rate series by confidence over a seeded season |
| T50 | perf | R24, R48 | Nightly recompute of 250,000 active plantings completes under 5 minutes; a matcher run over 50,000 subscriptions completes under 20 s |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T51 | `GET /rest/v1/plantings` as a second authenticated user | Empty set. Not a 403 — no existence oracle |
| T52 | `GET /rest/v1/plantings?id=eq.<real id>` belonging to another user | Empty set, indistinguishable from a random UUID |
| T53 | `PATCH /rest/v1/harvest_forecasts` widening a window, as its owner | 403 — no UPDATE policy on the table at all (R13) |
| T54 | `POST /rest/v1/harvest_forecasts` fabricating a forecast | 403 — no INSERT policy |
| T55 | `POST /rest/v1/surplus_alert_subscriptions` directly, supplying `center_h3_r7` and `cell_set` | 403 — no INSERT policy; origin derivation is RPC-only (R35) |
| T56 | `PATCH` a subscription's `center_h3_r7`, `cell_set`, or `radius_km` | `guard_subscription_columns` raises 42501; only `is_paused` is writable |
| T57 | `SELECT center_h3_r7 FROM surplus_alert_subscriptions WHERE user_id = auth.uid()` | 42501 from the column `REVOKE`, even for one's own row (R36) |
| T58 | Call `set_surplus_subscription` with extra `p_lat` / `p_lng` / `p_geohash` arguments | Function signature does not accept them; PostgREST returns `404 function not found`. Asserted so that adding one later is a visible signature change |
| T59 | Create 10 subscriptions with 5 radii around 2 origins and diff the match sets to localize a listing | Every matched cell resolves to an `active` safe spot present in `safe_spots_near`'s public output; no cell traces to a garden. The test asserts the *set of distinguishable outcomes* equals the set of public safe spots in range |
| T60 | Contract sweep for coordinate columns across `plantings`, `harvest_forecasts`, `surplus_alert_subscriptions`, `surplus_subscription_cards`, `grow_zone_offsets`, and all five RPC return types | Zero hits (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)); nothing added to the two-entry allowlist |
| T61 | Insert a forecast (as `service_role`) whose `inputs` contains `{"lat": …}` | `harvest_forecasts_no_coords` CHECK rejects it, mirroring LP-11 |
| T62 | Fire a synthetic Sentry event carrying a `bed_label` and a planting note | Both scrubbed from the payload (LP-08 pattern extended) |
| T63 | Subscribe with a species, then have a **blocked** user list it 200 m from the origin spot | No notification, no `surplus_alert_sends` row, no inbox row |
| T64 | Call `record_harvest` for another user's planting id | `not_found` 404 from the function's own first-statement check, not from RLS — the function is `SECURITY DEFINER` ([RLS Design §7](../01-architecture/05-rls-design.md)) |
| T65 | Call `upsert_planting` as a **suspended** user | Rejected on an explicit `is_suspended` check. `app.can_transact()` is deliberately **not** the gate (R51) — an unverified user must still be able to plan |
| T66 | Replay `record_harvest` with the same idempotency key 50 times | Exactly one `inventory_items` row; 50 successful responses (EC-06) |
| T67 | Script 500 `set_surplus_subscription` calls in a minute | 20 succeed within the day's bucket, the rest `rate_limited` 429 with integer `Retry-After`; the 10-subscription cap engages independently |
| T68 | Craft a matcher run where one subscription matches 5,000 listings | One notification; the `sends` insert is batched; the run stays inside its 20 s budget; no unbounded array is built in memory |
| T69 | Delete a user's account with 40 plantings, 3 subscriptions, and 200 forecast rows | All cascade; `private.surplus_alert_sends` cascades; `inventory_items.planting_id` nulls rather than deleting items ([Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md)) |
| T70 | SQL injection payload in `bed_label` and `notes` | Stored and rendered as literal text; parameterized throughout |

### 13.3 Manual QA

- [ ] Log a real planting in a real garden, wait for the window, and record the harvest. Compare the residual against your own memory of the season.
- [ ] Confirm no screen anywhere renders a single harvest date, including notification previews on both lock screens.
- [ ] Set up an alert with notifications denied at OS level; confirm the subscription saves and the inbox still fills.
- [ ] Set up four alerts likely to fire in the same run; confirm exactly one notification arrives.
- [ ] Force 4 alerts in 24 hours; confirm the 4th produces neither a push nor an inbox row.
- [ ] Read the low-confidence copy aloud to someone who has not seen the feature and ask them what the app is promising. If they say a date, the copy has failed.
- [ ] VoiceOver and TalkBack over the calendar, the window-opened prompt, and the radius radio group at 200% type.
- [ ] Confirm in a network trace that no request in this feature carries a latitude, longitude, or an H3 cell finer than r7.
- [ ] Turn `harvest.forecasts_enabled` off on a populated account and confirm nothing else breaks.

## 14. Rollout

| Field | Value |
| --- | --- |
| Status | **Not built.** Phase 2, Approved, specified only. The three tables ship as empty stubs in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)) so that Phase 2 is additive. |
| Feature flag | Two. `harvest.planning_enabled` gates the plan tab and all planting RPCs. `harvest.forecasts_enabled` gates forecast computation and rendering independently (R54), because the forecast is the part most likely to need switching off after a bad season, and the notebook has standalone value. `surplus.alerts_enabled` gates the matcher cron and the alerts screen. |
| Migration required | Yes — `20261102_0090_harvest_planning.sql`: two enums, three table bodies over the MVP stubs, one reference table, one view, one private ledger, four new columns on existing tables, eleven indexes, ten functions, two cron jobs. Additive only. **One tension to resolve before merge:** this spec assumes `notification_kind` already contains `surplus_alert` (it does, [Data Model §4](../01-architecture/03-data-model.md#4-enums)), so no `ALTER TYPE` is needed — if a future harvest-reminder push is added it *will* need one, and [Data Model §15.3](../01-architecture/03-data-model.md#15-migration-rules) currently treats every `ALTER TYPE` as destructive. See [Q6](#15-open-questions). |
| Backfill required | Yes, of curated data rather than user data: `crop_species.days_to_maturity` for the top 120 species by expected planting volume, and `grow_zone_offsets` for USDA zones 3a–10b. Species left null are handled by R19/R20 and surface in `harvest.forecast_absent`. No user-row backfill exists, because there are no plantings until the feature ships. |
| Rollback plan | Flip `harvest.forecasts_enabled` off first — it removes every window from the UI while leaving user data intact, and it is the failure most likely to be about quality rather than correctness. `harvest.planning_enabled` off hides the tab and leaves rows in place. `surplus.alerts_enabled` off unschedules the matcher; existing subscriptions become inert and are not deleted. The migration is forward-only ([Data Model §15](../01-architecture/03-data-model.md#15-migration-rules)); a bad `days_to_maturity` value is fixed by a data migration plus a forced recompute, never by restoring a snapshot. |
| Client version floor | The Phase 2 minimum client. An older client that never calls these RPCs is unaffected; the plan tab is absent rather than broken. |
| Dependency amendment required | [SPEC-005 R35](SPEC-005-crop-taxonomy.md)'s species-merge transaction **must** be extended to repoint `plantings.species_id` and `plantings.variety_id` (EC-07). That is a change to an Approved MVP spec and needs its own version bump, not a note here. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Is a 3-per-24-h surplus cap right? Too low and the feature never earns a habit; too high and it burns the notification channel every other spec depends on. The honest answer needs `surplus.capped` and `notification.opt_out_after_surplus` from a real season, and we must pick a number before we have either. | Product | Before Phase 2 build |
| Q2 | Where does `days_to_maturity` come from? Seed-packet values are variety-specific, optimistic, and copyrighted in aggregate; extension-service data is public but coarse and US-centric. Curating 120 species by hand is a week of work that never finishes. | Product + Platform | Before the maturity backfill |
| Q3 | Should a window ever narrow below 10 days for a user with 8+ consistent seasons of the same crop? R18's floor is currently absolute. Narrowing rewards the users giving us the best data and increases the blast radius of being wrong for exactly them. | Product | After the first full season |
| Q4 | Should the matcher consider `listings.wanted_species_ids` — alerting only when the lister wants something the subscriber actually has? It would raise the request rate and make the alert feel like a match rather than a broadcast, at the cost of a join against the subscriber's inventory inside a cron job that already has a 20 s budget. | Product + Backend | Post-launch |
| Q5 | Southern hemisphere and non-USDA zones (EC-15). `season_months` and `grow_zone_offsets` are both Northern/US artefacts. Fixing this properly means a hemisphere or climate-classification dimension on species seasonality, which is a taxonomy schema change ([SPEC-005 Q5](SPEC-005-crop-taxonomy.md)). | Architecture + Product | Before any non-North-American metro |
| Q6 | [Data Model §15.3](../01-architecture/03-data-model.md#15-migration-rules) treats `ALTER TYPE` as destructive, but `ALTER TYPE … ADD VALUE` is additive and is the normal way to add a `notification_kind`. Does the CI rule need a carve-out, or do we accept that every new notification kind is a gated migration? | Architecture | Before any spec adds a notification kind |
| Q7 | Do we surface forecast accuracy to users — "we've been getting your tomatoes right within a week" — or keep it internal? Publishing it is maximally honest and invites a fixation on a metric that is noisy at n = 4. | Product | After the first full season |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product + Backend Engineering | Initial spec |
