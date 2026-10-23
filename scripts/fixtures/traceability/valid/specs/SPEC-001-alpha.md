# SPEC-001: alpha

| Field | Value |
| --- | --- |
| **Status** | Review |
| **Version** | 1.0.0 |
| **Owner** | Fixture |
| **Phase** | MVP |
| **Security review** | not required |
| **Schema depends on** | — |
| **Behaviourally coupled with** | — |
| **Related ADRs** | — |
| **Last updated** | 2026-10-22 |

---

## 1. Summary

Deliberately-valid fixture for scripts/spec-traceability.mjs (SCR-0005). Not a real spec.

## 5. Requirements

| ID | Level | Requirement |
| --- | --- | --- |
| R01 | **MUST** | Echoed in a TypeScript test. |
| R02 | **MUST NOT** | Echoed in a SQL test. |
| R03 | **SHOULD** | A SHOULD is ignored, even though nothing cites it. |
| R04 | MUST | Unbolded level, as SPEC-011 and SPEC-900 write it. |
| R05 | **MUST** | Cited, but its test is not echoed. Baselined untested. |
| R06 | **MUST** | Cited by no Covers cell. Baselined unmapped. |
| R07 | **MUST** | Cited by two tests; only one is echoed. |

## 13. Test Plan

### 13.1 Coverage matrix

| Test ID | Level | Covers | Description |
| --- | --- | --- | --- |
| T01 | unit | R01 | First |
| T02 | sql | R02 | Second |
| T03 | unit | R04 | Third |
| T04 | unit | R05 | Fourth, only echoed in a production file |
| T05 | unit | R07 | Fifth, not echoed |
| T06 | unit | R07 | Sixth, echoed |

### 13.2 Negative tests

| Test ID | Attack / misuse | Expected |
| --- | --- | --- |
| T07 | Probe | Rejected (R06) |
