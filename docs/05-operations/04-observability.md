# Observability

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Platform Engineering

---

## 1. The constraint that shapes everything

Standard observability practice is to log liberally and figure out what matters later. **We cannot do that.** A verbose log line in this system is a home address in a log aggregator with a different retention policy, different access controls, and a different threat model from the database we spent an entire architecture protecting.

So: log deliberately, scrub aggressively, and **test the scrubbing** — because a scrubber that silently stops working after a library upgrade is worse than no scrubber, since everyone still believes it's there.

---

## 2. Stack

| Tool | Purpose | Data |
| --- | --- | --- |
| Sentry | Crashes, errors, mobile performance | Scrubbed diagnostics; no PII, no coordinates |
| PostHog | Product analytics | Pseudonymous ids; spatial capped at H3 r5 |
| Supabase logs | Postgres, PostgREST, Auth, Edge Functions | Query and request logs, RPC params suppressed for spatial functions |
| Grafana + Prometheus | Infrastructure and custom metrics | Aggregates only |
| PagerDuty | On-call | Alert payloads only |
| `audit.events` | Security and moderation trail | In-database, immutable, 7 years |

---

## 3. Telemetry scrubbing

The single most important control in this document.

```ts
// src/observability/scrub.ts
const FORBIDDEN_KEY = /lat|lng|latitude|longitude|coord|point|geohash|h3_r[89]|
                       password|passwd|secret|token|authorization|api[_-]?key|
                       handoff_code|fuzz_seed|exact_point/ix;

const MESSAGE_KEY = /^(body|message|text|content)$/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const COORD_SHAPED = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[depth]';
  if (typeof value === 'string') {
    return value.replace(EMAIL, '[email]').replace(COORD_SHAPED, '[coord]');
  }
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([k, v]) => {
        if (FORBIDDEN_KEY.test(k)) return [];              // drop the key entirely
        if (MESSAGE_KEY.test(k)) return [[k, '[redacted]']];
        return [[k, scrub(v, depth + 1)]];
      }),
    );
  }
  return value;
}

Sentry.init({
  dsn: Config.SENTRY_DSN,
  beforeSend: e => scrub(e) as Sentry.Event,
  beforeBreadcrumb: b => scrub(b) as Sentry.Breadcrumb,
  tracesSampleRate: 0.1,
});
```

Three details that matter:

- **Forbidden keys are dropped, not redacted.** A key named `latitude` with the value `[redacted]` still tells an attacker the shape of the data. Removing it tells them nothing.
- **`COORD_SHAPED` catches coordinates that arrive inside a string**, which is how they usually escape — concatenated into an error message rather than sitting in a tidy named field.
- **Depth limiting** prevents a cyclic or pathological object from hanging the scrubber, which would silently disable it.

### Tests

Each rule has a test that fires a synthetic payload containing the forbidden value and asserts its absence from the outgoing event ([LP-08](../04-testing/01-test-strategy.md)). These run on every PR.

---

## 4. Logging policy

| Log | Contains | Never contains |
| --- | --- | --- |
| Application | Request id, route, user id (UUID), status, duration | Coordinates, message bodies, tokens, emails |
| Postgres statement | Query text, duration | **RPC parameters for `safe_spots_near` and `get_my_garden_location`** — explicitly suppressed |
| Auth | Event type, user id, IP, user agent | Passwords, tokens, TOTP secrets |
| Edge Function | Function, duration, outcome | Webhook payload bodies, vendor responses |
| Push | Notification id, kind, outcome | Title, body, deep-link parameters |

Retention: 30 days for application and Postgres logs, 90 days for auth events, 7 years for `audit.events`.

**IP addresses** are retained 30 days for abuse investigation, then dropped. They are P1 and appear in no analytics event.

---

## 5. Metrics and SLOs

### 5.1 Service level objectives

| SLO | Target | Window | Error budget |
| --- | --- | --- | --- |
| API availability | 99.9% | 30 days | 43 min |
| `safe_spots_near` p95 | < 400 ms | 7 days | — |
| Crash-free sessions | ≥ 99.5% | 7 days | — |
| Push delivery (to Expo) | ≥ 99% | 7 days | — |
| Severity-1 report first response | < 15 min | Per incident | **Zero budget** |
| Location invariant canary | 100% pass | Continuous | **Zero budget** |

The last two have no error budget by design. A missed safety escalation and a location leak are not the kind of failure you amortise.

### 5.2 Key metrics

| Metric | Type | Alert |
| --- | --- | --- |
| `api_error_rate` | rate | > 2% for 5 min |
| `safe_spots_near_p95` | histogram | > 400 ms for 10 min |
| `rls_query_p95` by table | histogram | > 50 ms for 10 min |
| `accept_request_contention` | counter | `listing_unavailable` > 20% of attempts |
| `db_connections_used` | gauge | > 80% of pool |
| `notification_outbox_depth` | gauge | > 1000 |
| `notification_dead_letter` | counter | Any |
| `content_scan_backlog` | gauge | > 500 |
| `kyc_inquiry_starts` | counter | > 150% of 7-day baseline |
| `kyc_monthly_spend` | gauge | > 130% of forecast |
| `report_sla_breach` | counter | **Any severity-1 breach** |
| `moderation_queue_depth` | gauge | > 50, or oldest > 18 h |
| `unaudited_moderator_read` | counter | **Any** |
| `location_canary_failure` | counter | **Any** |

---

## 6. Alerting

| Severity | Examples | Route | Response |
| --- | --- | --- | --- |
| **P0** | Location canary failure · unaudited moderator read · severity-1 report unacknowledged 15 min · total outage · confirmed data exposure | **Page immediately**, escalate to CTO at 15 min | Immediate |
| **P1** | API error rate breach · auth failures > 5% · database connections exhausted · dead-lettered notifications | Page during hours, ticket overnight | < 1 h |
| **P2** | Latency budget breach · outbox backlog · KYC spend anomaly · queue depth | Slack | < 4 h |
| **P3** | Stale safe-spot hours · flake rate · dependency CVE | Weekly digest | Next sprint |

### Alert hygiene

Every alert names a runbook. An alert with no runbook is deleted, because an alert nobody knows how to act on trains people to ignore alerts.

Alerts firing more than twice a week without a corresponding incident get their threshold reviewed or are removed. **Alert fatigue is the mechanism by which a real P0 gets missed**, and in this system the P0 that gets missed is a location leak.

---

## 7. Analytics

PostHog, with hard rules:

| Rule | Detail |
| --- | --- |
| Pseudonymous ids only | The user's UUID, never email or handle |
| **Spatial resolution capped at H3 r5** (~250 km²) | Enforced in the event wrapper; an event carrying anything finer is dropped and an error is logged |
| No message content, ever | — |
| No exchange times or safe-spot ids | These are P1 and are the burglary primitive ([T-43](../02-security/01-threat-model.md)) |
| Retention 25 months | Then deleted |
| Opt-out honoured | Product analytics only; crash reporting and security telemetry continue |

```ts
// The wrapper is the enforcement point, not a convention.
export function track(event: string, props: Record<string, unknown> = {}) {
  const clean = scrub(props) as Record<string, unknown>;
  if ('h3' in clean && h3Resolution(String(clean.h3)) > 5) {
    logger.error('analytics: spatial resolution above r5 rejected', { event });
    delete clean.h3;
  }
  posthog.capture(event, clean);
}
```

---

## 8. Dashboards

| Dashboard | Audience | Contents |
| --- | --- | --- |
| **Service health** | Engineering | Error rates, latency by endpoint, database, connection pool, Edge Functions |
| **Release** | Release manager | Crash-free by version, adoption curve, rollout stage, new issue types |
| **Trust & Safety** | T&S | Queue depth, SLA compliance, report reasons, action distribution, appeal overturn rate |
| **Product** | Product | Signup and verification funnels, listings per active safe spot, request→completion, retention cohorts |
| **Security** | Security | Canary status, audit anomalies, break-glass activations, failed authorization attempts, KYC spend |

The **listings per active safe spot** tile is the one to watch at launch. It is the liquidity metric, and liquidity — not code quality — is what decides whether this product works ([R-01](../06-roadmap/02-open-risks.md)).

---

## 9. The location canary

Runs every 15 minutes against production. It is the only control that verifies what we actually deployed rather than what we intended to deploy.

```ts
// Synthetic users A and B exist in production with real (synthetic) gardens.
const asA = createClient(url, anon, { auth: sessionFor(CANARY_A) });

// 1. A must not read B's garden location by any means.
const direct = await asA.from('gardens').select('*').eq('id', CANARY_B_GARDEN);
assertNoCoordinate(direct.data);

// 2. The private schema must be unreachable.
const priv = await asA.schema('private').from('garden_locations').select('*');
assert(priv.error, 'private schema is reachable — CRITICAL');

// 3. No RPC may return a coordinate for another user.
for (const rpc of PUBLIC_RPCS) {
  assertNoCoordinate(await asA.rpc(rpc, canaryArgsFor(rpc)));
}

// 4. A must still be able to read its OWN garden — otherwise the canary is
//    passing because everything is broken, which is a different failure.
const own = await asA.rpc('get_my_garden_location');
assert(own.data?.lat != null, 'canary user cannot read own garden — canary is invalid');
```

Any failure pages immediately, at any hour. Check 4 exists because a canary that passes when the whole API is down is a canary that lies.

---

## 10. Cost monitoring

| Cost | Alert |
| --- | --- |
| Supabase compute and storage | > 130% of forecast |
| **KYC inquiries** | > 130% of forecast, or > 150% of the 7-day baseline in a day |
| Storage egress | > 130% |
| Sentry event volume | > 130% |

KYC is the one to watch: it is the only cost that an attacker can drive up directly, and the alarm is a security control as much as a finance one ([T-30](../02-security/01-threat-model.md), [R-07](../06-roadmap/02-open-risks.md)).

---

## 11. What we deliberately don't collect

- Precise location in any analytics event
- Message content anywhere outside the database
- Full request or response bodies
- Device fingerprints beyond what is needed for abuse detection
- Behavioural profiles for advertising — there is no advertising, and building the collection capability "just in case" is how it ends up being used

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Platform Engineering | Initial observability |
