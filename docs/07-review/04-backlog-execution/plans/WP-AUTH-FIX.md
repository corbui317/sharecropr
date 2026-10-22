# WP-AUTH-FIX: Fix 10 code-review findings in the EPIC-03 auth code

Planner: Opus. Executor: Sonnet, in its own worktree on branch `wp/WP-AUTH-FIX`, reset to `origin/develop`. The executor does **not** commit. Integrator: Haiku. Class: do.
Planned against `origin/develop` at `964b471` (WP-03b landed; WP-08 **not** landed, so the migrations still use the 8-digit names). Node 22, npm. Jest (jest-expo 57.0.4) + RNTL 14.1.0.

---

## 0. Verification of the findings (file:line, what the code actually does)

All ten findings are real. **#8 is half wrong**: the trigger and the suggested fix are both off, so it is corrected below rather than dropped.

| # | Verdict | Evidence |
|---|---|---|
| 1 | **Confirmed.** Also, the suggested fix ("reset `pendingDeletion` to null when the session changes") is **not enough**. | `app/index.tsx:14-23`. On first render `session === null`, so the effect sets `pendingDeletion=false`. When hydrate sets the session, the next render has `session && pendingDeletion === false`, skips the splash and renders `<Redirect href={routes.map}>`. Expo Router's `Redirect` navigates in its own effect, and React runs **child effects before parent effects**, so the redirect fires before any reset in `Index`'s effect could run. The state must be **derived from, and keyed on, the user id during render**. Two more problems: (a) `[session]` as the dependency refetches on every `TOKEN_REFRESHED`; (b) an RPC error gives `data=null`, so `pending=false` and the gate fails open. A rejected promise leaves the state `null`, which is a spinner forever (Invariant 10). |
| 2 | **Confirmed, all three parts.** | `auth-service.ts:104-108` uses `redirectTo: 'sharecropr://auth/reset-password'`. `supabase/config.toml:41` lists only `sharecropr://auth/callback`, so GoTrue falls back to `site_url` (`http://127.0.0.1:3000`). In Expo Router the host of a custom-scheme URL is the first path segment and route groups add no segment, so the old URL resolves to the unmatched `/auth/reset-password`. The screen's real URL is `sharecropr://reset-password`, i.e. `/reset-password`. `supabase.ts:21` sets `detectSessionInUrl: false` with `flowType: 'pkce'`, and nothing calls `exchangeCodeForSession` for the recovery code. So `ResetPasswordScreen` calls `updateUser` with no session, which fails ("Auth session missing"). |
| 3 | **Confirmed.** | `config.toml:73` sets `enable_confirmations = true`, so `signUp` returns `session: null`. `SignUpScreen` then calls `router.replace(routes.verifyEmail)`, and `VerifyEmailScreen.tsx:46` (`if (!user) return <Redirect href={routes.signIn} />`) bounces the user. The screen takes `email` only from `user?.email` (`:16`). `supabase.auth.resend({type:'signup', email})` needs no session (`GoTrueClient.js:2270+`). |
| 4 | **Confirmed.** | `auth-service.ts:43-50`: `'email not confirmed'` maps to `bad_credentials`, and nothing returns `'network'`. `SignInScreen.tsx:40-43` turns every other code into `wrongCredentials`. GoTrue checks the password before it checks confirmation, so returning a distinct `email_not_confirmed` code is not an existence oracle. |
| 5 | **Confirmed.** | `20260828_0009_auth.sql:14-22`: `user_id uuid PRIMARY KEY`. Cancel only sets `cancelled_at` (`:197-199`). The `EXISTS` guard in `request_account_deletion` (0009 `:139-144`, redefined in 0010 `:194-199`) ignores cancelled rows, so request → cancel → request hits `INSERT … VALUES (v_uid …)` with a raw `duplicate key value violates unique constraint "account_deletions_pkey"`. |
| 6 | **Confirmed.** | `RestoreAccountScreen.tsx:27-31`: on RPC error `data` is null, so `setDeletionStatus(null)`, so `return null` forever (blank screen, Invariant 10). `:63-66`: `cancelAccountDeletion().then(() => router.replace(map))`. `supabase.rpc` resolves `{ error }` and does not reject, so a failed restore still navigates to the map while the account remains scheduled for deletion. |
| 7 | **Confirmed.** | `oauth.ts:57-59` checks `err.message.includes('ERR_REQUEST_CANCELED')`. The native exception is `RequestCanceledException` (`node_modules/expo-apple-authentication/ios/AppleAuthenticationExceptions.swift:16-20`), message "The user canceled the authorization attempt". Its code `ERR_REQUEST_CANCELED` is on `CodedError.code` (`expo-modules-core/src/errors/CodedError.ts:6-13`), not in the message. A cancel is therefore reported as "Apple sign-in didn't complete". |
| 8 | **Partly wrong; corrected.** The error *is* ignored (`auth-service.ts:91-94`). But "offline, the session stays in SecureStore" is true only when the **access token has expired**, and the suggested "fall back to scope `'local'`" **does not fix that case**. | auth-js 2.112.4 `GoTrueClient.js:3415-3445`. With a *valid* token offline, `admin.signOut` returns `AuthRetryableFetchError`, and `_signOut` calls `removeCurrentSession()` anyway, so the session *is* cleared. With an *expired* token offline, `_useSession` → `__loadSession` (`:2561-2582`) tries to refresh, fails with a retryable error and returns `{session:null, error}`. `_signOut` (`:3422-3424`) then returns that error **without** `_removeSession`. `scope:'local'` goes through the same `_useSession` early return. **Fix:** on any global-sign-out failure, purge the stored session ourselves, then call `signOut({scope:'local'})`. That call now finds no session, runs `_removeSession` (clearing the PKCE verifier and `-user` keys) and emits `SIGNED_OUT` (`:4403-4420`) so `AuthProvider` updates. |
| 9 | **Confirmed.** It is worse than stated for email change. | `auth-service.ts:122-144` calls `Crypto.randomUUID()` on every call. `app.idempotency_probe` (`20260822_0005_idempotency.sql:24-41`) hashes the **args** with the key: the same key with a different `p_new_email` raises `idempotency_conflict`. So the key must be per intent **and** renewed when the email input changes. A `NULL` key raises `validation_failed`, so a key is always required. |
| 10 | **Confirmed.** | `query-cache.ts:38-43`. Two concurrent first calls both read no key, both generate and `setItemAsync` *different* keys, and both `createMMKV` the same id with different keys. The persisted key ends up not matching one live instance. The pattern to reuse is `refreshSessionSingleFlight` (`src/api/supabase.ts:26-36`). |

**Constraint found during verification:** tests must **not** go under `app/`. `node_modules/expo-router/_ctx-shared.js` treats every `.ts(x)` under `app/` except `+api`/`+html` as a route. That is why the boot-gate logic moves into `src/features/auth/screens/BootGateScreen.tsx` and `app/index.tsx` only re-exports it, matching every other route file.

### Overlap with queued packages (not yet planned): see Open question Q1

| Queued | Overlap with this package |
|---|---|
| WP-27 (SCRUM-63) intent idempotency keys | **Fully delivered here** (#9): `useIntentKey`, key params, two-submit tests, pgTAP replay |
| WP-28 (SCRUM-71) `useDeletionStatus` + `signOutAndRedirect` | `useDeletionStatus` with retry delivered (#1, #6). The `signOutAndRedirect` helper is **not** |
| WP-29 (SCRUM-52) session hardening | Only the query-cache single-flight (#10) and the T19 sign-out slice (#8) |
| WP-30 (SCRUM-51/56) deep-link callback | Only the recovery-code exchange, the reset redirect allowlist and the sessionless verify screen. Still open: verification callback, link-used/expired states for verification, `Retry-After` |
| WP-31 (SCRUM-68) §8.3 error copy | Only the `network`/`rate_limited`/`email_not_confirmed` mapping on sign-in. Countdown and the error-copy module remain |
| WP-36 (SCRUM-57/58) | No AC overlap (Apple cancel is not in its list) |

File names follow those packages (`useDeletionStatus.ts`, `useIntentKey.ts`) so their later plans extend these files instead of colliding with them.

### Collision check: WP-08 and the open "forward-only vs fix broken early migrations" question
- **No collision with README Open question 1.** That question is about editing 000003/000005/000006, which fail on a fresh DB. This package edits **no** existing migration. It adds one new forward migration, in line with Corey's SCRUM-18 decision and WP-08's planned Data Model §15 rules 1, 7, 9 and 10 (14-digit UTC version, one concern, test in the same PR).
- **Name:** `$(date -u +%Y%m%d%H%M%S)_account_deletions_history.sql`. It is already 14-digit, so WP-08's rename list does not touch it. It sorts after `20261021_0010_*` and after the renamed `20261021000010_*`.
- **Three small things to flag to the orchestrator (not resolved here):**
  - **(a)** WP-08's V3 expects "11 files … break_glass last". If this package lands first there are 12, and `break_glass` sorts last only if its timestamp is later. Update WP-08's V3 expectation.
  - **(b)** Both packages bump SPEC-001. WP-08 goes to 1.1.1; this package goes to **1.2.0**. If WP-08 lands second it should take 1.2.1. Do **not** touch SPEC-001 lines 167 or 564 (WP-08 rewrites those filenames).
  - **(c)** CI cannot exercise this migration yet. `supabase db reset` stops at 000003/000005/000006 (WP-09/WP-10), so `db.yml` stays red. The migration and pgTAP file are **verified only statically here** (no Docker or psql on this Mac). The first real run is WP-12's green `db.yml`.

---

## 1. SPEC-001 §13 test-ID mapping

Existing IDs reused: **T19** (sign-out cleanup, unit slice, #8) and **T37** (component slice for the restore redirect, #1). Nothing else in §13 fits, so these new rows are added (spec text in Step 8):

| New ID | Level | Covers | Finding |
|---|---|---|---|
| SPEC-001-T46 | unit | R47, Invariant 10 | #1, #6a: the boot gate and the restore screen wait for *this user's* deletion status. Server error gives a retry; unreachable or timeout opens normally |
| SPEC-001-T47 | unit | R30 | #2: reset redirect URL, allowlist, single PKCE exchange, invalid-link state |
| SPEC-001-T48 | unit | R18, R19 | #3: sessionless verify screen using the route-param email, and resend |
| SPEC-001-T49 | unit | R15, §8.2, §8.3 | #4: `mapAuthError` codes and distinct sign-in copy |
| SPEC-001-T50 | rls | R45, R47, EC-08 | #5: request → cancel → request, plus the one-open-row invariant |
| SPEC-001-T51 | unit | R47 | #6b: "Keep my account" navigates only on success |
| SPEC-001-T52 | unit | R03, §8.2 | #7: a provider cancel is silent |
| SPEC-001-T53 | unit + rls | §7 `p_idempotency_key` | #9: one intent sends one key; the server replays it |
| SPEC-001-T54 | unit | R25 | #10: single-flight query-cache initialisation |

---

## 2. Steps (tests first; each step ends green before the next)

Skills: `test-driven-development` (RED then GREEN, plus §4 mutations), `incremental-implementation` (touch only the listed files), `api-and-interface-design` (new `src/api` export, auth-service signatures), `documentation-and-adrs` (Step 8).

Rules for every new test:
- Import from `@jest/globals`.
- **Await** `render`, `rerender`, `fireEvent.*`, `act` and `unmount` (RNTL 14; `no-floating-promises` is `error` in `__tests__`).
- `jest.mock` factory variables must be prefixed `mock`, or the mocks must be created inside the factory and read back with `jest.requireMock`.
- Every test name ends with `(SPEC-001-Tnn)`.
- Under `src/api/__tests__` there are no `import`s of RN or Expo modules. `jest.mock('react-native-mmkv', …)` is a call, not an import, and the module is sanctioned.

Shared test helper (inline it in each file that needs it; do not create a shared util):
```ts
function defer<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
```

### Step 0: Worktree baseline
```bash
git worktree add -B wp/WP-AUTH-FIX <wt> origin/develop && cd <wt> && npm ci
npm test -- --ci; npm run lint; npm run lint:fixtures; npm run typecheck; npm run ci:doc-gates; ./scripts/agent-memory-bridge.sh check
```
Record the test count and the lint-fixture `N/N` line. They are the baseline for §3.

### Step 1: `src/api` (T54, T19)

**1a RED. NEW `src/api/__tests__/query-cache.test.ts`** (SPEC-001-T54)
- Mocks, created inside the factories:
  - `react-native-mmkv`: `createMMKV: jest.fn(() => ({ clearAll: jest.fn() }))`, `deleteMMKV: jest.fn()`
  - `expo-crypto`: `getRandomBytes: jest.fn((n: number) => new Uint8Array(n))`
  - `expo-secure-store`: `WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x'`, `getItemAsync: jest.fn(() => Promise.resolve(null))`, `setItemAsync: jest.fn(() => Promise.resolve())`
- `beforeEach`: `await wipeQueryCache()`, then `mockClear` all mocks.
- Tests:
  1. `concurrent first calls create one key and one MMKV instance (SPEC-001-T54)`. `getItemAsync.mockImplementationOnce(() => d.promise)`. Start `a = getQueryCache()` and `b = getQueryCache()` before resolving. Then `d.resolve(null)`, and expect: `await a` is the same object as `await b`, `setItemAsync` called once, `createMMKV` called once, `getItemAsync` called once.
  2. `a failed init does not wedge the lock; the next call retries (SPEC-001-T54)`. `getItemAsync.mockRejectedValueOnce(new Error('keychain locked'))`. Expect `getQueryCache()` to reject. A second call resolves; `createMMKV` called once.
  3. `once open, later calls reuse the instance without touching SecureStore (SPEC-001-T54)`.

**1b RED. EDIT `src/api/__tests__/supabase.test.ts`**
- Add `signOut: jest.fn(() => Promise.resolve({ error: null }))` to the mock `auth` object and to the `MockAuth` type: `jest.Mock<(o?: { scope?: string }) => Promise<{ error: unknown }>>`.
- Add `jest.mock('../secure-storage', () => ({ chunkedSecureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(() => Promise.resolve()) } }))`. Read it back with `jest.requireMock`.
- Import `signOutWithLocalFallback`.
- New `describe('signOutWithLocalFallback')`, with `mockClear` in `beforeEach`:
  1. `global sign-out succeeds: no local purge (SPEC-001-T19)`. `signOut` called once with `{ scope: 'global' }`; `removeItem` not called; returns `{ remoteRevoked: true }`.
  2. `global sign-out fails (offline, expired token): purges the stored session, then signs out locally (SPEC-001-T19)`. First call resolves `{ error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 } }`. Expect `removeItem` called with `'sc.auth.session'`, then `signOut` 2nd call `{ scope: 'local' }`, and `removeItem.mock.invocationCallOrder[0] < signOut.mock.invocationCallOrder[1]`. Returns `{ remoteRevoked: false }`.
  3. `global sign-out throws: same purge + local fallback (SPEC-001-T19)`. Use `mockRejectedValueOnce`.

**1c GREEN. EDIT `src/api/query-cache.ts`.** Replace `getQueryCache` (`:38-43`) with the same single-flight shape as `refreshSessionSingleFlight`:
```ts
let opening: Promise<MMKV> | null = null;

async function openQueryCache(): Promise<MMKV> {
  const encryptionKey = await getOrCreateEncryptionKey();
  cache = createMMKV({ id: CACHE_ID, encryptionKey, encryptionType: 'AES-256' });
  return cache;
}

/**
 * Single-flight, same pattern as refreshSessionSingleFlight (src/api/supabase.ts): concurrent first
 * callers share one open, so exactly one encryption key is generated and persisted (SPEC-001-T54).
 * The lock clears on settle, so a failed open (e.g. keychain locked) can be retried.
 */
export async function getQueryCache(): Promise<MMKV> {
  if (cache) return cache;
  if (opening) return opening;
  opening = openQueryCache();
  try {
    return await opening;
  } finally {
    opening = null;
  }
}
```
Leave `wipeQueryCache` alone. A wipe that overlaps an in-flight open is out of scope (§6, WP-29).

**1d GREEN. EDIT `src/api/supabase.ts`**
- Add `const AUTH_STORAGE_KEY = 'sc.auth.session';` and use it in `createClient` (`storageKey: AUTH_STORAGE_KEY`).
- Append:
```ts
/**
 * Sign out, revoking the refresh token server-side when the server is reachable (SPEC-001 R25, T19).
 *
 * GoTrue's signOut() loads the session first. If the access token has expired and the refresh
 * cannot reach the server (offline, 5xx), it returns that error WITHOUT clearing storage, and
 * signOut({ scope: 'local' }) takes the same early return. So on any failure we purge the persisted
 * session ourselves, then run the local sign-out: it now finds no session, clears the PKCE verifier
 * and user entries, and emits SIGNED_OUT so AuthProvider updates. Offline, the refresh token stays
 * valid server-side until it expires (R23); that is the honest limit of signing out offline.
 */
export async function signOutWithLocalFallback(): Promise<{ remoteRevoked: boolean }> {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (!error) return { remoteRevoked: true };
  } catch {
    // fall through: purge locally
  }
  await chunkedSecureStorage.removeItem(AUTH_STORAGE_KEY);
  await supabase.auth.signOut({ scope: 'local' });
  return { remoteRevoked: false };
}
```
Run `npm test -- --ci src/api`. It must be green.

### Step 2: auth-service contract (T19, T46, T47, T49, T51, T53)

**2a RED. NEW `src/features/auth/lib/__tests__/auth-service.test.ts`**

Mocks:
- `expo-crypto`: `digestStringAsync`, `CryptoDigestAlgorithm: { SHA1: 'SHA-1' }`, `randomUUID: jest.fn(() => 'SHOULD-NOT-BE-USED')`
- `@/api/query-cache`: `wipeQueryCache: jest.fn(() => Promise.resolve())`
- `@/api/supabase`: `supabase: { auth: { signInWithPassword, signUp, resend, resetPasswordForEmail, exchangeCodeForSession, updateUser }, rpc }` plus `signOutWithLocalFallback`, all `jest.fn`

Cases:

| Test | Assertion |
|---|---|
| `mapAuthError` table (`test.each`, T49) | `{message:'Email not confirmed',status:400,code:'email_not_confirmed'}` → `email_not_confirmed`<br>`{message:'Email not confirmed'}` (no code) → `email_not_confirmed`<br>`{message:'Invalid login credentials',status:400,code:'invalid_credentials'}` → `bad_credentials`<br>`{name:'AuthRetryableFetchError',message:'Network request failed',status:0}` → `network`<br>`{message:'Request rate limit reached',status:429,code:'over_request_rate_limit'}` → `rate_limited`<br>`{message:'User is banned',status:400,code:'user_banned'}` → `suspended`<br>`{message:'???'}` → `unknown` |
| `email not confirmed is never bad_credentials (T49)` | Explicit negative |
| `signInWithEmail maps the SDK error object (T49)` | `signInWithPassword` resolves `{data:null,error:{…email_not_confirmed}}` → `{ error: 'email_not_confirmed' }` |
| `requestPasswordReset redirects to the allowlisted reset route (T47)` | `resetPasswordForEmail` called with `('a@b.org', { redirectTo: 'sharecropr://reset-password' })` for input `' A@B.org '`; `PASSWORD_RESET_REDIRECT === 'sharecropr://reset-password'` |
| `exchangeRecoveryCode: concurrent calls for one code make one exchange (T47)` | `Promise.all([x('c1'), x('c1')])` → `exchangeCodeForSession` called once; both `{ error: null }` |
| `exchangeRecoveryCode: SDK error or rejection → link_invalid (T47)` | Two sub-cases, different codes |
| `getDeletionStatus classifies (T46)` (`test.each`) | `{data:{pending:true,scheduled_at:'x'},error:null,status:200}` → `{ok:true,status:{pending:true,…}}`<br>`{data:null,error:{message:'FetchError: Network request failed'},status:0}` → `{ok:false,reason:'unreachable'}`<br>`{data:null,error:{message:'boom'},status:500}` → `{ok:false,reason:'error'}`<br>`{data:'junk',error:null,status:200}` → `{ok:false,reason:'error'}` |
| `cancelAccountDeletion passes the caller's key and classifies (T51, T53)` | rpc called `('cancel_account_deletion', { p_idempotency_key: 'k-1' })`; `invalid_transition` → `grace_elapsed`; `request_not_found` → `not_found`; other → `failed`; ok → `{ ok: true }` |
| `requestAccountDeletion / requestEmailChange use the caller's key, never mint one (T53)` | rpc args contain `p_idempotency_key: 'k-2'` / `'k-3'`; `randomUUID` not called; an invalid email returns `{ error: 'invalid_email' }` with no rpc |
| `signOut wipes the query cache even if sign-out rejects (T19)` | `signOutWithLocalFallback.mockRejectedValueOnce(new Error('x'))` → `signOut()` rejects **and** `wipeQueryCache` called once; happy path calls both, in order |
| `resendVerificationEmail maps errors (T48)` | `resend` resolves `{ error: { status: 429, code: 'over_email_send_rate_limit', message: '…' } }` → `{ error: 'rate_limited' }`; no error → `{ error: null }` |

**2b GREEN. EDIT `src/features/auth/lib/auth-service.ts`**
- Import `{ signOutWithLocalFallback, supabase } from '@/api/supabase'`.
- Add `'email_not_confirmed'` to `AuthErrorCode`.
- Replace `mapAuthError`:
```ts
/** The fields of a GoTrue AuthError we read. Structural, so features never import the SDK. */
export type AuthErrorLike = { message: string; name?: string; status?: number; code?: string };

export function mapAuthError(error: AuthErrorLike): AuthErrorCode {
  const code = error.code ?? '';
  const lower = error.message.toLowerCase();
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return 'network';
  // GoTrue checks the password before confirmation, so this is not an existence oracle.
  if (code === 'email_not_confirmed' || lower.includes('email not confirmed')) return 'email_not_confirmed';
  if (code === 'invalid_credentials' || lower.includes('invalid login credentials')) return 'bad_credentials';
  if (error.status === 429 || code.startsWith('over_') || lower.includes('rate limit')) return 'rate_limited';
  if (code === 'user_banned' || lower.includes('user is banned') || lower.includes('suspended')) return 'suspended';
  return 'unknown';
}
```
- `signUpWithEmail` and `signInWithEmail`: `mapAuthError(error)` (pass the object, not `error.message`).
- `signOut`:
```ts
export async function signOut(): Promise<void> {
  try {
    await signOutWithLocalFallback();
  } finally {
    await wipeQueryCache(); // R25: the cache file goes even if the session purge failed
  }
}
```
- `resendVerificationEmail(email): Promise<{ error: AuthErrorCode | null }>` returns `{ error: error ? mapAuthError(error) : null }`.
- `export const PASSWORD_RESET_REDIRECT = 'sharecropr://reset-password';`, with a comment: allowlisted in `supabase/config.toml`; the scheme host is the first path segment and `(auth)` adds none, so it opens `app/(auth)/reset-password.tsx` (SPEC-001-T47). `requestPasswordReset` uses it.
- `exchangeRecoveryCode`: a module-level `Map<string, Promise<{ error: 'link_invalid' | null }>>`. Return the existing entry for a code. Otherwise store `supabase.auth.exchangeCodeForSession(code).then(({ error }) => ({ error: error ? 'link_invalid' : null }), () => ({ error: 'link_invalid' }))`. Comment: the code is single-use, so a duplicate exchange (StrictMode's double effect, a remount) would fail and wrongly show "link invalid". Keep resolved entries; they are tiny.
- Deletion status:
```ts
export type DeletionStatus = { pending: boolean; requested_at?: string; scheduled_at?: string; grace_elapsed?: boolean };
export type DeletionStatusResult = { ok: true; status: DeletionStatus } | { ok: false; reason: 'unreachable' | 'error' };
function isDeletionStatus(v: unknown): v is DeletionStatus {
  return typeof v === 'object' && v !== null && typeof (v as { pending?: unknown }).pending === 'boolean';
}
export async function getDeletionStatus(): Promise<DeletionStatusResult> {
  const { data, error, status } = await supabase.rpc('get_account_deletion_status');
  if (error) return { ok: false, reason: status === 0 ? 'unreachable' : 'error' }; // postgrest-js: status 0 = fetch failed
  if (!isDeletionStatus(data)) return { ok: false, reason: 'error' };
  return { ok: true, status: data };
}
```
- Signature changes. **`Crypto.randomUUID` disappears from this file**; `Crypto` stays for `sha1Hex`.
  - `requestAccountDeletion({ idempotencyKey, reason }: { idempotencyKey: string; reason?: string })` returns the raw rpc result, as today.
  - `cancelAccountDeletion(idempotencyKey: string): Promise<CancelDeletionResult>`, where `CancelDeletionResult = { ok: true } | { ok: false; reason: 'grace_elapsed' | 'not_found' | 'failed' }`. Classify by `error.message.includes('invalid_transition' | 'request_not_found')`.
  - `requestEmailChange(newEmail: string, idempotencyKey: string)`.

**2c. NEW `src/features/auth/lib/with-timeout.ts`**
```ts
export const TIMED_OUT = Symbol('timed_out');
/** Invariant 10: a network call that never settles must still end the loading state. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}
```

### Step 3: Hooks (T46, T53)

**3a RED. NEW `src/features/auth/hooks/__tests__/useIntentKey.test.ts`** (mock `expo-crypto` `randomUUID` with a counter: `k1`, `k2`, …)
1. `stable across re-renders (SPEC-001-T53)`
2. `renew() mints a new key (SPEC-001-T53)`
3. `a changed scope mints a new key; the same scope keeps it (SPEC-001-T53)`
4. `two mounts get different keys (SPEC-001-T53)`

**3b RED. NEW `src/features/auth/hooks/__tests__/useDeletionStatus.test.ts`** (mock auth-service `getDeletionStatus`; use `renderHook`)
1. `no user → idle, no fetch (SPEC-001-T46)`
2. `user present → loading until resolved, then ready (SPEC-001-T46)`
3. `user changes → loading again and a new fetch, never the previous user's result (SPEC-001-T46)`. Resolve u1 with pending, rerender with u2, expect `loading`.
4. `{ok:false,reason:'error'} → error; retry() refetches (SPEC-001-T46)`
5. `rejection → error (SPEC-001-T46)`
6. `no answer in 8 s → unreachable (SPEC-001-T46)`. Use `jest.useFakeTimers()`, a never-resolving promise, and `await act(async () => { jest.advanceTimersByTime(8000); })`; restore real timers in `afterEach`.

**3c GREEN. NEW `src/features/auth/hooks/useIntentKey.ts`**
```ts
import { useCallback, useState } from 'react';
import * as Crypto from 'expo-crypto';

export type IntentKey = { key: string; renew: () => void };

/**
 * One idempotency key per user intent (SPEC-001-T53, SCRUM-63). Retries of the same intent reuse it,
 * so the server replays the stored result instead of acting twice. A new intent gets a new key: on
 * remount, on renew(), or when `scope` changes. The server binds a key to its arguments
 * (app.idempotency_probe), so pass the argument as scope (e.g. the normalised new email).
 */
export function useIntentKey(scope = ''): IntentKey {
  const [intent, setIntent] = useState(() => ({ scope, key: Crypto.randomUUID() }));
  let current = intent;
  if (intent.scope !== scope) {
    current = { scope, key: Crypto.randomUUID() };
    setIntent(current); // React's "adjust state while rendering" pattern
  }
  const renew = useCallback(() => setIntent((prev) => ({ scope: prev.scope, key: Crypto.randomUUID() })), []);
  return { key: current.key, renew };
}
```

**3d GREEN. NEW `src/features/auth/hooks/useDeletionStatus.ts`**
```ts
import { useCallback, useEffect, useState } from 'react';
import { getDeletionStatus, type DeletionStatus } from '@/features/auth/lib/auth-service';
import { TIMED_OUT, withTimeout } from '@/features/auth/lib/with-timeout';

export const DELETION_STATUS_TIMEOUT_MS = 8000;

export type DeletionStatusState =
  | { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; status: DeletionStatus }
  | { kind: 'unreachable' } | { kind: 'error' };

const IDLE = { kind: 'idle' } as const;
const LOADING = { kind: 'loading' } as const;

/**
 * Deletion status for ONE user (SPEC-001 R47, T46). The result is keyed on (userId, attempt) and
 * derived during render, so a render for a new user can never see the previous user's, or the
 * signed-out, answer. Resetting state in an effect is too late: a child <Redirect> navigates in its
 * own effect, which React runs before the parent's.
 */
export function useDeletionStatus(userId: string | null): { state: DeletionStatusState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ userId: string; attempt: number; state: DeletionStatusState } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void withTimeout(getDeletionStatus(), DELETION_STATUS_TIMEOUT_MS)
      .then(
        (res): DeletionStatusState =>
          res === TIMED_OUT ? { kind: 'unreachable' }
          : res.ok ? { kind: 'ready', status: res.status }
          : { kind: res.reason },
        (): DeletionStatusState => ({ kind: 'error' }),
      )
      .then((state) => { if (active) setSettled({ userId, attempt, state }); });
    return () => { active = false; };
  }, [userId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!userId) return { state: IDLE, retry };
  if (!settled || settled.userId !== userId || settled.attempt !== attempt) return { state: LOADING, retry };
  return { state: settled.state, retry };
}
```
Key on `user.id`, never on the `session` object: the session object changes on every token refresh.

### Step 4: OAuth cancel (T52)

**4a RED. NEW `src/features/auth/lib/__tests__/oauth.test.ts`**

Mocks:
- `expo-apple-authentication`: `signInAsync: jest.fn()`, `AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 }`
- `expo-web-browser`: `maybeCompleteAuthSession: jest.fn()`, `openAuthSessionAsync: jest.fn()`
- `expo-auth-session`: `makeRedirectUri: () => 'sharecropr://auth/callback'`
- `@/api/supabase`: `supabase.auth.{ signInWithIdToken, signInWithOAuth, exchangeCodeForSession, getUser, updateUser }`, `supabase.from`

Set `Platform.OS = 'ios'` (restore it in `afterEach`, as `SignInScreen.test.tsx` does).

Cases:
1. `Apple cancel is detected by err.code, not the message (SPEC-001-T52)`. Reject with `Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' })`. Expect `{ error: null, cancelled: true }`; `signInWithIdToken` not called.
2. `other Apple errors surface (SPEC-001-T52)`. `code: 'ERR_INVALID_RESPONSE'` → `error` is that Error; `cancelled` is falsy.
3. `Google sheet dismissed → silent cancel (SPEC-001-T52)`. `signInWithOAuth` → `{data:{url:'https://x'},error:null}`; `openAuthSessionAsync` → `{type:'cancel'}`. Expect `{ error: null, cancelled: true }`; no exchange.

**4b GREEN. EDIT `src/features/auth/lib/oauth.ts`**
- `export type OAuthResult = { error: Error | null; cancelled?: boolean };`. Both exported functions and `signInWithOAuth` return `Promise<OAuthResult>`.
- Add a helper: `function isUserCancel(err: unknown): boolean { return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED'; }` with the comment "expo-modules CodedError: the code is on .code; the message is 'The user canceled the authorization attempt'".
- Catch block: `if (isUserCancel(err)) return { error: null, cancelled: true };`
- `if (result.type !== 'success' || !result.url) return { error: null, cancelled: true };`
- Do not touch the R05 display-name logic (WP-36).

### Step 5: Screens and routes (T46, T37 slice, T47, T48, T49, T51, T52, T53)

Common `expo-router` test mock (extend per file):
```tsx
const mockRedirects: unknown[] = [];
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: ({ href }: { href: unknown }) => { mockRedirects.push(href); return null; },
    router: { replace: jest.fn(), push: jest.fn() },
    useLocalSearchParams: jest.fn(() => ({})),
  };
});
```
`useAuthSession` is mocked through a mutable `mockAuth` object.

**5a. NEW `src/features/auth/components/DeletionStatusError.tsx`.** Props `{ onRetry: () => void }`. Renders `AuthScreenShell title={authCopy.accountStatusTitle} subtitle={authCopy.accountStatusBody}` with:
- `AuthButton label={authCopy.tryAgain} onPress={onRetry}`
- secondary `AuthButton label={authCopy.signOut}` → `void signOut().then(() => router.replace(routes.signIn))`

**5b. NEW `src/features/auth/screens/BootGateScreen.tsx`; EDIT `app/index.tsx`** to `import { BootGateScreen } from '@/features/auth/screens/BootGateScreen'; export default BootGateScreen;`
```tsx
export function BootGateScreen() {
  const { status, session, user, isEmailVerified } = useAuthSession();
  const { state, retry } = useDeletionStatus(user?.id ?? null);

  if (status === 'loading') return <BootSplash />;
  if (!session) return <Redirect href={routes.signIn} />;
  if (state.kind === 'idle' || state.kind === 'loading') return <BootSplash />;
  if (state.kind === 'error') return <DeletionStatusError onRetry={retry} />;
  if (state.kind === 'ready' && state.status.pending) return <Redirect href={routes.restoreAccount} />;
  // 'unreachable' (offline / timeout) opens the app normally — SPEC-001 §8.2 Offline. Grace-period
  // writes are refused server-side (EC-07), so this cannot leak a deleted account's capabilities.
  if (!isEmailVerified) return <Redirect href={routes.verifyEmail} />;
  return <Redirect href={routes.map} />;
}
```
**Tests, NEW `src/features/auth/screens/__tests__/BootGateScreen.test.tsx`** (mock auth-service `getDeletionStatus` and `signOut`):
1. `session arriving after the first render waits for this user's status, then restores, never via /map (SPEC-001-T46, T37 component slice)`. Render with `{status:'loading',session:null,user:null}`. Re-render with `{status:'authenticated',session:{},user:{id:'u1'},isEmailVerified:true}`. Expect `mockRedirects` empty. Resolve `{ok:true,status:{pending:true}}` inside `act`. Expect `mockRedirects` to contain `routes.restoreAccount` and **not** `routes.map`.
2. `not pending → /map when verified, /verify-email when not (SPEC-001-T46)` (`test.each`)
3. `server error → retry screen, not a spinner; Try again refetches and proceeds (SPEC-001-T46)`. First `{ok:false,reason:'error'}`: "Try again" is on screen. Press it, then `{ok:true,status:{pending:false}}` → redirect to map; `getDeletionStatus` called twice.
4. `unreachable → opens normally (SPEC-001-T46)` → map.
5. `no session → /sign-in, no status fetch (SPEC-001-T46)`

**5c. EDIT `src/features/auth/screens/RestoreAccountScreen.tsx`**
- Use `useAuthSession()` (`status`, `session`, `user`), `useDeletionStatus(user?.id ?? null)`, `useIntentKey()`, plus local `restoreError: string | null` and `graceElapsed: boolean`.
- Order:
  1. `status==='loading'` → `<BootSplash/>`
  2. `!session` → sign-in
  3. `idle` / `loading` → `<BootSplash/>`
  4. `kind !== 'ready'` → `<DeletionStatusError onRetry={retry}/>`
  5. `!pending` → map
  6. `graceElapsed || grace_elapsed` → existing grace UI
  7. otherwise the restore UI
- Keep button handler:
```ts
setLoading(true); setRestoreError(null);
const result = await cancelAccountDeletion(intent.key);
setLoading(false);
if (result.ok || result.reason === 'not_found') { router.replace(routes.map); return; }
if (result.reason === 'grace_elapsed') { setGraceElapsed(true); return; }
setRestoreError(authCopy.restoreFailed);
```
- Render `restoreError` as `<Text accessibilityLiveRegion="polite" style={styles.error}>` below the buttons, reusing the `#b42318` style from VerifyEmail.
- Delete the local `DeletionStatus` type; import it from auth-service.

**Tests, NEW `src/features/auth/screens/__tests__/RestoreAccountScreen.test.tsx`** (mock auth-service `getDeletionStatus`, `cancelAccountDeletion`, `signOut`; mock `expo-crypto` `randomUUID` counter):
1. `status error renders an actionable retry, not a blank screen (SPEC-001-T46)`
2. `cancel failure keeps the screen and shows the error; no navigation (SPEC-001-T51)`
3. `retrying the restore sends the same idempotency key (SPEC-001-T53)`. First `{ok:false,reason:'failed'}`, second `{ok:true}`. Both calls get `'k1'`; `router.replace(routes.map)` only after the second.
4. `invalid_transition shows the grace-elapsed state (SPEC-001-T51)` → `authCopy.graceElapsed` visible
5. `success navigates to the map (SPEC-001-T51)`

**5d. EDIT `src/features/auth/screens/ResetPasswordScreen.tsx`**
- Read `useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>()` and `useAuthSession()`.
- `const code = typeof params.code === 'string' ? params.code : undefined;` and `const linkError = Boolean(params.error ?? params.error_code);`
- State `exchange: { code: string; ok: boolean } | null`.
- Effect `[code, linkError]`: if `code && !linkError`, run `withTimeout(exchangeRecoveryCode(code), 10000)` and, if still active, `setExchange({ code, ok: res !== TIMED_OUT && !res.error })`.
- Derive `link: 'checking' | 'ready' | 'invalid'`:
  - `linkError` → invalid
  - `code` → `exchange?.code === code ? (exchange.ok ? 'ready' : 'invalid') : 'checking'`
  - otherwise `status === 'loading'` → checking; else `session ? 'ready' : 'invalid'`
- `checking` → `<BootSplash/>`.
- `invalid` → `AuthScreenShell title={authCopy.resetLinkInvalidTitle} subtitle={authCopy.resetLinkInvalidBody}` with a button `authCopy.resetLinkRequestNew` → `router.replace(routes.forgotPassword)`.
- `ready` → the existing form, unchanged.

**Tests, NEW `src/features/auth/screens/__tests__/ResetPasswordScreen.test.tsx`** (mock auth-service `exchangeRecoveryCode` and `updatePassword`):
1. `?code= exchanges once, then shows the form; submit calls updatePassword (SPEC-001-T47)`. Use `getByLabelText('New password')`.
2. `failed exchange → request-a-new-link state, which routes to forgot-password (SPEC-001-T47)`
3. `?error_code=otp_expired → invalid state, no exchange (SPEC-001-T47)`
4. `no code and no session → invalid; no code with a session → form (SPEC-001-T47)`

**5e. EDIT `src/features/auth/lib/routes.ts`.** Add:
```ts
/** Verify screen with the address the mail went to: signUp returns no session while confirmations are on (SPEC-001-T48). */
export const verifyEmailHref = (email: string): Href => ({ pathname: '/(auth)/verify-email', params: { email } }) as Href;
```

**5f. EDIT `src/features/auth/screens/VerifyEmailScreen.tsx`**
- `const params = useLocalSearchParams<{ email?: string }>();` and `const email = user?.email ?? (typeof params.email === 'string' ? params.email : '');`
- Gates:
  - `status==='loading'` → `<BootSplash/>`
  - `!user && !email` → sign-in
  - `user && isEmailVerified` → map
- `handleResend`: `const { error: code } = await resendVerificationEmail(email);`
  - `rate_limited` → `setCooldown(RESEND_COOLDOWN_SEC)`
  - `network` → `authCopy.network`
  - other → the existing generic string
- Bottom button: when `user` is set, keep "Sign out"; otherwise `authCopy.backToSignIn` → `router.replace(routes.signIn)`.

**Tests, NEW `.../__tests__/VerifyEmailScreen.test.tsx`:**
1. `sessionless: shows the address from params and resends to it (SPEC-001-T48)`. `mockAuth={status:'unauthenticated',user:null,…}`, params `{email:'new@example.org'}`. `authCopy.verifyBody('new@example.org')` visible; press "Didn't arrive? Resend" → `resendVerificationEmail('new@example.org')`; no redirect.
2. `no session and no address → /sign-in (SPEC-001-T48)`
3. `verified session → /map (SPEC-001-T48)`
4. `resend network failure shows the network copy (SPEC-001-T49)`

**5g. EDIT `src/features/auth/screens/SignUpScreen.tsx`**
- On success: `router.replace(verifyEmailHref(normalizeEmail(email)))` (import `normalizeEmail` from `@/domain/validation/email`).
- Add `if (result.error === 'network') { setFieldError(authCopy.network); return; }`.
- `handleProvider`: `const { error, cancelled } = await fn(); setLoadingProvider(null); if (cancelled) return;`

**Tests, NEW `.../__tests__/SignUpScreen.test.tsx`:**
1. `sessionless signUp goes to verify-email carrying the normalised address (SPEC-001-T48)`. Type `' New@Example.org '` → `router.replace` called with `{ pathname: '/(auth)/verify-email', params: { email: 'new@example.org' } }`.
2. `cancelled provider: no error, no navigation (SPEC-001-T52)` (Android)

**5h. EDIT `src/features/auth/screens/SignInScreen.tsx`.** Replace the error chain with:
- `bad_credentials` → `wrongCredentials`
- `email_not_confirmed` → `router.replace(verifyEmailHref(normalizeEmail(email)))`, then return
- `suspended` → `accountSuspended`
- `rate_limited` → `authCopy.signInRateLimited`
- `network` → `authCopy.network`
- any other error → `wrongCredentials` (unchanged)

The provider handler gets the same `cancelled` early return as 5g.

**Tests, EDIT `.../__tests__/SignInScreen.test.tsx`.** Keep the two T01 tests. Change the auth-service mock to `signInWithEmail: jest.fn()` read through `jest.requireMock`; same for `oauth`. Add:
1. `rate_limited and network get their own copy, not wrongCredentials (SPEC-001-T49)` (`test.each`). Type an email and password, press "Sign in", expect the copy; `queryByText(authCopy.wrongCredentials)` is null.
2. `email_not_confirmed routes to verify-email with the address (SPEC-001-T49)`
3. `Apple cancel is silent (SPEC-001-T52)`. Android; `signInWithApple` resolves `{ error: null, cancelled: true }`; press "Sign in with Apple"; no `providerFailed` text; `router.replace` not called.

**5i. EDIT `src/features/auth/screens/DeleteAccountScreen.tsx`.** `const intent = useIntentKey();`, then `requestAccountDeletion({ idempotencyKey: intent.key })`.
**Test, NEW `.../__tests__/DeleteAccountScreen.test.tsx`:**
1. `a retried deletion sends the same key (SPEC-001-T53)`. Type `delete` (case-insensitive). First `{error:{message:'FetchError: Network request failed'}}`, then `{data:{},error:null}`. Both calls get `{ idempotencyKey: 'k1' }`; then `router.replace(routes.restoreAccount)`.
2. `a new visit is a new intent (SPEC-001-T53)`. Unmount, re-render, press → `'k2'`.

**5j. EDIT `src/features/auth/screens/SecuritySettingsScreen.tsx`.**
- `const emailIntent = useIntentKey(normalizeEmail(newEmail));`, then `requestEmailChange(newEmail, emailIntent.key)`; `emailIntent.renew()` after success.
- Leave its error mapping (everything → `aal2Required`) alone; that is WP-32.

**Test, NEW `.../__tests__/SecuritySettingsScreen.test.tsx`:**
1. `retrying one email change reuses the key; editing the address mints a new one (SPEC-001-T53)`.

**5k. EDIT `src/features/auth/lib/copy.ts`.** Add these exact strings (they also go into SPEC-001 §8.3, Step 8):
```ts
network: "We couldn't reach Sharecropr. Check your connection and try again.",
signInRateLimited: 'Too many sign-in attempts. Wait a few minutes and try again.',
accountStatusTitle: "We couldn't check your account",
accountStatusBody: 'Check your connection and try again.',
tryAgain: 'Try again',
signOut: 'Sign out',
restoreFailed: "We couldn't restore your account just now. Try again.",
resetLinkInvalidTitle: "That reset link didn't work",
resetLinkInvalidBody:
  'Reset links work once, expire after 60 minutes, and open only on the device that asked for them. Request a new one.',
resetLinkRequestNew: 'Request a new link',
backToSignIn: 'Back to sign in',
```

### Step 6: `supabase/config.toml`
Replace line 41 with:
```toml
# SPEC-001-T47: reset emails redirect to sharecropr://reset-password. Expo Router reads the scheme
# host as the first path segment and the (auth) group adds none, so it opens
# app/(auth)/reset-password.tsx, which exchanges the PKCE ?code=. The hosted project's
# Redirect URLs allowlist (dashboard) must list the same URL.
additional_redirect_urls = ["sharecropr://auth/callback", "sharecropr://reset-password"]
```
Do not change `detectSessionInUrl: false`. It is correct for React Native, and the screen does the exchange.

### Step 7: Forward migration + pgTAP (T50, T53). Negative-first.

**7a RED (statically). NEW `supabase/tests/auth_account_deletion_history.test.sql`.** Negative assertions are written first in each block and outnumber the positives: P=6, N=9.
```sql
-- SPEC-001 account deletion history (R45, R47, EC-08; SPEC-001-T50) and per-intent idempotency
-- replay (SPEC-001-T53). Fixture 'no_garden' has no verified factor, so no step-up applies (R44).
BEGIN;
SELECT plan(17);

-- ── Schema (S: structural, not counted by the negative-ratio gate) ──
SELECT col_is_pk('private', 'account_deletions', 'id', 'S1: id is the primary key');
SELECT has_index('private', 'account_deletions', 'account_deletions_one_open_per_user',
  'S2: partial unique index on open requests exists');
SELECT col_isnt_pk('private', 'account_deletions', 'user_id',
  'N1: user_id is no longer the primary key (a cancelled request must not block the next)');

-- ── First request ──
SELECT tests.authenticate_as('no_garden');
SELECT throws_ok($$SELECT public.cancel_account_deletion(gen_random_uuid())$$,
  'P0002', 'request_not_found', 'N2: cancel with nothing scheduled fails');
SELECT lives_ok($$SELECT public.request_account_deletion('first', 'a0000000-0000-4000-8000-000000000001')$$,
  'P1: first request schedules a deletion');
SELECT throws_ok($$SELECT public.request_account_deletion(NULL, gen_random_uuid())$$,
  '23505', 'conflict', 'N3: a second request while one is open conflicts (EC-08)');
SELECT throws_ok($$SELECT public.request_account_deletion('other reason', 'a0000000-0000-4000-8000-000000000001')$$,
  'P0001', 'idempotency_conflict', 'N4: a key cannot be reused for a different intent (T53)');
SELECT lives_ok($$SELECT public.request_account_deletion('first', 'a0000000-0000-4000-8000-000000000001')$$,
  'P2: replaying the same key returns the stored result instead of conflicting (T53)');
SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.account_deletions WHERE user_id = tests.fixture('no_garden')), 1::bigint,
  'N5: the replay created no second deletion row (T53)');

-- ── Cancel, then request again (the bug) ──
SELECT tests.authenticate_as('no_garden');
SELECT ok((public.cancel_account_deletion('b0000000-0000-4000-8000-000000000001') ->> 'restored')::boolean,
  'P3: cancel restores within grace');
SELECT ok(NOT (public.get_account_deletion_status() ->> 'pending')::boolean,
  'N6: nothing is pending after the cancel');
SELECT lives_ok($$SELECT public.request_account_deletion('again', gen_random_uuid())$$,
  'P4: a request after a cancel succeeds (T50; was duplicate key on account_deletions_pkey)');
SELECT ok((public.get_account_deletion_status() ->> 'pending')::boolean,
  'P5: the new request is pending');

SELECT tests.clear_authentication();
SELECT is((SELECT count(*) FROM private.account_deletions
            WHERE user_id = tests.fixture('no_garden') AND cancelled_at IS NULL AND executed_at IS NULL),
  1::bigint, 'N7: exactly one open request per user');
SELECT is((SELECT count(*) FROM private.account_deletions
            WHERE user_id = tests.fixture('no_garden') AND cancelled_at IS NOT NULL),
  1::bigint, 'P6: the cancelled request is kept as history, not overwritten');
SELECT throws_ok(
  $$INSERT INTO private.account_deletions (user_id, scheduled_at, source)
    VALUES (tests.fixture('no_garden'), now() + interval '30 days', 'in_app')$$,
  '23505', NULL, 'N8: the index rejects a second open row even outside the RPC');

SELECT tests.authenticate_as('no_garden');
SELECT throws_ok($$SELECT id FROM private.account_deletions$$,
  '42501', NULL, 'N9: authenticated still cannot read private.account_deletions');

SELECT * FROM finish();
ROLLBACK;
```
The plan count is 17: S1, S2, N1–N9 and P1–P6. The executor must count the assertions and adjust `plan(N)` if any are added or removed.

**7b GREEN. NEW `supabase/migrations/${TS}_account_deletions_history.sql`**, with `TS=$(date -u +%Y%m%d%H%M%S)`:
```sql
-- SPEC-001 R45/R47, EC-08 (SPEC-001-T50): a cancelled deletion request must not block a later one.
-- 20260828_0009_auth.sql made user_id the primary key, and cancel only stamps cancelled_at, so a
-- request after a restore failed with a raw duplicate-key error on account_deletions_pkey.
-- Forward-only (SCRUM-18; Data Model §15): 0009 and 0010 are not edited.
--
-- Each request is now its own row, so history is kept. At most one row per user is OPEN (neither
-- cancelled nor executed); a partial unique index enforces that, which also closes the
-- check-then-insert race in request_account_deletion. The RPCs need no change: they already filter
-- on cancelled_at IS NULL AND executed_at IS NULL. No client grants (private schema).
-- Asserted by supabase/tests/auth_account_deletion_history.test.sql.

ALTER TABLE private.account_deletions DROP CONSTRAINT account_deletions_pkey;

ALTER TABLE private.account_deletions
  ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

CREATE UNIQUE INDEX account_deletions_one_open_per_user
  ON private.account_deletions (user_id)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;

-- The PK index used to serve the profiles FK (ON DELETE CASCADE) and per-user lookups.
CREATE INDEX account_deletions_user_idx ON private.account_deletions (user_id);

COMMENT ON TABLE private.account_deletions IS
  'One row per deletion request (SPEC-001 R45). At most one open row per user '
  '(account_deletions_one_open_per_user); cancelled and executed rows are history.';
```
Notes for the executor:
- The PK constraint name is the Postgres default for `user_id uuid PRIMARY KEY` on that table.
- If a concurrent race does happen, the second insert now raises 23505 from the index, with a different message from `'conflict'`. The SQLSTATE is the same, so it is acceptable (§6).
- **Do not** edit `20260828_0009_auth.sql`, `20261021_0010_review_fixes.sql`, or `supabase/tests/auth_account_deletion.test.sql` (WP-34 and WP-35 edit that file).

### Step 8: Docs

**8a. `docs/03-specs/SPEC-001-authentication.md`.** Do not touch lines 167 or 564 (WP-08).
- Header: `| **Version** | 1.1.0 |` → `1.2.0`; `**Last updated**` → `2026-10-22`.
- §6: directly after `CREATE INDEX account_deletions_due_idx … ;` (`:188-189`), inside the same SQL block, add:
  ```sql
  -- Amended by <TS>_account_deletions_history.sql (SPEC-001-T50): user_id is no longer the key.
  -- Each request is a row (id identity PK); at most one open row per user
  -- (UNIQUE (user_id) WHERE cancelled_at IS NULL AND executed_at IS NULL); cancelled rows are history.
  ```
- §8.3 additions:

  | Table | Condition | Copy |
  |---|---|---|
  | Sign-in and signup errors | Network failure | `We couldn't reach Sharecropr. Check your connection and try again.` |
  | Sign-in and signup errors | Sign-in rate limited, no `Retry-After` available *(interim until the §8.2 countdown is built; see Q3)* | `Too many sign-in attempts. Wait a few minutes and try again.` |
  | Email verification | Return without a session | `Back to sign in` |
  | Password reset | Link invalid (expired, used, other device) | `That reset link didn't work` / `Reset links work once, expire after 60 minutes, and open only on the device that asked for them. Request a new one.` / action `Request a new link` |
  | Account deletion | Account status unavailable | `We couldn't check your account` / `Check your connection and try again.` / actions `Try again` / `Sign out` |
  | Account deletion | Restore failed | `We couldn't restore your account just now. Try again.` |

- EC-08 (`:423`) becomes: "`private.account_deletions` holds at most one *open* request per `user_id` (partial unique index); the second request returns `conflict` (409), which the web flow renders as "Deletion is already scheduled for {date}". No double-scheduling. A request after a restore is a new row, and the cancelled one is kept (T50)."
- §13.1: append rows T46–T54 after T45, using the "Covers" column from §1 above. Descriptions:
  - **T46:** "After the session arrives, `/` shows the splash until `get_account_deletion_status` answers for *that* user, then redirects to `/restore-account` when pending, never to `/map` first. A server error renders an actionable retry (Invariant 10). Unreachable, or no answer in 8 s, opens the app normally (§8.2 Offline; EC-07 holds server-side). The restore screen renders the same retry instead of a blank screen."
  - **T47:** "Reset uses `redirectTo: sharecropr://reset-password`, listed in `config.toml` `additional_redirect_urls` and resolving to `/(auth)/reset-password`. The screen exchanges the PKCE `code` exactly once before showing the form. An error param, a failed exchange, or no code and no session renders 'Request a new link'."
  - **T48:** "After a sessionless `signUp` (`enable_confirmations = true`), `/verify-email` shows the address from the route params and resend calls GoTrue `resend` for it without a session. With neither a session nor an address it redirects to `/sign-in`."
  - **T49:** "`mapAuthError` derives `email_not_confirmed`, `network`, `rate_limited`, `suspended` and `bad_credentials` from GoTrue's `code`/`status`/`name`, with the message as fallback. Sign-in shows distinct copy for each and routes `email_not_confirmed` to `/verify-email`."
  - **T50:** "request → cancel → request schedules a new deletion. The cancelled row is kept. At most one open row per user (partial unique index, also outside the RPC). A second open request returns `conflict`."
  - **T51:** "'Keep my account' navigates only when `cancel_account_deletion` succeeds. An error shows inline copy and keeps the screen. `invalid_transition` shows the grace-elapsed state."
  - **T52:** "Apple cancel (`err.code === 'ERR_REQUEST_CANCELED'`) and Google sheet dismissal return silently: no error copy, no navigation."
  - **T53:** "One user intent (delete, restore, email change) sends the same `p_idempotency_key` on every retry. A new intent, a remount or an edited email sends a new key. The server replays the stored result for a repeated key and rejects a reused key with different arguments."
  - **T54:** "Concurrent first `getQueryCache()` calls generate and persist one encryption key and open one MMKV instance. A failed open can be retried."
- T19: append " Unit slice: when global sign-out fails, the stored session is purged before the local sign-out."
- Change Log row: `| 2026-10-22 | 1.2.0 | Engineering — Auth | WP-AUTH-FIX: private.account_deletions keeps history with one open row per user (EC-08, T50); §8.3 copy for network, interim rate-limit, invalid reset link, account-status and restore failures; T46–T54 added for the boot deletion gate, reset deep link, sessionless verify, error mapping, provider cancel, per-intent idempotency keys and query-cache single-flight; T19 gains a unit slice |`

**8b. `docs/01-architecture/02-mobile-architecture.md`**
- §3, line 455: `/reset-password  ← email deep link target (token in fragment)` → `/reset-password  ← email deep link target (sharecropr://reset-password?code=…, PKCE code exchanged on the screen — SPEC-001-T47)`
- Change log row: `| 2026-10-22 | 1.1.3 | Architecture | §3: the reset deep link is sharecropr://reset-password with a PKCE ?code= query, not a fragment token; the root route's logic lives in src/features/auth/screens/BootGateScreen.tsx because every file under app/ is a route (WP-AUTH-FIX) |`

**8c. `AGENTS.md` §7.** Insert one bullet at the top of the list (150 → 151 lines; the bridge limit is 200):
`` - `[2026-10-22] [claude] Never put tests or helpers under app/: expo-router makes every .ts(x) there a route (node_modules/expo-router/_ctx-shared.js), so route logic lives in src/features/*/screens and app/ files only re-export. auth-js signOut() returns early WITHOUT clearing storage when the session needs a refresh it cannot do (offline + expired token), and scope 'local' takes the same path: sign out through signOutWithLocalFallback in src/api/supabase.ts (SPEC-001-T19).` ``

**8d.** Write §5 to `<wt>/.wp-commit-msg`. Do not commit.

---

## 3. Verification (run from the worktree; paste the output)

| # | Command | Expected |
|---|---|---|
| V1 | `npm test -- --ci` | Green. Baseline + ~70 new tests (15 new or edited suites). The existing `console.warn` about `EXPO_PUBLIC_SUPABASE_*` is OK |
| V2 | `npm run lint` | 0 errors, 0 warnings |
| V3 | `npm run lint:fixtures` | The same `N/N` as the Step 0 baseline (eslint config untouched) |
| V4 | `npm run typecheck` | Exit 0 (worktree has no `.expo/types`; `Href` casts keep it typed either way) |
| V5 | `npm run ci:doc-gates && npm run test:doc-gates` | Exit 0 |
| V6 | `./scripts/agent-memory-bridge.sh check` | Intact, `AGENTS.md is 151 lines` |
| V7 | `npm run ci:assert-negative-ratio` | Includes `OK: auth_account_deletion_history.test.sql P=6 N=9`; exit 0 |
| V8 | `npm run ci:assert-no-private-grants` | `OK` |
| V9 | `grep -rnE "from 'react-native'" src/api` | No output |
| V10 | `grep -n "randomUUID" src/features/auth/lib/auth-service.ts` | No output |
| V11 | `grep -rn "auth/reset-password" src supabase app` | No output. `grep -n "sharecropr://reset-password" supabase/config.toml src/features/auth/lib/auth-service.ts` shows both |
| V12 | `grep -n "ERR_REQUEST_CANCELED" src/features/auth/lib/oauth.ts` | Only the `.code ===` comparison (and its comment) |
| V13 | `git diff --name-only origin/develop -- supabase/migrations supabase/tests` | Exactly the two new files; 0009, 0010 and `auth_account_deletion.test.sql` unchanged |
| V14 | `ls supabase/migrations \| sed 's/_.*//' \| sort \| uniq -d` | No output |
| V15 | `find app -path '*__tests__*'` | No output |

**Deliberate red mutations.** Make each one, confirm it goes red, revert, confirm green. Report all six.
- **M1:** in `useDeletionStatus`, return `{ kind: 'ready', status: { pending: false } }` instead of `LOADING`. BootGate T46 test 1 fails: `/map` is redirected first.
- **M2:** in `oauth.ts`, change the cancel check back to `err instanceof Error && err.message.includes('ERR_REQUEST_CANCELED')`. T52 test 1 fails.
- **M3:** in `query-cache.ts`, delete `if (opening) return opening;`. T54 test 1 fails (two keys set).
- **M4:** in `auth-service.ts`, set `p_idempotency_key: Crypto.randomUUID()` in `requestAccountDeletion`. T53 tests in auth-service and DeleteAccountScreen fail.
- **M5:** map `'email not confirmed'` to `bad_credentials`. T49 tests fail.
- **M6:** in `signOutWithLocalFallback`, remove the `removeItem` line. T19 test 2 fails.

pgTAP cannot run locally (no Docker, no psql). Its proof is CI `db.yml`, which stays red until WP-09/WP-10/WP-12 land. State this in the report.

---

## 4. Jira

**Summary line (new Bug under SCRUM-9):**
`Fix EPIC-03 auth review findings: boot deletion-gate race, password-reset deep link, sessionless verify-email, auth error mapping, deletion re-request, restore errors, Apple cancel, offline sign-out, per-intent idempotency keys, query-cache single-flight`

**AC mapping for that ticket.** Every AC is done, except that the DB part is unverified in CI:

| Finding | Evidence | Status |
|---|---|---|
| 1, 6a | BootGateScreen / useDeletionStatus / RestoreAccountScreen tests (T46) | Done |
| 2 | auth-service + ResetPasswordScreen tests (T47), config.toml, V11 | Done in code. **Hosted redirect allowlist: Corey (Q5)** |
| 3 | VerifyEmail + SignUp tests (T48) | Done |
| 4 | mapAuthError + SignIn tests (T49) | Done. Rate-limit copy is interim (Q3) |
| 5 | Migration + pgTAP (T50), V7, V13 | Code done; **pgTAP unverified until db.yml is green** |
| 6b | RestoreAccountScreen tests (T51) | Done |
| 7 | oauth + SignIn/SignUp tests (T52) | Done |
| 8 | supabase.ts + auth-service tests (T19 slice); premise corrected | Done |
| 9 | useIntentKey, Delete, Restore, Security tests + pgTAP replay (T53) | Done (pgTAP part as #5) |
| 10 | query-cache tests (T54) | Done |

Integrator comment for the new ticket: `Partial — pushed to develop in <sha>: all 10 EPIC-03 review findings fixed with SPEC-001-T19/T46–T54 tests (Jest) and a forward migration + pgTAP for account_deletions history. Open: pgTAP runs only once db.yml is green (WP-09/10/12); hosted Supabase redirect allowlist needs sharecropr://reset-password.` → **In Progress**.

Related tickets. Comment only and leave their status alone unless the orchestrator says otherwise (Q1):
- SCRUM-63: `Covered by WP-AUTH-FIX in <sha>: useIntentKey, idempotency key params, two-submit tests, pgTAP replay. Recommend Done after review.`
- SCRUM-71, SCRUM-52, SCRUM-51, SCRUM-56, SCRUM-68: `Partly covered by WP-AUTH-FIX in <sha>: <the overlap row from §0>. Remaining scope unchanged.`

---

## 5. Commit message (`.wp-commit-msg`)

```
fix(auth): close 10 EPIC-03 review findings (deletion gate, reset link, sign-out, idempotency)

- Boot gate: deletion status is keyed on the user id and derived during
  render, so the root route can no longer redirect to /map before
  get_account_deletion_status answers for the user who just signed in.
  A server error shows a retry; offline or a timeout opens normally.
  The logic moves to BootGateScreen (files under app/ are routes).
- Restore screen: a status error or a failed cancel shows an actionable
  state instead of a blank screen or a false "restored" navigation.
- Password reset: redirect to sharecropr://reset-password (allowlisted in
  config.toml, resolves to the (auth) route); the screen exchanges the
  PKCE code once and shows "request a new link" when it cannot.
- Verify email: signUp returns no session while confirmations are on, so
  the address travels in route params and resend works without a session.
- mapAuthError reads GoTrue code/status/name: email_not_confirmed (routed
  to verify-email), network and rate_limited get their own sign-in copy.
- Apple cancel is detected by err.code; provider cancels are silent.
- Sign-out: when global sign-out fails (offline with an expired token,
  where auth-js returns without clearing storage and scope 'local' does
  the same), purge the stored session, then sign out locally; the query
  cache is wiped regardless.
- Idempotency keys are held per user intent (useIntentKey) and passed
  in, so retries are deduplicated server-side.
- getQueryCache is single-flight, like refreshSessionSingleFlight, so
  concurrent first calls cannot race on the encryption key.
- db: private.account_deletions keeps history (identity PK, one open
  request per user via a partial unique index); a request after a
  cancel no longer fails on the old user_id primary key. Forward-only.
- docs: SPEC-001 1.2.0 (T46-T54, §8.3 copy, EC-08, §6 note), mobile-arch
  §3 reset deep link, AGENTS.md memory entry.

pgTAP (auth_account_deletion_history.test.sql) runs only once db.yml is
green; it was not executed locally.

Refs: SCRUM-63, SCRUM-71, SCRUM-52, SCRUM-51, SCRUM-56, SCRUM-68

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
The integrator adds the new Bug key to `Refs:` once it exists.

---

## 6. Open questions for Corey, and out of scope

**Open (not decided here; the plan's default is in brackets):**
- **Decided (Corey, 2026-10-22): default accepted.** **Q1. Overlap with the queued WP-27/28/29/30/31.** This package fully delivers WP-27 (SCRUM-63) and parts of the others (§0 table). [Land this first, retire WP-27, and have the WP-28/29/30/31 planners start from these files.] The orchestrator should update `queue.json`.
- **Decided (Corey, 2026-10-22): default accepted.** **Q2. Boot gate when the status RPC is unreachable.** SPEC-001 §8.2 Offline says "the app opens normally offline", and R47 says "signing in during grace presents restore". [Unreachable or timeout opens normally; a server error blocks with a retry. EC-07 stops grace-period writes server-side.] The alternative is to block on any failure. It is a one-line switch in `BootGateScreen`.
- **Decided (Corey, 2026-10-22): default accepted.** **Q3. Rate-limit copy.** §8.2/§8.3 want a live `Retry-After` countdown, but supabase-js's `AuthError` does not expose response headers. [Interim copy "Wait a few minutes", recorded in §8.3.] WP-31 has to find a way to get the header, or §8.2 must be amended.
- **Decided (Corey, 2026-10-22): default accepted.** **Q4. PKCE recovery is same-device only.** The code verifier lives in this device's SecureStore, so a link opened on another device fails. The new copy says so. [Accept for MVP.] The alternative is the `token_hash` + `verifyOtp` email template, which works across devices.
- **Decided (Corey, 2026-10-22): default accepted.** **Q5. Hosted Supabase Redirect URLs** must include `sharecropr://reset-password` (dashboard setting, external).
- **Q6. SPEC-001 version ordering with WP-08:** this package takes 1.2.0; WP-08 should take 1.2.1 if it lands later. WP-08's V3 file-count expectation also changes (§0).

**Out of scope (noticed, not touched):**
- `(tabs)/_layout.tsx` has no deletion gate, so a grace-period user deep-linking to a tab skips restore (WP-34, T37).
- `SecuritySettingsScreen` maps every email-change error to `aal2Required` (WP-32).
- `VerifyEmailScreen` starts a 3600 s cooldown after one resend; R18 allows 3 per hour (WP-30, `Retry-After`).
- `void signOut().then(…)` call sites have no `.catch` (WP-28's `signOutAndRedirect`).
- `wipeQueryCache` during an in-flight `getQueryCache` can recreate the cache file (WP-29).
- The concurrent `request_account_deletion` race now returns 23505 with the index's message rather than `'conflict'`. A follow-up could catch it in the RPC.
- `private.pending_email_changes` has the same `user_id PRIMARY KEY` shape. It is safe today (expired rows are deleted), but WP-32's confirm path must delete the row.
- The mobile-arch header still says `Version: 1.0.0` (pre-existing drift).
- This Mac's `node_modules` contains Finder duplicates (`AppleAuthentication 2.ts`, `postgrest-js/dist/index 2.cjs`). The worktree's `npm ci` avoids them; worth cleaning in the main clone.

### Critical Files for Implementation
- /Users/cxb317/Documents/ai/sharecropr/src/features/auth/lib/auth-service.ts
- /Users/cxb317/Documents/ai/sharecropr/src/features/auth/hooks/useDeletionStatus.ts (new; replaces the logic in /Users/cxb317/Documents/ai/sharecropr/app/index.tsx)
- /Users/cxb317/Documents/ai/sharecropr/src/api/supabase.ts
- /Users/cxb317/Documents/ai/sharecropr/src/features/auth/screens/ResetPasswordScreen.tsx
- /Users/cxb317/Documents/ai/sharecropr/supabase/migrations/20260828_0009_auth.sql (read-only reference for the new `<TS>_account_deletions_history.sql`)