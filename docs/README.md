# Sharecropr — Documentation

**Sharecropr** is an iOS and Android app that lets home gardeners inventory surplus crops and barter them with nearby gardeners, meeting only at pre-approved public safe spots.

This directory is the **single source of truth** for what Sharecropr is, how it is built, and how it is verified. Code that contradicts these documents is a bug in one of the two — resolve it, don't ignore it.

---

## How to use this documentation

| If you are… | Start here |
| --- | --- |
| New to the project | [Vision](00-foundation/01-vision.md) → [PRD](00-foundation/02-prd.md) → [System Architecture](01-architecture/01-system-architecture.md) |
| About to build a feature | The relevant [SPEC](03-specs/) → its Test Plan section → [Data Model](01-architecture/03-data-model.md) |
| Writing a new feature spec | [Doc Conventions](00-foundation/06-doc-conventions.md) + [Spec Template](00-foundation/07-spec-template.md) |
| Touching the database | [Data Model](01-architecture/03-data-model.md) → [RLS Design](01-architecture/05-rls-design.md) → [RLS Test Plan](04-testing/02-rls-test-plan.md) |
| Touching anything location-related | [Location Privacy](01-architecture/04-location-privacy.md) — **read this before writing a line of code** |
| Reviewing a PR | [Test Strategy](04-testing/01-test-strategy.md) + [Definition of Done](00-foundation/06-doc-conventions.md#11-definition-of-done) |
| Shipping a release | [Release & Store Submission](05-operations/03-release-and-store-submission.md) |
| Responding to an incident | [Runbooks](05-operations/05-runbooks.md) |

---

## Document index

### 00 — Foundation

| Doc | Purpose |
| --- | --- |
| [01 Vision](00-foundation/01-vision.md) | Why Sharecropr exists, what success looks like, what we refuse to build |
| [02 PRD](00-foundation/02-prd.md) | Scope, capabilities, MVP boundary, success metrics |
| [03 Personas & Journeys](00-foundation/03-personas-and-journeys.md) | Who we build for and their end-to-end flows |
| [04 Glossary](00-foundation/04-glossary.md) | Canonical vocabulary — every term used in specs and code |
| [05 Non-Functional Requirements](00-foundation/05-nfr.md) | Performance, availability, accessibility, compliance budgets |
| [06 Doc Conventions](00-foundation/06-doc-conventions.md) | How specs are written, numbered, reviewed, and retired |
| [07 Spec Template](00-foundation/07-spec-template.md) | Copy this to start any new spec |

### 01 — Architecture

| Doc | Purpose |
| --- | --- |
| [01 System Architecture](01-architecture/01-system-architecture.md) | Context, containers, deployment, technology stack |
| [02 Mobile Architecture](01-architecture/02-mobile-architecture.md) | App layering, state, navigation, offline, secure storage |
| [03 Data Model](01-architecture/03-data-model.md) | Every table, column, index, enum, and its PII classification |
| [04 Location Privacy](01-architecture/04-location-privacy.md) | How exact coordinates are stored and never exposed |
| [05 RLS Design](01-architecture/05-rls-design.md) | Row-level security patterns, helper functions, block enforcement |
| [06 API Contract](01-architecture/06-api-contract.md) | PostgREST surface, RPCs, Edge Functions, error taxonomy |
| [07 Exchange State Machine](01-architecture/07-exchange-state-machine.md) | States, transitions, concurrency controls |
| [08 Realtime & Notifications](01-architecture/08-realtime-and-notifications.md) | Channels, push fanout, delivery guarantees |
| [ADRs](01-architecture/adr/README.md) | 18 recorded decisions with their tradeoffs |

### 02 — Security & Trust

| Doc | Purpose |
| --- | --- |
| [01 Threat Model](02-security/01-threat-model.md) | STRIDE analysis, abuse cases, mitigations, residual risk |
| [02 Authentication & 2FA](02-security/02-auth-and-2fa.md) | Session model, OAuth, TOTP, recovery, step-up auth |
| [03 Identity Verification](02-security/03-identity-verification.md) | KYC vendor integration, garden verification, trust tiers |
| [04 Privacy & Data Retention](02-security/04-privacy-and-data-retention.md) | Data inventory, retention schedule, deletion, DSAR handling |
| [05 Trust & Safety](02-security/05-trust-and-safety.md) | Ratings, reports, blocks, moderation policy and SLAs |

### 03 — Feature Specs

Numbered, versioned, individually testable. See [03-specs/README.md](03-specs/README.md) for the full register.

**MVP:** SPEC-001 … SPEC-013
**Future:** SPEC-020 … SPEC-023

### 04 — Testing

| Doc | Purpose |
| --- | --- |
| [01 Test Strategy](04-testing/01-test-strategy.md) | Pyramid, tooling, coverage gates, ownership |
| [02 RLS Test Plan](04-testing/02-rls-test-plan.md) | How every policy is proven, including negative cases |
| [03 Geospatial Test Plan](04-testing/03-geospatial-test-plan.md) | Fuzzing invariants, cell-boundary recall, projection correctness |
| [04 E2E Scenarios](04-testing/04-e2e-scenarios.md) | Maestro flows covering the critical paths |
| [05 QA & Release Checklist](04-testing/05-qa-release-checklist.md) | Manual gates before each submission |

### 05 — Operations

| Doc | Purpose |
| --- | --- |
| [01 Environments](05-operations/01-environments.md) | Local, preview, staging, production; data seeding |
| [02 CI/CD](05-operations/02-cicd.md) | Pipelines, migration gates, required checks |
| [03 Release & Store Submission](05-operations/03-release-and-store-submission.md) | EAS profiles, OTA policy, Apple/Google review traps |
| [04 Observability](05-operations/04-observability.md) | Logging, metrics, tracing, alerting, telemetry scrubbing |
| [05 Runbooks](05-operations/05-runbooks.md) | Step-by-step incident procedures |

### 06 — Roadmap

| Doc | Purpose |
| --- | --- |
| [01 Roadmap](06-roadmap/01-roadmap.md) | MVP / Phase 2 / Phase 3 with rationale |
| [02 Open Risks](06-roadmap/02-open-risks.md) | Ranked risk register with owners and triggers |

---

## The five rules that govern this codebase

1. **Exact garden coordinates never leave the database.** They live in a `private` schema no client role can read. Clients receive fuzzed points only. See [Location Privacy](01-architecture/04-location-privacy.md).
2. **Every table has RLS enabled, and every policy has a passing negative test.** A policy without a test that proves it *denies* is not done.
3. **Exchanges happen at safe spots.** The product does not support meeting at a home address, and no code path may produce one.
4. **No money, ever.** No payments, no fees, no payouts. Any proposal that introduces currency requires a new ADR and a legal review.
5. **Specs precede code.** A feature that isn't specified isn't built. Amend the spec in the same PR if reality forces a change.

---

## Status

| Item | Value |
| --- | --- |
| Document set version | 1.0.0 |
| Last reviewed | 2026-08-08 |
| Phase | Pre-MVP — architecture locked, implementation not started |
| Repository state | Greenfield |
