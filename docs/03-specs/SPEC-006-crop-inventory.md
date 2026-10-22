# SPEC-006: Crop Inventory Management

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.1.1 |
| **Owner** | Mobile Engineering |
| **Phase** | MVP |
| **Security review** | not required |
| **Schema depends on** | [SPEC-004](SPEC-004-garden-verification.md), [SPEC-005](SPEC-005-crop-taxonomy.md) |
| **Behaviourally coupled with** | SPEC-012 (image moderation), SPEC-013 |
| **Related ADRs** | [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md), [ADR-0011](../01-architecture/adr/ADR-0011-state-management.md) |
| **Last updated** | 2026-10-21 |

---

## 1. Summary

Inventory is the private ledger of what a gardener actually has: a structured row per pile of produce, carrying species and variety from [SPEC-005](SPEC-005-crop-taxonomy.md), a quantity and unit, a condition, dates, an organic claim, and up to five photos. **It is private by default and stays private until the user performs a separate, deliberate publishing act** ([SPEC-009](SPEC-009-listings-and-offers.md)) — there is no toggle on the item form, and creating an item makes it discoverable by nobody. It is also the one place in the product with genuine offline write support, because the moment a gardener records a harvest is the moment they are standing in a garden with one bar of signal.

## 2. Goals

- Make recording a harvest take under 30 seconds: species, quantity, unit, condition, save.
- Be fully usable offline — read *and* write — with an unmistakable pending state, because a queued item that looks saved is worse than an error ([Mobile Architecture §6](../01-architecture/02-mobile-architecture.md)).
- Keep the private/public boundary structural rather than conventional: a private field must be private because of a policy, not because the current client happens not to render it.
- Strip EXIF from every photo before the asset is readable by anyone, including its owner, because a phone photo of a tomato carries the GPS coordinates of someone's back garden ([Data Model §8](../01-architecture/03-data-model.md)).
- Let the exchange lifecycle own `inventory_status` completely, so an item cannot be promised twice.
- Distinguish "I no longer have this" (archive) from "I entered this by mistake" (soft delete), because conflating them either destroys history or clutters the list forever.
- Be honest in copy about what an organic claim is: a claim by the grower, not a certification by anyone.

## 3. Non-Goals

- **Publishing.** This spec ends at a private row. Listings, safe spots, expiry, and wishlists are [SPEC-009](SPEC-009-listings-and-offers.md). The item form contains no publish affordance at all (R33), and that absence is a requirement rather than a layout decision.
- **Multiple gardens.** One garden per user in MVP ([Data Model §6](../01-architecture/03-data-model.md), `gardens_one_per_owner`). `garden_id` exists on the row so that Phase 2 is additive; the picker does not.
- **Planned or forecast harvests.** `harvested_on` cannot be in the future (R06). "I'll have courgettes in three weeks" is `public.plantings` and [SPEC-020](SPEC-020-harvest-planning.md).
- **Yield tracking, weights over time, garden analytics.** We store what you have now, not a time series of what you grew.
- **Barcode, scale, or CSV import.** No.
- **ML crop identification from the photo.** [SPEC-023](SPEC-023-crop-id-and-food-safety.md), Phase 3. The photo is evidence for a human, not input to a classifier.
- **Free-text species.** [SPEC-005 R40](SPEC-005-crop-taxonomy.md). `custom_label` is a display string and is forbidden from participating in classification (R15) — that constraint is what stops it becoming free-text species by the back door.
- **Sharing an inventory item without a listing.** There is no "send this to a friend", no share sheet, and no public item URL. The only way another user sees an item is through a listing or an offer in an exchange request.
- **Certified-organic verification.** We record a claim and label it as one ([PRD C6](../00-foundation/02-prd.md)). Verifying it would make us a certifying body.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener who just picked**, I want to add four pounds of Cherokee Purple in under a minute so that recording a harvest isn't a chore. | P0 |
| US-02 | As a **gardener in the garden with no signal**, I want to add items and photos and have them sync later, without wondering whether they saved. | P0 |
| US-03 | As a **gardener**, I want my inventory to be private until I decide to offer something, so that adding an item is not an act of publication. | P0 |
| US-04 | As a **gardener**, I want to see at a glance which of my items are published and where. | P0 |
| US-05 | As a **gardener**, I want to add photos so people can see the actual condition of what I'm offering. | P0 |
| US-06 | As a **privacy-conscious gardener**, I want to be certain my photos don't tell anyone where I live. | P0 |
| US-07 | As a **gardener whose courgettes went off**, I want to archive them with a reason so my list stays true without losing my history. | P1 |
| US-08 | As a **gardener who typed 40 instead of 4**, I want to fix it — and if it's already listed, I want the app to tell me why I can't. | P0 |
| US-09 | As a **gardener mid-exchange**, I want the app to stop me deleting the item someone is driving to collect. | P0 |
| US-10 | As a **gardener**, I want a note to myself on an item ("the ones on the left are split") that nobody else ever sees. | P1 |
| US-11 | As a **requester**, I want to see quantity, unit, condition, and harvest date on the listing, so I know what I'm getting. | P0 |
| US-12 | As a **screen-reader user**, I want each inventory row read as one sentence, not eight fragments. | P0 |
| US-13 | As a **gardener with 60 items in August**, I want the list to stay smooth and to be able to find one thing. | P1 |

## 5. Functional Requirements

### 5.1 The item model and validation

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | An item MUST belong to exactly one garden owned by the caller. `owner_id` is denormalized for RLS performance and MUST equal the garden's owner, enforced by `inventory_insert_own`'s `WITH CHECK` ([RLS Design §5 Pattern A](../01-architecture/05-rls-design.md)). |
| R02 | **MUST** | Required at save: `species_id`, `quantity`, `unit`, `condition`. Everything else is optional. Four fields is the floor for a row to be useful in a listing; a fifth would cost more items than it gains. |
| R03 | **MUST** | `quantity` MUST be `numeric(8,2)` with `CHECK (quantity > 0)`. Zero and negative are rejected server-side; the client input accepts at most two decimal places. |
| R04 | **MUST** | `unit` MUST come from the `quantity_unit` enum — the **eleven** values in [Data Model §4](../01-architecture/03-data-model.md), which is authoritative. The client MUST render the enum and MUST NOT offer free text. |
| R05 | **MUST** | `condition` MUST come from `item_condition` and MUST be an explicit user choice. There is no default: a silently-defaulted "fresh" on a week-old pile of squash is a misrepresentation report waiting to happen. |
| R06 | **MUST** | `harvested_on` MUST be `≤ current_date` (existing `CHECK`). Future dates are a planting, not an inventory item. |
| R07 | **MUST** | When both are present, `best_by` MUST be `≥ harvested_on`, enforced by a new `CHECK`. |
| R08 | **MUST** | `is_organic_claim` is a **claim by the grower and not a certification**, and every surface that renders it MUST say so in the words in §8.3 — the form, the item detail, the listing card, and the listing detail. Rendering a bare "Organic" badge would let us imply a certification we do not perform. |
| R09 | **MUST** | The owner's private note MUST NOT be readable by any counterparty on any path. It lives in `public.inventory_notes` (§6), not on `inventory_items`, so the guarantee is a table boundary rather than a column the current client happens not to select. |
| R10 | **MUST** | Every user-supplied text column MUST carry a database `CHECK` on length, not only a zod rule ([Data Model §1](../01-architecture/03-data-model.md)). `custom_label` ≤ 60, note ≤ 300. |
| R11 | **SHOULD** | The form SHOULD default `unit` to the species' `typical_units[1]` ([SPEC-005 R05](SPEC-005-crop-taxonomy.md)) and `harvested_on` to today. It MUST NOT default `condition` (R05). |
| R12 | **MUST** | Inventory CRUD MUST work for a user whose garden or identity is unverified. Verification gates *transacting*, not recording ([PRD C3](../00-foundation/02-prd.md), [Mobile Architecture §3.2](../01-architecture/02-mobile-architecture.md)). An unverified user who cannot even write down their harvest has no reason to finish verification. |

### 5.2 Species, variety, and the custom label

| ID | Req | Statement |
| --- | --- | --- |
| R13 | **MUST** | `species_id` MUST come from the species picker ([SPEC-005 §8.1](SPEC-005-crop-taxonomy.md)). There is no text path to a species. |
| R14 | **MUST** | `variety_id` is optional and MUST belong to the chosen species, enforced by a trigger rather than by the form. |
| R15 | **MUST NOT** | `custom_label` is **display only**. It MUST NOT participate in classification, category assignment, filtering, matching, counting, search indexing, or ranking — on the client or the server. It is the answer to "which pile is this", not "what is this". |
| R16 | **MUST** | Changing `species_id` MUST clear `variety_id` when the variety does not belong to the new species, in the same write. Leaving a stale variety attached produces "Cherokee Purple Zucchini". |
| R17 | **MUST** | A variety pending review renders to the owner with a "Pending review" pill and to nobody else; non-owners see the species name only ([SPEC-005 R45, R46](SPEC-005-crop-taxonomy.md)). |
| R18 | **MUST** | Display title composition MUST be exactly: `custom_label` if present; else `"{variety_name} {species.common_name}"` if a visible variety exists; else `species.common_name`. One function, `domain/inventory/title.ts`, used by every surface — list rows, detail, listing cards, exchange screens, and notifications — so the same item is never called two different things in two places. |
| R19 | **MUST NOT** | The client MUST NOT infer a species, category, or variety from `custom_label` text, however obvious the string looks. |

### 5.3 Photos

| ID | Req | Statement |
| --- | --- | --- |
| R20 | **MUST** | At most **5** photos per item ([PRD C6](../00-foundation/02-prd.md)), enforced by a trigger on `media_assets` returning `quota_exceeded` 422 — not by the client, which is offline half the time and cannot count what it hasn't synced. |
| R21 | **MUST** | Every photo MUST pass through the `media-process` Edge Function ([API Contract §6.3](../01-architecture/06-api-contract.md)), which strips every EXIF/XMP/IPTC block, re-encodes, generates 400 px and 1200 px variants, computes a blurhash, and sets `exif_stripped_at` **last**. |
| R22 | **MUST NOT** | The client MUST NOT be the thing that strips EXIF, and no code path may treat a client-side strip as sufficient. An asset with `exif_stripped_at IS NULL` is invisible through every read policy, which means the failure mode is "your photo didn't upload", never "your photo uploaded with its GPS intact". |
| R23 | **MUST** | Another user's asset MUST be rendered only from a signed URL for a processed asset. There is no path that renders a raw storage path, a public URL, or a client-held file URI belonging to someone else. |
| R24 | **MUST** | While an upload is in flight the client MAY show the local file URI as an optimistic placeholder, clearly marked as uploading. It MUST NOT write that URI into `media_assets` and MUST NOT persist it as the asset path. |
| R25 | **MUST** | Both camera capture and library import are permitted. This differs deliberately from garden verification, which is camera-only because the photo *is* a location assertion ([SPEC-004](SPEC-004-garden-verification.md)); a crop photo asserts nothing about where it was taken, so constraining provenance would buy nothing. EXIF stripping is identical for both sources and is the reason the difference is safe. |
| R26 | **MUST** | Reject: files > 10 MB, non-image MIME types, and images whose decoded dimensions exceed 12000 × 12000 (a decompression bomb). |
| R27 | **MUST** | `media_assets.sort_order = 0` is the item's cover image. Reordering MUST be possible without re-upload. |
| R28 | **MUST** | Deleting a photo MUST set `media_assets.deleted_at`, and the storage object MUST be removed by the lifecycle job within 24 hours. A storage object that outlives its row is an unindexed, unreviewable image with a guessable path. |
| R29 | **MUST** | Photo upload MUST be queueable offline. The file is copied into app-scoped storage **before** the job is enqueued, so the queued job holds a stable path rather than a `content://` URI that expires when the picker's grant does ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)). |
| R30 | **SHOULD** | Every list and detail image SHOULD use `media_assets.blurhash` as its placeholder via `expo-image`, so a list paints with meaningful colour rather than grey boxes ([Mobile Architecture §9](../01-architecture/02-mobile-architecture.md)). |

### 5.4 Private by default, and the publication boundary

| ID | Req | Statement |
| --- | --- | --- |
| R31 | **MUST** | Inventory MUST be private by default. `inventory_select_own` is owner-only, and creating, editing, or photographing an item MUST NOT make it discoverable by anyone. |
| R32 | **MUST** | Publishing MUST be a separate, deliberate act on a different screen ([SPEC-009](SPEC-009-listings-and-offers.md)). |
| R33 | **MUST NOT** | The item form MUST NOT contain a publish toggle, a "share" switch, a visibility selector, a default-checked publish checkbox, or a "save and publish" primary button. There MUST be no "publish all" affordance anywhere. Private-by-default is a property of the flow, and one convenient switch on the create form converts it into private-by-accident. |
| R34 | **MUST** | The counterparty read path MUST be a narrow, explicitly-enumerated policy: `inventory_select_counterparty` grants row access **only** for an item behind a listing the caller can discover, or offered in an exchange request the caller is a party to. |
| R35 | **MUST** | The owner's private note MUST live in `public.inventory_notes` under an owner-only policy (R09). No counterparty-reachable view, embed, or RPC may return it. |
| R36 | **MUST** | Each inventory row MUST state its publication state — not published, listed at *n* places, reserved, exchanged. In a private-by-default model, "is anyone seeing this?" is the question the list exists to answer. |
| R37 | **MUST** | Archiving or soft-deleting a published item MUST withdraw its listing first, in the same transaction ([SPEC-009 R38](SPEC-009-listings-and-offers.md)). A listing pointing at an archived item is a listing that 404s at the moment someone taps request. |

### 5.5 Status, archive, and soft delete

| ID | Req | Statement |
| --- | --- | --- |
| R38 | **MUST** | `inventory_status` MUST follow the exchange lifecycle: `available` → `listed` (listing published) → `reserved` (request accepted) → `exchanged` (session completed), with `reserved` → `listed` on cancellation and `listed` → `available` on withdrawal or expiry. |
| R39 | **MUST NOT** | The client MUST NOT set any of those four values directly, ever. They are a **projection of another table's state**: `listed` is a fact about `listings`, `reserved` is a fact about `exchange_sessions`. Two writers for one fact means drift, and the specific drift is catastrophic — an owner who can set `available` on a reserved item can promise the same courgettes to two people who both drive to a library. |
| R40 | **MUST** | `trg_inventory_status_guard` MUST reject any status change attempted as role `authenticated` outside the owner-permitted set. The definer lifecycle RPCs run as the table owner, so `current_user` is the discriminator between "the state machine moved this" and "a client tried to" ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| R41 | **MUST** | The owner-permitted status changes are exactly three: `available` → `archived`, `available` → `composted`, `archived` → `available`. Everything else belongs to the lifecycle. |
| R42 | **MUST** | While an item is `listed` or `reserved`, these fields MUST be frozen against client writes: `species_id`, `variety_id`, `quantity`, `unit`, `condition`, `harvested_on`, `best_by`, `is_organic_claim`. Editing what was offered after it was offered is a bait-and-switch, and the database is where that is prevented. Photos and the private note remain editable. |
| R43 | **MUST** | Archive MUST be reversible and MUST preserve the row. Soft delete (`deleted_at`) MUST be terminal from the user's point of view and MUST remove the item from every list and picker. |
| R44 | **MUST** | Both archive and delete MUST be `UPDATE`s. There is no `DELETE` grant on this table, or on any table ([API Contract §1.3](../01-architecture/06-api-contract.md)). Archive keeps a completed exchange's subject intact for ratings, reports, and audit; delete is for "I typed this twice". |
| R45 | **MUST NOT** | An item in `reserved` MUST NOT be archivable or soft-deletable. You cannot un-promise something someone is currently driving to collect. The escape is cancelling the exchange, which is a real action with a real consequence ([SPEC-010](SPEC-010-exchange-lifecycle.md)). |
| R46 | **MUST** | `exchanged` is terminal. An exchanged item MUST NOT return to `available`; the goods physically changed hands. Re-listing means a new row. |
| R47 | **MUST** | `archive_reason` MUST come from a closed vocabulary (§6.2). Free text here would be an unreviewed string attached to a row that survives in analytics. |
| R48 | **SHOULD** | An item `available` and untouched for 21 days SHOULD surface an inline "still have these?" prompt in the list, with archive and edit actions. It MUST NOT push — nobody needs a lock-screen notification about old lettuce. |

### 5.6 Offline read and write

| ID | Req | Statement |
| --- | --- | --- |
| R49 | **MUST** | Inventory MUST be fully readable offline from the persisted Query cache, with `gcTime` of 30 days ([Mobile Architecture §2.2](../01-architecture/02-mobile-architecture.md)). |
| R50 | **MUST** | Create, edit, archive, un-archive, soft delete, and photo upload MUST be queueable offline, registered through `queryClient.setMutationDefaults(['inventory','upsert'])` **before** rehydration, or a paused mutation does not survive a restart ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)). |
| R51 | **MUST** | The row's UUID primary key MUST be generated client-side and **is** the idempotency key. A replayed insert conflicts on PK and is treated as success ([API Contract §3.1](../01-architecture/06-api-contract.md)). |
| R52 | **MUST** | A row with a pending mutation MUST render a pending-sync glyph **and** text. Never colour alone, and never nothing — an item that looks saved and isn't is the failure this whole section exists to prevent. |
| R53 | **MUST** | Conflict rules MUST be exactly those in [Mobile Architecture §2.5](../01-architecture/02-mobile-architecture.md): server edit wins on `updated_at` (silent); item deleted server-side → drop the mutation, toast; item now `reserved` → drop the mutation, screen-level notice on the item. |
| R54 | **MUST** | Conflict resolution MUST live in `domain/inventory/conflict.ts` as pure functions over plain data, unit-testable with no network and no React ([Mobile Architecture §1.1](../01-architecture/02-mobile-architecture.md)). |
| R55 | **MUST** | A queued edit touching a frozen field (R42) on an item that became `listed` or `reserved` while the client was offline MUST be dropped with an explicit, screen-level notice naming the fields. Silently applying it is impossible (the trigger rejects it); silently losing it is a user who believes they corrected a quantity. |
| R56 | **MUST** | The pending inventory mutation queue MUST be capped at **50**. Beyond the cap, saving MUST be refused with an explicit error rather than queued into a void. |
| R57 | **MUST NOT** | Lifecycle status changes MUST NOT be queued or optimistically applied offline. They require a live view of the world for the same reason exchange transitions do ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)). |
| R58 | **SHOULD** | The queue SHOULD drain in submission order per item, so a create-then-edit pair cannot invert into an edit against a row that does not yet exist. |

### 5.7 Lists, detail, and performance

| ID | Req | Statement |
| --- | --- | --- |
| R59 | **MUST** | The inventory list MUST be a `FlashList` with `estimatedItemSize={96}` and a `keyExtractor` returning the item UUID ([Mobile Architecture §9](../01-architecture/02-mobile-architecture.md)). |
| R60 | **MUST** | The list MUST be segmented: **Available**, **Listed**, **Reserved**, **History** (archived, composted, exchanged). A single undifferentiated list makes R36's question unanswerable. |
| R61 | **MUST** | Images MUST use `expo-image` with `recyclingKey={asset.id}`, or photos swap between rows during recycling — which on a produce app means showing someone else's courgettes as your tomatoes. |
| R62 | **MUST** | Item detail MUST paint from cache in under 150 ms warm; the network result reconciles afterwards. |
| R63 | **MUST** | Every list row MUST be a single accessible element with a composed label (§8.3). |
| R64 | **SHOULD** | The list SHOULD offer sort by newest, by `best_by` soonest, and by species, and SHOULD support search over the composed title within the user's own items. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.inventory_items`](../01-architecture/03-data-model.md#8-inventory) | read/write (owner); read (counterparty, narrow) | The spec's subject |
| `public.inventory_notes` | read/write (owner only) | **New.** The private note, moved off the item row (R09, R35) |
| `public.media_assets` | read/write (owner); read (counterparty via listing) | Up to 5 per item; invisible until `exif_stripped_at` is set |
| `public.gardens` | read | `garden_id` ownership check in `inventory_insert_own` |
| `public.crop_species` / `crop_varieties` | read (bundled + overlay) | Classification, `typical_units`, display title |
| `public.listings` | read | Publication state per row (R36); written by [SPEC-009](SPEC-009-listings-and-offers.md), never here |
| `public.exchange_requests` | read (inside `app.is_inventory_counterparty`, definer) | Offered-item visibility (R34) |
| `public.blocks` | read (inside `app.is_blocked_either_way`, definer) | Applied inside the counterparty predicate |
| `private.garden_locations` | **none** | Named to be explicit: no path from this spec reaches it, and no column in any inventory response could carry its contents |

**New schema objects introduced by this spec:** migration `20260808_0061_inventory_lifecycle_and_media.sql`

```sql
ALTER TABLE public.inventory_items
  ADD COLUMN archived_at   timestamptz,
  ADD COLUMN archive_reason text CHECK (archive_reason IN
      ('eaten','shared_offline','spoiled','planted','mistake','other')),
  ADD CONSTRAINT inventory_best_by_after_harvest
      CHECK (best_by IS NULL OR harvested_on IS NULL OR best_by >= harvested_on);

CREATE INDEX inventory_owner_status_idx ON public.inventory_items (owner_id, status)
  WHERE deleted_at IS NULL;

-- The owner's private note. A separate table rather than a column, because RLS is
-- row-level: a column on inventory_items would be reachable through any PostgREST
-- embed a counterparty can construct, and "the client doesn't select it" is not a
-- security control.
CREATE TABLE public.inventory_notes (
  item_id    uuid PRIMARY KEY REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note       text NOT NULL CHECK (length(note) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_notes FORCE ROW LEVEL SECURITY;
CREATE INDEX inventory_notes_owner_idx ON public.inventory_notes (owner_id);

CREATE POLICY inventory_notes_all_own ON public.inventory_notes
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

ALTER TABLE public.media_assets
  ADD COLUMN sort_order smallint NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at timestamptz;
CREATE INDEX media_subject_idx ON public.media_assets (subject_type, subject_id, sort_order)
  WHERE deleted_at IS NULL AND exif_stripped_at IS NOT NULL;
```

The counterparty read path (R34). This is the one place inventory leaves the owner:

```sql
CREATE OR REPLACE FUNCTION app.is_inventory_counterparty(p_item_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    -- (a) The item sits behind a listing the caller can discover. This clause
    -- re-implements listings_select_discoverable, because a SECURITY DEFINER
    -- function bypasses the policy it is standing in for.
    SELECT 1 FROM public.listings l
     WHERE l.inventory_item_id = p_item_id
       AND l.status IN ('active','reserved')
       AND l.expires_at > now()
       AND NOT app.is_blocked_either_way((SELECT auth.uid()), l.owner_id)
       AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = l.owner_id
                      AND p.is_suspended = false AND p.deleted_at IS NULL))
  OR EXISTS (
    -- (b) The item was offered in return in a request the caller is party to.
    SELECT 1 FROM public.exchange_requests r
     WHERE r.offered_item_id = p_item_id
       AND (SELECT auth.uid()) IN (r.requester_id, r.owner_id)
       AND NOT app.is_blocked_either_way(r.requester_id, r.owner_id));
$$;
GRANT EXECUTE ON FUNCTION app.is_inventory_counterparty(uuid) TO authenticated;

CREATE POLICY inventory_select_counterparty ON public.inventory_items
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND app.is_inventory_counterparty(id));

CREATE INDEX listings_inventory_item_idx ON public.listings (inventory_item_id);
CREATE INDEX exchange_requests_offered_idx ON public.exchange_requests (offered_item_id)
  WHERE offered_item_id IS NOT NULL;
```

> **Why this policy is new.** [API Contract §4.5 and §4.6](../01-architecture/06-api-contract.md) embed `item:inventory_items(…)` and `offered:inventory_items(…)` for a counterparty, but the only SELECT policy on the table is `inventory_select_own`. Without `inventory_select_counterparty`, every one of those embeds returns null for a non-owner and a listing detail screen shows no quantity, unit, or condition. Adding it is not optional; adding it *narrowly*, through a definer predicate rather than by loosening the owner policy, is what keeps the rest of the row private.

Guard triggers (R40, R42, R45, R46, R20):

```sql
CREATE OR REPLACE FUNCTION public.guard_inventory_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_client boolean := (current_user = 'authenticated');
BEGIN
  IF OLD.status = 'exchanged' AND NEW.status IS DISTINCT FROM 'exchanged' THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001';           -- R46
  END IF;

  IF OLD.status = 'reserved'
     AND (NEW.deleted_at IS NOT NULL OR NEW.status = 'archived') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001';           -- R45
  END IF;

  IF v_client AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (
           ('available','archived'), ('available','composted'), ('archived','available')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001';           -- R40, R41
  END IF;

  IF v_client AND OLD.status IN ('listed','reserved')
     AND ROW(NEW.species_id, NEW.variety_id, NEW.quantity, NEW.unit, NEW.condition,
             NEW.harvested_on, NEW.best_by, NEW.is_organic_claim)
         IS DISTINCT FROM
         ROW(OLD.species_id, OLD.variety_id, OLD.quantity, OLD.unit, OLD.condition,
             OLD.harvested_on, OLD.best_by, OLD.is_organic_claim) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001';           -- R42
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_inventory_status_guard
BEFORE UPDATE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_write();
```

Also introduced: `trg_inventory_variety_parent` (R14/R16, asserts `variety_id`'s species matches), `trg_inventory_media_cap` on `media_assets` (R20, raises `quota_exceeded`), and the daily `pg_cron` job `reap_deleted_media` (R28).

### 6.1 Status transition table

| From | To | Actor | Mechanism |
| --- | --- | --- | --- |
| — | `available` | Owner | INSERT |
| `available` | `listed` | Lifecycle | `publish_listing` ([SPEC-009](SPEC-009-listings-and-offers.md)) |
| `listed` | `available` | Lifecycle | `withdraw_listing`, or the expiry cron |
| `listed` | `reserved` | Lifecycle | `accept_exchange_request` ([Exchange State Machine §4](../01-architecture/07-exchange-state-machine.md)) |
| `reserved` | `listed` | Lifecycle | `cancel_session` |
| `reserved` | `exchanged` | Lifecycle | `confirm_handoff`, both parties confirmed |
| `available` | `archived` | **Owner** | PATCH |
| `available` | `composted` | **Owner** | PATCH |
| `archived` | `available` | **Owner** | PATCH |
| `exchanged` | — | — | Terminal (R46) |
| any | soft-deleted | Owner, except from `reserved` | PATCH `deleted_at` |

### 6.2 Closed vocabularies

| Vocabulary | Values |
| --- | --- |
| `archive_reason` | `eaten`, `shared_offline`, `spoiled`, `planted`, `mistake`, `other`. **Not** `composted` — that is the `inventory_status` value (Q3, resolved) |
| `quantity_unit` | The eleven values in [Data Model §4](../01-architecture/03-data-model.md) |
| `item_condition` | `just_picked`, `fresh`, `ripe`, `very_ripe`, `preserved`, `seed` |

**PII touched:** `inventory_items` columns are **P2** ([Data Model §8](../01-architecture/03-data-model.md)) — quantity, unit, condition, dates, organic claim, custom label — visible to a counterparty by design once published. `inventory_notes.note` is **P2 and owner-only**, and the whole point of §6's table split. `media_assets.path` is **P1**; the image content is the real exposure, which is why `exif_stripped_at` gates every read path (R21, R22). No **P0** or location data is touched: no column in this spec is a `geography`, `geometry`, or `h3_*`, and the photo pipeline exists specifically to destroy the one that arrives by accident.

## 7. API

### 7.1 `GET /rest/v1/inventory_items`

**Auth:** `authenticated`, owner (Pattern A) or narrow counterparty (R34)
**Rate limit:** 120 / min / user
**Shape:** [API Contract §4.4](../01-architecture/06-api-contract.md); this spec adds `archived_at` and `archive_reason` to the select list and **removes `notes`**, which no longer exists on this table.

```http
GET /rest/v1/inventory_items
    ?owner_id=eq.<me>&deleted_at=is.null&status=in.(available,listed,reserved)
    &select=*,media:media_assets(id,path,blurhash,width,height,sort_order),
            listings(id,status,expires_at,spots:listing_safe_spots(safe_spot_id))
    &order=created_at.desc&limit=50
```

The embedded `listings` is what answers R36. It is RLS-filtered by `listings_select_discoverable`, and for the owner that policy's first disjunct (`owner_id = auth.uid()`) matches, so an owner sees their own draft and expired listings too.

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | `quantity ≤ 0`, unknown `species_id`, `best_by < harvested_on`, text over limit |
| `not_authorized` | 403 | `garden_id` not owned by the caller |
| `invalid_transition` | 409 | Guard trigger: illegal status change, frozen-field edit, delete while `reserved` |
| `conflict` | 409 | PK replay — treated as success by the client (R51) |

### 7.2 `POST` / `PATCH /rest/v1/inventory_items`

Writes are plain PostgREST ([API Contract §1.1 R9](../01-architecture/06-api-contract.md)): the caller owns the row outright and the authorization *is* the RLS predicate. `id` is client-generated (R51). Soft delete and archive are both `PATCH`.

```jsonc
// POST body — the PK is the idempotency key
{ "id": "3d0f5a7b-…", "garden_id": "9c1e3d0f-…", "owner_id": "8f14e45f-…",
  "species_id": 412, "variety_id": 1188, "custom_label": null,
  "quantity": 4.00, "unit": "pound", "condition": "just_picked",
  "harvested_on": "2026-08-07", "best_by": "2026-08-12", "is_organic_claim": true }
```

`status` is **absent from every client write body**. A `PATCH` containing `status` for a lifecycle value is rejected by `trg_inventory_status_guard` (R40); the client-side repository type omits the field entirely so the mistake is a compile error before it is a 409.

### 7.3 `GET` / `PUT /rest/v1/inventory_notes`

**Auth:** `authenticated`, owner only (`inventory_notes_all_own`)
**Rate limit:** 60 / min / user

```jsonc
{ "item_id": "3d0f5a7b-…", "owner_id": "8f14e45f-…", "note": "The ones on the left are split." }
```

Upsert on `item_id`. There is no counterparty read path, no embed from `listings`, and no RPC that returns this column.

### 7.4 Media upload

1. Client copies the picked file into app-scoped storage (R29) and generates `media_assets.id`.
2. Client uploads to `crops/{owner_id}/{item_id}/{asset_id}.jpg` with a signed upload URL.
3. Storage `objectCreated` fires `media-process` ([API Contract §6.3](../01-architecture/06-api-contract.md)).
4. `media-process` strips EXIF, re-encodes, generates variants, computes blurhash, and sets `exif_stripped_at` **last** (R21).
5. The row becomes visible to every read path only at step 4's commit.

| Error code | HTTP | When |
| --- | --- | --- |
| `quota_exceeded` | 422 | Sixth photo on an item (R20); 20 uploads/hour or 50 MB/hour ([API Contract §7.2](../01-architecture/06-api-contract.md)) |
| `validation_failed` | 400 | > 10 MB, non-image MIME, dimensions > 12000 × 12000 (R26) |
| `server_error` | 500 | `media-process` failed after 3 retries; `moderation_state` set to `rejected` and the owner notified. **The asset stays unreadable.** |

### 7.5 What this spec deliberately does not call

| Not called | Why |
| --- | --- |
| Any RPC that sets `inventory_status` | R39. The lifecycle owns it; this spec only reads it. |
| `get_my_garden_location` | Inventory has no use for a coordinate. Calling it here would put an exact point in the inventory screen's memory for no product reason, against a 10/min limit that exists because any volume on it is anomalous. |
| A share or export endpoint | There is no path that makes an item visible without a listing (§3). |
| A realtime channel for inventory | Inventory is mostly self-mutated; it is invalidated by the `user:{user_id}` channel on lifecycle changes and refetched on focus ([Realtime & Notifications §8.1](../01-architecture/08-realtime-and-notifications.md)). |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Inventory list | `/inventory` | Segmented list; the answer to "what do I have and who can see it" |
| Item detail | `/inventory/[itemId]` | Full record, photos, publication state, actions |
| New item | `/(modals)/item-new` | Create. Reached from the list and from the map FAB ([SPEC-008 R42](SPEC-008-interactive-map.md)) |
| Edit item | `/(modals)/item-edit/[itemId]` | Same form, frozen fields disabled with a reason when `listed`/`reserved` |
| Species picker | `/(modals)/species-picker` | [SPEC-005 §8.1](SPEC-005-crop-taxonomy.md) |
| Archive sheet | Inline sheet on detail | Reason picker from the closed vocabulary |

Form field order, top to bottom: photos (horizontal strip, add tile first) → species (required, opens the picker) → variety (optional, appears once a species is chosen) → custom label (optional, collapsed under "Add a label") → quantity + unit (side by side, numeric keypad, unit as a wheel) → condition (segmented, no preselection) → harvested on (defaults today) → best by (optional) → organic claim (switch, off, with the §8.3 helper text) → private note (collapsed) → **Save**. No publish control appears anywhere on this screen (R33).

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | The list paints from the persisted cache on the first frame; a network refetch runs silently behind it. A skeleton appears only on a genuinely cold cache (first launch after install, or after a `buster` bump), and it is a three-row skeleton, not a spinner. Item detail paints from the list's cached row instantly and fills in photos as they resolve from blurhash. |
| Empty | Two cases. **Never added anything:** an illustrated state with one primary action, "Add your first item", plus a one-line explanation that inventory is private until you offer something — because the first question a new user has about a list of their own produce is who else can see it. **Segment empty** (e.g. nothing Reserved): a one-line inline row, "Nothing reserved right now", with no illustration and no action. An empty segment is a fact, not an event. |
| Error (recoverable) | Refetch failed (5xx, timeout). The cached list stays fully interactive — including creating new items, which queue — and a persistent bottom banner offers Retry. A save that fails with a retryable error is queued, not lost, and the row shows the pending glyph. |
| Error (terminal) | Item detail for an id that no longer exists (deleted on another device, or a stale deep link). An in-place card, "This item is gone", with a single action back to the list. The router resolves after `fetchQuery`, so this is reached rarely and never as a half-rendered screen ([Mobile Architecture §3.1](../01-architecture/02-mobile-architecture.md)). |
| Offline | **Fully functional, and the only screen in the app where that is true for writes.** Read, create, edit, archive, delete, and attach photos all work; each affected row carries a pending-sync glyph and the text "Waiting to sync" (R52). A single non-dismissible header strip reads "Offline — changes will sync". Publishing is disabled with a reason, because publishing is not queueable ([SPEC-009](SPEC-009-listings-and-offers.md)). Photos show from the local copy until processed. |
| Permission denied | Two distinct cases, neither of which is about inventory itself. **Camera/library denied:** the photo strip shows a single row offering "Choose from library" or a deep link to OS settings; every other field works and the item saves without photos. **Unverified user:** inventory is fully available (R12); only the "Publish" action on item detail is disabled, with the explanatory sheet from [Mobile Architecture §3.2](../01-architecture/02-mobile-architecture.md) — a disabled control with a reason, never a hidden one. |
| Rate limited | 429 on a write (60/min) is reachable only by a stuck retry loop. Writes are queued rather than failed, the queue drains after `Retry-After`, and no auto-retry is issued into the limit ([API Contract §7.3](../01-architecture/06-api-contract.md)). A 429 on media upload (20/hour) is user-visible and shows the quota copy with a countdown. |

Two additional states specific to this screen:

| State | Behaviour |
| --- | --- |
| Frozen (listed or reserved) | The frozen fields (R42) render disabled with a single explanatory row above them, not with a per-field error. Photos and the note remain enabled. The item detail's primary action changes from "Edit" to "Withdraw listing" when `listed`, and to "View exchange" when `reserved`. |
| Photo processing | A newly uploaded photo shows the local copy at 60% opacity with a small progress ring until `exif_stripped_at` is set, then crossfades to the processed asset. If processing fails, the tile becomes an error tile with "Retry" and the local copy is retained until the retry succeeds or the user removes it. It is never silently swapped for a grey box. |

### 8.3 Copy

Exact strings.

**Empty inventory**
> **Nothing in your inventory yet.**
> This is your private list of what you've got. Nobody sees it until you offer something.
>
> Button: `Add your first item`

**Empty segment (Reserved)**
> Nothing reserved right now.

**Organic claim, form label and helper**
> Grown without synthetic pesticides
> This is your claim, not a certification. Sharecropr doesn't verify it.

**Organic claim, as shown to a requester**
> Organic — grower's claim, not certified

**Private note, form label and helper**
> Private note
> Only you can see this. Use the description on your listing for anything the other person needs to know.

**Custom label, form helper**
> A name just for you, so you can tell two piles apart. It doesn't change what this is.

**Publication state, list row**
> Not published · Listed at {n} places · Reserved · Exchanged {relative_time}

**Frozen fields notice**
> **This item is listed, so these details are locked.**
> Withdraw the listing to change what you're offering. You can still add photos and edit your private note.

**Frozen fields notice (reserved)**
> **Someone's coming to collect this.**
> You can't change or remove it while an exchange is in progress. If something's changed, cancel the exchange and tell them why.

**Delete confirmation**
> **Delete this item?**
> This removes it completely. If you had it and it's gone, archive it instead — that keeps your history.
>
> Buttons: `Archive instead` · `Delete`

**Archive sheet**
> **What happened to it?**
> Options: `We ate it` · `Gave it away` · `It spoiled` · `Composted it` · `Planted it` · `Added by mistake` · `Something else`

**Un-archive**
> Moved back to Available.

**Cannot delete while reserved**
> You can't remove this while someone's arranging to collect it.

**Offline header strip**
> Offline — changes will sync

**Pending row glyph label**
> Waiting to sync

**Queue full (R56)**
> **Too many unsaved changes.**
> You've got 50 changes waiting to sync. Connect to save them before adding more.

**Conflict: item removed elsewhere**
> That item was removed on another device.

**Conflict: item now reserved (R55)**
> **We couldn't save your change.**
> Someone arranged to collect this while you were offline, so {field_list} is locked. Your other changes were saved.

**Photo processing failed**
> That photo didn't upload. `Retry`

**Photo limit**
> Five photos is the limit. Remove one to add another.

**Photo too large**
> That photo's too big — 10 MB is the limit.

**Camera permission denied**
> Sharecropr can't use the camera. You can still choose a photo from your library. **Open settings**

**Item not found**
> **This item is gone.**
> It was deleted, or you're following an old link.
>
> Button: `Back to inventory`

**Stale-item prompt (R48)**
> Still have these? Added {n} days ago. `Archive` · `Edit`

**List row accessibility label (R63)**
> {title}, {quantity} {unit}, {condition}. Harvested {relative_date}. {publication_state}. {pending_state}. Double tap to open.

**Add photo button**
> `accessibilityLabel`: Add a photo · `accessibilityHint`: Opens the camera or your photo library

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Get a photo with its EXIF intact, and with it a home address.** Everything else in this spec is a P2 fact about vegetables; the photo is the one artefact that can carry a P0 coordinate, and the attack does not need an attacker — it needs one deploy where an asset is served before `media-process` finishes. The control is that `exif_stripped_at IS NULL` makes the row invisible in every read policy, so the ordering (strip → variants → blurhash → **set the timestamp last**) is the enforcement, and the failure mode is a missing photo rather than a leaked one. The second-worst is **reading another user's private inventory**: it is a narrow, definer-mediated path (`app.is_inventory_counterparty`) rather than a loosened owner policy, precisely so that widening it requires editing a function that a security reviewer owns. The third is a **counterparty reading the owner's private note**, which is why the note is a separate table rather than a column that any PostgREST embed could name. |
| Which RLS policies enforce access? | `inventory_select_own`, `inventory_insert_own`, `inventory_update_own` (Pattern A, [RLS Design §5](../01-architecture/05-rls-design.md)), plus the new `inventory_select_counterparty` (`deleted_at IS NULL AND app.is_inventory_counterparty(id)`) and `inventory_notes_all_own` (owner-only, `FOR ALL`). There is **no DELETE policy on either table**, and that absence is the denial. Definer functions: `app.is_inventory_counterparty()` — which re-implements `listings_select_discoverable` because it bypasses it — `app.is_blocked_either_way()`, and the guard triggers `guard_inventory_write` and the media-cap trigger. Media reads are governed by the `media_assets` policies, which additionally require `exif_stripped_at IS NOT NULL` and `moderation_state <> 'rejected'`. |
| Can any response path expose an exact coordinate or PII? | Not by column: nothing in this spec is a `geography`, `geometry`, `lat`, `lng`, or `h3_*`, so the CI contract sweep (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)) adds no allowlist entry here. By **content**, yes, in exactly one way — an unstripped photo — and that is closed by R21/R22 and asserted with a real geotagged JPEG in CI (API-09). A secondary content channel is `custom_label` and the listing description, which a user could type an address into; that is `content-scan`'s territory ([API Contract §6.5](../01-architecture/06-api-contract.md)) and is advisory, not preventive. |
| What is logged, and is it scrubbed? | Inventory writes are not audited to `audit.events` — they are ordinary user data, and auditing every quantity edit would swamp the table that exists for moderation and verification decisions. Lifecycle-driven status changes *are* audited, by the exchange RPCs that make them. Client-side, item payloads reach Sentry only inside a scrubbed breadcrumb; the `beforeSend` coordinate rule applies at any depth, and the PostHog wrapper rejects any coordinate-shaped property. Photo bytes never reach telemetry. Analytics events carry `species_id`, `unit`, and counts — never `custom_label` or the private note, both of which are free text a user could put anything in. |
| Does this need step-up authentication? | No. Recording produce is not an account-security operation, and requiring a TOTP code to log a harvest would guarantee nobody logs a harvest. AAL2 is reserved for the operations in [API Contract §2.4](../01-architecture/06-api-contract.md). |
| Abuse / rate-limit controls | `inventory_items` writes: 60/min/user at Kong. Media upload: 20/hour and 50 MB/hour per user, plus the hard 5-per-item cap enforced in the database (R20). Reads: 120/min/user. The abuse surface is small because the data is private: there is no cross-user read to scrape and no counter to inflate. The genuine risk is **storage cost**, which the hourly byte cap addresses, and **image-based abuse**, which `moderation_state` and `content-scan` address asynchronously — honestly asynchronously, per [Mobile Architecture §12.6](../01-architecture/02-mobile-architecture.md). |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | User creates three items and two photos in airplane mode, then force-quits the app. | All five mutations survive: they were registered via `setMutationDefaults` before rehydration (R50) and the photo files were copied into app-scoped storage before enqueueing (R29). On next launch with connectivity, `resumePausedMutations` drains them in submission order (R58) and the pending glyphs clear one by one. |
| EC-02 | Offline edit of quantity on an item that was accepted for an exchange while the device was offline. | The queued PATCH reaches the frozen-field guard and raises `invalid_transition` 409. The client drops the mutation, refetches, and shows the §8.3 "Someone's coming to collect this" notice naming `quantity` (R55). The item's other queued changes (a photo, the private note) still apply. |
| EC-03 | Two devices, same account, edit the same item offline and both come online. | Last-write-wins on `updated_at`, silently ([Mobile Architecture §2.5](../01-architecture/02-mobile-architecture.md)). Both devices converge on the later write. No merge UI, because a merge dialog for "4 pounds vs 5 pounds" is worse than the wrong number with an edit button. |
| EC-04 | The same item is created twice because the user tapped Save twice on a slow connection. | One row. The PK is client-generated and stable across retries (R51); the second insert conflicts on PK and the client treats `conflict` 409 as success. This is why the intent generates the id once, at button press, and not per attempt. |
| EC-05 | `media-process` fails on a corrupt JPEG after three retries. | `moderation_state = 'rejected'`, `exif_stripped_at` stays NULL, the asset is invisible to every read path including the owner's, the owner is notified, and the tile becomes an error tile with Retry. The item is otherwise unaffected and remains publishable. |
| EC-06 | A user uploads a geotagged photo and immediately opens the item on a second device. | The second device sees the item with no photo until `exif_stripped_at` commits — a gap of a second or two. That gap is the correct behaviour and is why the timestamp is set last: an asset visible before stripping is the entire threat. |
| EC-07 | User tries to add a sixth photo. | `quota_exceeded` 422 from the media-cap trigger, rendered as "Five photos is the limit." The client also disables the add tile at five, but the database is the enforcement — an offline client cannot count assets it has not synced (R20). |
| EC-08 | User archives an item that is currently `listed`. | The client calls `withdraw_listing` first and archives in the same user action ([SPEC-009](SPEC-009-listings-and-offers.md), R37). If the withdrawal fails, the archive does not happen and the user sees the withdrawal's error. A listing pointing at an archived item never exists. |
| EC-09 | User tries to delete an item in `reserved`. | Rejected by the guard trigger (R45) and, before that, by the client disabling the action with the §8.3 copy. Both layers exist because the client can be stale; only the trigger is the guarantee. |
| EC-10 | An exchange completes; the item goes `exchanged`. The user then wants to relist the same crop. | `exchanged` is terminal (R46). The item moves to History and the user creates a new row for the new harvest. This is correct: the completed exchange's subject must stay intact for ratings, reports, and the 90-day session record ([Data Model §14](../01-architecture/03-data-model.md)). |
| EC-11 | A species is merged in the taxonomy while the item exists. | `inventory_items.species_id` is repointed by the merge migration ([SPEC-005 R35](SPEC-005-crop-taxonomy.md)) inside one transaction. The item's title changes on the next taxonomy delta; nothing else moves and no user action is needed. |
| EC-12 | A pending variety on the item is rejected. | `variety_id` is set to NULL and the proposed name is copied into `custom_label` where that column was empty ([SPEC-005 R50](SPEC-005-crop-taxonomy.md)). The item survives, the title changes from "Cherokee Purple Tomato" to "Cherokee Purple" (the label) — which is exactly what the user meant. |
| EC-13 | The user's garden is rejected in verification while they have 20 items. | Nothing happens to the inventory. CRUD continues to work (R12); only publishing is gated. Deleting a user's records because a photo review failed would be both wrong and the fastest way to lose them. |
| EC-14 | A counterparty constructs `GET /rest/v1/inventory_items?select=*,notes` for an item behind a listing. | `notes` is not a column on `inventory_items` (§6) — PostgREST returns a schema error, not a value. The private note is only reachable through `inventory_notes`, whose policy is owner-only. This is the concrete reason for the table split rather than a column-level convention. |
| EC-15 | The blocked case: A blocks B, then B opens a cached listing detail for A's item. | `app.is_inventory_counterparty` returns false because of the `is_blocked_either_way` clause, so the row leaves the result set entirely rather than being filtered client-side, and the screen resolves to "This item is gone". B is never told a block exists ([RLS Design §6](../01-architecture/05-rls-design.md)). |
| EC-16 | 50 pending mutations queued and the user keeps adding. | Saving is refused with the §8.3 queue-full copy (R56). The alternative — an unbounded queue — is a device that spends ten minutes draining into failures when it reconnects, with the user watching. |
| EC-17 | A list of 200 items in peak August, scrolled hard. | `FlashList` at `estimatedItemSize={96}` with `recyclingKey` on every image (R59, R61); ≥ 58 fps with no frame over 32 ms ([Mobile Architecture §9](../01-architecture/02-mobile-architecture.md)). Segmenting by status (R60) means no single segment is usually the full 200. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `inventory.item_created` | product event | `species_id`, `unit`, `condition`, `has_photo`, `photo_count`, `was_offline`, `entry_point` (`list`\|`map_fab`\|`empty_state`) | — |
| `inventory.time_to_save_ms` | histogram | `had_variety`, `photo_count` | p50 > 30 s ⇒ the form is too long (Goal 1) |
| `inventory.item_edited` | product event | `fields_changed`, `was_frozen_attempt` | `was_frozen_attempt` > 5% ⇒ the frozen state is not legible enough |
| `inventory.item_archived` | product event | `archive_reason`, `age_days` | `spoiled` > 25% ⇒ a product signal, not a bug: supply is rotting before it moves |
| `inventory.item_deleted` | product event | `age_minutes` | `age_minutes` < 2 in bulk ⇒ people are correcting a mis-save, so look at the form |
| `inventory.offline_write_queued` | product event | `mutation`, `queue_depth` | `queue_depth` p95 > 20 ⇒ the drain is not working |
| `inventory.offline_write_drained` | product event | `mutation`, `queued_for_seconds`, `outcome` (`applied`\|`dropped_conflict`\|`failed`) | `dropped_conflict` > 2% of drains |
| `inventory.queue_cap_hit` | error event | — | **Any occurrence** — R56 should be unreachable in normal use |
| `inventory.conflict_resolved` | product event | `rule` (`lww`\|`deleted`\|`reserved`\|`frozen_field`) | `frozen_field` rising ⇒ people are editing listed items, so reconsider the freeze scope |
| `inventory.photo_uploaded` | product event | `bytes`, `source` (`camera`\|`library`), `duration_ms` | p95 `duration_ms` > 8 s on Wi-Fi |
| `inventory.photo_process_failed` | error event | `stage`, `attempt`, `mime` | > 1% of uploads ⇒ `media-process` regression |
| `inventory.photo_unprocessed_age` | gauge | `max_age_seconds` | > 300 s ⇒ the storage webhook is not firing, and photos are silently missing |
| `inventory.exif_present_post_process` | error event | `asset_id` | **Any occurrence — page immediately.** This is the one failure in this spec that is a privacy incident rather than a bug |
| `inventory.status_write_rejected` | error event | `from`, `to` | **Any occurrence** — a client attempted a lifecycle status write (R39), which means the repository type drifted |
| `inventory.list_frame_drops` | counter | `item_count`, `frames_over_32ms` | > 2% of sessions |
| `inventory.stale_prompt_actioned` | product event | `action` (`archive`\|`edit`\|`dismiss`) | — |

**Never emitted:** `custom_label`, the private note, a photo path, a photo's bytes, or any property derived from image content. All four are free-form user input and one of them used to carry a GPS coordinate.

## 12. Accessibility

- Every list row is **one** accessible element with the composed label in §8.3 — title, quantity, unit, condition, harvest recency, publication state, sync state — rather than seven separate stops ([Mobile Architecture §10.2](../01-architecture/02-mobile-architecture.md)).
- **Publication state and sync state are text, never colour or a bare dot.** "Listed at 2 places" and "Waiting to sync" are read aloud; a green dot is not. This is the single most important accessibility decision in this spec, because publication state is the safety-relevant fact on the screen.
- The condition control is a segmented control with `accessibilityRole="radiogroup"` semantics and no preselection (R05); the reader announces "Condition, none selected" until the user chooses, which is honest about the required field.
- Quantity and unit are two separate fields with associated labels, not one combined string. The unit wheel has `accessibilityRole="adjustable"` with `accessibilityValue={{ text: "pounds" }}`.
- Frozen fields set `accessibilityState={{ disabled: true }}` **and** are preceded by the explanatory row (§8.3), which is the accessible element that carries the reason. A disabled field with no announced reason is the accessibility equivalent of a hidden button.
- Photo tiles are labelled "Photo {n} of {m}" with actions for "Make cover" and "Remove" exposed through `accessibilityActions`, so reordering does not require a drag gesture — a drag-only reorder is unusable with a screen reader.
- The offline strip and the per-row pending state use `accessibilityLiveRegion="polite"`, so a sync completing is announced without stealing focus.
- Dynamic type to 200% with no capping in this feature. Rows grow; the quantity and unit fields stack vertically above 130% rather than truncating.
- Hit targets ≥ 44 × 44 dp for every row, photo tile, and inline action, via the `Pressable` primitive's default `hitSlop`.
- Reduced motion: the photo processing crossfade becomes an instant swap and the pending glyph does not pulse.
- Destructive confirmations (delete, archive) are dialogs with labelled buttons in a fixed order, never swipe-only. Swipe-to-delete exists as an accelerator on the row and always has an equivalent button in the detail screen.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01, R31 | Owner reads and writes own items; a second user reads zero rows; `anon` reads zero rows; insert with someone else's `garden_id` is denied |
| T02 | integration | R02, R03 | Missing `species_id`/`quantity`/`unit`/`condition` rejected; `quantity` of 0 and −1 rejected by CHECK; 3-decimal input rounded client-side to 2 |
| T03 | integration | R04 | Every one of the eleven `quantity_unit` values round-trips; an unknown unit is rejected; the client's unit list is generated from `types.generated.ts` and asserted equal to the enum |
| T04 | unit | R05, R11 | The form has no preselected condition; `unit` defaults from `typical_units[1]`; `harvested_on` defaults to today |
| T05 | integration | R06, R07 | `harvested_on` tomorrow rejected; `best_by` before `harvested_on` rejected by `inventory_best_by_after_harvest` |
| T06 | e2e | R08 | The organic-claim disclaimer string appears on the form, item detail, listing card, and listing detail — asserted by string, on all four |
| T07 | rls | R09, R35 | `inventory_notes` readable and writable only by the owner; a counterparty with a valid listing relationship reads zero rows |
| T08 | integration | R10 | 61-character `custom_label` and 301-character note rejected by CHECK, not only by zod |
| T09 | e2e | R12 | An unverified user with an unverified garden completes full inventory CRUD; only the publish action is disabled, with a reason |
| T10 | e2e | R13, R14, R16 | Species chosen only via the picker; a variety from another species is rejected by `trg_inventory_variety_parent`; changing species clears an incompatible variety in the same write |
| T11 | integration | R15, R19 | Static check: `custom_label` appears in no filter, group-by, index, ranking expression, or classification path in `src/` or `supabase/migrations/` |
| T12 | rls | R17 | A pending variety renders for the owner; a counterparty's listing read returns the species name and no variety |
| T13 | unit | R18 | `domain/inventory/title.ts` parameterised over the three branches; every surface imports it (module-boundary test) |
| T14 | integration | R20 | Sixth photo returns `quota_exceeded` 422 from the trigger, including when inserted directly with `service_role` bypassing the client |
| T15 | integration | R21, R22 | Real geotagged JPEG uploaded; post-process bytes contain no EXIF/XMP/IPTC block (API-09); the row is invisible to every role until `exif_stripped_at` is set |
| T16 | rls | R23 | `media_assets` with `exif_stripped_at IS NULL` returns zero rows for owner, counterparty, moderator, and `anon` |
| T17 | unit | R24 | A local file URI never reaches the `media_assets` insert payload and is never persisted as `path` |
| T18 | e2e | R25 | Both camera and library paths complete an upload and produce identically stripped assets |
| T19 | integration | R26 | 11 MB file, `application/pdf`, and a 13000 × 13000 image all rejected before decode |
| T20 | e2e | R27 | Reorder photos without re-upload; `sort_order = 0` becomes the cover on the list and the listing card |
| T21 | integration | R28 | Deleting a photo sets `deleted_at`; the `reap_deleted_media` job removes the storage object; a synthetic object older than 24 h with a deleted row fails the assertion |
| T22 | e2e | R29, R50, R51 | Airplane mode: create three items and two photos, force-quit, relaunch, reconnect — all five apply exactly once, in order |
| T23 | e2e | R32, R33 | Static and visual check: the item form contains no publish/share/visibility control; no "publish all" affordance exists in the inventory feature |
| T24 | rls | R34 | Counterparty reads an item behind a discoverable listing and an item offered in their own request; reads zero rows for any other item, for an expired listing, for a withdrawn listing, and for a suspended owner |
| T25 | e2e | R36, R60 | Each row states its publication state; segments partition the set with no item in two segments and none missing |
| T26 | integration | R37 | Archiving a `listed` item withdraws the listing in the same transaction; a failed withdrawal aborts the archive |
| T27 | integration | R38 | Full lifecycle drive: publish → accept → complete moves the item `available` → `listed` → `reserved` → `exchanged`, each by the corresponding RPC |
| T28 | rls | R39, R40, R41 | As `authenticated`, PATCH `status` to `listed`, `reserved`, and `exchanged` — all `invalid_transition` 409. The three owner-permitted transitions succeed |
| T29 | integration | R42 | Each of the eight frozen fields rejected individually while `listed` and while `reserved`; photos and the note still writable |
| T30 | integration | R43, R44 | Archive is reversible and preserves the row; soft delete removes the item from every list and picker; no `DELETE` grant exists on either table |
| T31 | integration | R45 | Archive and soft delete both rejected while `reserved`, at the trigger |
| T32 | integration | R46 | `exchanged` → `available` rejected for `authenticated` **and** for a definer caller; the state is terminal for everyone |
| T33 | integration | R47 | `archive_reason` outside the closed vocabulary rejected by CHECK |
| T34 | unit | R48 | The stale prompt appears at 21 days and enqueues no notification |
| T35 | e2e | R49 | Airplane mode with a warm cache: the full inventory reads, including detail and photos |
| T36 | unit | R52 | A row with a pending mutation renders both the glyph and the text; the state is asserted from the accessible label, not the pixel |
| T37 | unit | R53, R54 | `resolveInventoryConflict` parameterised over all four rules, pure, no network, no React import |
| T38 | e2e | R55 | Offline edit of `quantity` on an item that becomes `reserved`: the mutation is dropped, the notice names `quantity`, and the queued photo still applies |
| T39 | unit | R56 | The 51st queued mutation is refused with the queue-full error rather than enqueued |
| T40 | integration | R57 | No lifecycle status mutation is registered in `setMutationDefaults`; a module test asserts the repository has no status-writing method |
| T41 | unit | R58 | Create-then-edit for one item drains in order; an edit never precedes its create |
| T42 | perf | R59, R61, R62 | Device-farm run: 200 items, ≥ 58 fps with no frame over 32 ms, detail paints < 150 ms warm, no image swapping during recycling |
| T43 | manual | R63, §12 | VoiceOver and TalkBack over the list, form, frozen state, and photo reordering at 200% type |
| T44 | unit | R64 | Each sort produces a stable total order; search matches the composed title and only the caller's own items |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T45 | Read another user's `inventory_items` by id with a crafted PostgREST filter | Zero rows. `inventory_select_own` and `inventory_select_counterparty` are the only SELECT policies, and neither matches. Repeated for `anon`, for a moderator, and for a user with an unrelated pending request |
| T46 | `GET /rest/v1/inventory_items?select=*,inventory_notes(note)` as a counterparty with a valid listing relationship | Zero rows for the embed. `inventory_notes_all_own` is owner-only; the relationship that grants the item row grants nothing on the note table (R09, EC-14) |
| T47 | `PATCH /rest/v1/inventory_items?id=eq.X` with `{"status":"available"}` on a `reserved` item, as the owner | `invalid_transition` 409 from `trg_inventory_status_guard`. This is the double-commit attack: an owner freeing a reserved item to promise it again. Asserted with two concurrent acceptors to prove the guard holds under contention |
| T48 | `PATCH` with `{"owner_id": "<someone else>"}` | Denied by `inventory_update_own`'s `WITH CHECK`. Ownership transfer is not a feature and must not be reachable by writing a column |
| T49 | `PATCH` with `{"quantity": 40}` on a `listed` item | `invalid_transition` 409 (R42). The bait-and-switch case: advertise four pounds, be requested, then edit to forty — or to zero point four |
| T50 | `DELETE /rest/v1/inventory_items?id=eq.X` | Denied; no DELETE policy and no `DELETE` grant to `authenticated` on any table ([API Contract §1.3](../01-architecture/06-api-contract.md)) |
| T51 | Insert a `media_assets` row directly, pointing `subject_id` at another user's item | Denied by the `media_assets` insert policy (`owner_id = auth.uid()`) and by the polymorphic-integrity trigger, which asserts the subject is owned by the same user |
| T52 | Read a `media_assets` row whose `exif_stripped_at IS NULL` via a signed URL obtained before processing | The signed URL is issued only for processed assets; a URL for the raw upload path is scoped to the uploader's own write and 401s on read. Asserted on the wire |
| T53 | Upload a geotagged JPEG and fetch every variant plus the original | No EXIF, XMP, or IPTC block in any variant. Run against a fixture with GPS, timestamp, camera serial, and a thumbnail that itself carries GPS — the last is the one naive strippers miss |
| T54 | Upload a polyglot file (valid JPEG header, ZIP payload) and a 200 MB decompression bomb | Rejected on MIME sniff and on decoded dimensions respectively; `media-process` never allocates the decode buffer |
| T55 | Block a counterparty and re-read a previously visible item | Zero rows: `app.is_inventory_counterparty` includes `is_blocked_either_way` in both clauses. The blocked party is never told ([RLS Design §6](../01-architecture/05-rls-design.md)) |
| T56 | Suspend an owner and re-read their listed item as a counterparty | Zero rows. The suspension clause is inside `app.is_inventory_counterparty`, which is why the definer function re-implements `listings_select_discoverable` rather than trusting it |
| T57 | Call `app.is_inventory_counterparty` directly with an arbitrary item id, 10,000 times | It is `STABLE` and returns a boolean, so it is an oracle for "does this item exist behind a listing I can see" — which is information the caller already has from `search_listings`. The enumeration is bounded by the 120/min read limit and asserted to leak nothing beyond that boolean |
| T58 | Create 10,000 inventory items via the API | Bounded at 60 writes/min/user by Kong. No per-user item cap exists in MVP; a rising trend alerts, because a 10,000-item inventory is a bot or a bug, not a gardener |
| T59 | Set `custom_label` to a street address and publish | Accepted at the storage layer and flagged asynchronously by `content-scan` ([API Contract §6.5](../01-architecture/06-api-contract.md)). Asserted so this is a known, tested limitation rather than an assumed protection — flagging is not prevention |
| T60 | Craft a request for `private.garden_locations` from the inventory feature's repository | Schema not in `db-schemas`; no grant; 404 at the API layer before Postgres ([API Contract §1.3](../01-architecture/06-api-contract.md)) |
| T61 | Contract sweep over `inventory_items`, `inventory_notes`, `media_assets` and every embed reachable from them | No column matching the coordinate regex (API-04); nothing added to the two-line allowlist |
| T62 | Fire a synthetic Sentry event from the item form containing a photo path and a private note | Both scrubbed; asserted absent from the outgoing payload. `custom_label` and the note are on the client-side deny-list for breadcrumb serialization |
| T63 | Read MMKV after an inventory session on a rooted-device simulation | Item rows are present (this is the intended offline cache and is encrypted, [Mobile Architecture §2.3](../01-architecture/02-mobile-architecture.md)); **no coordinate key** is present, and `qk.meLocation()` is absent |
| T64 | Replay a queued create with a mutated body but the same PK | The insert conflicts on PK and returns the **original** row. Asserted so that a tampered replay cannot overwrite a committed row through the idempotency path ([API Contract §3.1](../01-architecture/06-api-contract.md)) |

### 13.3 Manual QA

- [ ] Record a real harvest end to end in a real garden, on cellular with one bar, and time it against the 30-second goal.
- [ ] Airplane mode: create four items with photos, force-quit, walk out of range, come back, and confirm every item and photo arrives exactly once.
- [ ] Upload a photo taken with GPS enabled and confirm with `exiftool` that no variant retains any tag — including the embedded thumbnail.
- [ ] Confirm on both platforms that a photo is never visible anywhere before `exif_stripped_at` is set, including on the uploading device.
- [ ] Drive a full exchange on a preview branch and watch the item's status move through all four lifecycle values without the client ever writing one.
- [ ] Attempt, deliberately, to edit a listed item's quantity from a stale client and confirm the notice names the field.
- [ ] Confirm the private note is invisible to a counterparty on the listing detail, the exchange screen, and the thread.
- [ ] Screen-reader pass over the list, the form, the frozen state, and photo reordering.
- [ ] Confirm all copy at 200% type in both themes; check that quantity and unit stack rather than truncate.
- [ ] Fill the offline queue to 50 and confirm the refusal is explicit and recoverable.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | None. Inventory is a core tab with no fallback product; flagging it would mean shipping an app with an empty tab. The one flag-shaped decision, `inventory.offline_writes`, is **not** a flag either — it is the reason the feature exists and turning it off would be a different product. |
| Migration required | Yes. `20260808_0061_inventory_lifecycle_and_media.sql` — two columns and one CHECK on `inventory_items`, two columns on `media_assets`, the new `inventory_notes` table with policies and pgTAP tests in the same PR ([Data Model §15.4](../01-architecture/03-data-model.md)), the `inventory_select_counterparty` policy, `app.is_inventory_counterparty`, three triggers, and one cron job. |
| Backfill required | Yes, once: existing `inventory_items.notes` values are copied into `inventory_notes` in the same migration, then the column is dropped in a **later** release under expand → migrate → contract ([Data Model §15.2](../01-architecture/03-data-model.md)). Dropping it in the same migration would break any client already in the field that selects it. |
| Rollback plan | Client-only. An EAS Update reverts the inventory bundle; the schema is additive and older clients keep working, since `inventory_notes` is a table they simply never call. The one irreversible element is the note backfill, which is a copy rather than a move for exactly that reason. |
| Client version floor | None for reads. The `notes` column drop in the contract release is gated on `devices.app_version` telemetry showing < 2% of DAU on a version that selects it ([Data Model §15.3](../01-architecture/03-data-model.md)). |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Should there be a per-user item cap? None exists today (T58). A cap prevents a runaway client from filling a table, but a real August allotment can legitimately hold 150 rows and a cap that bites a real user at harvest time is worse than a bot we can suspend. | Architecture | Post-launch, first season |
| Q2 | Is freezing all eight fields on `listed` too strict? A user who miscounted and wants to change 4 lb to 3 lb currently has to withdraw and republish, losing their position and any pending requests. A "reduce quantity only" exception is defensible and is also exactly the shape of a bait-and-switch. | Product | Post-launch, first season |
| Q3 | ~~Should `composted` be a status at all, given `archive_reason` already carries `composted`?~~ **Resolved 2026-10-21:** `composted` stays an `inventory_status` value — it is a lifecycle end state, and the baseline migration (`20260822000001_baseline.sql`) already ships it. It is removed from the `archive_reason` vocabulary (§6, §6.2) so the concept has exactly one home. Closes [N-15](../07-review/02-development-notes.md#n-15--composted-exists-twice-and-the-fix-gets-more-expensive-monthly). | Architecture | Resolved |
| Q4 | Do we need image moderation to be synchronous before a photo is visible to a counterparty? Today `moderation_state` starts `pending` and the asset is visible once EXIF is stripped, so there is a window where an unreviewed image is on a listing ([Mobile Architecture §12.6](../01-architecture/02-mobile-architecture.md)). Synchronous review is a latency and cost decision, not a technical one. | Trust & Safety + Product | Before launch |
| Q5 | Should the private note be included in a DSAR export as a separate category, given it is the one field a user may reasonably have forgotten exists? | Legal + Platform | Before first DSAR |
| Q6 | Is 21 days the right staleness prompt (R48)? Too eager and it nags; too slow and the map fills with produce that rotted a fortnight ago, which is the single most damaging thing to trust in a barter product. | Product | Post-launch data |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Mobile Engineering | Initial spec |
| 2026-10-21 | 1.1.0 | Architecture | Q3 resolved: `composted` is an `inventory_status` value only; removed from the `archive_reason` vocabulary. Closes N-15 |
| 2026-10-22 | 1.1.1 | Architecture | Migration filename updated to 14-digit version; SCR-0201. No behavioural change |
