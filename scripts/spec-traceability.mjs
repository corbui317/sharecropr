#!/usr/bin/env node
// Spec traceability gate — CI/CD §5, SCR-0005.
// Every MUST / MUST NOT row in docs/03-specs must be cited by a §13 `Covers` cell,
// and at least one citing SPEC-NNN-Tnn must be echoed in a test source. Existing gaps
// live in a shrink-only baseline: new gaps fail, closed-but-listed gaps fail, and with
// --base-ref any entry that is not in the base commit's baseline fails.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { loadSpecs } from './doc-gates.mjs';

const BASELINE_DEFAULT = 'scripts/spec-traceability.baseline.json';
const BASELINE_COMMENT =
  "Known MUST→§13→test gaps (SCR-0005). May only shrink: CI fails on a gap not listed here, on a listed gap that is closed (remove it), and on any entry not present in the base commit's baseline. Regenerate with: npm run ci:spec-traceability -- --update-baseline";
export const TEST_ROOTS = ['src', 'app', 'supabase/tests', 'packages', 'e2e', '.maestro'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const SCAN_EXT = /\.(?:[cm]?[jt]sx?|sql|ya?ml)$/;
const MUST_ROW = /^\|\s*(R\d+[a-z]?)\s*\|\s*(\*\*)?(MUST(?: NOT)?)(\*\*)?\s*\|/;
const ECHO = /\bSPEC-(\d{3})-(T\d+[a-z]?)\b/g;
const ENTRY = /^SPEC-(\d{3})-(R\d+[a-z]?) (unmapped|untested)$/;

const rel = (p) => path.relative(process.cwd(), p) || p;
const splitRow = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((s) => s.trim());

/** Parses one spec: MUST rows (outside §13), §13 test IDs, and Covers citations. */
export function parseSpec(spec) {
  const musts = [];
  const tests = new Map();
  const covers = new Map();
  let inS13 = false;
  let header = null;
  spec.lines.forEach((text, i) => {
    const line = i + 1;
    if (/^## /.test(text)) {
      inS13 = /^## 13\b/.test(text);
      header = null;
      return;
    }
    if (!inS13) {
      const m = MUST_ROW.exec(text);
      if (m) musts.push({ r: m[1], level: m[3], line });
      return;
    }
    if (!text.startsWith('|')) {
      header = null;
      return;
    }
    const cells = splitRow(text);
    const idIdx = cells.indexOf('Test ID');
    if (idIdx !== -1) {
      header = { idIdx, coverIdx: cells.indexOf('Covers') };
      return;
    }
    if (!header || /^[-: ]+$/.test(cells.join(''))) return;
    const tid = (cells[header.idIdx] ?? '').replace(/\*/g, '');
    if (!/^T\d+[a-z]?$/.test(tid)) return;
    tests.set(tid, line);
    if (header.coverIdx === -1) return;
    for (const m of (cells[header.coverIdx] ?? '').matchAll(/\bR\d+[a-z]?\b/g)) {
      const list = covers.get(m[0]) ?? [];
      if (!list.includes(tid)) list.push(tid);
      covers.set(m[0], list);
    }
  });
  return { musts, tests, covers };
}

/** True for a repo-relative path that is a test source (docs/, scripts/, production code never are). */
export function isTestSource(relPath) {
  const p = relPath.split(path.sep).join('/');
  const segs = p.split('/');
  if (segs.some((s) => SKIP_DIRS.has(s))) return false;
  if (!TEST_ROOTS.some((r) => p.startsWith(`${r}/`))) return false;
  return (
    /\/__tests__\//.test(p) ||
    /\.test\.[cm]?[jt]sx?$/.test(p) ||
    /^supabase\/tests\/.*\.sql$/.test(p) ||
    /^(e2e|\.maestro)\/.*\.(ya?ml|[jt]s)$/.test(p)
  );
}

/** Echoes of SPEC-NNN-Tnn in test sources under `base`. Map<'NNN-Tnn', [{file, line}]>. */
export function scanEchoes(base) {
  const echoes = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && SCAN_EXT.test(ent.name) && isTestSource(path.relative(base, abs))) {
        fs.readFileSync(abs, 'utf8')
          .split(/\r?\n/)
          .forEach((text, i) => {
            for (const m of text.matchAll(ECHO)) {
              const key = `${m[1]}-${m[2]}`;
              const list = echoes.get(key) ?? [];
              list.push({ file: rel(abs), line: i + 1 });
              echoes.set(key, list);
            }
          });
      }
    }
  };
  for (const r of TEST_ROOTS) walk(path.join(base, r));
  return echoes;
}

/** Current gaps: Map<'SPEC-001-R05', {kind, spec, must, tids}> */
export function computeGaps(specs, parsed, echoes) {
  const gaps = new Map();
  let total = 0;
  for (const spec of specs.values()) {
    const p = parsed.get(spec.id);
    for (const must of p.musts) {
      total++;
      const tids = p.covers.get(must.r) ?? [];
      const key = `SPEC-${spec.id}-${must.r}`;
      if (tids.length === 0) gaps.set(key, { kind: 'unmapped', spec, must, tids });
      else if (!tids.some((t) => echoes.has(`${spec.id}-${t}`)))
        gaps.set(key, { kind: 'untested', spec, must, tids });
    }
  }
  return { gaps, total };
}

/** Loads and validates a baseline file. Returns { entries: [{key, kind, line, raw}], findings }. */
export function loadBaseline(file) {
  const f = rel(path.resolve(file));
  const findings = [];
  const fmt = (line, message) => findings.push({ rule: 'baseline-format', file: f, line, message });
  if (!fs.existsSync(file)) {
    fmt(1, 'baseline file not found');
    return { file: f, entries: [], findings };
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    fmt(1, `malformed JSON: ${e.message}`);
    return { file: f, entries: [], findings };
  }
  if (!json || !Array.isArray(json.gaps)) {
    fmt(1, 'baseline must be an object with a "gaps" array');
    return { file: f, entries: [], findings };
  }
  const entries = [];
  const seen = new Set();
  let prev = null;
  let cursor = 0;
  for (const raw of json.gaps) {
    const idx = lines.findIndex((l, i) => i >= cursor && l.includes(JSON.stringify(raw)));
    const line = idx === -1 ? 1 : idx + 1;
    if (idx !== -1) cursor = idx + 1;
    const m = typeof raw === 'string' ? ENTRY.exec(raw) : null;
    if (!m) {
      fmt(line, `bad entry ${JSON.stringify(raw)} (expected "SPEC-001-R01 unmapped|untested")`);
      continue;
    }
    if (seen.has(raw)) fmt(line, `duplicate entry "${raw}"`);
    else if (prev !== null && raw < prev) fmt(line, `entry "${raw}" is out of order (entries must be sorted)`);
    seen.add(raw);
    prev = raw;
    entries.push({ key: `SPEC-${m[1]}-${m[2]}`, kind: m[3], line, raw });
  }
  return { file: f, entries, findings };
}

/** Pure growth check. base/current: arrays of entry strings or {key, kind, line?}. */
export function compareBaselines(base, current) {
  const norm = (e) => {
    if (typeof e !== 'string') return e;
    const m = ENTRY.exec(e);
    return { key: `SPEC-${m[1]}-${m[2]}`, kind: m[3] };
  };
  const b = new Map(base.map(norm).map((e) => [e.key, e.kind]));
  const grew = [];
  for (const e of current.map(norm)) {
    const was = b.get(e.key);
    if (was === undefined) grew.push({ ...e, reason: 'not in the base commit baseline' });
    else if (was === 'untested' && e.kind === 'unmapped')
      grew.push({ ...e, reason: 'worsened from untested to unmapped versus the base commit' });
  }
  return grew;
}

export function runTraceability({ specsDir, testBase, baselineFile, baseEntries = null }) {
  const specs = loadSpecs(specsDir);
  const parsed = new Map([...specs].map(([id, s]) => [id, parseSpec(s)]));
  const echoes = scanEchoes(testBase);
  const { gaps, total } = computeGaps(specs, parsed, echoes);
  const baseline = loadBaseline(baselineFile);
  const findings = [...baseline.findings];

  const listed = new Map(baseline.entries.map((e) => [e.key, e]));
  const msgFor = (g) =>
    g.kind === 'unmapped'
      ? `${g.must.level} ${g.must.r} is cited by no Covers cell in §13`
      : `${g.must.level} ${g.must.r} is covered by ${g.tids.join(', ')} but no SPEC-${g.spec.id}-Tnn echo of it exists in a test source`;
  for (const [key, g] of gaps) {
    const e = listed.get(key);
    if (e && e.kind === g.kind) continue;
    findings.push({
      rule: g.kind === 'unmapped' ? 'must-unmapped' : 'must-untested',
      file: g.spec.file,
      line: g.must.line,
      message: `${key}: ${msgFor(g)}${e ? ` (baseline lists it as ${e.kind}; a worse kind is a new gap)` : ''}`,
    });
  }
  for (const e of baseline.entries) {
    const g = gaps.get(e.key);
    if (g && g.kind === e.kind) continue;
    if (g && e.kind === 'untested') continue; // worsened: reported above as a new gap
    let why;
    if (g) why = `now only ${g.kind}`;
    else {
      const id = /^SPEC-(\d{3})-(R\d+[a-z]?)$/.exec(e.key);
      const isMust = parsed.get(id[1])?.musts.some((m) => m.r === id[2]);
      why = isMust ? 'is no longer a gap' : 'is not a MUST in the spec (renumbered, removed or downgraded)';
    }
    findings.push({
      rule: 'baseline-stale',
      file: baseline.file,
      line: e.line,
      message: `"${e.raw}" ${why} — remove it (npm run ci:spec-traceability -- --update-baseline)`,
    });
  }

  for (const [key, list] of echoes) {
    const [sid, tid] = key.split('-');
    if (parsed.get(sid)?.tests.has(tid)) continue;
    const why = parsed.has(sid) ? `has no ${tid} row in §13` : 'does not exist';
    for (const { file, line } of list)
      findings.push({
        rule: 'echo-unknown',
        file,
        line,
        message: `echoes SPEC-${sid}-${tid}, but SPEC-${sid} ${why}`,
      });
  }

  if (baseEntries) {
    for (const g of compareBaselines(
      baseEntries,
      baseline.entries.map((e) => ({ key: e.key, kind: e.kind, line: e.line, raw: e.raw })),
    )) {
      findings.push({
        rule: 'baseline-grew',
        file: baseline.file,
        line: g.line,
        message: `"${g.raw}" ${g.reason} (the baseline may only shrink)`,
      });
    }
  }

  findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  const count = (kind) => baseline.entries.filter((e) => gaps.get(e.key)?.kind === kind).length;
  const unmapped = count('unmapped');
  const untested = count('untested');
  const stats = {
    specs: specs.size,
    musts: total,
    traced: total - gaps.size,
    baselined: unmapped + untested,
    unmapped,
    untested,
  };
  return { findings, stats, gaps };
}

export function writeBaseline(file, gaps) {
  const entries = [...gaps].map(([k, g]) => `${k} ${g.kind}`).sort();
  const body = [
    '{',
    `  "comment": ${JSON.stringify(BASELINE_COMMENT)},`,
    '  "gaps": [',
    entries.map((e) => `    ${JSON.stringify(e)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(file, body);
  return entries.length;
}

function usage(msg) {
  process.stderr.write(
    `spec-traceability: ${msg}\nusage: spec-traceability.mjs [--root <dir>] [--base-ref <rev>] [--update-baseline]\n`,
  );
  process.exit(2);
}

function main() {
  const args = process.argv.slice(2);
  let root = null;
  let baseRef = null;
  let update = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1] !== undefined) root = args[++i];
    else if (args[i] === '--base-ref' && args[i + 1] !== undefined) baseRef = args[++i];
    else if (args[i] === '--update-baseline') update = true;
    else usage(`unknown or incomplete argument: ${args[i]}`);
  }
  let specsDir = 'docs/03-specs';
  let testBase = process.cwd();
  let baselineFile = BASELINE_DEFAULT;
  if (root !== null) {
    const r = path.resolve(process.cwd(), root);
    if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) usage(`root is not a directory: ${rel(r)}`);
    specsDir = path.join(r, 'specs');
    testBase = path.join(r, 'tests');
    baselineFile = path.join(r, 'baseline.json');
  }
  specsDir = path.resolve(process.cwd(), specsDir);
  baselineFile = path.resolve(process.cwd(), baselineFile);
  if (!fs.existsSync(specsDir) || loadSpecs(specsDir).size === 0)
    usage(`no SPEC-###-*.md files in ${rel(specsDir)}`);

  if (update) {
    const specs = loadSpecs(specsDir);
    const parsed = new Map([...specs].map(([id, s]) => [id, parseSpec(s)]));
    const { gaps } = computeGaps(specs, parsed, scanEchoes(testBase));
    const n = writeBaseline(baselineFile, gaps);
    process.stdout.write(`spec-traceability: wrote ${n} baseline entries to ${rel(baselineFile)}\n`);
  }

  let baseEntries = null;
  if (baseRef !== null) {
    const cwd = path.dirname(baselineFile);
    const ok = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { cwd, encoding: 'utf8' });
    if (ok.status !== 0) usage(`cannot resolve --base-ref ${baseRef}`);
    const shown = spawnSync('git', ['show', `${baseRef}:./${path.basename(baselineFile)}`], { cwd, encoding: 'utf8' });
    if (shown.status !== 0) {
      process.stdout.write('spec-traceability: growth check skipped (no baseline at base)\n');
    } else {
      try {
        baseEntries = JSON.parse(shown.stdout).gaps.filter((e) => ENTRY.test(e));
      } catch {
        usage(`baseline at ${baseRef} is not valid JSON`);
      }
    }
  }

  const { findings, stats } = runTraceability({ specsDir, testBase, baselineFile, baseEntries });
  if (findings.length > 0) {
    const gha = process.env.GITHUB_ACTIONS === 'true';
    for (const f of findings) {
      process.stderr.write(`${f.file}:${f.line}: [${f.rule}] ${f.message}\n`);
      if (gha)
        process.stdout.write(
          `::error file=${f.file},line=${f.line},title=spec-traceability ${f.rule}::${f.message}\n`,
        );
    }
    process.stderr.write(`spec-traceability: FAILED — ${findings.length} finding(s)\n`);
    process.exit(1);
  }
  process.stdout.write(
    `spec-traceability: OK — ${stats.musts} MUSTs in ${stats.specs} specs; ${stats.traced} traced, ${stats.baselined} baselined (${stats.unmapped} unmapped, ${stats.untested} untested); no new gaps\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
