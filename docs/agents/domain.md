# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo. Domain docs live under `docs/`, not at the repo root.

## Before exploring, read these

- **[`docs/00-foundation/04-glossary.md`](../00-foundation/04-glossary.md)**: the project glossary.
- **[`docs/01-architecture/adr/`](../01-architecture/adr/)**: read ADRs (`ADR-NNNN-slug.md`) that touch the area you're about to work in.
- **The "Read these before you write code" table in [`AGENTS.md` §2](../../AGENTS.md)**: which architecture doc or spec to read before touching a given area (location, database, exchange flow, …).

## File structure

```
/
├── AGENTS.md                          ← CLAUDE.md is a symlink to this
└── docs/
    ├── 00-foundation/04-glossary.md
    ├── 01-architecture/adr/
    │   ├── ADR-0001-mobile-stack.md
    │   └── ADR-0002-barter-only.md
    └── 03-specs/                      ← SPEC-NNN feature specs
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the glossary. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (database-centric authz), but worth reopening because…_

Changing a recorded decision requires a new ADR. ADRs are never deleted; a superseded one keeps its number and gets a banner.
