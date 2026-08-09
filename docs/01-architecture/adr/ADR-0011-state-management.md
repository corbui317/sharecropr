# ADR-0011: TanStack Query + Zustand + MMKV

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Almost everything on screen in Sharecropr is **server state**: listings, safe spots, inventory, exchange requests, messages, the counterparty's profile. It is owned by Postgres, it can change without the client's involvement (the other party accepts a request; a Realtime event arrives), and the client's copy is a cache that is always some amount of stale.

The classic Redux mistake is treating that as client state — copying it into a store, writing reducers to keep it fresh, and then owning cache invalidation by hand forever. The category error is the expensive part: server state needs staleness, background refetch, deduplication, retry, and invalidation. Client state needs none of those and a store that provides them is overhead.

There *is* genuine client state, and it is small: map viewport and selected marker, multi-step form drafts (garden registration, listing creation), filter selections, transient UI flags. None of it belongs on the server; some of it must survive a screen change; almost none of it must survive app restart.

Finally, mobile has requirements web does not. The app is killed and relaunched constantly, so a cold start showing spinners on data we had five minutes ago feels broken. Connectivity is intermittent — a gardener at a library with bad signal must still see their scheduled exchange. And there is a hard constraint from [Location Privacy](../04-location-privacy.md): whatever cache we choose holds counterparty names, exchange times, and safe-spot data, so it must be purgeable on logout and must never hold anything the invariant forbids.

## Decision

**Three tools, three jobs, with a rule for which is which.**

| Layer | Tool | Owns | Rule |
| --- | --- | --- | --- |
| Server state | **TanStack Query v5** | Anything that came from or goes to Postgres | If it has an `id` from the database, it lives here. No exceptions |
| Client state | **Zustand** | Map viewport, form drafts, filters, UI flags | Must not duplicate anything Query owns |
| Persistence | **MMKV** | Query cache persister + a small Zustand slice | Never secrets — those are in `expo-secure-store` ([ADR-0007](ADR-0007-token-storage.md)) |

### Query configuration

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // most screens tolerate 30s
      gcTime: 24 * 60 * 60 * 1000,
      retry: (n, e) => !isAuthError(e) && n < 3,
      refetchOnWindowFocus: true, // wired to AppState, not window
    },
  },
});

persistQueryClient({
  queryClient,
  persister: createMMKVPersister(cacheStorage),   // MMKV, non-encrypted, purged on logout
  maxAge: 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    // Never persist anything volatile or sensitive.
    shouldDehydrateQuery: (q) => !NON_PERSISTED_KEYS.has(q.queryKey[0] as string),
  },
});
```

`NON_PERSISTED_KEYS` covers the user's own exact garden location, handoff codes, and any KYC state.

### Rules

- **Query keys are generated from a typed factory** (`keys.listings.near(spotId)`), never string literals. Invalidation targets a key path, not a guess.
- **Realtime events invalidate; they do not write.** A WebSocket message calls `queryClient.invalidateQueries` and the refetch goes through RLS. Writing server-pushed payloads straight into the cache would create a second path into client state that never passed a policy check.
- **Optimistic updates only where rollback is unambiguous** — marking a message read, toggling a filter. **Never on an exchange state transition.** The state machine is authoritative and a rolled-back optimistic "accepted" is a lie about a physical meeting ([Exchange State Machine §8](../07-exchange-state-machine.md#8-client-mirroring)).
- **Zustand stores are small, named by domain, and never hold server entities.** A lint rule flags any store field whose type comes from the generated database types.
- **Logout purges MMKV entirely** and calls `queryClient.clear()`. Tested, because the failure is a previous user's counterparty names visible to the next.

## Alternatives considered

### Redux Toolkit (+ RTK Query)

**What it is.** The default answer for a decade; RTK Query is a competent server-cache layer.

**Why we didn't.** RTK Query is genuinely good and would work. But adopting it means adopting Redux — the store, the slices, the provider, the devtools, the serializability constraints — to get a caching layer we can have standalone. The boilerplate tax is real at this team size, and the cultural pull is worse: once a Redux store exists, server data ends up in it, because that is what the store is for. The `createSlice` era made this much better than it was; it did not make it lighter than "no store at all."

### Jotai (or Recoil)

**What it is.** Bottom-up atomic state; fine-grained subscriptions; excellent React integration.

**Why we didn't.** Atoms are an elegant answer to a problem we have very little of. Our client state is a handful of independent concerns — viewport, drafts, filters — with no dependency graph between them, which is precisely the situation where atomic derivation buys nothing. Jotai's strength is derived-state graphs; ours is four unrelated values. Zustand's single-store-per-domain model is simpler to read and to debug, and its API surface is small enough that a new engineer learns it in ten minutes.

### TanStack Query alone, no client store

**What it is.** Query for server state, `useState`/context for the rest.

**Why we didn't.** Nearly right, and the temptation. It fails on two specific things. Form drafts must survive navigation — a user registering a garden navigates to the map to pick a location and back — and prop-drilling or context for that produces re-render storms on the map screen. And the map viewport is read by several sibling components at high frequency; context re-renders every consumer on every pan, which is exactly the frame budget [ADR-0001](ADR-0001-mobile-stack.md) is worried about. Zustand's selector subscriptions solve both, in about 200 lines total.

### Zustand alone, hand-rolled fetching

**What it is.** One store, manual `fetch`, manual loading flags.

**Why we didn't.** This is reimplementing Query, badly, and the parts that get skipped first — request deduplication, retry with backoff, background refetch, stale-while-revalidate — are the parts that make a mobile app feel fast.

### WatermelonDB / offline-first sync engine

**What it is.** A local database with real sync, conflict resolution, and offline mutation queues.

**Why we didn't.** Correct for an offline-first product; we are not one. Exchange state transitions cannot be resolved client-side — they are locked, ordered, multi-row operations in Postgres ([Exchange State Machine §5](../07-exchange-state-machine.md#5-concurrency-hazards)) — so an offline mutation queue would queue operations that can only fail. Our offline requirement is *read* the cache, not *write* to it. Enormous complexity for a capability the domain forbids.

## Consequences

### Positive

- Server state has one owner with correct semantics: staleness, dedup, retry, background refetch, and invalidation, none of it hand-written.
- MMKV persistence makes cold start show real data immediately instead of skeletons.
- Offline reads work for free — the persisted cache serves the last known inventory and schedule with an offline banner.
- Zustand adds ~1 KB and no provider ceremony; selector subscriptions keep the map screen from re-rendering on unrelated state changes.
- The "does it have a database id?" rule makes the layering question mechanical in review.
- Realtime-invalidates-rather-than-writes keeps every path into the cache behind an RLS-checked read.

### Negative

- **Three libraries instead of one**, and the boundary between them is a convention that will be violated at least once.
- Persisted cache and schema evolve independently; a shipped model change against a stale persisted cache produces confusing UI. Mitigated by a cache-version key bumped on any generated-types change.
- MMKV is a native module, so it is on the prebuild path and constrains the Expo upgrade cadence.
- The persisted cache is a plaintext file containing counterparty display names and exchange times. Not P0, but not nothing — hence the explicit purge and the `shouldDehydrateQuery` denylist.

### Neutral / accepted costs

- Query key hygiene requires the factory and the discipline to use it.
- Devtools are weaker than Redux's time-travel debugging. Query's devtools are adequate; nothing here matches Redux DevTools.
- New engineers must learn where the boundary is. That is one paragraph of onboarding.

## The strongest argument against this decision

Three state libraries with a hand-written rule separating them is a convention, and conventions decay under deadline. The rule "if it has a database id it belongs to Query" is clean until the first genuinely ambiguous case, which arrives quickly: the multi-step listing form holds a `species_id` and an `inventory_item_id`, both database ids, in a draft that is unmistakably client state. Someone resolves it one way, someone else resolves the next case the other way, and within a year there is server data in Zustand stores being manually synced against Query's cache — the exact Redux failure mode, reached by a different road, but now spread across two libraries instead of contained in one. A single Redux Toolkit store with RTK Query would have made the boundary structural rather than cultural: one store, one set of devtools, one place to look when the UI shows something stale, and a serializability constraint that makes "just stash the fetched object here" visibly wrong. The boilerplate we avoided is a real but one-time cost; the ambiguity we accepted is permanent and recurring.

The two-cache problem sharpens it. MMKV persists Query's cache, and Zustand can persist its own slice, so there are two persistence layers with independent lifetimes and independent invalidation. Logout has to clear both. A cache-version bump has to consider both. A user who force-quits mid-form can restore a Zustand draft referencing a listing that Query's cache no longer contains, and nothing in the type system notices. Redux Toolkit with `redux-persist` would have had exactly one answer to all of those questions.

We accept this because the total code is small, the lint rule catches the specific violation we predict (database types in a Zustand store), and the alternative's cost is paid on every feature while ours is paid only at boundary cases. But if the boundary starts leaking, consolidating onto RTK Query is a better outcome than defending a convention nobody follows.

## Revisit when

- More than **three** instances of server-derived data are found living in a Zustand store, or the lint rule is suppressed more than twice.
- Any Zustand store exceeds **150 lines** or holds more than **10** fields.
- Cache-related bug reports (stale data, wrong data after logout, ghost entries) exceed **2 per release**.
- Cold-start time-to-first-meaningful-paint exceeds **1.2 s p95** and cache hydration is the profiled cause.
- We add a genuine offline-write requirement — which would mean the exchange model changed and would need its own ADR before this one.
- TanStack Query ships a breaking major that changes persistence or invalidation semantics.

## Related

- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0007 Token storage](ADR-0007-token-storage.md), [ADR-0012 Navigation](ADR-0012-navigation.md), [ADR-0013 Map library](ADR-0013-map-library.md)
- [System Architecture §3, §4](../01-system-architecture.md), [Exchange State Machine §8](../07-exchange-state-machine.md#8-client-mirroring), [Location Privacy §8](../04-location-privacy.md#8-egress-controls--where-leaks-actually-happen)
