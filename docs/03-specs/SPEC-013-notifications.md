# SPEC-013: Notifications

| Field | Value |
| --- | --- |
| **Status** | Approved |
| **Version** | 1.0.0 |
| **Owner** | Backend Engineering + Mobile |
| **Phase** | MVP |
| **Security review** | not required |
| **Depends on** | SPEC-001, SPEC-010, SPEC-011, SPEC-012 |
| **Depended on by** | SPEC-004, SPEC-009, SPEC-010, SPEC-011, SPEC-012, SPEC-020, SPEC-900 |
| **Related ADRs** | [ADR-0001](../01-architecture/adr/ADR-0001-mobile-stack.md), [ADR-0004](../01-architecture/adr/ADR-0004-supabase.md), [ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md), [ADR-0012](../01-architecture/adr/ADR-0012-navigation.md) |
| **Last updated** | 2026-08-08 |

---

## 1. Summary

Every notification in Sharecropr is two things that are deliberately not the same thing: a **durable row in `public.notifications`**, written inside the same transaction as the state change that caused it, and a **best-effort push** delivered by Expo to whichever of the user's devices happen to be reachable. The inbox is the record; the push is the doorbell, and on a meaningful share of Android devices the doorbell simply does not ring ([Realtime & Notifications §4.4](../01-architecture/08-realtime-and-notifications.md)). This spec defines the exact catalog of eleven kinds with their templates and deep links, the server-side preference evaluation that decides whether to buzz a phone, the transactional outbox that gets it there, and the contextual permission request that never happens at launch.

## 2. Goals

- Make the inbox the thing that is *correct*, and push the thing that is *timely*, so that a total notification outage degrades the product to "not live" and never to "wrong".
- Publish the whole catalog as one table — kind, trigger, title, body, deep link, default, suppressibility, channel — so that "can this notification leak a location?" is answered by reading eleven rows rather than by auditing every call site.
- Evaluate every preference server-side in `app.should_deliver()`, so that a suppressed notification costs the user a buzz and never a fact, and so that turning a category off actually stops the delivery rather than hiding it after the phone has lit up.
- Make `safety_alert` structurally undisableable — first branch of the function, `CHECK`-protected in the preferences row, `bypassDnd` on the Android channel — while being honest that a user can still mute the OS channel.
- Ask for notification permission at the one moment it is obviously worth granting: immediately after the first exchange request is sent, when the user is waiting for an answer from a human.
- Treat a denied permission as a supported, first-class state rather than a funnel to re-prompt.
- Make delivery observable end to end — outbox depth, tickets, receipts, dead letters — because every failure mode in this area is silent from the user's side and nobody files a bug titled "I didn't get a notification".
- Land every deep link on exactly one route, after the target has been fetched, including from a cold start where the app was not running.

## 3. Non-Goals

- **Notifications as a source of truth.** Nothing may become incorrect because a push was dropped ([Realtime & Notifications §1](../01-architecture/08-realtime-and-notifications.md)). A feature that needs guaranteed delivery to a device is a feature designed wrong, and it will be sent back.
- **Email or SMS notifications.** Email is used by GoTrue for authentication only. SMS is not used anywhere, for the same reason 2FA is TOTP-only ([ADR-0014](../01-architecture/adr/ADR-0014-totp-not-sms.md)), and because a text message about a meeting is a text message on a lock screen next to somebody's name.
- **Rich push: images, actions, reply-from-notification, or notification extensions.** Each adds a platform-specific surface, a payload budget, and a place for user text to appear outside the app. Reply-from-notification in particular sends a message from a context where the sender cannot see the thread they are replying into.
- **Digests, batching windows, or "you have 5 updates".** The collapse keys in §6.3 already stop a listing with five requests producing five buzzes. A daily digest is a feature for an app people do not open.
- **Marketing, growth, re-engagement, or win-back notifications.** There is no `notification_kind` for them, no template row, and no path to add one without an ADR. An app that can push "we miss you" is an app whose safety alerts get muted.
- **Per-notification snooze, per-thread mute, or per-listing mute.** Category toggles plus quiet hours cover the real cases; per-object mute multiplies the preference surface and produces a user who has muted the thread their counterparty is using to say they are running late.
- **Client-side quiet hours or client-side category filtering.** §5.3 is explicit about why: the phone has already lit up by then, the clock is user-controlled, and the check stops working the moment there is a second device.
- **Presence, typing indicators, or "seen" receipts as notifications.** Presence in an app that arranges physical meetings tells a stalker when their target is awake ([Realtime & Notifications §9 Q4](../01-architecture/08-realtime-and-notifications.md)).
- **A notification-preferences import/export or a web preference centre.** Preferences live on one screen in the app.

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **listing owner**, I want to know when someone asks for my tomatoes, so I can answer before they lose interest. | P0 |
| US-02 | As a **requester**, I want to know the moment I'm accepted, because that's when I need to pick a time. | P0 |
| US-03 | As a **person meeting a stranger tomorrow**, I want a reminder two hours before, even if it's inside my quiet hours, because missing it means someone waits at a library for nothing. | P0 |
| US-04 | As a **person whose exchange was just cancelled**, I want to be told immediately, whatever time it is, because I might be about to drive somewhere. | P0 |
| US-05 | As a **user who opens the app once a day**, I want to find every update waiting for me in order, even if my phone dropped every push. | P0 |
| US-06 | As a **user who doesn't want to be woken up**, I want quiet hours that actually work, in my own timezone. | P0 |
| US-07 | As a **user who only cares about exchanges**, I want to turn off everything else without turning off the ones that matter. | P1 |
| US-08 | As a **user**, I don't want to be asked for notification permission before I've done anything. | P0 |
| US-09 | As a **user who said no to notifications**, I want the app to keep working properly and not nag me. | P0 |
| US-10 | As a **user tapping a notification**, I want to land on the actual thing, not on a home screen I then have to navigate from. | P0 |
| US-11 | As a **user tapping a notification about something that's since gone**, I want a clear explanation, not a broken screen. | P0 |
| US-12 | As a **user with a phone and a tablet**, I want one notification's worth of noise, not two. | P1 |
| US-13 | As a **user who reinstalled the app**, I want notifications to keep arriving without doing anything. | P1 |
| US-14 | As a **screen-reader user**, I want the inbox to tell me what's unread and what each item is about in one utterance. | P0 |

## 5. Functional Requirements

### 5.1 The inbox is the record

| ID | Req | Statement |
| --- | --- | --- |
| R01 | **MUST** | Every notification-worthy event MUST write a `public.notifications` row **inside the same transaction** as the state change that caused it, via `app.enqueue_notification` ([Realtime & Notifications §3.1](../01-architecture/08-realtime-and-notifications.md)). No caller may write the row afterwards, from an Edge Function, or from a client. |
| R02 | **MUST NOT** | No feature, screen, state machine, or SLA may depend on push delivery for correctness. Push is best-effort and is documented as such in [PRD C13](../00-foundation/02-prd.md); a design that breaks when a push is dropped is rejected at review, not patched at runtime. |
| R03 | **MUST** | `app.enqueue_notification` MUST insert the `private.notification_outbox` row in the same transaction as the `notifications` row. The intent to notify commits with the state change or not at all — there is no distributed transaction between Postgres and Expo, and no ordering of "send then commit" or "commit then send" that is safe. |
| R04 | **MUST** | Titles, bodies, and deep links MUST come from rows in `private.notification_templates`, never from string concatenation in PL/pgSQL or in an Edge Function. Templates being data is what makes §6.2 reviewable and what makes "can a notification interpolate a location?" a question about a table. |
| R05 | **MUST** | `app.render_template` MUST **raise** on a placeholder with no matching payload key. Rendering `{requester_name} wants your {listing_title}` to a user's lock screen is worse than failing loudly, and a missing key is always a bug in a call site. |
| R06 | **MUST** | `notifications.payload` MUST carry a `CHECK` rejecting the keys `lat`, `lng`, `latitude`, `longitude`, `point`, `coordinates`, `geohash`, `h3_r8`, and `h3_r9`, at any depth ([Data Model §12](../01-architecture/03-data-model.md), LP-11). This is one of the egress controls in [Location Privacy §8](../01-architecture/04-location-privacy.md) and it is asserted by pgTAP on every migration, not by convention. |
| R07 | **MUST** | The inbox MUST be readable at `/notifications`, keyset-paginated on `(created_at DESC, id DESC)`, default 30 and max 100 ([API Contract §3.3](../01-architecture/06-api-contract.md)). Offset pagination MUST NOT be used: the inbox changes under the reader constantly, and offset silently skips and duplicates rows. |
| R08 | **MUST** | `notifications_select_own` MUST be the only read policy (`user_id = (SELECT auth.uid())`), and there MUST be no client `INSERT`, `UPDATE`, or `DELETE` policy. `read_at` is set exclusively by `rpc.mark_notifications_read`. |
| R09 | **MUST** | The unread count MUST be a `Prefer: count=exact` request with a zero-row range ([API Contract §4.9](../01-architecture/06-api-contract.md)), not a fetch of ids the client then counts. |
| R10 | **MUST** | Notification rows MUST be retained per [Data Model §14](../01-architecture/03-data-model.md) and MUST survive the deletion of the object they point at. A notification about a withdrawn listing is still a true statement about something that happened. |
| R11 | **SHOULD** | The inbox SHOULD group by day with relative headers and SHOULD mark an item read on tap, not on scroll-into-view. Read-on-scroll clears a badge for something the user did not look at. |

### 5.2 The catalog

| ID | Req | Statement |
| --- | --- | --- |
| R12 | **MUST** | The catalog in §6.2 is **normative and exhaustive**. Every value of the `notification_kind` enum appears in it exactly once, and a `kind` with no row in `private.notification_templates` MUST fail a CI contract test rather than render a brace. |
| R13 | **MUST** | Adding a kind MUST require, in one PR: an enum value, a template row, an Android channel assignment, a deep link that resolves to exactly one existing route, a default-enabled decision, a quiet-hours decision, and a test. Six of those seven are the parts people forget. |
| R14 | **MUST NOT** | No push title or body MUST contain a location beyond a **safe spot's name**. Safe spots are public buildings; a home is never named because a home is never known to this layer, and no template has a placeholder that could resolve to one. |
| R15 | **MUST NOT** | No push title or body MUST contain a `handoff_code`. Lock-screen previews are readable by anyone holding the phone, including the person who took it. |
| R16 | **MUST NOT** | No push body MUST contain a cancellation reason. The reason lives in the inbox row; a reason on a lock screen is a harassment vector, and where the cause was a block the reason is generic even in the inbox ([SPEC-012 R44](SPEC-012-trust-and-safety.md)). |
| R17 | **MUST NOT** | No push body MUST contain a report's details, a rating's stars or comment, a trust score, `flagged_reason`, or any moderation action name ([SPEC-012 R29, R30, R48](SPEC-012-trust-and-safety.md)). |
| R18 | **MUST** | `message_received` bodies MUST truncate the preview at **140 characters on a word boundary** with an ellipsis. The full body is in the thread; the preview is a hint, and a mid-word cut on a lock screen reads as corruption. |
| R19 | **MUST** | Every `deep_link` MUST resolve to exactly one route in [Mobile Architecture §3.1](../01-architecture/02-mobile-architecture.md), and an unmapped kind MUST fall back to `sharecropr://notifications` rather than to the tab root. |
| R20 | **MUST NOT** | No deep link MUST accept or emit a parameter matching `/lat|lng|latitude|longitude|coord|point|geohash|h3/i`, asserted in CI over the route manifest (API-05). |

### 5.3 Preferences, quiet hours, and the one that cannot be turned off

| ID | Req | Statement |
| --- | --- | --- |
| R21 | **MUST** | Every delivery decision MUST be made by `app.should_deliver(user_id, kind, at)` at drain time, server-side ([Realtime & Notifications §6.1](../01-architecture/08-realtime-and-notifications.md)). |
| R22 | **MUST NOT** | The client MUST NOT evaluate categories or quiet hours, and MUST NOT suppress a delivered push. By the time the client could decide, the phone has lit up, the sound has played, and the decision was made on a clock the user controls — and it stops working entirely the moment they add a second device. |
| R23 | **MUST** | `safety_alert` MUST be the **first branch** of `should_deliver`, returning `true` unconditionally, above and before every category and quiet-hours check. Position matters: a later branch is one refactor away from being reachable. |
| R24 | **MUST** | `safety_alert` MUST NOT be removable from `notification_preferences.enabled_kinds`, enforced by `CHECK ('safety_alert' = ANY (enabled_kinds))`. The toggle is absent from the UI **and** the value is absent from the set of things a crafted `UPSERT` can remove. |
| R25 | **MUST** | Quiet hours MUST be evaluated in the **user's** timezone (`profiles.timezone`), never the server's, and MUST handle windows that wrap midnight (22:00 → 07:00), which is the common case and the one that gets written backwards. |
| R26 | **MUST** | Suppression MUST suppress the **push only**. The `notifications` row still exists, the outbox row is marked `delivered_at = now(), last_error = 'suppressed:quiet_hours'`, and the user loses a buzz rather than a fact. **Suppress the interrupt, never the record.** |
| R27 | **MUST** | `exchange_cancelled` MUST bypass quiet hours. Someone may be about to drive somewhere. |
| R28 | **MUST** | The **2-hour** `exchange_reminder` MUST bypass quiet hours; the 24-hour one MUST NOT. A 07:00 meeting means a 05:00 reminder for someone whose quiet hours end at 08:00, and suppressing it produces a no-show — which is a trust event that damages a real person's standing ([SPEC-012 R47](SPEC-012-trust-and-safety.md)). The exception is applied at the call site from the outbox payload's `{"lead":"2h"}`, not inside `should_deliver`, because it depends on *which* reminder is being sent. |
| R29 | **MUST** | With **no** `notification_preferences` row, the defaults MUST be: everything enabled except `surplus_alert`, and no quiet hours. A missing row is a new user, not a user who opted out. |
| R30 | **MUST** | Every kind except `safety_alert` MUST be individually toggleable, and the preferences screen MUST group them into the four Android channels — Safety, Exchanges, Messages, Account — so the in-app grouping and the OS grouping are the same grouping. |
| R31 | **MUST** | `push_enabled = false` on a `devices` row MUST exclude that device from fanout while retaining the row, and MUST be distinct from an OS-level denial, which the server cannot observe at all. Conflating the two produces a user who turned push off in-app and a server that thinks their token is dead. |
| R32 | **SHOULD** | The preferences screen SHOULD state, next to quiet hours, exactly which kinds ignore them, by name. A quiet-hours control with silent exceptions is a control the user will believe is broken at 05:00. |

### 5.4 Permission

| ID | Req | Statement |
| --- | --- | --- |
| R33 | **MUST** | The OS permission prompt MUST be requested **after the first exchange request is sent** — by either party, whichever comes first — and MUST NOT be requested at launch, during onboarding, or on the map ([PRD C13](../00-foundation/02-prd.md), [Location Privacy §9](../01-architecture/04-location-privacy.md)). |
| R34 | **MUST** | An in-app explainer MUST precede the system dialog, and the system dialog MUST NOT be shown if the explainer is dismissed. iOS grants exactly one system prompt per install; spending it on a user who is about to say no permanently costs the one chance. |
| R35 | **MUST NOT** | The explainer MUST NOT be shown more than **twice**, ever, and never twice in the same session. A permission prompt that returns is a permission prompt that gets denied. |
| R36 | **MUST** | The denied path MUST be fully supported. Every notification remains in the inbox, the tab badge still updates on foreground, and nothing is unreachable. Denial is a supported state, not a funnel. |
| R37 | **MUST** | With permission denied, one dismissible banner MUST appear on the inbox screen — and nowhere else — with a link to the OS settings page. Not on the map, not on the exchange screen, not as a modal, and never twice. |
| R38 | **MUST** | On grant, `register_device` MUST be called immediately, and again on **every cold start** where permission is granted, and again on every `addPushTokenListener` fire. Tokens rotate on reinstall, on OS restore, and occasionally for no visible reason; re-registration is cheap and idempotent on `(user_id, expo_push_token)`. |
| R39 | **MUST** | Android notification channels MUST be created at first launch, **before any push can arrive** ([Realtime & Notifications §4.6](../01-architecture/08-realtime-and-notifications.md)). Channel importance is user-controlled and immutable after creation, so a wrong initial value costs a channel-id migration. |
| R40 | **SHOULD** | The explainer SHOULD name the specific thing the user is waiting for — "so we can tell you when {display_name} replies" — because a generic "enable notifications" prompt is the one people decline. |

### 5.5 Delivery

| ID | Req | Statement |
| --- | --- | --- |
| R41 | **MUST** | `push-drain` MUST run every **30 seconds** via `pg_cron`, claim at most **100** rows with `FOR UPDATE SKIP LOCKED`, and send at most 100 messages per Expo HTTP call. `SKIP LOCKED` is what makes overlapping invocations claim disjoint rows instead of double-sending. |
| R42 | **MUST** | Retry backoff MUST be `next_attempt_at = now() + (30 s × 2^attempts)` — 30 s, 1 m, 2 m, 4 m, 8 m, 16 m. |
| R43 | **MUST** | A row MUST dead-letter at **6 attempts**, retaining `last_error`, and MUST be excluded from every subsequent claim. A 20-minute-old "you have a message" is noise. |
| R44 | **MUST** | A `DeviceNotRegistered` ticket or receipt MUST delete the `devices` row immediately and MUST NOT be retried or soft-flagged. The token is permanently dead. |
| R45 | **MUST** | A token that already belongs to another user MUST be **reassigned** to the newest user and the old row deleted ([API Contract §5.6](../01-architecture/06-api-contract.md)). A handed-down phone that delivers A's notifications to B is a privacy incident, not an inconvenience. |
| R46 | **MUST** | Sign-out MUST delete the device row **before** clearing the session, so the next person to use the phone does not inherit the subscription. |
| R47 | **MUST** | Receipts MUST be fetched by `check_push_receipts` every 5 minutes over tickets older than 15 minutes, in chunks of ≤ 1000 ids. A ticket unresolved after 24 hours MUST be marked `receipt_unknown` and **never** retried — re-sending a possibly-delivered notification is worse than dropping a possibly-lost one. |
| R48 | **MUST** | We MUST send **one message per device**, not one per user, and MUST rely on the client dedupe ring for a user with two devices open. |
| R49 | **MUST** | Every push MUST carry `data.notification_id`, and the client MUST keep a bounded MMKV ring of the last **200** seen ids, dropping repeats before rendering or navigating. This is the layer that survives a genuine double-send: a drain that sent successfully, timed out before recording the ticket, and retried. |
| R50 | **MUST** | `MismatchSenderId` and `InvalidCredentials` MUST **page immediately**. Both mean every push on a platform is failing, and both are invisible from the user's side — nobody reports a notification they never received. |
| R51 | **MUST** | The iOS badge MUST be set to the user's unread count, computed at drain time. Android badging MUST NOT be relied upon; launcher behaviour varies and there is no OS badge concept to depend on. |
| R52 | **MUST** | Priority and collapse keys MUST follow §6.3 exactly. Marking everything high is how an app gets throttled by FCM and muted by users. |
| R53 | **SHOULD** | A dead-letter rate above **0.5% over 15 minutes** SHOULD page, because it usually means an Expo credential expired or a whole platform's tokens went stale. |

### 5.6 Routing, foreground, and cold start

| ID | Req | Statement |
| --- | --- | --- |
| R54 | **MUST** | Tapping a push MUST refetch the target resource with `fetchQuery` **before** navigation resolves, so the screen renders resolved rather than half-painted ([Mobile Architecture §3.1](../01-architecture/02-mobile-architecture.md)). |
| R55 | **MUST** | A deep link to a resource the user can no longer read — expired, withdrawn, deleted, blocked, thread closed — MUST land on the relevant **tab root with a toast**, never on a broken screen and never on an error boundary. |
| R56 | **MUST** | The blocked case MUST be indistinguishable from the other three at this layer too ([SPEC-012 R39](SPEC-012-trust-and-safety.md)): one toast string for all causes, and no analytics property recording which one it was. |
| R57 | **MUST** | **Cold start from a notification:** the initial URL MUST be read in the boot router, stashed in Zustand, held while the session, email-confirmation, onboarding, and tab guards resolve, and replayed exactly once afterwards. It MUST NOT be dropped by a redirect, and MUST NOT be replayed a second time on the next foreground. This is the case that is invisible in development, because in development the app is already running. |
| R58 | **MUST** | If the cold-start target is unreachable **because the user is signed out**, the link MUST be held across sign-in and replayed after onboarding completes; if it is unreachable because the resource is gone, R55 applies. |
| R59 | **MUST NOT** | A push received while the app is **foregrounded** MUST NOT render an OS banner. It MUST update the unread badge and invalidate the query prefix implied by `kind`. A banner over the screen the user is already looking at is noise, and for `message_received` it covers the thread it is announcing. |
| R60 | **MUST** | Tapping a notification MUST mark that specific notification read, in the same user action, without waiting for the target screen to render. |
| R61 | **MUST** | On app foreground, the client MUST refetch `qk.notifications()` and the unread count, because realtime has no replay and anything that arrived while detached is invisible to the socket ([Realtime & Notifications §1.4](../01-architecture/08-realtime-and-notifications.md)). |
| R62 | **SHOULD** | The inbox row SHOULD render the same title and body as the push, from the same row, so a user who saw the banner and then opens the app does not have to reconcile two phrasings of one event. |

## 6. Data

| Table | Access | Notes |
| --- | --- | --- |
| [`public.notifications`](../01-architecture/03-data-model.md#12-notifications-devices-audit) | read (owner) / write (definer only) | The durable record. `payload` CHECK forbids coordinate keys (R06) |
| [`public.notification_preferences`](../01-architecture/03-data-model.md#12-notifications-devices-audit) | read + UPSERT (owner) | `enabled_kinds`, quiet hours; `safety_alert` CHECK-pinned (R24) |
| [`public.devices`](../01-architecture/03-data-model.md#12-notifications-devices-audit) | read (owner) / write via `register_device` | Token, platform, `app_version`, `push_enabled` |
| `private.notification_outbox` | write (definer) / drain (`service_role`) | Transactional outbox; attempts, backoff, `delivered_at`, `last_error` |
| `private.notification_templates` | **none for clients** | **New content, existing table shape.** Eleven rows, one per kind (R04) |
| `private.push_tickets` | write (`service_role`) | **New.** Ticket id ↔ outbox row, for the receipt pass (R47) |
| `public.profiles` | read (`timezone`, unread count) | Quiet hours are evaluated in the user's timezone (R25) |
| `audit.events` | write | Preference changes and device registration/deregistration |
| `private.garden_locations` | **none** | Named to be explicit: no notification path reads a coordinate, and no template has a placeholder that could hold one |

**New schema objects introduced by this spec:** migration `20260808_0131_notifications.sql`

```sql
-- R24: the toggle is absent from the UI AND the value cannot be removed from the set.
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT prefs_safety_alert_pinned
    CHECK ('safety_alert' = ANY (enabled_kinds)),
  ADD CONSTRAINT prefs_quiet_hours_paired
    CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL));

-- R06. Recursive, because a nested payload is still a payload (LP-11).
CREATE OR REPLACE FUNCTION app.jsonb_has_coord_key(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_each(p) kv
     WHERE kv.key ~* '^(lat|lng|latitude|longitude|point|coordinates|geohash|h3_r[89])$'
        OR (jsonb_typeof(kv.value) = 'object' AND app.jsonb_has_coord_key(kv.value)));
$$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_payload_no_coords
    CHECK (NOT app.jsonb_has_coord_key(payload));

CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC, id DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_feed_idx
  ON public.notifications (user_id, created_at DESC, id DESC);

-- R05: a missing key raises. It never renders a brace onto a lock screen.
CREATE OR REPLACE FUNCTION app.render_template(p_tmpl text, p_payload jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_out text := p_tmpl; v_key text;
BEGIN
  FOR v_key IN SELECT (regexp_matches(p_tmpl, '\{([a-z_]+)\}', 'g'))[1] LOOP
    IF NOT (p_payload ? v_key) THEN
      RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023',
        DETAIL = NULL;   -- never echo the payload; it can contain user text
    END IF;
    v_out := replace(v_out, '{' || v_key || '}', p_payload ->> v_key);
  END LOOP;
  RETURN v_out;
END; $$;

CREATE TABLE private.push_tickets (
  ticket_id   text PRIMARY KEY,
  outbox_id   bigint NOT NULL REFERENCES private.notification_outbox(id),
  device_id   uuid NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  receipt_at  timestamptz,
  receipt_status text CHECK (receipt_status IN ('ok','error','unknown'))
);
CREATE INDEX push_tickets_pending_idx ON private.push_tickets (sent_at)
  WHERE receipt_at IS NULL;

SELECT cron.schedule('check_push_receipts', '*/5 * * * *',
  $$SELECT net.http_post(url := app.setting('edge_url') || '/push-receipts',
      headers := jsonb_build_object('Authorization','Bearer '||app.setting('service_key')));$$);
```

Also introduced: eleven `private.notification_templates` rows (§6.2 is their source of truth); the `push-receipts` Edge Function; the route `/notifications` and the preferences screen at `/profile/notifications`; and a CI contract test asserting one template row per enum value with every placeholder resolvable from a synthetic payload.

### 6.1 Outbox row lifecycle

| From | To | Actor | Mechanism | Notes |
| --- | --- | --- | --- | --- |
| — | claimable | State-transition RPC | `app.enqueue_notification` | Same transaction as the state change (R03) |
| claimable | claimed | `push-drain` | `FOR UPDATE SKIP LOCKED` | Overlapping drains claim disjoint rows |
| claimed | suppressed | `push-drain` | `should_deliver = false` | `delivered_at = now()`, `last_error = 'suppressed:*'`. **The inbox row remains** (R26) |
| claimed | sent | `push-drain` | Expo ticket `ok` | `private.push_tickets` row written |
| claimed | retrying | `push-drain` | Transient error | `attempts += 1`, backoff (R42) |
| sent | delivered | `push-receipts` | Receipt `ok` | `delivered_at` set |
| sent | dead (`DeviceNotRegistered`) | `push-receipts` | Receipt error | Device row deleted; **no retry** (R44) |
| sent | `receipt_unknown` | `push-receipts` | 24 h with no receipt | Never retried (R47) |
| retrying | dead-lettered | `push-drain` | `attempts = 6` | `last_error` retained, counted, alerted (R43) |

### 6.2 The catalog

Every value of `notification_kind` ([Data Model §4](../01-architecture/03-data-model.md)), exactly once. `{}` placeholders are filled from the outbox row's payload.

| Kind | Trigger event | Title | Body | Deep link | Default on | Quiet-hours suppressible | Channel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `request_received` | `create_exchange_request` commits | `New exchange request` | `{requester_name} wants your {listing_title}` | `sharecropr://exchanges/{request_id}` | Yes | **Yes** | exchanges |
| `request_accepted` | `accept_exchange_request` commits | `Request accepted` | `{owner_name} accepted your request for {listing_title}. Pick a time and place.` | `sharecropr://exchanges/session/{session_id}` | Yes | **Yes** | exchanges |
| `request_declined` | `decline_exchange_request`, or auto-decline when someone else's request is accepted | `Request declined` | `{owner_name} declined your request for {listing_title}` | `sharecropr://exchanges/{request_id}` | Yes | **Yes** | exchanges |
| `message_received` | `messages` INSERT where `kind = 'user'` | `{sender_name}` | `{body_preview}` — ≤ 140 chars, truncated on a word boundary (R18) | `sharecropr://thread/{thread_id}` | Yes | **Yes** | messages |
| `exchange_reminder` | `remind_upcoming` cron, 24 h and 2 h before `scheduled_start` | `Exchange {when}` | `{item_title} with {other_name} at {safe_spot_name}, {time}` | `sharecropr://exchanges/session/{session_id}` | Yes | **24 h: yes · 2 h: no** (R28) | exchanges |
| `exchange_cancelled` | `cancel_session`, `on_block_created`, or `detect_no_shows` | `Exchange cancelled` | `Your exchange with {other_name} was cancelled.` — **no reason, ever** (R16) | `sharecropr://exchanges/session/{session_id}` | Yes | **No** (R27) | exchanges |
| `verification_result` | `kyc-webhook` writes a terminal status | `Identity verification {outcome}` | pass: `You can now list and exchange crops.` · fail: `We couldn't verify your ID. Tap for next steps.` | pass: `sharecropr://notifications` · fail: `sharecropr://onboarding/identity` | Yes | **Yes** | account |
| `garden_review_result` | Moderator decision on a `garden_verification_submissions` row | `Garden {outcome}` | approved: `Your garden is verified. You're ready to trade.` · rejected: `{rejection_reason}` | `sharecropr://profile/garden` | Yes | **Yes** | account |
| `moderation_outcome` | `moderation-action` resolves a report; also rating reveal ([SPEC-012 R30, §6](SPEC-012-trust-and-safety.md)) | `Update on your report` / `Account notice` / `Ratings revealed` | Templated per outcome. **Never names the other party, the action, or the reason** (R17) | `sharecropr://notifications` | Yes | **Yes** | account |
| `safety_alert` | Trust & Safety, manually or by rule | `Important safety notice` | Templated and reviewed per incident | `sharecropr://notifications` | **Yes — and not disableable** (R23, R24) | **Never** | safety |
| `surplus_alert` *(Phase 2)* | [SPEC-020](SPEC-020-harvest-planning.md) subscription match | `{species_name} available nearby` | `{count} new listings within {radius} km` | `sharecropr://map` | **No** (opt-in) | **Yes** | exchanges |

Rules that hold across the whole table, restated because each has been violated by a well-meaning template edit somewhere in the industry:

1. **The only place name that may appear is a safe spot's name** (R14). No street, no locality beyond a spot's own name, no distance, no "near you".
2. **No handoff code** (R15). It is returned exactly twice over HTTPS and never rides a socket or a notification ([API Contract §4.7](../01-architecture/06-api-contract.md)).
3. **No cancellation reason** (R16), and where the cause was a block the inbox row is generic too.
4. **No moderation detail** (R17). "We took action" is the maximum resolution the reporter gets.
5. **`safety_alert` ignores `enabled_kinds` and quiet hours entirely**, in `app.should_deliver()` and never in the client.
6. **The 2-hour reminder is the one narrow quiet-hours exception among reminders** — only the 2 h lead, only for a `scheduled` session.

### 6.3 Priority, collapse, and channels

| Kind | Priority | Collapse key | Channel | Reasoning |
| --- | --- | --- | --- | --- |
| `safety_alert` | high | **none** | safety (MAX, `bypassDnd`, distinct sound) | Never collapsed. Every one is distinct and must be seen |
| `request_received` | high | `req:{listing_id}` | exchanges | Five requests on one listing collapse to the latest; the inbox has all five |
| `request_accepted` | high | none | exchanges | Singular, actionable, time-sensitive |
| `request_declined` | normal | `req:{listing_id}` | exchanges | |
| `message_received` | high | `thread:{thread_id}` | messages | One line per conversation, not per message |
| `exchange_reminder` | high | `session:{session_id}` | exchanges | The 2 h reminder replaces the 24 h one on the lock screen |
| `exchange_cancelled` | high | `session:{session_id}` | exchanges | |
| `verification_result` | normal | none | account | |
| `garden_review_result` | normal | none | account | |
| `moderation_outcome` | normal | none | account | |
| `surplus_alert` | normal | `surplus:{species_id}` | exchanges | |

**PII touched:** `notifications.title` and `body` are **P1** once rendered, because they contain a counterparty's display name, an item title, and — for `exchange_reminder` — a **time and a public place a named person will be**, which [Data Model §10](../01-architecture/03-data-model.md) identifies as the highest-value target in the database for a stalker. That is why the reminder body is the most carefully bounded string in the catalog and why nothing else in it can be widened without a security review. `devices.expo_push_token` and `last_seen_at` are **P1**. `payload` is P2 by construction — ids and enum values — and is `CHECK`-constrained against coordinate keys (R06). **No P0 column is read, written, or derivable by any path in this spec**, and no template has a placeholder capable of resolving to one.

## 7. API

### 7.1 `rpc.mark_notifications_read`

**Auth:** `authenticated`, owner
**Rate limit:** 60 / min / user

```jsonc
// Request — exactly one of the two, never both null
{ "p_ids": ["4a2f9c11-…", "7b1e0c1c-…"], "p_before": null }
// Response 200
{ "marked": 2, "unread_remaining": 5 }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Both parameters null, or more than 500 ids |
| `rate_limited` | 429 | Bucket empty |

`unread_remaining` is returned so the client can set the badge from an authoritative number rather than decrementing a local one, which drifts the moment a second device is involved. Ids belonging to another user are silently ignored rather than erroring — the function filters on `user_id = auth.uid()`, and reporting "that one wasn't yours" would confirm a notification id exists.

### 7.2 `rpc.register_device`

**Auth:** `authenticated`
**Rate limit:** 20 / day / user

```jsonc
// Request
{ "p_expo_push_token": "ExponentPushToken[xxxxxxxx]", "p_platform": "ios",
  "p_app_version": "1.0.3", "p_os_version": "18.2", "p_idempotency_key": "…" }
// Response 200
{ "device_id": "3d0f5a7b-…", "push_enabled": true, "reassigned": false }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `validation_failed` | 400 | Malformed Expo token, unknown platform, missing `app_version` |
| `rate_limited` | 429 | 20/day exhausted |

There is **no** `conflict` on a token that belongs to another user: the token is reassigned to the caller and the previous row deleted (R45), and `reassigned: true` is returned so the client can log it. Erroring instead would leave a handed-down phone delivering the previous owner's notifications indefinitely. `devices.app_version` is read by CI to gate destructive migrations ([Data Model §12](../01-architecture/03-data-model.md)), which is a second reason re-registration on every cold start matters.

### 7.3 `PATCH /rest/v1/notification_preferences` (UPSERT)

**Auth:** `authenticated`, owner. **Rate limit:** 60 / min / user.

```jsonc
{ "user_id": "8f14e45f-…",
  "enabled_kinds": ["request_received","request_accepted","request_declined",
                    "message_received","exchange_reminder","exchange_cancelled",
                    "verification_result","garden_review_result","moderation_outcome",
                    "safety_alert"],
  "quiet_hours_start": "22:00", "quiet_hours_end": "07:00" }
```

Errors: `validation_failed` 400 for an `enabled_kinds` array omitting `safety_alert` (`prefs_safety_alert_pinned`, R24), for exactly one of the two quiet-hours values being null (`prefs_quiet_hours_paired`), or for an unknown enum value. The constraint — not the absent toggle — is the control: the UI has no switch for `safety_alert`, and a crafted `UPSERT` that drops it is rejected by the database.

### 7.4 `POST /functions/v1/push-drain`

**Invoked by:** `pg_cron`, every 30 s. **Auth:** `service_role`; not reachable with a user JWT.

Loop, in order: `claim_outbox_batch(100)` with `FOR UPDATE SKIP LOCKED` → `app.should_deliver(user, kind, now())` per row → drop suppressed rows to `delivered_at` with `last_error = 'suppressed:*'` → expand each remaining row to **one message per device** where `push_enabled` → `chunkPushNotifications` (≤ 100) → `sendPushNotificationsAsync` → `record_push_tickets`. Ticket errors are handled per [Realtime & Notifications §4.3](../01-architecture/08-realtime-and-notifications.md): `DeviceNotRegistered` deletes the device, `MessageTooBig` truncates and logs a template regression, `MessageRateExceeded` backs off, and the two credential errors page.

### 7.5 `POST /functions/v1/push-receipts`

**Invoked by:** `pg_cron`, every 5 min. **Auth:** `service_role`.

Selects `private.push_tickets` older than 15 minutes with no receipt, in chunks of ≤ 1000 ids, and resolves each. `ok` sets `delivered_at`; `DeviceNotRegistered` deletes the device row and does **not** retry; anything older than 24 hours becomes `receipt_unknown` and is never retried (R47).

### 7.6 What this spec deliberately does not expose

| Not exposed | Why |
| --- | --- |
| A "was this push delivered?" API for clients | Delivery is best-effort and the honest answer is usually "we don't know". Exposing a guess would invite features that depend on it, which R02 forbids |
| Another user's notification, preference, or device row | `notifications_select_own` and Pattern A ([RLS Design §5](../01-architecture/05-rls-design.md)). There is no shape in which one user's inbox is another user's business |
| `expo_push_token` in any read that isn't the owner's own device list | It is P1, and a token is a write primitive for anyone holding the project credentials |
| A realtime channel for `notification_preferences` or `devices` | Nothing needs to be live about a preference the user just set on the device they set it on |
| Notification *content* pushed to a user's other devices over realtime | The inbox row is the record; each device fetches it ([API Contract §8.3](../01-architecture/06-api-contract.md)) |
| A `DELETE` on notifications | There is no `DELETE` anywhere in the API ([API Contract §1.3](../01-architecture/06-api-contract.md)). Retention is a schedule, not a user action |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Inbox | `/notifications` | The durable record, keyset-paginated, grouped by day |
| Notification preferences | `/profile/notifications` | Per-kind toggles grouped by channel, plus quiet hours |
| Permission explainer | Sheet, after the first exchange request | Precedes the system dialog (R34) |
| Permission denied banner | Inline on `/notifications` only | One dismissible banner with a link to OS settings (R37) |
| Tab badge | `(tabs)` → exchanges and profile | Unread count, refreshed on foreground |

### 8.2 States

| State | Behaviour |
| --- | --- |
| Loading | The inbox paints from the persisted MMKV cache immediately — it is a list of short text rows and there is no reason for a user to ever see it empty while it loads ([Mobile Architecture §2.3](../01-architecture/02-mobile-architecture.md)) — then reconciles against one fetch. A cold install shows a six-row skeleton for at most one round trip. The preferences screen never shows a loading state: `notification_preferences` is fetched at boot with the profile and, if absent, rendered from the R29 defaults. |
| Empty | **A genuinely empty inbox** reads "Nothing yet. We'll tell you when someone asks for your crops, replies, or when an exchange is coming up." — a statement of what the app will do, not an apology. It is the one empty state most users see on day one, so it does onboarding work. **An empty inbox with permission denied** additionally shows the R37 banner, because "nothing here" plus "we can't reach you" is the combination that needs explaining. |
| Error (recoverable) | Inbox fetch failed with a 5xx or a timeout: the cached list stays on screen with a thin inline banner and a Retry, never a full-screen error, because the cached rows are still true. A failed `mark_notifications_read` is retried once silently and then abandoned — a badge that is one too high is not worth a dialog. A failed preference write **reverts the switch visibly** and says so; a switch that stays flipped after a failed write is a lie about a setting the user will rely on at 03:00. |
| Error (terminal) | Tapping a notification whose target is gone (R55): the tab root plus a toast, one string for every cause including a block (R56). The notification row itself stays in the inbox and stays readable — it is a true record of something that happened, and deleting it would make the user think they imagined it. |
| Offline | The inbox is fully readable from cache with a staleness banner; unread state is whatever the last sync said. Marking read is **queued** — it is the one mutation in the product that is safely queueable, because it is idempotent, order-independent, and cannot harm anyone if it lands late ([Mobile Architecture §2.4](../01-architecture/02-mobile-architecture.md)). Preference changes are **not** queued and the controls are disabled with the copy in §8.3: a user who believes they turned quiet hours on, and did not, gets woken up at 05:00 by a bug they will reasonably describe as us ignoring them. |
| Permission denied | The primary case for this spec, and a supported destination rather than a failure. Everything works; the inbox is complete; the tab badge updates on foreground; one dismissible banner appears on `/notifications` with a link to the OS settings page (R36, R37). No modal, no interstitial, no second ask, and no reduced functionality anywhere. On Android, a user who has disabled the **safety** channel specifically sees a distinct line in the banner, because that is the one we would otherwise be quietly failing to deliver. |
| Rate limited | 429 on `mark_notifications_read` (60/min) or `register_device` (20/day). Both are invisible to the user by design: mark-read backs off and retries within its queue, and device registration retries on the next cold start. Neither surfaces a message, because neither is a thing the user asked for. Reaching either limit is a client bug and the §11 alert is how we find out. |

Two additional states specific to this feature:

| State | Behaviour |
| --- | --- |
| Push received while foregrounded | No banner, no sound (R59). The unread badge increments and the query prefix implied by `kind` is invalidated, so the screen the user is looking at updates underneath them. For `message_received` on the thread it belongs to, the message simply appears. |
| Quiet hours active | The preferences screen shows the window as active ("Quiet until 07:00") and lists, by name, the kinds that will still come through (R32). Without that list, the first 05:00 reminder reads as the setting being broken. |

### 8.3 Copy

Exact strings.

**Inbox, empty**
> **Nothing yet.**
> We'll let you know when someone asks for your crops, when you get a reply, and before an exchange you've arranged.

**Inbox, day headers**
> Today · Yesterday · {weekday} · {d MMM}

**Inbox, stale/offline banner**
> Showing what we had at {time}. Pull to refresh when you're back online.

**Deep link target gone (R55, R56 — one string for every cause)**
> That's no longer available.

**Permission explainer, before the system dialog (R34, R40)**
> **Want to know when {display_name} replies?**
> We'll notify you about requests, replies, and exchanges you've arranged — and nothing else. No marketing, ever.
>
> Buttons: `Not now` · `Turn on notifications`

**Permission denied banner, on the inbox only (R37)**
> **Notifications are off.**
> Everything still shows up here — you'll just have to open the app to see it. You can turn them on in Settings.
>
> Button: `Open Settings` · dismiss: `×`

**Permission denied banner, Android, safety channel disabled**
> **Safety alerts are off.**
> These are the ones we send when something needs your attention right away. You can turn the Safety channel back on in Settings.

**Preferences screen, section headers**
> **Safety** · **Exchanges** · **Messages** · **Account & verification**

**Preferences, the safety row (no switch)**
> **Safety alerts** — Always on
> We only send these when something needs your attention right away. They ignore quiet hours, and they can't be turned off.

**Preferences, quiet hours**
> **Quiet hours**
> Don't buzz my phone between {start} and {end}. Everything still arrives here in your inbox.
>
> Helper (R32): These still come through: safety alerts, exchange cancellations, and the two-hour reminder before you're due to meet someone.

**Preferences, offline**
> You need a connection to change notification settings.

**Preferences, write failed**
> That didn't save. Your settings haven't changed.

**Push, cold-start held link (R57) — visible only if the wait exceeds 1 s**
> Opening…

**Tab badge accessibility label (US-14)**
> Notifications, {n} unread

**Inbox row accessibility label (US-14)**
> {unread ? "Unread. " : ""}{title}. {body}. {relative_time}.

**Inbox row accessibility hint**
> Opens {exchange | conversation | your garden | your inbox}

**Mark-all-read confirmation**
> Mark all {n} as read?
> Buttons: `Cancel` · `Mark all read`

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | **Read a scheduled meeting off a lock screen.** `exchange_reminder`'s body names a person, a public place, and a time — which [Data Model §10](../01-architecture/03-data-model.md) identifies as the highest-value combination in the database for a stalker — and a lock screen is readable by anyone holding the phone. The bound is that the place is always a **public building** and never a home (R14), that the code that unlocks the handoff is never in a push (R15), and that no cancellation reason, report detail, or moderation action rides along (R16, R17). The second-worst is **token confusion on a shared device**, where A's notifications reach B; that is a privacy incident, and R45's reassignment plus R46's delete-on-sign-out are the controls. The third is **a template regression interpolating something it shouldn't**, prevented structurally: templates are rows, reviewed, with no placeholder that can resolve to a coordinate, and `payload` is `CHECK`-constrained (R06). |
| Which RLS policies enforce access? | `notifications_select_own` (`user_id = (SELECT auth.uid())`, Pattern A) with **no** client INSERT, UPDATE, or DELETE policy; `notification_preferences` owner-only select and UPSERT; `devices` owner-only select with writes only through `register_device` ([RLS Design §5 Pattern A](../01-architecture/05-rls-design.md)). Definer functions: `app.enqueue_notification`, `app.should_deliver`, `app.render_template`, `app.jsonb_has_coord_key`, `public.mark_notifications_read`, `public.register_device`, `claim_outbox_batch`, `record_push_tickets`. `private.notification_outbox`, `private.notification_templates`, and `private.push_tickets` are in `private`, which no client role has any privilege on ([Data Model §3](../01-architecture/03-data-model.md)). The Realtime publication on `notifications` is column-scoped and RLS-filtered, so a subscriber receives only rows they could `SELECT` ([Realtime & Notifications §1.1](../01-architecture/08-realtime-and-notifications.md)). |
| Can any response path expose an exact coordinate or PII? | No coordinate: `payload` rejects coordinate keys at any depth (R06, LP-11), no template has a placeholder that could hold one (R14), no route in the deep-link table accepts one (R20, API-05), and the Realtime publication column list is asserted coordinate-free (API-08). PII is present and intended: titles and bodies carry a counterparty's display name and, for reminders, a time and a public place — restricted to the recipient by `notifications_select_own` and excluded from analytics entirely. `expo_push_token` is P1 and reaches no read path but the owner's own device list. |
| What is logged, and is it scrubbed? | Operational logs carry `notification_id`, `kind`, `outbox_id`, `attempts`, `last_error`, ticket ids, and receipt statuses — **never** a rendered title or body, never a payload, never a push token, and never a `user_id` alongside a `kind` that discloses content. `app.render_template` raises with `DETAIL = NULL` specifically so a failed render cannot echo user text into a Postgres error ([API Contract §3.4](../01-architecture/06-api-contract.md)). Analytics carry `kind`, `channel`, `suppressed_reason`, and latency; the Sentry scrubber drops `title`, `body`, `payload`, and `expo_push_token` alongside its coordinate rule ([Location Privacy §8](../01-architecture/04-location-privacy.md)). |
| Does this need step-up authentication? | No. Reading your own inbox, changing your own notification preferences, and registering your own device are all ordinary authenticated operations. Deregistering **another** device is AAL2-gated, and that is [SPEC-001](SPEC-001-authentication.md)'s rule, not this spec's ([API Contract §2.4](../01-architecture/06-api-contract.md)). |
| Abuse / rate-limit controls | `mark_notifications_read` 60/min/user; `register_device` 20/day/user; `notification_preferences` 60/min/user; `notifications` read 120/min/user. Expo's own ceiling is 600 notifications/second per project, alerted at 60%. Structural controls: one message per device rather than per user (R48), collapse keys that bound how many banners one listing or thread can produce (§6.3), and the fact that **no user action can cause a notification to another user except through a state transition the state machine already rate-limits** — a harasser cannot buzz someone's phone faster than `messages` INSERT's 20/min and 10/min-per-thread limits allow ([API Contract §7.2](../01-architecture/06-api-contract.md)). That is the real anti-abuse control here, and it lives in the features that generate the events rather than in this spec. |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | A state-transition RPC commits, and the process dies before `push-drain` next runs. | Nothing is lost. The `notifications` row and the outbox row committed in the same transaction (R03); the next drain claims the row. This is the entire reason the outbox exists, and it is why no code path is permitted to call Expo inline. |
| EC-02 | Two `push-drain` invocations overlap because one ran long. | `FOR UPDATE SKIP LOCKED` gives them disjoint row sets (R41). Neither double-sends, neither deadlocks, and the slow one's unfinished rows are simply reclaimed on the next tick. |
| EC-03 | `push-drain` sends successfully, then times out before recording the ticket, and retries. | The user's device may receive two pushes. `data.notification_id` is identical on both, the client's 200-entry dedupe ring drops the second before it renders or navigates (R49), and the inbox has one row. This is the failure the outbox cannot cover and the dedupe ring exists for. |
| EC-04 | The user has quiet hours 22:00–07:00 and an exchange is cancelled at 03:00. | `exchange_cancelled` bypasses quiet hours (R27) and the phone buzzes. This is correct: the alternative is a person driving to a library at 08:00 for a meeting that was cancelled five hours earlier. |
| EC-05 | The user has quiet hours until 08:00 and a 07:00 exchange, so the 2 h reminder fires at 05:00. | It is delivered (R28). The 24 h reminder for the same session, which fired at 07:00 the previous day, was suppressible and may not have been delivered. The preferences screen names this exception in advance (R32) so the 05:00 buzz is expected rather than reported. |
| EC-06 | A user crafts an `UPSERT` on `notification_preferences` with `enabled_kinds` omitting `safety_alert`. | Rejected by `prefs_safety_alert_pinned` (R24). Even if it succeeded, `should_deliver` returns `true` for `safety_alert` before it ever reads the preferences row (R23) — two independent controls, because this is the one delivery we are asserting to the app stores that we make. |
| EC-07 | A user travels from Michigan to Portugal without updating `profiles.timezone`. | Quiet hours are evaluated against the stale timezone (R25) and are wrong by five hours until the timezone updates. The client refreshes `profiles.timezone` from the device on every cold start; between flights and the next cold start, this is a known, accepted, five-hour wrongness that costs a buzz and never a fact. |
| EC-08 | Expo Push is down for twenty minutes. | Tickets fail, rows retry on the backoff schedule, and rows exceeding 6 attempts dead-letter at about the 30-minute mark (R42, R43). The inbox is entirely unaffected, so a user who opens the app sees everything. The dead-letter alert fires; the runbook response is to confirm the inbox is intact and wait. |
| EC-09 | A user reinstalls the app; the old token is dead and a new one is issued. | The first push to the old token returns `DeviceNotRegistered`, the device row is deleted and never retried (R44). The new token is registered on the next cold start (R38). The window between reinstall and next launch delivers nothing to that device — unavoidable, and invisible because the inbox is complete. |
| EC-10 | Two people share a phone; B signs in after A. | `register_device` reassigns the token to B and deletes A's row (R45); A's sign-out had already deleted it if they signed out properly (R46). Either way, exactly one user is subscribed on that token, and A's notifications stop reaching B's lock screen. |
| EC-11 | A push arrives for a thread the user is currently reading. | No banner and no sound (R59). The message appears in the thread through the realtime append, the badge does not increment for a thread in focus, and the notification row is marked read when the thread is opened. |
| EC-12 | The app is force-quit on an Android device with aggressive battery management. | The push is not delivered at all, on many OEM builds, regardless of correctness ([Realtime & Notifications §4.4](../01-architecture/08-realtime-and-notifications.md)). The user sees everything on next open. This is the concrete reason the inbox is the record and not a convenience, and it is why R02 exists. |
| EC-13 | Cold start from a `message_received` tap while signed out. | The initial URL is stashed in the boot router, the user is routed to sign-in, and the link is replayed after the session, email-confirmation, onboarding, and tab guards all resolve (R57, R58). It is replayed exactly once; a second foreground does not re-navigate. |
| EC-14 | Cold start from a tap on a notification whose thread has since closed. | `fetchQuery` resolves to nothing, the router lands on the exchanges tab root with "That's no longer available." (R55). The same string and the same route as expiry, deletion, and a block (R56). |
| EC-15 | `pg_cron` job `drain_notification_outbox` is not recreated after a migration. | Outbox depth grows monotonically and the depth alert (> 500 undelivered, or oldest > 5 min) fires. Nothing is lost, and the post-migration smoke check that asserts every cron job exists is the control that should have caught it first ([Exchange State Machine §7](../01-architecture/07-exchange-state-machine.md)). |
| EC-16 | A template is edited to reference `{safe_spot_address}`, a key no call site supplies. | The CI contract test over every kind × a synthetic payload fails before merge; if it somehow shipped, `app.render_template` raises `validation_failed` at enqueue time (R05) and the state transition rolls back — which is loud, correct, and much better than a lock screen reading `{safe_spot_address}`. |
| EC-17 | A caller passes `{"lat": 42.28}` in a notification payload. | The `notifications_payload_no_coords` CHECK rejects the insert (R06), which rolls back the enclosing state transition. A notification that would have leaked a coordinate takes its whole transaction down with it, deliberately. |
| EC-18 | A user disables the Android **safety** channel at the OS level. | We cannot prevent it and do not pretend to — `bypassDnd` covers Do Not Disturb, not a disabled channel. The banner names it specifically (§8.3) and the inbox remains the guarantee. This is stated plainly rather than engineered around, because there is nothing to engineer. |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |
| `notification.enqueued` | product event | `kind`, `channel` | — |
| `notification.outbox_depth` | gauge | `undelivered`, `oldest_age_s` | **> 500 undelivered, or oldest > 5 min — page.** The drain is stopped and nobody's phone is ringing |
| `notification.drain_batch` | operational | `claimed`, `suppressed`, `sent`, `failed`, `duration_ms` | `duration_ms` p95 > 15 s (the invocation timeout is 20 s) |
| `notification.suppressed` | product event | `kind`, `reason` (`quiet_hours`\|`kind_disabled`\|`push_disabled`\|`no_device`) | `no_device` > 40% of eligible users ⇒ the permission ask is failing |
| `notification.ticket_error` | error event | `error`, `platform` | **`MismatchSenderId` or `InvalidCredentials` — any occurrence, page.** Every push on a platform is failing and no user will report it |
| `notification.dead_lettered` | error event | `kind`, `last_error` | **> 0.5% over 15 min — page** |
| `notification.receipt` | operational | `status`, `error`, `platform` | `DeviceNotRegistered` > 5% of receipts ⇒ token hygiene problem, likely a sign-out path |
| `notification.receipt_unknown` | error event | `age_h` | Any sustained volume ⇒ the receipt pass is not keeping up with the 24 h retention |
| `notification.push_to_open_ms` | histogram | `kind` | p50 rising ⇒ notifications are arriving but not being acted on; check whether the body says enough |
| `notification.open_rate` | gauge | `kind` | < 10% for a kind ⇒ that kind is noise and should be reconsidered, not tuned |
| `notification.permission_prompt` | product event | `outcome` (`granted`\|`denied`\|`explainer_dismissed`), `attempt` | `granted` < 50% ⇒ the R33 trigger point or the R40 copy is wrong |
| `notification.permission_state` | gauge | `granted`, `denied`, `undetermined` | `denied` > 40% of MAU ⇒ escalate to product; the inbox is carrying more load than designed |
| `notification.deep_link_resolved` | product event | `kind`, `outcome` (`target`\|`fallback`) | `fallback` > 5% ⇒ stale links or an unmapped kind |
| `notification.deep_link_terminal` | product event | — (**deliberately no cause property**) | Rising ⇒ stale notifications. The cause is not recorded even internally, so no analytics path can reconstruct what R56 hides |
| `notification.cold_start_link` | product event | `held_ms`, `replayed` | `replayed = false` > 1% ⇒ links are being dropped by a redirect, which is invisible in development |
| `notification.dedupe_hit` | operational | `kind` | Sustained > 1% ⇒ the drain is double-sending; inspect ticket recording |
| `notification.template_render_error` | error event | `kind`, `missing_key` | **Any occurrence — page.** A render error rolls back a state transition, so this is a user-visible failure of something else |
| `notification.badge_drift` | gauge | Devices whose set badge differs from the server unread count | > 2% ⇒ the drain's badge computation is stale |

**Never emitted:** a rendered `title` or `body`, a `payload`, an `expo_push_token`, a message preview, a counterparty's name, a safe-spot name, a `scheduled_start`, or any coordinate.

## 12. Accessibility

- The inbox row is read as **one utterance** — unread state first, then title, then body, then relative time — because a notification is a single fact and splitting it across four stops makes a list of twenty notifications a list of eighty.
- Unread state is conveyed by the word "Unread" in the accessible label **and** by a visible dot, never by weight or colour alone. A bolded row is not a state a screen reader has a word for.
- The tab badge has an `accessibilityLabel` of "Notifications, {n} unread", so the count is available without opening the tab. A bare numeral read as "3" next to "Profile" is meaningless.
- Relative times are rendered as words ("2 hours ago", "yesterday"), never as a bare timestamp the reader has to subtract from now, and never as an abbreviation like "2h" which screen readers pronounce inconsistently across platforms.
- Preference switches use `accessibilityRole="switch"` with `accessibilityState={{ checked }}` and a label that includes the category name in full, not the row's visual truncation.
- The always-on safety row is **not** a disabled switch. A disabled switch reads as "switch, dimmed" and invites a user to try to toggle it; it is a labelled static row reading "Safety alerts, always on" with the explanation as its hint.
- The quiet-hours exception list (R32) is a real list, marked up as list items, so it announces "list, 3 items" — the same reasoning as [SPEC-012 §12](SPEC-012-trust-and-safety.md)'s block-confirmation bullets.
- The permission explainer is a modal with `accessibilityViewIsModal`, focus on the body text rather than the primary button, and `Not now` first in the reading order so declining does not require traversing the accept path.
- Dynamic type to 200% with no capping. Inbox bodies wrap to a maximum of four lines and then truncate with the full text available on the target screen; the preferences helper text and the quiet-hours exception list never truncate.
- Hit targets ≥ 44 × 44 dp on every inbox row, switch, banner dismiss, and settings link.
- Reduced motion: new inbox rows appear without animation, and the badge does not bounce.
- The inbox is reachable in two taps from anywhere via the profile tab, and the deep link `sharecropr://notifications` is the documented fallback for every unmapped kind (R19), so a keyboard or switch-control user always has a route in.

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | integration | R01, R03 | For each of the eleven kinds, the `notifications` row and the outbox row commit with the state change; an injected failure after the state write leaves neither |
| T02 | integration | R02 | Contract review assertion: no state machine, guard, or query in `src/` reads a push-delivery status. Asserted by a static check plus a fault-injection run with all pushes dropped and every flow completing |
| T03 | integration | R04 | No `title`, `body`, or `deep_link` string is constructed anywhere outside `private.notification_templates`; CI greps migrations and Edge Functions for template-shaped concatenation |
| T04 | integration | R05 | `render_template` with a missing key raises `validation_failed`, rolls back the enclosing transaction, and emits `DETAIL = NULL` so no user text escapes |
| T05 | integration | R06 | `payload` inserts are rejected for each forbidden key at depth 1, 2, and 3; asserted for `service_role` too, so the CHECK is not bypassable by the drain |
| T06 | integration | R07, R09 | Keyset pagination returns every row exactly once across insert churn; an offset query does not exist in the client; the unread count uses `count=exact` with a zero-row range |
| T07 | rls | R08 | Owner reads own; another user and `anon` read zero; INSERT, UPDATE, and DELETE are denied for `authenticated` on `notifications` |
| T08 | integration | R10 | A notification about a withdrawn listing, a deleted account, and a closed thread all remain readable |
| T09 | e2e | R11 | Day grouping renders; a row marks read on tap and **not** on scroll-into-view |
| T10 | integration | R12, R13 | Every `notification_kind` enum value has exactly one template row; a kind with no row fails the build; every placeholder resolves against a synthetic payload |
| T11 | integration | R14 | Rendered bodies for all eleven kinds across 100 fixtures contain no street, locality, postcode, distance, or coordinate — only safe-spot names drawn from `safe_spots.name` |
| T12 | integration | R15 | No rendered body or push payload contains a `handoff_code`; asserted against a session that has one |
| T13 | integration | R16 | `exchange_cancelled` bodies are identical for a user cancellation, a no-show, and a block; the reason appears in neither the push nor — for the block case — the inbox ([SPEC-012 R44](SPEC-012-trust-and-safety.md)) |
| T14 | integration | R17 | `moderation_outcome` bodies never contain a report detail, a rating, a trust score, `flagged_reason`, or a `moderation_action` name |
| T15 | unit | R18 | Preview truncation parameterised over 139, 140, 141, and 400 characters, with and without a word boundary at the cut, and over CJK and emoji-bearing bodies |
| T16 | e2e | R19 | Every one of the eleven deep links resolves to exactly one route; a synthetic unmapped kind falls back to `sharecropr://notifications` |
| T17 | integration | R20 | The route-manifest static check (API-05) rejects a route param matching the coordinate regex |
| T18 | integration | R21, R22 | Every suppression decision is made by `app.should_deliver` at drain time; a static check asserts no client code reads `quiet_hours_*` or `enabled_kinds` for a delivery decision |
| T19 | integration | R23 | `should_deliver` returns `true` for `safety_alert` with `enabled_kinds = '{safety_alert}'` only, with quiet hours active, with no preferences row, and with the kind removed by a direct `UPDATE` that bypasses the CHECK |
| T20 | integration | R24 | An `UPSERT` on `notification_preferences` omitting `safety_alert` is rejected by `prefs_safety_alert_pinned`; a mismatched quiet-hours pair is rejected by `prefs_quiet_hours_paired` |
| T21 | integration | R25 | Quiet hours across **8 timezones** × wrapping (22:00→07:00) and non-wrapping (13:00→14:00) windows × boundary instants (start, start−1s, end, end−1s), evaluated against `profiles.timezone` and never the server's |
| T22 | integration | R26 | A suppressed row sets `delivered_at` and `last_error = 'suppressed:*'` and **the inbox row still exists and is unread** |
| T23 | integration | R27, R28 | `exchange_cancelled` and the 2 h reminder deliver inside quiet hours; the 24 h reminder does not; the distinction comes from the payload's `lead` at the call site |
| T24 | integration | R29 | With no preferences row, everything except `surplus_alert` delivers and quiet hours do not apply |
| T25 | e2e | R30, R32 | The preferences screen renders every toggleable kind grouped into the four channels, has no switch for `safety_alert`, and names the quiet-hours exceptions by name |
| T26 | integration | R31 | `push_enabled = false` excludes a device from fanout while retaining the row; it is distinguishable in the drain from a user with no device at all |
| T27 | e2e | R33, R34, R35 | The system dialog appears only after the first exchange request; never at launch, onboarding, or map open; the explainer precedes it; dismissing the explainer does not spend the system prompt; the explainer appears at most twice ever and never twice per session |
| T28 | e2e | R36, R37 | With permission denied: every notification is in the inbox, the badge updates on foreground, exactly one dismissible banner appears on `/notifications` and nowhere else, and dismissal persists |
| T29 | integration | R38 | `register_device` fires on grant, on every cold start with permission granted, and on `addPushTokenListener`; it is idempotent on `(user_id, expo_push_token)` |
| T30 | e2e | R39 | All four Android channels exist before the first push can arrive, with the exact importance, sound, and `bypassDnd` values from [Realtime & Notifications §4.6](../01-architecture/08-realtime-and-notifications.md) |
| T31 | integration | R41 | The drain claims ≤ 100 with `SKIP LOCKED`; two concurrent invocations claim disjoint sets and neither double-sends |
| T32 | integration | R42, R43 | The backoff schedule is exactly 30 s, 1 m, 2 m, 4 m, 8 m, 16 m; the 7th claim never happens; `last_error` is retained and the row is counted |
| T33 | integration | R44 | A `DeviceNotRegistered` ticket **and** a `DeviceNotRegistered` receipt each delete the device row and schedule no retry |
| T34 | integration | R45 | Registering a token held by another user reassigns it, deletes the old row, returns `reassigned: true`, and does **not** error |
| T35 | e2e | R46 | Sign-out deletes the device row **before** the session is cleared; asserted by a network capture ordering, not by end state |
| T36 | integration | R47 | Receipts fetched at 15 min in chunks of ≤ 1000; a ticket unresolved at 24 h becomes `receipt_unknown` and is never retried |
| T37 | integration | R48 | A user with two devices receives two messages; a user with one receives one; suppressed users receive none |
| T38 | e2e | R49 | Two identical `notification_id` pushes render once; the ring holds 200 and evicts oldest-first; a cleared cache allows exactly one stale duplicate |
| T39 | integration | R50 | Synthetic `MismatchSenderId` and `InvalidCredentials` tickets each fire a page, not a ticket |
| T40 | integration | R51 | The iOS badge equals the server unread count at drain time; Android delivery does not depend on a badge |
| T41 | integration | R52 | Priority and collapse key per kind match §6.3 exactly; five `request_received` on one listing collapse to one banner and five inbox rows |
| T42 | integration | R53 | A dead-letter rate crossing 0.5% over 15 minutes pages |
| T43 | e2e | R54 | Tapping a push refetches the target before navigation resolves; the screen never renders half-populated |
| T44 | e2e | R55, R56 | Expired, withdrawn, deleted, thread-closed, and blocked targets all land on the tab root with the **same** toast string and no cause property in analytics |
| T45 | e2e | R57, R58 | Cold start from a notification with the app not running: the link is held through session, email, onboarding, and tab guards, replayed exactly once, and not replayed on the next foreground. Repeated from a signed-out cold start |
| T46 | e2e | R59, R60 | A foreground push shows no banner and no sound, increments the badge, and invalidates the right prefix; tapping marks that notification read immediately |
| T47 | integration | R61 | App foreground refetches `qk.notifications()` and the unread count; anything that arrived while backgrounded appears |
| T48 | e2e | R62 | The inbox row and the push render the same title and body, from the same row |
| T49 | perf | §11 | `notifications_select_own` keeps the inbox p95 under 50 ms at 10× launch volume with 2M rows; `EXPLAIN` baseline committed ([RLS Design §8](../01-architecture/05-rls-design.md)) |
| T50 | manual | §12 | VoiceOver and TalkBack over the inbox, the badge, the preferences screen including the always-on safety row, and the permission explainer |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T51 | `POST /rest/v1/notifications` directly, to write a notification into another user's inbox | Denied. There is no INSERT policy on `notifications` for `authenticated`; the only write path is `app.enqueue_notification`, which is not granted to `authenticated`. A user-writable inbox is a phishing surface with our name on it |
| T52 | `PATCH /rest/v1/notifications?id=eq.X` with `{"read_at": null}` or `{"body": "…"}` | Denied — no UPDATE policy. `read_at` moves only through `mark_notifications_read`, which filters on `user_id = auth.uid()` |
| T53 | `GET /rest/v1/notifications?user_id=eq.<someone else>` and `?select=*` with no filter | Zero rows. RLS is the filter, not the query string, and the absence of rows is indistinguishable from an empty inbox |
| T54 | `mark_notifications_read` with 500 ids belonging to another user | `marked: 0`, no error. Reporting "those weren't yours" would confirm the ids exist |
| T55 | `UPSERT notification_preferences` with `user_id` set to another user | Denied by the owner-only `WITH CHECK`. Turning off someone else's safety alerts is the attack this prevents |
| T56 | `UPSERT notification_preferences` with `enabled_kinds` omitting `safety_alert`, with an empty array, and with `'{}'` | All rejected by `prefs_safety_alert_pinned` (R24). Then, with the constraint dropped in a test fixture, `should_deliver` still returns `true` (R23) — the two controls are proven independent |
| T57 | Set `quiet_hours_start = quiet_hours_end` to make an all-day quiet window, then send a `safety_alert` and an `exchange_cancelled` | Both deliver. The 24 h window is legal and suppresses everything suppressible; the non-suppressible kinds are non-suppressible |
| T58 | Enqueue a notification with `{"lat": 42.28, "lng": -83.74}` in the payload, and with `{"spot": {"point": {...}}}` nested | Both rejected by `notifications_payload_no_coords` (R06), which rolls back the enclosing state transition. Asserted as `service_role` as well, so the drain cannot smuggle one in |
| T59 | Edit a template to `{item_title} at {garden_address}` | CI contract test fails before merge (no call site supplies the key); at runtime `render_template` raises and the transaction rolls back (R05). No lock screen ever sees a brace or an address |
| T60 | Craft a `message_received` whose body is 2000 characters of a home address | Truncated to 140 on a word boundary (R18) — which does not make it safe, and is not claimed to. Address sharing in message bodies is `content-scan`'s problem and is honestly a **flag, not a prevention** ([Location Privacy §12.2](../01-architecture/04-location-privacy.md)). The test exists so this is a documented limitation rather than an assumed protection |
| T61 | Subscribe to `user:{someone else's id}` on the realtime channel | Zero events over 30 seconds. Realtime evaluates the subscriber's RLS policies before emitting ([Realtime & Notifications §1.1](../01-architecture/08-realtime-and-notifications.md)) |
| T62 | Introspect the `supabase_realtime` publication for `notifications` | Column list is exactly `id, user_id, kind, title, body, deep_link, payload, read_at, created_at`; no coordinate column and no `handoff_code` (API-08) |
| T63 | Register a device with a token belonging to another user, repeatedly, to hijack their notifications | The token is reassigned to the caller (R45) — which is the intended behaviour for a genuinely shared phone, and which an attacker can only exploit if they already possess the victim's live Expo token. Documented as accepted residual: the token is P1 and reaching one requires already having the device or the project credentials |
| T64 | Read `devices.expo_push_token` for another user | Zero rows (owner-only Pattern A). The token is a write primitive for anyone with project credentials |
| T65 | Query `private.notification_outbox`, `private.notification_templates`, or `private.push_tickets` as `authenticated` | Permission denied at the schema level. `REVOKE ALL ON SCHEMA private FROM anon, authenticated` and the schema is not in PostgREST's exposed list ([Data Model §3](../01-architecture/03-data-model.md)) |
| T66 | Invoke `POST /functions/v1/push-drain` with a valid user JWT | 403. The function allow-lists the invoking role and is reachable only by `service_role` ([API Contract §6.4](../01-architecture/06-api-contract.md)). Repeated for `push-receipts` |
| T67 | Flood `mark_notifications_read` at 600/min | 60 succeed, the rest `rate_limited` 429 with integer `Retry-After`; the client's queue backs off and does not auto-retry into the limit ([API Contract §7.3](../01-architecture/06-api-contract.md)) |
| T68 | Attempt to buzz a target's phone repeatedly by sending messages | Bounded by `messages` INSERT at 20/min/user and 10/min/thread, and by the `thread:{thread_id}` collapse key, which reduces N messages to one lock-screen line. A block ends it entirely and silently ([SPEC-012 R37](SPEC-012-trust-and-safety.md)) |
| T69 | Contract sweep over `notifications`, `notification_preferences`, `devices`, and both RPC return types | No column matching the coordinate regex, no `handoff_code`, no `trust_score`. Nothing added to the API-04 allowlist ([API Contract §9.1](../01-architecture/06-api-contract.md)) |
| T70 | Fire a Sentry event and a PostHog event carrying a rendered title, a body, a payload, and an `expo_push_token` | All four dropped by the scrubber's key rules and the analytics property allow-list; a lint rule fails the source that tried (API-07) |
| T71 | Inspect the wire for a full request → accept → schedule → remind → complete cycle with push enabled | No coordinate, no handoff code, no cancellation reason, no trust score. The only place name present is a safe spot's `name` |
| T72 | Force the drain to run against 10,000 outbox rows with 30% suppressed and 10% dead-lettered | Batches of 100, no double-sends, no lock contention, suppressed rows keep their inbox rows, dead letters stop being claimed, and the whole backlog drains monotonically |

### 13.3 Manual QA

- [ ] On a real device, send the first exchange request and confirm the explainer appears immediately afterward and the system dialog only after accepting it.
- [ ] Decline the explainer, confirm the system dialog never appeared, and confirm the app is fully usable with the inbox complete.
- [ ] Set quiet hours 22:00–07:00, trigger a `message_received` at 02:00 and an `exchange_cancelled` at 02:01, and confirm exactly one buzz.
- [ ] Schedule an exchange for 07:00 with quiet hours until 08:00 and confirm the 05:00 reminder arrives.
- [ ] Confirm there is no switch anywhere for safety alerts, and that the row explains why.
- [ ] Force-quit the app on an Android device known for aggressive battery management, send a push, and confirm the inbox is complete on next open even though nothing arrived.
- [ ] Cold-start from a push tap with the app fully quit, signed out, and confirm the link survives sign-in and onboarding and fires exactly once.
- [ ] Tap a push for an exchange that has since been cancelled and confirm the toast and the tab root, then repeat for a blocked counterparty and confirm the screens and the network capture are identical.
- [ ] Sign out on a shared device, sign in as a second user, and confirm the first user receives nothing on that phone.
- [ ] Reinstall the app and confirm notifications resume on the next cold start with no user action.
- [ ] Read a full inbox with VoiceOver and confirm each row is one utterance including unread state.
- [ ] Confirm every string at 200% type in both themes, particularly the quiet-hours exception list and the denied-permission banner.

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `notifications.surplus_alert` (Phase 2, default-off) is the only flag. The MVP catalog is not flagged: an exchange product where the owner is not told someone asked for their tomatoes is not a product, and a kill switch for the whole notification system would be a kill switch for the inbox, which is the record. Individual kinds can be disabled by setting `private.notification_templates.is_active = false`, which suppresses the **push** and keeps the inbox row — the same distinction as R26, applied operationally. |
| Migration required | Yes. `20260808_0131_notifications.sql` — two CHECKs on `notification_preferences`, one recursive payload CHECK, two indexes, `app.render_template`, `app.jsonb_has_coord_key`, `private.push_tickets`, eleven template rows, and one `pg_cron` job. The `drain_notification_outbox` job already exists ([Realtime & Notifications §3.2](../01-architecture/08-realtime-and-notifications.md)) and is asserted present by the post-migration smoke check rather than recreated. |
| Backfill required | Yes, small. `notification_preferences` rows missing `safety_alert` are updated before `prefs_safety_alert_pinned` is added, and the migration **fails loudly** rather than silently mutating if any row's `enabled_kinds` is NULL. At MVP there are no production rows; the assertion is written for the day that stops being true. |
| Rollback plan | Forward-only ([Data Model §15](../01-architecture/03-data-model.md)). A bad drain is disabled with `cron.unschedule('drain_notification_outbox')`, which is safe **because the outbox is durable**: rows accumulate, nothing is lost, and they deliver when it is re-enabled. A bad template is fixed by an `UPDATE` on `private.notification_templates` and takes effect on the next enqueue with no deploy. A bad Android channel importance value is **not** fixable in place — channel importance is immutable after creation — and requires a new channel id in a client release, which is why R39 makes the initial values a review item. |
| Client version floor | None. An older client ignores unknown `payload` keys and falls back to `sharecropr://notifications` for an unmapped `kind` (R19), so adding a kind is additive by construction ([API Contract §3.2](../01-architecture/06-api-contract.md)). Removing one is not, and is a `_v2` conversation. |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |
| Q1 | Should `message_received` carry a body preview at all? It is genuinely useful and it puts user-generated text on a lock screen a third party can read. Options: preview (current), sender-only, or a user preference — and a preference means a second thing to explain on a screen that is already dense. *(Carried from [Realtime & Notifications §9 Q1](../01-architecture/08-realtime-and-notifications.md).)* | Product + Security | Before launch |
| Q2 | Should a notification suppressed by quiet hours be re-sent when quiet hours end, or stay inbox-only? Re-sending produces a 07:00 burst of six banners; not re-sending means a time-sensitive item waits for the user to open the app. A middle path — re-send only `request_received` and `request_accepted` — is more code and another rule to explain. | Product | Before launch |
| Q3 | Is 6 attempts / ~30 minutes the right dead-letter point for every kind? A push about a meeting in two hours is worth retrying for an hour; one about a declined request is not worth thirty minutes. Per-kind retry budgets are obviously correct and add a column, a branch, and a test matrix. | Architecture | Post-launch data |
| Q4 | The 24-hour `exchange_reminder` is quiet-hours suppressible, which means a user with 22:00–07:00 quiet hours and a 23:00 scheduling action can miss it entirely and then receive only the 2 h one. Should the 24 h reminder instead defer to the end of quiet hours rather than being dropped? | Product | Before launch |
| Q5 | `exchange_reminder` names a person, a public place, and a time on a lock screen. Should it name the safe spot at all, or say "your exchange" and make the user open the app? Naming it is materially more useful for someone leaving the house; not naming it removes the only genuinely sensitive string in the catalog. | Product + Security | Before launch |
| Q6 | Should we detect OS-level permission revocation after an initial grant and surface it? We can observe it client-side on each cold start, but not server-side, and a user who revoked permission deliberately does not want a banner about it. Currently we show the standard denied banner and nothing more. | Mobile | Post-launch |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Backend Engineering + Mobile | Initial spec |
