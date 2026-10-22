# Standards review: a5bd5e2...HEAD

## Hard violations

**1. The RN-import ban does not work (Invariant 11; mobile-arch §1/§1.1).** `eslint.config.js`:
- The `src/**/*.{ts,tsx}` block sets `no-restricted-imports` again. Flat config **replaces** a rule's options; it does not merge them. So for `src/domain/**/*.ts` the domain ban (react, react-native, expo-*) is overridden by the SDK/map-only list. The domain ban is effectively off. (I could not run `--print-config` because there is no node_modules; this follows from ESLint's flat-config semantics.)
- There is no rule at all for `src/api`. The domain block only matches `*.ts`, not `.tsx`. It also leaves out `@supabase/*`, `@tanstack/*` and `zustand`, which §1.1 lists.
- The `{ignores: [MapCanvas.tsx, supabase.ts, auth-types.ts]}` block is a **global** ignore. Those three files are not linted at all, and the doc's own snippet uses per-block `ignores` for exactly this reason.
- `app.yml` labels the step "Lint (includes the src/domain + src/api React Native import ban)". That label is false.

**2. `src/api` imports React Native (Invariant 11; mobile-arch §1 table: `src/api` may not import `react-native`).**
- `src/api/supabase.ts:1` has `import { AppState } from 'react-native'`.
- The docs disagree with each other here: mobile-arch §5 shows the same `AppState` code inside supabase.ts. Fix the doc or move the listener into a feature/boot hook. (`react-native-mmkv` and `expo-secure-store` in `src/api` are sanctioned by §2.3/§5.)

**3. A second SDK import site.** `src/api/auth-types.ts` re-exports from `@supabase/supabase-js`. Mobile-arch §1 says supabase.ts is "the ONLY @supabase/supabase-js import", and auth-types.ts is lint-ignored so it can get around that rule.

**4. FORCE RLS is not swept generically (Invariant 5, RLS Test Plan §5.1).**
- `structural_sweeps.test.sql` checks `rowsecurity` for every public table, but checks `relforcerowsecurity` only for profiles, gardens and blocks.
- verifications, exchange_sessions and message_threads are forced in their migrations, but no test covers them, and a future table would not be caught.
- `ci-assert-definer-allowlist.sh` is a `stub pass` wired into `db.yml` as a gate, so it reports green without checking anything. `ci-assert-rls.sh` is also a stub.

**5. Idempotency keys are minted on every call (API contract §3.1, mobile-arch §2.4).** `auth-service.ts` calls `Crypto.randomUUID()` inside `requestAccountDeletion`, `cancelAccountDeletion` and `requestEmailChange`. A retry therefore sends a new key, which defeats replay semantics. The key belongs to the user's intent, not to the call.

**6. Test tooling does not match the docs.**
- Unit tests are an ad-hoc `node:test` script (`scripts/auth-domain-tests.mjs`).
- There are no Jest/Vitest or React Native Testing Library tests at all, even though the diff adds 13 screens/components and 4 hooks.
- The docs conflict: test-strategy §2 says **Vitest**, while mobile-arch §1/§4, ADR-0015 and LP-08 say **Jest + RNTL**.
- The user's constitution asks for Playwright. The repo docs override that: ADR-0015 picks **Maestro** for E2E, so Playwright does not apply. No Maestro flows exist yet.
- SPEC-001 §13 coverage is a handful of T-IDs (AGENTS §5 admits this), and the traceability gate is unbuilt (N-07).
- The constitution's Docker requirement is not a repo standard. Only Supabase's local Docker is referenced; npm is correct (AGENTS "Commands").

## Judgement calls / smells

- **Transport leaks into features (mobile-arch §1, "src/api typed repositories").** `features/auth/lib/auth-service.ts` and `oauth.ts` call `supabase.*` directly. There are no generated DB types (`types.generated.ts`), so callers cast: `data as { pending?: boolean }` (app/index.tsx:20) and `data as DeletionStatus` (RestoreAccountScreen:28).
- **Duplicated Code.**
  - The deletion-status fetch and cast appear in both app/index.tsx and RestoreAccountScreen.
  - `void signOut().then(() => router.replace(...))` appears 4 times.
  - `getBasemapConfig()` and `resolveBasemapStyle()` duplicate the staging defaults (config/basemap.ts).
  - `keychainAccessible` options are spelled out twice in query-cache.ts.
- **Inconsistent result contract (Divergent Change).** auth-service returns `{error: AuthErrorCode}` on validation failure and the raw Supabase `{data, error}` from `updatePassword`, `resend`, the RPCs and others. Callers cannot handle errors uniformly. The exported functions have no explicit return types.
- **Swallowed errors (Invariant 10, spirit).**
  - app/index.tsx treats a failed deletion-status RPC as "not pending" and redirects to map.
  - `signOut().then(...)` has no catch.
- **Data Clumps / Mysterious Name.**
  - `domain/geo/types.ts` has two point shapes, `GeoPoint{lat,lng}` and `DeviceLocation{latitude,longitude}`.
  - There are three overlapping spot shapes (`SafeSpotFeature.count` / `SpotProps.listing_count` / `RenderableSpotMarker`) with mixed snake/camel case (`listing_count` next to `pointCount`).
- **Speculative Generality.** `hibpRequestPrefix` (domain/auth/hibp.ts) is exported and unused. `spikeData.ts` (fixture generator) lives in production `src/domain`.
- **Constitution vs repo.** The repo uses `type` aliases throughout and has no explicit-return-type rule. No repo doc requires interfaces or explicit return types, so these are constitution-only and low priority. `no-explicit-any` comes via `tseslint.recommended`, except for the globally ignored files. `MapCanvas.tsx:73` uses `as unknown as StyleSpecification`.
- **CI hygiene.** `db.yml` pins `supabase/setup-cli` to `version: latest`.
