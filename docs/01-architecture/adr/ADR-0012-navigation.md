# ADR-0012: Expo Router over React Navigation used directly

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Sharecropr's navigation graph is moderate in size and awkward in shape. There is a tab shell (map, inventory, exchanges, profile), a modal stack over it (listing detail, request composer, filters), a linear onboarding flow that must be entered from a cold start and cannot be escaped mid-way (account → TOTP → KYC → garden), and deep links that arrive from push notifications into arbitrary depth — a `request_accepted` notification opens a specific exchange session, from a cold launch, possibly while the user is unauthenticated.

Two constraints matter more than screen count.

**Deep links are a safety path, not a convenience.** Notification kinds include `safety_alert`, which is non-suppressible and ignores quiet hours ([Data Model §12](../03-data-model.md#12-notifications-devices-audit)). A deep link that lands on the wrong screen, or fails to build a back stack, or silently drops when the app is cold, is a safety defect. Whatever we choose has to make cold-start deep linking boring.

**Deep links must not be able to carry a coordinate.** [Location Privacy §8](../04-location-privacy.md#8-egress-controls--where-leaks-actually-happen) states it as an egress control: "No route accepts or emits a coordinate parameter." Enforcing that is much easier if routes are declared in a place a CI check can read, rather than assembled at runtime from nested navigator configurations.

React Navigation is the underlying library either way — Expo Router is built on it. The question is whether we configure it imperatively ourselves or let a file-based router generate the configuration.

## Decision

**Use Expo Router with file-based routing and typed routes enabled.**

```
app/
  _layout.tsx                     # root: auth gate, providers, deep-link config
  (onboarding)/
    _layout.tsx                   # linear stack; no tab bar; guarded exit
    account.tsx  totp.tsx  verify.tsx  garden.tsx
  (tabs)/
    _layout.tsx                   # tab shell
    index.tsx                     # map
    inventory/  exchanges/  profile/
  exchange/[sessionId].tsx        # push target
  listing/[listingId].tsx
  (modals)/
    filters.tsx  report.tsx
  +not-found.tsx
```

| Setting | Value |
| --- | --- |
| Typed routes | `experiments.typedRoutes: true`. `router.push('/exchange/abc')` is type-checked against the file tree |
| Auth gating | Route groups + a redirect in `app/_layout.tsx`. Guarding is one place, not per-screen |
| Deep links | Path-based, derived from the file tree. No hand-maintained `linking` config to drift |
| Params | **IDs only.** A CI check greps `app/**` for route segments and query params matching `/lat|lng|latitude|longitude|coord|point|h3_r[89]/i` and fails the build |
| Modals | `(modals)` group with `presentation: 'modal'` in its layout |
| Navigation state | Not persisted across cold starts. A cold start resolves the deep link or lands on the tab root; restoring a stale stack into a changed exchange state is a correctness hazard |
| Escape hatch | React Navigation APIs remain available underneath for anything the router cannot express |

Onboarding is a guarded group: `(onboarding)/_layout.tsx` reads verification and garden status and redirects, so there is no combination of `router.push` calls that lands a half-onboarded user on the map.

## Alternatives considered

### React Navigation configured directly

**What it is.** Navigators composed in TypeScript, a hand-written param list per navigator, a hand-maintained `linking` configuration.

**Why we didn't.** It is the same library with more manual work, and the manual work is concentrated in exactly the place we care most about. The `linking` config is a second source of truth for the route graph that must be kept in sync with the navigator tree by hand; when it drifts, deep links break silently for the subset of paths nobody tested from a cold start. Param typing works but is maintained separately from the navigators, so a renamed screen is a runtime failure rather than a compile error. And the coordinate-in-route CI check becomes a grep over arbitrary TypeScript rather than over a directory tree.

The honest counterpoint: it is more explicit, and for a graph with unusual conditional structure that explicitness can be worth it. Ours is not unusual enough.

### Expo Router without typed routes

**What it is.** File-based routing, string-based navigation.

**Why we didn't.** Gives up the main compile-time benefit for nothing. Typed routes cost a build-time codegen step and catch the entire class of "renamed the file, forgot a `push`" bugs — which is the most common navigation defect in any app.

### `react-native-navigation` (Wix)

**What it is.** Native navigation primitives rather than JS-driven screens; genuinely better transition performance.

**Why we didn't.** Not compatible with the Expo managed/CNG story without significant work, a smaller and slower-moving ecosystem, and a native-first model that makes conditional and guarded routing awkward. The performance we would gain is on transitions; our performance problem is the map ([ADR-0013](ADR-0013-map-library.md)), which this does not touch.

### A single-screen app with modal composition

**What it is.** One screen, conditional rendering, no router.

**Why we didn't.** Loses deep linking, back-button semantics, and state restoration — all three of which are requirements here.

## Consequences

### Positive

- The route graph is the file tree, so it is readable in a directory listing and reviewable in a diff.
- Deep links, including cold-start push targets, work from the file structure with no parallel config to maintain. This is the biggest single win given `safety_alert`.
- Typed routes turn navigation mistakes into compile errors.
- Layout-level auth and onboarding gating happens in one file per group rather than scattered across screens.
- The coordinate-in-route CI check is a mechanical grep over `app/**`, which makes a privacy invariant cheap to enforce.
- Route-based code splitting and lazy screen loading come for free.

### Negative

- **File structure and URL structure are coupled.** Reorganizing files for code-hygiene reasons changes routes, and routes are in shipped push notification payloads. A moved file can break a deep link for users on an older build.
- Route groups (`(tabs)`, `(modals)`) are a syntax that has to be learned and is easy to get subtly wrong.
- Debugging a redirect loop across nested `_layout.tsx` files is harder than reading one navigator config, because the logic is distributed by design.
- Expo Router versions are tied to Expo SDK versions, so a navigation bug fix may require an SDK upgrade ([ADR-0001](ADR-0001-mobile-stack.md)).
- Typed-route generation adds a build step that occasionally needs a cache clear after a rename.

### Neutral / accepted costs

- Some React Navigation documentation and community answers do not translate directly, requiring a mental mapping.
- Deep-link paths are effectively a public contract once a notification carrying one has been delivered. Treat route renames like API changes: additive, with the old path redirecting for at least two versions ([ADR-0017](ADR-0017-release-cadence.md)).
- Not persisting navigation state is a deliberate UX cost — a killed app returns to the tab root rather than where the user was.

## The strongest argument against this decision

File-based routing is a web idea, and the reason it works on the web is that URLs are the actual navigation model — the browser owns history, the back button, and state restoration, and a file tree is a faithful description of that. Native apps do not work that way. Native navigation is a stack of view controllers with modal presentation, gesture-driven dismissal, per-platform transition semantics, and nested navigators with independent histories — a structure that is genuinely a tree of navigators, not a tree of paths. Expo Router flattens that into a filesystem and then reintroduces the missing expressiveness through conventions: parenthesized groups that do not appear in the URL, bracketed dynamic segments, plus-prefixed special files, and `_layout` files whose ordering and nesting determine behaviour that is not visible in any single file. That is a domain-specific language encoded in filenames, and when it goes wrong — a redirect loop between two layouts, a modal presenting inside the wrong group, a tab bar appearing where it should not — the debugging experience is worse than reading an explicit navigator tree, because there is no single artifact describing the resulting configuration. React Navigation configured directly gives you one file you can read top to bottom and a stack trace that points at it.

There is a coupling cost too, and it is the kind that only hurts later. Renaming `app/exchange/[sessionId].tsx` is a route change, and routes are baked into push notification `deep_link` values already delivered to devices running older builds. A refactor that looks like moving a file is, in fact, a backward-compatibility event governed by [ADR-0017](ADR-0017-release-cadence.md)'s two-version rule. With an explicit `linking` config, the URL contract and the file layout are independently movable — you can reorganize code freely and change the mapping in one place. We have traded that independence for the convenience of never writing the mapping down.

We accept it because deep linking correctness from a cold start is the requirement we most need to be boring, and a single generated source of truth is the most reliable way to get it. But the route-rename discipline has to be enforced like an API contract, not treated as a refactor.

## Revisit when

- A deep link fails to resolve correctly in production more than **twice in a quarter**, or any `safety_alert` notification fails to open its target. One safety-alert failure is enough to reopen this.
- Debugging navigation behaviour consumes more than **half a day** on any single issue, twice in a quarter.
- The `app/` tree exceeds **40 route files** and the group structure is no longer legible in a directory listing.
- We need a navigation pattern Expo Router cannot express without dropping to React Navigation APIs in more than **three** places.
- Expo Router blocks an Expo SDK upgrade, or an SDK upgrade forces a route-structure migration.
- Transition performance becomes a measurable complaint (>50 ms of jank on screen push, p95), which would point at `react-native-navigation` rather than at a config change.

## Related

- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0011 State management](ADR-0011-state-management.md), [ADR-0013 Map library](ADR-0013-map-library.md), [ADR-0017 Release cadence](ADR-0017-release-cadence.md)
- [System Architecture §3](../01-system-architecture.md#3-container-view), [Location Privacy §8](../04-location-privacy.md#8-egress-controls--where-leaks-actually-happen), [Data Model §12](../03-data-model.md#12-notifications-devices-audit)
