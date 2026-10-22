#!/usr/bin/env node
// Proves the import seams in eslint.config.js bite (SCRUM-15 / SCR-0011, SCRUM-69).
// Lints each case in eslint-fixtures/cases.mjs as if it lived at its `path`, using the REAL
// config. Exits non-zero if any must-fail case is not rejected by no-restricted-imports with
// the expected message, or any must-pass control is rejected.
//
// projectService is switched off for these virtual files only: typed linting cannot open a
// file that is not on disk, and no-restricted-imports does not need type information.
import { ESLint } from 'eslint';

import { cases } from '../eslint-fixtures/cases.mjs';

const RULE = 'no-restricted-imports';
const eslint = new ESLint({
  overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
});

let failures = 0;
for (const c of cases) {
  const [result] = await eslint.lintText(c.code, { filePath: c.path, warnIgnored: true });
  const fatal = result.messages.filter((m) => m.fatal);
  const hits = result.messages.filter((m) => m.ruleId === RULE && m.severity === 2);
  let problem = null;
  // An ignored path lints as "clean", which would make every pass-control vacuous (and is
  // exactly how MapCanvas.tsx/supabase.ts escaped all lint before SCR-0011).
  if (await eslint.isPathIgnored(c.path)) problem = 'path is ignored by eslint.config.js';
  else if (fatal.length) problem = `parse/ignore problem: ${fatal[0].message}`;
  else if (c.expect === 'fail' && !hits.some((m) => m.message.includes(c.match)))
    problem = `expected ${RULE} containing "${c.match}", got ${JSON.stringify(hits.map((m) => m.message))}`;
  else if (c.expect === 'pass' && hits.length) problem = `expected no ${RULE}, got ${JSON.stringify(hits.map((m) => m.message))}`;

  if (problem) {
    failures += 1;
    console.error(`FAIL ${c.id} (${c.expect}) ${c.path}: ${problem}`);
  } else {
    console.log(`ok   ${c.id}`);
  }
}

console.log(`\n${cases.length - failures}/${cases.length} lint fixtures behaved as expected.`);
process.exit(failures ? 1 : 0);
