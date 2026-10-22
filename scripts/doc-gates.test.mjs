import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findCycles, parseRelationCell, runGates } from './doc-gates.mjs';

const FIX = 'scripts/fixtures/doc-gates';
const cli = (...args) =>
  spawnSync(process.execPath, ['scripts/doc-gates.mjs', ...args], { encoding: 'utf8' });

test('T-1 cycle fixture fails, naming spec, line and rule (SCR-0003)', () => {
  const r = cli('--root', `${FIX}/cycle`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SPEC-002-beta\.md:10: \[schema-acyclic\]/);
  assert.match(r.stderr, /SPEC-003-gamma\.md:10: \[schema-acyclic\]/);
  assert.match(r.stderr, /SPEC-002 -> SPEC-003 -> SPEC-002/);
  const { findings } = runGates(`${FIX}/cycle`);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.rule === 'schema-acyclic'));
});

test('T-2 valid fixture passes (SCR-0003)', () => {
  const r = cli('--root', `${FIX}/valid`);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /doc-gates: OK — 3 specs, 3 schema edges/);
});

test('T-3 register-mismatch fixture fails on register-sync only (SCR-0003)', () => {
  const r = cli('--root', `${FIX}/register-mismatch`);
  assert.equal(r.status, 1);
  const { findings } = runGates(`${FIX}/register-mismatch`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'register-sync');
  assert.ok(findings[0].file.endsWith('README.md'));
  assert.equal(findings[0].line, 9);
});

test('T-4 parseRelationCell dedupes linked references (SCR-0003)', () => {
  assert.deepEqual(
    parseRelationCell(
      '[SPEC-001](SPEC-001-authentication.md), [SPEC-003](SPEC-003-identity-verification.md)',
    ),
    { ids: ['001', '003'], ok: true },
  );
  assert.deepEqual(parseRelationCell('—'), { ids: [], ok: true });
  assert.deepEqual(parseRelationCell('— (root capability)'), { ids: [], ok: true });
  assert.equal(parseRelationCell('SPEC-### — needs tables').ok, false);
  assert.deepEqual(parseRelationCell('SPEC-002 (R32, R36, R44 cite R18), SPEC-013').ids, [
    '002',
    '013',
  ]);
});

test('T-5 findCycles (SCR-0003)', () => {
  assert.deepEqual(findCycles(new Map([['001', ['001']]])), [['001', '001']]);
  const g = new Map([
    ['001', ['002']],
    ['002', ['003']],
    ['003', ['001']],
  ]);
  const c = findCycles(g);
  assert.equal(c.length, 1);
  assert.equal(c[0][0], '001');
  assert.deepEqual(
    findCycles(
      new Map([
        ['001', []],
        ['002', ['001']],
      ]),
    ),
    [],
  );
});

test('T-6 unknown reference and missing register row (SCR-0003)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-gates-'));
  try {
    for (const f of fs.readdirSync(`${FIX}/valid`)) {
      fs.copyFileSync(`${FIX}/valid/${f}`, path.join(dir, f));
    }
    const p3 = path.join(dir, 'SPEC-003-gamma.md');
    fs.writeFileSync(
      p3,
      fs
        .readFileSync(p3, 'utf8')
        .replace(/^(\| \*\*Schema depends on\*\* \| ).*$/m, '$1[SPEC-099](x.md) |'),
    );
    assert.ok(runGates(dir).findings.some((f) => f.rule === 'schema-unknown-spec'));

    const reg = path.join(dir, 'README.md');
    fs.writeFileSync(
      reg,
      fs
        .readFileSync(reg, 'utf8')
        .split('\n')
        .filter((l) => !l.startsWith('| 002 '))
        .join('\n'),
    );
    assert.ok(
      runGates(dir).findings.some(
        (f) => f.rule === 'register-sync' && /has no register row/.test(f.message),
      ),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T-7 usage errors exit 2 (SCR-0003)', () => {
  assert.equal(cli('--root', 'does/not/exist').status, 2);
  assert.equal(cli('--bogus').status, 2);
});

test('T-8 the real docs pass (SCR-0003)', () => {
  assert.deepEqual(runGates('docs/03-specs').findings, []);
});
