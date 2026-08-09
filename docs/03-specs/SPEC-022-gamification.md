# SPEC-022: Gamification — Badges, Streaks & Opt-In Leaderboards

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.0 |
| **Owner** | Product |
| **Phase** | Phase 3 |
| **Security review** | not required *(contested — see [Q1](#15-open-questions))* |
| **Schema depends on** | [SPEC-010](SPEC-010-exchange-lifecycle.md), [SPEC-012](SPEC-012-trust-and-safety.md) |
| **Behaviourally coupled with** | SPEC-021 |
| **Related ADRs** | [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md), [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) |
| **Last updated** | 2026-08-08 |

> **Not built.** This spec is Approved and specified; no code exists. It describes Phase 3 behaviour and fills the table stubs shipped in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)).

---

## 1. Summary

Badges, streaks, and opt-in leaderboards recognise the behaviour Sharecropr actually wants — growing a range of things, showing up when you said you would, using more than one safe spot, and coming back next season — and they are **deliberately the last thing we build**. Gamifying a marketplace before it has liquidity does not create liquidity; it creates listing spam, sockpuppet exchanges, and two accounts meeting at a library to farm a streak, and every one of those is indistinguishable from a real exchange in the schema unless the anti-gaming design is written first. This spec therefore spends more words on what disqualifies an award than on what earns one, and it treats streaks as a wellbeing risk in a **seasonal** product where a quiet January is not a lapse but the correct behaviour.

## 2. Goals

- Recognise variety, reliability, safe-spot diversity, and seasonal return — the behaviours that make the network work — without recognising volume.
- Make every award traceable to a specific `exchange_sessions` row that two people both confirmed, so that a badge is a claim about something that provably happened.
- Make gaming expensive: identity-verified counterparties, per-counterparty caps, distinct-counterparty floors, settling periods, cooldowns, and retroactive revocation.
- Make streaks that a seasonal gardener cannot lose by living a normal life in a dormant month.
- Keep leaderboards opt-in, small-scope, seasonal, and ordered by something other than throughput.
- Leave the whole feature switchable off, per user and globally, with nothing functional lost.

## 3. Non-Goals

- **Shipping before liquidity.** This is the first non-goal because it is the load-bearing one. A points system layered on a thin marketplace optimizes for the wrong behaviour at exactly the moment the metrics look most encouraging: listings go up, "exchanges" go up, and none of it is a courgette changing hands. Phase 3 means *after* the exchange volume in [the roadmap](../06-roadmap/01-roadmap.md) is met by real, unrelated, geographically-spread counterparties. Building it early is not a scheduling error; it is a measurement error that takes a year to detect.
- **Points, currency, levels, XP, or anything redeemable.** No score that accumulates, no tier a user can grind, and absolutely nothing convertible into anything. A redeemable point is a currency, and [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md) has no exemption for one we invented ourselves.
- **Badges that affect matching, ranking, discovery, or search.** [SPEC-012 R52](SPEC-012-trust-and-safety.md) forbids ordering any surface by reputation, and a badge that quietly boosts a listing is reputation ranking with better art.
- **Global leaderboards.** A global board in a two-metro product ranks strangers who could never trade with each other, and in any product it converts a hobby into a competition with 40,000 losers.
- **Streaks measured in days.** A daily streak in a product whose subject matter has a growing season is a mechanism for punishing people for the weather.
- **Push notifications about streaks, badges at risk, or leaderboard position.** Not "sparingly" — none. See R38.
- **Social sharing, share cards, or public profile URLs.** A shareable achievement card is a screenshot of a stranger's name and town, and we have no web surface to host it ([SPEC-021 §3](SPEC-021-community-groups.md)).
- **Awards for reporting, blocking, or any safety action.** Incentivising report volume is how a report queue fills with noise and a real `unsafe_meeting` waits behind it ([SPEC-012](SPEC-012-trust-and-safety.md)).
- **Badges derived from ratings.** Ratings are double-blind and retaliation-resistant precisely because nothing rides on them ([SPEC-012 §5.1](SPEC-012-trust-and-safety.md)). Attaching a badge to a 5-star average puts pressure back on the number the double-blind design exists to protect.
- **Retroactive awards for pre-launch history.** See [Q5](#15-open-questions); the settling and eligibility rules cannot be evaluated against sessions that predate them.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **gardener**, I want recognition for growing a range of things rather than a lot of one thing, so the app rewards what I actually enjoy. | P1 |
| US-02 | As a **gardener**, I want a badge to mean something, so that seeing one on someone's profile tells me something true. | P0 |
| US-03 | As a **seasonal gardener**, I don't want to be told I've broken a streak in February. | P0 |
| US-04 | As a **user**, I never want a notification telling me to open the app to keep something. | P0 |
| US-05 | As a **club member**, I want a friendly seasonal board within my group, and only if I opt in. | P2 |
| US-06 | As a **user**, I want to turn all of this off and lose nothing. | P0 |
| US-07 | As a **user who was cheated**, I want the badge the other person earned from that exchange taken away. | P0 |
| US-08 | As a **trust & safety reviewer**, I want to see exactly which sessions produced an award, so I can tell farming from trading. | P0 |
| US-09 | As a **product owner**, I want to detect a farming ring before it is on a leaderboard. | P0 |
| US-10 | As a **new user**, I don't want a wall of empty achievements telling me how little I've done. | P1 |
| US-11 | As a **screen-reader user**, I want badges announced as text with their criteria, not as decorative images. | P0 |
| US-12 | As a **user in a tiny metro**, I don't want a leaderboard where I can identify everyone on it. | P0 |

## 5. Functional Requirements

### 5.1 Badges — definition and families

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | Badges **MUST** be curated reference data in `public.badges`, seeded by migration and editable only by staff. There **MUST NOT** be any user or moderator path that creates a badge, for the same reason there is no user path that creates a crop species ([SPEC-005 R40](SPEC-005-crop-taxonomy.md)). |
| R02 | **MUST** | Every badge **MUST** declare a `family` from the closed set `variety`, `exchange`, `seasonal`, `safe_spot_diversity`, `community`, and a machine-readable `criteria` jsonb evaluated by `app.evaluate_badges(user_id)`. Criteria **MUST NOT** be expressed as free SQL in the row. |
| R03 | **MUST** | Every badge **MUST** carry user-facing `name`, `description`, and an explicit `how_to_earn` string, and the app **MUST** display `how_to_earn` wherever the badge is shown. An unexplained badge is read as a rating ([SPEC-012 R53](SPEC-012-trust-and-safety.md)). |
| R04 | **MUST NOT** | A badge **MUST NOT** be awarded for: number of listings published, listing views, response speed, report volume, block volume, login frequency, profile completeness, or any rating value. Every one of those is either farmable at zero cost or a metric we do not want people optimizing. |
| R05 | **MUST** | `variety`-family badges **MUST** count **distinct `species_id` actually exchanged** — species that appeared in a completed session — never species listed. Listing a species costs nothing; handing it to someone costs a courgette. |
| R06 | **MUST** | `safe_spot_diversity` badges **MUST** count distinct `safe_spot_id` values across qualifying sessions where the spots are **at least 2 km apart**, computed server-side from `safe_spots.point`. Without the distance rule, two branches of the same library on one street are "diversity". |
| R07 | **MUST** | `seasonal` badges (a challenge running for one named season) **MUST** declare `starts_at`/`ends_at`, **MUST** be evaluable only from sessions completed inside that window, and **MUST NOT** be re-awardable in a later season under the same `badge_id` — a repeated seasonal challenge is a new row with a new id. |
| R08 | **MUST** | A retired badge **MUST** keep its row, keep every `user_badges` row referencing it, and set `is_active = false`. Nothing about an award a user already earned changes because we stopped offering it. |
| R09 | **SHOULD** | The launch set **SHOULD** be **12–18 badges** across the five families, with no more than 4 achievable in a user's first season. A grid of 60 locked badges is [US-10](#4-user-stories)'s wall of failure. |

### 5.2 Eligibility — what can produce an award

> Everything in this subsection exists because an award is a claim, and a claim that can be manufactured for free will be.

| ID | Req | Statement |
| --- | --- | --- |
| R10 | **MUST** | An award **MUST** derive only from `exchange_sessions` rows in state `completed` with **both** `owner_confirmed_at` and `requester_confirmed_at` non-null. A session confirmed by one party is not evidence of anything ([SPEC-010](SPEC-010-exchange-lifecycle.md)). |
| R11 | **MUST** | Both parties **MUST** be `trust_tier = 'id_verified'` or better at the time of completion. Sockpuppet exchanges are cheap until each account costs a KYC pass ([SPEC-003](SPEC-003-identity-verification.md)). |
| R12 | **MUST** | The awardee **MUST** pass `app.badge_eligible(user_id)`, which requires an internal `trust_score ≥ 40`, `cancellation_count_90d ≤ 3`, `is_suspended = false`, and no `moderation_action` more severe than `warning` in the last 90 days. **The score itself is never returned, rendered, or implied** — the function returns a boolean, and the copy for an ineligible user never mentions a number ([SPEC-012 R48/R49](SPEC-012-trust-and-safety.md)). |
| R13 | **MUST** | A session **MUST** enter a **14-day settling period** after completion before it counts toward any badge. Most disputes, no-show reports, and buyer's-remorse reports arrive inside two weeks, and delaying the award is far cheaper than revoking it. |
| R14 | **MUST** | **Per-counterparty cap:** at most **3** sessions with the same counterparty may count toward badges in any rolling 90 days, and **at most 25%** of the sessions required by any single badge may come from one counterparty. A badge requiring 12 sessions therefore needs at least 4 distinct people. |
| R15 | **MUST** | **Distinct-counterparty floor:** any badge whose criteria include a session count `n` **MUST** require at least `ceil(n × 0.5)` distinct counterparties. |
| R16 | **MUST** | **Cooldown:** at most **one badge per user per 24 hours** may be awarded. Further awards queue in `private.badge_award_queue` and are released one per day, oldest first. A burst of six badges is either a backfill or a farm, and neither should feel like a slot machine paying out. |
| R17 | **MUST** | A session **MUST** count toward at most one badge per family. One meeting cannot simultaneously satisfy three `exchange`-family badges. |
| R18 | **MUST** | Both counterparties in a qualifying session **MUST** have distinct `private.verification_vendor_refs` identity hashes, reusing [SPEC-012 R59](SPEC-012-trust-and-safety.md)'s sockpuppet control. Two accounts behind one verified identity trading with each other earn nothing. |
| R19 | **MUST** | Sessions at the same `safe_spot_id` with the same counterparty **MUST** count at most **once per 30 days** toward any badge, regardless of R14. The same two people at the same library every Tuesday is a friendship, not network growth, and it should not be the cheapest path to a badge. |
| R20 | **MUST** | Evaluation **MUST** run in a nightly `evaluate_badges` job over users with a settled session in the last 24 hours, and **MUST** be idempotent — re-running it awards nothing new. |
| R21 | **MUST NOT** | There **MUST NOT** be any client-callable RPC that awards, claims, requests, or re-evaluates a badge. `user_badges` has no INSERT policy for `authenticated`, and the absence is the enforcement. |

### 5.3 Revocation

| ID | Req | Statement |
| --- | --- | --- |
| R22 | **MUST** | Every `user_badges` row **MUST** record the set of `session_id`s that produced it, in `source_session_ids`, so that revocation is a lookup rather than a recomputation of history. |
| R23 | **MUST** | A badge **MUST** be revoked when any contributing session later moves to `disputed` or `no_show`, when a report against the awardee for that session is `actioned` with anything above `warning`, or when a revealed rating on that session carries a `no_show` or `misrepresented` tag. |
| R24 | **MUST** | Revocation **MUST** be retroactive without a time limit inside the retention horizon: as long as the contributing session row exists ([Data Model §14](../01-architecture/03-data-model.md#14-retention-schedule) anonymizes sessions at 90 days), a badge sourced from it can be taken back. |
| R25 | **MUST** | Revocation **MUST** set `revoked_at` and `revoked_reason` and **MUST NOT** delete the row. The record of the award and of its removal is what makes a farming investigation possible. |
| R26 | **MUST** | A revoked badge **MUST** disappear from the profile, from any leaderboard input, and from any count, within the same transaction. |
| R27 | **MUST** | The user **MUST** be told once, in the inbox, with the neutral copy in §8.3. It **MUST NOT** push, **MUST NOT** name the counterparty, and **MUST NOT** state which report caused it — a revocation notice that identifies the reporter is a retaliation trigger ([SPEC-012](SPEC-012-trust-and-safety.md)). |
| R28 | **MUST** | Revocation **MUST** be reversible by a platform moderator when the underlying action is reversed, restoring the same `badge_id` with the original `awarded_at`. Every moderation action except a law-enforcement referral is reversible ([SPEC-012 §3](SPEC-012-trust-and-safety.md)), and an achievement is not the place to make an exception. |

### 5.4 Streaks — and why they cannot punish absence

> A streak is a commitment device that works by making absence costly. In a product whose subject matter stops growing for four months, that is a mechanism for making people feel bad about winter. The design keeps the encouragement and removes the penalty.

| ID | Req | Statement |
| --- | --- | --- |
| R29 | **MUST** | A `streaks` row **MUST** be counted in **seasons or months**, never in days. The two launch kinds are `active_season` (a season with ≥ 1 qualifying session) and `exchange_month` (a calendar month with ≥ 1 qualifying session). |
| R30 | **MUST** | The `exchange_month` clock **MUST** pause during the user's **dormant window**, derived from their garden's `grow_zone` via `public.grow_zone_dormancy`. A paused month neither extends nor breaks a streak. |
| R31 | **MUST** | Where `grow_zone` is unknown, the dormant window **MUST** default to December–February inclusive, and a user **MAY** override their dormant window manually. Guessing wrong in the user's favour is the correct failure direction. |
| R32 | **MUST NOT** | The UI **MUST NOT** display a countdown, a timer, a "days remaining", an "at risk" state, an expiry date, or any red or warning styling on a streak. |
| R33 | **MUST** | `longest_length` **MUST** be retained forever. A broken streak **MUST** be presented as a completed run alongside the new one ("Longest: 3 seasons · Current: 1"), never as a loss. |
| R34 | **MUST NOT** | There **MUST NOT** be any mechanic that restores, freezes, buys back, or repairs a streak. A repair mechanic is an admission that the streak punishes absence; R30 removes the punishment instead. |
| R35 | **MUST** | A streak **MUST NOT** be an input to any badge, any leaderboard, any ranking, any matching, or any notification. It is a private, retrospective statistic on the user's own profile. |
| R36 | **MUST** | A user **MUST** be able to hide streaks entirely from a single toggle, and the toggle **MUST** be reachable from the streak display itself rather than only from settings. |
| R37 | **MUST** | Qualifying sessions for a streak **MUST** meet R10–R19 identically to badges. A streak built from unqualified sessions is a farmable streak. |

### 5.5 Wellbeing guardrails

| ID | Req | Statement |
| --- | --- | --- |
| R38 | **MUST NOT** | **No push notification** in this spec, of any kind, for any reason. Not a badge award, not a leaderboard change, not a seasonal challenge opening, not a streak. `notification_kind` gains no new value, and the badge-award inbox row is written with push suppressed. The lock screen is for a person waiting at a library, not for a courgette milestone. |
| R39 | **MUST** | A badge award **MUST** produce exactly one in-app inbox row and **MAY** produce one in-context celebration the next time the app is opened. That celebration **MUST** be dismissible, **MUST NOT** be modal for more than one screen, and **MUST NOT** repeat. |
| R40 | **MUST** | No surface **MUST** show progress toward a badge as a percentage, a bar with a deadline, or a "2 more to go" nudge attached to a time limit. Static criteria text (R03) and a met/unmet state only. |
| R41 | **MUST** | A single per-user preference `gamification_visible` **MUST** hide badges, streaks, leaderboards, celebrations, and inbox rows for this feature in one action. Awards continue to accrue silently so that switching it back on is not a punishment for having switched it off. |
| R42 | **MUST NOT** | This feature **MUST NOT** produce a daily-login reward, an open-the-app reward, a session-length reward, or any award for an action that does not involve another human receiving food. |
| R43 | **MUST** | Badge and achievement iconography **MUST** be visually distinct from the [SPEC-012](SPEC-012-trust-and-safety.md) trust-tier badge, and the two **MUST NOT** appear adjacent without labels. A user confusing "Grew 10 kinds of thing" with "Identity verified" is a safety-relevant misread, not a cosmetic one. |

### 5.6 Leaderboards

| ID | Req | Statement |
| --- | --- | --- |
| R44 | **MUST** | Leaderboards **MUST** be opt-in per scope, default off, with opt-in recorded in `public.leaderboard_opt_ins`. Appearing on a board is a disclosure and needs consent, exactly as a group roster does ([SPEC-021 R16](SPEC-021-community-groups.md)). |
| R45 | **MUST** | Scope **MUST** be a group ([SPEC-021](SPEC-021-community-groups.md)) or a metro (`profiles.city_label`). **There is no global scope and none may be added without an ADR.** |
| R46 | **MUST** | A board **MUST NOT** render unless it has **≥ 10 opted-in participants** in scope. Below that it is a list of identifiable neighbours ranked against each other. |
| R47 | **MUST NOT** | Boards **MUST NOT** rank by number of exchanges, quantity traded, listings published, response time, `rating_avg`, `rating_count`, `trust_score`, or `trust_tier`. The last four are already forbidden as ranking keys by [SPEC-012 R52](SPEC-012-trust-and-safety.md), and this requirement extends that prohibition to the volume metrics. |
| R48 | **MUST** | The launch metrics **MUST** be **distinct species shared this season** and **seasonal-challenge badges earned this season** — measures of range and participation rather than throughput. Ties **MUST** be broken alphabetically by handle, never by recency or volume. |
| R49 | **MUST** | A board **MUST** show the top 10 and the viewer's own position, and **MUST NOT** be paginated to reveal the full ordering of everyone in scope. |
| R50 | **MUST** | A board **MUST** reset each season and **MUST NOT** maintain an all-time ranking. |
| R51 | **MUST** | Opting out **MUST** take effect immediately and **MUST** remove the user from the current board and from every historical board snapshot. |
| R52 | **MUST** | A board entry **MUST** carry the reduced card — handle, display name, avatar, metric value — and **MUST NOT** carry `city_label` at metro scope, any location, any rating, or any exchange count. |
| R53 | **MUST** | Board membership **MUST NOT** create any messaging capability. Cold DMs remain impossible ([SPEC-011 R01](SPEC-011-messaging.md)). |
| R54 | **SHOULD** | A group-scoped board **SHOULD** additionally require that the viewer is an active member of that group, so a board is never a way to see into a group from outside. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.badges`](../01-architecture/03-data-model.md#13-future-feature-stubs) | read (`anon`, `authenticated`) | Curated reference data, Pattern B |
| `public.user_badges` | read (self, and pinned subset to others) | **No client write policy at all** (R21) |
| `public.streaks` | read (self only) | Written by definer only |
| `public.leaderboard_opt_ins` | read/write (self) | **New**, beyond the stub list — see note below |
| `private.badge_award_queue` | none (service only) | Cooldown queue (R16) |
| `private.leaderboard_snapshots` | none (service only) | Seasonal boards, materialized |
| `public.exchange_sessions` | read (definer) | The only evidence source (R10) |
| `public.inventory_items` / `public.listings` | read (definer) | `species_id` for the variety family |
| `public.safe_spots` | read (definer) | Distance rule (R06) |
| `public.ratings` / `public.reports` | read (definer) | Revocation triggers (R23) |
| `public.profiles` | read (definer) | `trust_tier`, and `trust_score` **inside** `app.badge_eligible` only |
| `public.notifications` | insert via `app.enqueue_notification` | Inbox only, push suppressed (R38) |
| `audit.events` | insert | Award, revocation, restoration |

> **A fourth table.** [Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs) stubs `badges`, `user_badges`, and `streaks`. Leaderboard opt-in genuinely needs its own row per `(user, scope)` — putting it on `profiles` would make a per-scope consent into a single global flag, which is exactly the shape R44 and R45 are designed to avoid. `public.leaderboard_opt_ins` and the two `private` tables are new in this spec rather than pre-stubbed, and their absence from §13 is noted as a data-model amendment in §14.

**New schema objects introduced by this spec:** migration `20270310_0120_gamification.sql`

```sql
CREATE TYPE badge_family AS ENUM
  ('variety','exchange','seasonal','safe_spot_diversity','community');

CREATE TABLE public.badges (
  id           integer PRIMARY KEY,
  slug         text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  family       badge_family NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 3 AND 40),
  description  text NOT NULL CHECK (length(description) <= 200),
  how_to_earn  text NOT NULL CHECK (length(how_to_earn) <= 200),   -- R03
  icon_key     text NOT NULL,
  criteria     jsonb NOT NULL,                                      -- R02, machine-readable only
  season_slug  text CHECK (length(season_slug) <= 40),
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   smallint NOT NULL DEFAULT 0,
  CONSTRAINT seasonal_needs_window CHECK (
    family <> 'seasonal' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL
                             AND ends_at > starts_at))
);

CREATE TABLE public.user_badges (
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_id           integer NOT NULL REFERENCES public.badges(id),
  awarded_at         timestamptz NOT NULL DEFAULT now(),
  source_session_ids uuid[] NOT NULL DEFAULT '{}',                  -- R22
  is_pinned          boolean NOT NULL DEFAULT false,
  revoked_at         timestamptz,
  revoked_reason     text CHECK (revoked_reason IN
                       ('session_disputed','no_show','report_actioned',
                        'rating_flag','staff_correction','eligibility_lost')),
  restored_at        timestamptz,
  PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX user_badges_live_idx ON public.user_badges (user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX user_badges_sessions_gin ON public.user_badges USING GIN (source_session_ids);
CREATE UNIQUE INDEX user_badges_pin_cap ON public.user_badges (user_id, badge_id)
  WHERE is_pinned;   -- count capped at 3 by trigger

CREATE TABLE public.streaks (
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('active_season','exchange_month')),
  current_length  smallint NOT NULL DEFAULT 0 CHECK (current_length >= 0),
  longest_length  smallint NOT NULL DEFAULT 0 CHECK (longest_length >= 0),
  last_period     text NOT NULL DEFAULT '',      -- '2027-07' or '2027-summer'
  dormant_months  smallint[] NOT NULL DEFAULT '{12,1,2}',           -- R30, R31
  is_hidden       boolean NOT NULL DEFAULT false,                    -- R36
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind),
  CONSTRAINT longest_is_max CHECK (longest_length >= current_length)
);

CREATE TABLE public.leaderboard_opt_ins (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_kind  text NOT NULL CHECK (scope_kind IN ('group','metro')),   -- R45
  scope_key   text NOT NULL CHECK (length(scope_key) <= 80),
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_kind, scope_key)
);

CREATE TABLE public.grow_zone_dormancy (
  zone           text PRIMARY KEY,
  dormant_months smallint[] NOT NULL
);

CREATE TABLE private.badge_award_queue (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL,
  badge_id     integer NOT NULL,
  source_session_ids uuid[] NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  UNIQUE (user_id, badge_id)
);

CREATE TABLE private.leaderboard_snapshots (
  scope_kind  text NOT NULL,
  scope_key   text NOT NULL,
  season_slug text NOT NULL,
  metric      text NOT NULL,
  user_id     uuid NOT NULL,
  value       integer NOT NULL,
  rank        smallint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_kind, scope_key, season_slug, metric, user_id)
);
```

Policies — Pattern B for the catalogue, Pattern A for everything user-scoped, and no write path anywhere for awards:

```sql
CREATE POLICY badges_read ON public.badges
  FOR SELECT TO anon, authenticated USING (true);
-- Not USING (is_active): a retired badge must still render its own name on a
-- profile that holds it (R08). Pickers filter is_active in the query.

CREATE POLICY user_badges_select_self ON public.user_badges
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR app.is_moderator());
-- No INSERT, UPDATE, or DELETE policy exists (R21). Pinning goes through an RPC
-- so that the 3-pin cap and the revoked-badge exclusion are enforced server-side.

CREATE POLICY streaks_select_self ON public.streaks
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY streaks_update_self ON public.streaks
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
-- Narrowed to is_hidden and dormant_months by guard_streak_columns; the counters
-- themselves are definer-only.

CREATE POLICY lb_opt_in_own ON public.leaderboard_opt_ins
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
```

Other users see at most three pinned badges, through a view rather than through the base table:

```sql
CREATE VIEW public.profile_badge_cards WITH (security_invoker = on) AS
SELECT ub.user_id, b.slug, b.name, b.description, b.how_to_earn, b.icon_key, b.family
  FROM public.user_badges ub
  JOIN public.badges b ON b.id = ub.badge_id
 WHERE ub.is_pinned
   AND ub.revoked_at IS NULL
   AND EXISTS (SELECT 1 FROM public.profile_cards pc WHERE pc.id = ub.user_id);
GRANT SELECT ON public.profile_badge_cards TO authenticated;
-- Riding on profile_cards means blocks, suspension, and soft-deletion are
-- inherited rather than re-implemented, and cannot drift apart from it.
```

Also introduced: `app.badge_eligible(uuid)`, `app.evaluate_badges(uuid)`, `app.qualifying_sessions(uuid, tstzrange)`, `app.revoke_badges_for_session(uuid, text)`, `app.advance_streaks()`, `app.build_leaderboards()`, `guard_streak_columns`, `trg_badge_pin_cap`, `trg_session_state_revocation`, and four `pg_cron` jobs.

**PII touched:** `user_badges` and `streaks` are **P2** — the badge subset visible to others is exactly the three the user pinned, and it rides on `profile_cards` so blocks and suspension apply automatically. `leaderboard_opt_ins.scope_key` at metro scope is a `city_label`, already P2 and already on `profile_cards`. `app.badge_eligible` reads `trust_score` (**P1, internal-only**) and returns a boolean; the score never leaves the function, is never logged, and is never implied by copy (R12). `source_session_ids` reference `exchange_sessions`, whose `scheduled_start` and `safe_spot_id` are P1 — the array holds **ids only**, and no badge surface joins to a session's time or place.

## 7. API

### 7.1 `GET /rest/v1/badges`

**Auth:** `anon` · **Rate limit:** 60/min/IP · **Cache:** `staleTime: Infinity`, like the taxonomy ([SPEC-005 R28](SPEC-005-crop-taxonomy.md))

The catalogue is public reference data. Reading it teaches an attacker exactly what the criteria are, which is fine — R10–R19 are designed to survive being known, not to be secret.

### 7.2 `GET /rest/v1/user_badges?user_id=eq.<self>`

Returns the caller's own awards including revoked ones (with `revoked_at` and `revoked_reason`). Another user's id returns an empty set — not a 403.

### 7.3 `rpc.pin_badges(p_badge_ids integer[])`

**Auth:** `authenticated` · **Rate limit:** 30/day/user

Sets `is_pinned` on up to 3 non-revoked badges and clears the rest, atomically.

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | More than 3 ids, or an id the caller does not hold |
| `conflict` | 409 | An id is revoked |

### 7.4 `rpc.set_leaderboard_opt_in(p_scope_kind, p_scope_key, p_opt_in boolean)`

**Auth:** `authenticated`; for `scope_kind = 'group'`, active membership re-checked inside the function (R54) · **Rate limit:** 20/day/user

```jsonc
{ "p_scope_kind": "metro", "p_scope_key": "Ann Arbor, MI", "p_opt_in": true }
→ { "opted_in": true, "participants": 34, "renders": true }
```

`participants` and `renders` are returned so the opt-in screen can tell the truth immediately — "you're in, but the board won't show until 10 people have joined" — rather than dropping the user onto an empty screen (R46).

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Group scope, caller not an active member |
| `validation_failed` | 400 | `scope_kind = 'global'`, or a metro key that is not the caller's `city_label` |

Opting **out** deletes the row and issues a delete against `private.leaderboard_snapshots` for that user in the same transaction (R51).

### 7.5 `rpc.leaderboard(p_scope_kind, p_scope_key, p_metric)`

**Auth:** `authenticated`, opted in to that scope · **Rate limit:** 60/hour/user

```jsonc
// Response 200
{ "season": "2027-summer", "metric": "distinct_species_shared",
  "participants": 34, "renders": true,
  "top": [{ "rank": 1, "handle": "mv_garden", "display_name": "Maya",
            "avatar_path": "…", "value": 14 }],
  "me": { "rank": 12, "value": 6 } }
```

Returns `{"renders": false}` with an empty `top` below 10 participants (R46). The row shape carries no `city_label`, no rating, no exchange count, and no location (R52).

### 7.6 Cron jobs

| Job | Cadence | Does |
| --- | --- | --- |
| `settle_sessions` | hourly | Marks sessions past the 14-day settling period as badge-eligible (R13) |
| `evaluate_badges` | nightly 04:00 UTC | R20's idempotent evaluation over users with newly settled sessions; enqueues into `private.badge_award_queue` |
| `release_badge_awards` | hourly | Releases at most one queued award per user per 24 h (R16) and writes the inbox row with push suppressed (R38) |
| `advance_streaks` | monthly, 00:30 on the 1st | R29–R31; skips dormant months |
| `build_leaderboards` | nightly 04:30 UTC | Materializes `private.leaderboard_snapshots` for scopes with ≥ 10 opted-in participants |

Revocation is **not** a cron job. `trg_session_state_revocation` fires synchronously on `exchange_sessions` state change, on `reports.status → actioned`, and on `ratings.is_revealed → true`, so a badge is gone in the same transaction as the fact that invalidated it (R26).

### 7.7 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| Any award, claim, or re-evaluate endpoint | R21 |
| `trust_score`, or anything from which it could be inferred | R12, [SPEC-012 R48](SPEC-012-trust-and-safety.md) |
| Another user's full badge list | Three pinned badges only, via `profile_badge_cards` |
| Another user's streaks | R35. A streak is private, full stop. |
| A global leaderboard | R45, and adding one requires an ADR |
| Progress-toward-badge percentages | R40 |
| A share card or public URL | §3 |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Achievements | `/profile/achievements` | Earned badges, then unearned in the same families |
| Badge detail | `/(modals)/badge/[slug]` | Name, description, `how_to_earn`, met/unmet, source sessions for own awards |
| Pin badges | `/(modals)/badge/pin` | Choose up to 3 for the profile card |
| Streaks | `/profile/achievements#streaks` | Current and longest, with the hide toggle inline (R36) |
| Leaderboard | `/(modals)/leaderboard/[scopeKind]/[scopeKey]` | Top 10 plus own position |
| Leaderboard opt-in | `/(modals)/leaderboard/join` | Consent copy, participant count |
| Settings | `/profile/settings` | `gamification_visible` master toggle (R41) |

Achievements live under `/profile`, not in the tab bar. Nothing in this feature is a destination; it is something a user finds when they go looking, which is the correct prominence for a system that must not drive behaviour.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | The badge catalogue is cached with `staleTime: Infinity` and renders instantly; only the earned/unearned overlay shimmers. A leaderboard shows its scope header and participant count first, then rows. |
| Empty | Three empties, and the first one matters most. **No badges earned:** we show **four** achievable badges with their `how_to_earn` text and nothing else — not a grid of 18 locked tiles, which is [US-10](#4-user-stories)'s wall telling a new user how little they have done. **No streak yet:** one line, "Your first season starts when you complete an exchange." **Leaderboard below 10 participants:** "This board needs 10 people before it shows. 4 so far." — an honest count, not a spinner. |
| Error (recoverable) | Achievements fetch 5xx: the cached list stays with a thin banner and Retry. A failed `pin_badges` reverts the selection visibly and says so. A failed leaderboard fetch shows the cached board with an "as of" line. |
| Error (terminal) | One case: the user's account is suspended, so `profile_cards` and therefore `profile_badge_cards` return nothing. Achievements render for the user themselves — a suspension is not a reason to hide someone's own history from them — and the pin control is disabled with the copy in §8.3. |
| Offline | Fully readable from cache. Pinning and leaderboard opt-in are **not** queued: both are consent-shaped actions whose effect the user needs to see confirmed, and a pin that silently applies three hours later is a disclosure the user did not watch happen. |
| Permission denied | Not applicable — no device permission is used anywhere in this feature. The nearest analogue is `gamification_visible = false`, which is a user preference and not a denial: the whole feature is absent from navigation, no inbox rows are shown, awards continue to accrue silently (R41), and nothing else in the app changes. |
| Rate limited | `pin_badges` (30/day) and `set_leaderboard_opt_in` (20/day) are reachable only by a scripted client; the control disables with a countdown. `leaderboard` 429 falls back to the cached snapshot with an "as of" line, because a leaderboard is a nightly snapshot and a stale one is not wrong. |

Two feature-specific states:

| State | Behaviour |
| --- | --- |
| Award pending cooldown (R16) | Invisible. A queued award is not shown as "pending", because a pending-award indicator is a countdown by another name (R32, R40). It simply appears the next day. |
| Badge revoked (R23–R27) | The badge disappears from the profile and the pinned set, one neutral inbox row appears, and the badge detail screen shows it as unearned with its ordinary `how_to_earn` text. **No strike, no history of the revocation shown to the user, no red state.** The audit record exists for staff; the user's screen simply returns to how it looked before. |

### 8.3 Copy

Exact strings.

**Achievements, empty**
> **Nothing here yet — and that's fine.**
> Badges come from exchanges you and the other person both confirm.
>
> Within reach:
> · **{badge_1_name}** — {how_to_earn}
> · **{badge_2_name}** — {how_to_earn}
> · **{badge_3_name}** — {how_to_earn}
> · **{badge_4_name}** — {how_to_earn}

**Badge detail, unearned**
> **{name}**
> {description}
>
> How to earn it: {how_to_earn}
>
> Badges only count exchanges both people confirmed in the app.

**Badge detail, earned**
> **{name}** · Earned {month} {year}
> {description}

**Award celebration (once, in-app, dismissible)**
> **{name}**
> {description}
> Button: `Nice`

**Award inbox row**
> Title: `You earned {name}`
> Body: `{description}`

**Revocation inbox row (R27)**
> Title: `A badge was removed`
> Body: `One of the exchanges behind "{name}" didn't work out, so we've taken the badge back. Nothing else about your account has changed.`
> *(Names no counterparty, no report, and no reason beyond this.)*

**Streaks, present**
> Longest: {longest} {seasons|months} · Current: {current}

**Streaks, dormant month (R30)**
> Your quiet season — nothing to keep up.

**Streaks, first**
> Your first season starts when you complete an exchange.

**Streak hide toggle (R36)**
> Hide streaks

**Pin badges**
> **Pick up to 3 for your profile**
> These are the only badges other people can see.

**Pin, suspended account**
> You can't change your profile badges right now.

**Leaderboard opt-in (R44) — the whole screen**
> **Join the {scope_name} board?**
>
> It shows the **10 people who've shared the widest range of crops** this season, plus where you are. It doesn't count how many exchanges you've done, and it doesn't use your ratings.
>
> Other people on the board will see your name, your handle, and your photo. Not your town, not your location, and not your exchange history.
>
> You can leave at any time and you'll disappear from it straight away.
>
> Buttons: `No thanks` · `Join the board`

**Leaderboard, below threshold (R46)**
> **This board needs 10 people before it shows.**
> {n} so far. We'll turn it on when there are enough that it isn't just a list of neighbours.

**Leaderboard header**
> {scope_name} · {season_name} · Widest range of crops shared

**Leaderboard, own row**
> You · #{rank} · {value} kinds

**Leaderboard, opted out confirmation**
> You've left the board. You're already off it.

**Master toggle (R41)**
> **Badges and streaks**
> Turn these off and they disappear from the app. You'll still earn them quietly, so nothing is lost if you turn them back on.

**Ineligibility, if a user asks why nothing is being awarded (R12) — settings help text**
> Badges pause while an account is under review or has recent cancellations. They start again on their own.
> *(States no number, no score, no threshold.)*

**Accessibility label — badge tile**
> {name}, {earned|not earned}. {description}. Double tap for how to earn it.

**Accessibility label — leaderboard row**
> Rank {rank}, {display_name}, {value} kinds of crop shared.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | **Manufacture reputation.** Every badge is a claim rendered next to a person's face, so the attack is to produce awards without producing exchanges — two accounts, one library, a repeating fake handoff — and then wear the result while doing something else. The layered answer, in the order an attacker meets it: both accounts must pass KYC and be `id_verified` (R11), and must not share an identity hash (R18), which puts a real per-account cost on the ring; both parties must confirm a real handoff (R10), which requires two devices and the shared code from [SPEC-010](SPEC-010-exchange-lifecycle.md); the session must survive 14 days without a dispute (R13); the same counterparty is worth at most 3 sessions per 90 days and at most a quarter of any badge (R14), with a distinct-counterparty floor on top (R15); the same pair at the same spot counts once a month (R19); awards release one per day (R16); and anything that later turns out to have been fake is revoked retroactively with the source sessions recorded (R22–R25). The economics are the point: a 12-session badge needs 4+ distinct KYC-passed people across ≥ 4 months and ≥ 2 safe spots more than 2 km apart, none of whom disputes anything. That is not free, and it is very close to just using the product. The second-worst outcome is **the leaderboard becoming a targeting list** — a public ranking of identifiable people in a small metro. R44 (opt-in), R45 (no global), R46 (≥ 10 participants), R49 (top 10 only, no full ordering), R52 (no location, no city label on the row), and R53 (no messaging) bound it. The third is **inference of the internal trust score**: `app.badge_eligible` reads it, and a user who could observe eligibility flipping could binary-search the threshold. R12 keeps the function boolean, the copy numberless and thresholdless, and — deliberately — gives no signal at the moment eligibility changes. |
| **Which RLS policies enforce access?** | `badges_read` (Pattern B, `FOR SELECT TO anon, authenticated USING (true)`), `user_badges_select_self` (self or moderator), `streaks_select_self`, `streaks_update_self` narrowed to `is_hidden` and `dormant_months` by `guard_streak_columns`, and `lb_opt_in_own`. Other users' badges are visible only through `public.profile_badge_cards` (`security_invoker = on`), which is defined **over `profile_cards`**, so block enforcement, suspension, and soft-deletion are inherited rather than re-implemented and cannot drift from [SPEC-012](SPEC-012-trust-and-safety.md). Definer functions: `app.badge_eligible`, `app.evaluate_badges`, `app.qualifying_sessions`, `app.revoke_badges_for_session`, `app.advance_streaks`, `app.build_leaderboards`, `app.is_moderator`, `app.is_group_member`, `app.enqueue_notification`, `app.consume_token`, plus `public.pin_badges`, `public.set_leaderboard_opt_in`, and `public.leaderboard`. Each bypasses RLS and re-checks authorization first ([RLS Design §7](../01-architecture/05-rls-design.md)). **The absence is load-bearing twice over:** `user_badges` has no INSERT, UPDATE, or DELETE policy for `authenticated` (R21), and `streaks` has no policy that permits writing a counter. |
| **Can any response path expose an exact coordinate or PII?** | No. **How this feature preserves the location invariant:** (1) no table introduced here has a `geography`, `geometry`, `h3_*`, `lat`, or `lng` column; (2) the `safe_spot_diversity` family reads `safe_spots.point` to compute a 2 km separation **inside** a definer function whose return type is a boolean and a count — there is nowhere in the signature to put a point, which is the same structural argument as `safe_spots_near` in [Location Privacy §6](../01-architecture/04-location-privacy.md); (3) `user_badges.source_session_ids` holds ids only, and no badge surface joins to `exchange_sessions.scheduled_start` or `safe_spot_id`, so a badge never reveals *where* or *when* someone met; (4) leaderboard rows carry no `city_label` even at metro scope (R52), because a rank plus a town plus a name is a smaller haystack than a town plus a name; (5) no function here reads `private.garden_locations` and none is added to the [LP-02](../01-architecture/04-location-privacy.md) allowlist; (6) no push notification exists at all (R38), so the push-body location rules have nothing to constrain. `trust_score` is read only inside `app.badge_eligible` and never returned, logged, or implied. |
| **What is logged, and is it scrubbed?** | Every award, revocation, and staff restoration writes `audit.events` with the actor (`system` for cron), the badge, and the source session ids. Analytics carry `badge_slug`, `family`, and coarse counts — **never** a source session id, a counterparty id, a safe-spot id, a trust score, or a leaderboard row for another user. `app.badge_eligible`'s inputs are never logged; a log line reading `trust_score=39 → ineligible` would publish the number [SPEC-012 R48](SPEC-012-trust-and-safety.md) spends a whole subsection hiding. Leaderboard snapshots live in `private` and are queried only through the RPC. |
| **Does this need step-up authentication?** | No. Nothing here changes account security, money (there is none), or access to another person's data. |
| **Abuse / rate-limit controls** | The eligibility stack is the abuse control and it is specified in R10–R19 rather than as a rate limit. On top: `pin_badges` 30/day, `set_leaderboard_opt_in` 20/day, `leaderboard` 60/hour, one award release per user per 24 h (R16), nightly idempotent evaluation (R20), and the farming-ring detector in §11 (`gamification.pair_concentration`). |

**Threat notes.**

- **The measurement trap.** The most dangerous failure here is not a breach; it is that the feature works. Listings rise, "exchanges" rise, engagement rises, and the numbers are farmed. `gamification.pair_concentration` and `gamification.new_pair_ratio` (§11) exist so that the metric that would otherwise be celebrated is the metric that raises the alarm. This is the reason §3's first non-goal is a schedule.
- **Badges are a moderation surface by proxy.** A badge is text we publish next to a user's name. The names, descriptions, and `how_to_earn` strings are staff-authored reference data (R01) with no user-authored component anywhere, so there is no injection path and no review queue — which is exactly why R01 refuses user-created badges even though "let a group make its own badge" will be asked for.
- **Confusion with the trust tier.** R43 exists because a user reading "Grew 10 kinds of thing" as "verified" is making a safety decision on a misread. Distinct iconography, distinct explanatory sheets, never adjacent without labels.
- **Enumeration.** `user_badges` for another id returns an empty set rather than a 403; `profile_badge_cards` inherits `profile_cards`' visibility. A guessed `badge_id` reveals only public catalogue data.

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Two accounts complete 12 confirmed exchanges with each other in three weeks. | R14 caps the pair at 3 in 90 days, R19 caps a repeated pair-plus-spot at 1 per 30 days, and R15's distinct-counterparty floor blocks any count badge. Net awards: at most one, and `gamification.pair_concentration` flags the pair for review. |
| EC-02 | A user completes their 10th qualifying exchange, then is reported and suspended on day 12 of the settling period. | The award never happens: `app.badge_eligible` is evaluated at release time, not at completion, and R12 fails on `is_suspended`. Nothing to revoke, no notification. |
| EC-03 | A badge is awarded; 60 days later the session becomes `disputed`. | R23/R24 revoke it in the same transaction as the state change; one neutral inbox row (R27); the badge detail screen simply shows it as unearned again. |
| EC-04 | A dispute is resolved in the awardee's favour. | R28 restores the same `badge_id` with the original `awarded_at`, so their history is not silently rewritten to look shorter. `restored_at` records what happened. |
| EC-05 | A user qualifies for 6 badges in one night, having imported nothing (a genuine backlog after the settling period on a busy August). | R16 releases one per day for six days. Deliberately *not* six celebrations at once — a payout burst is the slot-machine feel this spec exists to avoid. |
| EC-06 | A user's `trust_score` drops below the floor after a cancellation, then recovers. | Evaluation pauses and resumes with no user-visible event either way. The settings help text (§8.3) explains the pause qualitatively, with no number and no threshold (R12). |
| EC-07 | A gardener in zone 4b completes no exchanges from November to March. | R30: those months are dormant for their zone, the `exchange_month` clock pauses, and the streak is intact in April. No notification is sent at any point, because none exists (R38). |
| EC-08 | A user's garden has no `grow_zone`. | R31: December–February default, and the user may override. The failure direction is toward not breaking the streak. |
| EC-09 | A user changes their dormant window to all twelve months. | Permitted. Their `exchange_month` streak then never advances and never breaks, and the display reads honestly. Gaming a private, non-ranking, non-badge-feeding statistic (R35) against oneself is not an attack. |
| EC-10 | A metro board has exactly 10 opted-in participants; one opts out mid-season. | The board stops rendering immediately for everyone in that scope (R46), showing the below-threshold copy with the live count. It does not freeze the last snapshot, which would leave a departed user visible. |
| EC-11 | The top-ranked user on a group board is blocked by the viewer. | They are absent from that viewer's board, because the leaderboard query joins through `profile_cards`, which applies `app.is_blocked_either_way`. Ranks are rendered from the snapshot's `rank` column, so the viewer sees 1, 2, 4, 5 with a gap rather than a silently renumbered list that would reveal a removal. |
| EC-12 | A user opts out of a leaderboard after the nightly snapshot is built. | R51: the opt-out deletes their snapshot rows in the same transaction, so the next read excludes them without waiting for the next build. |
| EC-13 | A seasonal challenge ends while a user is one exchange short. | Nothing happens. No "so close" message, no consolation badge, no extension. R40 forbids the deadline nudge; the same absence applies at the end. |
| EC-14 | A badge is retired mid-season while 400 users hold it. | R08: rows retained, badge still renders its name and description on every profile that holds it, `is_active = false` removes it from the "within reach" list. `badges_read` deliberately does not filter on `is_active` for exactly this reason. |
| EC-15 | A user sets `gamification_visible = false` and then earns three badges. | Awards accrue silently (R41): rows are written, no inbox rows are shown, no celebration, no push (there is none anyway). Turning the toggle back on reveals them, without a backlog of celebrations replaying. |
| EC-16 | A user deletes their account. | `user_badges`, `streaks`, and `leaderboard_opt_ins` cascade; `private.leaderboard_snapshots` rows are deleted by the deletion pipeline; `audit.events` rows are retained, pseudonymized, per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md). |
| EC-17 | `evaluate_badges` runs twice on the same night after a retry. | R20: idempotent. The `(user_id, badge_id)` primary key and the queue's unique constraint make a second pass award nothing new. |
| EC-18 | An `exchange_sessions` row is anonymized at 90 days ([Data Model §14](../01-architecture/03-data-model.md#14-retention-schedule)) while `source_session_ids` still references it. | The badge stands and the id remains as an opaque reference. Revocation is no longer possible for that session, which is the honest consequence of retention winning over auditability — stated here rather than discovered during an investigation, and tracked as [Q6](#15-open-questions). |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `gamification.badge_awarded` | product event | `badge_slug`, `family`, `days_to_earn`, `distinct_counterparties` | — |
| `gamification.badge_revoked` | product event | `badge_slug`, `revoked_reason`, `days_held` | Revocation rate > 3% of awards ⇒ the settling period is too short |
| `gamification.badge_restored` | audit | `badge_slug`, `moderator_id` | — |
| **`gamification.pair_concentration`** | gauge | share of a user's qualifying sessions with their single most frequent counterparty | **> 60% for any user with ≥ 5 qualifying sessions ⇒ farming-ring review.** The primary detector |
| **`gamification.new_pair_ratio`** | gauge | share of qualifying sessions between first-time counterparties, platform-wide | Falling below 40% while badge awards rise ⇒ the feature is generating repeat fake trades rather than network growth. **This is the metric that would trigger switching the feature off** |
| `gamification.spot_concentration` | gauge | distinct safe spots per awarded user | Median < 2 ⇒ the diversity family is not working |
| `gamification.settling_reversal` | counter | sessions that fail eligibility during settling | Rising ⇒ [Q3](#15-open-questions) — the 14 days may need to be 30 |
| `gamification.eligibility_blocked` | counter | `reason` (`trust_floor`\|`cancellations`\|`suspended`\|`moderation`) — **never a score value** | — |
| `gamification.award_queue_depth` | gauge | queued awards awaiting cooldown release | p95 > 5 per user ⇒ evaluation is bunching and the cadence needs review |
| `gamification.visible_off_rate` | gauge | share of users with `gamification_visible = false` | **> 20% ⇒ the feature is unwanted and should be reconsidered, not redesigned** |
| `gamification.leaderboard_opt_in_rate` | gauge | opted-in ÷ eligible, per scope | < 10% ⇒ boards do not have consent and should not ship in that scope |
| `gamification.leaderboard_opt_out_within_7d` | counter | opt-ins reversed inside a week | > 25% ⇒ the opt-in copy is over-promising |
| `gamification.board_below_threshold` | gauge | scopes with an opt-in but fewer than 10 participants | Persistent ⇒ the scope granularity is wrong for our metros |
| `gamification.streak_hidden_rate` | gauge | users with `is_hidden = true` | > 15% ⇒ streaks are landing as pressure, and R29–R34 were not enough |
| `listing.spam_rate` (existing, watched here) | gauge | listings withdrawn or expired with zero requests | **Any step change coinciding with a badge launch ⇒ the listing-spam failure mode has arrived** |

> Three of these are kill-switch metrics rather than tuning metrics: `new_pair_ratio`, `visible_off_rate`, and a `listing.spam_rate` step change. Each has a pre-agreed response of **turning the feature off**, not iterating on it, and that agreement is recorded here so that it is made before anyone is emotionally invested in a launch.

**Never emitted:** a `trust_score` value or threshold, a source session id, a counterparty id, a safe-spot id from a badge evaluation, another user's leaderboard row, or a streak length alongside any identifier.

## 12. Accessibility

- Every badge is text first: name, earned/unearned, description, and `how_to_earn` in the accessibility label (§8.3). The icon is decorative (`importantForAccessibility="no"`).
- Earned state is conveyed by a text label and a filled/outlined treatment, never by colour or saturation alone. The achievements screen is fully usable in greyscale.
- The achievements grid is a **list** with family headings, navigable by heading rotor. A grid of unlabelled tiles is a maze with a screen reader and is the default design everyone reaches for first.
- The award celebration (R39) is announced through a polite live region, does not steal focus, and is dismissible with a labelled control — never a swipe-only gesture and never an auto-dismissing toast that a screen-reader user cannot get back to.
- Streaks are announced as a sentence ("Longest three seasons, currently one season"), never as a chart or a row of dots.
- Leaderboard rows are one accessible element each including rank and value; the viewer's own row is announced with a "You" prefix and is reachable directly rather than only by scrolling past ten rows.
- The leaderboard opt-in screen follows the same consent pattern as [SPEC-021 §12](SPEC-021-community-groups.md): headings per paragraph, and `Join the board` disabled until the disclosure region has been scrolled to its end.
- No animation is required to convey any state. Reduced motion turns the award celebration into a static card, and there is no confetti, no shake, no pulse, and no progress-bar fill anywhere.
- Dynamic type to 200% throughout; badge names wrap to two lines rather than truncating, because a truncated badge name is an unreadable claim.
- Minimum 44 × 44 dp on every badge tile, pin control, toggle, and leaderboard row.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | rls | R01 | No INSERT, UPDATE, or DELETE policy on `badges` for `anon` or `authenticated`; asserted from `pg_policies` against the live schema |
| T02 | integration | R02 | Every seeded badge has a `family` in the enum and a `criteria` blob that the evaluator parses; no badge stores executable SQL |
| T03 | e2e | R03 | `how_to_earn` renders on every badge surface: list, detail, empty state, and celebration |
| T04 | integration | R04 | The evaluator is asserted never to read `listings` counts, view counts, response times, report counts, or any rating value — static check plus a differential run where those values are mutated and awards do not change |
| T05 | integration | R05 | Listing 10 species with zero exchanges awards nothing; exchanging 10 distinct species awards the variety badge |
| T06 | integration | R06 | Two safe spots 800 m apart count as one; 2.1 km apart count as two |
| T07 | integration | R07 | A seasonal badge cannot be earned from a session outside its window, and cannot be re-awarded under the same id in a later season |
| T08 | integration | R08 | A retired badge still renders its name on a holder's profile; `badges_read` does not filter `is_active` |
| T09 | integration | R09 | Seed assertion: 12–18 badges, ≤ 4 first-season-achievable |
| T10 | integration | R10 | A session with one confirmation, or in any state other than `completed`, produces no award |
| T11 | integration | R11 | A session where either party is below `id_verified` produces no award |
| T12 | integration | R12 | `app.badge_eligible` returns false at `trust_score` 39 and true at 40, at 4 cancellations, when suspended, and after a suspension action; **the function's return type is boolean** and the value never appears in any response |
| T13 | integration | R13 | A session settles at day 14, not day 13; awards before settling do not occur |
| T14 | integration | R14 | 4th session with one counterparty in 90 days is excluded; a 12-session badge rejects a 4th session from a counterparty already contributing 3 |
| T15 | integration | R15 | An 8-session badge with 3 distinct counterparties is not awarded; with 4 it is |
| T16 | integration | R16 | Six simultaneously-qualifying badges release one per day over six days |
| T17 | integration | R17 | One session contributes to at most one badge per family |
| T18 | integration | R18 | Two accounts sharing an identity hash produce no awards for either |
| T19 | integration | R19 | Same pair, same spot, twice in 30 days counts once |
| T20 | integration | R20 | `evaluate_badges` run twice produces identical state |
| T21 | rls | R21 | `POST`, `PATCH`, and `DELETE` on `user_badges` as `authenticated` all denied — no policy exists |
| T22 | integration | R22 | Every awarded row carries a non-empty `source_session_ids` that reproduces the award |
| T23 | integration | R23 | Each of the four revocation triggers — `disputed`, `no_show`, `report_actioned`, revealed `no_show`/`misrepresented` rating — revokes |
| T24 | integration | R24 | A badge awarded 80 days ago is revoked when its session disputes on day 85 |
| T25 | integration | R25, R26 | Revocation sets `revoked_at`/`revoked_reason`, deletes nothing, and removes the badge from profile, pins, and leaderboard inputs in the same transaction |
| T26 | integration | R27 | Exactly one inbox row, zero pushes, and the copy names no counterparty and no report |
| T27 | integration | R28 | Moderator restoration returns the same `badge_id` with the original `awarded_at` |
| T28 | unit | R29 | Streak periods are months or seasons; no code path computes a day delta |
| T29 | integration | R30, R31 | Zone 4b dormancy pauses Nov–Mar; unknown zone defaults to Dec–Feb; a manual override applies |
| T30 | e2e | R32 | Screen sweep: no countdown, timer, "at risk", expiry, or warning colour appears on any streak surface |
| T31 | integration | R33 | A broken streak retains `longest_length` and renders as "Longest / Current" |
| T32 | integration | R34 | No RPC, product, or admin path restores or freezes a streak |
| T33 | integration | R35 | Mutating a streak changes no badge, no leaderboard value, and no ranking |
| T34 | e2e | R36 | The hide toggle is present on the streak display itself and hides immediately |
| T35 | integration | R37 | Unqualified sessions do not advance a streak |
| T36 | integration | R38 | **Zero** rows reach `private.notification_outbox` from this feature across the full test suite; `notification_kind` gains no value |
| T37 | e2e | R39 | One celebration per award, dismissible, non-repeating across cold starts |
| T38 | e2e | R40 | No percentage, progress bar, or "n more to go" with a deadline renders anywhere |
| T39 | e2e | R41 | `gamification_visible = false` hides all surfaces and inbox rows; awards still accrue; re-enabling reveals them without replaying celebrations |
| T40 | integration | R42 | No award is produced by any action not involving a completed two-party exchange |
| T41 | e2e | R43 | Achievement iconography differs from the trust-tier badge; the two never render adjacent without labels; snapshot-asserted |
| T42 | integration | R44 | Default is opted out; a board renders nobody who has not opted in |
| T43 | integration | R45 | `scope_kind = 'global'` is rejected by the CHECK and by the RPC; no global board exists in any query |
| T44 | integration | R46 | 9 participants → `renders: false`; 10 → renders |
| T45 | integration | R47 | Boards produce identical ordering when exchange counts, quantities, ratings, and trust tiers are mutated — the forbidden fields are provably not inputs |
| T46 | integration | R48 | Ranking by distinct species and seasonal badges; ties break alphabetically by handle |
| T47 | integration | R49 | The response contains 10 rows plus the caller's own; no pagination parameter reveals rank 11+ |
| T48 | integration | R50 | Season rollover resets the board; no all-time query path exists |
| T49 | integration | R51 | Opting out removes the user from the live board and from `private.leaderboard_snapshots` in one transaction |
| T50 | integration | R52 | Board rows contain no `city_label`, no rating, no exchange count, and no coordinate |
| T51 | e2e | R53 | No message affordance on any leaderboard surface; zero `message_threads` rows created across the run |
| T52 | rls | R54 | A non-member cannot read a group-scoped board |
| T53 | perf | R20, §7.6 | Nightly evaluation over 500,000 users with 2M sessions completes under 10 minutes; leaderboard build under 3 minutes |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T54 | `POST /rest/v1/user_badges` awarding oneself a badge | 403 — no INSERT policy (R21) |
| T55 | `PATCH /rest/v1/user_badges` clearing `revoked_at` on a revoked badge | 403 — no UPDATE policy |
| T56 | `PATCH /rest/v1/streaks` setting `current_length = 99` | `guard_streak_columns` raises 42501; only `is_hidden` and `dormant_months` are writable |
| T57 | `GET /rest/v1/user_badges?user_id=eq.<other user>` | Empty set — not a 403, no existence oracle |
| T58 | `GET /rest/v1/streaks?user_id=eq.<other user>` | Empty set (R35) |
| T59 | **Farming ring:** 6 sockpuppet accounts, all KYC-passed with distinct identities, 40 mutually-confirmed sessions at 1 safe spot over 2 weeks | At most a handful of awards survive R13/R14/R16/R19; `gamification.pair_concentration` and `gamification.spot_concentration` both alert; the scenario is asserted end to end with explicit expected award counts |
| T60 | **Same-identity ring:** 2 accounts sharing one `verification_vendor_refs` identity hash | Zero awards for either (R18) |
| T61 | **Score probe:** complete exchanges while observing whether awards appear, to binary-search the `trust_score` floor | The eligibility boundary produces no user-visible event, no notification, no copy change, and no differing latency; the settings help text is identical either side of the threshold (R12) |
| T62 | Attempt to read `trust_score` through any function or view added by this spec | 42501 / column absent everywhere; `app.badge_eligible` returns boolean and its inputs appear in no log ([SPEC-012 R48](SPEC-012-trust-and-safety.md)) |
| T63 | Opt into a metro board with a `scope_key` that is not the caller's `city_label` | `validation_failed` — otherwise a user could appear on any town's board and enumerate its participants |
| T64 | Opt into a group board without being an active member | `not_authorized` (R54) |
| T65 | Enumerate a scope's full participant list via repeated `leaderboard` calls with varying parameters | Only the top 10 plus own rank is ever returned; no offset, limit, or metric parameter widens it (R49) |
| T66 | Block the top-ranked user and re-read the board | They are absent; ranks render with a gap rather than renumbering (EC-11), so no removal is inferable as a rank shift |
| T67 | Suspended user reads their own achievements and attempts to pin | Achievements readable (their own history is theirs); pin denied with the §8.3 copy; `profile_badge_cards` returns nothing to anyone else, because it rides on `profile_cards` |
| T68 | Award a badge to a suspended user via the cron path | `app.badge_eligible` false; queued award is dropped, not held indefinitely |
| T69 | Force a revocation and inspect the inbox row and every log line for the counterparty's identity or the report id | Absent from both (R27) |
| T70 | Contract sweep for coordinate columns across `badges`, `user_badges`, `streaks`, `leaderboard_opt_ins`, `profile_badge_cards`, and all three RPC return types | Zero hits (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)) |
| T71 | Assert `safe_spot_id` and `scheduled_start` appear in no response of this feature | Absent; the diversity evaluation reads them only inside a definer function returning a count |
| T72 | Fire a synthetic Sentry event containing a `trust_score` and a source session id | Both scrubbed |
| T73 | Pin 4 badges, or pin a badge the caller does not hold, or pin a revoked one | `validation_failed` / `conflict`; the 3-pin cap is a trigger, not a client check |
| T74 | Replay `set_leaderboard_opt_in` 500 times in a minute | 20 succeed, rest `rate_limited` with integer `Retry-After` |
| T75 | Delete an account holding 14 badges and sitting rank 2 on a board | All rows cascade; snapshot rows deleted; the board re-renders with a gap at rank 2 until the next nightly build; `audit.events` retained pseudonymized |
| T76 | Attempt to add a `notification_kind` value or enqueue a push from any badge path | No enum value exists; the outbox row count from this feature is asserted zero (R38) |

### 13.3 Manual QA

- [ ] Run the farming-ring scenario (T59) by hand on staging with six real devices and count the awards. If it is cheap, the feature is not ready.
- [ ] Complete a real exchange, wait the full 14 days, and confirm the award arrives once, quietly, with no push.
- [ ] Dispute an exchange behind an awarded badge and confirm the badge disappears and the copy names nobody.
- [ ] Spend a dormant month in the app and confirm nothing anywhere suggests you are losing something.
- [ ] Show the achievements empty state to someone who has never used the app and ask how it made them feel. If the answer is "behind", the empty state has failed.
- [ ] Confirm on both platforms that no notification of any kind originates from this feature over a week of use.
- [ ] Join a leaderboard with 9 participants and confirm the honest below-threshold copy rather than an empty board.
- [ ] Turn `gamification_visible` off and use the app for a day; confirm nothing is missing and nothing is broken.
- [ ] VoiceOver and TalkBack over achievements, a badge detail, the streak display, and a leaderboard at 200% type.
- [ ] Put the trust-tier badge and an achievement badge side by side and ask five people what each means (R43).

## 14. Rollout

| Field | Value |
| --- | --- |
| Status | **Not built.** Phase 3, Approved, specified only. `badges`, `user_badges`, and `streaks` ship as empty stubs in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)). |
| **Liquidity precondition** | This feature **must not ship** until the exchange volume, distinct-counterparty ratio, and metro coverage targets in [the roadmap](../06-roadmap/01-roadmap.md) are met. `gamification.new_pair_ratio` must be measurable and healthy *before* launch, because after launch we cannot distinguish its movement from the feature's own effect. This is a gate, not guidance, and it is the reason the spec exists at Phase 3 rather than being written when someone asks for badges. |
| Feature flag | Four, independently switchable: `gamification.badges_enabled`, `gamification.streaks_enabled`, `gamification.leaderboards_enabled`, and the per-user `gamification_visible` preference (R41). Leaderboards are separately flagged because they are the only surface that publishes one user's data to another and are therefore the first thing to switch off. |
| Migration required | Yes — `20270310_0120_gamification.sql`: one enum, three table bodies over the MVP stubs, three new tables, two `private` tables, one view, nine functions, four cron jobs, five policies, and a badge seed. Additive only; no `ALTER TYPE`, no constraint replacement, so the [Data Model §15.3](../01-architecture/03-data-model.md#15-migration-rules) DAU gate does not engage. |
| Backfill required | **No, deliberately.** Pre-launch sessions are not evaluated for awards. They predate the settling, counterparty-cap, and eligibility rules, so awarding from them would mean publishing claims we cannot substantiate under the rules we just wrote. See [Q5](#15-open-questions). |
| Rollback plan | `gamification.leaderboards_enabled` off first — it removes the only cross-user surface, immediately, leaving badges and streaks intact. `gamification.badges_enabled` off hides badges and stops evaluation; awarded rows are retained so that re-enabling restores history rather than reissuing it. `gamification.streaks_enabled` off hides streaks. The migration is forward-only ([Data Model §15](../01-architecture/03-data-model.md#15-migration-rules)); a badly-calibrated badge is retired via `is_active = false` (R08), never deleted. |
| Client version floor | The Phase 3 minimum client. An older client simply has no achievements screen. |
| Data-model amendment | [Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs) stubs three tables; this spec needs four public tables plus two `private` ones (§6). The stub list needs a corresponding minor version bump. |
| **Pre-agreed kill criteria** | Turn the feature off — do not iterate — if any of: `gamification.new_pair_ratio` falls below 40% while awards rise; `listing.spam_rate` shows a step change coinciding with launch; `gamification.visible_off_rate` exceeds 20%. Recorded here so the decision is made before anyone has shipped it. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | **Is "security review: not required" right?** The register says not required, and the reasoning is that no new PII or location surface is introduced. But this feature reads `trust_score`, publishes user data to other users on leaderboards, and its entire anti-gaming design is an adversarial control surface. Security review of §5.2 and §5.6 at minimum looks warranted, and the register row should probably change. | Security + Product | Before build starts |
| Q2 | Should badges be visible to counterparties at all? Three pinned badges (R44, `profile_badge_cards`) is a compromise between [SPEC-012 US-09](SPEC-012-trust-and-safety.md) ("understand what a badge means before I meet them") and [SPEC-012 R52](SPEC-012-trust-and-safety.md) ("nothing ranks by reputation"). A badge nobody else sees is a private diary; a badge everyone sees is reputation by another name. | Product + Trust & Safety | Before build |
| Q3 | Is 14 days the right settling period (R13)? Long enough to catch most disputes, short enough that the award still feels connected to the exchange. `gamification.settling_reversal` will answer it, and we must choose first. | Product | Before build |
| Q4 | Leaderboard metrics (R48) exclude ratings because [SPEC-012 R52](SPEC-012-trust-and-safety.md) forbids ranking by reputation. "Widest range of crops" is defensible but thin, and a board with one metric gets stale in a season. Any second metric that is not volume and not reputation is genuinely hard to name. | Product | Before `leaderboards_enabled` |
| Q5 | Do we award retroactively at launch for pre-launch history? Not doing so means every existing user starts empty on the day of launch, which is the coldest possible start for a feature about recognition. Doing so means publishing claims evaluated under rules that did not exist. | Product | Before launch |
| Q6 | Session anonymization at 90 days ([Data Model §14](../01-architecture/03-data-model.md#14-retention-schedule)) makes revocation impossible after that point (EC-18). Do badges need a longer-lived, minimal evidence record — session id, both party ids, outcome — or do we accept a 90-day revocation horizon? A privacy-versus-auditability trade with no comfortable answer. | Security + Product | Before build |
| Q7 | Should a group be able to define its own badge ([SPEC-021](SPEC-021-community-groups.md))? It is the most-requested extension of a feature like this and it converts staff-authored reference data (R01) into a user-authored publishing surface with a moderation queue. | Product | Post-launch |
| Q8 | Does the dormant-window model (R30) survive contact with indoor growing, greenhouses, and mushrooms — users for whom there is no dormant season and for whom the pause is a false kindness? | Product | Before build |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product | Initial spec |
