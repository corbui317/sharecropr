#!/usr/bin/env python3
"""WP-02b text edits. Run from the worktree root:  python3 -I <this file>
Every old string must occur exactly once or the script aborts before writing anything.
Planner verified against origin/develop b2f9638 (2026-10-21)."""
import collections
import json
import pathlib
import sys

EDITS = {
    'eslint.config.js': [
        (
            """    rules: { 'no-restricted-imports': restrict({ patterns: [SUPABASE_SDK] }) },
  },
);""",
            """    rules: { 'no-restricted-imports': restrict({ patterns: [SUPABASE_SDK] }) },
  },
  // 6. Jest + RNTL tests (SCRUM-64): RNTL 14's render, fireEvent and userEvent return promises.
  //    An un-awaited one overlaps act() scopes and the next query reads a stale tree.
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'app/**/__tests__/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
);""",
        ),
    ],
    '.github/workflows/app.yml': [
        (
            """      - name: Unit — auth domain
        run: npm run test:auth-domain
""",
            """      - name: Unit + component — Jest (src/domain, src/features, app)
        run: npm test -- --ci
""",
        ),
        (
            """
      - name: Unit — map
        run: npm run test:map
""",
            "",
        ),
    ],
    'src/features/map/lib/fpsSummary.ts': [
        (
            """ * Pure: no React / React Native imports, erasable TypeScript only — scripts/map-tests loads it
 * with node --experimental-strip-types.""",
            """ * Pure: no React / React Native imports. Unit-tested under Jest in lib/__tests__/profiler.test.ts.""",
        ),
    ],
    'docs/04-testing/01-test-strategy.md': [
        (
            "**Status:** Approved · **Version:** 1.0.0 · **Owner:** Engineering",
            "**Status:** Approved · **Version:** 1.1.0 · **Owner:** Engineering",
        ),
        (
            "| Unit | Vitest | Every PR | < 30 s |",
            "| Unit + component | Jest (`jest-expo`) + React Native Testing Library | Every PR | < 30 s |",
        ),
        (
            "| Integration | Vitest + Supabase CLI | Every PR | < 6 min |",
            "| Integration | Jest + Supabase CLI | Every PR | < 6 min |",
        ),
        (
            "| Accessibility | Automated axe-equivalent + manual | Every PR + per release | — |\n",
            "| Accessibility | Automated axe-equivalent + manual | Every PR + per release | — |\n\n"
            "**One JavaScript test runner: Jest.** Unit and component tests use Jest with the `jest-expo` preset and "
            "React Native Testing Library (SCRUM-64). `npm test` runs them, and `app.yml` runs `npm test` on every push "
            "and PR. `jest.config.js` has two projects: `domain` runs `src/domain` in the plain Node environment with no "
            "React Native preset, so a domain test that needs a mock is a design smell (§3); `app` runs everything else "
            "under `jest-expo`. Tests live in `__tests__/` beside the code and every test name carries its namespaced ID "
            "(`SPEC-001-T05`). RNTL's `render` and `fireEvent` are async — always `await` them; lint enforces it in "
            "`__tests__/`.\n\n"
            "Not Jest, deliberately: E2E is Maestro ([ADR-0015](../01-architecture/adr/ADR-0015-e2e-tooling.md)), the "
            "database is pgTAP ([ADR-0016](../01-architecture/adr/ADR-0016-pgtap.md)), Edge Functions use Deno's runner "
            "([ADR-0008](../01-architecture/adr/ADR-0008-edge-functions.md)), and the repo's own Node tooling under "
            "`scripts/` (doc gates, dependency audit) uses `node:test` because it is not app code and runs before "
            "`npm ci`.\n",
        ),
        (
            "`src/domain` has an eslint rule forbidding React Native imports, which is what makes it testable in plain Node with no simulator.",
            "`src/domain` has an eslint rule forbidding React Native imports, which is what makes it testable in plain Node with no simulator — the Jest `domain` project runs it with no React Native preset, so an RN import there fails the test run as well as lint.",
        ),
        (
            "| LP-08 | Scrubber strips coordinates from a synthetic Sentry event | Vitest |",
            "| LP-08 | Scrubber strips coordinates from a synthetic Sentry event | Jest |",
        ),
        (
            "| 2026-08-08 | 1.0.0 | Engineering | Initial test strategy |",
            "| 2026-08-08 | 1.0.0 | Engineering | Initial test strategy |\n"
            "| 2026-10-21 | 1.1.0 | Engineering | Unit/integration runner is Jest (`jest-expo`) + React Native Testing "
            "Library, matching mobile architecture §1/§4.1, ADR-0015 and Location Privacy LP-08 (SCRUM-64). §2 names "
            "the one runner and what deliberately is not Jest; §7 LP-08 runner corrected |",
        ),
    ],
    'docs/05-operations/02-cicd.md': [
        (
            "**Status:** Approved · **Version:** 1.0.1 · **Owner:** Platform Engineering",
            "**Status:** Approved · **Version:** 1.0.2 · **Owner:** Platform Engineering",
        ),
        (
            "| `unit` | Any failure | **Partial** — `app.yml` runs `test:auth-domain` only |",
            "| `unit` | Any failure | **Running** — `app.yml` `npm test` (Jest + RNTL over `src/` and `app/`; "
            "[Test Strategy §2](../04-testing/01-test-strategy.md#2-the-pyramid-weighted-for-this-system)) |",
        ),
        (
            "Scripts named in §4–§5 that do not exist in `package.json` are planned |",
            "Scripts named in §4–§5 that do not exist in `package.json` are planned |\n"
            "| 2026-10-21 | 1.0.2 | Engineering | §2 `unit` is Running: `app.yml` runs `npm test` (Jest + React Native "
            "Testing Library over `src/` and `app/`), replacing the auth-domain and map `node:test` scripts "
            "(SCRUM-64, SCR-0002) |",
        ),
    ],
    'README.md': [
        (
            "React Native 0.86 / Metro require ≥ 22.13 on the 22 line, and `npm run test:auth-domain` uses `node --experimental-strip-types`.",
            "and React Native 0.86 / Metro require ≥ 22.13 on the 22 line.",
        ),
        (
            "npm run lint && npm run typecheck && npm run test:auth-domain",
            "npm run lint && npm run typecheck && npm test   # Jest + React Native Testing Library",
        ),
    ],
    'AGENTS.md': [
        (
            "typecheck, auth-domain and dependency-audit unit tests)",
            "typecheck, Jest unit + component tests via `npm test`, dependency-audit script tests)",
        ),
        (
            "| Unit (auth domain) | `npm run test:auth-domain` |",
            "| Unit + component (Jest + RNTL; `src/domain` runs RN-free) | `npm test` |",
        ),
        (
            "- `[2026-10-21] [claude] ESLint flat config REPLACES",
            "- `[2026-10-21] [claude] SCRUM-64: the one unit/component runner is Jest (jest-expo 57.0.4) + React Native "
            "Testing Library 14, not Vitest. jest.config.js has a domain project (src/domain, plain Node, no RN preset) "
            "and an app project (everything else, jest-expo). RNTL 14 render/fireEvent are async: always await them "
            "(lint enforces it in __tests__). Only scripts/ repo tooling stays on node:test — "
            "[Test Strategy §2](docs/04-testing/01-test-strategy.md).`\n"
            "- `[2026-10-21] [claude] ESLint flat config REPLACES",
        ),
    ],
}


def main() -> int:
    root = pathlib.Path.cwd()
    staged = {}
    for rel, pairs in EDITS.items():
        text = (root / rel).read_text()
        for old, new in pairs:
            n = text.count(old)
            if n != 1:
                print(f'ABORT {rel}: expected 1 match, found {n}:\n{old[:120]!r}', file=sys.stderr)
                return 1
            text = text.replace(old, new)
        staged[rel] = text

    pkg_path = root / 'package.json'
    pkg = json.loads(pkg_path.read_text(), object_pairs_hook=collections.OrderedDict)
    scripts = collections.OrderedDict()
    if 'test:auth-domain' not in pkg['scripts'] or 'test' in pkg['scripts']:
        print('ABORT package.json: expected test:auth-domain present and no test script', file=sys.stderr)
        return 1
    for key, value in pkg['scripts'].items():
        if key == 'test:auth-domain':
            scripts['test'] = 'jest'
        elif key == 'test:map':
            continue
        else:
            scripts[key] = value
    pkg['scripts'] = scripts
    staged['package.json'] = json.dumps(pkg, indent=2, ensure_ascii=False) + '\n'

    for rel, text in staged.items():
        (root / rel).write_text(text)
        print(f'edited {rel}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
