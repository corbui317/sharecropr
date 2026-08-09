# ADR-0007: Token storage — SecureStore with a chunked adapter

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile, Security |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Under [ADR-0003](ADR-0003-database-centric-authz.md) the JWT *is* the authorization context. Every RLS policy resolves `auth.uid()` from it, `app.is_moderator()` reads a claim out of it, and there is no service tier that could re-derive identity if the token were wrong. A stolen refresh token is a stolen account, and a stolen account can read its own garden's exact coordinates, message counterparties, and schedule meetings with real people. This is not a session-cookie-grade secret.

`supabase-js` defaults to `AsyncStorage` in React Native. `AsyncStorage` is an unencrypted SQLite file in the app's sandbox. On an unrooted device the sandbox is a real boundary; on a rooted or jailbroken device, an unencrypted-backup-enabled Android device, or a device seized and imaged, it is not. For an app that gates physical meetings, "protected by the sandbox alone" is the wrong default.

The obvious fix — `expo-secure-store`, which wraps iOS Keychain and Android Keystore — has a specific, well-documented limitation: **items above roughly 2 KB are not reliably supported**, and on Android the underlying `KeyStore` path warns and can fail outright. A Supabase session object is a JSON blob containing an access JWT, a refresh token, the user object, and metadata. With custom claims and a populated user record, that blob routinely lands between 2 KB and 4 KB, and it grows whenever someone adds a claim. So the naive `storage: SecureStore` configuration works in development, works for most users, and fails silently for the subset whose session happens to be large — presenting as random logouts that are miserable to diagnose.

The second problem is refresh timing. Mobile apps are suspended, not closed. A user backgrounds the app at 9am and foregrounds it at 6pm; the access token expired hours ago and the auto-refresh timer did not run because the JS thread was frozen. If that is not handled, the first request after resume 401s and the user sees an error screen instead of their map.

## Decision

**Persist the Supabase session in `expo-secure-store` through a chunked storage adapter, use PKCE for every OAuth flow, and drive token refresh from `AppState`.**

### Chunked adapter

```ts
// src/api/secureStorage.ts — the only place SecureStore is touched.
const CHUNK = 1800;                       // conservative margin under the 2 KB limit
const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const chunkedSecureStorage = {
  async getItem(key: string) {
    const head = await SecureStore.getItemAsync(`${key}.0`, opts);
    if (head === null) return null;
    const count = Number(await SecureStore.getItemAsync(`${key}.n`, opts) ?? '1');
    const parts = [head];
    for (let i = 1; i < count; i++) {
      const p = await SecureStore.getItemAsync(`${key}.${i}`, opts);
      if (p === null) { await this.removeItem(key); return null; }  // torn write → force re-auth
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string) {
    await this.removeItem(key);                                     // never leave orphaned tail chunks
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? [''];
    await SecureStore.setItemAsync(`${key}.n`, String(parts.length), opts);
    for (let i = 0; i < parts.length; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, parts[i], opts);
    }
  },
  async removeItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(`${key}.n`, opts) ?? '0');
    for (let i = 0; i < Math.max(count, 8); i++) {
      await SecureStore.deleteItemAsync(`${key}.${i}`, opts);
    }
    await SecureStore.deleteItemAsync(`${key}.n`, opts);
  },
};
```

Key properties: a torn or partial read **deletes the whole entry and forces re-authentication** rather than handing `supabase-js` a corrupt session. `removeItem` sweeps beyond the recorded count so a shrinking session cannot leave a stale tail.

### Client configuration

```ts
createClient(URL, ANON_KEY, {
  auth: {
    storage: chunkedSecureStorage,
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,   // not a browser
  },
});

AppState.addEventListener('change', (s) => {
  s === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh();
});
```

### Rules

| Rule | Value |
| --- | --- |
| Accessibility class | `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — never syncs to iCloud Keychain or Android backup |
| Android backup | `allowBackup=false` via config plugin; belt and braces |
| OAuth flow | PKCE only, native browser/sheet, never an embedded webview ([ADR-0006](ADR-0006-auth-providers.md)) |
| TOTP secrets | Never stored on device. Enrollment state only ([ADR-0014](ADR-0014-totp-not-sms.md)) |
| Logout | `removeItem` on the session key **and** MMKV cache purge — the cache holds counterparty names and listing data ([ADR-0011](ADR-0011-state-management.md)) |
| Refresh token reuse | Rotation enabled server-side; reuse revokes the family and forces re-auth |
| `service_role` key | Never in the app, in an env var the app reads, in an EAS build profile, or in an OTA bundle ([RLS Design §1](../05-rls-design.md#1-non-negotiable-rules), RLS-3) |
| Biometric gate | Not on the session. Reserved for step-up on sensitive actions |

## Alternatives considered

### `AsyncStorage` (the `supabase-js` default)

**What it is.** Plaintext key-value store in the app sandbox.

**Why we didn't.** A refresh token in cleartext on disk, for an app whose compromise reveals a home address and an in-person meeting schedule. The sandbox is a real control and it is the only one; that is one layer too few here.

### `react-native-mmkv` with encryption for the session

**What it is.** MMKV is already a dependency for the cache and supports an encryption key.

**Why we didn't.** MMKV's encryption key has to live somewhere, and that somewhere is SecureStore — so this is SecureStore with extra steps and a larger attack surface. It also puts the session and the general cache in one store, where a cache-clear bug can log everyone out. MMKV stays for non-secret cache only.

### Custom native Keychain module with no size limit

**What it is.** Write directly against Keychain and Keystore, no 2 KB constraint.

**Why we didn't.** A bare native module breaks the CNG/prebuild story from [ADR-0001](ADR-0001-mobile-stack.md) and requires an ADR of its own. The chunking adapter is ~40 lines and testable. If the adapter proves flaky in production, this is the escalation.

### Storing only the refresh token securely, access token in memory

**What it is.** Split storage: refresh token in SecureStore, short-lived access token never persisted.

**Why we didn't.** Marginally better on paper and it fights `supabase-js`, which manages the session object as a unit. The gain is small — the access token expires in an hour and the refresh token is the real prize, and that one is in SecureStore either way. Revisit only if we stop using `supabase-js` session management.

## Consequences

### Positive

- Refresh tokens are protected by hardware-backed keystores, not by the sandbox alone.
- `WHEN_UNLOCKED_THIS_DEVICE_ONLY` means a compromised iCloud account does not yield a Sharecropr session, and an Android backup does not carry credentials to a new device.
- PKCE removes the authorization-code interception class of attack on the OAuth callback.
- AppState-driven refresh eliminates the "opened the app after lunch and got an error" failure entirely.
- The 2 KB limit is handled deliberately, in one tested file, before it produces mystery logouts in production.

### Negative

- **Chunked writes are not atomic.** A crash mid-write leaves partial chunks; the adapter's response is to invalidate and force re-login. That is the safe outcome, and it is still a logout the user did not ask for.
- Multiple Keychain round-trips per session read adds a few milliseconds to cold start. Measurable, not perceptible.
- Session size is now a thing that matters. Adding a large custom JWT claim increases chunk count. There is a test asserting the session stays under **6 KB** so this is caught in CI rather than on a user's phone.
- SecureStore behaviour differs across Android OEM Keystore implementations; a specific vendor's device failing is plausible and hard to reproduce.

### Neutral / accepted costs

- One more adapter to maintain against `supabase-js` storage-interface changes.
- The adapter needs its own unit tests for the boring cases: exactly-at-boundary values, shrinking sessions, torn reads, concurrent writes.
- Logout must clear two stores, and forgetting the second one leaks a previous user's cached counterparty data into the next session — this is a test case, not a comment.

## The strongest argument against this decision

We have written a bespoke, non-atomic, multi-key persistence layer and put the authentication session on top of it. Chunking is exactly the kind of code that is right in review and wrong in the field: the failure modes are all concurrency and interruption — two writes racing during a token refresh, the process killed between chunk 2 and chunk 3, an OEM Keystore that returns `null` under memory pressure rather than throwing — and every one of them presents identically to the user as "logged out for no reason," which is unattributable in Sentry and produces a support ticket we cannot reproduce. Meanwhile the threat we bought protection against requires physical access to an unlocked device or a rooted one, which is a small fraction of the user base, and against a *rooted* device SecureStore is substantially less protective than the marketing implies anyway — Keystore key material is protected, but a root-level attacker with the app's identity can simply ask Keystore to decrypt. So we may have accepted a real, recurring availability bug affecting all users in exchange for a defence-in-depth improvement against a threat affecting few, in a scenario where the improvement is partial. The plain alternative — `AsyncStorage`, one atomic write, zero custom code, and a short refresh-token lifetime with rotation and reuse detection — is what most production RN apps ship, and its failure mode is a threat model note rather than a logout.

We take the chunked path because the token here is unusually valuable (it unlocks a home address and a meeting schedule), because rotation-with-reuse-detection is a mitigation we get *in addition*, not instead, and because the adapter's failure mode is fail-closed. But the unexplained-logout rate below is the metric that decides whether this was right.

## Revisit when

- **Unexplained re-authentication rate exceeds 1% of sessions per week**, or any spike correlates with an app or OS release. This is the primary trigger; instrument it from day one.
- The serialized session exceeds **6 KB** (the CI assertion) — reconsider what is in the JWT before increasing `CHUNK`.
- A specific Android OEM shows a SecureStore failure rate above **2%** of its users, in which case the custom native module becomes the answer for that path.
- `expo-secure-store` raises its documented size limit, at which point the adapter degrades to a passthrough and should be deleted rather than kept "just in case."
- We adopt passkeys ([ADR-0006](ADR-0006-auth-providers.md)), which changes what is stored and may make this ADR partially obsolete.
- Any evidence of a token exfiltrated from a device — one confirmed instance reopens the whole model, including biometric gating.

## Related

- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0006 Auth providers](ADR-0006-auth-providers.md), [ADR-0011 State management](ADR-0011-state-management.md), [ADR-0014 TOTP not SMS](ADR-0014-totp-not-sms.md)
- [System Architecture §3](../01-system-architecture.md#3-container-view), [RLS Design §2](../05-rls-design.md#2-roles)
