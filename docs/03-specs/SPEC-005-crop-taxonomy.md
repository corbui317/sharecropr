# SPEC-005: Crop Taxonomy & Classification

| Field | Value |
| --- | --- |
| **Status** | Approved |
| **Version** | 1.0.0 |
| **Owner** | Platform Engineering |
| **Phase** | MVP |
| **Security review** | not required |
| **Depends on** | — |
| **Depended on by** | SPEC-006, SPEC-008, SPEC-009, SPEC-020, SPEC-023 |
| **Related ADRs** | [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0011](../01-architecture/adr/ADR-0011-state-management.md), [ADR-0017](../01-architecture/adr/ADR-0017-release-cadence.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

The taxonomy is the vocabulary every other feature speaks: a four-level hierarchy — kingdom → category → species → variety — that turns "some tomatoes" into a row that can be searched, filtered, matched, and counted. It is **curated reference data, not user-generated content**: users may propose a variety under an existing species, and nobody may create a species, because free-text species creation destroys search within a week and cannot be undone. It ships bundled in the binary so the app works offline on first run, and it updates server-side through a versioned delta protocol so a missing crop is a data fix rather than a store release.

## 2. Goals

- Make browsing match how people think about food, which means **culinary category is authoritative** and botanical truth is metadata.
- Make search forgiving: "courgette" finds Zucchini, "cilantro" finds Coriander, "tomatos" finds Tomato — without the user learning our vocabulary.
- Work fully offline, on first launch, before sign-in, with zero network calls ([PRD C5](../00-foundation/02-prd.md), [Mobile Architecture §6](../01-architecture/02-mobile-architecture.md)).
- Be updatable without a store release, because the alternative is a two-week turnaround on "you don't have kohlrabi".
- Let users contribute the long tail (varieties) through a queue, without letting them contaminate the trunk (species).
- Make renames and merges survivable: a species that changes its name must not orphan an active listing or a user's inventory.
- Ship enough seed data that the first user in a launch metro finds their crop on the first try.

## 3. Non-Goals

- **Botanical browsing.** `botanical_category_id` is stored and is not read by any browse, filter, count, or ranking path in MVP. It exists so that when someone eventually wants "show me nightshades", the data is already there and the migration is a UI change.
- **User-created species.** Not "carefully moderated species creation" — there is no INSERT policy, no RPC, and no moderator path that accepts a user-authored species row verbatim. See R40 and §9.
- **Localization.** English common names only in MVP ([PRD §1](../00-foundation/02-prd.md)). Aliases cover British/American/regional English, not translation. A `locale` dimension on `common_name` is a Phase 2 schema change, and pretending otherwise by stuffing Spanish into `aliases` would poison trigram ranking.
- **Per-hardiness-zone seasonality.** `season_months` is a Northern-hemisphere default. Real per-zone harvest windows are [SPEC-020](SPEC-020-harvest-planning.md).
- **Nutrition, recipes, growing advice, companion planting.** We are not building a plant encyclopedia. Every field in this taxonomy exists because a query needs it.
- **Allergen guidance.** `allergen_tags` is populated as data and rendered by nothing in MVP. Displaying allergen information is a food-safety claim, and that conversation belongs to [SPEC-023](SPEC-023-crop-id-and-food-safety.md) with legal review.
- **ML crop identification from a photo.** [SPEC-023](SPEC-023-crop-id-and-food-safety.md), Phase 3.
- **A taxonomy editor in the mobile app.** Curation happens in the moderation console ([SPEC-900](SPEC-900-moderation-console.md)) and in migrations.
- **Variety-level photos, provenance, or seed sourcing.** Varieties are a name and a parent. Anything richer is a table nobody has asked for.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener adding an item**, I want to find "tomato" under vegetables, where I expect it, so that the app matches how I cook. | P0 |
| US-02 | As a **British gardener**, I want to type "courgette" and get Zucchini so that I don't have to learn American produce names. | P0 |
| US-03 | As a **gardener with a specific heirloom**, I want to pick "Cherokee Purple" so that the person collecting knows exactly what they're getting. | P0 |
| US-04 | As a **gardener whose variety isn't listed**, I want to add it and keep going, so that a missing row doesn't block my listing. | P0 |
| US-05 | As a **gardener on a train with no signal**, I want the species picker to work so that I can enter my harvest on the way home. | P0 |
| US-06 | As a **gardener**, I want a crop we added last week to appear without updating the app so that the app doesn't feel abandoned. | P1 |
| US-07 | As a **curator**, I want to merge "Courgette" into "Zucchini" without breaking anyone's active listing. | P0 |
| US-08 | As a **moderator**, I want a queue of proposed varieties with enough context to approve, merge, or reject in seconds. | P0 |
| US-09 | As a **gardener browsing**, I want category chips that fit on one row and mean something to me. | P0 |
| US-10 | As a **gardener searching "squash"**, I want to be shown the six squashes rather than silently given the wrong one. | P1 |
| US-11 | As a **product owner**, I want to know which crops people search for and don't find, so that curation is driven by demand rather than guesswork. | P1 |
| US-12 | As a **screen-reader user**, I want the species picker to be a plain searchable list, not a grid of unlabelled tiles. | P0 |

## 5. Functional Requirements

### 5.1 Hierarchy and classification

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | The hierarchy MUST be exactly four levels — `crop_kingdoms` → `crop_categories` → `crop_species` → `crop_varieties` ([Data Model §7](../01-architecture/03-data-model.md#7-crop-taxonomy)). Every species MUST have exactly one `category_id`; every variety exactly one `species_id`. |
| R02 | **MUST** | `crop_species.category_id` MUST be the **culinary** category, and it MUST be the only classification consumed by browsing, filter chips, category counts, search facets, and match suggestions. |
| R03 | **MUST NOT** | `botanical_category_id` MUST NOT be read by any browse, filter, count, sort, or ranking path in MVP. It is stored, returned in the API shape, and rendered by nothing. |
| R04 | **MUST** | Concretely: Tomato MUST seed with `category_id = vegetable` and `botanical_category_id = fruit`. The same rule applies to cucumber, pepper, aubergine, courgette, squash, and avocado — botanically fruit, culinarily vegetable, and a user who taps **Fruit** and is shown five kinds of squash concludes the app is broken, not that they were wrong about botany. |
| R05 | **MUST** | Every species reachable from the picker MUST have a non-empty `typical_units`, and the item form MUST default `unit` to `typical_units[1]`. |
| R06 | **MUST NOT** | The client MUST NOT infer a category from a name, a variety string, a custom label, or a keyword. Classification comes from `species_id` and nowhere else. |
| R07 | **MUST** | Integer `id` is the identity. `slug`, `common_name`, and `aliases` are labels and MAY change at any time; an `id` MUST be stable for the life of the product. Every foreign key, cache key, analytics property, and delta record keys on `id`. |
| R08 | **MUST NOT** | No taxonomy row is ever hard-deleted. Retirement is `is_active = false` plus a tombstone (R33). A `DELETE` on a taxonomy table breaks every row that references it and no migration can put it back. |
| R09 | **SHOULD** | Categories SHOULD number 8–12 so the filter chip row is scannable in one horizontal scroll on a 375 dp screen. The launch set is the ten in [Data Model §7](../01-architecture/03-data-model.md#7-crop-taxonomy). |

### 5.2 Search and aliases

| ID | Req | Statement |
| --- | --- | --- |
| R10 | **MUST** | Server-side species search MUST go through `rpc.search_species`, backed by `crop_species_search_idx` (GIN, `gin_trgm_ops`) over `common_name || ' ' || array_to_string(aliases,' ')`. |
| R11 | **MUST** | Aliases MUST be weighted identically to `common_name`. "courgette" → Zucchini, "aubergine" → Eggplant, "rocket" → Arugula, "capsicum" → Bell Pepper, "coriander" → Cilantro, "mangetout" → Snow Pea, "swede" → Rutabaga. An alias that ranks below the canonical name is an alias that does not work. |
| R12 | **MUST** | Query normalization MUST be identical on client and server: Unicode NFKD, casefold, strip combining marks, strip punctuation, collapse internal whitespace, trim. One implementation in `domain/taxonomy/normalize.ts`, mirrored by `app.normalize_taxonomy_term(text)`, and proven equal by a shared fixture. |
| R13 | **MUST** | Species and variety search MUST work with zero network, over the bundled snapshot plus the MMKV overlay, via `domain/taxonomy/search.ts`. |
| R14 | **MUST** | For a committed golden corpus of **120 queries** (typos, aliases, plurals, partials, ambiguous terms), the offline ranker and `rpc.search_species` MUST return the same top-3 species set. Divergence is a correctness bug, not a nicety — a user who finds a crop online and not offline reports the app as broken. |
| R15 | **MUST** | Queries shorter than 3 characters MUST use prefix matching only. Trigram similarity on 1–2 characters returns noise ranked confidently. |
| R16 | **MUST** | An ambiguous term that matches multiple species above threshold ("squash", "pepper", "onion", "bean", "melon") MUST render a disambiguation list. The client MUST NOT auto-select the top hit. |
| R17 | **SHOULD** | Ranking SHOULD apply a small boost to species whose `season_months` contains the current month, applied **after** similarity, never in place of it. |
| R18 | **MUST** | Zero-result queries MUST be recorded as the **normalized term and nothing else** — no user id, no device id, no session id, no coordinate — and MUST feed the curation backlog (§11). |
| R19 | **MUST** | Variety search within a chosen species MUST be a local filter over that species' varieties. It MUST NOT issue a network request; a species has tens of varieties, not thousands. |

### 5.3 Bundling, versioning, and delta sync

| ID | Req | Statement |
| --- | --- | --- |
| R20 | **MUST** | A full taxonomy snapshot MUST ship inside the binary at `assets/taxonomy/taxonomy.v{N}.json` and MUST be readable before any network call, before auth, and before the query cache rehydrates. |
| R21 | **MUST** | The taxonomy MUST be updatable server-side without a store release ([PRD C5](../00-foundation/02-prd.md)). |
| R22 | **MUST** | `public.taxonomy_version` MUST be a single row carrying a monotonically increasing integer `version` and a `floor_version` below which deltas are no longer served. |
| R23 | **MUST** | At cold start the client MUST read `taxonomy_version`, and if the server version exceeds the effective local version, call `rpc.taxonomy_delta(p_since)`. Both calls MUST be off the critical path: no screen, no picker, and no first paint may block on either. |
| R24 | **MUST** | A delta MUST be applied to the MMKV overlay **atomically**. A partial apply (process killed mid-write, malformed payload, failed schema parse) MUST be discarded whole, leaving the previous effective version intact. |
| R25 | **MUST** | The delta response MUST carry changed rows for all four levels, a tombstone list, the resulting `version`, and a `truncated` flag when the change set exceeds `p_limit`. A truncated response MUST be applied and immediately followed by another delta call from the new `since`. |
| R26 | **MUST** | If `p_since < taxonomy_version.floor_version`, the server MUST return `full_resync_required` and the client MUST fetch the full snapshot from `GET /rest/v1/crop_species` (and siblings) rather than attempting to reconcile. |
| R27 | **MUST NOT** | The effective taxonomy version MUST NOT go backwards. If the bundled snapshot's version is greater than the overlay's (a reinstall onto an older overlay, or a server rollback), the bundle wins and the overlay is dropped. |
| R28 | **MUST** | Taxonomy queries MUST use `staleTime: Infinity` and `gcTime: Infinity` ([Mobile Architecture §2.2](../01-architecture/02-mobile-architecture.md)). Freshness comes from the explicit version check, never from refetch-on-focus. |
| R29 | **MUST** | The overlay MUST survive app kill and MUST be discarded when the persistence `buster` changes ([Mobile Architecture §2.3](../01-architecture/02-mobile-architecture.md)), because a contract bump can change the row shape. |
| R30 | **MUST** | Taxonomy reads MUST be available to `anon`, so the picker renders before sign-in and the store-review build has content ([API Contract §2.2](../01-architecture/06-api-contract.md)). |
| R31 | **SHOULD** | The version check SHOULD run at most once per foreground and no more often than every 6 hours. Reference data that changes weekly does not need a poll per screen. |

### 5.4 Renames, merges, and the migration path

| ID | Req | Statement |
| --- | --- | --- |
| R32 | **MUST** | A **rename** changes `common_name` and/or `slug` and MUST NOT change `id`. No row referencing the species is rewritten, and no client action is required. |
| R33 | **MUST** | A `slug` change MUST emit a `renamed_slug` tombstone carrying the old slug, so any client or deep link keyed on a slug can repoint. Emitting nothing is how "we renamed it and nothing broke in staging" becomes a support queue. |
| R34 | **MUST** | A **merge** MUST set `merged_into_id` on the losing species, set `is_active = false`, and emit a `merged` tombstone with `replacement_id`. |
| R35 | **MUST** | A merge MUST repoint, in one transaction: `inventory_items.species_id`, `listings.species_id`, every element of `listings.wanted_species_ids`, and `crop_varieties.species_id` for the losing species' varieties. Re-parented varieties that collide on `(species_id, normalized_name)` MUST be deactivated, not renamed. |
| R36 | **MUST NOT** | `merged_into_id` MUST NOT form a chain. A `CHECK` MUST assert the target is itself unmerged, so resolution is one hop and a curator cannot build a cycle. |
| R37 | **MUST** | A client holding a stale species or variety id MUST resolve it through the tombstone list to the replacement and render the replacement's name. It MUST NOT render "Unknown crop" for a merged id. |
| R38 | **MUST** | Renames, merges, deactivations, and category moves MUST be migrations or moderator actions, audited to `audit.events`. There is no client path and no `service_role` script that skips the audit. |
| R39 | **SHOULD** | A merge affecting a user's **active** listing SHOULD write an in-app inbox notification ("We renamed a crop"). It SHOULD NOT push — a taxonomy tidy-up is not worth a lock-screen interruption. |

### 5.5 User-submitted varieties and the approval queue

| ID | Req | Statement |
| --- | --- | --- |
| R40 | **MUST NOT** | **Free-text species creation MUST NOT exist.** No INSERT or UPDATE policy on `crop_species` for `authenticated`, no RPC that accepts a species name, and no moderator path that inserts a user-authored string verbatim. Within a week of shipping one you have `tomatoe`, `Tomato ` (trailing space), `TOMATO`, `tomato (cherry)`, and `🍅` — five rows, five sets of listings, five sets of counts, and a trigram index whose top hit for "tomato" is whichever duplicate happens to be shortest. Search does not degrade gracefully under this; it dies, and there is no migration that recovers the user intent behind `tomato (cherry)`. |
| R41 | **MUST** | A user MAY propose a variety under an existing **active** species via `rpc.propose_crop_variety`. This is the entire user-authored surface of the taxonomy. |
| R42 | **MUST** | A proposed name MUST be normalized (R12) into `normalized_name` and MUST be unique per `(species_id, normalized_name)`, enforced by a unique index, not by a client check. |
| R43 | **MUST** | A proposal whose `normalized_name` already exists as an **approved** variety MUST return that variety as a success. The user typed a name that already exists; that is not an error and must not read as one. |
| R44 | **MUST** | The name `CHECK` MUST enforce: length 2–40, first character alphanumeric, and the remainder drawn from letters, digits, space, apostrophe, hyphen, period, and forward slash. Emoji, control characters, leading/trailing whitespace, and runs of whitespace MUST be rejected with `validation_failed`. |
| R45 | **MUST** | Unapproved varieties MUST be visible only to their submitter and to moderators, enforced by `crop_varieties_select_visible`. |
| R46 | **MUST** | A listing whose inventory item carries an **unapproved** variety MUST render to non-owners as the species name with no variety string. It MUST NOT render the pending name, and it MUST NOT be blocked from publishing. |
| R47 | **MUST** | A pending variety MUST NOT block anything the submitter does: the item saves, publishes, is requested against, and completes normally. |
| R48 | **MUST** | Quotas MUST be enforced server-side: **5 proposals per day per user** and **10 pending proposals per user**, both returning `quota_exceeded` 422. |
| R49 | **MUST** | Review MUST go through `rpc.review_crop_variety` with decisions `approve`, `merge`, `reject`; moderator-only via `app.is_moderator()`; every decision written to `audit.events`. |
| R50 | **MUST** | On `reject`, the variety row MUST be retained with `review_state = 'rejected'`, `inventory_items.variety_id` referencing it MUST be set to `NULL`, and the proposed name MUST be copied into `custom_label` where that column is empty. Rejecting a name must never destroy a user's item or silently change what it says. |
| R51 | **MUST** | On `merge`, `inventory_items.variety_id` MUST be repointed to the target variety in the same transaction. |
| R52 | **MUST NOT** | A rejection reason MUST NOT be free moderator text. It MUST come from the closed vocabulary in §6.2, because free text in a user-visible moderation message is an unreviewed publishing surface. |
| R53 | **SHOULD** | The review SLA SHOULD be 5 business days. A proposal pending beyond 14 days SHOULD alert (§11); it MUST NOT auto-approve. |

### 5.6 Seed data for launch

| ID | Req | Statement |
| --- | --- | --- |
| R54 | **MUST** | Launch seed MUST contain 2 kingdoms, 10 categories, **≥ 180 species**, and **≥ 900 varieties**, covering USDA zones 5b–6b home-garden crops for the two launch metros ([PRD §1](../00-foundation/02-prd.md)). |
| R55 | **MUST** | Every seeded species MUST have `category_id`, non-empty `typical_units`, and a category with a non-null `icon_key`. |
| R56 | **MUST** | **≥ 40 species** MUST carry at least one alias covering British/American/regional divergence. The launch list includes courgette, aubergine, rocket, coriander, capsicum, spring onion, swede, mangetout, beetroot, silverbeet, and pak choi. |
| R57 | **MUST** | The **top 25 species by expected listing volume** MUST each carry ≥ 3 approved varieties at launch, so the first user to reach the variety step is not the first person to use the proposal flow. |
| R58 | **MUST** | The seed MUST live in the repository as data (`supabase/seed/taxonomy/*.csv`), the bundled JSON MUST be generated from it, and CI MUST assert the two match at the pinned version. A hand-edited bundle that drifts from the seed produces a delta that "fixes" rows the server never changed. |
| R59 | **SHOULD** | ≥ 95% of species SHOULD have `season_months` and ≥ 90% SHOULD have `scientific_name`. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.crop_kingdoms`](../01-architecture/03-data-model.md#7-crop-taxonomy) | read (`anon`, `authenticated`) | Two rows: Plant, Fungus |
| `public.crop_categories` | read | Culinary categories; drives filter chips in [SPEC-008](SPEC-008-interactive-map.md) |
| `public.crop_species` | read | `category_id` culinary and authoritative; `botanical_category_id` metadata (R03) |
| `public.crop_varieties` | read; INSERT via `propose_crop_variety` only | Unapproved rows visible to submitter + moderators |
| `public.taxonomy_version` | read | **New.** One row. The delta protocol's anchor. |
| `public.taxonomy_tombstones` | read | **New.** Deactivations, merges, slug renames |
| `public.inventory_items` | write (definer, on merge/reject) | R35, R50, R51. Never written by a client through this spec. |
| `public.listings` | write (definer, on merge) | R35 repoints `species_id` and `wanted_species_ids` |
| `audit.events` | write | R38, R49 |

**New schema objects introduced by this spec:** migration `20260808_0051_taxonomy_sync_and_varieties.sql`

```sql
-- One monotonic revision counter for the entire taxonomy. A per-table counter
-- makes "what changed since v41" a four-way merge on the client; one counter
-- makes it a filter.
CREATE SEQUENCE public.taxonomy_rev_seq AS integer;

ALTER TABLE public.crop_kingdoms   ADD COLUMN row_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.crop_categories ADD COLUMN row_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.crop_species    ADD COLUMN row_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.crop_varieties  ADD COLUMN row_version integer NOT NULL DEFAULT 0;

CREATE INDEX crop_species_rev_idx   ON public.crop_species    (row_version);
CREATE INDEX crop_varieties_rev_idx ON public.crop_varieties  (row_version);
CREATE INDEX crop_categories_rev_idx ON public.crop_categories (row_version);

-- Merge target. One hop only: the CHECK is enforced by a trigger because a
-- CHECK cannot reference another row.
ALTER TABLE public.crop_species
  ADD COLUMN merged_into_id integer REFERENCES public.crop_species(id),
  ADD CONSTRAINT crop_species_no_self_merge CHECK (merged_into_id IS DISTINCT FROM id);

-- Variety review state. `is_approved` is retained as a generated mirror so that
-- existing policies and the API shape in 06-api-contract.md §4.2 keep working.
ALTER TABLE public.crop_varieties
  ADD COLUMN normalized_name text NOT NULL,
  ADD COLUMN review_state text NOT NULL DEFAULT 'pending'
      CHECK (review_state IN ('pending','approved','rejected','merged')),
  ADD COLUMN merged_into_variety_id integer REFERENCES public.crop_varieties(id),
  ADD COLUMN rejection_code text CHECK (rejection_code IN
      ('duplicate','is_a_species','not_a_variety','offensive','unintelligible','commercial')),
  ADD COLUMN reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT crop_varieties_name_shape CHECK (
        length(name) BETWEEN 2 AND 40
    AND name ~ '^[[:alnum:]][[:alnum:][:space:]''\-\./]{1,39}$'
    AND name = btrim(name)
    AND name !~ '[[:space:]]{2,}');

CREATE UNIQUE INDEX crop_varieties_norm_key
  ON public.crop_varieties (species_id, normalized_name);
CREATE INDEX crop_varieties_pending_idx
  ON public.crop_varieties (created_at) WHERE review_state = 'pending';
CREATE INDEX crop_varieties_submitter_idx
  ON public.crop_varieties (submitted_by) WHERE review_state = 'pending';

CREATE TABLE public.taxonomy_version (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),   -- single-row table
  version       integer NOT NULL,
  floor_version integer NOT NULL DEFAULT 0,   -- below this, clients must full-resync
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.taxonomy_tombstones (
  row_version    integer PRIMARY KEY DEFAULT nextval('public.taxonomy_rev_seq'),
  entity         text    NOT NULL CHECK (entity IN ('kingdom','category','species','variety')),
  entity_id      integer NOT NULL,
  reason         text    NOT NULL CHECK (reason IN ('deactivated','merged','renamed_slug','superseded')),
  replacement_id integer,
  old_slug       text CHECK (length(old_slug) <= 80),
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

Also introduced: `app.normalize_taxonomy_term(text)` (definer, `IMMUTABLE`, granted to `authenticated`), the `trg_taxonomy_bump_rev` BEFORE INSERT/UPDATE trigger on all four tables that stamps `row_version = nextval('taxonomy_rev_seq')` and advances `taxonomy_version.version`, the `trg_crop_species_merge_no_chain` trigger enforcing R36, and three RPCs: `taxonomy_delta`, `propose_crop_variety`, `review_crop_variety`.

RLS (Pattern B, [RLS Design §5](../01-architecture/05-rls-design.md)), with one deviation for varieties:

```sql
CREATE POLICY crop_species_read ON public.crop_species
  FOR SELECT TO anon, authenticated USING (true);
-- Note: not `USING (is_active)`. An inactive species must remain readable so a
-- listing published before deactivation can still render its own species name.
-- Pickers filter on is_active in the query; visibility is not the mechanism.

CREATE POLICY crop_varieties_select_visible ON public.crop_varieties
  FOR SELECT TO authenticated
  USING (review_state = 'approved'
         OR submitted_by = (SELECT auth.uid())
         OR app.is_moderator());

CREATE POLICY crop_varieties_select_anon ON public.crop_varieties
  FOR SELECT TO anon USING (review_state = 'approved');

-- No INSERT, UPDATE, or DELETE policy on any taxonomy table for `authenticated`.
-- The absence is the enforcement of R40. Proposals go through the definer RPC.
```

### 6.1 Effective-version resolution

```
effective_version = max(bundled_snapshot.version, overlay.version)   -- R27
if server.version > effective_version:
    delta = taxonomy_delta(p_since = effective_version)
    if delta.error == 'full_resync_required':  fetch full snapshot, replace overlay
    else: apply atomically, repeat while delta.truncated
```

### 6.2 Closed vocabularies

| Vocabulary | Values |
| --- | --- |
| `taxonomy_tombstones.reason` | `deactivated`, `merged`, `renamed_slug`, `superseded` |
| `crop_varieties.review_state` | `pending`, `approved`, `rejected`, `merged` |
| `crop_varieties.rejection_code` | `duplicate`, `is_a_species`, `not_a_variety`, `offensive`, `unintelligible`, `commercial` |

**PII touched:** one column. `crop_varieties.submitted_by` is a user id, classified **P2** — it is the same identifier already visible on any listing that user publishes, and it is exposed to moderators only. The taxonomy is otherwise **P3, public** throughout ([Data Model §1](../01-architecture/03-data-model.md)). Zero-result search terms are recorded without any user identifier (R18), which is what keeps a search log from becoming a behavioural profile.

## 7. API

### 7.1 `GET /rest/v1/crop_species` (and `crop_kingdoms`, `crop_categories`, `crop_varieties`)

**Auth:** `anon`
**Rate limit:** 60 / min / IP
**Cache:** `Cache-Control: public, max-age=86400`; `staleTime: Infinity` client-side (R28)

Shape is fixed by [API Contract §4.2](../01-architecture/06-api-contract.md) and is not restated. This spec adds `row_version`, `merged_into_id`, and `review_state` to the select lists. Used for the full-resync path (R26) and for CI's bundle-equality check (R58); it is **not** the steady-state refresh path.

### 7.2 `rpc.taxonomy_delta`

**Auth:** `anon` or `authenticated`
**Rate limit:** 30 / min / IP

```jsonc
// Request
{ "p_since": 41, "p_limit": 2000 }
```

```jsonc
// Response 200
{
  "version": 47,
  "truncated": false,
  "kingdoms":   [],
  "categories": [{ "id": 4, "kingdom_id": 1, "slug": "leafy-green", "name": "Greens",
                   "icon_key": "leaf", "sort_order": 4, "row_version": 44 }],
  "species":    [{ "id": 412, "category_id": 2, "botanical_category_id": 3, "slug": "tomato",
                   "common_name": "Tomato", "scientific_name": "Solanum lycopersicum",
                   "aliases": ["love apple"], "allergen_tags": [], "typical_units": ["each","pound","quart"],
                   "season_months": [6,7,8,9,10], "is_active": true, "merged_into_id": null,
                   "row_version": 46 }],
  "varieties":  [{ "id": 1188, "species_id": 412, "slug": "cherokee-purple",
                   "name": "Cherokee Purple", "review_state": "approved", "row_version": 47 }],
  "tombstones": [{ "row_version": 45, "entity": "species", "entity_id": 655,
                   "reason": "merged", "replacement_id": 412, "old_slug": "courgette" }]
}
```

| Error code | HTTP | When |
| --- | --- | --- |
| `full_resync_required` | 409 | `p_since < taxonomy_version.floor_version` (R26) |
| `validation_failed` | 400 | `p_since` negative or above the current version; `p_limit` > 5000 |
| `rate_limited` | 429 | Bucket empty; `Retry-After` in integer seconds |

Ordering is by `row_version` ascending across all four collections plus tombstones, so applying in order and taking the maximum `row_version` seen is always a valid new `since` — including for a truncated response.

### 7.3 `rpc.search_species`

**Auth:** `anon` or `authenticated`
**Rate limit:** 60 / min / user

```jsonc
// Request
{ "p_query": "courgette", "p_category_ids": null, "p_limit": 20 }
// Response 200
[{ "species_id": 655, "common_name": "Zucchini", "category_id": 2,
   "matched_on": "alias", "matched_term": "courgette", "similarity": 1.0 }]
```

`matched_on` (`name` | `alias`) exists so the picker can render "Zucchini — also called courgette" rather than showing a result the user's own word does not appear in. `similarity` is `pg_trgm`'s, with the season boost from R17 applied afterwards and returned in the ordering rather than folded into the score.

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | `p_query` longer than 100 characters, `p_limit` > 50 |
| `rate_limited` | 429 | Bucket empty |

### 7.4 `rpc.propose_crop_variety`

**Auth:** `authenticated`
**Rate limit:** 5 / day / user (Postgres token bucket)

```jsonc
// Request
{ "p_species_id": 412, "p_name": "Cherokee Purple", "p_idempotency_key": "8f14e45f-…" }
// Response 200 — new proposal
{ "variety_id": 4021, "review_state": "pending", "matched_existing": false }
// Response 200 — an approved variety already exists (R43)
{ "variety_id": 1188, "review_state": "approved", "matched_existing": true }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Name fails the `CHECK` in R44; `p_species_id` unknown, inactive, or merged |
| `quota_exceeded` | 422 | 5 proposals today, or 10 already pending (R48) |
| `conflict` | 409 | `(species_id, normalized_name)` collides with a **pending** proposal from another user — the caller receives the existing row's id, and the client treats this as success |
| `rate_limited` | 429 | Bucket empty |

The function re-checks authorization as its first act and pins `search_path` ([RLS Design §7](../01-architecture/05-rls-design.md)). It takes no species name of any kind; `p_species_id` is an integer against an existing row, which is the mechanical expression of R40.

### 7.5 `rpc.review_crop_variety`

**Auth:** `authenticated` + `app.is_moderator()`, re-checked inside the function
**Rate limit:** 120 / min / moderator

```jsonc
// Request
{ "p_variety_id": 4021, "p_decision": "merge", "p_merge_into_variety_id": 1188,
  "p_rejection_code": null, "p_idempotency_key": "…" }
// Response 200
{ "variety_id": 4021, "review_state": "merged", "items_repointed": 3 }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Caller is not a moderator |
| `request_not_found` | 404 | Unknown variety |
| `conflict` | 409 | Already reviewed |
| `validation_failed` | 400 | `merge` without a target; `reject` without a `p_rejection_code`; merge target not approved or under a different species |

### 7.6 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| Any species write path | R40. There is no policy, no RPC, and no Edge Function. |
| A "report this variety" endpoint | Reports go through `create_report` with `subject_type = 'listing'`. A second reporting surface is a second SLA. |
| A per-user search history endpoint | We record normalized zero-result terms without a user id (R18). Storing per-user search history would create a behavioural profile in an app whose entire privacy posture is about not knowing where people are. |
| A realtime channel for taxonomy | Reference data that changes weekly does not need a websocket ([Realtime & Notifications §8.3](../01-architecture/08-realtime-and-notifications.md)). |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Species picker | `/(modals)/species-picker?onSelect=` | Search + category browse; the single entry point to `species_id` |
| Variety picker | Second step inside the species picker sheet | Filtered list for the chosen species, plus "Add a variety" |
| Propose variety | Inline form within the variety step | Name field, guidance copy, submit |
| My proposals | `/profile` → "Suggested varieties" | Status list; the only place a user sees a rejection |
| Category chips | Inline on `/map` and `/inventory` | Culinary categories only (R02) |
| Variety review queue | Moderation console ([SPEC-900](SPEC-900-moderation-console.md)) | Approve / merge / reject |

Species picker layout, top to bottom: search field (autofocused, `returnKeyType="search"`) → recent species (up to 6, local, MMKV) → category section list, alphabetical within category → sticky "Can't find it?" footer that explains varieties can be suggested and species cannot.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Effectively never reached. The bundled snapshot is available synchronously at first render, so the picker paints populated on frame one. The only loading indicator in this feature is a 2 dp indeterminate bar under the search field while a *server* search is in flight, and even then the offline results are already rendered beneath it. A skeleton over a picker that has local data is a self-inflicted wound. |
| Empty | Two cases. **No search results:** the normalized query is echoed, the closest three species by offline ranking are offered as "Did you mean", and the footer explains that species cannot be added but a variety can. **A category with no species** cannot occur — CI asserts every category has ≥ 1 active species. |
| Error (recoverable) | `taxonomy_delta` or `search_species` failed. Nothing visible in the picker: the offline ranker already answered. The delta retries on next foreground with backoff. The user is not told, because there is nothing for them to do and nothing is missing that they can perceive. |
| Error (terminal) | Only one: the bundled snapshot fails to parse, which means a corrupt binary. The picker renders the error card in §8.3 with "Restart app"; the root error boundary handles the reload ([Mobile Architecture §8.1](../01-architecture/02-mobile-architecture.md)). This is a build-integrity failure and is asserted in CI, so it should be unreachable in the field. |
| Offline | Fully functional and **visually identical to online**. Search, browse, select, and pick a variety all work from the bundle plus overlay. The one difference: "Suggest a variety" is disabled with the copy in §8.3, because `propose_crop_variety` is not a queueable mutation ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)) — a proposal that silently sits in a queue for two hours and then fails a uniqueness check is worse than an honest "not now". |
| Permission denied | Not applicable. The taxonomy requires no device permission and no verification level; an unverified, un-onboarded user gets the full picker ([Mobile Architecture §3.2](../01-architecture/02-mobile-architecture.md)). |
| Rate limited | 429 on `search_species` (60/min) is reachable only by a stuck keystroke loop. The client stops server search for `Retry-After` seconds, keeps offline search running, and shows nothing — offline results are the same results. A 429 on `propose_crop_variety` (5/day) is user-visible and shows the quota copy in §8.3 with the remaining time. |

Two additional states specific to this feature:

| State | Behaviour |
| --- | --- |
| Variety pending review | The variety renders in the submitter's item with a neutral "Pending review" pill. The item is fully usable (R47). Non-owners see the species name only (R46). No countdown, no progress bar — we are not going to imply an SLA in the UI that a queue of one moderator may not hold. |
| Variety rejected | The item keeps its `custom_label`, `variety_id` is null (R50), and the item screen shows a one-time dismissible inline row with the reason from the closed vocabulary. It is never a push notification and never a modal: a rejected variety name is a low-stakes event that must not read as a moderation strike. |

### 8.3 Copy

Exact strings.

**Species picker, search placeholder**
> Search crops — try "tomato" or "courgette"

**Species picker, no results**
> **No crop called "{query}".**
> We add crops from what people search for. If you're looking for a specific *kind* of something — a variety like Cherokee Purple — pick the crop first and add the variety there.
>
> Did you mean: `{species_1}` · `{species_2}` · `{species_3}`

**Species picker, sticky footer**
> Can't find it? Pick the closest crop, then add your variety.

**Alias hint on a result row**
> {species} — also called {alias}

**Ambiguous term disambiguation header**
> "{query}" matches {n} crops. Which one?

**Variety step, empty**
> **No varieties listed for {species} yet.**
> You can skip this, or add the one you're growing.
>
> Buttons: `Skip` · `Add a variety`

**Propose a variety, form**
> **Add a variety of {species}**
> Varieties are specific kinds — "Cherokee Purple", "Sungold", "Genovese". We'll review it within a few days.
>
> Field label: `Variety name` · Placeholder: `e.g. Cherokee Purple`

**Propose a variety, submitted**
> Thanks — we'll take a look. You can use it right away.

**Propose a variety, already exists (R43)**
> We already have that one. Selected it for you.

**Propose a variety, invalid name**
> Use letters and numbers, 2 to 40 characters. No emoji.

**Propose a variety, daily quota**
> You've suggested 5 varieties today. You can suggest more tomorrow.

**Propose a variety, too many pending**
> You have 10 suggestions waiting for review. We'll get to them before you can add more.

**Propose a variety, offline**
> You need a connection to suggest a variety. Everything else here works offline.

**Pending pill (submitter's item)**
> Pending review

**Rejection reasons (user-facing, mapped from `rejection_code`)**
> `duplicate` → We already had this one under a different spelling, so we've pointed your item at it.
> `is_a_species` → That's a crop, not a variety of {species}. Tell us and we'll consider adding it.
> `not_a_variety` → That didn't look like a variety name, so we've left it as a label on your item.
> `offensive` → We removed that name. Your item is unchanged.
> `unintelligible` → We couldn't tell what this was, so we've left it as a label on your item.
> `commercial` → We don't accept brand or seller names as varieties.

**Merge notice (in-app inbox, R39)**
> **We tidied up a crop name.**
> "{old_name}" is now "{new_name}". Your listing is unchanged and still visible.

**Terminal error card (corrupt bundle)**
> **Crop list didn't load.**
> Something's wrong with this app's data files.
>
> Button: `Restart app`

**Category chip accessibility label**
> {category}, {selected|not selected}

**Species row accessibility label**
> {common_name}, {category}. {n} varieties. Double tap to choose.

**Variety row accessibility label**
> {variety_name}{, pending review}. Double tap to choose.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Poison the shared vocabulary.** The taxonomy is the only table in the product that every user reads and that a user can write to at all, so the attack is content injection at scale: flood the variety queue with slurs, brand names, or lookalike duplicates ("Cherokee PurpIe" with a capital i) that fragment search and get rendered on other people's listings. The controls are, in order: unapproved varieties are visible only to their submitter (R45), so an unreviewed name has an audience of one; the `(species_id, normalized_name)` unique index kills lookalikes that normalize identically; the name `CHECK` (R44) rejects emoji and control characters at the storage layer; quotas cap a single account at 5/day and 10 pending (R48); and review is a moderator action. The residual is a homoglyph that survives NFKD — "PurpIe" normalizes differently from "Purple" — which is caught in review, not by a constraint, and is recorded as [Q3](#15-open-questions). A secondary risk is **denial of vocabulary**: a curator or a compromised moderator account merging popular species into nonsense. That is bounded by the audit trail (R38), by merges being migrations under `CODEOWNERS` review, and by the fact that merges are repointing operations that a subsequent migration can reverse. |
| Which RLS policies enforce access? | `crop_species_read`, `crop_kingdoms_read`, `crop_categories_read` (Pattern B, `FOR SELECT TO anon, authenticated USING (true)`), `crop_varieties_select_visible` (`review_state = 'approved' OR submitted_by = (SELECT auth.uid()) OR app.is_moderator()`), and `crop_varieties_select_anon` (approved only) — [RLS Design §5 Pattern B](../01-architecture/05-rls-design.md). **The load-bearing part is what is absent:** no INSERT, UPDATE, or DELETE policy exists on any of the four taxonomy tables for `anon` or `authenticated`, and the absence of a policy is the denial. Definer functions: `app.normalize_taxonomy_term()`, `app.is_moderator()`, `app.consume_token()`, plus `public.propose_crop_variety`, `public.review_crop_variety`, and `public.taxonomy_delta`. `propose_crop_variety` and `review_crop_variety` run as definer and therefore bypass RLS on `crop_varieties`, so each re-checks authorization explicitly as its first statement ([RLS Design §7](../01-architecture/05-rls-design.md)). |
| Can any response path expose an exact coordinate or PII? | No. No table, view, function, or parameter in this spec carries a `geography`, `geometry`, `h3_*`, `lat`, or `lng` column, so the CI contract sweep (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)) has nothing to allowlist here. The only user-linked column is `crop_varieties.submitted_by` (P2), which is exposed to the submitter and to moderators and is **excluded from the `anon` policy** and from the delta payload for non-owners. `season_months` and `scientific_name` are public botanical facts. |
| What is logged, and is it scrubbed? | Every `review_crop_variety` decision and every migration-driven rename, merge, or deactivation writes `audit.events` with the actor, the entity, and the decision (R38, R49). Zero-result search terms are recorded as the **normalized term and a count only** (R18) — no user id, no device id, no timestamp finer than the hour — which is what stops a curation signal from becoming a search-history profile. Proposal bodies are not logged outside the row itself. Statement logging is unmodified for this feature; none of these parameters are sensitive. |
| Does this need step-up authentication? | No. Proposing a variety is a low-stakes content action and gating it behind TOTP would kill the contribution rate that makes the long tail work. Moderator review is behind console SSO plus the `app_metadata.role` claim; AAL2 is reserved for account-security operations ([API Contract §2.4](../01-architecture/06-api-contract.md)). |
| Abuse / rate-limit controls | `propose_crop_variety`: **5/day/user**, Postgres token bucket, plus a hard 10-pending cap that a user cannot rate-limit their way around by waiting. `search_species`: 60/min/user. `taxonomy_delta`: 30/min/IP. Taxonomy reads: 60/min/IP at Kong. Scraping the taxonomy is not a threat we defend against — it is public reference data and we would publish it if anyone asked. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | First launch ever, airplane mode, no account. | The bundled snapshot renders the full picker synchronously. Search, browse, and variety selection all work. No spinner, no empty state, no network call attempted before the user acts. |
| EC-02 | A client four months stale calls `taxonomy_delta(p_since = 12)` and the floor has moved to 30. | `full_resync_required` 409. The client fetches the full snapshot from PostgREST, replaces the overlay wholesale, and continues. The user sees nothing — the old data was serviceable the whole time. |
| EC-03 | A species is merged while the user has a half-typed draft item referencing the losing id. | The draft's `species_id` resolves through the tombstone to `replacement_id` on next read (R37) and the form re-renders with the new name. The draft is not discarded and the user is not interrupted mid-form. |
| EC-04 | A species is deactivated while an active listing references it. | The listing keeps working. `crop_species_read` deliberately does **not** filter on `is_active` (§6), so the name still resolves; pickers filter `is_active` in the query, so nobody can pick it again. Deactivating a species is not a takedown mechanism and must not silently blank a live listing. |
| EC-05 | User submits `"cherokee purple "` when `Cherokee Purple` already exists approved. | Normalization (R12) collapses both to `cherokee purple`; R43 returns the existing approved variety with `matched_existing: true` and the copy "We already have that one." No row is created and no queue entry is made. |
| EC-06 | User submits `"🍅 best tomato"`. | The `crop_varieties_name_shape` CHECK rejects it at the storage layer; the RPC returns `validation_failed` 400 and the client renders the "No emoji" copy. The client also validates with the same rule via zod, but the database is the enforcement — client validation is a courtesy. |
| EC-07 | Two users propose the same new variety within the same second. | The `crop_varieties_norm_key` unique index serializes them. The loser's insert raises `23505`, the RPC catches it, re-reads the winning row, and returns that id as a success. Both users end up pointed at the same variety and neither sees an error. |
| EC-08 | A pending variety is approved while listings already reference it. | Nothing migrates. `review_state` flips to `approved`, the row becomes visible under `crop_varieties_select_visible`, and every existing listing starts rendering the variety name on the next taxonomy delta. This is the payoff for R07 — ids never changed, so approval is a visibility change, not a data migration. |
| EC-09 | A pending variety is rejected and the submitter has three items using it. | R50: all three have `variety_id` set to NULL, each gets the proposed name copied into `custom_label` where that column was empty, and each shows the one-time inline reason row. No item is deleted, no listing is withdrawn, and no push is sent. |
| EC-10 | User searches "squash" and six species match above threshold. | R16: a disambiguation list, headed "'squash' matches 6 crops. Which one?". No auto-selection. Auto-picking Yellow Squash for someone holding a butternut is the kind of error that surfaces at a library counter. |
| EC-11 | A taxonomy delta lands while the species picker is open. | The overlay update is atomic (R24) and the picker's list is derived from a selector, so it re-renders with the new data in place. Scroll position is preserved by keying rows on `id` (R07). A species the user had already selected and that was merged resolves through EC-03's path. |
| EC-12 | `taxonomy_delta` returns 500 at cold start. | Silent. The app runs on the last effective version, retries on next foreground with jittered backoff, and the user perceives nothing. This is the entire reason R23 forbids blocking on the delta. |
| EC-13 | A category is renamed from "Leafy Green" to "Greens" server-side. | The delta carries the category row with the same `id` and `icon_key`; filter chips relabel on the next foreground with no store release (R21). No listing, inventory item, or count is touched, because nothing references a category by name. |
| EC-14 | User reinstalls the app from a newer binary onto an MMKV overlay left by a version rollback, so `bundled.version = 51 > overlay.version = 47`. | R27: the bundle wins, the overlay is dropped, and the next delta is requested from 51. Applying a delta on top of a lower-versioned overlay would produce rows that never existed in any published version. |
| EC-15 | A two-character query, "to". | R15: prefix matching only. "Tomato", "Tomatillo", "Turnip" (no), — the prefix path returns species whose normalized name or any alias starts with "to", ranked alphabetically. Trigram is not consulted, because `similarity('to', 'tomato')` and `similarity('to', 'potato')` are close enough to be a coin flip presented as a ranking. |
| EC-16 | A moderator merges variety A into variety B, and B is later rejected. | Not reachable: `review_crop_variety` rejects a merge whose target is not `approved` (§7.5, `validation_failed`), and an approved variety has no path back to `rejected` — the only post-approval transition is a subsequent merge. Stated because "merge into a row that later disappears" is the standard way merge features rot. |
| EC-17 | The seed file and the bundled JSON drift in a PR. | CI fails the build (R58). The failure message names the differing ids, because "bundle does not match seed" without a diff is a check people learn to re-run until it passes. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `taxonomy.delta_applied` | product event | `from_version`, `to_version`, `rows`, `truncated`, `duration_ms` | p95 `duration_ms` > 400 ms on the reference device |
| `taxonomy.full_resync` | product event | `client_version`, `from_version` | > 1% of cold starts ⇒ `floor_version` is being advanced too aggressively |
| `taxonomy.delta_failed` | error event | `reason` (`network`\|`parse`\|`server`), `attempt` | > 5% of cold starts |
| `taxonomy.version_skew` | gauge | `bundled_version`, `effective_version`, `server_version` | p50 skew > 3 releases ⇒ the delta path is not working for real users |
| `taxonomy.search_performed` | product event | `normalized_query_length`, `result_count`, `source` (`offline`\|`server`), `latency_ms` | server p95 > 150 ms |
| `taxonomy.search_zero_results` | product event | **normalized term only**, no user identifier (R18) | zero-result rate > 15% of searches ⇒ the seed is missing crops people actually grow |
| `taxonomy.missing_crop_backlog` | derived report | Top 50 zero-result terms per week, per metro | Weekly review by Product; drives the curation queue |
| `taxonomy.disambiguation_shown` | product event | `query`, `candidate_count`, `selected_rank` | `selected_rank` consistently > 3 ⇒ ranking is wrong, not ambiguous |
| `taxonomy.variety_proposed` | product event | `species_id`, `matched_existing` | `matched_existing` > 40% ⇒ the variety list is being shown badly, not incompletely |
| `taxonomy.variety_reviewed` | product event | `decision`, `rejection_code`, `age_hours` | p95 `age_hours` > 120 (the 5-business-day SLA, R53) |
| `taxonomy.variety_pending_age` | gauge | `max_age_days`, `queue_depth` | **any row > 14 days** ⇒ page the curation owner |
| `taxonomy.variety_quota_hit` | product event | `quota` (`daily`\|`pending`) | Rising trend from few accounts ⇒ inspect for queue flooding |
| `taxonomy.species_merged` | product event | `from_id`, `to_id`, `items_repointed`, `listings_repointed` | Any occurrence is reviewed; merges are rare and consequential |
| `taxonomy.stale_id_resolved` | counter | `entity`, `reason` | Rising after a merge is expected; rising with no recent merge ⇒ tombstone retention is too short |
| `taxonomy.bundle_parse_failed` | error event | `app_version`, `platform` | **Any occurrence** — this is a corrupt build (EC-17, §8.2 terminal) |

**Never emitted:** a raw (un-normalized) search query, a user identifier alongside a search term, or the free text of a rejected variety proposal.

## 12. Accessibility

- The species picker is a **searchable list, not a grid of tiles**. A grid of crop icons is faster to scan visually and is a maze with a screen reader; the list is the primary layout for everyone, and the category icon is decorative (`importantForAccessibility="no"`) beside a text label.
- Every species row is **one** accessible element with a composed label (§8.3), not a stack of separate stops for icon, name, category, and chevron.
- The search field carries `accessibilityRole="search"`, and result-count changes announce through a `accessibilityLiveRegion="polite"` region: "12 crops match". Silence after typing is indistinguishable from a broken field.
- The disambiguation list (R16) is a real list with a heading, focusable in order, never an auto-dismissing popover.
- The "Pending review" pill is text, not a colour or a dot. Variety state is never conveyed by colour alone ([Mobile Architecture §10.2](../01-architecture/02-mobile-architecture.md)).
- Category chips: `accessibilityRole="button"` with `accessibilityState={{ selected }}`, a checkmark glyph when selected, and a label that reads "{category}, selected".
- Dynamic type to 200% with no capping anywhere in this feature — species names wrap to two lines rather than truncating. A truncated "Cherokee Purp…" in a picker is a wrong selection waiting to happen.
- Hit targets ≥ 44 × 44 dp on every row, chip, and the "Add a variety" affordance, via the `Pressable` primitive's default `hitSlop`.
- Reduced motion: the species → variety step transition becomes an instant swap rather than a slide.
- The rejection reason row is `accessibilityLiveRegion="polite"` on first render and is dismissible with a labelled control, not a swipe-only gesture.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01 | Schema introspection: exactly four taxonomy tables; every species has one category, every variety one species; no orphans in the seed |
| T02 | integration | R02, R03 | Static check over `src/` and `supabase/migrations/`: `botanical_category_id` appears in no browse, filter, count, or ranking query. Grep is the test; a single hit fails the build |
| T03 | integration | R04 | Seed assertion: Tomato is `category = vegetable`, `botanical_category = fruit`. Same for cucumber, pepper, aubergine, courgette, squash, avocado |
| T04 | integration | R05, R55 | Every active species has non-empty `typical_units`; the item form defaults to `typical_units[1]` |
| T05 | unit | R06 | The item form derives `category_id` only from the selected species; no code path maps a string to a category |
| T06 | integration | R07, R32 | Rename migration harness: `common_name` and `slug` change, `id` is unchanged, no referencing row is rewritten |
| T07 | integration | R08, R40 | No migration in `supabase/migrations/**` contains a `DELETE FROM public.crop_*`, and no migration creates an INSERT/UPDATE/DELETE policy or grant on any `crop_*` table for `anon` or `authenticated`. Policy-absence asserted from `pg_policies` against the live schema, not only by grep — a policy added in a later migration must fail this test |
| T08 | unit | R09 | Category count is 8–12 and the chip row fits one horizontal scroll at 375 dp and 200% type |
| T09 | integration | R10, R11 | `search_species` returns Zucchini for "courgette", Eggplant for "aubergine", Arugula for "rocket", Bell Pepper for "capsicum", Snow Pea for "mangetout", Rutabaga for "swede" — each at rank 1 |
| T10 | unit | R12 | Shared fixture of 200 strings normalizes identically in `normalize.ts` and `app.normalize_taxonomy_term` |
| T11 | e2e | R13, R30 | Airplane mode, signed out, fresh install: search "tomat", select Tomato, select a variety — all offline |
| T12 | integration | R14 | **Golden corpus:** 120 queries; offline top-3 set equals `search_species` top-3 set for every one |
| T13 | unit | R15 | "t" and "to" use the prefix path; `similarity()` is not called; results are alphabetical |
| T14 | e2e | R16 | "squash" renders the disambiguation list; nothing is auto-selected; each candidate is individually selectable |
| T15 | unit | R17 | Season boost applies after similarity: an out-of-season exact match still outranks an in-season fuzzy match |
| T16 | integration | R18 | A zero-result search emits an event with the normalized term and **no** user, device, or session identifier |
| T17 | unit | R19 | Variety search inside a species issues zero network requests |
| T18 | e2e | R20, R23 | Cold start with the network stubbed to hang: the picker is fully usable and no screen blocks on the delta |
| T19 | integration | R21, R22 | A server-side species insert bumps `taxonomy_version.version`; a client on the previous version receives it via delta with no app change |
| T20 | unit | R24 | A delta truncated mid-apply (simulated process kill) leaves the previous effective version intact; no partial rows |
| T21 | integration | R25 | A change set of 3000 rows with `p_limit = 2000` returns `truncated: true`; the follow-up call from `max(row_version)` returns the remainder exactly once |
| T22 | integration | R26 | `p_since` below `floor_version` returns `full_resync_required`; the client performs a full snapshot fetch |
| T23 | unit | R27 | Bundled version 51 over overlay version 47: the overlay is discarded and the effective version is 51 |
| T24 | integration | R28 | Query client config asserts `staleTime: Infinity` / `gcTime: Infinity` on all `qk.taxonomy()` keys |
| T25 | integration | R29 | Overlay survives a cold start; changing `SCHEMA_CONTRACT_VERSION` drops it |
| T26 | unit | R31 | Two foregrounds within 6 hours produce one version check |
| T27 | integration | R33 | A slug change emits a `renamed_slug` tombstone carrying `old_slug` |
| T28 | integration | R34, R35 | Merge harness: `merged_into_id` and `is_active` set, tombstone emitted, and `inventory_items`, `listings.species_id`, `listings.wanted_species_ids`, and `crop_varieties.species_id` all repointed in one transaction. Colliding varieties are deactivated, not renamed |
| T29 | integration | R36 | Attempting to merge into an already-merged species raises; no chain and no cycle can be created |
| T30 | unit | R37 | A stale species id resolves through the tombstone to the replacement name; "Unknown crop" never renders |
| T31 | integration | R38 | Every rename, merge, deactivation, and review writes `audit.events` with the actor and entity |
| T32 | integration | R39 | A merge touching an active listing writes an inbox notification and enqueues **no** push |
| T33 | integration | R41, R42 | `propose_crop_variety` creates a pending row with the correct `normalized_name`; the unique index is present and enforced |
| T34 | integration | R43 | Proposing an existing approved name returns that variety with `matched_existing: true` and creates no row |
| T35 | integration | R44 | Parameterised name test: 1 char, 41 chars, leading space, double space, emoji, control character, leading hyphen — all `validation_failed`; valid names with apostrophes, hyphens, periods, and slashes accepted |
| T36 | rls | R45 | Submitter sees their pending variety; a second user does not; a moderator does; `anon` sees approved only |
| T37 | rls | R46 | A listing whose item carries a pending variety returns the species name and no variety string to a non-owner |
| T38 | e2e | R47 | Propose a variety, then create an item with it, publish a listing, and receive a request — all while pending |
| T39 | integration | R48 | 6th proposal in a day and 11th pending both return `quota_exceeded` 422 |
| T40 | integration | R49, R51 | `review_crop_variety` approve / merge / reject paths; merge repoints `inventory_items.variety_id`; each writes an audit row |
| T41 | integration | R50 | Reject sets `variety_id` NULL on all referencing items and backfills `custom_label` only where empty |
| T42 | integration | R52 | `p_rejection_code` outside the closed vocabulary is rejected; there is no free-text field on the RPC |
| T43 | integration | R53 | A pending row aged past 14 days raises the alert and is **not** auto-approved |
| T44 | integration | R54, R56, R57, R59 | Seed assertions: ≥ 180 species, ≥ 900 varieties, 10 categories, ≥ 40 aliased species, top-25 species each with ≥ 3 varieties, ≥ 95% `season_months`, ≥ 90% `scientific_name` |
| T45 | integration | R58 | Bundled JSON is byte-equal to the generator's output from `supabase/seed/taxonomy/*.csv` at the pinned version; the failure message diffs by id |
| T46 | perf | R10 | `search_species` p95 < 150 ms server-side at 5× seed volume, with the GIN index used (asserted from `EXPLAIN`) |
| T47 | manual | §12 | VoiceOver and TalkBack over the species picker, disambiguation list, and variety proposal form at 200% type |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T48 | `POST /rest/v1/crop_species` as `authenticated` with a full valid row | 401/403 — no INSERT policy exists for `authenticated` on `crop_species`. Asserted for all four taxonomy tables and for `anon` (R40) |
| T49 | `PATCH /rest/v1/crop_species?id=eq.412` changing `common_name` to "tomatoe" | Denied — no UPDATE policy. Asserted for `crop_categories`, `crop_kingdoms`, and `crop_varieties` too |
| T50 | `DELETE /rest/v1/crop_varieties?id=eq.1188` | Denied — no DELETE policy and no `DELETE` grant to `authenticated` anywhere ([API Contract §1.3](../01-architecture/06-api-contract.md)) |
| T51 | Call `propose_crop_variety` with `p_species_id` pointing at an inactive or merged species | `validation_failed` 400. A merged species must not accrue new varieties that the merge has already finished repointing |
| T52 | Call `propose_crop_variety` with a name that is actually a species ("Kohlrabi") under Tomato | Accepted at the storage layer, rejected in review with `is_a_species` (§8.3 copy). Asserted end to end, because this is the pressure that makes people ask for free-text species and the answer must be a working queue, not a new table |
| T53 | Submit 40 proposals in one minute from one account | 5 succeed, the rest `rate_limited` 429 with integer `Retry-After`; the pending cap engages independently at 10 |
| T54 | Submit the same normalized name from 20 accounts simultaneously | Exactly one row exists afterwards; 19 callers receive that row's id as a success; no `500` and no duplicate key surfaced to a client |
| T55 | Homoglyph attack: propose "Cherokee PurpIe" (capital i) under Tomato | Passes the CHECK and the unique index — it genuinely normalizes differently — and is caught in review as `duplicate`. Asserted so the residual risk in §9 is a tested, known gap rather than an assumed one |
| T56 | Propose a variety containing a URL, a phone number, or an email address | `validation_failed` 400 at the `CHECK` — the character class admits no `:`, `@`, or digits-with-punctuation patterns that form a contact. A variety name is not a messaging channel |
| T57 | Read another user's pending variety by guessing sequential `crop_varieties.id` | Zero rows under `crop_varieties_select_visible`. Ids are sequential integers here (curated reference data, [Data Model §1](../01-architecture/03-data-model.md)), which makes the RLS test mandatory rather than incidental |
| T58 | Call `review_crop_variety` as a non-moderator | `not_authorized` 403 from the function's own first-statement check, **not** from RLS — the function is `SECURITY DEFINER` and RLS does not apply to it ([RLS Design §7](../01-architecture/05-rls-design.md)) |
| T59 | Call `review_crop_variety` with a forged `app_metadata.role` in `user_metadata` | Denied. `app.is_moderator()` reads `app_metadata`, which only `service_role` can write; CI greps for any policy or function reading `user_metadata` for authorization ([API Contract §2.1](../01-architecture/06-api-contract.md)) |
| T60 | `taxonomy_delta` with `p_since = -1`, `p_since` above the current version, and `p_limit = 10000000` | `validation_failed` 400 for all three; no unbounded scan reaches the planner |
| T61 | Craft a `taxonomy_delta` response containing a coordinate key and feed it to the client applier | The zod schema rejects the payload, the overlay is untouched (R24), and the event is logged. Defensive because the delta is the one server payload the client persists wholesale |
| T62 | Contract sweep for coordinate columns across every taxonomy table, view, and RPC return type | Zero hits (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)); nothing from this spec is added to the two-line allowlist |
| T63 | 10 KB `p_query` into `search_species` | `validation_failed` 400 at 100 characters; the GIN index is never asked to process it |
| T64 | Unauthenticated (`anon`) call to `propose_crop_variety` | 401 `unauthenticated`. `anon` may read the taxonomy and may write nothing |
| T65 | Sign in as a **suspended** user and propose a variety | Rejected. The function checks `profiles.is_suspended` explicitly, because `app.can_transact()` is the wrong gate here — proposing a variety is not transacting and an unverified user must still be able to do it |
| T66 | Inspect the zero-result search log after a full session | Contains normalized terms and counts only; no user id, device id, session id, or sub-hour timestamp (R18) |
| T67 | Attempt to create a merge cycle: merge A→B, then B→A | The `trg_crop_species_merge_no_chain` trigger rejects the second merge; `merged_into_id` resolution is provably one hop (R36) |

### 13.3 Manual QA

- [ ] Fresh install, airplane mode, no account: complete a full item entry using only the bundled taxonomy.
- [ ] Add a species server-side and confirm it appears on a real device within one foreground, with no app update.
- [ ] Run a real merge on the preview branch against seeded inventory and listings; confirm no listing disappears, no count changes, and the inbox notice reads correctly.
- [ ] Walk the top 50 zero-result terms from a week of dogfooding and confirm each is either seeded or explicitly declined.
- [ ] Propose a variety, approve it, and confirm every existing listing referencing it starts showing the name without any user action.
- [ ] Propose a variety, reject it, and confirm the submitter's item survives with the name preserved as a label.
- [ ] Confirm the species picker at 200% type in both themes: no truncation, chips still scannable.
- [ ] Screen-reader pass over the picker, the disambiguation list, and the proposal form.
- [ ] Confirm on a real device that a delta arriving while the picker is open does not lose scroll position or the current selection.
- [ ] Try, deliberately and creatively, to create a species through any client-reachable surface. Record what was attempted in the PR.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `taxonomy.variety_proposals` (R41) — default-on, flagged so the contribution surface can be closed without a release if the queue is overwhelmed at launch. The taxonomy itself is not flagged; there is no fallback vocabulary. |
| Migration required | Yes. `20260808_0051_taxonomy_sync_and_varieties.sql` — additive columns, two new tables, one sequence, three RPCs, four policies. No destructive operation, so the DAU gate in [Data Model §15.3](../01-architecture/03-data-model.md) does not engage. |
| Backfill required | Yes, twice. (1) `crop_varieties.normalized_name` computed for every existing row before the `NOT NULL` and the unique index are added — expand → migrate → contract within the single migration, since MVP has no production rows yet, and the same migration is written to be safe if it did. (2) `row_version` stamped from the sequence for every existing row so the first delta from a v0 client is coherent. |
| Rollback plan | The migration is forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A bad **data** change is reverted by a compensating data migration that emits its own tombstones — never by restoring a snapshot, which would move `taxonomy_version.version` backwards and break every client's delta cursor. A bad **client** applier is reverted by an EAS Update; the bundled snapshot means a reverted client still has a working taxonomy. |
| Client version floor | None. A client that knows nothing about `taxonomy_delta` runs on its bundled snapshot indefinitely and degrades to "this app doesn't have kohlrabi", not to a crash. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Is 180 species the right launch size? Too few and the zero-result rate drives uninstalls; too many and the picker is a wall and the curation debt is ours forever. The `taxonomy.search_zero_results` rate in the first fortnight is the answer, but we have to pick a number before we have it. | Product | Before launch |
| Q2 | Should a user be able to *request* a species (a free-text suggestion that goes to a queue and creates nothing) as a pressure valve for R40? It gives us the demand signal without the data risk — but it is a second moderation queue with a second SLA, and the zero-result log already gives us most of the same signal without a UI. | Product + Platform | Post-launch, first season |
| Q3 | How do we handle homoglyphs and confusables that survive NFKD ("PurpIe" with a capital i)? A confusables-skeleton normalization (UTS #39) would catch them at the index, at the cost of collapsing legitimately distinct names. Currently caught only in human review (§9). | Platform + Security | Before the variety queue exceeds 50 rows/week |
| Q4 | When does `common_name` need a locale dimension? Adding one after there are listings means a data migration on every species; adding one now costs a join we do not need in an English-only MVP. | Architecture | Before the first non-English metro |
| Q5 | Should the season boost (R17) use the user's hemisphere? `season_months` is a Northern-hemisphere default, so the boost is actively wrong for a Southern-hemisphere user — who cannot exist in MVP's two metros, but will exist before we remember this line is here. | Product | Before any Southern-hemisphere launch |
| Q6 | Is a 5-business-day variety review SLA sustainable with one part-time curator, and what happens to the queue in August when everyone's garden produces at once? Auto-approval is not on the table; a longer honest SLA might be. | Ops + Product | Before first peak season |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Platform Engineering | Initial spec |
