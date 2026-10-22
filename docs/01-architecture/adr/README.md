# Architecture Decision Records

**Status:** Active · **Owner:** Architecture

An ADR records a decision that was expensive to make and would be expensive to reverse. It exists so that the next engineer to hit the pain caused by a decision can find out whether the pain was anticipated.

Rules ([Doc Conventions §3.4](../../00-foundation/06-doc-conventions.md#34-decision-records--adr-)):

- Numbers are four digits, sequential, **never reused**.
- ADRs are never deleted or rewritten. A changed decision produces a **new** ADR; the old one gets `Superseded by ADR-####`.
- Every ADR carries a **"strongest argument against"** section. If that section is a straw man, the ADR is not finished.
- Every ADR carries **concrete revisit triggers**, with numbers where numbers exist.

Write a new ADR when a change touches the schema shape, the API surface, a security boundary, a vendor dependency, or any decision recorded here.

---

## Index

| # | Title | Status | Date | Decision in one line |
| --- | --- | --- | --- | --- |
| [0001](ADR-0001-mobile-stack.md) | Mobile stack | Accepted | 2026-08-08 | React Native + Expo SDK 57 / RN 0.86 / TypeScript strict, over Flutter and native Swift+Kotlin |
| [0002](ADR-0002-barter-only.md) | Barter only, no money | Accepted | 2026-08-08 | No currency, no payments infrastructure, no fees — in the product or in the schema |
| [0003](ADR-0003-database-centric-authz.md) | Database-centric authorization | Accepted | 2026-08-08 | Authorization and business logic live in Postgres (RLS + `SECURITY DEFINER` RPCs), not in an application tier |
| [0004](ADR-0004-supabase.md) | Supabase as backend platform | Accepted | 2026-08-08 | Managed Supabase over custom NestJS+Postgres or Firebase, with a documented exit cost |
| [0005](ADR-0005-geospatial-model.md) | Dual geospatial model | Accepted | 2026-08-08 | PostGIS `geography` for distance, H3 for bucketing; r5 analytics / r7 exposed / r9 internal-only |
| [0006](ADR-0006-auth-providers.md) | Auth providers at MVP | Accepted | 2026-08-08 | Email+password, Apple, Google at MVP; Facebook and X deferred to Phase 2; Apple Sign-In mandatory under Guideline 4.8 |
| [0007](ADR-0007-token-storage.md) | Token storage | Accepted | 2026-08-08 | `expo-secure-store` with a chunked adapter for >2 KB JWTs, PKCE flow, AppState-driven refresh |
| [0008](ADR-0008-edge-functions.md) | Edge Function boundary | Accepted | 2026-08-08 | Deno Edge Functions only for webhooks, push fanout, image processing, and cron — everything else stays in Postgres |
| [0009](ADR-0009-safe-spots-only.md) | Safe spots only | Accepted | 2026-08-08 | Exchanges happen only at curated public safe spots; no home meetings, no code path that produces one |
| [0010](ADR-0010-kyc-vendor.md) | KYC vendor | Accepted | 2026-08-08 | Persona hosted flow (Stripe Identity documented alternate); store pass/fail + inquiry ref only, never ID images |
| [0011](ADR-0011-state-management.md) | State management | Accepted | 2026-08-08 | TanStack Query v5 for server state, Zustand for ephemeral client state, MMKV for cache — no Redux, no Jotai |
| [0012](ADR-0012-navigation.md) | Navigation | Accepted | 2026-08-08 | Expo Router (file-based, typed routes) over React Navigation used directly |
| [0013](ADR-0013-map-library.md) | Map library | **Superseded** by [0019](ADR-0019-openstreetmap-maplibre.md) | 2026-08-08 | ~~`react-native-maps` behind a `MapCanvas` isolation seam~~ — the seam survives, the renderer does not |
| [0014](ADR-0014-totp-not-sms.md) | TOTP, not SMS | Accepted | 2026-08-08 | TOTP-only 2FA; SIM-swap risk is unacceptable for an app that gates physical meetings |
| [0015](ADR-0015-e2e-tooling.md) | E2E tooling | Accepted | 2026-08-08 | Maestro over Detox for end-to-end mobile tests |
| [0016](ADR-0016-pgtap.md) | Database testing | Accepted | 2026-08-08 | pgTAP against a real Postgres in CI, over mocking or app-level integration testing |
| [0017](ADR-0017-release-cadence.md) | Release cadence | Accepted | 2026-08-08 | EAS Build + EAS Update; OTA is JS-only, never native; two-version compatibility enforced from `devices.app_version` |
| [0018](ADR-0018-observability.md) | Observability | Accepted | 2026-08-08 | Sentry + PostHog + Supabase logs, behind a mandatory telemetry scrubber; >200 reports/day extracts moderation |
| [0019](ADR-0019-openstreetmap-maplibre.md) | **OpenStreetMap via MapLibre** | Accepted | 2026-08-09 | OSM vector tiles rendered by `@maplibre/maplibre-react-native`; identical on both platforms; supersedes [0013](ADR-0013-map-library.md) |
| [0020](ADR-0020-pmtiles-self-hosting.md) | **PMTiles self-hosting** | Accepted | 2026-08-09 | OSM basemap as a Protomaps PMTiles archive on Cloudflare R2 + CDN; no tile vendor, no per-load billing, offline-capable |
| [0021](ADR-0021-osm-safe-spot-sourcing.md) | **OSM safe-spot sourcing** | Accepted | 2026-08-09 | Overpass imports civic POIs as *candidates*; humans verify before any spot goes live. `opening_hours` is a hint, never truth |
| [0022](ADR-0022-profiles-other-user-reads.md) | **Other-user profile reads** | Accepted | 2026-10-21 | `profiles` gets a visible-rows SELECT policy plus card-safe column grants; owner-only columns via `get_my_profile()`; `profile_cards` stays `security_invoker` |

---

## Superseded

None. This is the initial decision set.
