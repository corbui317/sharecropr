# Sharecropr backlog execution — shared brief for every agent

Repo: corbui317/sharecropr, branch `develop`. Main clone: /home/claude/sharecropr (do NOT edit it directly unless you are the integrator).
Queue (Opus plan for every package): /tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/work/queue.json
Review evidence: /tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/review/ (spec-*.md, standards.md, jira-plan.json has full ticket text + acceptance criteria per SCRUM key via jira-created.json)
Per-package detailed plans: .../scratchpad/work/plans/WP-XX.md
Local Postgres stand-in for migrations + pgTAP: .../scratchpad/harness/ (see BASELINE.md there when it exists). Approximate (PG16 + stubs); real Supabase verification is the GitHub db.yml run.

## Skills (read the SKILL.md files named in your package's `skills` list before starting)
- addyosmani/agent-skills: /tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/addy-skills/skills/<name>/SKILL.md
- mattpocock engineering: /tmp/claude-0/-home-claude/b1579b85-1f89-58a9-ad31-38785addf5c2/scratchpad/mp-skills/skills/engineering/<name>/SKILL.md

## Non-negotiables (from AGENTS.md — read it)
- §3 invariants: no exact garden coordinates anywhere; RLS enabled AND forced with negatives > positives; refresh tokens only in secure storage; src/domain and src/api must not import React Native; authz in the database.
- AGENTS.md §6 open decisions must NOT be silently resolved. SCRUM-18/31/32/62/64 were decided by Corey on 2026-10-21 (see README.md) — implement those decisions exactly. Questions in README "Open questions for Corey" are still open.
- Tests reference namespaced IDs (`// SPEC-001-T34`). SCRUM-64 decided: Jest + RNTL for app/unit tests once WP-02b lands (before that, node:test); repo tooling scripts stay on node:test.
- npm, not pnpm. Node 22. Never commit secrets, the harness, or node_modules.
- Don't widen scope beyond the package. If you find something else broken, note it in your report.

## Roles
- Opus planner: read-only; produce a precise step plan (files, functions, tests, verification commands, commit message, Jira AC mapping, what remains open).
- Sonnet executor: works in its OWN git worktree, implements the plan, runs every verification command, does NOT commit; leaves changes in the worktree and reports the worktree path + results.
- Haiku integrator: commits in the worktree, rebases onto origin/develop, pushes to develop, updates Jira.
