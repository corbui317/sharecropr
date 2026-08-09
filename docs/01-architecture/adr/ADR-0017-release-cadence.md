# ADR-0017: EAS Build + EAS Update, with a mechanical two-version rule

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-08 |
| **Deciders** | Architecture, Mobile, Operations |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Mobile releases are asymmetric in a way that web releases are not: **we control when a new version is available and users control when it is installed.** A meaningful fraction of the install base runs a version that is weeks or months old, indefinitely, and there is no mechanism to force them forward that does not involve locking them out. Meanwhile the backend is a single Postgres instance shared by all of them ([ADR-0004](ADR-0004-supabase.md)), so every migration must be compatible with clients we shipped in the past.

Two things sharpen this for Sharecropr.

**Some bugs here are safety issues.** A defect in the exchange flow — a wrong safe-spot address on a scheduled meeting screen, a handoff confirmation that fires early, a `safety_alert` notification that fails to open its target — has a tolerance measured in hours, not in an App Store review cycle. We need a path to ship a JS fix the same day.

**The database is the API.** Under [ADR-0003](ADR-0003-database-centric-authz.md) there is no service tier to hold a compatibility shim. A dropped column or a changed RPC signature breaks old clients directly, immediately, with a PostgREST error the client has no way to handle. [System Architecture §10](../01-system-architecture.md#10-known-architectural-weaknesses) names this as a known weakness: "backend and mobile release cadences are coupled."

Over-the-air updates solve the first problem and worsen the second, because they make it easy to ship client changes fast enough to get ahead of a migration. And OTA carries its own hazard: both stores permit JS-only updates that do not change the app's purpose or add features outside what was reviewed, and both are unambiguous that shipping *native* changes or materially new functionality OTA is a violation.

## Decision

**EAS Build for binaries, EAS Submit for store delivery, EAS Update for JS-only fixes. Backward compatibility for two app versions, enforced mechanically from `devices.app_version`.**

### Channels and profiles

| Profile | Channel | Distribution | Purpose |
| --- | --- | --- | --- |
| `development` | — | Dev client | Local work |
| `preview` | `preview` | Internal, per PR | Review and Maestro flows ([ADR-0015](ADR-0015-e2e-tooling.md)) |
| `staging` | `staging` | TestFlight / Internal track | RC soak, store review builds |
| `production` | `production` | App Store / Play | Live |

`runtimeVersion` uses `{"policy": "appVersion"}`. An update can only reach a build with a matching runtime version, so a JS bundle can never land on a binary with a different native surface.

### OTA policy — the line, stated once

| Change | Path |
| --- | --- |
| JS, styling, copy, images, business logic in `src/` | **OTA permitted** |
| Any dependency with native code, permission, config plugin, `app.json` native field, Expo SDK bump | **Store submission required. No exceptions.** |
| New user-facing feature | **Store submission**, even if technically JS-only — this is a store-policy line, not a technical one |
| Critical safety fix, JS-only | **OTA, same day**, with a retro filed within 48 hours |

Enforcement: CI computes a fingerprint of the native surface (dependencies, plugins, native config) and **fails any `eas update` whose fingerprint differs from the target binary's**. The rule is not a convention someone remembers at 11pm; it is a check.

Rollback: `eas update:republish` to the previous known-good bundle. Target time to rollback is **under 10 minutes**, and it is rehearsed in [Runbooks](../../05-operations/05-runbooks.md).

### The two-version rule

**Every backend change must work correctly for the current app version and the two immediately preceding it.**

Mechanically enforced from real data rather than from a policy statement. `public.devices.app_version` is written on every session and is explicitly annotated in [Data Model §12](../03-data-model.md#12-notifications-devices-audit) as "read by CI to gate destructive migrations":

```sql
-- CI gate. A destructive migration fails while too many devices still need the old shape.
SELECT app_version, count(*) AS devices
  FROM public.devices
 WHERE last_seen_at > now() - interval '30 days'
 GROUP BY 1
 ORDER BY string_to_array(app_version, '.')::int[] DESC;
```

The gate: a migration tagged `destructive` (drop column, drop function, narrow a type, change an RPC signature or return shape) **fails CI if more than 2% of devices active in the last 30 days run a version older than the oldest supported one.**

Destructive changes therefore go through expand/contract, always:

1. **Expand** — add the new column, or add a new RPC name. Both shapes work.
2. **Migrate** — new client versions use the new shape. Ship. Wait.
3. **Contract** — drop the old shape only once the CI gate passes.

Contract migrations live in their own PR, never bundled with the expand. RPC signature changes are additive: `safe_spots_near_v2` exists alongside `safe_spots_near` until the old one is provably unused.

### Cadence

| Type | Frequency | Path |
| --- | --- | --- |
| Store release | Every 2 weeks, or when a native change requires it | EAS Build → Submit |
| OTA (routine) | As needed, batched with a store release | `production` channel |
| OTA (critical) | Immediately | With a retro within 48 hours |
| Migration | Continuous, ahead of the client that needs it | Expand/contract |

Migrations always deploy **before** the client that depends on them. A client feature waiting on a migration is normal; a migration waiting on a client rollout is a bug in the plan.

## Alternatives considered

### Store releases only, no OTA

**What it is.** Every change goes through review.

**Why we didn't.** A safety-relevant bug would take one to three days to reach users, and the tail of users on the broken version is much longer than that. The store-policy risk of OTA is real but manageable with a hard rule; the safety risk of no OTA is not manageable at all.

### Aggressive OTA — ship features over the air

**What it is.** Store releases only when native changes force them; features arrive OTA.

**Why we didn't.** Explicit store-policy violation and an existential risk to the app's presence in either store, for a convenience benefit. Also removes the review checkpoint that has, historically, caught real problems before users saw them.

### Forced update — block old clients

**What it is.** A minimum-version check; older clients show an upgrade wall.

**Why we didn't.** Not rejected as a mechanism — retained as an **emergency lever only**, for a security defect in a shipped client. Rejected as routine policy because it converts our migration convenience into a user's dead app, and because a user locked out mid-exchange has a real-world commitment they can no longer honour. If we need forced updates to ship migrations, the compatibility discipline has already failed.

### Support only the current version

**What it is.** Migrate freely; older clients break.

**Why we didn't.** Users do not update on our schedule. A user who last opened the app in July and has a scheduled exchange in August must be able to complete it.

### API versioning at the transport layer

**What it is.** Versioned endpoints, `/v1/`, `/v2/`.

**Why we didn't.** PostgREST exposes the schema; there is no gateway layer where a version could live without inventing one. The database-level equivalent is the additive-function pattern (`_v2` names), which is what we do — same idea, expressed where the API actually is.

## Consequences

### Positive

- Same-day path for critical JS fixes, which is the requirement that drove this.
- The two-version rule is a query against real device data, not a guess about what users are running.
- Expand/contract makes destructive changes structurally safe: the dangerous half cannot merge until the data says it is safe.
- The native-fingerprint check makes the store-policy line unbreakable-by-accident, which is the only kind of policy that survives a late-night incident.
- EAS removes signing, provisioning, and submission from the critical path entirely ([ADR-0001](ADR-0001-mobile-stack.md)).
- Rollback is a republish, measured in minutes rather than in review cycles.

### Negative

- **Every destructive change is a multi-week, multi-PR process.** Dropping a column takes at least two releases and a waiting period. This is tedious and it is the price of not breaking people.
- Old code paths and duplicate RPCs linger, and the schema accumulates deprecated shapes until someone does the contract work. Someone must own that or it never happens.
- OTA creates a version-skew debugging surface: a given user is on binary X with bundle Y, and Sentry must report both ([ADR-0018](ADR-0018-observability.md)).
- The 2% gate can be gamed by narrowing the `last_seen_at` window. That is a review-integrity issue, not a technical one.
- EAS is another vendor dependency on the release path.

### Neutral / accepted costs

- `runtimeVersion: appVersion` means every store release starts a new update channel lineage; older binaries stop receiving updates once unsupported. That is intended.
- Two-week cadence is a default, not a commitment; a release with nothing worth shipping should be skipped.
- Contract migrations need a recurring calendar slot, or the schema slowly fills with tombstones.

## The strongest argument against this decision

The two-version rule sounds rigorous and is actually a floor with a hole in it. It is enforced against devices seen in the last 30 days, which silently defines away the users who matter most: a gardener who used the app during August's harvest and next opens it the following June has not been "active," so their version is invisible to the gate, and the expand/contract cycle that ran through the winter will have contracted the exact shapes their client depends on. They will open the app to a broken screen with no error they can act on — and for a **seasonal product**, that is not an edge case, it is a substantial fraction of the user base every spring. The gate's window and our usage pattern are actively mismatched, and no amount of discipline in following the rule fixes a rule whose measurement excludes the population it is meant to protect.

The 2% threshold has the same character: it is a decision to knowingly break up to one user in fifty on every destructive migration, chosen because it makes the process tractable. For most products that is a reasonable trade. For this one, "broken" can mean a user cannot open the screen showing where and when they agreed to meet a stranger, and the failure arrives without warning at the moment of use. There is no in-app degradation path for a client whose RPC signature no longer exists.

The compounding version of the objection is that the whole scheme is a workaround for [ADR-0003](ADR-0003-database-centric-authz.md)'s absent service tier. A thin API layer would let us keep old contracts alive for old clients indefinitely, at a cost of a few adapter functions, and would decouple the release trains entirely — which is precisely the "known architectural weakness" the system architecture already admits. We have chosen to solve a versioning problem with process discipline and a CI query, where the standard solution is an architectural layer, and process discipline is the thing that degrades under deadline.

Mitigations we take now, having said that out loud: the gate query uses a **90-day** window for anything touching the exchange or location surface, not 30; every client wraps PostgREST errors in a "please update the app" state rather than a raw error; and a `minimum_supported_version` value is served from a config table so an old client can present a clear upgrade path instead of failing mysteriously. None of these is as good as the API layer would be.

## Revisit when

- **Any destructive migration breaks a real user.** One occurrence means the gate's window or threshold is wrong, and the seasonal-usage hole is the first place to look.
- Devices running an unsupported version exceed **5%** of 90-day actives at any point.
- More than **2 critical OTA updates** are needed in a quarter — that indicates a testing gap upstream, not a release-process success.
- The native-fingerprint check blocks a legitimate update more than twice, meaning the fingerprint definition is too broad.
- Any store rejection or warning referencing OTA content.
- Contract migrations fall more than **2 releases behind** their expand counterparts, so the schema is accumulating deprecated shapes faster than we retire them.
- A service tier is introduced per [ADR-0003](ADR-0003-database-centric-authz.md)'s migration path, at which point contract-versioning moves there and this ADR is partially superseded.

## Related

- [ADR-0001 Mobile stack](ADR-0001-mobile-stack.md), [ADR-0003 Database-centric authz](ADR-0003-database-centric-authz.md), [ADR-0012 Navigation](ADR-0012-navigation.md), [ADR-0015 E2E tooling](ADR-0015-e2e-tooling.md), [ADR-0018 Observability](ADR-0018-observability.md)
- [System Architecture §6, §10](../01-system-architecture.md), [Data Model §12, §15](../03-data-model.md#12-notifications-devices-audit)
