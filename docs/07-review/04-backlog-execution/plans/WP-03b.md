# WP-03b — Move AppState out of src/api; drop the supabase.ts lint exemption; amend mobile-arch §1/§5 (SCRUM-62; SCRUM-15 AC2)

Planner: Opus · Executor: Sonnet (own worktree, do NOT commit) · Integrator: Haiku · Class: do
Repo: `/Users/cxb317/Documents/ai/sharecropr`, branch `develop`, planned against HEAD `3d30cc7` (Jest + RNTL already landed). Node 22, npm.

**Decision being implemented (Corey, SCRUM-62, 2026-10-21):** move the AppState listener out of `src/api` into an app boot hook. The hook calls `startAutoRefresh` and `stopAutoRefresh`, which `supabase.ts` exports. Amend the mobile-architecture §5 snippet and list the sanctioned `src/api` adapters in §1. This plan does not reopen that decision.

## 0. Context verified (file:line)

**Everything in `src/api` that imports a native module** (from `grep -rn "from '" src/api`):

| File:line | Import | Disposition |
|---|---|---|
| `src/api/supabase.ts:1` | `import { AppState, type AppStateStatus } from 'react-native'` | **Moves.** This is the decision. |
| `src/api/supabase.ts:39-47` | `handleAppStateChange`, plus a module-level `AppState.addEventListener('change', …)` | **Moves** to the boot hook. |
| `src/api/query-cache.ts:1` | `react-native-mmkv` | **Sanctioned.** Already in §1.1a (`02-mobile-architecture.md:63`) and in the `eslint.config.js:60-64` comment. |
| `src/api/query-cache.ts:2` | `expo-crypto` | **Sanctioned.** See `02-mobile-architecture.md:65`. |
| `src/api/query-cache.ts:3`, `src/api/secure-storage.ts:1` | `expo-secure-store` | **Sanctioned.** See `02-mobile-architecture.md:64`. Invariant 6 / NFR-48 require it. |

- No other file under `src/api` imports `react-native`, `expo-*` or `react-native-*`. The directory holds only `query-cache.ts`, `secure-storage.ts` and `supabase.ts`.
- **The docs already contradict themselves on AppState.**
  - `02-mobile-architecture.md:66` lists AppState as "Temporary, undecided … SCRUM-62".
  - The §5.3 snippet puts the listener in `supabase.ts` (`:806`, `:830-835`).
  - ADR-0007 has the same snippet (`adr/ADR-0007-token-storage.md:80-82`).
- **Lint exemption to remove** (`eslint.config.js`):
  - `:69-77` `apiIsolation({ allowReactNative })`
  - `:80-91` the `SCRUM_62_APPSTATE_ONLY` path with its TODO
  - `:137-146` block 4, which passes `paths: [SCRUM_62_APPSTATE_ONLY]` and `apiIsolation({ allowReactNative: true })`
  - `restrict` (`:93`) defaults `paths` to `[]`, so dropping `paths` is safe.
- **Fixtures** (`eslint-fixtures/cases.mjs`):
  - `:14` `SCRUM62` constant
  - `:53-60` the `supabase.ts` cases: `sb-ok-appstate` passes today; `sb-rn-platform` and `sb-rn-namespace` match `SCRUM62`
  - `:8` header says "SCRUM-62 (open)"
  - `api-rn-appstate` (`:41`) already proves AppState fails in a generic `src/api` file. What is missing is the same proof for `supabase.ts` itself.
  - The runner is `scripts/lint-fixtures.mjs`. It lints each case at its `path` with the real config.
- **AGENTS.md:139** ends "supabase.ts's AppState-only react-native exemption is pending SCRUM-62 — [mobile-arch §1.1a](…)". AGENTS.md is 150 lines. The bridge check (`scripts/agent-memory-bridge.sh:80-120`) only checks the CLAUDE.md symlink, the Cursor rule and a line count of 200 or less. A one-line in-place edit keeps it passing.
- **Spec trace:**
  - SPEC-001 R24 (`docs/03-specs/SPEC-001-authentication.md:97`): "Auto-refresh is driven by AppState: startAutoRefresh() on active, stopAutoRefresh() otherwise. A single-flight lock prevents concurrent refreshes."
  - SPEC-001 T18 (`:489`, unit, R24): "AppState transition to background calls stopAutoRefresh; two concurrent refresh calls result in one network request." **T18 is the T-ID for every test in this package.**
- **SDK behaviour that sets the boot-time design** (`node_modules/@supabase/auth-js` 2.112.4, `dist/main/GoTrueClient.js`):
  - `_handleVisibilityChange` (`:4704-4711`): on non-browser platforms, `autoRefreshToken: true` calls `startAutoRefresh()` when the client initialises. On React Native the ticker is therefore already running before any hook mounts.
  - `_startAutoRefresh` (`:4445-4446`) calls `_stopAutoRefresh` first, so a repeated start is idempotent.
  - `startAutoRefresh` and `stopAutoRefresh` (`:4544`, `:4578`) return `Promise<void>`.
- **Where the hook lives.**
  - The mobile-arch §1 table (`:28`) says `src/app` may import only `features` and `ui`, and never `api` directly. So the hook cannot live in `app/` and import `@/api/supabase`. It must be a feature hook, and `app/_layout.tsx` mounts it.
  - Repo convention puts hooks in `src/features/*/hooks` (`02-mobile-architecture.md:226`: "hooks live in features and call repositories"). Auth already owns the session (`src/features/auth/hooks/useAuthSession.tsx`).
  - The app root is `app/_layout.tsx:7-17`. `AuthProvider` sits inside the safe-area and gesture providers.
- **Test runner.**
  - `jest.config.js:17-23`: the `app` project runs every `**/__tests__/**/*.test.ts(x)` outside `src/domain` under jest-expo.
  - RN's jest preset mocks AppState (`node_modules/@react-native/jest-preset/jest/mocks/AppState.js`): `addEventListener` is a `jest.fn` returning `{ remove }`, and `currentState` is a `jest.fn`, not a string. Tests must therefore set `currentState` themselves.
  - RNTL 14 `renderHook` and its `unmount` return promises (`node_modules/@testing-library/react-native/dist/render-hook.d.ts`).
  - `@typescript-eslint/no-floating-promises` is `error` in `__tests__` (`eslint.config.js:152-157`).
  - The existing pattern to follow (`@jest/globals` imports, `jest.mock` factories that use `jest.fn`) is `src/features/auth/screens/__tests__/SignInScreen.test.tsx:1-26`.
- **Grep trap:** `grep -rn "react-native" src/api` will still print `query-cache.ts:1` (`react-native-mmkv`), which is sanctioned. New comments and tests under `src/api` must not contain the string `react-native`; write "React Native" instead.

## 1. Exact edits per file (in order; tests first)

### Step 1 — RED: tests and fixtures before the code

**1a. NEW `src/features/auth/hooks/__tests__/useAuthAutoRefresh.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { startAutoRefresh, stopAutoRefresh } from '@/api/supabase';
import { useAuthAutoRefresh } from '@/features/auth/hooks/useAuthAutoRefresh';

// SPEC-001-T18 (unit, R24): AppState drives GoTrue auto-refresh — start on `active`, stop otherwise.
// The listener is this boot hook, not src/api (SCRUM-62; AGENTS.md Invariant 11).

jest.mock('@/api/supabase', () => ({
  startAutoRefresh: jest.fn(() => Promise.resolve()),
  stopAutoRefresh: jest.fn(() => Promise.resolve()),
}));

const start = jest.mocked(startAutoRefresh);
const stop = jest.mocked(stopAutoRefresh);
const remove = jest.fn();
let listener: ((state: AppStateStatus) => void) | undefined;

function setCurrentState(state: AppStateStatus) {
  // The RN jest preset mocks currentState as a jest.fn, not a string.
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true });
}

function emit(state: AppStateStatus) {
  if (!listener) throw new Error('useAuthAutoRefresh did not subscribe to AppState "change"');
  listener(state);
}

describe('useAuthAutoRefresh', () => {
  beforeEach(() => {
    listener = undefined;
    start.mockClear();
    stop.mockClear();
    remove.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'change') listener = handler;
      return { remove };
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('boots active: starts auto-refresh and subscribes to "change" (SPEC-001-T18)', async () => {
    setCurrentState('active');
    await renderHook(() => useAuthAutoRefresh());
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  test('boots in background: stops auto-refresh (SPEC-001-T18)', async () => {
    setCurrentState('background');
    await renderHook(() => useAuthAutoRefresh());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  test('boots unknown/inactive: leaves the SDK ticker alone (SPEC-001-T18)', async () => {
    setCurrentState('unknown');
    await renderHook(() => useAuthAutoRefresh());
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test.each<AppStateStatus>(['background', 'inactive'])(
    'transition to %s calls stopAutoRefresh (SPEC-001-T18)',
    async (next) => {
      setCurrentState('active');
      await renderHook(() => useAuthAutoRefresh());
      start.mockClear();
      emit(next);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
    },
  );

  test('returning to active calls startAutoRefresh (SPEC-001-T18)', async () => {
    setCurrentState('active');
    await renderHook(() => useAuthAutoRefresh());
    emit('background');
    start.mockClear();
    emit('active');
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('unmount removes the listener exactly once (SPEC-001-T18)', async () => {
    setCurrentState('active');
    const { unmount } = await renderHook(() => useAuthAutoRefresh());
    expect(remove).not.toHaveBeenCalled();
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
```

Executor notes:
- If `jest.spyOn(...).mockImplementation` does not type-check against `AppStateStatic.addEventListener`, annotate the parameters as `(type: string, handler: (s: AppStateStatus) => void)`. Do not use `any`.
- If `restoreAllMocks` wipes the `Promise.resolve()` implementations of the module mocks, the hook still works, because `void undefined` is harmless.

**1b. NEW `src/api/__tests__/supabase.test.ts`** (covers the new `src/api` contract and the single-flight half of T18). Rules for this file:
- No string `react-native` anywhere in it.
- It is linted by the `src/api` block. `jest.mock('@supabase/supabase-js', …)` is a call, not an import, so the SDK seam does not fire.
- Mocks are created **inside** the factory and read back with `jest.requireMock`. Imports are hoisted above top-level `const`s, so a factory that closes over a `mockAuth` const would hit the temporal dead zone.

```ts
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { refreshSessionSingleFlight, startAutoRefresh, stopAutoRefresh } from '../supabase';

// SPEC-001-T18 (unit, R24): src/api exposes the lifecycle calls the boot hook drives (SCRUM-62),
// and concurrent refreshes collapse into one request.

type MockAuth = {
  startAutoRefresh: jest.Mock<() => Promise<void>>;
  stopAutoRefresh: jest.Mock<() => Promise<void>>;
  refreshSession: jest.Mock<() => Promise<{ data: { session: null } }>>;
};

jest.mock('@supabase/supabase-js', () => {
  const auth = {
    startAutoRefresh: jest.fn(() => Promise.resolve()),
    stopAutoRefresh: jest.fn(() => Promise.resolve()),
    refreshSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
  };
  return { createClient: () => ({ auth }), __auth: auth };
});

const { __auth: auth } = jest.requireMock<{ __auth: MockAuth }>('@supabase/supabase-js');

describe('src/api/supabase lifecycle seam', () => {
  beforeEach(() => {
    auth.startAutoRefresh.mockClear();
    auth.stopAutoRefresh.mockClear();
    auth.refreshSession.mockClear();
  });

  test('startAutoRefresh delegates to supabase.auth.startAutoRefresh (SPEC-001-T18)', async () => {
    await startAutoRefresh();
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  test('stopAutoRefresh delegates to supabase.auth.stopAutoRefresh (SPEC-001-T18)', async () => {
    await stopAutoRefresh();
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  test('two concurrent refreshes make one refreshSession call (SPEC-001-T18)', async () => {
    await Promise.all([refreshSessionSingleFlight(), refreshSessionSingleFlight()]);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
});
```

Expect one `console.warn` about the missing `EXPO_PUBLIC_SUPABASE_*` variables when this file runs (`supabase.ts:10-14`). That is acceptable, so do not silence it. The test only proves call-collapsing in the client. The "one network request" part of T18 still belongs to integration.

**1c. EDIT `eslint-fixtures/cases.mjs`**
- `:8` header. Replace `SCRUM-62 (open).` with `SCRUM-62 (decided 2026-10-21: AppState lives in the auth boot hook).`
- `:14` delete `const SCRUM62 = 'pending SCRUM-62';`
- Replace the `:53-60` block with:

```js
  // ---- src/api/supabase.ts: exempt from the SDK seam only; NO react-native exemption (SCRUM-62) ----
  { id: 'sb-ok-sdk', path: 'src/api/supabase.ts', code: imp('@supabase/supabase-js', 'createClient'), expect: 'pass' },
  { id: 'sb-rn-appstate', path: 'src/api/supabase.ts', code: imp('react-native', 'AppState'), expect: 'fail', match: API },
  { id: 'sb-rn-appstate-type', path: 'src/api/supabase.ts', code: `import type { AppStateStatus } from 'react-native';\nexport type S = AppStateStatus;\n`, expect: 'fail', match: API },
  { id: 'sb-rn-platform', path: 'src/api/supabase.ts', code: imp('react-native', 'Platform'), expect: 'fail', match: API },
  { id: 'sb-rn-namespace', path: 'src/api/supabase.ts', code: `import * as RN from 'react-native';\nexport const _y = RN;\n`, expect: 'fail', match: API },
  { id: 'sb-rn-module', path: 'src/api/supabase.ts', code: imp('react-native-reanimated', 'useSharedValue'), expect: 'fail', match: API },
  { id: 'sb-maplibre', path: 'src/api/supabase.ts', code: imp('@maplibre/maplibre-react-native', 'MapView'), expect: 'fail', match: MAP },
  { id: 'sb-alias-features', path: 'src/api/supabase.ts', code: imp('@/features/auth/lib/copy'), expect: 'fail', match: API },

  // ---- the AppState boot hook (SCRUM-62): features may use react-native and call src/api ----
  { id: 'hook-ok-appstate', path: 'src/features/auth/hooks/useAuthAutoRefresh.ts', code: imp('react-native', 'AppState'), expect: 'pass' },
  { id: 'hook-ok-api', path: 'src/features/auth/hooks/useAuthAutoRefresh.ts', code: imp('@/api/supabase', 'startAutoRefresh'), expect: 'pass' },
  { id: 'app-ok-boot-hook', path: 'app/_layout.tsx', code: imp('@/features/auth/hooks/useAuthAutoRefresh', 'useAuthAutoRefresh'), expect: 'pass' },
```

**RED check.** Run `npm test -- --ci` and `npm run lint:fixtures` before Step 2.
- Jest should fail: the hook module does not exist, and `startAutoRefresh` is not exported.
- lint:fixtures should fail `sb-rn-appstate`, because the exemption still lets it through, and `sb-rn-appstate-type` for the same reason.
- `sb-rn-platform` and `sb-rn-namespace` probably still pass even before Step 2: their messages come from the path entry, and `includes('src/api is transport only')` matches `'src/api may not import react-native…'`. Record whatever you actually see.

### Step 2 — GREEN: `src/api` exposes the lifecycle seam; the listener leaves

**2a. EDIT `src/api/supabase.ts`**
- Delete line 1: `import { AppState, type AppStateStatus } from 'react-native';`
- Delete lines 39-47: the whole `handleAppStateChange` function and `AppState.addEventListener('change', handleAppStateChange);`
- Append after `refreshSessionSingleFlight`:

```ts
/**
 * Token auto-refresh lifecycle (SPEC-001 R24). GoTrue cannot see the app lifecycle on a phone, and
 * src/api may not import React Native (AGENTS.md Invariant 11), so the AppState listener is the boot
 * hook src/features/auth/hooks/useAuthAutoRefresh.ts, which calls these. Both are idempotent.
 * SCRUM-62 · mobile-architecture §5.3.
 */
export function startAutoRefresh(): Promise<void> {
  return supabase.auth.startAutoRefresh();
}

export function stopAutoRefresh(): Promise<void> {
  return supabase.auth.stopAutoRefresh();
}
```

**2b. NEW `src/features/auth/hooks/useAuthAutoRefresh.ts`**

```ts
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { startAutoRefresh, stopAutoRefresh } from '@/api/supabase';

/**
 * App boot hook (SCRUM-62): drives GoTrue token auto-refresh from the app lifecycle — SPEC-001 R24,
 * startAutoRefresh() on `active`, stopAutoRefresh() otherwise. Without it, a user who backgrounds the
 * app for an hour returns to a 401 storm (mobile-architecture §5.3, ADR-0007).
 *
 * It lives in features, not src/api, because src/api must not import React Native (Invariant 11).
 * Mount exactly once, in app/_layout.tsx.
 */
export function useAuthAutoRefresh(): void {
  useEffect(() => {
    // Sync to the state we boot into. On React Native the SDK starts its ticker at client construction,
    // so only the two unambiguous states act here; 'unknown' / 'inactive' at boot leave it running
    // rather than risk stopping refresh in an app that is actually in the foreground.
    const initial = AppState.currentState;
    if (initial === 'active') void startAutoRefresh();
    else if (initial === 'background') void stopAutoRefresh();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void startAutoRefresh();
      else void stopAutoRefresh();
    });
    return () => subscription.remove();
  }, []);
}
```

Unmount only removes the listener and leaves the refresh state alone. The root layout unmounts only at teardown, and the old module-level listener was never removed.

**2c. EDIT `app/_layout.tsx`**
- After line 5 add: `import { useAuthAutoRefresh } from '@/features/auth/hooks/useAuthAutoRefresh';`
- Make the first line of `RootLayout()`, before `return`, the call `useAuthAutoRefresh();`

### Step 3 — Lint: remove the exemption; one complete entry per glob

**EDIT `eslint.config.js`**
- Replace `:66-77` (keep the `:57-65` comment block, which already lists the three sanctioned adapters and §1.1a) with:

```js
const API_MESSAGE =
  'src/api is transport only: no React Native, no features/ui (Invariant 11, mobile-architecture §1). ' +
  'Only the adapters listed in §1.1a "src/api exceptions" are sanctioned. The AppState listener is the ' +
  'useAuthAutoRefresh boot hook in src/features/auth (SCRUM-62).';
const API_ISOLATION = {
  group: [
    'react-native', 'react-native/*',
    'react-native-*', '!react-native-mmkv',
    'expo', 'expo-*', '!expo-secure-store', '!expo-crypto', '@expo/*',
  ],
  message: API_MESSAGE,
};
```

  Keep the message's leading text `src/api is transport only`, because the fixtures match on it.
- Delete `:79-91`: the `TODO(SCRUM-62)` comment and `SCRUM_62_APPSTATE_ONLY`.
- `:135` (block 3): change `apiIsolation()` to `API_ISOLATION`.
- Replace `:137-146` (block 4) with:

```js
  // 4. The SDK seam itself: exempt from SUPABASE_SDK only.
  {
    files: ['src/api/supabase.ts'],
    rules: { 'no-restricted-imports': restrict({ patterns: [API_ISOLATION, API_LAYERS, MAP_RENDERER] }) },
  },
```

- `restrict` (`:93`) stays as it is. No block passes `paths` any more, but leaving it keeps the diff small.
- After this step, `grep -n "SCRUM_62\|allowReactNative\|apiIsolation" eslint.config.js` must print nothing.

### Step 4 — Docs

**4a. EDIT `docs/01-architecture/02-mobile-architecture.md`**

1. **§1 table, line 31** (`src/api` row, "May not import" cell).
   - Before: ``| `react-native` (and RN/Expo native modules except the §1.1a adapters), `features`, `ui`, `@maplibre/*` |``
   - After: ``| `react-native` (no exceptions — the `AppState` listener is a feature boot hook, §5.3) and every other RN/Expo native module except the three sanctioned §1.1a adapters (`react-native-mmkv`, `expo-secure-store`, `expo-crypto`), `features`, `ui`, `@maplibre/*` |``
2. **§1.1a, line 59.** After "…amend this table and the `apiIsolation` list in `eslint.config.js` in the same PR.", change `apiIsolation` to `API_ISOLATION` and append: ``` `react-native` itself has **no** exception: the `AppState` listener that drives token refresh is the `useAuthAutoRefresh` boot hook in `src/features/auth/hooks/`, which calls `startAutoRefresh`/`stopAutoRefresh` exported by `src/api/supabase.ts` (§5.3; decided in SCRUM-62, 2026-10-21).```
3. **§1.1a table, line 66.** Delete the whole `react-native` → `AppState` only row.
4. **§5.3 snippet.**
   - Delete line 806, `import { AppState } from 'react-native';`
   - Replace lines 830-835 (the comment and the `AppState.addEventListener` block) with:

```ts
// GoTrue cannot see the app lifecycle on a phone, and src/api may not import react-native (§1.1a).
// So the client exposes the two calls and a feature boot hook drives them.
export const startAutoRefresh = () => supabase.auth.startAutoRefresh();
export const stopAutoRefresh = () => supabase.auth.stopAutoRefresh();
```

   - Then insert this new block before the `processLock` paragraph (line 838):

````md
```ts
// src/features/auth/hooks/useAuthAutoRefresh.ts — mounted once in app/_layout.tsx
// GoTrue's refresh timer does not survive backgrounding. Without this, a user
// who leaves the app for an hour returns to a 401 storm on every query.
export function useAuthAutoRefresh(): void {
  useEffect(() => {
    if (AppState.currentState === 'active') void startAutoRefresh();
    else if (AppState.currentState === 'background') void stopAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void startAutoRefresh();
      else void stopAutoRefresh();
    });
    return () => sub.remove();
  }, []);
}
```

The listener is a feature hook rather than part of `src/api` because `src/api` must not import React Native (§1, Invariant 11). That keeps the transport layer runnable in a future web client, which drives refresh from `visibilitychange` instead (SCRUM-62).
````

5. **Change log** (after line 1138). Add the row ``| 2026-10-21 | 1.1.2 | Architecture | SCRUM-62: the `AppState` refresh listener moves out of `src/api/supabase.ts` into the `useAuthAutoRefresh` boot hook (`src/features/auth/hooks/`), which calls the newly exported `startAutoRefresh`/`stopAutoRefresh`. §5.3 snippet amended; §1 and §1.1a now list exactly three sanctioned `src/api` adapters and no `react-native` exception; the `supabase.ts` lint exemption is removed |``

**4b. EDIT `AGENTS.md:139`.** This is an in-place edit of one line, so the line count stays at 150.
- Replace: ``supabase.ts's AppState-only react-native exemption is pending SCRUM-62 — [mobile-arch §1.1a](docs/01-architecture/02-mobile-architecture.md).``
- With: ``src/api has no react-native exemption (SCRUM-62): the AppState listener is the useAuthAutoRefresh boot hook in src/features/auth, calling startAutoRefresh/stopAutoRefresh exported by supabase.ts — [mobile-arch §1.1a, §5.3](docs/01-architecture/02-mobile-architecture.md).``

**4c. Commit message.** Write §5 to `.wp-commit-msg` in the worktree root. Do not commit.

## 2. Skills per step (executor: load the same ones)

| Step | Skill | Why |
|---|---|---|
| Overall slicing (1 → 2 → 3 → 4), keep it compilable, touch only listed files | `incremental-implementation` | Each step is verifiable. Do not "clean up" `restrict`, `query-cache.ts`, ADR-0007 or `useAuthSession`. |
| 1a, 1b, 1c (RED), then 2 (GREEN), then the mutations in §3 | `test-driven-development` | Tests and fixtures must fail first. The red mutations prove the tests bite. |
| 2a (the `startAutoRefresh`/`stopAutoRefresh` contract), 2b (hook signature `(): void`, idempotent, single mount) | `api-and-interface-design` | This is a new public seam between layers. Keep it minimal: two zero-argument functions returning `Promise<void>`. Do not export the client lifecycle in any other way. |
| 4a, 4b (§1, §1.1a, §5.3, change log, AGENTS.md) | `documentation-and-adrs` | Record why the hook is in features. No new ADR: the decision was "amend §5 and list in §1" (see Open item a). |

## 3. Verification (run from the worktree; report the output)

| # | Command | Expected |
|---|---|---|
| 1 | `npm test -- --ci` | Green. The two new suites add 9 tests (6 hook, 3 `src/api`; `test.each` counts as 2) on top of the existing suites. One `console.warn` from `supabase.test.ts` is OK. |
| 2 | `npm run lint` | 0 errors, 0 warnings (`--max-warnings 0`). |
| 3 | `npm run lint:fixtures` | Every case "ok". The final line reads `N/N lint fixtures behaved as expected.` with N = old count + 4. Before: 47 cases. Net change: +1 `sb-rn-appstate-type`, +3 hook/app cases; `sb-ok-appstate` becomes `sb-rn-appstate`. So 51/51. |
| 4 | `npm run typecheck` | Exit 0. |
| 5 | `npm run ci:doc-gates` | Exit 0 (unchanged; specs are untouched). |
| 6 | `./scripts/agent-memory-bridge.sh check` | `bridge intact`, `AGENTS.md is 150 lines`. |
| 7 | `grep -rnE "from 'react-native'" src/api` | **No output** (exit 1). |
| 8 | `grep -rn "react-native" src/api` | Exactly one line: `src/api/query-cache.ts:1:import { createMMKV, deleteMMKV, type MMKV } from 'react-native-mmkv';` (sanctioned, §1.1a). |
| 9 | `grep -rn "SCRUM_62\|allowReactNative\|apiIsolation\|pending SCRUM-62" eslint.config.js eslint-fixtures AGENTS.md docs/01-architecture/02-mobile-architecture.md` | No output. |
| 10 | `grep -rn "AppState" src/api app` | No output in `src/api`. `app/` shows nothing: the import there is the hook, not AppState. |

**Deliberate red mutations.** Make each one, confirm it goes red, revert it, and confirm green again. Report all four.
- **M1 (behaviour):** in `useAuthAutoRefresh.ts`, change the listener's `if (state === 'active')` to `if (state !== 'background')`. Then `npm test -- --ci -t useAuthAutoRefresh` fails "transition to inactive calls stopAutoRefresh".
- **M2 (cleanup):** change `return () => subscription.remove();` to `return undefined;`. Then "unmount removes the listener exactly once" fails.
- **M3 (invariant):** put `import { AppState } from 'react-native'; export const _a = AppState;` at the top of `src/api/supabase.ts`. Then `npm run lint` fails with `no-restricted-imports` and the message "src/api is transport only…".
- **M4 (seam config):** in `eslint.config.js`, delete `'react-native',` from `API_ISOLATION.group`. Then `npm run lint:fixtures` exits 1 with FAIL on `api-rn`, `api-rn-tsx`, `api-rn-appstate`, `sb-rn-appstate`, `sb-rn-appstate-type`, `sb-rn-platform` and `sb-rn-namespace`.

## 4. Jira AC mapping

**SCRUM-62** (SCR-0306)

| AC | Evidence | Status |
|---|---|---|
| No file under `src/api` imports 'react-native' | Checks 7 and 9; M3; fixtures `sb-rn-*` and `api-rn*` | Done |
| Auto-refresh still stops when backgrounded and resumes on foreground | `useAuthAutoRefresh.test.ts` (SPEC-001-T18); hook mounted in `app/_layout.tsx`; on-device confirmation is not part of this package | Done (unit). Device behaviour is covered by later Maestro and auth flows. |
| mobile-architecture §1 and §5 agree | §1 row, §1.1a (AppState row removed) and §5.3 snippet all edited; change log 1.1.2 | Done |

Integrator comment: `Done — pushed to develop in <sha>: AppState listener moved from src/api/supabase.ts to the useAuthAutoRefresh boot hook (src/features/auth/hooks, mounted in app/_layout.tsx) calling newly exported startAutoRefresh/stopAutoRefresh; supabase.ts react-native lint exemption removed (fixtures prove AppState in supabase.ts now fails); mobile-arch §1/§1.1a/§5.3 amended; SPEC-001-T18 unit tests added.` → transition **Done**.

**SCRUM-15** (SCR-0011). Only AC2 and AC6 were open. The others closed in WP-03 (`0a49f76`).

| AC | Evidence | Status |
|---|---|---|
| src/api covered; platform adapters (AppState, SecureStore, MMKV) move out of src/api or the invariant is formally amended via ADR | AppState moved out. SecureStore, MMKV and expo-crypto are recorded as the only sanctioned exceptions in mobile-arch §1 and §1.1a, per Corey's SCRUM-62 decision. | Done per the decision. See Open item a. |
| Same proof for src/api/** (excluding any doc-sanctioned adapter, with the exception recorded in mobile-architecture §1) | `api-*` and `sb-*` fixtures; `api-ok-*` controls; §1.1a | Done |
| supabase.ts exempt only from the @supabase/supabase-js restriction | `eslint.config.js` block 4 is now `API_ISOLATION` + `API_LAYERS` + `MAP_RENDERER` | Done (newly true) |

Integrator comment, default: `Done — pushed to develop in <sha>: last open AC closed — AppState moved out of src/api (SCRUM-62); src/api ban now applies to supabase.ts with only the SDK-seam exemption; the three sanctioned adapters (react-native-mmkv, expo-secure-store, expo-crypto) are recorded in mobile-architecture §1/§1.1a per Corey's 2026-10-21 decision.` → transition **Done**.

If the orchestrator holds this for Open item a, use instead: `Partial — pushed to develop in <sha>: AppState moved out of src/api; supabase.ts exemption removed; sanctioned adapters listed in mobile-arch §1/§1.1a. Open: Corey to confirm the §1 listing satisfies "formally amended via ADR" for SecureStore/MMKV/expo-crypto.` → **In Progress**.

## 5. Commit message (`.wp-commit-msg`)

```
refactor(auth): move AppState refresh listener out of src/api (SCRUM-62)

src/api/supabase.ts no longer imports react-native. It exports
startAutoRefresh/stopAutoRefresh; the new useAuthAutoRefresh boot hook
(src/features/auth/hooks, mounted once in app/_layout.tsx) drives them
from AppState: start on 'active', stop otherwise, synced to the state at
boot, listener removed on unmount (SPEC-001 R24).

- eslint: drop the SCRUM-62 AppState-only exemption; supabase.ts is now
  exempt from the SDK seam only (one complete entry per glob, shared
  API_ISOLATION constant)
- lint fixtures: AppState/AppStateStatus/namespace imports in supabase.ts
  must fail; the boot hook and root layout are pass controls
- tests: SPEC-001-T18 unit tests for the hook and the src/api seam
  (delegation + single-flight refresh)
- docs: mobile-architecture §1, §1.1a (three sanctioned src/api adapters,
  no react-native exception), §5.3 snippet, change log 1.1.2; AGENTS.md
  ESLint memory entry

Refs: SCRUM-62, SCRUM-15 (SCR-0011)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## 6. Open for Corey / out of scope

**Open for Corey (not decided here):**
- **a. ADR vs. listing.** SCRUM-15 AC2 says adapters "move out of src/api or the invariant is formally amended via ADR". Your decision lists SecureStore, MMKV and expo-crypto in mobile-arch §1 and writes no ADR. This plan follows the decision and recommends closing SCRUM-15 as Done. Confirm the §1 listing is enough, or ask for an ADR amending Invariant 11.
- **b. AGENTS.md Invariant 11 (line 48).** It still reads "must not import React Native" with no pointer to the three §1.1a adapters. Should it get a pointer? Changing the invariant text is your call.
- **c. ADR-0007 (lines 23 and 80-82).** It still shows `AppState.addEventListener` beside `createClient`. Its decision, "drive token refresh from AppState", still holds; only the location changed. Should it get an "implementation moved, see mobile-arch §5.3 / SCRUM-62" note, or stay untouched as the historical record?
- **d. `src/lib/appState.ts`.** The planned folder tree (`02-mobile-architecture.md:210-215`) has this as a platform adapter, but `src/lib/` does not exist. The hook goes in `src/features/auth/hooks/`, the existing convention. If `src/lib` is created later, the AppState subscription could move there.

**Out of scope (noticed, not touched):**
- The mobile-arch header still says `Version: 1.0.0` (line 3), while the change log is at 1.1.1 and goes to 1.1.2 with this package. This was already the case before this package.
- The §5.3 snippet shows `lock: processLock`, `Application`, `Database` and `realtime` options that `src/api/supabase.ts` does not have. That is drift between the aspirational doc and the code.
- The §5.2 snippet uses `CHUNK = 1536`, while the code has `CHUNK_SIZE = 1800`.
- The "one network request" half of T18, and device verification of resume-after-background, remain integration and Maestro work.
- Updating the README status row is the integrator's or orchestrator's job.
