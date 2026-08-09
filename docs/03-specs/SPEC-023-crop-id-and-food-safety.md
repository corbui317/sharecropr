# SPEC-023: Crop Identification & Food Safety Disclosure

| Field | Value |
| --- | --- |
| **Status** | Approved |
| **Version** | 1.0.0 |
| **Owner** | Platform Engineering + Legal |
| **Phase** | Phase 3 |
| **Security review** | required |
| **Depends on** | [SPEC-005](SPEC-005-crop-taxonomy.md), [SPEC-006](SPEC-006-crop-inventory.md) |
| **Depended on by** | — |
| **Related ADRs** | [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md), [ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) |
| **Last updated** | 2026-08-08 |

> **Not built.** This spec is Approved and specified; no code exists. It describes Phase 3 behaviour and fills the table stubs shipped in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)).
>
> **Part (b) of this spec requires legal counsel before it requires an engineer.** See [§5.7](#57-disclaimers-handoff-guidance-and-the-legal-posture) and [§14](#14-rollout).

---

## 1. Summary

Two capabilities that arrive together because they attach to the same object — a photograph of food someone grew and is about to hand to a stranger. **Crop identification** uses a small image classifier to pre-fill the taxonomy picker from a photo; it is an *assist* and never an authority, the user confirms every time, and its training corpus comes free from MVP and Phase 2 data (`media_assets` joined to a species that a completed exchange effectively confirmed). **Food safety disclosure** attaches a short, closed-vocabulary statement to each listing — treatment, wash state, animal access, allergens from `crop_species.allergen_tags`, and a handling note — because "no money changes hands" stops protecting us the moment somebody gets ill, and a disclosure is the difference between a platform that helped people be honest and a platform that had no idea.

## 2. Goals

- Cut the time from "photograph a courgette" to "listing published" by pre-selecting the species, without ever making that selection on the user's behalf.
- Be honest, in the interface, about a model that will be excellent at tomatoes and useless at anything regional or uncommon — by refusing to guess at classes we cannot do well rather than guessing badly.
- Keep every garden photograph out of any third party's hands, and keep inference off the network wherever a device can do it.
- Give recipients the four facts that actually change a decision about raw produce: what was sprayed on it, whether it has been washed, whether animals had access to where it grew, and what allergens it carries.
- Make "I don't know" a first-class, one-tap answer, because forcing a claim manufactures false claims.
- State plainly and repeatedly that Sharecropr does not inspect, test, certify, or endorse any produce, and that every disclosure is one person's claim about their own garden.
- Refuse outright the categories where a home-produced item can kill somebody, rather than disclosing our way around them.

## 3. Non-Goals

- **Automatic classification.** There is no path where a photograph sets `species_id` without a human tap. Not at 99% confidence, not for a "verified" user, not in a bulk-import flow that does not exist.
- **Identifying anything other than a crop on our allowlist.** No plant-disease diagnosis, no pest identification, no ripeness scoring, no "is this safe to eat", no wild-plant or foraged-mushroom identification. A mushroom identifier is a liability product and a lethal one; see [§5.6](#56-prohibited-and-restricted-items).
- **A third-party vision API.** Rejected in [§7.2](#72-inference-siting-on-device-versus-server), not deferred. Sending users' garden photographs to an external processor creates a data-sharing relationship whose privacy cost is not repaid by a marginal accuracy gain.
- **Certification, inspection, testing, verification, grading, or endorsement of produce.** Sharecropr is not a food business, does not handle food, and never sees an item. Nothing in this spec creates a quality signal, and no first-party string may imply one (R44).
- **Verifying a disclosure.** We cannot and will not check whether someone actually washed the lettuce. A false disclosure is a `misrepresented_goods` report against a person ([SPEC-012](SPEC-012-trust-and-safety.md)), which is the only mechanism we have and we should not pretend to a second.
- **Medical, dietary, or allergy advice.** We surface the allergen tags attached to a species and the grower's own statement. We do not advise anyone about their allergy, and no copy in this product tells someone what is safe for them.
- **A food-safety rating, score, or badge.** Explicitly out of scope for [SPEC-022](SPEC-022-gamification.md) too. A "clean grower" badge is a certification claim with a cartoon on it.
- **On-device model training or federated learning.** Interesting, and an enormous amount of new surface for a classifier over 180 species.
- **Nutrition data, recipes, or storage advice beyond the fixed handling guidance in [§8.3](#83-copy).**

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener listing something**, I want the app to have a good guess at what I photographed, so that I don't scroll a list of 180 crops. | P1 |
| US-02 | As a **gardener**, I want to be able to correct the guess in one tap, and I want the correction to stick. | P0 |
| US-03 | As a **gardener growing something unusual**, I don't want the app to confidently tell me my tomatillo is a tomato. | P0 |
| US-04 | As a **privacy-conscious gardener**, I don't want my garden photos sent to a company I've never heard of. | P0 |
| US-05 | As a **gardener**, I want to know whether my photos are used to improve the app, and I want to be able to say no. | P0 |
| US-06 | As a **person collecting food**, I want to know if it was sprayed, whether it's been washed, and whether the dog gets into that bed. | P0 |
| US-07 | As a **person with a nut allergy**, I want to see allergen information before I agree to collect something. | P0 |
| US-08 | As a **grower**, I want to say "I don't know" without it looking like I'm hiding something. | P0 |
| US-09 | As a **recipient**, I want to be reminded to wash raw produce at the moment I'm handed it, not buried in a settings page. | P0 |
| US-10 | As a **user**, I want to understand that Sharecropr has not checked any of this. | P0 |
| US-11 | As **the company**, I want a defensible, counsel-reviewed position before a single line of disclosure code ships. | P0 |
| US-12 | As a **moderator**, I want a report path for "they said it was unsprayed and it wasn't". | P0 |
| US-13 | As a **screen-reader user**, I want the disclosure read out as sentences, not as a row of icons. | P0 |

## 5. Functional Requirements

### 5.1 The assist contract

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST NOT** | A prediction **MUST NOT** write `inventory_items.species_id`, `inventory_items.variety_id`, or `listings.species_id`. Only an explicit user selection in the species picker writes a classification, exactly as in [SPEC-005 R06](SPEC-005-crop-taxonomy.md). |
| R02 | **MUST** | A prediction **MUST** be presented as a *pre-selection in the picker*, visually and semantically identical to a selection the user made, with the picker open and the confirm action untapped. |
| R03 | **MUST** | Every presented prediction **MUST** be attributed in the UI ("Looks like {species} — check this is right") and **MUST NOT** be presented as a statement of fact. |
| R04 | **MUST** | Correcting a prediction **MUST** be reachable in one tap from the pre-selected state, and the correction **MUST** be at least as prominent as the acceptance. |
| R05 | **MUST NOT** | A prediction **MUST NOT** influence search ranking, match suggestions, `wanted_species_ids`, the map, or any other surface. It exists between the camera and the picker and nowhere else. |
| R06 | **MUST** | The feature **MUST** be fully skippable: a user who never uses the camera-assist path reaches an identical picker with identical behaviour, and the assist **MUST NOT** be the only path to any screen. |
| R07 | **MUST** | Prediction failure — no model, no allowlisted class, an inference error, a timeout — **MUST** degrade to the ordinary picker with no error message. A failed guess is not an error the user needs to know about. |
| R08 | **MUST** | Every prediction, presented or not, **MUST** be recorded in `public.crop_id_predictions` with its `model_version`, `inference_site`, candidates, and eventual `outcome`. A model we cannot evaluate is a model we cannot responsibly ship. |

### 5.2 Inference, thresholds, and the "not sure" path

| ID | Req | Statement |
| --- | --- | --- |
| R09 | **MUST** | Inference **MUST** run **on-device** by default, using a bundled or over-the-air-delivered model, with no network call and no image egress for inference purposes ([§7.2](#72-inference-siting-on-device-versus-server)). |
| R10 | **MUST** | Server inference **MAY** run only on **our own infrastructure** ([ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md)), only on an asset whose `media_assets.exif_stripped_at IS NOT NULL`, and only when the device declares itself incapable of running the model. It **MUST NOT** call any third-party vision or multimodal API. |
| R11 | **MUST** | Below `τ_show = 0.55` top-1 confidence, **no suggestion is presented at all** and the picker opens in its ordinary state. Silence is the "not sure" path, and it is the default behaviour of an honest classifier. |
| R12 | **MUST** | Between `τ_show` and `τ_preselect = 0.85`, up to **three** candidate chips **MUST** be offered above the search field, with nothing pre-selected. |
| R13 | **MUST** | At or above `τ_preselect = 0.85` **and** with a top-1-to-top-2 margin of at least **0.20**, the top candidate **MAY** be pre-selected per R02. Both conditions are required: a 0.90 confidence with a 0.88 runner-up is a coin flip stated loudly. |
| R14 | **MUST** | Candidates **MUST** be filtered to the **class allowlist** (R19) before thresholding, and a non-allowlisted class **MUST** be dropped rather than remapped to its nearest allowlisted neighbour. |
| R15 | **MUST** | An explicit **"Not what I've got"** control **MUST** be present in every presented state and **MUST** clear the pre-selection and focus the search field. |
| R16 | **MUST** | On-device inference **MUST** complete within **1500 ms** on the reference device or be abandoned; the picker **MUST NOT** block on it at any point, and the search field **MUST** be interactive from first paint. |
| R17 | **MUST** | Confidence **MUST NOT** be rendered to the user as a number, a percentage, or a bar. "Looks like" and "might be" are the only two registers, mapped from the thresholds. A percentage invites the user to defer to it. |
| R18 | **SHOULD** | Where the taxonomy holds an ambiguity set for a species group ("squash", "pepper" — [SPEC-005 R16](SPEC-005-crop-taxonomy.md)), the assist **SHOULD** present the disambiguation list rather than a single candidate, even above `τ_preselect`. The model's within-group accuracy is far worse than its between-group accuracy, and the taxonomy already knows which groups those are. |

### 5.3 Model lifecycle, coverage, and bias

> **The honest position:** this model will be very good at tomatoes, courgettes, and lettuce, and it will be bad at tomatillos, kohlrabi, oca, callaloo, bitter melon, curry leaf, and most of what makes a neighbourhood's gardens interesting. Training data follows listing volume, listing volume follows the mainstream, and a classifier trained on that will confidently misclassify exactly the crops whose owners most need the picker to work. The design response is not to hide the asymmetry behind a confidence score — it is to **refuse to guess about classes we have not earned the right to guess about**.

| ID | Req | Statement |
| --- | --- | --- |
| R19 | **MUST** | A species **MUST NOT** be on the class allowlist unless it has **≥ 300 verified training images from ≥ 60 distinct gardens** and achieves **≥ 0.80 recall and ≥ 0.85 precision** on the held-out evaluation set. Every other species is silently absent from predictions and reached through ordinary search. |
| R20 | **MUST** | The held-out evaluation set **MUST** be stratified by species, by metro, and by capture condition (indoor/outdoor, harvested/on-the-plant, single item/pile), and **MUST NOT** be drawn from a public agricultural dataset. A model evaluated on studio photographs of supermarket produce will report accuracy it does not have on a phone photo of a wet allotment. |
| R21 | **MUST** | Per-class precision and recall **MUST** be published to the internal model card and reviewed before every release. A class falling below R19's floor **MUST** be removed from the allowlist by a configuration change that requires **no model retrain and no app release** — the allowlist is server-delivered data, not a constant in the binary. |
| R22 | **MUST** | Every prediction **MUST** record the `model_version` that produced it, and `model_version` **MUST** be immutable and monotonically identified. |
| R23 | **MUST** | A new model **MUST** be shadow-evaluated against live traffic for **at least 14 days** before it is presented to any user, and **MUST NOT** be promoted if any allowlisted class regresses in recall by more than 5 percentage points. |
| R24 | **MUST** | Model rollout **MUST** be staged (5% → 25% → 100%) with the acceptance rate (R37's `outcome = 'accepted'`) monitored per stage, and **MUST** be revertible to the previous version by a flag without an app release. |
| R25 | **MUST** | The model **MUST NOT** be capable of emitting a class that does not exist in `crop_species`, and its output layer **MUST** be regenerated from the taxonomy at build time so a merged or retired species cannot be predicted ([SPEC-005 R34](SPEC-005-crop-taxonomy.md)). |
| R26 | **SHOULD** | Coverage gaps **SHOULD** be reported alongside [SPEC-005 R18](SPEC-005-crop-taxonomy.md)'s zero-result search terms, so that "crops we cannot recognise" and "crops we do not have" are reviewed as one curation backlog rather than two. |

### 5.4 Training data and consent

| ID | Req | Statement |
| --- | --- | --- |
| R27 | **MUST** | The training corpus **MUST** be drawn only from `media_assets` where `subject_type = 'inventory_item'`, `exif_stripped_at IS NOT NULL`, `moderation_state = 'approved'`, and the item's `species_id` was **corroborated by a completed exchange** — a second human collected it and did not report it misrepresented. That corroboration is the label quality this corpus has and a scraped dataset does not. |
| R28 | **MUST** | A user **MUST** be able to opt out of contributing their images to model training, from a single setting, and the opt-out **MUST** apply retroactively: images already in the corpus are removed from the next build. |
| R29 | **MUST** | Opting out **MUST NOT** degrade any other function. The assist still works for them; they simply do not feed it. |
| R30 | **MUST** | The training pipeline **MUST** operate on the EXIF-stripped derivative only, **MUST** run inside our own infrastructure, and **MUST NOT** export images, embeddings, or crops of images to any third party, including for annotation. Human annotation, if needed, happens under contract with reviewed access and an `audit.events` trail. |
| R31 | **MUST** | Images **MUST** be dissociated from `owner_id`, `garden_id`, and any listing before entering the corpus; the corpus row carries a `species_id`, a capture-condition tag, and an opaque per-image id only. |
| R32 | **MUST** | Deleting an account **MUST** remove that user's images from the corpus and from the next model build. A model already trained cannot be untrained, and the privacy notice **MUST** say so in those words rather than implying otherwise ([Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md)). |
| R33 | **MUST** | The training basis, the opt-out, and R32's limitation **MUST** be described in the privacy notice before the first image is used, not in the release that ships the model. |

### 5.5 Food safety disclosures

| ID | Req | Statement |
| --- | --- | --- |
| R34 | **MUST** | Publishing a listing **MUST** require a `food_safety_disclosures` row for that listing once `foodsafety.disclosures_required` is on. Four closed-vocabulary answers and an optional note; no free-text-only path. |
| R35 | **MUST** | Every field **MUST** offer an explicit `unknown` / "I'm not sure" option that is **exactly as easy to select as any other**, with no warning styling, no extra tap, and no nag. Forcing a claim from someone who does not know the answer manufactures a false claim and destroys the value of every true one. |
| R36 | **MUST** | `treatment` **MUST** be one of `none`, `organic_approved`, `synthetic`, `unknown`, with an optional `treatment_last_applied_on` date. The app **MUST NOT** compute, display, or imply a pre-harvest interval; that is agronomic advice and we are not qualified to give it. |
| R37 | **MUST** | `wash_state` **MUST** be one of `unwashed`, `rinsed`, `washed`, `unknown`, and the recipient-facing guidance **MUST** advise washing regardless of the answer (R56). |
| R38 | **MUST** | `animal_access` **MUST** be one of `none`, `pets`, `livestock`, `unknown`. This is the question most growers have never considered and the one with the clearest link to a real pathogen route. |
| R39 | **MUST** | `allergen_tags` **MUST** be pre-populated from `crop_species.allergen_tags` ([Data Model §7](../01-architecture/03-data-model.md#7-crop-taxonomy)) and those pre-populated tags **MUST NOT** be removable by the user. A grower may not un-declare that a walnut contains tree nuts. |
| R40 | **MUST** | A user **MAY** add cross-contact tags from a closed vocabulary (shared kitchen, shared tools, grown beside a declared allergen, processed at home), and **MUST NOT** be able to add a free-text allergen. |
| R41 | **MUST** | `handling_note` **MUST** be at most 300 characters, **MUST** be scanned by `content-scan` on the same terms as a message ([SPEC-011 R26](SPEC-011-messaging.md)), and **MUST NOT** be the place where a required disclosure is expressed — the closed fields are the record. |
| R42 | **MUST** | The disclosure **MUST** be visible on the listing detail **before** a request is sent, in the request confirmation, and on the exchange screen at handoff. A disclosure the recipient sees only after agreeing to collect is decoration. |
| R43 | **MUST** | Editing a disclosure after a request has been accepted **MUST** notify the requester and **MUST** allow them to cancel the exchange without a cancellation penalty ([SPEC-012](SPEC-012-trust-and-safety.md)). |
| R44 | **MUST NOT** | No first-party string anywhere in the product **MUST** describe produce as safe, clean, certified, verified, approved, inspected, tested, guaranteed, or organic **in Sharecropr's own voice**. Every such statement is rendered as attributed speech: "Grower says: no sprays used". This extends to `inventory_items.is_organic_claim`, which **MUST** render as "Grower says: organic" and never as "Organic". |
| R45 | **MUST** | Disclosures **MUST** be retained for **3 years** alongside the listing, exceeding the listing's own retention, because a foodborne-illness claim can arrive long after a courgette is gone. |
| R46 | **MUST** | `misrepresented_goods` ([Data Model §11](../01-architecture/03-data-model.md#11-communication--trust)) **MUST** accept a disclosure-specific sub-reason, and a report against a disclosure **MUST** attach the disclosure as it stood at handoff. |

### 5.6 Prohibited and restricted items

> This is the subsection that will be argued with, and it is the one to hold. Everything below is a category where a home-produced item can seriously harm or kill someone, and where a disclosure does not help because the grower does not know what they do not know.

| ID | Req | Statement |
| --- | --- | --- |
| R47 | **MUST NOT** | **Home-canned, jarred, bottled, or otherwise preserved food MUST NOT be listable.** `item_condition = 'preserved'` **MUST** be blocked from publishing, with the copy in [§8.3](#83-copy). Improperly processed home-canned low-acid food causes botulism; it is rare, it is frequently fatal, and no closed-vocabulary disclosure a home canner can honestly complete distinguishes a safe jar from a lethal one. |
| R48 | **MUST NOT** | **Foraged or wild-collected fungi MUST NOT be listable.** Any species in the `Fungus` kingdom **MUST** require an affirmative "grown from a cultivated kit or spawn" attestation, and foraged specimens **MUST** be refused outright. Amateur mushroom identification kills people every year, and an ML assist that gets involved would be actively dangerous — which is why fungi are permanently excluded from the class allowlist (R19) regardless of their training-data volume. |
| R49 | **MUST NOT** | Raw sprouts and sprouted seeds intended for eating, unpasteurised dairy, eggs, meat, fish, honey intended for infants, and any prepared or cooked food **MUST NOT** be listable. None of these is representable in the crop taxonomy today, and R50 keeps it that way. |
| R50 | **MUST** | The prohibited set **MUST** be enforced at the **taxonomy and enum level** — a blocked `item_condition`, a kingdom-level guard, and the absence of any species row for the prohibited categories — rather than by a keyword filter on user text. A blocklist of words is defeated by a synonym; an absent species row is not. |
| R51 | **MUST** | Seeds (`item_condition = 'seed'`) **MAY** be listed and **MUST** carry the not-for-consumption guidance in [§8.3](#83-copy), because treated seed is coated with fungicide and is genuinely poisonous. |
| R52 | **MUST** | An attempt to list a prohibited item **MUST** produce a clear, non-punitive explanation naming the category, **MUST NOT** count as a moderation event, and **MUST** be recorded as a product metric ([§11](#11-observability)) so we know how often we are refusing people. |

### 5.7 Disclaimers, handoff guidance, and the legal posture

| ID | Req | Statement |
| --- | --- | --- |
| R53 | **MUST** | The disclaimer text in [§8.3](#83-copy) **MUST** be reviewed and approved by legal counsel before `foodsafety.disclosures_required` is enabled in any environment reachable by a real user. **The copy in this spec is a draft for counsel, not final wording**, and this requirement is the whole reason part (b) of this spec is written before the code and not after it. |
| R54 | **MUST** | Counsel **MUST** assess, per launch metro, whether the described activity falls within cottage-food, food-donation, gleaning, or produce-safety exemptions, and whether "no money changes hands" has the effect this product has assumed it has. [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md) chose barter for product reasons; **it is not a liability strategy and must stop being described internally as though it were**. |
| R55 | **MUST** | The grower **MUST** affirmatively attest to their disclosure at publish time, and `attested_at` plus `attested_version` (the version of the disclaimer they agreed to) **MUST** be recorded. A disclaimer nobody can prove a user saw is a disclaimer that does not exist. |
| R56 | **MUST** | The recipient **MUST** be shown the raw-produce guidance in [§8.3](#83-copy) at the **handoff confirmation step** of the exchange ([SPEC-010](SPEC-010-exchange-lifecycle.md)) — the moment food is physically in their hands — and again in the completed-exchange state. Not in a settings page, not in a terms document, not once at onboarding. |
| R57 | **MUST** | The guidance **MUST** direct anyone who becomes ill to a health professional or public health authority, **MUST NOT** direct them to Sharecropr support as a first step, and **MUST NOT** offer any assessment of their symptoms. |
| R58 | **MUST** | Every rendered disclosure **MUST** carry the attribution line ("This is what the grower told us. Sharecropr hasn't checked it.") adjacent to the disclosure itself, not in a footnote, a tooltip, or an expandable section. |
| R59 | **MUST** | A change to any disclaimer or guidance string **MUST** increment `attested_version`, **MUST** require legal sign-off recorded in the PR, and **MUST** be covered by `CODEOWNERS`. |
| R60 | **MUST** | An incident runbook for a reported foodborne illness **MUST** exist before launch ([Runbooks](../05-operations/05-runbooks.md)), covering evidence preservation (the disclosure, the listing, the session, the thread), the notification path to both parties, counsel escalation, and the explicit instruction that support staff **MUST NOT** offer medical opinions. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.crop_id_predictions`](../01-architecture/03-data-model.md#13-future-feature-stubs) | insert/read (owner), read (staff) | Evaluation dataset; corrections are the gold signal |
| `public.food_safety_disclosures` | read (listing-visible), write (owner via RPC) | One row per listing |
| `public.media_assets` | read | Inference and corpus source; `exif_stripped_at` gate |
| `public.crop_species` | read | `allergen_tags` (R39), allowlist join |
| `public.inventory_items` | read | `species_id` label source; `is_organic_claim` render rule (R44) |
| `public.listings` | read | Disclosure attaches here |
| `public.exchange_sessions` | read | Corroboration signal (R27); handoff guidance (R56) |
| `public.reports` | insert/read | `misrepresented_goods` sub-reason (R46) |
| `private.model_registry` | none (service only) | **New.** Versions, class allowlist, per-class metrics |
| `private.training_corpus_members` | none (service only) | **New.** Dissociated image ids (R31) |
| `public.model_class_allowlist` | read (`authenticated`) | **New.** Server-delivered, no app release to change (R21) |
| `audit.events` | insert | Model promotion, allowlist change, corpus access |

**New schema objects introduced by this spec:** migration `20270620_0140_crop_id_and_food_safety.sql`

```sql
CREATE TYPE inference_site   AS ENUM ('on_device','server');
CREATE TYPE prediction_outcome AS ENUM
  ('accepted','corrected','rejected','abandoned','below_threshold','not_presented');
CREATE TYPE treatment_kind   AS ENUM ('none','organic_approved','synthetic','unknown');
CREATE TYPE wash_state       AS ENUM ('unwashed','rinsed','washed','unknown');
CREATE TYPE animal_access    AS ENUM ('none','pets','livestock','unknown');

CREATE TABLE public.crop_id_predictions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  media_asset_id      uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  model_version       text NOT NULL CHECK (length(model_version) <= 40),
  inference_site      inference_site NOT NULL,
  top_species_id      integer REFERENCES public.crop_species(id),
  top_confidence      real CHECK (top_confidence BETWEEN 0 AND 1),
  margin              real CHECK (margin BETWEEN 0 AND 1),
  candidates          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{species_id, confidence}] ≤ 5
  presented           boolean NOT NULL DEFAULT false,
  accepted_species_id integer REFERENCES public.crop_species(id),
  outcome             prediction_outcome NOT NULL DEFAULT 'not_presented',
  latency_ms          integer CHECK (latency_ms BETWEEN 0 AND 60000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT predictions_no_coords CHECK (NOT app.jsonb_has_coord_key(candidates))
);

CREATE INDEX predictions_owner_idx   ON public.crop_id_predictions (owner_id, created_at DESC);
CREATE INDEX predictions_eval_idx    ON public.crop_id_predictions (model_version, outcome);
CREATE INDEX predictions_species_idx ON public.crop_id_predictions (top_species_id, outcome);

CREATE TABLE public.food_safety_disclosures (
  listing_id        uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  owner_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  treatment         treatment_kind NOT NULL,
  treatment_last_applied_on date CHECK (treatment_last_applied_on <= current_date),
  wash_state        wash_state    NOT NULL,
  animal_access     animal_access NOT NULL,
  species_allergen_tags text[] NOT NULL DEFAULT '{}',   -- copied from crop_species, immutable
  cross_contact_tags  text[] NOT NULL DEFAULT '{}'
                      CHECK (cross_contact_tags <@ ARRAY[
                        'shared_kitchen','shared_tools','grown_beside_allergen',
                        'processed_at_home','stored_with_nuts']),
  handling_note     text CHECK (length(handling_note) <= 300),
  scan_state        text NOT NULL DEFAULT 'pending'
                    CHECK (scan_state IN ('pending','clean','flagged','error')),
  attested_at       timestamptz NOT NULL,
  attested_version  smallint NOT NULL,                  -- R55
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX disclosures_owner_idx ON public.food_safety_disclosures (owner_id);

-- Server-delivered so a bad class is removed without a model retrain or a
-- store release (R21). Read by the client at cold start alongside the taxonomy.
CREATE TABLE public.model_class_allowlist (
  model_version text NOT NULL,
  species_id    integer NOT NULL REFERENCES public.crop_species(id),
  recall        real NOT NULL CHECK (recall BETWEEN 0 AND 1),
  precision     real NOT NULL CHECK (precision BETWEEN 0 AND 1),
  enabled       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (model_version, species_id)
);

CREATE TABLE private.model_registry (
  model_version   text PRIMARY KEY,
  artifact_sha256 text NOT NULL,
  trained_at      timestamptz NOT NULL,
  corpus_size     integer NOT NULL,
  eval_summary    jsonb NOT NULL,
  shadow_from     timestamptz,
  promoted_at     timestamptz,
  retired_at      timestamptz
);

CREATE TABLE private.training_corpus_members (
  image_ref   uuid PRIMARY KEY,        -- opaque; NOT media_assets.id (R31)
  species_id  integer NOT NULL,
  capture_tag text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.model_registry, private.training_corpus_members
  FROM anon, authenticated;

ALTER TABLE public.profiles
  ADD COLUMN training_opt_out boolean NOT NULL DEFAULT false;   -- R28

-- The one affirmative attestation this spec adds to an item (R48). Default false
-- means a fungus is un-listable until its grower says where it came from.
ALTER TABLE public.inventory_items
  ADD COLUMN cultivated_attested boolean NOT NULL DEFAULT false;

-- The prohibited-category guard, at the schema level rather than in a filter (R50).
CREATE OR REPLACE FUNCTION public.guard_prohibited_listing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_condition item_condition; v_kingdom smallint;
BEGIN
  SELECT i.condition, c.kingdom_id INTO v_condition, v_kingdom
    FROM public.inventory_items i
    JOIN public.crop_species s ON s.id = i.species_id
    JOIN public.crop_categories c ON c.id = s.category_id
   WHERE i.id = NEW.inventory_item_id;

  IF v_condition = 'preserved' THEN
    RAISE EXCEPTION 'prohibited_preserved' USING ERRCODE = '22023';   -- R47
  END IF;
  IF v_kingdom = 2 AND NOT COALESCE(
       (SELECT cultivated_attested FROM public.inventory_items WHERE id = NEW.inventory_item_id),
       false) THEN
    RAISE EXCEPTION 'prohibited_foraged_fungi' USING ERRCODE = '22023';  -- R48
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_guard_prohibited_listing
BEFORE INSERT OR UPDATE OF status ON public.listings
FOR EACH ROW WHEN (NEW.status = 'active')
EXECUTE FUNCTION public.guard_prohibited_listing();
```

RLS:

```sql
CREATE POLICY predictions_insert_own ON public.crop_id_predictions
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY predictions_select_own ON public.crop_id_predictions
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR app.is_moderator());
-- Client may record its own on-device inference outcome and nothing else.
-- No UPDATE policy except the narrow outcome write, below.
CREATE POLICY predictions_update_outcome ON public.crop_id_predictions
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND outcome = 'not_presented')
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY disclosures_select_with_listing ON public.food_safety_disclosures
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.listings l
                     WHERE l.id = listing_id)     -- listings_select_discoverable applies
         OR app.is_moderator());

CREATE POLICY disclosures_write_own ON public.food_safety_disclosures
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()) AND app.can_transact());

CREATE POLICY allowlist_read ON public.model_class_allowlist
  FOR SELECT TO authenticated USING (enabled);
```

Also introduced: `public.record_prediction`, `public.set_food_safety_disclosure`, `app.species_allergen_tags(integer)`, `app.corpus_candidates()`, `app.rebuild_class_allowlist(text)`, `guard_disclosure_immutable_allergens` (R39), and the `content-scan` extension for `handling_note`.

**PII touched:** `crop_id_predictions.owner_id` (P2) and `media_asset_id` (points at an asset whose `path` is P1). Predictions are owner-scoped and moderator-readable and appear in no other user's response. `food_safety_disclosures` is **P2 and deliberately semi-public** — it is shown to anyone who can see the listing, which is the point of it; `handling_note` is **P1** free text handled exactly like `messages.body` (never logged, never in Sentry or PostHog, scanned). `profiles.training_opt_out` is P3. `private.training_corpus_members` holds **no user identifier at all** (R31) — that dissociation is the design, not a precaution.

## 7. API

### 7.1 `rpc.record_prediction`

**Auth:** `authenticated` · **Rate limit:** 120 / hour / user

```jsonc
// Request — written by the client after on-device inference
{ "p_id": "e4a1…", "p_media_asset_id": null, "p_model_version": "cropid-3.2.0",
  "p_inference_site": "on_device", "p_top_species_id": 412,
  "p_top_confidence": 0.91, "p_margin": 0.34,
  "p_candidates": [{ "species_id": 412, "confidence": 0.91 },
                   { "species_id": 655, "confidence": 0.57 }],
  "p_presented": true, "p_latency_ms": 480 }
// Response 201
{ "prediction_id": "e4a1…" }
```

`p_media_asset_id` is null when inference ran on a camera frame the user never saved — which is the common case, and the reason the column is nullable. The row still carries the evaluation signal without pointing at an image that does not exist.

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Confidence outside [0,1]; more than 5 candidates; unknown `model_version`; a `species_id` not in `crop_species` |
| `rate_limited` | 429 | Bucket empty |

### 7.2 Inference siting: on-device versus server

| Dimension | On-device (chosen default) | Our server | Third-party vision API (**rejected**) |
| --- | --- | --- | --- |
| Image egress for inference | **None** | To our own storage, already there | To an external processor |
| Latency | 200–600 ms on the reference device | 600–2500 ms including upload | 800–4000 ms |
| Works offline | **Yes** — matches the offline-first picker ([SPEC-005 R13](SPEC-005-crop-taxonomy.md)) | No | No |
| Model size cost | 8–14 MB in the bundle or OTA | None | None |
| Accuracy ceiling | Lower — a quantized MobileNet-class model | Higher — a larger backbone | Highest |
| Update cadence | OTA model delivery, no store release | Immediate | Vendor's |
| Old-device coverage | Degrades; R09's fallback exists for this | Universal | Universal |
| Privacy review burden | Minimal | Contained | **New processor, new DPA, new sub-processor disclosure, garden photos leaving our control** |

**The decision.** On-device by default (R09), our own server only as a capability fallback (R10), third-party never (§3). The accuracy gain from a larger hosted model is real and is not worth telling users that photographs of their garden — which frequently contain a house, a fence, a car, or a street — are sent to a company they have not heard of. This is the same reasoning that produced the hosted-KYC-vendor decision in [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) applied in the opposite direction: there we chose a vendor to avoid holding document images; here we refuse a vendor to avoid disclosing garden images. In both cases the question is *who ends up holding the sensitive artefact*.

### 7.3 Model and allowlist delivery

`GET /rest/v1/model_class_allowlist?model_version=eq.<v>&enabled=is.true` — read at cold start alongside the taxonomy delta, cached with `staleTime: Infinity`, and **never blocking any screen** ([SPEC-005 R23](SPEC-005-crop-taxonomy.md)). The model artefact itself is delivered over the air, pinned by `artifact_sha256` from `private.model_registry`, and verified before use; a hash mismatch means no assist, silently (R07).

### 7.4 `rpc.set_food_safety_disclosure`

**Auth:** `authenticated` + `app.can_transact()` · **Rate limit:** 60 / day / user

```jsonc
// Request
{ "p_listing_id": "7b3c…", "p_treatment": "none", "p_treatment_last_applied_on": null,
  "p_wash_state": "unwashed", "p_animal_access": "pets",
  "p_cross_contact_tags": ["shared_kitchen"],
  "p_handling_note": "Picked this morning, keep in the fridge.",
  "p_attested_version": 3 }
// Response 200
{ "listing_id": "7b3c…", "species_allergen_tags": [], "attested_at": "…",
  "requires_requester_notice": false }
```

`species_allergen_tags` is returned as computed server-side from `crop_species.allergen_tags` and is **not accepted as input** — R39 is enforced by the parameter list, not by validation. `requires_requester_notice` is true when the listing already has an accepted request, triggering R43.

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not the listing owner |
| `validation_failed` | 400 | Value outside a closed vocabulary; free-text allergen attempted; `attested_version` not the current one |
| `attestation_stale` | 409 | The disclaimer version has changed since the client loaded the form; the client must re-present it |
| `rate_limited` | 429 | Bucket empty |

### 7.5 Publishing guard

`publish_listing` ([SPEC-009](SPEC-009-listings-and-offers.md)) gains two failure modes:

| Error code | HTTP | When |
| --- | --- | --- |
| `disclosure_required` | 422 | No `food_safety_disclosures` row and the flag is on (R34) |
| `prohibited_item` | 422 | `preserved` condition, or an un-attested fungus (R47, R48), with a `category` field naming which |

### 7.6 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| Any endpoint that sets `species_id` from a prediction | R01 |
| A numeric confidence in any user-facing response | R17 |
| Another user's predictions | Owner-scoped; a guessed id returns an empty set |
| The training corpus, its size per class, or any image reference | R30, R31 |
| A "is this safe to eat" endpoint | §3, and there is no honest implementation |
| A plant-disease or pest endpoint | §3 |
| A produce quality score | §3, R44 |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Camera assist | `/(modals)/species-picker?assist=camera` | Capture → suggestion → picker, in one sheet |
| Species picker (assisted state) | Same sheet | Pre-selection or candidate chips above the search field |
| Disclosure form | `/(modals)/listing/[id]/disclosure` | Four closed-vocabulary questions, allergens, note, attestation |
| Disclosure on listing | Inline on `/(modals)/listing/[id]` | Recipient-facing, above the request button |
| Handoff guidance | Inline on `/(modals)/exchanges/session/[id]` | R56's raw-produce guidance at confirmation |
| Prohibited item explainer | `/(modals)/listing/prohibited?category=` | Why we refused, what to do instead |
| Training opt-out | `/profile/settings/privacy` | R28 |

The assist lives **inside** the existing species picker sheet rather than in a separate camera screen. A separate screen implies a separate mechanism with its own authority; a chip above the search field is visibly one input among several, which is exactly what it is.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | The picker paints populated from the bundled taxonomy on frame one ([SPEC-005 §8.2](SPEC-005-crop-taxonomy.md)); inference runs alongside with a 2 dp indeterminate bar above the chip row and a 1500 ms ceiling (R16). Nothing waits for it. The disclosure form paints instantly — every option is local, closed-vocabulary data. |
| Empty | Two meanings. **No suggestion** (below `τ_show`, no allowlisted class, model absent, or inference failed): the picker looks exactly as it does without the assist, with no message, no "couldn't identify", and no apology (R07, R11). **No disclosure yet on a listing being viewed**: the recipient sees "The grower hasn't filled this in" rather than a blank — an absent disclosure is itself information. |
| Error (recoverable) | `set_food_safety_disclosure` 5xx: the form keeps every answer and offers Retry. `attestation_stale` 409 re-presents the disclaimer with the answers preserved and the attestation cleared — the answers were the user's, the agreement was to a version that changed. |
| Error (terminal) | A prohibited item (R47, R48): publishing is refused with the explainer screen, the inventory item is **not** deleted, and the user can edit it into a listable form. Framed as a category rule, never as a rule violation (R52). |
| Offline | Full assist works offline — on-device inference, bundled taxonomy, cached allowlist (R09). `record_prediction` is queued and replayed. The disclosure form fills offline and the write is queued; **publishing is not**, because publishing needs the server-side guard in R34/R50 and an optimistic publish of a prohibited item is exactly the thing that must not happen. |
| Permission denied | Camera denied: the assist entry point is absent — not disabled — and the picker opens normally, with the ordinary "add a photo later" path from [SPEC-006](SPEC-006-crop-inventory.md). Camera denial is a supported state, never a funnel ([Location Privacy §9](../01-architecture/04-location-privacy.md)). |
| Rate limited | `record_prediction` 429 (120/h) is invisible: the queue drops the telemetry row and the assist continues, because a prediction record is our data, not the user's task. `set_food_safety_disclosure` 429 (60/day) shows the quota copy with a countdown and preserves the form. |

Two feature-specific states:

| State | Behaviour |
| --- | --- |
| Suggestion corrected (R04) | The chip row collapses, the search field focuses, and the correction is recorded with `outcome = 'corrected'`. **No "are you sure?", no comparison of the two options, and no second suggestion.** The user has told us we were wrong; arguing is how a person learns to ignore the feature. |
| Disclosure changed after acceptance (R43) | The requester's exchange screen shows a distinct banner naming which fields changed, with `Keep going` and `Cancel this exchange` as equal-weight actions and no cancellation penalty. |

### 8.3 Copy

Exact strings. **Everything under "Disclaimers" and "Handoff guidance" is a draft for counsel (R53).**

**Assist, pre-selected (≥ τ_preselect, margin ≥ 0.20)**
> Looks like **{species}** — check this is right.
> Buttons: `That's it` · `Not what I've got`

**Assist, candidate chips (τ_show … τ_preselect)**
> Might be one of these:
> `{species_1}` · `{species_2}` · `{species_3}` · `Something else`

**Assist, ambiguity group (R18)**
> "{group}" covers a few different crops. Which one?

**Assist, below threshold** — *(no copy; the picker opens normally)*

**Camera permission rationale**
> To photograph your crops and have a guess at what they are. Photos stay on your phone until you add them to a listing.

**Training opt-out setting (R28)**
> **Help improve crop recognition**
> When an exchange completes, the photo and the crop you chose can be used to make the app better at recognising crops. Turn this off and yours won't be.
>
> We remove your photos from future versions if you turn this off or delete your account. A model that has already been trained can't be untrained.

**Disclosure form — heading**
> **About this food**
> Four quick questions. "I'm not sure" is a fine answer.

**Disclosure form — treatment (R36)**
> **Sprays or treatments?**
> Nothing used · Organic-approved only · Synthetic sprays · I'm not sure

**Disclosure form — wash (R37)**
> **Has it been washed?**
> Not washed · Rinsed · Washed · I'm not sure

**Disclosure form — animals (R38)**
> **Do animals get into where this grew?**
> No · Pets (cat, dog) · Livestock (chickens, goats) · I'm not sure

**Disclosure form — allergens, pre-filled and locked (R39)**
> **Allergens**
> {species} is a {allergen_tag}. This can't be changed.

**Disclosure form — cross-contact (R40)**
> **Anything else worth mentioning?**
> Prepared in a shared kitchen · Shared tools · Grown next to nuts · Stored with nuts

**Disclosure form — handling note**
> **Anything the other person should know?** (optional)
> Placeholder: `e.g. Picked this morning, best used in a couple of days.`

**Disclosure form — attestation (R55)**
> This is my own honest description of food I grew. I understand Sharecropr doesn't check it.
> Button: `Publish listing`

**Disclosure on a listing — attribution line (R58), always adjacent**
> This is what the grower told us. Sharecropr hasn't checked it.

**Disclosure on a listing — rendered**
> **Grower says:** No sprays used · Not washed · Pets get into the beds
> **Allergens:** Tree nuts
> "Picked this morning, best used in a couple of days."

**Disclosure absent**
> The grower hasn't filled this in.

**Organic claim, everywhere it appears (R44)**
> Grower says: organic

**Disclosure changed after acceptance (R43)**
> **{name} updated what they said about this food.**
> Changed: washed → not washed.
> Buttons: `Keep going` · `Cancel this exchange`

**Handoff guidance, shown at handoff confirmation (R56)**
> **Before you eat it**
> Wash raw fruit and veg under running water, even if the grower says it's been washed. Home-grown food isn't inspected by anyone.
>
> If you feel unwell after eating something, contact a doctor or your local health authority.

**Completed-exchange restatement (R56)**
> Wash raw produce before eating. Sharecropr doesn't inspect or test any food.

**Seeds guidance (R51)**
> **Seeds are not food.** Some seed is treated with fungicide and is poisonous. Don't eat it, and keep it away from children and pets.

**Prohibited — preserved / home-canned (R47)**
> **We can't accept home-canned or preserved food.**
> Jars, bottles, pickles, and preserves made at home can carry botulism, which is rare and very serious. There's no way for us — or for you — to tell a safe jar from an unsafe one, so we don't allow them at all.
>
> Fresh produce from the same garden is very welcome.

**Prohibited — foraged fungi (R48)**
> **We only accept mushrooms grown from a kit or spawn.**
> Wild mushrooms are misidentified by experienced people every year, sometimes fatally. We're not going to be part of that.

**Prohibited — other categories (R49)**
> **We can't accept {category} here.**
> Sharecropr is for fresh produce from home gardens. Some foods need handling we can't stand behind.

**Prohibited — the line that must be there (R52)**
> This isn't a warning and nothing happens to your account.

**Disclosure quota**
> You've updated a lot of listings today. You can make more changes in {mm:ss}.

**Accessibility label — disclosure block**
> Grower's description, not checked by Sharecropr. Sprays: none used. Washed: not washed. Animals: pets have access. Allergens: tree nuts. Note: {handling_note}.

**Accessibility label — assist suggestion**
> Suggestion: {species}. Not confirmed. Double tap to accept, or use "Not what I've got" to search instead.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | Two different worst cases, one per half. For **crop ID**, the worst outcome is not an attacker at all — it is us: a confidently wrong classification that a user accepts without reading, producing a listing whose species is wrong, which in the presence of `crop_species.allergen_tags` means **an allergen declaration that is wrong**. A "walnut" misread as "pecan" carries the same tag and is harmless; a plant misread across families is not. R01 (never writes the classification), R02 (always presented as unconfirmed), R13 (confidence *and* margin), R14 (allowlist filtering with no remapping), R18 (defer to the taxonomy's own ambiguity sets), and R39 (allergen tags follow the species the **user confirmed**, computed server-side and not accepted as input) are all aimed at this single failure. The adversarial version — deliberately photographing X to have the app propose Y — buys nothing, because the user picks the species anyway and the picker is right there. For **food safety**, the worst case is a grower lying, and we cannot prevent it: no technical control distinguishes "unsprayed" from "sprayed yesterday". What we can do is make the claim specific, attributed, timestamped, versioned, retained for three years (R45), and reportable with the disclosure attached as it stood at handoff (R46). A secondary security concern is the **model artefact itself**: an OTA-delivered binary that runs on device is a code-delivery channel, which is why R21's allowlist and the artefact are separate, the artefact is pinned by `artifact_sha256` in `private.model_registry`, and a hash mismatch degrades to no assist rather than to a prompt. |
| **Which RLS policies enforce access?** | `predictions_insert_own`, `predictions_select_own` (self or moderator), `predictions_update_outcome` (narrowed by its `USING (outcome = 'not_presented')` so an outcome can be written once and not rewritten later to flatter the model); `disclosures_select_with_listing` (piggybacking on `listings_select_discoverable`, so block enforcement, suspension, and expiry are inherited from Pattern D rather than re-implemented — [RLS Design §5](../01-architecture/05-rls-design.md)); `disclosures_write_own` gated on `app.can_transact()`; `allowlist_read` (Pattern B, enabled rows only). Definer functions: `public.record_prediction`, `public.set_food_safety_disclosure`, `public.guard_prohibited_listing`, `app.species_allergen_tags`, `app.corpus_candidates`, `app.rebuild_class_allowlist`, `app.jsonb_has_coord_key`, `app.can_transact`, `app.is_moderator`, `app.consume_token`. Each bypasses RLS and re-checks authorization first. `private.model_registry` and `private.training_corpus_members` have no grants to any client role. **Absences that carry weight:** no policy allows a client to write `species_allergen_tags` (R39), no policy allows a DELETE on a disclosure (removal follows the listing), and no policy or function anywhere sets `species_id` from a prediction (R01). |
| **Can any response path expose an exact coordinate or PII?** | No — but this is the spec in the set where it was hardest to keep true, because **photographs are the most reliable location leak in the product**. A phone photo of a courgette carries GPS EXIF, and its background carries a house, a fence, a wheelie bin with a number on it, and sometimes a street sign. **How this feature preserves the location invariant:** (1) on-device inference (R09) means the ordinary path involves **no image egress at all for inference**, so the classifier adds zero new exposure; (2) server inference (R10) may read only assets with `exif_stripped_at IS NOT NULL`, which is already enforced in RLS for every read path ([Data Model §8](../01-architecture/03-data-model.md#8-inventory)) — an unprocessed asset is invisible to it; (3) **no third-party vision API**, so no garden photograph reaches a processor outside our control (§7.2); (4) the training corpus stores an opaque `image_ref`, a `species_id`, and a capture tag, with **no `owner_id`, no `garden_id`, and no listing reference** (R31); (5) `crop_id_predictions.candidates` carries the same `app.jsonb_has_coord_key` CHECK used on `notifications.payload` and `audit.events.metadata` (LP-11); (6) no table, view, or RPC return type in this spec has a `geography`, `geometry`, `h3_*`, `lat`, or `lng` column, and no function here reads `private.garden_locations`. The residual, stated plainly: **image *content* can disclose a location and we cannot strip that.** A photograph taken over a fence showing a recognisable street is a disclosure the user made by pointing the camera, and EXIF stripping does not touch it. That is [SPEC-006](SPEC-006-crop-inventory.md)'s existing residual; this spec adds photographs to no new audience, and the camera-permission copy (§8.3) is the only honest mitigation. |
| **What is logged, and is it scrubbed?** | Predictions log `model_version`, `inference_site`, `top_species_id`, bucketed confidence, `outcome`, and `latency_ms`. **No image, no image path, no `media_asset_id`, and no raw confidence value reach telemetry**; the scrubber's drop list is extended with `image`, `photo`, `asset_path`, and `handling_note`. Disclosure telemetry carries the closed-vocabulary values and never `handling_note`, which is free text and is treated exactly as `messages.body` ([SPEC-011 §9](SPEC-011-messaging.md)). Model promotion, allowlist changes, and any human access to the training corpus write `audit.events` (R30). Prohibited-item refusals are counted (R52) with a category and no user identifier. |
| **Does this need step-up authentication?** | No for ordinary use. **Yes for two staff operations:** promoting a model version and editing `model_class_allowlist`, both of which change what runs on every user's device or what the product is willing to claim. Both are console operations behind SSO plus AAL2 and both are audited. |
| **Abuse / rate-limit controls** | `record_prediction` 120/h/user, `set_food_safety_disclosure` 60/day/user, `content-scan` on every `handling_note` (R41), closed vocabularies everywhere so there is no free-text injection surface except the note, `app.can_transact()` on every disclosure write, the publishing guard (R50) as a database trigger rather than a client check, and the `misrepresented_goods` report path (R46) as the only enforcement against a false claim — which we should be honest is a slow, human, after-the-fact control and not a preventative one. |

**Threat notes.**

- **Consent is the sharp edge of the corpus.** Users uploaded photographs to sell a courgette, not to train a classifier. R27's basis (completed exchange), R28's opt-out, R31's dissociation, R32's deletion path, and R33's requirement that the privacy notice land *before* the first image is used are collectively the difference between a defensible corpus and a retroactive justification. R32's second sentence — "a model already trained cannot be untrained" — is in the user-facing copy deliberately, because it is true and because promising otherwise would be the actual violation.
- **`crop_species.allergen_tags` was pre-wired in MVP and rendered by nothing** ([SPEC-005 §3](SPEC-005-crop-taxonomy.md)). This spec is the first thing to render it, which makes the accuracy of that seed data a **safety** property rather than a completeness one. Auditing every populated tag against a recognised allergen list, before the first render, is a launch gate (§14).
- **Model inversion and membership inference** are theoretically applicable to an on-device model trained on user photographs. For a quantized classifier over a few hundred crop classes the practical risk is low, and it is non-zero; the mitigation that matters is R31's dissociation, which means a successful inference recovers "some garden produced a tomato photo" rather than a person.
- **The disclosure is not a liability shield.** It is a record of what one person said. Treating it internally as protection is the failure mode R54 exists to name.

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Model returns 0.93 for Tomato and 0.89 for Tomatillo. | R13's margin condition fails (0.04 < 0.20), so nothing is pre-selected and both appear as chips. This is the single most common real failure of a crop classifier and the margin rule exists for it specifically. |
| EC-02 | User photographs a crop that is not on the allowlist — say, oca. | R14 drops the non-allowlisted classes; whatever remains is almost certainly below `τ_show`; the picker opens normally with no message (R11). The user searches "oca" and finds it. We were silent rather than wrong. |
| EC-03 | User photographs something that is not food at all. | Confidence is low across all allowlisted classes; no suggestion. There is no "that's not a crop" detector and we do not pretend to one. |
| EC-04 | Model is mid-download or its hash does not match. | R07: no assist, silently, and the picker behaves exactly as it does for a user who never had the model. |
| EC-05 | On-device inference takes 3 seconds on an old device. | R16: abandoned at 1500 ms, `outcome = 'abandoned'` recorded, picker unaffected. The device is added to the server-fallback capability list (R10) for next time. |
| EC-06 | A species on the allowlist is merged in the taxonomy ([SPEC-005 R34](SPEC-005-crop-taxonomy.md)). | R25: the output layer is regenerated from the taxonomy at build time, and until the next build the allowlist row for the losing id is disabled by `rebuild_class_allowlist`. A prediction can never name a species that no longer exists. |
| EC-07 | A class's live precision drops after a seasonal shift (green tomatoes in October). | R21: the class is removed from the allowlist by a data change — no retrain, no store release — and predictions for it stop within one cold start. |
| EC-08 | User accepts a suggestion, then edits the item's species a week later. | The prediction row keeps `outcome = 'accepted'`; the later correction is a separate signal that the evaluation pipeline reads via `inventory_items` history. We deliberately do not rewrite the original outcome — R's `predictions_update_outcome` policy forbids it — because a model's record of what it got right must not be editable after the fact. |
| EC-09 | User publishes a listing before the disclosure flag is enabled, then the flag turns on. | Existing active listings are **not** retroactively blocked; they render "The grower hasn't filled this in" and prompt the owner once. Un-publishing thousands of live listings on a flag flip would be a worse outcome than a transitional gap, and the gap closes as listings expire at 21 days ([Data Model §10](../01-architecture/03-data-model.md#10-listings--the-exchange)). |
| EC-10 | Grower edits "washed" to "not washed" after a request is accepted. | R43: the requester gets a banner naming the change and may cancel without penalty. The disclosure as it stood at handoff is what R46 attaches to any later report — both versions are retained. |
| EC-11 | A species' `allergen_tags` are corrected in the taxonomy after listings exist. | Existing disclosures keep their `species_allergen_tags` snapshot **and** the listing renders the current species tags alongside, with the union shown. An allergen we later learned about must appear immediately; an allergen we listed in error must not silently vanish from a record someone may have relied on. |
| EC-12 | User tries to list home-made jam. | R47: `prohibited_preserved` at the trigger, the explainer screen, the item is untouched, no moderation event (R52). The counter increments so we know how often this happens — if it is constant, that is a product signal about what people actually have spare, not a reason to relax the rule. |
| EC-13 | User lists cultivated oyster mushrooms and attests they came from a kit. | Permitted (R48). Fungi remain permanently absent from the class allowlist regardless, so the assist never proposes a mushroom species. |
| EC-14 | User lists seed. | Permitted with the not-for-consumption copy (R51). No disclosure fields about washing or animal access make sense; the form collapses to allergens and the note. |
| EC-15 | A recipient reports illness after an exchange. | R60's runbook: preserve the disclosure, listing, session, and thread; notify counsel; do not offer a medical opinion; direct the reporter to a health professional (R57). The report is `misrepresented_goods` with the disclosure sub-reason (R46) and severity is set by a human, not by a rule. |
| EC-16 | A user opts out of training after 400 of their images are in the corpus. | R28: rows removed from `private.training_corpus_members` and excluded from the next build. The currently-deployed model is unchanged, and the copy said so before they chose (R32). |
| EC-17 | The `handling_note` contains an address or a phone number. | `content-scan` flags it exactly as it flags a message (R41); the note is not blocked or altered ([SPEC-011 R28](SPEC-011-messaging.md)); the sender sees the same non-blocking safety notice. |
| EC-18 | A grower selects "I'm not sure" for all four questions. | Entirely acceptable and rendered without any warning treatment (R35). The listing shows four "not sure" answers and the recipient decides. A product that shames uncertainty gets certainty-shaped lies. |
| EC-19 | Legal counsel rejects the disclaimer wording in §8.3 after implementation. | Expected, and cheap: the strings are versioned (`attested_version`, R55) and behind `CODEOWNERS` (R59). A wording change is a copy migration plus a re-attestation prompt, not a schema change. This is why the versioning exists. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `cropid.prediction` | product event | `model_version`, `inference_site`, `confidence_bucket`, `margin_bucket`, `presented`, `latency_ms` — **never an image or an asset path** | p95 on-device `latency_ms` > 1200 ms |
| **`cropid.acceptance_rate`** | gauge | `outcome = 'accepted'` ÷ presented, per `model_version` | **< 70% ⇒ the assist is costing more taps than it saves and should be turned off, not tuned** |
| `cropid.correction_rate` | gauge | `outcome = 'corrected'` ÷ presented | Rising after a promotion ⇒ roll back per R24 |
| **`cropid.per_class_precision`** | gauge | precision and recall per allowlisted species, from live corrections | **Any class below R19's floor ⇒ remove from the allowlist that day** |
| `cropid.allowlist_size` | gauge | enabled classes per model version | Falling ⇒ coverage is shrinking; feeds the curation backlog (R26) |
| `cropid.silent_rate` | gauge | share of captures producing no suggestion | Useful as a coverage measure and **not** an error rate. Rising alongside a stable acceptance rate is the model correctly declining to guess |
| `cropid.abandoned` | counter | `device_class` | > 5% ⇒ the on-device path is too slow for a meaningful share of devices |
| `cropid.server_fallback_rate` | gauge | share of inferences at `inference_site = 'server'` | > 15% ⇒ reconsider the model size; every server inference is an image leaving the device |
| `cropid.shadow_delta` | gauge | per-class recall delta, candidate vs. incumbent | Any class −5 pp blocks promotion (R23) |
| `cropid.training_opt_out_rate` | gauge | users with `training_opt_out = true` | > 10% ⇒ the consent copy is landing badly or the basis is wrong |
| `foodsafety.disclosure_completion` | gauge | listings published with a disclosure | < 95% after the flag is on ⇒ the guard is leaking |
| `foodsafety.unknown_rate` | gauge | share of `unknown` answers per field | Reported, **never alerted on and never optimized against**. Driving this number down is how you get false certainty (R35) |
| `foodsafety.disclosure_edited_after_accept` | counter | `field` | Rising ⇒ investigate; this is the shape of a bait-and-switch |
| `foodsafety.misrepresented_reports` | counter | with and without a disclosure attached | Any illness-related report **pages** and enters R60's runbook |
| `foodsafety.prohibited_blocked` | counter | `category` (`preserved`\|`foraged_fungi`\|`other`) | Tracked as a product signal (R52), not as an abuse signal |
| `foodsafety.attestation_version` | gauge | distribution of `attested_version` across active listings | A stale version persisting after a copy change ⇒ re-attestation is not reaching people |

> `cropid.acceptance_rate` and `cropid.per_class_precision` are the two numbers that decide this feature's future. If acceptance sits below 70%, the assist is a suggestion people routinely override, which is worse than no suggestion — it adds a step and teaches distrust. The pre-agreed response is to disable the assist, not to lower the thresholds.

**Never emitted:** an image, an image path, a `media_asset_id`, a raw confidence value, a `handling_note`, a training-corpus reference, or any user identifier alongside a per-class metric.

## 12. Accessibility

- The assist suggestion is announced as **unconfirmed**: "Suggestion: Tomato. Not confirmed." The word "suggestion" leading the label is the accessibility expression of R03, and it must not be reordered for brevity.
- `Not what I've got` is a real, labelled button in the traversal order immediately after the suggestion — not a swipe, not a long-press, not a secondary affordance (R04, R15).
- Confidence is never conveyed by colour, opacity, chip size, or ordering alone; the "Looks like" / "Might be" register (R17) is text and is read aloud.
- The disclosure form is a set of labelled radio groups (`accessibilityRole="radio"`, `accessibilityState={{ checked }}`) with a group label per question, not a row of icons or a segmented control. "I'm not sure" is announced identically in tone to every other option — no "warning", no "incomplete" (R35).
- Locked allergen tags announce why they are locked: "Tree nuts. Set from the crop and can't be changed."
- The rendered disclosure is **one** accessible element read as sentences (§8.3), so a screen-reader user gets the whole picture in one stop rather than five, and the attribution line is part of that element rather than a separate stop that can be skipped (R58).
- The handoff guidance (R56) is announced through an `accessibilityLiveRegion="polite"` region when the handoff step is reached, and remains focusable afterwards rather than disappearing.
- The prohibited-item explainer leads with the category and the reason, in that order, and its "nothing happens to your account" line is part of the same element so it cannot be missed (R52).
- Camera-assist entry is absent rather than disabled when permission is denied, keeping it out of the traversal order entirely (§8.2).
- Dynamic type to 200% throughout; disclosure answers wrap rather than truncate, because a truncated "Synthetic spr…" is a misread with consequences.
- Reduced motion: the chip row appears without animation and the picker never animates a selection into place.
- Minimum 44 × 44 dp on every chip, radio option, and the attestation button.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01 | Static check plus runtime assertion: no code path writes `species_id` from a prediction; a forced 0.999 prediction still leaves `species_id` null until a tap |
| T02 | e2e | R02, R03 | The pre-selected state is visually and semantically a pending selection; the "check this is right" attribution renders in every presented state |
| T03 | e2e | R04, R15 | Correction is one tap from pre-selection and is at least as prominent; `Not what I've got` clears and focuses the search field |
| T04 | integration | R05 | Mutating prediction rows changes no search ranking, no match suggestion, and no map result |
| T05 | e2e | R06 | The full listing flow completes with the assist never invoked |
| T06 | e2e | R07 | Missing model, hash mismatch, and inference exception each degrade to the plain picker with **no** user-visible message |
| T07 | integration | R08 | Every inference — presented or not — writes a row with `model_version`, `inference_site`, candidates, and an eventual outcome |
| T08 | integration | R09 | Network-blocked device still produces a suggestion; a packet capture asserts zero image bytes leave the device |
| T09 | integration | R10 | Server inference refuses an asset with `exif_stripped_at IS NULL`; **no outbound request to any non-Sharecropr host** across the whole suite |
| T10 | unit | R11 | 0.54 → no suggestion; 0.56 → chips |
| T11 | unit | R12 | Between thresholds, at most 3 chips, nothing pre-selected |
| T12 | unit | R13 | 0.90/0.88 → chips; 0.90/0.60 → pre-selected. Both conditions asserted independently |
| T13 | unit | R14 | A non-allowlisted top-1 is dropped, not remapped to the nearest allowlisted class |
| T14 | perf | R16 | On-device p95 < 1500 ms on the reference device; the search field is interactive at first paint with inference in flight |
| T15 | e2e | R17 | No percentage, number, or bar appears in any assist state; snapshot-asserted |
| T16 | e2e | R18 | A squash photo presents the disambiguation list even at 0.95 confidence |
| T17 | integration | R19 | A species below 300 images / 60 gardens / 0.80 recall / 0.85 precision is absent from the allowlist |
| T18 | integration | R20 | The evaluation set is stratified by species, metro, and capture condition, and shares no image with the training set |
| T19 | integration | R21 | Disabling a class in `model_class_allowlist` stops predictions for it within one cold start, with no app release and no retrain |
| T20 | integration | R22 | `model_version` is present, immutable, and monotonic across the registry |
| T21 | integration | R23 | Promotion is blocked when any class regresses > 5 pp; a 14-day shadow window is required |
| T22 | integration | R24 | Staged rollout at 5/25/100% with per-stage acceptance monitoring; a flag reverts to the previous version without a release |
| T23 | integration | R25 | The output layer contains only live `crop_species` ids; a merged species cannot be predicted |
| T24 | integration | R27 | Corpus candidates exclude un-stripped, unapproved, and uncorroborated assets |
| T25 | integration | R28, R29 | Opt-out removes existing rows from the next build and changes nothing else about the user's experience |
| T26 | integration | R30, R31 | The corpus row carries no `owner_id`, `garden_id`, or listing reference; no export path to any third party exists |
| T27 | integration | R32 | Account deletion removes corpus rows; the privacy notice text asserting a trained model cannot be untrained is present |
| T28 | integration | R34 | With the flag on, `publish_listing` without a disclosure returns `disclosure_required` 422 |
| T29 | e2e | R35 | Every field offers "I'm not sure" with identical tap cost and no warning styling |
| T30 | integration | R36, R37, R38 | Each field accepts only its closed vocabulary; no pre-harvest interval is computed or displayed anywhere |
| T31 | integration | R39 | `species_allergen_tags` is computed server-side, is not a parameter, and cannot be removed by any client write |
| T32 | integration | R40 | Cross-contact tags are constrained by the array `CHECK`; a free-text allergen is rejected |
| T33 | integration | R41 | `handling_note` is scanned; a flagged note is delivered unmodified |
| T34 | e2e | R42 | The disclosure renders on the listing before the request button, in the request confirmation, and on the exchange screen |
| T35 | integration | R43 | Editing after acceptance notifies the requester and permits a penalty-free cancellation |
| T36 | integration | R44 | **String sweep across the whole bundle**: "safe", "certified", "verified", "approved", "inspected", "tested", "guaranteed", and bare "Organic" appear in no first-party produce string; `is_organic_claim` renders only as "Grower says: organic" |
| T37 | integration | R45 | A disclosure survives its listing's deletion and is retained 3 years |
| T38 | integration | R46 | A `misrepresented_goods` report attaches the disclosure as it stood at handoff, not as it stands now |
| T39 | integration | R47 | `item_condition = 'preserved'` cannot be published; the item is retained; no moderation event is written |
| T40 | integration | R48 | A fungus without `cultivated_attested` cannot be published; no fungus is ever on the class allowlist |
| T41 | integration | R49, R50 | No species row exists for any prohibited category; the guard is a trigger, not a keyword filter — asserted by attempting the publish through a raw HTTP client |
| T42 | e2e | R51 | Seed listings render the not-for-consumption copy |
| T43 | e2e | R52 | The refusal names the category, states that nothing happens to the account, and increments the counter |
| T44 | integration | R55 | `attested_at` and `attested_version` are recorded; a mismatched version returns `attestation_stale` 409 |
| T45 | e2e | R56 | The guidance renders at handoff confirmation and in the completed state, in that order |
| T46 | integration | R57 | The guidance directs to a health professional and never to support first; no symptom assessment string exists |
| T47 | e2e | R58 | The attribution line is adjacent to every rendered disclosure, never behind a tooltip or an expander |
| T48 | integration | R59 | Changing a disclaimer string without incrementing `attested_version` fails CI; `CODEOWNERS` covers the copy file |
| T49 | integration | R33 | Release-order assertion: the privacy-notice version describing the training basis, the opt-out, and the "cannot be untrained" limitation is live at least one release before `app.corpus_candidates()` returns a non-empty set. CI fails a corpus build against an older notice version |
| T50 | manual | R53, R54, R60 | Counsel sign-off recorded; per-metro exemption assessment complete; runbook exists and has been walked |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T51 | `POST /rest/v1/inventory_items` with a `species_id` sourced from a prediction id rather than a user selection | Indistinguishable at the API — which is why R01 is asserted at the client and by static analysis. The test proves no client code path performs this write automatically, and it is the reason R01 exists as a requirement rather than as a policy |
| T52 | `PATCH /rest/v1/crop_id_predictions` rewriting `outcome` from `corrected` to `accepted` | Denied — `predictions_update_outcome` permits a write only while `outcome = 'not_presented'`. Model performance records cannot be laundered |
| T53 | `GET /rest/v1/crop_id_predictions?owner_id=eq.<other user>` | Empty set — no 403, no existence oracle |
| T54 | `PATCH /rest/v1/food_safety_disclosures` setting `species_allergen_tags` to `'{}'` | Denied by `guard_disclosure_immutable_allergens` with 42501 (R39) |
| T55 | `POST /rest/v1/food_safety_disclosures` for another user's listing | Denied by `disclosures_write_own` |
| T56 | Publish a `preserved` item via a raw HTTP client bypassing the client-side check | `prohibited_preserved` from the trigger; the guard is in the database (R50) |
| T57 | Publish a foraged fungus by setting `cultivated_attested = true` without the UI | Permitted at the schema — it is an attestation, and lying in it is a `misrepresented_goods` report. Asserted so that the limit of the control is a **tested, known** gap rather than an assumed one, exactly as [SPEC-005 T55](SPEC-005-crop-taxonomy.md) treats homoglyphs |
| T58 | Submit an allergen tag as free text through `p_cross_contact_tags` | `validation_failed` from the array `CHECK`; the closed vocabulary is enforced at the database |
| T59 | Submit a 10 KB `handling_note` | `validation_failed` at 300 characters, CHECK-enforced |
| T60 | XSS payload in `handling_note`, rendered in the app and in the moderation console | Escaped in both; console renders text, never HTML |
| T61 | SQL injection payload in `handling_note` | Stored and rendered as literal text; parameterized throughout |
| T62 | **Network sweep across the entire test suite** for any outbound request carrying image bytes to a host outside Sharecropr infrastructure | Zero. The single most important negative test in this spec (§7.2, R10) |
| T63 | Server inference against an asset with `exif_stripped_at IS NULL` | Refused; the asset is invisible to the read path by RLS ([Data Model §8](../01-architecture/03-data-model.md#8-inventory)) |
| T64 | Upload a geotagged JPEG, run the assist, and inspect the stored asset and every prediction row | EXIF absent from the stored asset (LP-09); no coordinate in `candidates` (the `predictions_no_coords` CHECK); no coordinate in any log or telemetry event |
| T65 | Attempt to read `private.model_registry` or `private.training_corpus_members` as `authenticated` | Denied — no grants on `private` for any client role |
| T66 | Attempt to correlate a `training_corpus_members` row back to a user via any client-reachable join | No path exists; the row carries no user-linked column (R31) |
| T67 | Promote a model or edit `model_class_allowlist` without AAL2 | Rejected at the console's step-up check; both operations audited |
| T68 | Serve a model artefact whose `artifact_sha256` does not match the registry | The client refuses it and runs with no assist, silently (R07). No prompt, no fallback to an unverified artefact |
| T69 | Craft a prediction payload naming a `species_id` that does not exist, or 40 candidates | `validation_failed`; foreign key and array-length checks at the database |
| T70 | Contract sweep for coordinate columns across `crop_id_predictions`, `food_safety_disclosures`, `model_class_allowlist`, and all RPC return types | Zero hits (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)) |
| T71 | Fire a synthetic Sentry event containing an image path, a `handling_note`, and a raw confidence | All three scrubbed |
| T72 | Adversarial image crafted to force a specific species with 0.99 confidence | Presented as an unconfirmed suggestion like any other; the user's tap is still required (R01, R02); `species_allergen_tags` follows the **confirmed** species and not the prediction (R39) |
| T73 | Delete an account with 900 predictions and 40 disclosures | Predictions cascade; disclosures are retained for their 3-year window (R45) with `owner_id` pseudonymized per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md); corpus rows removed (R32) |

### 13.3 Manual QA

- [ ] Photograph 40 real crops in a real garden in poor light, including 10 the model has never seen. Count how often it is confidently wrong. If it is ever confidently wrong about a class on the allowlist, that class comes off.
- [ ] Photograph a tomatillo and a green tomato side by side and confirm the margin rule (EC-01) produces chips rather than a pre-selection.
- [ ] Confirm with a packet capture on a real device that no image leaves the phone during on-device inference.
- [ ] Read the training opt-out copy to someone unfamiliar and ask what they think happens to their photos.
- [ ] Complete the disclosure form answering "I'm not sure" to everything and confirm nothing anywhere implies they did it wrong.
- [ ] Confirm the raw-produce guidance appears at the physical moment of handoff on both platforms, and that it is readable one-handed while holding a bag.
- [ ] Attempt to list home-made jam, a foraged mushroom, and a jar of pickles; confirm all three are refused with the category copy and no moderation event.
- [ ] Read every first-party string about produce aloud and flag anything that sounds like Sharecropr vouching for it (R44).
- [ ] VoiceOver and TalkBack over the assist suggestion, the disclosure form, the rendered disclosure, and the handoff guidance at 200% type.
- [ ] Walk the illness runbook (R60) end to end with support and counsel present, on a fabricated case, before launch.

## 14. Rollout

| Field | Value |
| --- | --- |
| Status | **Not built.** Phase 3, Approved, specified only. `crop_id_predictions` and `food_safety_disclosures` ship as empty stubs in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)). |
| **Legal precondition (part b)** | `foodsafety.disclosures_required` **must not be enabled in any user-reachable environment** until: counsel has approved the §8.3 disclaimer and guidance copy (R53); the per-metro exemption assessment is complete (R54); the illness runbook exists and has been walked (R60); and every populated `crop_species.allergen_tags` value has been audited against a recognised allergen list. **This is a gate, not a checklist item.** The engineering work is a fortnight; the legal work is not, and starting them in the wrong order is how a disclaimer ends up written by an engineer at 11 p.m. |
| **Data precondition (part a)** | The class allowlist must contain **≥ 25 species meeting R19** before the assist is presented to any user. Below that, the assist is silent more often than not and users conclude it is broken. This precondition is the reason the feature is Phase 3: the corpus is a by-product of MVP and Phase 2 volume and cannot be manufactured earlier. |
| Feature flag | Four. `cropid.assist_enabled` (the whole assist), `cropid.server_fallback_enabled` (R10's fallback, separately switchable because it is the only path that moves an image), `foodsafety.disclosures_visible` (render existing disclosures), `foodsafety.disclosures_required` (gate publishing, R34). The two food-safety flags are deliberately separate so disclosures can be collected and displayed before they are mandatory. |
| Migration required | Yes — `20270620_0140_crop_id_and_food_safety.sql`: five enums, two table bodies over the MVP stubs, one new public table, two `private` tables, one column on `profiles`, one guard trigger on `listings`, six functions, and seven policies. Additive; no `ALTER TYPE`, no constraint replacement. |
| Backfill required | Two, both operational. (1) The training corpus is built from existing `media_assets` under R27's filter, honouring `training_opt_out`, **after** R33's privacy-notice update has been live for at least one release. (2) `crop_species.allergen_tags` is audited and corrected before `foodsafety.disclosures_visible` turns on, because this spec is the first thing that renders it and its accuracy becomes a safety property. |
| Rollback plan | `cropid.assist_enabled` off removes the suggestion entirely; the picker is unchanged and no data is lost. `cropid.server_fallback_enabled` off confines inference to devices. `foodsafety.disclosures_required` off stops gating publishing while leaving existing disclosures visible — the ordering matters, because hiding disclosures that recipients have already seen is worse than not requiring new ones. A bad model is reverted by flag (R24); a bad class is removed from the allowlist by a data change (R21); a bad disclaimer string is a copy migration plus a re-attestation prompt (EC-19). The migration is forward-only ([Data Model §15](../01-architecture/03-data-model.md#15-migration-rules)). |
| Client version floor | The Phase 3 minimum client for the assist. **The disclosure render has a hard floor:** a client too old to render a disclosure must not be able to send an exchange request against a listing that has one, or a recipient sees no allergen information at all. Enforced from `devices.app_version` ([Data Model §12](../01-architecture/03-data-model.md#12-notifications-devices-audit)). |
| Pre-agreed kill criteria | `cropid.acceptance_rate` below 70% ⇒ disable the assist rather than lower the thresholds. Any confidently-wrong classification on an allowlisted class ⇒ that class comes off the allowlist the same day. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | **What is the actual legal exposure, and does "no money" change it?** [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md) chose barter for product reasons, and the organisation has been reasoning as though it were also a liability position. It is not obviously either — gift and barter of home-grown produce sits differently across jurisdictions, and a platform that structures the exchange is not the same as a neighbour handing something over a fence. **This question gates the whole of part (b)** and must be answered by counsel, not by engineering (R54). | Legal | Before any part-(b) code |
| Q2 | Is the disclosure mandatory (R34) or optional? Mandatory maximises coverage and adds four taps to every publish, with the real risk that people click through it. Optional means the listings most in need of a disclosure are the least likely to have one. The `foodsafety.disclosures_required` flag exists so this can be decided with data, but the default has to be chosen first. | Product + Legal | Before launch |
| Q3 | Should the prohibited list (§5.6) also exclude raw honey, home-dried herbs, and home-pressed juice? Each has a real if smaller risk profile, and each is something people genuinely have spare. Drawing the line at "unprocessed and fresh" is clean and excludes things a reasonable person would expect to share. | Legal + Product | Before launch |
| Q4 | What is the lawful basis for the training corpus, and does R27's completed-exchange corroboration plus an opt-out (R28) satisfy it in every launch jurisdiction? Opt-**out** is the assumption throughout this spec; if the answer is opt-**in**, the corpus is perhaps a fifth of the size and the R19 allowlist threshold becomes very hard to meet. | Legal + Security | Before the corpus is built |
| Q5 | Is `τ_preselect = 0.85` with a 0.20 margin right? Both numbers are judgement, not measurement, and both will be wrong in a direction we can only learn from `cropid.acceptance_rate` and `cropid.correction_rate` after presenting suggestions to real users. | Platform + Product | After the first shadow period |
| Q6 | Should a listing be able to carry a disclosure the recipient must **acknowledge** before requesting, for high-risk allergen tags? It is the strongest form of the control and it adds a modal to the request flow, which is where friction costs the most. | Product + Legal | Post-launch |
| Q7 | Does the assist need to work at all for users who deny camera permission — for example over a photo already in the listing? It is a small addition and it makes the feature useful to a group who have made a deliberate privacy choice, which may be exactly the group we should not be running inference for by default. | Product | Post-launch |
| Q8 | Fungi are permanently excluded from the class allowlist (R48). Cultivated oyster and shiitake mushrooms are trivially identifiable and entirely safe, and a blanket exclusion is over-broad. Is the exclusion worth its cost, given that any exception weakens a rule whose whole value is that it has no exceptions? | Product + Legal | Post-launch |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Platform Engineering + Legal | Initial spec |
