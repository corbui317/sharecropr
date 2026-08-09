# Spec Template

> Copy everything below the line into `docs/03-specs/SPEC-###-your-slug.md`. Delete the guidance in blockquotes. Do not remove sections — write "Not applicable" with a reason instead.

---

# SPEC-###: <Feature Name>

| Field | Value |
| --- | --- |
| **Status** | Draft |
| **Version** | 0.1.0 |
| **Owner** | <name / role> |
| **Phase** | MVP / Phase 2 / Phase 3 |
| **Security review** | required / not required |
| **Depends on** | SPEC-###, SPEC-### |
| **Depended on by** | SPEC-### |
| **Related ADRs** | ADR-####, ADR-#### |
| **Last updated** | YYYY-MM-DD |

---

## 1. Summary

> Three sentences. What this feature does, for whom, and why it exists. If you need four, the feature is probably two features.

## 2. Goals

- …

## 3. Non-Goals

> As important as goals. Every non-goal you omit becomes a scope argument in week six.

- …

## 4. User Stories

| ID | Story | Priority |
| --- | --- | --- |
| US-01 | As a **<persona>**, I want **<capability>** so that **<outcome>**. | P0 |

## 5. Functional Requirements

> Every requirement gets an ID, a keyword, and a single obligation. Every MUST needs a test in §13.

### 5.1 <Group name>

| ID | Req | Statement |
| --- | --- | --- |
| R01 | MUST | … |
| R02 | SHOULD | … |

## 6. Data

> Which tables and columns this feature reads or writes. Link to the data model; never redefine types here.

| Table | Access | Notes |
| --- | --- | --- |
| `public.…` | read / write | … |

**New schema objects introduced by this spec:** *(migration file, tables, enums, indexes — or "none")*

**PII touched:** *(list columns and their classification per [Privacy & Data Retention](../02-security/04-privacy-and-data-retention.md))*

## 7. API

> One subsection per endpoint / RPC / Edge Function. Include the failure responses, not just the success shape.

### `rpc.<name>`

**Auth:** authenticated / verified / admin
**Rate limit:** …

```jsonc
// Request
{ }
// Response 200
{ }
```

| Error code | HTTP | When |
| --- | --- | --- |
| `…` | 4xx | … |

## 8. UI / UX

### 8.1 Screens

| Screen | Route | Purpose |
| --- | --- | --- |

### 8.2 States

> Fill every row. The states below the first are where products actually fail.

| State | Behaviour |
| --- | --- |
| Loading | |
| Empty | |
| Error (recoverable) | |
| Error (terminal) | |
| Offline | |
| Permission denied | |
| Rate limited | |

### 8.3 Copy

> Exact user-facing strings for errors and empty states. Vague copy is a spec gap, not a design detail.

## 9. Security & Privacy

| Question | Answer |
| --- | --- |
| What is the worst thing an attacker could do with this feature? | |
| Which RLS policies enforce access? | |
| Can any response path expose an exact coordinate or PII? | |
| What is logged, and is it scrubbed? | |
| Does this need step-up authentication? | |
| Abuse / rate-limit controls | |

## 10. Edge Cases & Failure Modes

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| EC-01 | | |

## 11. Observability

| Event / metric | Type | Properties | Alert threshold |
| --- | --- | --- | --- |

## 12. Accessibility

> Specific commitments. "Follows WCAG" is not a commitment.

- …

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | unit / integration / rls / e2e | R01 | … |

### 13.2 Negative & security tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |

### 13.3 Manual QA

- [ ] …

## 14. Rollout

| Field | Value |
| --- | --- |
| Feature flag | `…` |
| Migration required | yes / no |
| Backfill required | yes / no |
| Rollback plan | |
| Client version floor | |

## 15. Open Questions

| # | Question | Owner | Needed by |
| --- | --- | --- | --- |

## 16. Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
