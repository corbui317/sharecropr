import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compareBaselines, isTestSource, runTraceability } from './spec-traceability.mjs';

const FIX = 'scripts/fixtures/traceability';
const cli = (...args) =>
  spawnSync(process.execPath, ['scripts/spec-traceability.mjs', ...args], { encoding: 'utf8' });

/** Copies a fixture to a tmpdir and returns it; mutations never touch the checked-in fixtures. */
function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-trace-'));
  fs.cpSync(`${FIX}/${name}`, dir, { recursive: true });
  return dir;
}
const run = (dir) =>
  runTraceability({
    specsDir: path.join(dir, 'specs'),
    testBase: path.join(dir, 'tests'),
    baselineFile: path.join(dir, 'baseline.json'),
  }).findings;
const summary = (findings) =>
  findings.map((f) => `${path.basename(f.file)}:${f.line} ${f.rule}`);
const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
const SPEC = (dir) => path.join(dir, 'specs/SPEC-001-alpha.md');
const ALPHA_TEST = (dir) => path.join(dir, 'tests/src/alpha/__tests__/alpha.test.ts');
const BASELINE = (dir) => path.join(dir, 'baseline.json');

test('T-1 valid fixture passes (SCR-0005)', () => {
  const r = cli('--root', `${FIX}/valid`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /spec-traceability: OK — 6 MUSTs in 1 specs; 4 traced, 2 baselined \(1 unmapped, 1 untested\); no new gaps/,
  );
});

test('T-2 new-gap fixture fails with one must-unmapped at the R08 line (SCR-0005)', () => {
  const r = cli('--root', `${FIX}/new-gap`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SPEC-001-alpha\.md:32: \[must-unmapped\]/);
  assert.equal(run(`${FIX}/new-gap`).length, 1);
});

test('T-3 stale-baseline fixture fails with one baseline-stale (SCR-0005)', () => {
  const r = cli('--root', `${FIX}/stale-baseline`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /baseline\.json:3: \[baseline-stale\]/);
  assert.deepEqual(summary(run(`${FIX}/stale-baseline`)), ['baseline.json:3 baseline-stale']);
});

test('T-4 deleting an echo makes the MUST untested, naming the T-ID (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(ALPHA_TEST(d), (t) => t.replace('// SPEC-001-T01\n', ''));
  const f = run(d);
  assert.deepEqual(summary(f), ['SPEC-001-alpha.md:25 must-untested']);
  assert.match(f[0].message, /T01/);
});

test('T-5 an echo in a production file does not count (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(ALPHA_TEST(d), (t) => t.replace('// SPEC-001-T01\n', ''));
  fs.appendFileSync(path.join(d, 'tests/src/alpha/impl.ts'), '// SPEC-001-T01\n');
  assert.deepEqual(summary(run(d)), ['SPEC-001-alpha.md:25 must-untested']);
});

test('T-6 a bare T-ID echo does not count (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(ALPHA_TEST(d), (t) => t.replace('// SPEC-001-T01', '// T01'));
  assert.deepEqual(summary(run(d)), ['SPEC-001-alpha.md:25 must-untested']);
});

test('T-7 SPEC-001-T010 does not satisfy T01 and is an unknown echo (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(ALPHA_TEST(d), (t) => t.replace('// SPEC-001-T01\n', '// SPEC-001-T010\n'));
  assert.deepEqual(summary(run(d)), [
    'SPEC-001-alpha.md:25 must-untested',
    'alpha.test.ts:1 echo-unknown',
  ]);
});

test('T-8 an echo of a spec that does not exist is unknown (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(ALPHA_TEST(d), (t) => t.replace('// SPEC-001-T01\n', '// SPEC-002-T01\n'));
  assert.deepEqual(summary(run(d)), [
    'SPEC-001-alpha.md:25 must-untested',
    'alpha.test.ts:1 echo-unknown',
  ]);
});

test('T-9 deleting the T04 row worsens R05 from untested to unmapped (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(SPEC(d), (t) => t.replace(/^\| T04 .*\n/m, ''));
  const f = run(d);
  assert.deepEqual(summary(f), ['SPEC-001-alpha.md:29 must-unmapped']);
  assert.match(f[0].message, /worse kind is a new gap/);
});

test('T-10 a new Draft spec with an untested MUST fails: no status exemption (SCR-0005)', () => {
  const d = copyFixture('valid');
  fs.writeFileSync(
    path.join(d, 'specs/SPEC-002-beta.md'),
    '# SPEC-002: beta\n\n| **Status** | Draft |\n\n---\n\n## 5. Requirements\n\n| ID | Level | Requirement |\n| --- | --- | --- |\n| R01 | **MUST** | x |\n',
  );
  assert.deepEqual(summary(run(d)), ['SPEC-002-beta.md:11 must-unmapped']);
});

test('T-11 renaming the §13 heading fails closed (SCR-0005)', () => {
  const d = copyFixture('valid');
  edit(SPEC(d), (t) => t.replace('## 13. Test Plan', '## Test Plan'));
  // §13 no longer parses, so every MUST is unmapped; baselined R06 stays quiet, R05 is a worse kind.
  assert.deepEqual(summary(run(d)), [
    'SPEC-001-alpha.md:25 must-unmapped',
    'SPEC-001-alpha.md:26 must-unmapped',
    'SPEC-001-alpha.md:28 must-unmapped',
    'SPEC-001-alpha.md:29 must-unmapped',
    'SPEC-001-alpha.md:31 must-unmapped',
    'alpha.test.ts:1 echo-unknown',
    'alpha.test.ts:2 echo-unknown',
    'alpha.test.ts:3 echo-unknown',
    'alpha.test.sql:1 echo-unknown',
  ]);
});

test('T-12 baseline stale, unsorted and duplicate entries are reported (SCR-0005)', () => {
  let d = copyFixture('valid');
  edit(BASELINE(d), (t) => t.replace('"SPEC-001-R05 untested",', '"SPEC-001-R05 untested",\n    "SPEC-001-R05b untested",'));
  assert.deepEqual(summary(run(d)), ['baseline.json:4 baseline-stale']);

  d = copyFixture('valid');
  fs.writeFileSync(
    BASELINE(d),
    '{\n  "gaps": [\n    "SPEC-001-R06 unmapped",\n    "SPEC-001-R05 untested"\n  ]\n}\n',
  );
  assert.deepEqual(summary(run(d)), ['baseline.json:4 baseline-format']);

  d = copyFixture('valid');
  edit(BASELINE(d), (t) => t.replace('"SPEC-001-R05 untested",', '"SPEC-001-R05 untested",\n    "SPEC-001-R05 untested",'));
  assert.deepEqual(summary(run(d)), ['baseline.json:4 baseline-format']);

  d = copyFixture('valid');
  fs.writeFileSync(BASELINE(d), '{ not json');
  assert.ok(summary(run(d)).includes('baseline.json:1 baseline-format'));
});

test('T-13 compareBaselines (pure) (SCR-0005)', () => {
  const base = ['SPEC-001-R05 untested', 'SPEC-001-R06 unmapped'];
  assert.equal(compareBaselines(base, [...base, 'SPEC-001-R08 untested']).length, 1);
  assert.equal(compareBaselines(base, ['SPEC-001-R05 unmapped', 'SPEC-001-R06 unmapped']).length, 1);
  assert.equal(compareBaselines(base, ['SPEC-001-R05 untested', 'SPEC-001-R06 untested']).length, 0);
  assert.equal(compareBaselines(base, ['SPEC-001-R06 unmapped']).length, 0);
});

test('T-14 --base-ref: growth fails, no baseline at base skips, bad ref is usage (SCR-0005)', () => {
  const sh = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  // Baseline committed, then grown together with a matching new gap.
  let d = copyFixture('valid');
  sh(d, 'init', '-q');
  sh(d, 'add', '-A');
  sh(d, 'commit', '-q', '-m', 'base');
  edit(SPEC(d), (t) => t.replace('only one is echoed. |\n', 'only one is echoed. |\n| R08 | **MUST** | New. |\n'));
  edit(BASELINE(d), (t) => t.replace('"SPEC-001-R06 unmapped"', '"SPEC-001-R06 unmapped",\n    "SPEC-001-R08 unmapped"'));
  let r = cli('--root', d, '--base-ref', 'HEAD');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /baseline\.json:5: \[baseline-grew\]/);
  assert.doesNotMatch(r.stderr, /must-unmapped/);

  // No baseline at the base commit.
  d = copyFixture('valid');
  fs.rmSync(BASELINE(d));
  sh(d, 'init', '-q');
  sh(d, 'add', '-A');
  sh(d, 'commit', '-q', '-m', 'base');
  fs.copyFileSync(`${FIX}/valid/baseline.json`, BASELINE(d));
  r = cli('--root', d, '--base-ref', 'HEAD');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /growth check skipped \(no baseline at base\)/);

  // Unresolvable ref.
  r = cli('--root', d, '--base-ref', 'no-such-ref');
  assert.equal(r.status, 2);
});

test('T-15 isTestSource (SCR-0005)', () => {
  for (const p of [
    'src/x/__tests__/a.ts',
    'src/a.test.tsx',
    'supabase/tests/b.test.sql',
    'supabase/tests/rls/c.sql',
    '.maestro/f.yaml',
    'e2e/flows/login.ts',
  ])
    assert.equal(isTestSource(p), true, p);
  for (const p of [
    'src/api/query-cache.ts',
    'docs/07-review/04-backlog-execution/plans/WP-02b-files/src/domain/auth/__tests__/hibp.test.ts',
    'scripts/fixtures/traceability/valid/tests/src/x/__tests__/a.ts',
    'supabase/migrations/x.sql',
    'src/node_modules/pkg/__tests__/a.ts',
    'node_modules/pkg/a.test.js',
  ])
    assert.equal(isTestSource(p), false, p);
});

test('T-16 --update-baseline drops the closed entry and a rerun is green (SCR-0005)', () => {
  const d = copyFixture('stale-baseline');
  let r = cli('--root', d, '--update-baseline');
  assert.equal(r.status, 0, r.stderr);
  const gaps = JSON.parse(fs.readFileSync(BASELINE(d), 'utf8')).gaps;
  assert.deepEqual(gaps, ['SPEC-001-R06 unmapped']);
  r = cli('--root', d);
  assert.equal(r.status, 0, r.stderr);
});

test('T-17 usage errors exit 2 (SCR-0005)', () => {
  assert.equal(cli('--bogus').status, 2);
  assert.equal(cli('--root', `${FIX}/does-not-exist`).status, 2);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-trace-empty-'));
  assert.equal(cli('--root', empty).status, 2);
});

test('T-18 the real repo has no findings (SCR-0005)', () => {
  const root = process.cwd();
  const { findings } = runTraceability({
    specsDir: path.join(root, 'docs/03-specs'),
    testBase: root,
    baselineFile: path.join(root, 'scripts/spec-traceability.baseline.json'),
  });
  assert.deepEqual(findings, []);
});
