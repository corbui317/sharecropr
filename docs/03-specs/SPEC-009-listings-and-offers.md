# SPEC-009: Listings & Offers

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.1 |
| **Owner** | Backend Engineering |
| **Phase** | MVP |
| **Security review** | not required |
| **Schema depends on** | [SPEC-006](SPEC-006-crop-inventory.md), [SPEC-007](SPEC-007-safe-spots.md) |
| **Behaviourally coupled with** | SPEC-008, SPEC-010, SPEC-012 (block-aware discoverability), SPEC-013, SPEC-023 (disclosure on publish) |
| **Related ADRs** | [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md), [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

A listing is the deliberate act that turns a private inventory item into supply: one item, published to **one to three curated safe spots**, with a title, an optional description, an optional wishlist of up to ten species the owner is hoping for, and an expiry window that defaults to 7 days and can never exceed 21. It is the only mechanism by which anything a user owns becomes visible to anyone else, and it is the join between [SPEC-006](SPEC-006-crop-inventory.md)'s inventory and [SPEC-010](SPEC-010-exchange-lifecycle.md)'s exchange. Its two hardest obligations are integrity — one item can back exactly one live listing, enforced by a partial unique index rather than by a check the client performs — and honesty about time, because a marketplace full of things that rotted a fortnight ago is worse than an empty one.

## 2. Goals

- Make publishing feel like a decision: a separate screen, a deliberate act, a clear statement of who will see it and where they will meet you.
- Guarantee that one inventory item can never back two live listings, at the database level, under concurrency.
- Make expiry real and automatic, so the map reflects what exists rather than what once existed — and make it never, under any circumstance, touch a reserved row.
- Keep the safe-spot cardinality at 1–3 and enforce it in the database, because it is simultaneously a usability rule and the bound on a location-inference channel.
- Give a listing enough structure (species, wishlist, `accepts_any`) to drive match suggestions, without building a recommendation engine.
- Make visibility a single policy — `listings_select_discoverable` — so there is exactly one place to reason about who sees what.
- Be precise about the asymmetry between what an owner sees and what a requester sees, because most of what an owner knows about their own listing is information a requester must not have.

## 3. Non-Goals

- **Price, currency, bidding, or any monetary field.** There is no column and adding one requires an ADR and legal review ([ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md), [Data Model §1](../01-architecture/03-data-model.md)). "Or best offer" is a price.
- **The exchange itself.** Requests, acceptance, scheduling, handoff codes, and completion are [SPEC-010](SPEC-010-exchange-lifecycle.md). This spec's job ends the moment `accept_exchange_request` fires.
- **Multi-item listings, bundles, or lots.** One listing, one item (R01). "Three courgettes and a marrow" is three listings or one item with a custom label. Bundles multiply every concurrency problem in [Exchange State Machine §5](../01-architecture/07-exchange-state-machine.md) by the bundle size.
- **Delivery, shipping, porch pickup, or meeting anywhere that is not a curated safe spot** ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [PRD §1](../00-foundation/02-prd.md)). There is no free-text location field on a listing, and that absence is a safety property.
- **Boosting, promotion, or paid placement.** No money, and no ranking lever a user can pull.
- **Saved searches and "notify me when tomatoes appear".** [SPEC-020](SPEC-020-harvest-planning.md) surplus alerts. `wanted_species_ids` is a property of a listing the owner already published, not a standing subscription.
- **Automatic matching that sends a request on the user's behalf.** Suggestions are suggestions (R27). An app that auto-requests on your behalf arranges a meeting you did not agree to.
- **Renewing a listing in place.** An expired listing is history; relisting creates a new row with a new expiry (R37). Extending in place makes "published 40 days ago, still says 3 days left" possible, which is a lie with a countdown on it.
- **Public, unauthenticated listing pages.** A listing is readable by `authenticated` only. A shareable web URL for produce is a scraping surface and an SEO liability we have no product need for.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener with surplus**, I want to publish an item to the library near me so that someone can come and take it. | P0 |
| US-02 | As a **gardener**, I want to offer at two or three places so that I'm not tied to one building's opening hours. | P0 |
| US-03 | As a **gardener**, I want to say what I'm hoping for in return, so that I get offered basil rather than more courgettes. | P0 |
| US-04 | As a **gardener who isn't fussy**, I want to say I'll take anything, because most of the time I just want the food used. | P0 |
| US-05 | As a **gardener**, I want my listing to disappear by itself when the produce would have gone off, so I'm not fielding requests for compost. | P0 |
| US-06 | As a **gardener**, I want to withdraw a listing the moment my neighbour takes the lot, without waiting for anything. | P0 |
| US-07 | As a **requester**, I want to see quantity, condition, how old it is, and where I'd collect it, before I ask. | P0 |
| US-08 | As a **requester**, I want to know how long a listing has left, so I know whether it's worth asking. | P1 |
| US-09 | As a **gardener**, I want to be shown people who want what I have and have what I want, so the first exchange is easy. | P1 |
| US-10 | As a **gardener**, I want to be told my listing expired rather than quietly discovering it's gone. | P0 |
| US-11 | As a **gardener**, I want it to be impossible to accidentally promise the same box of tomatoes to two people. | P0 |
| US-12 | As a **requester**, I want a reserved listing to say so, rather than letting me ask for something already spoken for. | P0 |
| US-13 | As a **gardener whose library closed for renovation**, I want to move my listing to another spot without republishing. | P1 |
| US-14 | As a **screen-reader user**, I want a listing read as one coherent sentence including where and by when. | P0 |

## 5. Functional Requirements

### 5.1 Composing and publishing

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | A listing MUST reference exactly one `inventory_item_id`, NOT NULL, owned by the same user as `listings.owner_id`. |
| R02 | **MUST** | Publishing MUST require `app.can_transact()` — identity verified, garden verified, not suspended ([RLS Design §3](../01-architecture/05-rls-design.md)). Browsing and inventory are never gated on this ([SPEC-006 R12](SPEC-006-crop-inventory.md)); publishing always is. |
| R03 | **MUST** | Publishing MUST be atomic across `listings`, `listing_safe_spots`, and `inventory_items`, and MUST therefore go through `rpc.publish_listing`. It spans three tables and its legality depends on the state of a row in another table, which is decision rule R5 in [API Contract §1.1](../01-architecture/06-api-contract.md). |
| R04 | **MUST** | `title` MUST be 3–80 characters (`CHECK`), pre-filled from the item's composed title ([SPEC-006 R18](SPEC-006-crop-inventory.md)) and editable. |
| R05 | **MUST** | `description` MUST be ≤ 500 characters (`CHECK`) and optional. This is the **public** text; the owner's private note lives elsewhere and is never published ([SPEC-006 R09](SPEC-006-crop-inventory.md)). |
| R06 | **MUST** | `species_id` MUST be denormalized from the inventory item **inside** `publish_listing` and MUST NOT be accepted from the client. A client-supplied species is a listing that claims to be tomatoes and delivers a marrow. |
| R07 | **MUST** | A `draft` listing MUST be invisible to everyone but its owner. Only `active` and `reserved` are discoverable. |
| R08 | **MUST** | Publishing an item whose `inventory_status` is not `available` MUST fail with `conflict` 409, checked inside the lock. |
| R09 | **MUST** | A user MUST NOT hold more than **25 active listings**; the 26th returns `quota_exceeded` 422. This is an anti-spam bound, not a product ceiling — the 99th percentile real gardener is nowhere near it. |
| R10 | **MUST** | Publishing MUST, in one transaction: set `status = 'active'` and `published_at = now()`, attach 1–3 safe spots, and move the inventory item from `available` to `listed`. |
| R11 | **MUST NOT** | A listing MUST NOT carry a price, currency, monetary value, or any field that encodes one. No such column exists, and the UI has no numeric field other than the item's quantity. |
| R12 | **MUST** | A `PATCH` on an `active` listing MUST be limited to `title`, `description`, `wanted_species_ids`, and `accepts_any`. `listings_update_own` already restricts to `status IN ('draft','active')`; the column restriction is enforced by a trigger, because PostgREST will happily accept any column the role can write. |
| R13 | **MUST** | Changing the safe-spot set on an `active` listing MUST go through `rpc.set_listing_safe_spots`, which re-checks cardinality and spot status. Changing the **item** or the **expiry window** is not an edit: it is withdraw and republish (§3). |

### 5.2 Safe spot attachment

| ID | Req | Statement |
| --- | --- | --- |
| R14 | **MUST** | A discoverable listing MUST be attached to **at least 1 and at most 3** safe spots ([PRD C9](../00-foundation/02-prd.md)). |
| R15 | **MUST** | Cardinality MUST be enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger evaluated at commit, on both `listing_safe_spots` and `listings`. An immediate trigger makes a legal three-row insert illegal after the first row, which is how cardinality triggers get quietly disabled. |
| R16 | **MUST** | Every attached spot MUST have `safe_spots.status = 'active'` at attach time, checked inside the RPC. |
| R17 | **MUST** | The spot picker MUST order candidates by distance from the user's **quantized** position ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)) and MUST show today's hours plus the staleness note when `hours_verified_at` is older than 90 days ([SPEC-007 §5.4](SPEC-007-safe-spots.md)). |
| R18 | **MUST** | Three is a hard cap, and the reason is not tidiness. An attacker who watches a listing knows the owner is willing to travel to *each* of its spots, so the plausible home region is roughly the **intersection** of those neighbourhoods — and every additional spot tightens it. Three keeps that region at a few square kilometres, which is the accepted residual in [Location Privacy §12.4](../01-architecture/04-location-privacy.md). Ten would make a listing a locator. |
| R19 | **MUST** | When a safe spot is suspended, its attachments MUST be removed and any listing left with zero spots MUST be withdrawn, with the owner notified ([SPEC-007 R28](SPEC-007-safe-spots.md)). A listing whose only meeting place no longer exists is a no-show with a countdown. |
| R20 | **SHOULD** | The picker SHOULD pre-select the nearest active spot within 8 km, and SHOULD NOT pre-select anything if the nearest is further. Pre-selecting a 30 km library is how a rural user ends up agreeing to a drive they never read. |

### 5.3 Wishlist and match suggestions

| ID | Req | Statement |
| --- | --- | --- |
| R21 | **MUST** | `wanted_species_ids` MUST hold at most **10** entries, enforced by `CHECK (COALESCE(array_length(wanted_species_ids,1),0) <= 10)`. |
| R22 | **MUST** | `accepts_any` defaults to `true`. A listing with `accepts_any = false` **and** an empty wishlist MUST be rejected by `CHECK` — it accepts nothing, and publishing it is a listing that cannot be transacted against. |
| R23 | **MUST** | Wishlist entries MUST be species ids chosen through the picker ([SPEC-005](SPEC-005-crop-taxonomy.md)). There is no text path. |
| R24 | **MUST** | Match suggestions MUST come from `rpc.suggest_matches`, ranked in this order: (1) **mutual** want — they have what I want and want what I have, (2) one-way want, (3) shares at least one safe spot with my listing, (4) distance from the nearest shared or nearest attached spot, (5) `published_at DESC`. |
| R25 | **MUST** | Suggestions MUST be capped at 20 and MUST apply the same filters as ordinary discovery: block either way, owner suspended or deleted, expired, and `status IN ('active')`. A `reserved` listing is never suggested. |
| R26 | **MUST NOT** | A suggestion MUST NOT reveal any field a normal discovery read would not, and MUST NOT reveal *that* a match exists to the other party. Suggestions are computed for the caller, returned to the caller, and stored nowhere. |
| R27 | **MUST NOT** | A suggestion MUST NOT send a request, pre-fill a commitment, or create any row. It is a link to a listing detail with a request button on it, and the human presses it. |
| R28 | **SHOULD** | Suggestions SHOULD appear on the owner's own listing detail and in a "Matches" section of the Exchanges tab, and SHOULD be absent entirely when there are none, rather than rendering an empty shelf. |

### 5.4 Expiry

| ID | Req | Statement |
| --- | --- | --- |
| R29 | **MUST** | `expires_at` MUST default to `now() + interval '7 days'` and MUST satisfy `expires_at > created_at AND expires_at <= created_at + interval '21 days'` (`CHECK`) ([PRD C9](../00-foundation/02-prd.md)). |
| R30 | **MUST** | The client MUST offer discrete windows — **3, 7, 14, 21 days** — and MUST NOT present a free date picker. A date picker invites "December 2027" and then a `CHECK` violation the user cannot interpret. |
| R31 | **MUST** | Expiry MUST also be enforced in the read policy (`expires_at > now()` inside `listings_select_discoverable`), so that a cron outage degrades to "the row is still `active` in the table" rather than to "expired listings are discoverable". The cron is the tidy-up; the policy is the guarantee. |
| R32 | **MUST** | The `expire_listings` job MUST run every 5 minutes and MUST select **only** `status = 'active' AND expires_at <= now()`. |
| R33 | **MUST NOT** | The expiry job MUST NOT touch a `reserved` row under any circumstance. This is hazard H8 in [Exchange State Machine §5](../01-architecture/07-exchange-state-machine.md): the `status = 'active'` predicate is what makes a row that just became `reserved` invisible to the sweeper, and it is the reason `accept_exchange_request` can re-check `expires_at` inside its lock and be right. |
| R34 | **MUST** | Expiry MUST release the inventory item from `listed` to `available` in the same transaction. An expired listing whose item is stuck in `listed` is an item its owner cannot republish and cannot explain. |
| R35 | **MUST** | The job MUST process in bounded batches of **500** with `FOR UPDATE SKIP LOCKED`, so a backlog cannot hold locks across a long transaction and cannot collide with an in-flight acceptance. |
| R36 | **MUST** | Expiry MUST write an in-app inbox notification and, subject to preferences and quiet hours, a push ([Realtime & Notifications §3](../01-architecture/08-realtime-and-notifications.md)). Supply that vanishes silently is supply the owner never re-lists. |
| R37 | **SHOULD** | An expired listing SHOULD offer one-tap relist, which creates a **new** listing with a fresh expiry, provided the item is still `available`. It MUST NOT mutate the expired row. |

### 5.5 Withdrawal and status

| ID | Req | Statement |
| --- | --- | --- |
| R38 | **MUST** | The owner MUST be able to withdraw an `active` listing at any time before a request is accepted, via `rpc.withdraw_listing` ([PRD C9](../00-foundation/02-prd.md)). |
| R39 | **MUST NOT** | A `reserved` listing MUST NOT be withdrawable. The exit from a reservation is `cancel_session`, which is a real action with a real consequence for the counterparty and for `cancellation_count_90d` ([SPEC-010](SPEC-010-exchange-lifecycle.md)). |
| R40 | **MUST** | Withdrawal MUST, in one transaction: set `status = 'withdrawn'` and `withdrawn_at`, release the item to `available`, cancel every `pending` request against the listing, and notify each affected requester. |
| R41 | **MUST** | The listing status set is exactly `draft`, `active`, `reserved`, `completed`, `withdrawn`, `expired`, with the transitions in §6.1 and no others. |
| R42 | **MUST** | `reserved` MUST be set only by `accept_exchange_request` and `completed` only by `confirm_handoff`. Neither is reachable from any client write path; `listings` has no UPDATE policy covering those statuses ([RLS Design §5 Pattern D](../01-architecture/05-rls-design.md)). |
| R43 | **MUST** | A `withdrawn`, `expired`, or `completed` listing MUST remain readable by its owner as history and MUST be invisible to everyone else, which falls out of the policy's owner-or-discoverable shape rather than needing its own rule. |
| R44 | **MUST NOT** | Withdrawal MUST NOT be usable to escape an accepted exchange. R39 is the mechanism; this is the statement of intent, so nobody "improves" R39 into an unlock. |
| R45 | **SHOULD** | The withdraw confirmation SHOULD state how many pending requests will be cancelled, by number. "Withdraw" and "Withdraw, cancelling 3 requests" are different decisions. |

### 5.6 Visibility — what a requester sees, and what the owner sees

| ID | Req | Statement |
| --- | --- | --- |
| R46 | **MUST** | Discovery MUST be governed by `listings_select_discoverable` and by nothing else. No client-side filter, no repository-level `WHERE`, and no Edge Function may be the thing that hides a listing. |
| R47 | **MUST** | The policy MUST be exactly Pattern D: `owner_id = auth.uid()` **OR** (`status IN ('active','reserved')` AND `expires_at > now()` AND NOT `app.is_blocked_either_way(auth.uid(), owner_id)` AND the owner is neither suspended nor deleted) ([RLS Design §5](../01-architecture/05-rls-design.md)). |
| R48 | **MUST** | A `reserved` listing MUST remain visible and MUST render as unavailable, with no request affordance and a clear label. Removing it outright makes a listing someone was reading vanish mid-scroll, which reads as a bug; leaving the button live produces a 409 the user cannot interpret. |
| R49 | **MUST** | A requester's view MUST show: title, description, species and (approved) variety, quantity + unit, condition, harvest date, best-by, the organic claim **labelled as a claim** ([SPEC-006 R08](SPEC-006-crop-inventory.md)), photos, the 1–3 safe spots with name, category, distance, and today's hours, the owner's `profile_cards` row, and the time remaining. |
| R50 | **MUST NOT** | A requester's view MUST NOT show: the owner's private note, `reserved_request_id`, the number of pending requests, the identity of any other requester, a view count, `trust_score` or `cancellation_count_90d`, the owner's garden, `home_coarse_cell`, or any coordinate other than the safe spots' own public points. |
| R51 | **MUST** | The owner's view MUST additionally show: pending request count and the requester list, withdraw, edit, spot editing, the expiry countdown with relist, and match suggestions. |
| R52 | **MUST NOT** | A requester MUST NOT be able to distinguish "declined", "expired", "withdrawn", and "the owner blocked me" from the listing's disappearance alone. The blocked case in particular MUST be silent ([SPEC-012](SPEC-012-trust-and-safety.md)); a block that announces itself is a known harassment escalation. |
| R53 | **MUST** | A listing whose owner becomes suspended MUST leave every result set immediately — detail reads, search, and the map count aggregate on its next query ([SPEC-008 §7.1](SPEC-008-interactive-map.md)). The suspension clause lives inside the policy and inside `safe_spots_near`, so there is no cached path that survives it beyond one `staleTime`. |
| R54 | **MUST** | Listing detail MUST be a route (`/(modals)/listing/[listingId]`) so a deep link, a map sheet row, a search result, and a match suggestion all land in the same place. The router MUST resolve after a `fetchQuery` and land on the tab root with a toast when the listing is no longer readable ([Mobile Architecture §3.1](../01-architecture/02-mobile-architecture.md)). |
| R55 | **MUST** | Expiry MUST be shown as remaining time — "3 days left", "expires tomorrow", "expires in 4 hours" — never a raw timestamp, and never a bare date the reader has to subtract from today. |
| R56 | **SHOULD** | A listing SHOULD carry a "New" affordance for 24 hours after `published_at`, which is the cheapest available freshness signal in a market with no other liquidity cue. |

### 5.7 Concurrency and integrity

| ID | Req | Statement |
| --- | --- | --- |
| R57 | **MUST** | `listings_one_active_per_item` — `CREATE UNIQUE INDEX ... ON public.listings (inventory_item_id) WHERE status IN ('draft','active','reserved')` — MUST exist and MUST be the enforcement of inventory double-commit (hazard H2, [Exchange State Machine §5](../01-architecture/07-exchange-state-machine.md)). |
| R58 | **MUST** | The client's "this item is already listed" check is a courtesy that avoids a round trip. It MUST NOT be described, tested, or relied upon as the control; the index is the control, and it holds against two devices, two tabs, and a replayed mutation. |
| R59 | **MUST** | `listings_single_reservation` ([Data Model §10](../01-architecture/03-data-model.md)) remains the reservation backstop for hazard H1. Nothing in this spec may weaken it, and `withdraw_listing` MUST NOT be able to move a row out of `reserved`. |
| R60 | **MUST** | Every mutating RPC in this spec MUST take `p_idempotency_key uuid` and MUST return the original result on replay, not a 409 ([API Contract §3.1](../01-architecture/06-api-contract.md)). |
| R61 | **MUST** | `publish_listing` MUST take `FOR UPDATE` on the inventory item before inserting the listing, and MUST respect the global lock order `listings → exchange_requests → exchange_sessions` ([Exchange State Machine §5 H7](../01-architecture/07-exchange-state-machine.md)). |
| R62 | **MUST NOT** | There MUST NOT exist a moment at which a discoverable listing has zero safe spots. R15's deferred trigger fires at commit, so the window does not exist outside the transaction — and a listing with nowhere to meet is worse than no listing. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.listings`](../01-architecture/03-data-model.md#10-listings--the-exchange) | read (Pattern D) / write (owner, draft + limited fields) / write (definer, all transitions) | The spec's subject |
| `public.listing_safe_spots` | write (definer) / read | 1–3 rows per discoverable listing, deferred trigger (R15) |
| `public.inventory_items` | read (owner + `app.is_inventory_counterparty`) / write (definer, status only) | Status flips on publish, withdraw, expire ([SPEC-006 §6.1](SPEC-006-crop-inventory.md)) |
| `public.safe_spots` | read | Attachment candidates; `status = 'active'` required (R16) |
| `public.exchange_requests` | read + write (definer, on withdrawal) | R40 cancels pending requests |
| `public.profile_cards` | read | The owner block on the requester's view (R49) |
| `public.blocks` | read (inside `app.is_blocked_either_way`, definer) | Inside the policy, so blocked listings never enter the result set |
| `public.notifications` / `private.notification_outbox` | write via `app.enqueue_notification` | R36, R40, R19 |
| `audit.events` | write | Publish, withdraw, and expiry-by-cron are audited as listing lifecycle events |
| `private.garden_locations` | **none** | Named to be explicit: a listing has no coordinate of its own. Its geography is entirely borrowed from the safe spots it attaches to |

**New schema objects introduced by this spec:** migration `20260808_0091_listing_publication.sql`

```sql
-- H2: inventory double-commit. THIS INDEX is the control (R57).
CREATE UNIQUE INDEX listings_one_active_per_item
  ON public.listings (inventory_item_id)
  WHERE status IN ('draft','active','reserved');

ALTER TABLE public.listings
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN expired_at   timestamptz,
  ADD CONSTRAINT listings_expiry_window CHECK (
        expires_at > created_at
    AND expires_at <= created_at + interval '21 days'),
  ADD CONSTRAINT listings_wanted_cap CHECK (
        COALESCE(array_length(wanted_species_ids, 1), 0) <= 10),
  -- A listing that accepts nothing is not a listing (R22).
  ADD CONSTRAINT listings_accepts_something CHECK (
        accepts_any OR COALESCE(array_length(wanted_species_ids, 1), 0) >= 1);

CREATE INDEX listings_wanted_gin ON public.listings USING GIN (wanted_species_ids)
  WHERE status = 'active';
CREATE INDEX listings_owner_active_idx ON public.listings (owner_id)
  WHERE status = 'active';
CREATE INDEX listings_inventory_item_idx ON public.listings (inventory_item_id);
```

Cardinality, deferred to commit (R15, R62):

```sql
CREATE OR REPLACE FUNCTION public.assert_listing_spot_cardinality(p_listing uuid)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_status listing_status; v_n int;
BEGIN
  SELECT status INTO v_status FROM public.listings WHERE id = p_listing;
  IF v_status IS NULL OR v_status = 'draft' THEN RETURN; END IF;   -- drafts may be empty
  SELECT count(*) INTO v_n FROM public.listing_safe_spots WHERE listing_id = p_listing;
  IF v_n < 1 OR v_n > 3 THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'P0001';
  END IF;
END; $$;

CREATE CONSTRAINT TRIGGER trg_listing_spots_cardinality
AFTER INSERT OR DELETE ON public.listing_safe_spots
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.trg_assert_cardinality_from_join();

CREATE CONSTRAINT TRIGGER trg_listing_has_spots
AFTER INSERT OR UPDATE OF status ON public.listings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.status IN ('active','reserved'))
EXECUTE FUNCTION public.trg_assert_cardinality_from_listing();
```

> Two triggers, not one, because the two ways to violate cardinality are opposite: deleting the last spot from a live listing, and flipping a spotless listing to `active`. Deferring both to commit is what makes a three-row insert legal while never permitting a committed violation.

Column restriction on client PATCH (R12):

```sql
CREATE OR REPLACE FUNCTION public.guard_listing_client_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;   -- definer RPCs pass
  IF ROW(NEW.inventory_item_id, NEW.owner_id, NEW.species_id, NEW.status,
         NEW.expires_at, NEW.published_at, NEW.reserved_request_id,
         NEW.withdrawn_at, NEW.expired_at)
     IS DISTINCT FROM
     ROW(OLD.inventory_item_id, OLD.owner_id, OLD.species_id, OLD.status,
         OLD.expires_at, OLD.published_at, OLD.reserved_request_id,
         OLD.withdrawn_at, OLD.expired_at) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
```

Auto-expiry (R32–R36):

```sql
CREATE OR REPLACE FUNCTION app.expire_due_listings(p_batch int DEFAULT 500)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_row record; v_n int := 0;
BEGIN
  FOR v_row IN
    SELECT id, owner_id, inventory_item_id, title
      FROM public.listings
     WHERE status = 'active'          -- NEVER 'reserved'. This predicate is H8's control (R33).
       AND expires_at <= now()
     ORDER BY expires_at
     LIMIT p_batch
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.listings
       SET status = 'expired', expired_at = now(), updated_at = now()
     WHERE id = v_row.id;

    UPDATE public.inventory_items
       SET status = 'available', updated_at = now()
     WHERE id = v_row.inventory_item_id AND status = 'listed';   -- R34

    PERFORM app.enqueue_notification(v_row.owner_id, 'exchange_reminder',
              jsonb_build_object('listing_id', v_row.id, 'kind', 'listing_expired'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END; $$;

SELECT cron.schedule('expire_listings', '*/5 * * * *',
                     $$SELECT app.expire_due_listings(500);$$);
```

Also introduced: RPCs `publish_listing`, `withdraw_listing`, `set_listing_safe_spots`, and `suggest_matches`; the route `/(modals)/listing/[listingId]` (R54); and a second `pg_cron` job `alert_stuck_listed_inventory` (daily) that reports items in `listed` with no live listing — a reconciliation check for R34, because the failure it catches is invisible to the owner and to every screen.

### 6.1 Listing status transitions

| From | To | Actor | Mechanism | Notes |
| --- | --- | --- | --- | --- |
| — | `draft` | Owner | `POST /rest/v1/listings` | Private, may have zero spots |
| `draft` | `active` | Owner | `rpc.publish_listing` | Requires `app.can_transact()`, 1–3 spots, item `available` |
| `active` | `reserved` | Lifecycle | `accept_exchange_request` | Sets `reserved_request_id`; `listings_single_reservation` is the backstop |
| `active` | `withdrawn` | Owner | `rpc.withdraw_listing` | Cancels pending requests (R40) |
| `active` | `expired` | System | `app.expire_due_listings` | Cron only; never touches `reserved` (R33) |
| `reserved` | `completed` | Lifecycle | `confirm_handoff`, both parties | Item becomes `exchanged` |
| `reserved` | `active` | Lifecycle | `cancel_session` | Item returns to `listed`; expiry is unchanged and may fire immediately |
| `reserved` | `withdrawn` | — | **Illegal** (R39, R44) | The exit is `cancel_session` |
| `completed` | — | — | Terminal | |
| `withdrawn` / `expired` | — | — | Terminal; relist creates a new row (R37) | |

**PII touched:** `listings` itself is **P2** — a title, a description, a species, and a set of public buildings. The sensitive combination is not on the row: it is the association between a listing's safe spots and its owner, which is the location-inference channel R18 bounds and [Location Privacy §12.4](../01-architecture/04-location-privacy.md) accepts as residual. `exchange_requests` rows touched by R40 carry **P1** participant identity and are written by a definer function that returns only a count. No **P0** column is read, written, or derivable by any path in this spec, and the `RETURNS TABLE` of every RPC here has no column capable of holding a coordinate.

## 7. API

### 7.1 `rpc.publish_listing`

**Auth:** `authenticated` + `app.can_transact()`
**Rate limit:** 20 / min / user (Postgres token bucket, shared with `listings` writes)

```jsonc
// Request
{ "p_listing_id": "4a2f9c11-…",
  "p_safe_spot_ids": ["3f2a9c11-…", "7b1e0c1c-…"],
  "p_expires_in_days": 7,
  "p_idempotency_key": "8f14e45f-…" }
```

```jsonc
// Response 200
{ "listing_id": "4a2f9c11-…", "status": "active",
  "published_at": "2026-08-08T14:31:02Z", "expires_at": "2026-08-15T14:31:02Z",
  "safe_spot_ids": ["3f2a9c11-…", "7b1e0c1c-…"], "inventory_status": "listed" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_verified` | 403 | `app.can_transact()` false — identity or garden unverified, or suspended |
| `not_authorized` | 403 | The listing or its inventory item is not the caller's |
| `conflict` | 409 | Item not `available` (R08), or `listings_one_active_per_item` violated (R57) |
| `quota_exceeded` | 422 | More than 3 safe spots, fewer than 1, more than 10 wanted species, `p_expires_in_days` > 21, or a 26th active listing (R09) |
| `validation_failed` | 400 | Title outside 3–80, description over 500, a safe spot that is not `active` (R16), `accepts_any = false` with an empty wishlist (R22) |
| `rate_limited` | 429 | Bucket empty; `Retry-After` integer seconds |

Ordering inside the function, which is the part that matters: re-check authorization → consume a rate token → `SELECT … FOR UPDATE` on the inventory item → assert `status = 'available'` → insert the spot rows → update the listing → update the item → enqueue nothing (publishing notifies nobody) → audit. The lock on the item is taken **before** the listing write (R61), so two concurrent publishes of the same item serialize on the item row and the loser fails the status assertion rather than racing the unique index.

### 7.2 `rpc.withdraw_listing`

**Auth:** `authenticated`, owner
**Rate limit:** 60 / hour / user

```jsonc
// Request
{ "p_listing_id": "4a2f9c11-…", "p_idempotency_key": "…" }
// Response 200
{ "listing_id": "4a2f9c11-…", "status": "withdrawn",
  "requests_cancelled": 3, "inventory_status": "available" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not the owner |
| `invalid_transition` | 409 | Listing is `reserved` (R39), `completed`, or already terminal |
| `request_not_found` | 404 | Unknown listing, or invisible under RLS |

`requests_cancelled` exists so the client can say "3 requests were cancelled" (R45). Deliberately available to the owner and to nobody else — the count of pending requests is exactly the kind of demand signal R50 keeps away from requesters. Withdrawal remains available to a user who has since lost `can_transact` (suspension, expired verification): you can always get *out* ([API Contract §5.4](../01-architecture/06-api-contract.md)).

### 7.3 `rpc.set_listing_safe_spots`

**Auth:** `authenticated`, owner
**Rate limit:** 20 / hour / user

```jsonc
// Request
{ "p_listing_id": "…", "p_safe_spot_ids": ["…","…","…"], "p_idempotency_key": "…" }
// Response 200
{ "listing_id": "…", "safe_spot_ids": ["…","…","…"] }
```

Replaces the whole set, inside one transaction, so the deferred cardinality trigger sees the final state and a legal 3 → 3 swap never transits through 0. Permitted while `active`; rejected while `reserved`, because the counterparty may already have agreed a place ([SPEC-010](SPEC-010-exchange-lifecycle.md)).

| Error code | HTTP | When |
| --- | --- | --- |
| `quota_exceeded` | 422 | Not 1–3 spots |
| `validation_failed` | 400 | A spot is not `status = 'active'` |
| `invalid_transition` | 409 | Listing is `reserved` or terminal |

### 7.4 `rpc.suggest_matches`

**Auth:** `authenticated`
**Rate limit:** 30 / min / user

```jsonc
// Request
{ "p_listing_id": "4a2f9c11-…", "p_lat": 42.281, "p_lng": -83.743,
  "p_radius_m": 8000, "p_limit": 20 }
```

```jsonc
// Response 200
[{ "listing_id": "9c1e3d0f-…", "title": "Genovese basil, big bunch",
   "species_id": 208, "match_kind": "mutual",
   "shares_safe_spot": true, "nearest_spot_distance_m": 612.4,
   "owner": { "handle": "annarborgrows", "display_name": "Priya",
              "trust_tier": "id_verified", "rating_avg": 4.83, "rating_count": 12 },
   "expires_at": "2026-08-14T13:02:11Z" }]
```

`p_lat`/`p_lng` are the caller's own position, quantized to ~100 m client-side before transmission, exactly as for `safe_spots_near` ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)). The `RETURNS TABLE` has no column capable of holding a garden coordinate; `nearest_spot_distance_m` is a distance to a **public building** and nothing else.

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | `p_listing_id` is not the caller's |
| `validation_failed` | 400 | Coordinates out of range, `p_limit` > 20 |
| `rate_limited` | 429 | Bucket empty |

### 7.5 `GET /rest/v1/listings`

Shape and select lists in [API Contract §4.5](../01-architecture/06-api-contract.md). Two things this spec constrains:

- The requester's select list is a **fixed constant** in `src/api/repositories/listings.ts`, not composed at the call site, so R50's exclusions cannot be widened by an innocent-looking `select=*` in a new screen. A lint rule fails any `listings` query whose select is not one of the two named constants.
- `reserved_request_id` is in neither constant. It is the pointer to a specific request and its only legitimate reader is the state machine.

### 7.6 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| A pending-request count to non-owners | R50. It is a demand signal that invites gaming and tells a requester how much competition they have, which changes behaviour in a barter context in ways nobody has thought through. |
| A view or impression count | Same, plus it would need a write on every read. |
| An unauthenticated listing page | A scraping surface with no product benefit. Discovery requires a JWT ([API Contract §2.2](../01-architecture/06-api-contract.md)). |
| Any free-text location field | [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md). There is no column, so "meet me at mine" cannot be typed into the schema — only into the description, where `content-scan` flags it ([API Contract §6.5](../01-architecture/06-api-contract.md)). |
| A realtime channel for listings | Map counts poll at 60 s ([SPEC-008 §7.4](SPEC-008-interactive-map.md)); the owner's own listing state changes arrive on `user:{user_id}`. |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Publish listing | `/(modals)/listing-new/[itemId]` | Title, description, spots, wishlist, expiry. `[guard: canTransact]` |
| Listing detail | `/(modals)/listing/[listingId]` | **New.** The requester's view and the owner's view of the same row |
| Edit listing | `/(modals)/listing-edit/[listingId]` | Title, description, wishlist, `accepts_any` only (R12) |
| Safe spot picker | Inline sheet within publish/edit | 1–3 selection, distance-sorted, hours shown |
| My listings | `/inventory` (Listed segment) + `/exchanges` | Owner's live listings and their request counts |
| Matches | `/exchanges` → "Matches" section | `suggest_matches` output (R28) |
| Request | `/(modals)/request-new/[listingId]` | [SPEC-010](SPEC-010-exchange-lifecycle.md); reached from listing detail |

Publish form order: item summary (read-only, with a "change item" escape back to inventory) → title (pre-filled) → description → **safe spots** (1–3, the tallest section, distance-sorted) → "What would you like in return?" (`accepts_any` switch on by default, plus a species multi-select up to 10) → expiry (segmented 3 / 7 / 14 / 21) → the summary line from §8.3 → **Publish**.

The expiry control sits directly above the publish button on purpose: it is the field users skip, and it is the one that determines whether the marketplace is honest a fortnight later.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Listing detail paints from the cached row that brought the user here — the map sheet row, the search result, or the inventory row — so the title, species, quantity, and safe spots are on screen immediately, and photos, hours, and the owner card fill in. A cold deep link shows a three-block skeleton for at most one network round trip. The publish form never shows a loading state: it is composed entirely from data the client already has. |
| Empty | Three cases. **No safe spots within radius** (publish form): the spot section shows "No meeting places within {n} km" with a widen action and a link to what a safe spot is — this blocks publishing and must say so plainly rather than presenting an empty list. **No matches** (R28): the Matches section is absent, not empty. **No listings on an item**: the inventory row reads "Not published" with a Publish action ([SPEC-006 R36](SPEC-006-crop-inventory.md)). |
| Error (recoverable) | Publish failed with a retryable error (5xx, timeout). The form retains every field — it is a Zustand draft with MMKV autosave ([Mobile Architecture §2](../01-architecture/02-mobile-architecture.md)) — and shows an inline banner with Retry. The idempotency key is **not** regenerated on retry, so a request that actually succeeded before the timeout returns the original listing rather than creating a second (R60). |
| Error (terminal) | Listing detail for a row no longer readable: withdrawn, expired, the owner suspended, or a block created since the link was made. All four render **the same** in-place card (§8.3) and the same action back to the map — because distinguishing them is exactly what R52 forbids. The router resolves after `fetchQuery`, so this is a card, not a half-rendered screen. |
| Offline | Listing detail reads from cache with a staleness banner; the request button is disabled with "You're offline" because `create_exchange_request` is not queueable ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)). **Publishing is disabled offline**, with the copy in §8.3: a listing queued for two hours and published against a stale safe-spot set, or against an item someone has since promised elsewhere, is a no-show waiting to happen. Withdrawal is also disabled, for the mirror-image reason — a user who believes they have withdrawn and has not is worse off than one who knows they could not. |
| Permission denied | Two distinct cases. **Unverified** (`can_transact` false): the Publish button is present and disabled with an explanatory sheet routing to verification, never hidden ([Mobile Architecture §3.2](../01-architecture/02-mobile-architecture.md)). **Suspended:** the same surface with the suspension copy and no route onward, plus withdrawal still enabled on existing listings. |
| Rate limited | 429 on publish (20/min) or withdraw (60/h). The action disables for exactly `Retry-After` with a visible countdown, the form retains its state, and **no auto-retry is issued** ([API Contract §7.3](../01-architecture/06-api-contract.md)). Reaching either limit through normal use is a client bug, and the §11 alert is how we would find out. |

Two additional states specific to this feature:

| State | Behaviour |
| --- | --- |
| Reserved (requester's view) | The listing renders in full, greyed at 60%, with a "Spoken for" pill replacing the request button and the copy in §8.3. It stays visible until it leaves the result set by expiry or completion (R48), so a user who was reading it gets an explanation rather than a disappearance. |
| Expiring soon (owner's view) | Under 24 hours remaining, the owner's listing row and detail show an amber countdown with two actions — relist for a fresh window, or withdraw. Under 2 hours, the in-app inbox gets a heads-up. Neither pushes: an expiry warning at 3 a.m. is not a safety alert. |

### 8.3 Copy

Exact strings.

**Publish form, summary line above the button**
> {n} people can find this at {spot_1}{, {spot_2}}{, and {spot_3}} for the next {n} days.

Where the leading count is omitted entirely if we cannot compute it cheaply — an invented number here would be the least trustworthy string in the app.

**Publish form, wishlist section header and helper**
> **What would you like in return?**
> Leave "anything" on if you're not fussy. Most people are.

**Publish form, `accepts_any` switch label**
> I'll take anything

**Publish form, expiry section**
> **How long should this stay up?**
> Options: `3 days` · `7 days` · `14 days` · `21 days`
> Helper: Pick the point where you'd rather compost it than hand it over.

**Publish form, no safe spots in range**
> **No meeting places within {n} km.**
> Sharecropr exchanges only happen at curated public spots — libraries, town halls, police station lobbies. We don't have one near you yet.
>
> Buttons: `Search 40 km` · `What's a meeting place?`

**Publish button**
> `Publish`

**Publish, offline**
> You need a connection to publish. Your draft is saved.

**Publish, unverified**
> **Verify your identity to publish.**
> You can add and edit inventory any time. Publishing and exchanging need a verified ID and a verified garden — that's what makes meeting a stranger at a library reasonable.
>
> Button: `Verify now`

**Publish, item already listed (R57)**
> That item is already published. Withdraw the other listing first.

**Publish, item reserved**
> Someone's arranging to collect that item, so it can't be published again.

**Withdraw confirmation, no pending requests**
> **Withdraw this listing?**
> It'll disappear from the map straight away. Your item goes back to Available.
>
> Buttons: `Keep it up` · `Withdraw`

**Withdraw confirmation, with pending requests (R45)**
> **Withdraw this listing?**
> {n} people are waiting to hear back. They'll be told it's no longer available.
>
> Buttons: `Keep it up` · `Withdraw and cancel {n} requests`

**Withdraw, reserved (R39)**
> **You've already accepted an exchange for this.**
> To pull out, cancel the exchange — and please tell them why. Late cancellations affect how much people trust you here.
>
> Button: `Open the exchange`

**Expiry countdown (requester and owner)**
> {n} days left · Expires tomorrow · Expires in {n} hours · Expires in under an hour

**Expired, owner's in-app inbox (R36)**
> **"{title}" expired.**
> It's off the map now and your item is back in Available. Still have it?
>
> Buttons: `Relist for 7 days` · `Archive the item`

**Relist unavailable (item no longer available)**
> You can't relist this — the item's been archived or exchanged.

**Reserved pill and body, requester's view (R48)**
> **Spoken for**
> Someone's already arranging to collect this. If it falls through, it'll come back.

**Listing gone (R52 — one card for all four causes)**
> **This isn't available any more.**
> It may have been taken, withdrawn, or expired.
>
> Button: `Back to the map`

**Organic claim, requester's view**
> Organic — grower's claim, not certified

**Safe spot row in the picker**
> {name} · {category} · {distance} away · {open_state}

**Safe spot hours stale note**
> Hours may be out of date

**Safe spot suspended, listing detached (R19)**
> **{spot_name} isn't available for exchanges right now.**
> We've removed it from your listing. {It's still up at {n} other places. | Your listing has been withdrawn — pick another place to put it back up.}

**Matches section header**
> **They want what you've got**

**Match row, mutual**
> {title} · {handle} wants your {species}

**Rate limit, publish**
> You've published a lot just now. Try again in {n} s.

**Listing detail accessibility label (R14 / US-14)**
> {title}. {quantity} {unit}, {condition}, harvested {relative_date}. {organic_claim}. Available at {spot_names}. {n} days left. Offered by {display_name}, {trust_tier}, {rating_avg} stars from {rating_count} exchanges.

**Publish button accessibility hint**
> Makes this item visible to people near your chosen meeting places

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Use a listing's safe-spot set to narrow where its owner lives.** A listing carries no coordinate of its own, but it does carry the owner's willingness to travel to each of one to three specific public buildings, and the plausible home region is roughly the intersection of those neighbourhoods — a few square kilometres in a dense metro. That is the accepted residual in [Location Privacy §12.4](../01-architecture/04-location-privacy.md), and R18's hard cap of 3 is the bound: every additional spot tightens the intersection, which is why "let people pick five" is a privacy change, not a usability change. The second-worst is **inventory double-commit** — promising one box of tomatoes to two people who both drive to a library — which is a physical-world harm and is prevented by `listings_one_active_per_item` (R57) and `listings_single_reservation`, not by any client check (R58). The third is **listing spam**: a suspended-or-not user flooding a metro's supply with fake listings, bounded by `app.can_transact()` (R02), the 25-active cap (R09), and the 20/min write limit. |
| Which RLS policies enforce access? | `listings_select_discoverable` (Pattern D — owner-or-(active/reserved AND unexpired AND not blocked either way AND owner not suspended or deleted)), `listings_insert_own` (`owner_id = auth.uid() AND app.can_transact()`), and `listings_update_own` (`status IN ('draft','active')`, narrowed further to four columns by `guard_listing_client_update`) — [RLS Design §5 Pattern D](../01-architecture/05-rls-design.md). `listing_safe_spots` follows `listings`. Definer functions: `public.publish_listing`, `public.withdraw_listing`, `public.set_listing_safe_spots`, `public.suggest_matches`, `app.expire_due_listings`, `app.can_transact`, `app.is_blocked_either_way`, `app.enqueue_notification`, `app.consume_token`. Every one of them runs as owner and therefore bypasses RLS, so every one re-checks authorization as its first statement — and `suggest_matches` in particular re-implements the whole of `listings_select_discoverable` inside its `WHERE`, because a definer function that "inherits" a policy inherits nothing ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| Can any response path expose an exact coordinate or PII? | Only `safe_spots.point`, via the spot rows attached to a listing — an exact coordinate of a public building, and one of the two entries on the CI coordinate-column allowlist (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)). No response in this spec carries a garden coordinate, a `display_point`, an `coarse_cell`/`fine_cell`, or the owner's device position. `suggest_matches` accepts the caller's own quantized position inbound and never echoes it. PII that a requester must not see — `reserved_request_id`, pending request counts, other requesters' identities, `trust_score` — is excluded by the fixed select constants (§7.5) **and** by column `REVOKE` on `profiles`, so a widened select fails rather than leaking. |
| What is logged, and is it scrubbed? | Publish, withdraw, expiry-by-cron, and spot changes write `audit.events` with the actor, the listing id, and the transition; `metadata` cannot carry a coordinate because of the `CHECK` on that column ([Data Model §12](../01-architecture/03-data-model.md)). `suggest_matches`'s `p_lat`/`p_lng` are excluded from Supabase statement logging alongside `safe_spots_near` ([Location Privacy §6.1](../01-architecture/04-location-privacy.md)). Client-side, listing analytics carry `species_id`, `safe_spot_count`, and `expiry_days` — never a title, a description, or a spot id set, since a listing's exact spot combination is the inference channel of §9 row 1. |
| Does this need step-up authentication? | No. Publishing is an ordinary transacting operation, gated by `app.can_transact()` rather than by AAL2, and requiring a TOTP code to list a courgette would be a usability failure with no matching threat ([API Contract §2.4](../01-architecture/06-api-contract.md)). |
| Abuse / rate-limit controls | `publish_listing` and `listings` writes: 20/min/user, Postgres bucket. `withdraw_listing`: 60/hour/user — deliberately generous, because getting *out* must never be rate-limited into a trap. `set_listing_safe_spots`: 20/hour/user. `suggest_matches`: 30/min/user, matching `search_listings` because it has the same trigram-plus-spatial cost profile. Structural caps that a rate limit cannot substitute for: 25 active listings per user (R09), 3 safe spots (R14), 10 wanted species (R21), 21-day expiry (R29), and one live listing per item (R57). |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Two devices signed into the same account publish the same inventory item at the same instant. | `publish_listing` takes `FOR UPDATE` on the item first (R61), so the two serialize. The winner flips the item to `listed`; the loser's `status = 'available'` assertion fails inside the lock and returns `conflict` 409, which the client renders as "That item is already published." `listings_one_active_per_item` is the backstop if a future code path takes locks in a different order. |
| EC-02 | A listing's expiry passes at the exact moment a request is being accepted. | `accept_exchange_request` re-checks `expires_at` inside its own lock, and the expiry sweeper only ever selects `status = 'active'` (R33), so a row that just became `reserved` is invisible to it. One of the two wins cleanly; there is no interleaving that produces an expired reservation ([Exchange State Machine §5 H8](../01-architecture/07-exchange-state-machine.md)). |
| EC-03 | The `expire_listings` cron is down for six hours. | Nothing becomes discoverable that should not: `listings_select_discoverable` filters `expires_at > now()` independently (R31). On resume, the backlog drains in 500-row batches every 5 minutes with `SKIP LOCKED`. The visible symptom is delayed expiry *notifications*, not stale supply — which is exactly the right thing to degrade. |
| EC-04 | An owner is suspended while holding 12 active listings. | All 12 leave every result set immediately via the policy's suspension clause and the matching clause inside `safe_spots_near`, so map counts correct within one 60 s `staleTime` ([SPEC-008 EC-10](SPEC-008-interactive-map.md)). The rows are untouched; if the suspension is lifted, the listings reappear with their original expiry, which may already have passed. |
| EC-05 | A requester has a listing detail open when the owner withdraws it. | The next fetch returns nothing and the screen resolves to the single "This isn't available any more" card (§8.3). If a pending request existed, it is cancelled by R40 and the requester gets an inbox notification — which is the one case where the requester *is* told, because they took an action and deserve an answer. |
| EC-06 | A safe spot is suspended and it was a listing's only spot. | [SPEC-007 R28](SPEC-007-safe-spots.md) detaches it; the deferred trigger would fail a commit that left the listing `active` with zero spots, so the fanout withdraws the listing in the same transaction and notifies the owner with the second variant of the §8.3 detach copy. |
| EC-07 | A safe spot is suspended and it was one of three. | The attachment is removed, the listing stays `active` with two spots, and the owner gets the first variant of the detach copy. No cardinality violation, no withdrawal, and the listing keeps its position and its pending requests. |
| EC-08 | The owner edits the spot set from three spots to three different spots. | `set_listing_safe_spots` replaces the set in one transaction; the deferred cardinality trigger sees only the committed final state, so the intermediate zero-spot moment never violates anything (R15, R62). |
| EC-09 | A user publishes with `accepts_any = false` and an empty wishlist. | Rejected by the `listings_accepts_something` CHECK, surfaced as `validation_failed` and rendered inline on the wishlist section. The client also prevents it, but the constraint is the reason a third-party client cannot create a listing nobody can transact against. |
| EC-10 | A wishlist species is merged in the taxonomy. | The merge migration repoints every element of `listings.wanted_species_ids` ([SPEC-005 R35](SPEC-005-crop-taxonomy.md)). If the merge produces a duplicate inside one array, it is de-duplicated, which can only reduce the count — so the 10-element CHECK cannot be violated by a merge. |
| EC-11 | A requester's client is stale and sends a request against a `reserved` listing. | `create_exchange_request`'s `WITH CHECK` requires `l.status = 'active'`, so the insert fails with `listing_unavailable` 409, the client shows "Just claimed by someone else", and invalidates the map and exchanges prefixes ([Mobile Architecture §2.5](../01-architecture/02-mobile-architecture.md)). |
| EC-12 | An exchange for a reserved listing is cancelled. | `cancel_session` returns the listing to `active` and the item to `listed`. `expires_at` is **not** extended, so a listing cancelled after its window has passed expires on the sweeper's next tick — correctly, because the produce is a week older than when it was published. The owner's inbox gets the expiry notice and the relist action. |
| EC-13 | The owner archives the inventory item behind an active listing. | The client withdraws the listing first, in the same user action ([SPEC-006 R37](SPEC-006-crop-inventory.md)), and the archive proceeds only if the withdrawal succeeds. A listing pointing at an archived item never exists. |
| EC-14 | Someone constructs `PATCH /rest/v1/listings?id=eq.X` with `{"status":"reserved"}` as the owner. | `guard_listing_client_update` raises `not_authorized` 42501 because `status` is outside the four client-writable columns (R12). This matters more than it looks: a self-set `reserved` would take the row out of the expiry sweeper's reach and out of the request path, parking supply invisibly. |
| EC-15 | Fifty concurrent requesters all try to be accepted for the same listing. | Not this spec's mechanism, but this spec must not weaken it: `listings_single_reservation` plus `SELECT … FOR UPDATE` in `accept_exchange_request` means exactly one succeeds and 49 receive `listing_unavailable` ([SPEC-010 T30](SPEC-010-exchange-lifecycle.md), hazard H1). `withdraw_listing` cannot move a row out of `reserved` (R39), so there is no path by which the owner can void a reservation from this side. |
| EC-16 | A user publishes their 26th active listing. | `quota_exceeded` 422 (R09) with copy naming the cap and pointing at the listings that could be withdrawn. Not a silent failure, and not a rate-limit message — the user is not going too fast, they are at a ceiling. |
| EC-17 | A publish request times out after the transaction committed, and the client retries. | The same `p_idempotency_key` is replayed (R60) and the RPC returns the original listing with its original `published_at`, not a second listing and not a 409 ([API Contract §3.1](../01-architecture/06-api-contract.md)). This is the case that makes `listings_one_active_per_item` a safety net rather than the user's error message. |
| EC-18 | An item's owner blocks a requester who has a pending request against their listing. | `on_block_created` cancels the pending request and closes the thread ([RLS Design §6](../01-architecture/05-rls-design.md)); the listing itself stays `active` and simply leaves the blocked user's result set. The blocked user is never told, and the listing's disappearance is indistinguishable from expiry (R52). |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `listing.published` | product event | `species_id`, `safe_spot_count`, `expiry_days`, `has_description`, `accepts_any`, `wanted_count`, `photo_count` | — |
| `listing.publish_failed` | error event | `code`, `stage` | `conflict` > 2% of attempts ⇒ the client's already-listed check is stale |
| `listing.time_to_publish_ms` | histogram | `safe_spot_count` | p95 > 90 s ⇒ the form is too long, most likely the spot picker |
| `listing.expiry_window_chosen` | product event | `days` | Distribution reviewed monthly; a collapse onto 21 means the default is wrong |
| `listing.withdrawn` | product event | `age_hours`, `requests_cancelled`, `reason_inferred` (`archived_item`\|`manual`) | `requests_cancelled` p95 > 2 ⇒ people are publishing then thinking |
| `listing.expired` | product event | `age_hours`, `had_requests`, `species_id` | `had_requests = false` > 70% ⇒ a liquidity alarm; supply exists and demand is not finding it |
| `listing.expiry_batch` | operational | `processed`, `duration_ms`, `backlog_remaining` | `backlog_remaining` > 0 for 3 consecutive runs, or `duration_ms` p95 > 2 s |
| `listing.expiry_touched_reserved` | error event | `listing_id` | **Any occurrence — page.** R33 is the one invariant in this spec whose violation reaches a physical meeting |
| `listing.stuck_listed_inventory` | gauge | `count` | **> 0** — an item in `listed` with no live listing means R34 failed and the owner cannot republish or explain why |
| `listing.relisted` | product event | `from_status` (`expired`\|`withdrawn`), `gap_hours` | — |
| `listing.spot_set_changed` | product event | `from_count`, `to_count`, `cause` (`user`\|`spot_suspended`) | `spot_suspended` spikes track [SPEC-007](SPEC-007-safe-spots.md) curation events |
| `listing.detached_by_suspension` | product event | `listings_affected`, `listings_withdrawn` | Reported to the curation owner on every spot suspension |
| `listing.reserved_view` | product event | `listing_id` | High volume ⇒ R48's greyed state is being reached often; check that the copy is doing its job |
| `listing.match_suggested` | product event | `match_kind`, `count`, `shares_safe_spot` | Zero-result rate > 80% ⇒ wishlists are too specific or supply is too thin to match |
| `listing.match_opened` | product event | `match_kind`, `rank` | `rank` consistently > 5 ⇒ the ranking in R24 is wrong |
| `listing.quota_exceeded` | product event | `quota` (`active_listings`\|`safe_spots`\|`wanted_species`\|`expiry`) | `active_listings` from more than a handful of accounts ⇒ inspect for spam |
| `listing.detail_terminal_card` | product event | — (deliberately **no** cause property) | Rising ⇒ stale deep links or aggressive expiry. The cause is not recorded even internally, so that no analytics path can reconstruct what R52 hides from the user |

**Never emitted:** a listing title or description (free text), the exact set of `safe_spot_id`s on a listing (the inference channel of §9), a requester's identity alongside a listing they viewed, or any coordinate.

## 12. Accessibility

- The listing detail is read as **one coherent statement** — what it is, how much, how old, where, by when, and who from — via the composed label in §8.3, rather than as fourteen separate stops. This is the single most important accessibility decision here, because a listing is a decision, and a decision needs its facts in one utterance.
- **Time remaining is always text, never a bar, a ring, or a colour.** "3 days left" is announced; an amber ring is not, and an amber ring alone would make the most consequential field on the screen invisible to a third of the ways people use phones.
- The safe-spot picker is a list of checkboxes with `accessibilityRole="checkbox"` and `accessibilityState={{ checked }}`, with a live-region announcement of the running count — "2 of 3 selected" — so the 1–3 cardinality is perceivable without counting ticks.
- Selection limits are announced before they are hit, not after: at three selected, the remaining rows set `accessibilityState={{ disabled: true }}` and the section header reads "3 of 3 selected — deselect one to change".
- The `accepts_any` switch and the wishlist multi-select are separate, labelled controls; the wishlist is `accessibilityElementsHidden` while `accepts_any` is on **and** the wishlist is empty, so a reader is not walked through a section that has no effect.
- The "Spoken for" state (R48) is conveyed by a text pill and by the absence of the request button — never by opacity alone, since 60% opacity is not a state a screen reader has a word for.
- The expiry segmented control uses `accessibilityRole="radiogroup"` with each option labelled in full ("7 days"), not "7".
- Withdraw and relist confirmations are dialogs with `accessibilityViewIsModal`, labelled buttons in a fixed order, and focus returning to the invoking control on dismissal ([Mobile Architecture §10.2](../01-architecture/02-mobile-architecture.md)).
- Dynamic type to 200% throughout, with no capping. The publish summary line and the countdown wrap rather than truncate; a truncated "Expires in…" is worse than no countdown.
- Hit targets ≥ 44 × 44 dp on every spot row, chip, segment, and inline action.
- Reduced motion: the greyed-out transition into "Spoken for" and the publish success animation become instant state changes.
- Match rows are single accessible elements labelled with the match reason first ("They want your tomatoes — Genovese basil, big bunch"), because the reason is why the row is there.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01, R06 | `publish_listing` denormalizes `species_id` from the item; a client-supplied `species_id` in the body is ignored and the stored value matches the item |
| T02 | rls | R02 | Publish as unverified, as garden-unverified, and as suspended — all `not_verified` 403; the same users retain full inventory access |
| T03 | integration | R03, R10 | Publish is atomic: an injected failure after the listing update leaves no spot rows and no inventory flip |
| T04 | integration | R04, R05 | Title of 2 and 81 characters rejected; description of 501 rejected; all by `CHECK`, not only zod |
| T05 | rls | R07, R43 | A `draft`, `withdrawn`, `expired`, and `completed` listing is readable by its owner and returns zero rows for every other user and for `anon` |
| T06 | integration | R08 | Publishing an item in `listed`, `reserved`, `exchanged`, `archived`, or `composted` returns `conflict` 409 |
| T07 | integration | R09 | The 26th active listing returns `quota_exceeded` 422; withdrawing one frees a slot immediately |
| T08 | integration | R11 | Schema introspection: no column on `listings` or `listing_safe_spots` is a currency, money, or numeric price; CI grep over migrations for `price`, `currency`, `amount`, `cost` |
| T09 | integration | R12 | PATCH of `inventory_item_id`, `owner_id`, `species_id`, `status`, `expires_at`, `published_at`, `reserved_request_id` each rejected by `guard_listing_client_update`; the four permitted columns succeed |
| T10 | integration | R13 | `set_listing_safe_spots` succeeds while `active`; a PATCH attempting to change the spot join directly is denied |
| T11 | integration | R14, R15, R62 | 0 spots and 4 spots both rejected at commit; a legal three-row insert succeeds; a `draft` with zero spots is permitted and cannot be flipped to `active` |
| T12 | integration | R16 | Attaching a `proposed`, `under_review`, `suspended`, or `retired` spot returns `validation_failed` |
| T13 | e2e | R17, R20 | Picker is distance-sorted from the quantized position, shows today's hours and the 90-day staleness note, pre-selects the nearest spot within 8 km and nothing when the nearest is 12 km |
| T14 | integration | R18 | A fourth spot returns `quota_exceeded`; asserted through the RPC **and** by direct insert, so the cap is not merely a parameter check |
| T15 | integration | R19 | Suspending a spot detaches it; a listing left with zero spots is withdrawn in the same transaction and the owner is notified; a listing left with two is untouched |
| T16 | integration | R21, R22 | An 11-element wishlist rejected; `accepts_any = false` with an empty wishlist rejected by `listings_accepts_something` |
| T17 | unit | R23 | Wishlist entries come only from the species picker; no text path exists in the form or the repository |
| T18 | integration | R24 | `suggest_matches` ranking asserted over a fixture: mutual before one-way, shared-spot before not, nearer before further, newer before older — each pair isolated |
| T19 | rls | R25, R26 | Suggestions exclude blocked-either-way, suspended owners, deleted owners, expired, `reserved`, and the caller's own listings; the returned columns are a subset of the requester's discovery select |
| T20 | e2e | R27, R28 | Opening a suggestion creates no row; the Matches section is absent (not empty) when there are none |
| T21 | integration | R29, R30 | Default `expires_at` is `created_at + 7 days`; 22 days rejected by CHECK; the client offers exactly [3, 7, 14, 21] |
| T22 | rls | R31 | With the cron disabled, a listing past `expires_at` and still `status = 'active'` returns zero rows for a non-owner |
| T23 | integration | R32, R35 | The job selects only `active` + due, processes at most 500, uses `SKIP LOCKED`, and completes in under 2 s at 5,000 due rows |
| T24 | integration | R33 | **Reserved-row invariant:** 200 reserved rows with `expires_at` in the past; after 10 job runs, zero are modified. Asserted on `status`, `updated_at`, and the inventory item |
| T25 | integration | R34 | Expiry releases the item from `listed` to `available` in the same transaction; a listing whose item is already `available` is left alone rather than overwritten |
| T26 | integration | R36 | Expiry writes an inbox row and enqueues a push subject to preferences; a user with `exchange_reminder` disabled gets the inbox row and no push |
| T27 | e2e | R37 | One-tap relist creates a **new** listing with a fresh expiry; the expired row is unchanged; relist is refused when the item is archived or exchanged |
| T28 | integration | R38, R40 | Withdrawal sets `withdrawn_at`, releases the item, cancels every pending request, and notifies each requester — asserted with three pending requests |
| T29 | integration | R39, R44 | `withdraw_listing` on a `reserved` listing returns `invalid_transition` 409; asserted also against a direct definer call, so the guard is in the function and not only in the client |
| T30 | integration | R41, R42 | Every transition in §6.1 is exercised; every transition **not** in §6.1 is attempted and rejected; `reserved` and `completed` are unreachable from any client write path |
| T31 | rls | R46, R47 | `listings_select_discoverable` asserted clause by clause: owner sees all own; non-owner sees active/reserved unexpired only; blocked either way sees none; suspended owner's are invisible; deleted owner's are invisible |
| T32 | e2e | R48 | A `reserved` listing renders greyed with the "Spoken for" pill and no request button, and stays in the list rather than vanishing |
| T33 | e2e | R49 | The requester's view renders every one of the enumerated fields, including the labelled organic claim and all attached spots with distance and hours |
| T34 | rls | R50 | Each excluded field asserted absent: private note, `reserved_request_id`, request count, other requesters, view count, `trust_score`, `cancellation_count_90d`, `home_coarse_cell`, any garden coordinate |
| T35 | e2e | R51 | The owner's view shows the request count and list, withdraw, edit, spot editing, countdown, relist, and matches |
| T36 | e2e | R52 | Declined, expired, withdrawn, and blocked all produce byte-identical screens and byte-identical network responses from the requester's side |
| T37 | integration | R53 | Suspending an owner removes their listings from detail reads, `search_listings`, and the `safe_spots_near` count aggregate within one query |
| T38 | e2e | R54 | Deep link, map sheet row, search result, and match suggestion all land on `/(modals)/listing/[listingId]`; an unreadable listing lands on the tab root with a toast |
| T39 | unit | R55, R56 | Countdown formatting parameterised across 21 d, 3 d, 25 h, 23 h, 90 min, 30 min, and past-due; no raw timestamp is ever rendered; the "New" affordance appears for exactly 24 h after `published_at` |
| T40 | integration | R57, R58 | The partial unique index exists with the exact predicate; a second listing for the same item fails at the index even when the RPC's own check is stubbed out |
| T41 | integration | R59 | `listings_single_reservation` still exists and still applies; no path in this spec moves a row out of `reserved` |
| T42 | integration | R60 | Replaying every RPC with the same `p_idempotency_key` returns the original result and creates nothing; replaying with different arguments returns `idempotency_conflict` 409 |
| T43 | integration | R61 | Lock-order assertion: `publish_listing` locks the inventory item before writing `listings`; a deliberate reversed-order variant is shown to deadlock and is rejected in review |
| T44 | perf | §11 | `listings_select_discoverable` keeps `listings` p95 under 50 ms at 10× launch volume ([RLS Design §8](../01-architecture/05-rls-design.md)); `EXPLAIN` baseline committed |
| T45 | manual | §12 | VoiceOver and TalkBack over publish, the spot picker at its cardinality limit, listing detail, the reserved state, and the withdraw dialog |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T46 | Publish two listings for one inventory item from two devices, 50 times concurrently | Exactly one active listing per item, every time. 49 receive `conflict` 409. Asserted on the row count, not on the error message, because the error is a courtesy and the index is the guarantee (R57, R58) |
| T47 | `PATCH /rest/v1/listings?id=eq.X` with `{"status":"reserved"}` as the owner | `not_authorized` 42501 from `guard_listing_client_update`. Repeated for `active`, `completed`, `expired`, and `withdrawn`. Self-setting `reserved` would park supply outside the expiry sweeper's reach (EC-14) |
| T48 | `PATCH` with `{"expires_at": "2027-01-01"}` on an active listing | Denied by the same guard. Separately, a direct definer write of a 30-day expiry is rejected by `listings_expiry_window` — the CHECK holds against `service_role` too |
| T49 | `PATCH` with `{"owner_id": "<someone else>"}` | Denied by `listings_update_own`'s `WITH CHECK`. Listing transfer is not a feature |
| T50 | `INSERT INTO listing_safe_spots` directly for someone else's listing | Denied — the join table's policy follows `listings`, and the caller is not the owner |
| T51 | Attach a 4th safe spot by direct insert, bypassing the RPC | `quota_exceeded` at commit from the deferred trigger (R14, R15). Asserted by direct insert specifically, because a cap enforced only in an RPC is a cap enforced only in the happy path |
| T52 | Delete all `listing_safe_spots` rows for an active listing | `quota_exceeded` at commit. There is no committed state in which a discoverable listing has zero meeting places (R62) |
| T53 | Read a listing belonging to a user who blocked you, by direct id | Zero rows, not 403 — RLS invisibility is a 404-shaped answer, and a 403 would confirm the row exists ([API Contract §3.4](../01-architecture/06-api-contract.md)). The blocked user receives no signal of any kind |
| T54 | Enumerate listings by scanning uuids | Uuid v4 primary keys make enumeration infeasible ([Data Model §1](../01-architecture/03-data-model.md)); the read limit is 120/min/user; a scan yields only rows the caller could already discover |
| T55 | `GET /rest/v1/listings?select=*` as a non-owner | The lint-enforced fixed select constants (§7.5) mean no shipped client does this; on the wire, `reserved_request_id` is present in the row but carries no readable meaning, so the test asserts it is **not** in either constant and that a CI check fails any new `listings` query using `select=*` |
| T56 | Publish with `p_expires_in_days = 3650` | `quota_exceeded` 422 at the RPC and `listings_expiry_window` at the CHECK. Both layers asserted, because the RPC parameter is a UI convenience and the CHECK is the contract |
| T57 | Publish 200 listings in a minute from one account | 20 succeed per minute, the rest `rate_limited` 429 with integer `Retry-After`; the 25-active cap engages independently and is not defeated by waiting |
| T58 | Publish from 40 accounts behind one carrier NAT | Each account's Postgres bucket limits it independently; Kong's per-IP layer does not lock out a commuter train ([API Contract §7.1](../01-architecture/06-api-contract.md)) |
| T59 | Put a home address and a phone number in `description` and publish | Accepted at the storage layer, flagged asynchronously by `content-scan` ([API Contract §6.5](../01-architecture/06-api-contract.md)). Asserted so this is a tested limitation rather than an assumed protection — there is no free-text location **field**, but there is free text |
| T60 | Call `suggest_matches` with someone else's `p_listing_id` | `not_authorized` 403 from the function's first statement. A definer function bypasses RLS, so this check is the only thing standing between an attacker and a bespoke query over another user's wishlist |
| T61 | Call `suggest_matches` with `p_lat = 91`, `p_radius_m = 10000000` | `validation_failed` 400 on the coordinate; the radius is capped server-side by the same `LEAST(p_radius_m, 40000)` rule as `safe_spots_near` |
| T62 | Sweep `suggest_matches` 200× in a minute to harvest supply and wishlists | 30 succeed, the rest 429. The response contains no coordinate and no owner identifier beyond a `profile_cards` subset, so the scraping yield is the same supply data `search_listings` already bounds |
| T63 | Contract sweep over `listings`, `listing_safe_spots`, and all four RPC return types | Only `safe_spots.point`-derived columns appear, matching the existing two-line allowlist (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)). Nothing new is allowlisted |
| T64 | Inspect the wire for a full publish-to-request session | No garden coordinate, no `display_point`, no `coarse_cell`/`fine_cell`, no owner device position. The only coordinates present are the attached safe spots' public points |
| T65 | Emit a PostHog event carrying a listing's `safe_spot_id` set | Rejected by the analytics wrapper's property allow-list for listing events, and by a lint rule on the source. The exact spot combination is the inference channel in §9 and is not an analytics property |
| T66 | Withdraw a listing while a request against it is being accepted | The two serialize on the listing row. If the acceptance commits first, the withdrawal returns `invalid_transition` (the row is now `reserved`, R39). If the withdrawal commits first, the acceptance returns `listing_unavailable`. There is no interleaving that produces a reserved-and-withdrawn row, and no interleaving in which a requester is told to drive somewhere for nothing |
| T67 | Force `app.expire_due_listings` to run against a database where 30% of due rows are `reserved` | Zero reserved rows modified; the counter `listing.expiry_touched_reserved` stays at zero. This is the H8 invariant and it gets its own test, its own alert, and its own line in the runbook |

### 13.3 Manual QA

- [ ] Publish a real item to two real safe spots in a launch metro and confirm the summary line, the countdown, and the map marker all agree.
- [ ] Let a listing expire naturally on a preview branch; confirm the inbox notice, the item's return to Available, and the one-tap relist.
- [ ] Accept a request, then attempt to withdraw; confirm the copy points to the exchange and does not offer an unlock.
- [ ] Suspend a safe spot that is the only spot on a live listing and confirm the listing is withdrawn and the owner told, in one step, with correct copy.
- [ ] Suspend a spot that is one of three and confirm the listing survives with two and keeps its pending requests.
- [ ] Two devices, one account, publish the same item simultaneously; confirm one listing and a clear message on the other device.
- [ ] Confirm from the requester's side that declined, expired, withdrawn, and blocked are indistinguishable — check the screen *and* a proxy capture.
- [ ] Screen-reader pass over publish, the spot picker at 3 of 3, listing detail, and the reserved state.
- [ ] Confirm every string at 200% type in both themes, particularly the countdown and the publish summary line.
- [ ] Confirm no coordinate other than safe-spot points appears in a mitmproxy capture of a full publish → discover → request session.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `listings.match_suggestions` (R24–R28) — default-on, flagged because it is the one part of this spec with no correctness obligation and a real cost profile; if `suggest_matches` proves expensive at launch volume it can be disabled without touching publishing. Publishing itself is not flagged: without it there is no product. |
| Migration required | Yes. `20260808_0091_listing_publication.sql` — one partial unique index, two columns, three CHECKs, three indexes, two deferred constraint triggers, one client-update guard trigger, four RPCs, and two `pg_cron` jobs. RLS policies and pgTAP tests ship in the same PR ([Data Model §15.4](../01-architecture/03-data-model.md)). |
| Backfill required | Yes, conditionally. `listings_one_active_per_item` is a unique index over existing rows, so the migration first asserts zero violations and **fails loudly** if any exist rather than creating the index `CONCURRENTLY` and leaving it invalid. In MVP there are no production rows; the assertion is written for the case where that stops being true. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A bad expiry job is disabled with `cron.unschedule('expire_listings')`, which is safe precisely because R31 makes the read policy the guarantee — expiry stops tidying up and nothing becomes visible that should not. A bad RPC is replaced by a `_v2` and the old one kept until `devices.app_version` telemetry clears it ([API Contract §3.2](../01-architecture/06-api-contract.md)). Client rollback is an EAS Update. |
| Client version floor | None. An older client that publishes via the pre-RPC path does not exist — `publish_listing` ships in the first release — but the guard trigger means that if one ever did, its writes would be rejected rather than silently producing a listing with no spots. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | [API Contract §4.5](../01-architecture/06-api-contract.md) describes publishing as a `PATCH` that sets `status = 'active'` and `published_at`. That cannot hold the `listing_safe_spots` insert and the `inventory_items` flip in one transaction, and it collides with decision rule R5 in [API Contract §1.1](../01-architecture/06-api-contract.md). This spec specifies `rpc.publish_listing` instead and restricts the PATCH surface to four columns (R12). **The API contract needs a corresponding edit.** | Architecture | Before implementation starts |
| Q2 | Is 7 days the right default expiry? It is a guess about how long home-garden produce stays worth collecting, and it is almost certainly wrong for both ends — salad leaves and winter squash are not the same product. A per-species default derived from `item_condition` and `best_by` is the obvious refinement and is also a lot of surface for a guess. | Product | Post-launch, first season |
| Q3 | Should `reserved` listings stay visible to non-participants at all (R48)? Showing them is honest and gives a browsing user a sense of liveliness in a thin market; hiding them keeps the map clean and avoids a dead-end tap. The answer probably differs between a cold-start metro and a busy one, which argues for making it a config value rather than a decision. | Product + Design | Post-launch, first season |
| Q4 | Should the 25-active-listing cap (R09) exist at all, or should it be a rate limit only? A caps-and-limits pair is belt and braces; a cap that bites a market gardener with a genuine glut in August is a story we would rather not read. | Product | Post-launch, first season |
| Q5 | Should an owner be able to extend an expiry in place instead of relisting (R37)? Relisting loses the listing's age, its `published_at`, and any pending requests. Extending in place makes the countdown meaningless, which is the one number a requester is relying on. | Product | Post-launch |
| Q6 | Is the 3-spot cap the right privacy/usability trade (R18)? Rural users have real difficulty finding three spots inside a sensible drive, and the argument for raising it is a coverage argument. The argument against is that every additional spot tightens the intersection that identifies where the owner lives ([Location Privacy §12.4](../01-architecture/04-location-privacy.md)). | Architecture + Security | Before any rural-market expansion |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Backend Engineering | Initial spec |
| 2026-10-22 | 1.0.1 | Backend Engineering | H3 removed; renamed to location tiers per [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md). |
