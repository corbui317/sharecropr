# SPEC-021: Community Groups & Garden Clubs

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.1 |
| **Owner** | Product + Trust & Safety |
| **Phase** | Phase 2 |
| **Security review** | required |
| **Schema depends on** | [SPEC-007](SPEC-007-safe-spots.md), [SPEC-010](SPEC-010-exchange-lifecycle.md), [SPEC-012](SPEC-012-trust-and-safety.md) |
| **Behaviourally coupled with** | SPEC-007, SPEC-022, SPEC-900 |
| **Related ADRs** | [ADR-0003](../01-architecture/adr/ADR-0003-database-centric-authz.md), [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md), [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md) |
| **Last updated** | 2026-08-08 |

> **Not built.** This spec is Approved and specified; no code exists. It describes Phase 2 behaviour and fills the table stubs shipped in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)).

---

## 1. Summary

Groups let an existing real-world community — a neighbourhood, a garden club, a school allotment, a library's seed-library programme — have a home inside Sharecropr: a roster, a bulletin board, and swap events held at a safe spot. `partner_orgs` is the other half of the same idea from the supply side: a library or club that has agreed to host exchanges may administer its own safe spots' hours and notes, which is the only answer we have to the manual-curation bottleneck that caps coverage in [SPEC-007](SPEC-007-safe-spots.md). The liquidity argument is the whole reason this is Phase 2 and not Phase 3: a garden club arrives with thirty people who already trust each other and a room they already meet in, and that is worth more to a two-sided marketplace than any amount of onboarding polish.

## 2. Goals

- Let an existing community bring its trust network and its meeting place into the product intact, rather than re-earning both one exchange at a time.
- Give a group a bulletin board that is useful in the fallow months, when nobody has surplus but somebody has seedlings to give away.
- Let a group hold a swap at a safe spot, announced in one place, without inventing a second kind of exchange.
- Let a partner venue keep its own hours current, which directly attacks the largest controllable no-show generator in the product ([SPEC-007 §2](SPEC-007-safe-spots.md)).
- Define the moderator hierarchy in writing, before anyone is arguing about a specific removal, and make it unambiguous that the platform's decision is final.
- Guarantee, structurally, that a group cannot become a people-browser, a location oracle, or a cold-message channel.
- Be honest that group posts are a **new, broadcast, non-private moderation surface** and staff it before shipping it, not after.

## 3. Non-Goals

- **Group chat.** The bulletin board is a slow, threaded-by-nothing, post-and-comment surface. Real-time group messaging is a different product with a different abuse profile, and [SPEC-011 §3](SPEC-011-messaging.md) already refuses it once.
- **Direct messaging between members.** Joining a group grants **no** messaging capability whatsoever. Messaging still requires an accepted exchange request ([SPEC-011 R01](SPEC-011-messaging.md)). This is the single most important non-goal in this spec: a roster plus a message button is a cold-DM surface with a friendly name.
- **A member directory, people search, or "gardeners near you".** Members of a group are visible to that group and to nobody else, and there is no path from a user to the list of groups they belong to (R48).
- **Public groups readable by non-members.** A group's posts are visible to its active members and to platform moderators. There is no anonymous or logged-out view, no shareable post link, and no web surface.
- **Group-owned inventory, group listings, or a group as a party to an exchange.** Every exchange is still between two named people ([SPEC-010](SPEC-010-exchange-lifecycle.md)). A group cannot own a courgette.
- **Money in any form** — no dues, no fundraising, no "donate to the club", no ticketing for events. [ADR-0002](../01-architecture/adr/ADR-0002-barter-only.md) has no group exemption, and a subscription fee is the fastest way to turn a barter app into a payments compliance problem.
- **Group-level reputation, ranking, or "top clubs".** [SPEC-022](SPEC-022-gamification.md) may scope a leaderboard to a group; it may not rank groups against each other.
- **Federation, cross-group posting, or reposting.** A post lives in exactly one group.
- **Images, attachments, or links with previews in group posts.** Text and a safe-spot reference. An image board for 500 people is a CSAM review obligation we are not taking on in Phase 2, and a link preview fetcher is an SSRF surface.
- **Partner orgs creating active safe spots.** A partner may propose and may maintain; activation remains a staff decision against the [SPEC-007](SPEC-007-safe-spots.md) eligibility checklist, because that checklist is a safety control and not paperwork.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **garden club secretary**, I want our thirty members in one place in the app so that the club's trades happen here rather than on a mailing list. | P0 |
| US-02 | As a **club member**, I want to see what other members have going spare, so that I trade with people I already know. | P0 |
| US-03 | As a **group owner**, I want to approve who joins, so that the group stays the group. | P0 |
| US-04 | As a **member**, I want to post "seedlings free to anyone who wants them" without creating fourteen listings. | P1 |
| US-05 | As a **group moderator**, I want to remove a post that doesn't belong, without needing to email support. | P0 |
| US-06 | As a **member being harassed by a group moderator**, I want to report them to the platform without the report passing through them. | P0 |
| US-07 | As a **member**, I want to know before I join exactly who can see that I'm in this group. | P0 |
| US-08 | As a **member**, I want to know that joining doesn't tell anyone where I live. | P0 |
| US-09 | As a **librarian**, I want to update our opening hours myself so that nobody turns up to a closed building. | P0 |
| US-10 | As a **librarian**, I want to take our branch off the map the same day if something goes wrong. | P0 |
| US-11 | As a **group owner**, I want to announce a swap at the library on Saturday, and see who's coming. | P1 |
| US-12 | As a **platform moderator**, I want to see group posts when they're reported, and to know that a group moderator can't undo my decision. | P0 |
| US-13 | As a **user who left a group**, I want my posts and my name to stop being visible to it. | P1 |
| US-14 | As a **screen-reader user**, I want the roster and the board to be plain lists with real headings. | P0 |

## 5. Functional Requirements

### 5.1 Groups and their lifecycle

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | A `public.groups` row **MUST** have exactly one `owner_id`, a `kind`, a `join_policy`, and a `city_label`. It **MUST NOT** have any coordinate column of any kind. |
| R02 | **MUST** | A group's geographic anchor **MUST** be `home_safe_spot_id`, a reference to an `active` safe spot — a public building whose coordinate is already public ([SPEC-007](SPEC-007-safe-spots.md)). This is the only spatial fact a group carries. |
| R03 | **MUST** | Creating a group **MUST** require `app.can_transact()`. A group is a trust surface, and an unverified account creating clubs is the cheapest possible harvesting funnel. |
| R04 | **MUST** | A user **MUST** own at most **3** groups and belong to at most **10** (R48 explains why the second number is a privacy control and not a product one). |
| R05 | **MUST** | A group **MUST** cap at **500** active members. Above that a roster is a directory, and the design commitments in §5.7 stop being credible. |
| R06 | **MUST** | `join_policy` **MUST** be one of `invite_only` or `request_to_join`. There is no open-join policy: every membership passes through a human decision by the group, which is the mechanism that makes a group's trust worth anything. |
| R07 | **MUST** | `is_listed` **MUST** control whether a group appears in the in-app directory for its `city_label`. An unlisted group is reachable only by invite. |
| R08 | **MUST** | The directory **MUST** return `name`, `kind`, `city_label`, `home_safe_spot` name, `member_count` bucketed (`<10`, `10–49`, `50–199`, `200+`), and `description`. It **MUST NOT** return any member's identity, and **MUST NOT** be filterable or orderable by anything derived from members. |
| R09 | **MUST** | Transferring ownership **MUST** be possible to an existing `moderator`, and a group **MUST NOT** be left ownerless: deleting the owner's account promotes the longest-serving moderator, or archives the group if there is none. |
| R10 | **MUST** | Archiving a group (`status = 'archived'`) **MUST** make it read-only for members and invisible in the directory, and **MUST NOT** delete posts, because an open report may reference them. |
| R11 | **SHOULD** | Group `name` **SHOULD** be unique per `city_label`, enforced as a soft check with a "there's already a group called that near you" warning rather than a hard constraint. Two "Seed Swap" groups in one town is confusing; blocking the second is worse. |

### 5.2 Membership and joining

| ID | Req | Statement |
| --- | --- | --- |
| R12 | **MUST** | `group_members` **MUST** be keyed `(group_id, user_id)` and carry a `role` of `member`, `moderator`, or `owner` and a `state` of `invited`, `requested`, `active`, `suspended`, `left`, or `removed`. |
| R13 | **MUST** | Only an `active` member **MUST** be able to read the roster, read posts, or post. Every other state reads nothing. |
| R14 | **MUST** | A join request **MUST** be created by the user (`state = 'requested'`) and moved to `active` only by a group moderator or owner via `rpc.review_group_join`. |
| R15 | **MUST** | An invitation **MUST** be created by a group moderator or owner and accepted by the invitee. An invite **MUST NOT** auto-join anyone; a roster you were placed on without consent is a disclosure you did not agree to. |
| R16 | **MUST** | The join flow **MUST** display the disclosure copy in §8.3 — what other members will see, what platform moderators can see, and what is never shared — and **MUST** require an explicit tap to proceed. Consent to be listed is obtained here, once, in plain words. |
| R17 | **MUST** | Invitations **MUST** be by `handle` or by a single-use invite code with a 14-day expiry, **MUST** be limited to 20 per moderator per day, and **MUST NOT** accept an email address or a phone number. Accepting a contact identifier would make the group an invitation-spam channel into people's inboxes and would put PII we do not need into a group-scoped table. |
| R18 | **MUST** | A user **MUST** be able to leave a group at any time, in one action, without approval. `state` becomes `left`; the row is retained so a re-invite is a state change and a repeat abuser cannot rejoin invisibly. |
| R19 | **MUST** | Leaving or being removed **MUST** immediately revoke read access to the roster and the board, and **MUST** hide the departed member's identity from the roster. Their posts remain, attributed to "Former member", because deleting them would hole the record an open report may depend on. |
| R20 | **MUST** | A blocked pair **MUST NOT** see each other anywhere inside a group: not on the roster, not on the board, not on an event RSVP list. Enforced by `app.is_blocked_either_way` **inside the policies**, so blocked content never enters the result set ([RLS Design §6](../01-architecture/05-rls-design.md)). |
| R21 | **MUST** | A platform-suspended user (`profiles.is_suspended = true`) **MUST** disappear from every group surface simultaneously, exactly as they disappear from `profile_cards` ([SPEC-012 R54](SPEC-012-trust-and-safety.md)). |
| R22 | **SHOULD** | A join request unanswered for 30 days **SHOULD** expire silently, and the requester **SHOULD** be able to request again. |

### 5.3 The bulletin board

| ID | Req | Statement |
| --- | --- | --- |
| R23 | **MUST** | A `group_posts` row **MUST** have `kind` of `bulletin` or `event`, a `title` of 3–100 characters, and a `body` of 1–2000 characters after trimming. |
| R24 | **MUST NOT** | A post **MUST NOT** contain an image, an attachment, a link preview, or any embedded media. Text and, for events, a safe-spot reference. |
| R25 | **MUST** | A post **MUST** be insertable only by an `active` member of that group, enforced by `group_posts_insert_member` via `app.is_group_member()`. |
| R26 | **MUST** | An author **MAY** edit their own post for **15 minutes** after posting, after which it is immutable. Deletion by the author is a soft delete that leaves the row and shows "Post removed by author". Unbounded editing makes the board useless as evidence; zero editing makes a typo permanent for 500 people. |
| R27 | **MUST** | Every post **MUST** be enqueued for the existing `content-scan` Edge Function with the same detection categories as messages ([SPEC-011 R27](SPEC-011-messaging.md)) plus a group-specific category for recruitment and off-platform coordination. |
| R28 | **MUST** | Flagging **MUST NOT** block, delay, hide, or alter a post. It marks it for review, and the scan result **MUST NOT** be visible to the author or to any member ([SPEC-011 R31](SPEC-011-messaging.md)). |
| R29 | **MUST** | Posting **MUST** be rate limited to **10 posts per group per user per day** and **30 posts per user per day** across all groups, returning `rate_limited` with `Retry-After`. |
| R30 | **MUST** | The board **MUST** paginate by keyset on `(group_id, is_pinned DESC, created_at DESC, id)`, 25 per page. |
| R31 | **MUST** | A group moderator **MAY** pin at most **3** posts per group. |
| R32 | **SHOULD** | Posts older than 180 days **SHOULD** be collapsed behind an "older posts" affordance rather than deleted. Retention follows [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md); a group's history is part of what makes it a group. |

### 5.4 Group exchange events

| ID | Req | Statement |
| --- | --- | --- |
| R33 | **MUST** | An `event` post **MUST** reference an `active` safe spot and carry `starts_at` and `ends_at` with `ends_at > starts_at` and a duration of at most 8 hours. |
| R34 | **MUST NOT** | An event **MUST NOT** be creatable at any location that is not an `active` safe spot. There is no free-text venue field, exactly as there is no free-text venue anywhere else in the product ([ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md)). |
| R35 | **MUST** | An event **MUST NOT** create, imply, or substitute for an `exchange_sessions` row. Trades made at a swap meet are still individual exchanges through [SPEC-010](SPEC-010-exchange-lifecycle.md), or they are outside the system entirely — see the honest limitation below. |
| R36 | **MUST** | RSVPs (`going` / `maybe` / `not_going`) **MUST** be visible only to `active` members of that group, and the RSVP list **MUST** carry the same reduced member card as the roster (R44). |
| R37 | **MUST** | Only a group moderator or owner **MAY** create an `event` post. A member-created event is a group's name attached to a meeting the group did not agree to. |
| R38 | **SHOULD** | An event **SHOULD** produce one in-app inbox notification to active members at creation and one reminder 24 hours before, both suppressible, and **SHOULD NOT** push more than twice for any event. |
| R39 | **MUST** | The event detail screen **MUST** display the safe spot's hours, accessibility notes, and parking notes from [SPEC-007](SPEC-007-safe-spots.md), because an event at a closed building is the same no-show generator with more people in it. |

> **Honest limitation.** A swap meet where twelve people trade produces **zero** `exchange_sessions`, therefore zero ratings, zero completed-exchange counts, and zero trust-score movement. The most social, highest-liquidity thing this feature enables is invisible to every trust mechanism in [SPEC-012](SPEC-012-trust-and-safety.md) and to every badge in [SPEC-022](SPEC-022-gamification.md). We are shipping it that way deliberately, because the alternative — a "check in at the event" flow that mints trust from an unverified physical claim — is a trust-farming machine, and the trade-off is recorded as [Q3](#15-open-questions) rather than quietly ignored.

### 5.5 Moderation: two hierarchies, and which one wins

| ID | Req | Statement |
| --- | --- | --- |
| R40 | **MUST** | **A group is not a private space from a platform-moderation standpoint.** Group posts are published content with an audience of up to 500 people, and platform moderators **MUST** be able to read any group post. This is a deliberate divergence from [SPEC-011 R32](SPEC-011-messaging.md), where moderator access to a two-person thread is scoped to a report — a broadcast board is closer to a listing than to correspondence. Every read **MUST** write an `audit.events` row. |
| R41 | **MUST** | R40's scope **MUST** be stated to users in the join disclosure (R16) and in the group settings screen, in the exact copy in §8.3. A moderation power users do not know about is a surprise, and surprises about who reads your writing are the ones that end products. |
| R42 | **MUST** | A **group moderator** **MAY**: approve, decline, and revoke membership; remove and pin posts in their group; edit group metadata; create events. They **MUST NOT**: read `trust_score` or any moderation history, see reports filed about their members, suspend a platform account, restore content a platform moderator removed, or see who reported a post. |
| R43 | **MUST** | A **platform moderator's** action **MUST** always win. Concretely: a post with `removed_by_platform_at IS NOT NULL` **MUST NOT** be restorable by any group role, a user suspended by the platform **MUST NOT** be re-admitted to any group while suspended, and a group placed `under_review` by the platform **MUST** be read-only for all group roles including the owner. |
| R44 | **MUST** | Reporting a post, an event, a member, or a whole group **MUST** go directly to the platform report queue via `create_report` ([SPEC-012](SPEC-012-trust-and-safety.md)) and **MUST NOT** be routed through, visible to, or notified to any group moderator. A report about a group moderator that passes through that moderator is not a reporting system. |
| R45 | **MUST** | `reports.subject_type` **MUST** be extended with `'group_post'` and `'group'`, and a report on either **MUST** attach the surrounding 10 posts of context for the reviewing moderator, mirroring [SPEC-011 R29](SPEC-011-messaging.md). |
| R46 | **MUST** | Removal by a group moderator **MUST NOT** close, resolve, or affect any platform report about the same content. The two systems record different facts and neither is the other's appeal. |
| R47 | **MUST** | A group whose posts generate reports at more than **5× the platform median rate over 30 days** **MUST** raise a moderation-console signal for human review. It **MUST NOT** trigger any automated action — no count of reports, from any number of accounts, suspends anything without a human ([SPEC-012 §3](SPEC-012-trust-and-safety.md)). |

### 5.6 Partner organisations

| ID | Req | Statement |
| --- | --- | --- |
| R48 | **MUST** | A `partner_orgs` row **MUST** be created only by platform staff, and **MUST NOT** reach `status = 'active'` without a stored consent record referencing the signed venue agreement required by [SPEC-007](SPEC-007-safe-spots.md). |
| R49 | **MUST** | A partner admin **MAY** update, on safe spots whose `partner_org_id` is theirs: `hours`, `accessibility_notes`, `parking_notes`, `safety_notes`, `photo_path`, and `is_indoor`. Every such update **MUST** set `hours_verified_at = now()` when `hours` changed. |
| R50 | **MUST NOT** | A partner admin **MUST NOT** change `point`, `address_line`, `category`, `partner_org_id`, or set `status = 'active'`. Activation is a staff decision against the eligibility checklist, which is a safety control ([SPEC-007 §2](SPEC-007-safe-spots.md)). |
| R51 | **MUST** | A partner admin **MUST** be able to set their own spot's `status` to `suspended` in one action with immediate effect — the same-day takedown promised in [SPEC-007](SPEC-007-safe-spots.md) — and the suspension **MUST** trigger the existing rescheduling path for any session already scheduled there. |
| R52 | **MUST** | A partner admin **MAY** create a safe spot in `proposed` status only. Staff review moves it to `active`. |
| R53 | **MUST** | Every partner write **MUST** write `audit.events` with the actor, the org, the spot, and the changed keys. |
| R54 | **MUST** | Partner admin status **MUST** be a row in `partner_org_admins`, checked by `app.is_partner_admin_for_spot()`. It **MUST NOT** be a JWT claim, because unlike `app.is_moderator()` it is per-object and revocation must be immediate rather than token-refresh-lagged ([RLS Design §2](../01-architecture/05-rls-design.md)). |
| R55 | **MUST** | A partner org may be linked to at most one group, and that link **MUST NOT** grant the group's moderators any safe-spot capability. Club officer and venue administrator are different roles even when they are the same person, and conflating them means a group-moderator promotion silently grants map-editing rights. |
| R56 | **SHOULD** | Partner-maintained spots **SHOULD** show "Hours confirmed by {org} on {date}" so users can weigh the source, and staff-verified and partner-verified hours **SHOULD** be distinguishable in the moderation console. |

### 5.7 What a group must never reveal

> This subsection exists because every failure mode of a group feature in a location-sensitive product is a disclosure the user did not expect. Each requirement here has a matching negative test.

| ID | Req | Statement |
| --- | --- | --- |
| R57 | **MUST NOT** | No group surface **MUST** expose a member's `display_point`, `coarse_cell`, `fine_cell`, garden, garden name, exact coordinate, or any location value finer than `profiles.city_label`. |
| R58 | **MUST** | The roster **MUST** render a **reduced member card** — `handle`, `display_name`, `avatar_path`, `trust_tier`, `city_label`, group `role` — and nothing else. Not `rating_avg`, not `rating_count`, not `completed_exchanges`, not `bio`, not join date to finer than a month. The reduced card is a `security_invoker` view, so widening it is a schema change under review rather than a select-list edit. |
| R59 | **MUST NOT** | The roster **MUST NOT** be sortable, filterable, or searchable by trust tier, activity, or any reputation signal, and **MUST NOT** be exportable. It is alphabetical, paginated at 50, and rate limited to 30 reads per user per hour. |
| R60 | **MUST NOT** | There **MUST NOT** be any path from a user to the list of groups they belong to, for anyone other than that user. Group membership is queryable only in the direction group → members, and only by that group's active members. **This is the anti-correlation control**: groups have catchments, and knowing that one person is in "Burns Park Gardeners" *and* "Westside Seed Swap" narrows their home to the intersection of two neighbourhoods far more sharply than either fact alone. |
| R61 | **MUST NOT** | A group surface **MUST NOT** offer any affordance to message a member. Messaging remains gated on an accepted exchange request ([SPEC-011 R01](SPEC-011-messaging.md)), and no code path in this spec creates a `message_threads` row. |
| R62 | **MUST** | An event RSVP **MUST NOT** be visible outside the group, and the aggregate count **MUST NOT** appear in the directory. "Eleven people will be at this library at 10 a.m. Saturday" is a public schedule of a specific place and time. |
| R63 | **MUST** | Group notifications **MUST** use the templated notification path ([Realtime & Notifications §3.1](../01-architecture/08-realtime-and-notifications.md)) and **MUST NOT** interpolate anything beyond a group name, a post title, and a safe-spot name. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.groups`](../01-architecture/03-data-model.md#13-future-feature-stubs) | read (member/directory), write (owner/mod via RPC) | No coordinate column, ever (R01) |
| `public.group_members` | read (fellow active member), write via RPC | Reduced card view for rendering (R58) |
| `public.group_posts` | read/insert (active member), update (author ≤ 15 min, or mod) | New moderation surface |
| `public.group_event_rsvps` | read/write (active member) | **New.** Group-scoped only |
| `public.partner_orgs` | read (public subset), write (staff) | Consent record required (R48) |
| `public.partner_org_admins` | read (self, staff) | **New.** Per-object, not a JWT claim (R54) |
| `private.partner_org_contacts` | none (service only) | **New.** Contact name, email, phone — P1 |
| `public.safe_spots` | update (partner admin, narrowed columns) | R49, R50 |
| `public.profiles` / `public.profile_cards` | read | Source of the reduced card |
| `public.reports` | insert, read (moderator) | `subject_type` extended (R45) |
| `public.blocks` | read via `app.is_blocked_either_way` | R20 |
| `public.notifications` / `private.notification_outbox` | insert via `app.enqueue_notification` | R38, R63 |
| `audit.events` | insert | R40, R53 |

**New schema objects introduced by this spec:** migration `20261115_0095_community_groups.sql`

```sql
CREATE TYPE group_kind         AS ENUM ('neighbourhood','garden_club','school','library','allotment','other');
CREATE TYPE group_join_policy  AS ENUM ('invite_only','request_to_join');
CREATE TYPE group_member_role  AS ENUM ('member','moderator','owner');
CREATE TYPE group_member_state AS ENUM ('invited','requested','active','suspended','left','removed');
CREATE TYPE group_status       AS ENUM ('active','under_review','archived');
CREATE TYPE group_post_kind    AS ENUM ('bulletin','event');
CREATE TYPE partner_org_status AS ENUM ('pending','active','suspended','terminated');

CREATE TABLE public.groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES public.profiles(id),
  name              text NOT NULL CHECK (length(name) BETWEEN 3 AND 60),
  slug              text NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  kind              group_kind NOT NULL,
  description       text CHECK (length(description) <= 500),
  join_policy       group_join_policy NOT NULL DEFAULT 'request_to_join',
  status            group_status NOT NULL DEFAULT 'active',
  is_listed         boolean NOT NULL DEFAULT true,
  city_label        text NOT NULL CHECK (length(city_label) <= 80),
  home_safe_spot_id uuid REFERENCES public.safe_spots(id),
  partner_org_id    uuid REFERENCES public.partner_orgs(id),
  member_count      integer NOT NULL DEFAULT 0 CHECK (member_count BETWEEN 0 AND 500),
  under_review_at   timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- There is deliberately no geography, geometry, *_cell, lat, or lng column here (R01).

CREATE UNIQUE INDEX groups_slug_key ON public.groups (slug) WHERE deleted_at IS NULL;
CREATE INDEX groups_directory_idx ON public.groups (city_label, kind)
  WHERE is_listed AND status = 'active' AND deleted_at IS NULL;
CREATE INDEX groups_owner_idx ON public.groups (owner_id);

CREATE TABLE public.group_members (
  group_id   uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       group_member_role  NOT NULL DEFAULT 'member',
  state      group_member_state NOT NULL DEFAULT 'requested',
  invited_by uuid REFERENCES public.profiles(id),
  joined_at  timestamptz,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX group_members_user_idx   ON public.group_members (user_id) WHERE state = 'active';
CREATE INDEX group_members_active_idx ON public.group_members (group_id) WHERE state = 'active';
CREATE UNIQUE INDEX groups_one_owner ON public.group_members (group_id)
  WHERE role = 'owner' AND state = 'active';

CREATE TABLE public.group_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  author_id     uuid REFERENCES public.profiles(id),        -- NULL once anonymized
  kind          group_post_kind NOT NULL DEFAULT 'bulletin',
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 100),
  body          text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  safe_spot_id  uuid REFERENCES public.safe_spots(id),
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_pinned     boolean NOT NULL DEFAULT false,
  edited_at     timestamptz,
  removed_by    uuid REFERENCES public.profiles(id),
  removed_at    timestamptz,
  removal_scope text CHECK (removal_scope IN ('author','group','platform')),
  removed_by_platform_at timestamptz,
  scan_state    text NOT NULL DEFAULT 'pending'
                CHECK (scan_state IN ('pending','clean','flagged','error')),
  flagged_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_needs_spot_and_times CHECK (
    kind <> 'event' OR (safe_spot_id IS NOT NULL
                        AND starts_at IS NOT NULL AND ends_at IS NOT NULL
                        AND ends_at > starts_at
                        AND ends_at <= starts_at + interval '8 hours'))
);

CREATE INDEX group_posts_board_idx ON public.group_posts
  (group_id, is_pinned DESC, created_at DESC, id) WHERE removed_at IS NULL;
CREATE INDEX group_posts_scan_pending_idx ON public.group_posts (created_at)
  WHERE scan_state = 'pending';
CREATE INDEX group_posts_flagged_idx ON public.group_posts (created_at)
  WHERE flagged_reason IS NOT NULL;
CREATE INDEX group_posts_events_idx ON public.group_posts (group_id, starts_at)
  WHERE kind = 'event' AND removed_at IS NULL;
CREATE UNIQUE INDEX group_posts_pin_limit ON public.group_posts (group_id, id)
  WHERE is_pinned;   -- count enforced to 3 by trigger; index makes the scan cheap

CREATE TABLE public.group_event_rsvps (
  post_id    uuid NOT NULL REFERENCES public.group_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  response   text NOT NULL CHECK (response IN ('going','maybe','not_going')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE public.partner_orgs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  org_type      text NOT NULL CHECK (org_type IN
                  ('library','municipality','garden_club','school','nonprofit','other')),
  status        partner_org_status NOT NULL DEFAULT 'pending',
  consent_ref   text CHECK (length(consent_ref) <= 120),   -- signed agreement reference
  consent_at    timestamptz,
  approved_by   uuid REFERENCES public.profiles(id),
  terminated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT active_needs_consent CHECK (
    status <> 'active' OR (consent_ref IS NOT NULL AND consent_at IS NOT NULL))
);

CREATE TABLE public.partner_org_admins (
  org_id     uuid NOT NULL REFERENCES public.partner_orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES public.profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (org_id, user_id)
);

-- Venue contacts are P1 and belong nowhere a client can reach.
CREATE TABLE private.partner_org_contacts (
  org_id       uuid PRIMARY KEY REFERENCES public.partner_orgs(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  contact_email citext NOT NULL,
  contact_phone text,
  notes        text
);
REVOKE ALL ON private.partner_org_contacts FROM anon, authenticated;

ALTER TABLE public.reports
  DROP CONSTRAINT reports_subject_type_check,
  ADD CONSTRAINT reports_subject_type_check CHECK (
    subject_type IN ('user','listing','message','session','group_post','group'));
```

The reduced member card (R58) is a view, so widening it is reviewable:

```sql
CREATE VIEW public.group_member_cards WITH (security_invoker = on) AS
SELECT gm.group_id, gm.user_id, gm.role,
       p.handle, p.display_name, p.avatar_path, p.trust_tier, p.city_label,
       date_trunc('month', gm.joined_at) AS joined_month
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
 WHERE gm.state = 'active'
   AND p.deleted_at IS NULL
   AND p.is_suspended = false
   AND NOT app.is_blocked_either_way((SELECT auth.uid()), gm.user_id)
   AND app.is_group_member(gm.group_id);
GRANT SELECT ON public.group_member_cards TO authenticated;
-- Deliberately absent: rating_avg, rating_count, completed_exchanges, bio,
-- home_coarse_cell, any garden reference, any coordinate. R57, R58.
```

Helper functions and policies:

```sql
CREATE OR REPLACE FUNCTION app.is_group_member(gid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members m
                  WHERE m.group_id = gid
                    AND m.user_id = (SELECT auth.uid())
                    AND m.state = 'active');
$$;

CREATE OR REPLACE FUNCTION app.is_group_moderator(gid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members m
                  WHERE m.group_id = gid
                    AND m.user_id = (SELECT auth.uid())
                    AND m.state = 'active'
                    AND m.role IN ('moderator','owner'));
$$;

CREATE OR REPLACE FUNCTION app.is_partner_admin_for_spot(spot uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.safe_spots s
      JOIN public.partner_orgs o    ON o.id = s.partner_org_id AND o.status = 'active'
      JOIN public.partner_org_admins a ON a.org_id = o.id
     WHERE s.id = spot
       AND a.user_id = (SELECT auth.uid())
       AND a.revoked_at IS NULL);
$$;

CREATE POLICY group_posts_select_member ON public.group_posts
  FOR SELECT TO authenticated
  USING ((app.is_group_member(group_id)
          AND removed_at IS NULL
          AND NOT app.is_blocked_either_way((SELECT auth.uid()), author_id))
         OR app.is_moderator());          -- R40: platform read is unscoped, and audited

CREATE POLICY group_posts_insert_member ON public.group_posts
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid())
              AND app.is_group_member(group_id)
              AND (SELECT status FROM public.groups g WHERE g.id = group_id) = 'active'
              AND (kind <> 'event' OR app.is_group_moderator(group_id)));

CREATE POLICY groups_select_visible ON public.groups
  FOR SELECT TO authenticated
  USING (app.is_group_member(id)
         OR (is_listed AND status = 'active' AND deleted_at IS NULL)
         OR app.is_moderator());

CREATE POLICY group_members_select_fellow ON public.group_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR app.is_group_member(group_id)
         OR app.is_moderator());

CREATE POLICY safe_spots_partner_update ON public.safe_spots
  FOR UPDATE TO authenticated
  USING (app.is_partner_admin_for_spot(id))
  WITH CHECK (app.is_partner_admin_for_spot(id));
-- Column narrowing (R49, R50) is enforced by the guard_partner_spot_update
-- trigger, because a WITH CHECK cannot express "these six columns only".
```

> **A note on [RLS-4](../01-architecture/05-rls-design.md).** `group_members_select_fellow` calls `app.is_group_member()`, which queries `group_members` — the same table. That reads as a violation of RLS-4, and it is safe for the same reason `threads_select_participant` → `app.is_thread_participant()` is safe in [SPEC-011 §9](SPEC-011-messaging.md): the helper is `SECURITY DEFINER` and owned by a `BYPASSRLS` role, so its inner query is not re-filtered and no recursion occurs. RLS-4 as written forbids the shape rather than the hazard; the precise rule is *"no policy may call a function whose query is itself subject to that policy"*. This is raised as [Q6](#15-open-questions) because the current wording will otherwise be either violated or misapplied by whoever writes the next table.

Also introduced: `app.group_role(uuid)`, `guard_partner_spot_update`, `guard_group_post_edit_window` (R26), `trg_group_member_count` (maintains `member_count`, enforces R05), `trg_group_pin_limit` (R31), and eight RPCs listed in §7.

**PII touched:** `group_members.user_id` (P2 — the same identity already visible on any listing that user publishes, but newly visible to a set of people who have not transacted with them, which is why R16's disclosure exists). `groups.city_label` (P2, coarse by construction). `group_posts.body` (**P1** — free text that may contain anything the user typed, handled exactly as `messages.body` is: never logged, never in Sentry or PostHog, scrubbed by property name). `private.partner_org_contacts` (P1, never client-reachable). **No P0 column is introduced and no function in this spec reads `private.garden_locations`.**

## 7. API

### 7.1 `rpc.create_group`

**Auth:** `authenticated` + `app.can_transact()` (R03) · **Rate limit:** 3 / day / user

```jsonc
// Request
{ "p_name": "Burns Park Gardeners", "p_kind": "neighbourhood",
  "p_description": "Neighbours swapping surplus, April to October.",
  "p_join_policy": "request_to_join", "p_home_safe_spot_id": "9a1c…",
  "p_is_listed": true, "p_idempotency_key": "…" }
// Response 201
{ "group_id": "4f2b…", "slug": "burns-park-gardeners", "city_label": "Ann Arbor, MI" }
```

`city_label` is **derived server-side** from the chosen safe spot's locality, never supplied by the client — a client-supplied city label on a group is a free-text location field wearing a disguise.

| Error code | HTTP | When |
| --- | --- | --- |
| `not_verified` | 403 | `app.can_transact()` false |
| `validation_failed` | 400 | Name shape; safe spot not `active`; unknown kind |
| `quota_exceeded` | 422 | Already owns 3 groups (R04) |
| `rate_limited` | 429 | Bucket empty |

### 7.2 `rpc.request_group_join` / `rpc.review_group_join`

**Auth:** `authenticated` / group moderator · **Rate limit:** 20 join requests per day per user; 200 reviews per day per moderator

```jsonc
// request_group_join
{ "p_group_id": "4f2b…", "p_note": null }        → { "state": "requested" }
// review_group_join
{ "p_group_id": "4f2b…", "p_user_id": "…", "p_decision": "approve" }
                                                  → { "state": "active", "member_count": 31 }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Reviewer is not a moderator of that group |
| `conflict` | 409 | Already active, already removed, or `join_policy = 'invite_only'` |
| `quota_exceeded` | 422 | Group at 500 members (R05), or requester in 10 groups (R04) |
| `suspended` | 403 | Requester is platform-suspended (R21) |

`p_note` exists and is capped at 200 characters; it is delivered to moderators and **is scanned by `content-scan`**, because a join-request note is an unsolicited message to strangers and would otherwise be the cold-DM channel §3 exists to prevent.

### 7.3 `rpc.invite_to_group(p_group_id, p_handle | p_generate_code)`

**Auth:** group moderator · **Rate limit:** 20 / day / moderator (R17)

Returns either `{ "state": "invited" }` or `{ "code": "SC-8F14-2K", "expires_at": "…" }`. Accepts a handle or generates a code. **It accepts no email address and no phone number** — asserted by the function signature and by [T57](#132-negative--security-tests).

### 7.4 `rpc.create_group_post`

**Auth:** active member; `kind = 'event'` requires group moderator (R37) · **Rate limit:** 10 / group / day, 30 / user / day (R29)

```jsonc
// Request
{ "p_id": "c31e…", "p_group_id": "4f2b…", "p_kind": "event",
  "p_title": "Saturday swap at the downtown library",
  "p_body": "Bring whatever's spare. Meeting in the lobby by the seed library.",
  "p_safe_spot_id": "9a1c…", "p_starts_at": "2027-08-14T14:00:00Z",
  "p_ends_at": "2027-08-14T16:00:00Z" }
// Response 201
{ "post_id": "c31e…", "created_at": "…", "editable_until": "…" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not an active member; or `event` and not a moderator |
| `group_read_only` | 409 | Group is `archived` or `under_review` (R43) |
| `validation_failed` | 400 | Title/body length; event without a spot or with an out-of-range duration; safe spot not `active` (R34) |
| `rate_limited` | 429 | Post limit |

`p_id` is client-generated, so a retry is an idempotent primary-key conflict — the same mechanism [SPEC-011 §7](SPEC-011-messaging.md) uses for the offline queue.

### 7.5 `rpc.remove_group_post(p_post_id, p_scope)`

`p_scope` is `author` (own post, any time) or `group` (moderator). Platform removal is not exposed here at all — it happens in [SPEC-900](SPEC-900-moderation-console.md) and sets `removed_by_platform_at`, which no group role can clear (R43).

### 7.6 `rpc.partner_update_safe_spot`

**Auth:** `authenticated` + `app.is_partner_admin_for_spot()` re-checked inside the function · **Rate limit:** 60 / day / admin

```jsonc
// Request
{ "p_safe_spot_id": "9a1c…",
  "p_patch": { "hours": { "mon": [["09:00","20:00"]] },
               "parking_notes": "Free lot on Fifth Ave after 6pm." } }
// Response 200
{ "safe_spot_id": "9a1c…", "changed": ["hours","parking_notes"],
  "hours_verified_at": "2027-03-02T11:04:00Z" }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `not_authorized` | 403 | Not an admin of that spot's org, or org not `active` |
| `forbidden_field` | 422 | `p_patch` contains `point`, `address_line`, `category`, `partner_org_id`, or `status = 'active'` (R50) |
| `validation_failed` | 400 | Malformed hours jsonb |

### 7.7 `rpc.partner_suspend_safe_spot(p_safe_spot_id, p_reason)`

Sets `status = 'suspended'` immediately and enqueues the existing reschedule path for affected sessions (R51). This is the same-day takedown, and it is deliberately a separate, single-purpose RPC rather than a field on the patch endpoint — a takedown that requires constructing a JSON patch under pressure is a takedown that does not happen.

### 7.8 Edge Function: `content-scan` (extended)

The existing function ([SPEC-011 §7](SPEC-011-messaging.md)) gains `group_posts` and join-request notes as scan subjects, and one new category: **off-platform coordination** ("email me at", "we do this on Facebook now", "join our WhatsApp"). Group boards are where an off-platform migration actually happens, and knowing the rate is the point ([R-09](../06-roadmap/02-open-risks.md)).

### 7.9 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| `GET /group_members?user_id=eq.<someone else>` | R60. The reverse lookup is the correlation attack. |
| Any endpoint returning a member's location beyond `city_label` | R57 |
| A message-a-member endpoint | R61 |
| A public/anonymous group or post URL | §3. No web surface, no share sheet, no unfurl. |
| Group post images | R24 |
| A group-level "who reported this" | R42 |
| Realtime on `group_posts` | A bulletin board that updates on focus is a bulletin board. A socket per group per member is the fanout cost [Realtime & Notifications §1](../01-architecture/08-realtime-and-notifications.md) explicitly refuses. |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| My groups | `/(tabs)/groups` | The user's own groups; the only place a groups-of-a-user list exists |
| Group directory | `/(tabs)/groups/discover` | Listed groups in the user's `city_label` |
| Group home | `/(modals)/group/[groupId]` | Board, pinned posts, upcoming events |
| Roster | `/(modals)/group/[groupId]/members` | Reduced member cards, alphabetical |
| Post detail | `/(modals)/group/[groupId]/post/[postId]` | Body, author card, report action |
| Event detail | `/(modals)/group/[groupId]/event/[postId]` | Spot, hours, accessibility, RSVP |
| Compose | `/(modals)/group/[groupId]/compose` | Title, body, event toggle for moderators |
| Join disclosure | `/(modals)/group/[groupId]/join` | R16's consent screen |
| Group settings | `/(modals)/group/[groupId]/settings` | Metadata, join policy, moderators, R41 copy |
| Join requests | `/(modals)/group/[groupId]/requests` | Moderator approve/decline queue |
| Partner console | `/(modals)/partner/[orgId]` | Spot list, hours editor, suspend |

The roster is deliberately the **third** thing on the group home screen, below the board and the events. A group whose first screen is a list of people is a people-browser, and the information architecture is part of the enforcement of §5.7.

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | Group home renders the group header (name, city, member-count bucket) from the directory cache immediately; the board shows three skeleton rows. The roster is never prefetched — it is fetched only when its tab is opened, so a background prefetch cannot become a bulk-read path. |
| Empty | Three distinct empties. **No groups joined:** the directory is offered with the disclosure summary, plus "Start one" — never an auto-suggested group based on proximity, because a proximity-suggested group is a location inference presented as a recommendation. **Empty board:** "Nothing posted yet" plus a compose prompt for members and nothing for lurkers. **Empty directory for a city:** "No groups near {city} yet" plus "Start one", with no fallback to a wider radius; silently widening the search would show a user groups from a city they did not ask about. |
| Error (recoverable) | Board fetch 5xx: the cached board stays with a thin banner and Retry. A failed post keeps the composed text and offers Retry; text is never lost. A failed RSVP reverts the control visibly. |
| Error (terminal) | Four cases, each with distinct copy (§8.3): membership revoked mid-session; group archived; group placed `under_review` by the platform; the user was blocked by the group owner. Each returns to `/groups` with an explanatory card. None of them says who did it. |
| Offline | Board, roster, and event details read from cache with a "last updated" line. Composing is queued as an offline mutation keyed on the client-generated `p_id`, with a pending indicator, exactly like a message ([SPEC-011 R19](SPEC-011-messaging.md)). RSVP is **not** queued: an RSVP that silently lands three hours late misinforms a group about who is coming. Joining and reviewing join requests are not queued — both are consent operations and both must fail honestly. |
| Permission denied | Two meanings, both handled. **Group permission:** a member viewing a moderator-only control sees it absent, not disabled — a greyed-out "Remove post" tells a user the group has powers they do not have and invites social pressure on whoever does. **Notification permission:** group notifications are off; the board and inbox are unaffected, and one dismissible line appears in group settings. |
| Rate limited | Compose disabled with a countdown ("You've posted a lot today. You can post again in {mm:ss}."). Invite limit and join-request limit each show their own quota copy. No composed text is discarded in any case. |

### 8.3 Copy

Exact strings.

**Join disclosure (R16) — the whole screen, verbatim**
> **Before you join {group_name}**
>
> **Other members will see** your name, your handle, your photo, your verification badge, and the town on your profile. That's it.
>
> **They won't see** where your garden is, your address, your ratings, or how many exchanges you've done.
>
> **They can't message you.** Messaging only opens when one of you accepts an exchange request.
>
> **Posts in this group aren't private.** Sharecropr's safety team can read anything posted here, and every time they do it's recorded.
>
> **You can leave at any time**, and you'll disappear from the member list straight away.
>
> Buttons: `Not now` · `Join group`

**Group settings, moderation disclosure (R41) — always visible, not behind a disclosure triangle**
> Anything posted in this group can be read by Sharecropr's safety team. Group moderators can remove posts here; only Sharecropr can act on an account.

**Directory row**
> {name} · {kind_label} · {city_label} · {member_bucket}

**Member-count buckets**
> Under 10 members · 10–49 members · 50–199 members · 200+ members

**Directory empty**
> **No groups near {city_label} yet.**
> Groups are how a garden club or a street brings its trades here.
>
> Button: `Start a group`

**Board empty, member**
> **Nothing posted yet.**
> Seedlings going spare? A glut of something? Say so here.

**Board empty, non-member preview**
> Posts are visible to members.

**Join request sent**
> Request sent. A moderator will take a look.

**Join request declined (to the requester)**
> {group_name} isn't taking new members right now.
> *(Deliberately gives no reason and does not name a moderator — a named decline is a grievance with an address.)*

**Removed from a group (to the removed member)**
> You're no longer a member of {group_name}.
> *(No reason, no actor. Same rationale as the block copy in [SPEC-011](SPEC-011-messaging.md).)*

**Left a group**
> You've left {group_name}. Your posts stay, shown as "Former member".

**Post removed by group moderator (to everyone)**
> Removed by a group moderator.

**Post removed by platform (to everyone, including group moderators)**
> Removed by Sharecropr.
> *(A group moderator sees exactly this and no restore control. R43.)*

**Group under review (to all group roles)**
> **{group_name} is under review.**
> You can read the board, but posting is paused while Sharecropr's safety team looks at a report.

**Group archived**
> This group has been archived. You can still read what's here.

**Report a post**
> Report post → "Thanks. Our team will review this within 24 hours."
> *(Identical to [SPEC-011](SPEC-011-messaging.md)'s copy, deliberately — reporting must feel the same everywhere.)*

**Report routing note, shown under the report options**
> Reports go to Sharecropr, not to this group's moderators.

**Event card**
> {title} · {safe_spot_name} · {weekday} {time}

**Event detail, venue line**
> {safe_spot_name}, {address_line}. Open {hours_today}. {accessibility_note}

**Event detail, the sentence that has to be there**
> Trades at a swap are still between two people. Confirm each one in the app so it counts.

**RSVP control**
> Going · Maybe · Can't make it

**Compose rate limited**
> You've posted a lot today. You can post again in {mm:ss}.

**Invite limit**
> You've sent 20 invites today. You can send more tomorrow.

**Invite by code**
> Share this code with someone you know: **{code}**. It works once and expires in 14 days.

**Group full**
> {group_name} is at its 500-member limit.

**Too many groups**
> You're in 10 groups, which is the maximum. Leave one to join another.

**Partner console, hours saved**
> Hours updated. Everyone will see "confirmed by {org_name} today".

**Partner console, suspend confirmation**
> **Take {spot_name} off the map?**
> It stops appearing immediately, and anyone with an exchange booked there will be asked to pick somewhere else. You can put it back at any time.
>
> Buttons: `Cancel` · `Take it off`

**Partner console, forbidden field**
> Address, category, and location can only be changed by Sharecropr. Email us and we'll sort it.

**Roster accessibility label**
> {display_name}, {handle}. {trust_tier_label}. {role_label}. Member since {month} {year}.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| **What is the worst thing an attacker could do with this feature?** | **Use groups to build a location and social graph on people who never transacted with them.** The attack has three stages and the design blocks each one separately. *Stage one — get a roster:* create or join listed groups and harvest member lists. Blocked by `join_policy` having no open option (R06), by 10-groups-per-user (R04), by the roster being active-members-only, alphabetical, unsortable, unexportable, and rate limited to 30 reads/hour (R59), and by the reduced card carrying no reputation or location field beyond `city_label` (R58). *Stage two — correlate:* intersect the rosters of several catchment-bounded groups to narrow a target's neighbourhood far below `city_label`. This is the real threat, and it is blocked by R60: there is no user → groups lookup for anyone but the user themselves, so the attacker can only intersect rosters they can *both* obtain, which R04 and R06 bound to a handful of groups they were individually admitted to by a human. *Stage three — contact:* message the target. Structurally impossible; R61 and [SPEC-011 R01](SPEC-011-messaging.md) mean no code path in this spec creates a thread, and the join-request note is the only free text that reaches a stranger — capped at 200 characters, moderator-only, and content-scanned (§7.2). The second-worst outcome is **the board becoming an unmoderated broadcast surface**: 500 recipients, no per-recipient consent, and the platform's name on it. That is why R27 scans every post, R40 gives platform moderators unscoped audited read, and R47 surfaces high-report groups for human review. The third is a **partner-admin compromise** — a stolen librarian account editing a venue's hours to send people to a closed building, or worse, moving a pin. R50 makes `point` and `address_line` unwritable by any partner, so the blast radius of that compromise is bad hours and a suspended spot, both same-day reversible and both audited (R53). |
| **Which RLS policies enforce access?** | `groups_select_visible` (member OR listed-and-active OR moderator), `groups_update_owner_or_mod`, `group_members_select_fellow`, `group_members_update_moderator`, `group_posts_select_member` (active member AND not removed AND not blocked, OR `app.is_moderator()`), `group_posts_insert_member` (author is caller AND active member AND group active AND events restricted to moderators), `group_posts_update_author_or_mod`, `group_event_rsvps_select_member`, `partner_orgs_select_public`, `partner_org_admins_select_self`, and `safe_spots_partner_update`. Definer functions: `app.is_group_member`, `app.is_group_moderator`, `app.group_role`, `app.is_partner_admin_for_spot`, `app.is_blocked_either_way`, `app.can_transact`, `app.is_moderator`, `app.enqueue_notification`, `app.consume_token`, plus `public.create_group`, `public.request_group_join`, `public.review_group_join`, `public.invite_to_group`, `public.set_group_member_role`, `public.remove_group_member`, `public.create_group_post`, `public.remove_group_post`, `public.rsvp_group_event`, `public.partner_update_safe_spot`, and `public.partner_suspend_safe_spot`. Every one bypasses RLS and therefore re-checks authorization as its first statement ([RLS Design §7](../01-architecture/05-rls-design.md)). **What is absent is load-bearing:** there is no DELETE policy on any table in this spec, no INSERT policy on `groups` (creation is RPC-only so `city_label` is server-derived), and no policy anywhere that lets a client read `group_members` rows for a user in a group the caller is not in. |
| **Can any response path expose an exact coordinate or PII?** | Only `safe_spots.point`, through a group's `home_safe_spot_id` and an event's venue — an exact coordinate of a public building, already on the two-entry CI coordinate allowlist (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)). **How this feature preserves the location invariant:** (1) `groups` has no geography, geometry, `*_cell`, `lat`, or `lng` column, by construction and by CI sweep; (2) the only spatial anchor a group has is a safe spot, which is public; (3) `city_label` is derived server-side from that safe spot's locality, so no client-supplied place string ever enters the schema; (4) the roster is a `security_invoker` view whose select list contains no location column finer than `city_label`, so widening it requires a migration and a review rather than an edit to a query (R58); (5) no function in this spec is added to the [LP-02](../01-architecture/04-location-privacy.md) definer allowlist and none reads `private.garden_locations`; (6) event RSVP counts stay inside the group (R62), because a public "eleven people at this library at 10 a.m." is a schedule of a place and a time; (7) notification templates for group events interpolate a group name, a post title, and a safe-spot name and nothing else (R63). `group_posts.body` is user-authored free text and could contain anything the author chose to type, including their own address — we cannot prevent that, `content-scan` detects it (R27), and it is never logged. |
| **What is logged, and is it scrubbed?** | Group ids, post ids, member counts, role changes, and moderation decisions are logged and audited. **Post bodies, post titles, and join-request notes are never logged and never sent to Sentry or PostHog** — the telemetry scrubber's existing drop list (`body`, `message`, `text`) is extended with `title` and `note` for these events. Every platform-moderator read of a group post writes `audit.events` with the group, the post, and the moderator (R40); a read with no correlating report or flag is not an error but *is* reported weekly, because unscoped access that nobody reviews becomes unscoped access nobody notices. Every partner write writes `audit.events` with the changed keys (R53). |
| **Does this need step-up authentication?** | Yes, in one place: **granting or revoking a `partner_org_admins` row requires AAL2** ([SPEC-002](SPEC-002-two-factor-auth.md)), because that grant confers write access to map data that thousands of users navigate to physically. Ordinary group operations — joining, posting, moderating a board — do not, and requiring a TOTP code to pin a post would be friction with no matching threat ([API Contract §2.4](../01-architecture/06-api-contract.md)). |
| **Abuse / rate-limit controls** | Group creation 3/day and 3 owned (R04); membership 10 groups (R04) and 500 members (R05); invites 20/day/moderator with codes single-use and 14-day-expiring (R17); posts 10/group/day and 30/user/day (R29); join requests 20/day; roster reads 30/hour (R59); partner writes 60/day/admin; `content-scan` on every post and note (R27); report-rate signal at 5× median (R47); `app.can_transact()` on group creation (R03); platform suspension removes a user from every group surface at once (R21). |

**Threat notes.**

- **The group moderator is the new insider.** MVP has one privileged role (platform moderator) with a JWT claim and an audit trail. This spec introduces thousands of semi-privileged users who can remove content and revoke membership. R42's explicit denial list, R44's report routing that bypasses them entirely, and R43's platform-wins rule exist because a moderation hierarchy without a stated tiebreak is resolved in production by whoever wrote the last endpoint.
- **Invite codes are a spam vector.** A shareable code posted publicly turns a `request_to_join` group into an open one. The 14-day expiry, single use, and 20/day cap bound it; the residual is accepted and monitored via `group.invite_code_redeemed` (§11).
- **Off-platform migration.** Group boards are exactly where "we're moving this to WhatsApp" happens, which routes exchanges away from safe spots and away from every safety control we have. The new `content-scan` category (§7.8) is a measurement instrument for [R-09](../06-roadmap/02-open-risks.md) as much as a moderation one, in the same spirit as [SPEC-011 §5.4](SPEC-011-messaging.md).
- **Enumeration.** A guessed `group_id` on a non-listed group returns an empty set; a guessed `post_id` returns an empty set. Neither is a 403, so there is no existence oracle.

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | Group owner deletes their account while the group has 40 members. | R09: the longest-serving `moderator` is promoted to `owner` in the deletion pipeline's transaction. With no moderator, the group is archived (R10) and members are told it was archived, not why. Posts survive for any open report. |
| EC-02 | A member is platform-suspended mid-session while viewing the board. | R21: their next read returns the terminal "no longer a member" card; simultaneously they vanish from the roster and their posts render as authored by a suspended account (hidden), all without any group moderator being notified. Suspension is never announced ([SPEC-012](SPEC-012-trust-and-safety.md)). |
| EC-03 | A group moderator removes a post that is the subject of an open platform report. | The post is hidden from the board and **retained** in full for the report (R46). The report is untouched, its SLA still runs, and the moderation console shows the post with a "removed by group" marker so the reviewer knows what the group already did. |
| EC-04 | A platform moderator removes a post; the group owner tries to restore it. | No restore control is rendered, and the RPC rejects it: `removed_by_platform_at IS NOT NULL` is checked in `remove_group_post`'s inverse path and in a `CHECK`-backed guard trigger. Copy is "Removed by Sharecropr" for everyone (R43). |
| EC-05 | Two moderators approve the same join request simultaneously. | The `(group_id, user_id)` primary key plus a `FOR UPDATE` on the row serializes them. One transitions the state; the other returns the resulting state as a success. `member_count` is maintained by trigger, so it cannot double-increment. |
| EC-06 | Approving the 501st member. | `quota_exceeded` 422 from the count check inside the transaction, not from a client-side count. The moderator sees "Group is at its 500-member limit" and the request stays pending rather than being silently dropped. |
| EC-07 | A user blocks a group moderator they are in a group with. | R20: they stop seeing each other's posts and roster entries in that group, in both directions. The moderator retains their moderator powers over the group generally, but the block means the blocked pair's content is not in each other's result set — and the blocked party is never told ([RLS Design §6](../01-architecture/05-rls-design.md)). This is the one place where a group moderator can be "moderating" content they cannot see, and it is the correct trade: block enforcement outranks moderator convenience. |
| EC-08 | An event's safe spot is suspended by its partner admin two hours before the event. | The event card flips to "Venue unavailable" with the spot's name, an in-app notification goes to everyone who RSVP'd `going`, and the event is not auto-rescheduled — we do not know where else they would want to meet. Any `exchange_sessions` at that spot follow [SPEC-007](SPEC-007-safe-spots.md)'s existing rescheduling path independently. |
| EC-09 | A partner admin attempts to move a spot 400 m to "the correct entrance". | `forbidden_field` 422 (R50) with the copy directing them to email. This is the request that will be made most often and refusing it is correct: a client-writable `point` on a safe spot is a client-writable coordinate on the map everyone navigates to. |
| EC-10 | A partner org's status is set to `terminated` while it administers 6 spots. | `app.is_partner_admin_for_spot()` returns false immediately (it joins on `status = 'active'`), so all editing stops within one query. The spots themselves are **not** suspended — the venue agreement ending is not the same as the venue being unsafe — and staff triage them per [SPEC-007](SPEC-007-safe-spots.md). |
| EC-11 | A user posts, then leaves the group 30 seconds later. | The post remains, attributed to "Former member" (R19). It is not deleted, because a departing user deleting a thread of context is exactly how a harassment record disappears. |
| EC-12 | A user is invited by code, redeems it, and is already `removed` from that group. | The redemption fails with `conflict`. R18's retention of the `removed` row is what makes this checkable; a hard-deleted membership row would let a removed user walk back in through any code. |
| EC-13 | `content-scan` is down for two hours while a group posts 300 times. | Posts publish normally with `scan_state = 'pending'` (R28) — scanning never blocks delivery — the backlog drains on recovery, and the existing 500-row backlog alert fires. |
| EC-14 | A group's report rate hits 12× the platform median. | R47: a console signal for a human, and nothing else. No auto-archive, no auto-suspension, no rate-limit change. A brigade against a group is the same attack as a brigade against a person, and [SPEC-012](SPEC-012-trust-and-safety.md) already refuses to automate the response to it. |
| EC-15 | A user joins 10 groups whose catchments all overlap one neighbourhood. | Permitted, and it reveals nothing to anyone: R60 means no other user can see the intersection, because no other user can enumerate the groups this person belongs to. The user themselves already knows where they live. |
| EC-16 | A group is placed `under_review` while a moderator is composing a post. | The post submit returns `group_read_only` 409, the composed text is preserved locally, and the group home shows the under-review card to every role including the owner (R43). |
| EC-17 | An event is created for a time when the safe spot is closed. | The compose form warns from `safe_spots.hours` but does not block — hours data is imperfect and a library may open specially for a club. The event detail always renders today's hours (R39) so attendees can judge for themselves. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `group.created` | product event | `kind`, `join_policy`, `is_listed`, `has_partner_org` | — |
| `group.join_requested` / `group.join_reviewed` | product event | `decision`, `hours_to_decision` | p50 decision time > 72 h ⇒ groups are a dead end for newcomers |
| `group.member_count` | gauge | bucketed distribution | Any group at 500 ⇒ review R05 |
| `group.post_created` | product event | `kind`, `char_bucket`, `is_pinned` — **never `title` or `body`** | — |
| `group.board_dau_ratio` | gauge | members who read the board weekly ÷ active members | < 15% ⇒ the board is decorative and the group is a roster with extra steps |
| `group.post_scan_flag` | product event | `flagged_reason` | Flag rate > 8% of posts; **off-platform-coordination rate > 3%** escalates to [R-09](../06-roadmap/02-open-risks.md) |
| `group.report_rate` | gauge | reports per 1,000 posts, per group and platform-wide | Any group > 5× median (R47) ⇒ console signal |
| `group.moderator_removal` | audit | `group_id`, `actor_id`, `post_id`, `scope` | Removals > 10% of posts in a group ⇒ human review of that group's moderation |
| `group.platform_read` | audit | `moderator_id`, `group_id`, `post_id`, `report_id` (nullable) | **Weekly review of every read with a null `report_id`.** R40 grants unscoped read; this is the compensating control |
| `group.invite_code_redeemed` | product event | `days_to_redemption`, `redeemer_is_new_account` | > 40% redemptions by accounts under 24 h old ⇒ codes are being posted publicly |
| `group.left_within_7d` | counter | joins followed by a leave in 7 days | > 25% ⇒ the join disclosure is over-promising or groups are being misrepresented |
| `group.event_created` / `group.event_rsvp` | product event | `lead_time_hours`, `response` | — |
| **`group.event_to_exchange`** | funnel | `exchange_sessions` created between co-attendees within 48 h of an event | The measurement behind [Q3](#15-open-questions). Near zero ⇒ swap meets produce no recorded trust and R35's honest limitation is a real hole |
| `partner.spot_hours_updated` | audit | `org_id`, `spot_id`, `changed_keys` | — |
| `partner.hours_freshness` | gauge | median days since `hours_verified_at`, partner vs. staff-maintained | **The number that justifies partner orgs.** Partner-maintained median worse than staff-maintained ⇒ the coverage-scaling thesis is wrong |
| `partner.spot_suspended` | audit | `org_id`, `spot_id`, `sessions_affected` | Any suspension with > 3 affected sessions pages ops |
| `partner.forbidden_field_attempt` | counter | `field` | Rising ⇒ the console UI is inviting an edit we refuse; fix the UI, not the rule |

**Never emitted:** a post body or title, a join-request note, a member list, a group's roster size alongside any individual identity, or any spatial value about a member.

## 12. Accessibility

- The board is a list with real headings per pinned/recent section, navigable by heading rotor. Pinned status is announced in the row label ("Pinned. {title}"), never conveyed by an icon alone.
- Each post row is **one** accessible element: author, relative time, title, and a body preview — not four separate stops.
- The roster is alphabetical with section index headings, and each row is one element with the composed label in §8.3. Role is announced as a word ("Moderator"), never as a coloured chip.
- The join disclosure (R16) is a scrollable region with headings per paragraph, and the `Join group` button is **not** enabled until the region has been scrolled to its end — a consent screen that can be accepted without reaching the bottom is not consent. The scroll requirement is announced ("Scroll to the end to continue"), and the control is reachable with an external keyboard and a switch control.
- Event times are announced with weekday, date, and time zone in words; durations as "two hours", never as a bar.
- RSVP is a labelled radio group with `accessibilityState={{ checked }}`, not a segmented control with icon-only options.
- Moderator-only controls are **absent** rather than disabled for non-moderators (§8.2), which also removes them from the screen-reader traversal order rather than announcing "dimmed" affordances a user cannot act on.
- The partner hours editor is a per-day list of labelled time fields with explicit open/closed toggles, not a free-text field and not a grid. Hours are the most consequential data a partner touches and the input must be unambiguous at 200% type.
- Dynamic type to 200% throughout, with post titles wrapping to three lines rather than truncating.
- Reduced motion: the group-home tab transition is an instant swap; no pinned-post carousel and no auto-advancing anything.
- Minimum 44 × 44 dp on every row, RSVP option, moderator action, and the join and leave buttons.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01 | Schema introspection: `groups` has no `geography`, `geometry`, `*_cell`, `lat`, or `lng` column; grep asserts none is added |
| T02 | integration | R02 | Group creation with a non-`active` safe spot is rejected; `city_label` is derived from the spot, not from the request |
| T03 | rls | R03 | A user failing `app.can_transact()` cannot create a group |
| T04 | integration | R04 | 4th owned group and 11th membership both return `quota_exceeded` |
| T05 | integration | R05 | 501st approval returns `quota_exceeded`; `member_count` never exceeds 500 |
| T06 | integration | R06 | No code path sets a join policy outside the two-value enum; an `invite_only` group rejects `request_group_join` |
| T07 | rls | R07 | An unlisted group is absent from the directory and readable by members |
| T08 | integration | R08 | Directory response contains no member identity and cannot be ordered by any member-derived field; counts are bucketed |
| T09 | integration | R09 | Owner account deletion promotes the longest-serving moderator; with none, the group archives |
| T10 | integration | R10 | Archiving makes the group read-only and leaves posts intact and report-attachable |
| T11 | rls | R12, R13 | Each of the six member states: only `active` reads the roster and the board |
| T12 | integration | R14, R15 | Requests need moderator approval; an invite never auto-joins |
| T13 | e2e | R16 | The disclosure screen cannot be bypassed; `Join group` is disabled until the region is fully scrolled |
| T14 | integration | R17 | Invites accept a handle or generate a code; 21st invite in a day is refused; codes are single-use and expire at 14 days |
| T15 | e2e | R18 | Leaving is one action with no approval; the row is retained as `left` |
| T16 | rls | R19 | A departed member reads nothing; their posts render as "Former member" |
| T17 | rls | R20 | Blocked pair: neither appears in the other's roster, board, or RSVP list, in both directions |
| T18 | rls | R21 | A suspended user disappears from every group surface in one transaction |
| T19 | integration | R23, R24 | Title and body boundaries; a post with an image reference or attachment field is rejected — no such column exists |
| T20 | rls | R25 | Non-member insert denied; active member insert succeeds |
| T21 | integration | R26 | Edit at 14:59 succeeds, at 15:01 is denied; author delete leaves the row with `removal_scope = 'author'` |
| T22 | integration | R27, R28 | Every post is enqueued for `content-scan`; a flagged post is delivered unmodified and its `flagged_reason` is invisible to members |
| T23 | integration | R29 | 11th post in a group and 31st across groups both return `rate_limited` with `Retry-After` |
| T24 | integration | R30 | Keyset pagination over 500 posts: no duplicates, no gaps, pinned posts first |
| T25 | integration | R31 | 4th pin is refused |
| T26 | integration | R33, R34 | Event without a spot, with a 9-hour duration, or at a non-`active` spot is rejected; no free-text venue parameter exists |
| T27 | integration | R35 | Creating an event creates zero `exchange_sessions` rows and zero `ratings` rows |
| T28 | rls | R36 | RSVP list is invisible to non-members and carries only reduced cards |
| T29 | integration | R37 | A plain member cannot create an `event` post |
| T30 | integration | R38 | Event creation and the 24 h reminder produce at most two pushes; both are suppressible |
| T31 | e2e | R39 | Event detail renders hours, accessibility, and parking notes from the spot |
| T32 | rls | R40 | A platform moderator reads a group post with no report and no flag — permitted — **and** an `audit.events` row is asserted to exist |
| T33 | e2e | R41 | The moderation disclosure is present on the join screen and in group settings, not behind a disclosure control |
| T34 | rls | R42 | A group moderator cannot read `trust_score`, cannot read reports about members, and cannot see reporter identity |
| T35 | integration | R43 | Platform removal is not restorable by owner or moderator; a suspended user cannot be re-admitted; `under_review` makes the group read-only for the owner |
| T36 | integration | R44 | A report on a post creates a platform report and produces **no** notification, row, or console entry visible to any group moderator |
| T37 | integration | R45 | `subject_type` accepts `group_post` and `group`; the report carries 10 posts of context |
| T38 | integration | R46 | Group removal leaves the platform report open with its SLA running |
| T39 | integration | R47 | A group at 6× median report rate raises a console signal and triggers no automated action |
| T40 | integration | R48 | `partner_orgs` cannot reach `active` without `consent_ref` and `consent_at` — enforced by CHECK |
| T41 | integration | R49 | A partner edit to `hours` sets `hours_verified_at`; edits to the five other permitted fields succeed |
| T42 | integration | R50 | Each forbidden field individually returns `forbidden_field` 422; `status = 'active'` is refused |
| T43 | e2e | R51 | Partner suspension removes the spot immediately and triggers the reschedule path for a booked session |
| T44 | integration | R52 | A partner-created spot lands in `proposed` and is invisible on the map |
| T45 | integration | R53 | Every partner write produces an `audit.events` row naming the changed keys |
| T46 | rls | R54 | Revoking `partner_org_admins` stops editing on the next query, with no token refresh |
| T47 | integration | R55 | Promoting a group moderator grants no safe-spot capability |
| T48 | integration | R57, R58 | The `group_member_cards` view's column list is asserted exactly; adding a column fails the test |
| T49 | integration | R59 | Roster is unsortable and unfilterable by any reputation field; 31st read in an hour is rate limited; no export endpoint exists |
| T50 | rls | R60 | `GET /group_members?user_id=eq.<other user>` returns only rows for groups the caller is an active member of — never a list of that user's groups |
| T51 | e2e | R61 | No message affordance exists on any group surface; no group RPC creates a `message_threads` row (asserted by a table-level row count across the whole e2e run) |
| T52 | rls | R62 | RSVP counts are absent from the directory response and from any non-member path |
| T53 | integration | R63 | Group notification templates render with only group name, post title, and safe-spot name; a template with any other placeholder fails the contract test |
| T54 | perf | R30, R59 | Board and roster p95 under 50 ms at 10× projected volume with the policy predicates indexed ([RLS Design §8](../01-architecture/05-rls-design.md)) |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T55 | Non-member `GET /group_posts?group_id=eq.<real id>` | Empty set — no 403, no existence oracle |
| T56 | `GET /group_posts?group_id=eq.<random uuid>` | Empty set, indistinguishable from T55 |
| T57 | `invite_to_group` with an email address or a phone number in `p_handle` | `validation_failed`; the signature has no email or phone parameter, asserted by function introspection (R17) |
| T58 | Enumerate a target's group memberships via `group_members`, `group_member_cards`, `profile_cards`, and every RPC in §7 | Zero rows in every case. R60's anti-correlation control asserted against **all** read paths, not just the obvious one |
| T59 | Join 6 listed groups with overlapping catchments and attempt to derive a target's neighbourhood | The only shared fact obtainable is `city_label`, which `profile_cards` already exposes. The test asserts the derived information set is unchanged from before joining |
| T60 | `POST /rest/v1/groups` directly with a chosen `city_label` and a `home_safe_spot_id` in another city | Denied — no INSERT policy on `groups`; creation is RPC-only and derives `city_label` server-side |
| T61 | `PATCH /rest/v1/group_members` setting own `role = 'owner'` | Denied by `group_members_update_moderator`; a second assertion covers setting `state = 'active'` on one's own pending request |
| T62 | `PATCH /rest/v1/safe_spots` as a partner admin, changing `point` | Denied by `guard_partner_spot_update` with 42501; asserted separately for `address_line`, `category`, `partner_org_id`, and `status` |
| T63 | `PATCH /rest/v1/safe_spots` as a partner admin, on a spot belonging to **another** org | `app.is_partner_admin_for_spot()` false; policy denies; zero rows updated |
| T64 | Partner admin with a revoked row (`revoked_at` set) attempts an edit | Denied immediately — the check is a table read, not a JWT claim (R54) |
| T65 | Grant a `partner_org_admins` row without AAL2 | Rejected at the RPC's step-up check ([SPEC-002](SPEC-002-two-factor-auth.md)) |
| T66 | Group moderator attempts to read `profiles.trust_score` for a member | 42501 — column `REVOKE` is role-wide and a group role grants nothing on `profiles` ([SPEC-012 R48](SPEC-012-trust-and-safety.md)) |
| T67 | Group moderator queries `reports` for their group's posts | Empty set — `reports_select_own` gives them only reports they filed (R42, R44) |
| T68 | Group owner attempts to restore a platform-removed post via a direct PATCH | Denied by the guard trigger; `removed_by_platform_at` cannot be nulled by any client role (R43) |
| T69 | Platform moderator reads 200 group posts across 40 groups in an hour | Permitted (R40) **and** 200 `audit.events` rows exist; the weekly unscoped-read review surfaces the burst (§11) |
| T70 | Suspended user posts to a group they were active in | `suspended` 403; no row created; no group moderator notified |
| T71 | Blocked user reads the roster containing their blocker | Blocker absent from the result set — filtered in the view predicate, not client-side (R20) |
| T72 | XSS payload in a post title and body, rendered in the app and in the moderation console | Escaped; rendered as text in both; console never renders HTML ([SPEC-011 T40](SPEC-011-messaging.md)) |
| T73 | SQL injection payload in `p_note` on a join request | Stored and rendered as literal text; parameterized throughout |
| T74 | 2,000-character body and a 101-character title via a raw HTTP client | `validation_failed`; CHECK constraints enforce at the database, not in the client |
| T75 | Replay `create_group_post` with the same client-generated id 50 times | Exactly one row; 50 successful responses |
| T76 | Redeem an invite code twice, and redeem an expired one | `conflict` and `expired` respectively; single-use enforced by a partial unique index, not by a read-then-write |
| T77 | Contract sweep for coordinate columns across `groups`, `group_members`, `group_posts`, `group_event_rsvps`, `group_member_cards`, `partner_orgs`, and all eleven RPC return types | Only `safe_spots.point`, already allowlisted (API-04, [API Contract §9.1](../01-architecture/06-api-contract.md)) |
| T78 | Fire a synthetic Sentry event carrying a post body, a post title, and a join note | All three scrubbed from the payload |
| T79 | Delete an account that owns 2 groups, moderates 1, and has 300 posts | Ownership transfers or archives (R09); posts become "Former member" with `author_id` nulled; `group_members` rows are removed; no group is left ownerless and no board is holed |
| T80 | Attempt to create a `message_threads` row from any group RPC, by any parameter combination | Zero threads created across the full negative suite (R61) |

### 13.3 Manual QA

- [ ] Read the join disclosure as a first-time user and confirm every claim in it is true of the built product, line by line.
- [ ] Confirm there is no way to message a member from any group screen, including via long-press, deep link, and the accessibility rotor.
- [ ] Confirm a group moderator cannot tell, by any means, that a post was reported.
- [ ] Have a platform moderator remove a post and confirm the group owner sees no restore control and the neutral copy.
- [ ] Suspend a member and confirm they vanish from the roster, the board, and an RSVP list simultaneously.
- [ ] Block a group moderator and confirm mutual invisibility inside the group, in both directions.
- [ ] Walk a real librarian through the partner console cold and see whether they update hours without help. If they need help, the console is wrong.
- [ ] Suspend a real spot from the partner console during a scheduled exchange on staging and confirm the reschedule path fires.
- [ ] VoiceOver and TalkBack over the disclosure screen, the board, the roster, and the hours editor at 200% type.
- [ ] Try, deliberately and creatively, to enumerate which groups a specific user belongs to. Record every attempt in the PR.

## 14. Rollout

| Field | Value |
| --- | --- |
| Status | **Not built.** Phase 2, Approved, specified only. `groups`, `group_members`, `group_posts`, and `partner_orgs` ship as empty stubs in MVP ([Data Model §13](../01-architecture/03-data-model.md#13-future-feature-stubs)). |
| Feature flag | Three, independently switchable. `groups.enabled` gates every group surface and RPC. `groups.events_enabled` gates event posts and RSVPs, which are the highest-risk sub-feature (a real-world gathering announced by us). `partner.console_enabled` gates the partner console and the `safe_spots_partner_update` policy — flipping it off must revoke partner write capability, so the policy checks the flag through `app.setting()`, not only the client. |
| Migration required | Yes — `20261115_0095_community_groups.sql`: seven enums, four table bodies over the MVP stubs, three new tables, one private table, one view, four helper functions, eleven RPCs, sixteen policies, and one **`reports.subject_type` CHECK replacement** (R45). The CHECK swap is a `DROP CONSTRAINT` + `ADD CONSTRAINT` on an existing table, which [Data Model §15.3](../01-architecture/03-data-model.md#15-migration-rules) treats as destructive and gates on the DAU floor — it is safe here because the new values are additive and no existing row can violate the widened constraint, but the CI gate will still fire. See [Q7](#15-open-questions). |
| Backfill required | No user data. One operational backfill: `partner_orgs` rows and signed consent references for the venues already curated under [SPEC-007](SPEC-007-safe-spots.md) that want to self-administer. That is venue-relations work with a lead time measured in weeks, and it gates the coverage benefit rather than the code. |
| Rollback plan | `groups.enabled` off hides every group surface and makes the RPCs return `feature_disabled`; rows are retained and no membership is lost. `groups.events_enabled` off hides events and RSVPs and leaves the board. `partner.console_enabled` off returns safe-spot maintenance to staff, which is the MVP status quo and therefore a safe place to land. The migration is forward-only ([Data Model §15](../01-architecture/03-data-model.md#15-migration-rules)); a bad policy is fixed by a new migration, never by a restore. |
| Client version floor | The Phase 2 minimum client. An older client without the groups tab is unaffected. |
| **Staffing precondition** | Group posts are a new broadcast moderation surface (R40, R47). This feature **must not ship** until the moderation console supports a group-post queue ([SPEC-900](SPEC-900-moderation-console.md)) and the trust-and-safety rota has capacity for it at projected volume. That is a rollout gate, not a nice-to-have: shipping a 500-person publishing surface into a queue sized for two-person threads is how a small product acquires a large incident. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Is 500 the right member cap? Above it a roster is a directory and §5.7's guarantees weaken; below it a real neighbourhood association does not fit. A city-wide club with 900 members will ask on week one. | Product + Security | Before build |
| Q2 | Should a group be able to require a trust tier to join ("id_verified members only")? It is what clubs will ask for and it makes tier a gate rather than an explanation, which [SPEC-012 R52](SPEC-012-trust-and-safety.md) deliberately avoids everywhere else. | Product + Trust & Safety | Before build |
| Q3 | Swap meets produce no `exchange_sessions`, therefore no ratings and no trust movement (R35, and `group.event_to_exchange` in §11). Do we accept that the most social feature is invisible to the trust system, or do we design a two-party check-in that does not become a trust-farming machine? [SPEC-022](SPEC-022-gamification.md) has a direct stake in the answer. | Product + Trust & Safety | After the first events ship |
| Q4 | Who is liable for what happens at a group event? Sharecropr announces a time and a place at a third-party venue and does not attend. This is closer to a liability question than the rest of the product and it needs the same counsel that [SPEC-023](SPEC-023-crop-id-and-food-safety.md) needs, before code rather than after. | Legal + Product | Before `groups.events_enabled` |
| Q5 | Should partner orgs be able to see aggregate usage of their own spots ("42 exchanges here last month")? It is the number that makes a library want to stay, and it is a count of physical meetings at a specific place, which is one aggregation step away from a pattern-of-life signal. | Product + Security | Post-launch |
| Q6 | [RLS-4](../01-architecture/05-rls-design.md) forbids a policy calling a function that queries the same table, but both `threads_select_participant` (MVP, shipped) and `group_members_select_fellow` (this spec) do exactly that and are safe because the helper is `SECURITY DEFINER` under a `BYPASSRLS` owner. The rule needs restating or every future table copies a pattern the architecture document says is forbidden. | Architecture | Before this migration merges |
| Q7 | [Data Model §15.3](../01-architecture/03-data-model.md#15-migration-rules) gates every constraint replacement on the DAU floor, but widening a CHECK to admit new enum values cannot break an old client. Carve-out, or accept the gate? Same question as [SPEC-020 Q6](SPEC-020-harvest-planning.md) from a different direction. | Architecture | Before this migration merges |
| Q8 | Does a group need a way to say "we meet at a place that is not in the safe-spot network" — a village hall, a member's allotment? Refusing is consistent with [ADR-0009](../01-architecture/adr/ADR-0009-safe-spots-only.md) and will be the most common complaint from real clubs, who already have a place they meet. | Product | After the first ten real groups |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product + Trust & Safety | Initial spec |
| 2026-10-22 | 1.0.1 | Product + Trust & Safety | H3 removed; renamed to location tiers per [ADR-0023](../01-architecture/adr/ADR-0023-postgis-location-tiers.md). |
