#!/usr/bin/env node
// Doc governance gates — CI/CD §5.1. SCR-0003 (schema graph acyclic + register sync).
// WP-23 / SCR-0004 adds `coupling-symmetric` by appending to GATES.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SPEC_FILE = /^SPEC-(\d{3})-[a-z0-9-]+\.md$/;
const SCHEMA_LABEL = 'Schema depends on';

const rel = (p) => path.relative(process.cwd(), p) || p;

/** Cell grammar shared by "Schema depends on" and "Behaviourally coupled with". */
export function parseRelationCell(cell) {
  const stripped = cell.replace(/\]\([^)]*\)/g, ']');
  const ids = [];
  for (const m of stripped.matchAll(/\bSPEC-(\d{3})\b/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  const t = cell.trim();
  const ok = ids.length > 0 || t.startsWith('—') || t.startsWith('-');
  return { ids, ok };
}

/** Finds `| **<label>** | cell |` before the first `---` line. Line is 1-based. */
export function readFrontMatterRow(lines, label) {
  const end = lines.findIndex((l) => l === '---');
  const limit = end === -1 ? lines.length : end;
  const re = new RegExp(
    `^\\|\\s*\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*\\s*\\|(.*)\\|\\s*$`,
  );
  let found = null;
  for (let i = 0; i < limit; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    if (found) return { duplicate: i + 1 };
    found = { line: i + 1, cell: m[1].trim() };
  }
  return found;
}

export function loadSpecs(root) {
  const abs = path.resolve(root);
  const specs = new Map();
  for (const f of fs.readdirSync(abs).sort()) {
    const m = SPEC_FILE.exec(f);
    if (!m) continue;
    const text = fs.readFileSync(path.join(abs, f), 'utf8');
    specs.set(m[1], { id: m[1], file: rel(path.join(abs, f)), lines: text.split(/\r?\n/) });
  }
  return new Map([...specs].sort((a, b) => a[0].localeCompare(b[0])));
}

const splitRow = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((s) => s.trim());

export function loadRegister(root) {
  const abs = path.resolve(root, 'README.md');
  const file = rel(abs);
  const rows = new Map();
  const errors = [];
  if (!fs.existsSync(abs)) {
    errors.push({ rule: 'register-sync', file, line: 1, message: 'register README.md not found' });
    return { file, rows, errors };
  }
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const head = splitRow(lines[i]);
    const idCol = head.indexOf('ID');
    const depCol = head.indexOf(SCHEMA_LABEL);
    if (idCol === -1 || depCol === -1) continue;
    let j = i + 2; // skip the separator
    for (; j < lines.length && lines[j].startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const id = cells[idCol];
      if (!/^\d{3}$/.test(id ?? '')) continue;
      const raw = cells[depCol] ?? '';
      const line = j + 1;
      let ids;
      if (raw === '—') ids = [];
      else {
        const parts = raw.split(',').map((s) => s.trim());
        if (!parts.every((p) => /^\d{3}$/.test(p))) {
          errors.push({
            rule: 'register-sync',
            file,
            line,
            message: `register row ${id} "Schema depends on" unparseable: "${raw}"`,
          });
          continue;
        }
        ids = [...new Set(parts)];
      }
      if (rows.has(id)) {
        errors.push({
          rule: 'register-sync',
          file,
          line,
          message: `register row ${id} duplicated (also line ${rows.get(id).line})`,
        });
        continue;
      }
      rows.set(id, { line, ids, raw });
    }
    i = j - 1;
  }
  return { file, rows, errors };
}

export function findCycles(graph) {
  const color = new Map();
  const stack = [];
  const seen = new Set();
  const cycles = [];
  const visit = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of [...(graph.get(u) ?? [])].sort()) {
      const c = color.get(v) ?? 0;
      if (c === 1) {
        const cyc = stack.slice(stack.indexOf(v));
        const min = cyc.reduce((a, b) => (b < a ? b : a));
        const k = cyc.indexOf(min);
        const canon = [...cyc.slice(k), ...cyc.slice(0, k)];
        canon.push(canon[0]);
        const key = canon.join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(canon);
        }
      } else if (c === 0) visit(v);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const u of [...graph.keys()].sort()) if ((color.get(u) ?? 0) === 0) visit(u);
  return cycles;
}

export function checkFrontMatter(ctx) {
  const findings = [];
  for (const spec of ctx.specs.values()) {
    const row = readFrontMatterRow(spec.lines, SCHEMA_LABEL);
    const name = `SPEC-${spec.id}`;
    const bad = (line, message) =>
      findings.push({ rule: 'frontmatter-row', file: spec.file, line, message });
    if (!row) bad(1, `${name}: "${SCHEMA_LABEL}" row missing from front matter`);
    else if (row.duplicate)
      bad(row.duplicate, `${name}: "${SCHEMA_LABEL}" row duplicated (also line ${row.duplicate})`);
    else {
      const { ids, ok } = parseRelationCell(row.cell);
      if (!ok) bad(row.line, `${name}: "${SCHEMA_LABEL}" row unparseable: "${row.cell}"`);
      else ctx.schema.set(spec.id, { line: row.line, ids });
    }
  }
  return findings;
}

export function checkSchemaAcyclic(ctx) {
  const findings = [];
  const graph = new Map();
  for (const [id, { line, ids }] of ctx.schema) {
    const spec = ctx.specs.get(id);
    const known = [];
    for (const dep of ids) {
      if (ctx.specs.has(dep)) known.push(dep);
      else
        findings.push({
          rule: 'schema-unknown-spec',
          file: spec.file,
          line,
          message: `SPEC-${id} "${SCHEMA_LABEL}" names SPEC-${dep}, which does not exist`,
        });
    }
    graph.set(id, known);
  }
  ctx.stats.edges = [...graph.values()].reduce((n, d) => n + d.length, 0);
  for (const cyc of findCycles(graph)) {
    const text = cyc.map((i) => `SPEC-${i}`).join(' -> ');
    for (let i = 0; i < cyc.length - 1; i++) {
      const from = cyc[i];
      findings.push({
        rule: 'schema-acyclic',
        file: ctx.specs.get(from).file,
        line: ctx.schema.get(from).line,
        message: `SPEC-${from} -> SPEC-${cyc[i + 1]} closes cycle ${text} ("${SCHEMA_LABEL}" must be a DAG — Specs README §Build order)`,
      });
    }
  }
  return findings;
}

export function checkRegisterSync(ctx) {
  const { register } = ctx;
  const findings = [...register.errors];
  const fmt = (ids) => `[${ids.join(', ')}]`;
  for (const [id, spec] of ctx.specs) {
    const row = register.rows.get(id);
    const fm = ctx.schema.get(id);
    if (!row) {
      findings.push({
        rule: 'register-sync',
        file: register.file,
        line: 1,
        message: `SPEC-${id} has no register row`,
      });
    } else if (fm) {
      const a = [...row.ids].sort().join();
      const b = [...fm.ids].sort().join();
      if (a !== b)
        findings.push({
          rule: 'register-sync',
          file: register.file,
          line: row.line,
          message: `SPEC-${id}: register says ${fmt(row.ids)} but front matter (${spec.file}:${fm.line}) says ${fmt(fm.ids)}`,
        });
    }
  }
  for (const [id, row] of register.rows) {
    if (!ctx.specs.has(id))
      findings.push({
        rule: 'register-sync',
        file: register.file,
        line: row.line,
        message: `register row ${id} has no SPEC-${id}-*.md`,
      });
  }
  return findings;
}

export const GATES = [checkFrontMatter, checkSchemaAcyclic, checkRegisterSync];

export function runGates(root) {
  const specs = loadSpecs(root);
  const ctx = {
    root,
    specs,
    schema: new Map(),
    register: loadRegister(root),
    stats: { specs: specs.size, edges: 0 },
  };
  const findings = GATES.flatMap((g) => g(ctx));
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  return { findings, stats: ctx.stats };
}

function usage(msg) {
  process.stderr.write(`doc-gates: ${msg}\nusage: doc-gates.mjs [--root <dir>]\n`);
  process.exit(2);
}

function main() {
  const args = process.argv.slice(2);
  let root = 'docs/03-specs';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1] !== undefined) root = args[++i];
    else usage(`unknown or incomplete argument: ${args[i]}`);
  }
  root = path.resolve(process.cwd(), root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    usage(`root is not a directory: ${rel(root)}`);
  if (loadSpecs(root).size === 0) usage(`no SPEC-###-*.md files in ${rel(root)}`);

  const { findings, stats } = runGates(root);
  if (findings.length > 0) {
    const gha = process.env.GITHUB_ACTIONS === 'true';
    for (const f of findings) {
      process.stderr.write(`${f.file}:${f.line}: [${f.rule}] ${f.message}\n`);
      if (gha)
        process.stdout.write(
          `::error file=${f.file},line=${f.line},title=doc-gates ${f.rule}::${f.message}\n`,
        );
    }
    process.stderr.write(`doc-gates: FAILED — ${findings.length} finding(s)\n`);
    process.exit(1);
  }
  process.stdout.write(
    `doc-gates: OK — ${stats.specs} specs, ${stats.edges} schema edges, acyclic; register in sync\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
