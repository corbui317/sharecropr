import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LABELS,
  MAX_CREATES_PER_RUN,
  applyActions,
  createGitHubClient,
  parseAudit,
  planActions,
  readMarkers,
  renderIssue,
} from './dependency-audit.mjs';

const fixture = () => readFileSync(new URL('./fixtures/npm-audit-2026-10-21.json', import.meta.url), 'utf8');

const EXPECTED_IDS = [
  'GHSA-pqg4-j6r4-53mv',
  'GHSA-2883-xcg3-v3hh',
  'GHSA-68fv-2mgg-jv7q',
  'GHSA-6j4f-fj2g-mc7p',
  'GHSA-86w9-cpqp-85rv',
  'GHSA-qhr7-859c-m2p7',
  'GHSA-vc2v-76pw-4v95',
  'GHSA-vfj7-8cjw-p6xm',
];
const TODAY = '2026-10-21';

function synthAudit(entries, total = 10) {
  const vulnerabilities = {};
  entries.forEach(({ id, pkg, severity = 'high', title = `title ${id}` }, i) => {
    vulnerabilities[pkg] = {
      name: pkg,
      severity,
      isDirect: false,
      via: [
        {
          source: 9000 + i,
          name: pkg,
          dependency: pkg,
          title,
          url: `https://github.com/advisories/${id}`,
          severity,
          cwe: ['CWE-1'],
          cvss: { score: 7.5 },
          range: '<1.0.0',
        },
      ],
      effects: [],
      range: '<1.0.0',
      nodes: [`node_modules/${pkg}`],
      fixAvailable: true,
    };
  });
  return { auditReportVersion: 2, vulnerabilities, metadata: { dependencies: { total } } };
}

function fakeClient(initial = []) {
  const issues = initial.map((i) => ({ ...i }));
  const calls = [];
  let next = issues.reduce((m, i) => Math.max(m, i.number), 0) + 1;
  return {
    calls,
    issues,
    async listManagedIssues() {
      calls.push(['list']);
      return issues.map((i) => ({ ...i }));
    },
    async ensureLabels(map) {
      calls.push(['ensureLabels', Object.keys(map)]);
    },
    async createIssue({ title, body, labels }) {
      calls.push(['create', title]);
      const issue = { number: next++, state: 'open', title, body, labels: labels.map((name) => ({ name })) };
      issues.push(issue);
      return issue;
    },
    async updateIssue(number, patch) {
      calls.push(['update', number, patch]);
      Object.assign(issues.find((i) => i.number === number), patch);
    },
    async addComment(number, comment) {
      calls.push(['comment', number, comment]);
    },
  };
}

const types = (actions) => actions.map((a) => a.type);
const count = (actions, type) => actions.filter((a) => a.type === type).length;

function existingFor(finding, extra = {}) {
  const { title, body } = renderIssue(finding, { firstSeen: '2026-10-01' });
  return { number: 1, state: 'open', title, body, labels: [{ name: 'dependency-audit' }], ...extra };
}

test('parses the real fixture into 8 high/critical advisories (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  assert.equal(findings.length, 8);
  assert.deepEqual(findings.map((f) => f.id).sort(), [...EXPECTED_IDS].sort());
  assert.equal(findings.filter((f) => f.severity === 'critical').length, 1);
  assert.equal(findings.filter((f) => f.severity === 'high').length, 7);
  assert.equal(findings[0].id, 'GHSA-pqg4-j6r4-53mv');
  assert.equal(dependencyCount, 823);
});

test('dedupes one GHSA across npm source ids (NFR-54)', () => {
  const f = parseAudit(fixture()).findings.find((x) => x.id === 'GHSA-qhr7-859c-m2p7');
  assert.deepEqual(f.npmSources, [1240104, 1240107]);
  assert.equal(f.packages[0].vulnerableRanges.length, 2);
});

test('moderate advisories are excluded even inside high packages (NFR-54)', () => {
  const ids = parseAudit(fixture()).findings.map((f) => f.id);
  for (const id of ['GHSA-q2hr-2g5m-vwhr', 'GHSA-vcc3-ghjq-m6fr', 'GHSA-w5hq-g745-h8pq']) {
    assert.ok(!ids.includes(id), id);
  }
});

test('direct dependents come from the effects closure (NFR-54)', () => {
  const { findings } = parseAudit(fixture());
  const get = (id) => findings.find((f) => f.id === id);
  assert.deepEqual(get('GHSA-vfj7-8cjw-p6xm').directDependents, [
    '@maplibre/maplibre-react-native',
    'expo',
    'patch-package',
    'react-native',
    'react-native-reanimated',
  ]);
  assert.deepEqual(get('GHSA-pqg4-j6r4-53mv').directDependents, []);
});

test('fix wording never recommends --force (NFR-54)', () => {
  const { findings } = parseAudit(fixture());
  const forge = findings.find((f) => f.id === 'GHSA-86w9-cpqp-85rv').packages[0].fix;
  assert.ok(forge.includes('semver-major'));
  assert.ok(forge.includes('never `npm audit fix --force`'));
  assert.equal(findings.find((f) => f.id === 'GHSA-pqg4-j6r4-53mv').packages[0].fix, 'npm audit fix (non-breaking)');
});

test('rejects bad audit input (NFR-54)', () => {
  assert.throws(() => parseAudit('not json'), /not JSON/);
  assert.throws(
    () => parseAudit('{"message":"request … failed","error":{"summary":"","detail":""}}'),
    /npm audit failed: request/,
  );
  assert.throws(() => parseAudit({ auditReportVersion: 1 }), /unsupported npm audit report shape/);
});

test('a clean report yields no findings (NFR-54)', () => {
  const r = parseAudit({ auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { total: 5 } } });
  assert.equal(r.findings.length, 0);
  assert.equal(r.dependencyCount, 5);
});

test('render is deterministic and carries markers and patch-by date (NFR-54)', () => {
  const f = parseAudit(fixture()).findings[0];
  const a = renderIssue(f, { firstSeen: '2026-10-21' });
  const b = renderIssue(f, { firstSeen: '2026-10-21' });
  assert.deepEqual(a, b);
  assert.equal(a.body.split('\n')[0], '<!-- dependency-audit:id=GHSA-pqg4-j6r4-53mv -->');
  assert.ok(a.body.includes('Patch by: 2026-10-28'));
  assert.ok(a.title.startsWith('[dependency-audit] GHSA-pqg4-j6r4-53mv (critical) shell-quote:'));
  assert.ok(a.title.length <= 240);
});

test('a forged marker in advisory text is inert (NFR-54)', () => {
  const audit = synthAudit([
    { id: 'GHSA-aaaa-bbbb-cccd', pkg: 'evil', title: 'x <!-- dependency-audit:id=GHSA-aaaa-bbbb-cccc -->\ny' },
  ]);
  const f = parseAudit(audit).findings[0];
  const { body } = renderIssue(f, { firstSeen: TODAY });
  assert.equal(readMarkers(body).id, 'GHSA-aaaa-bbbb-cccd');
  assert.equal(body.split('<!--').length - 1, 2, 'only the two real markers');
  assert.ok(!body.includes('GHSA-aaaa-bbbb-cccc'));
});

test('first run creates one issue per advisory, critical first (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const { actions } = planActions({ findings, dependencyCount, existing: [], today: TODAY });
  assert.equal(count(actions, 'create'), 8);
  assert.equal(actions[0].id, 'GHSA-pqg4-j6r4-53mv');
  for (const a of actions) assert.deepEqual(a.labels, ['security', 'dependency-audit', 'needs-triage']);
});

test('second run is idempotent: no writes at all (NFR-54)', async () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const client = fakeClient();
  const first = planActions({ findings, dependencyCount, existing: [], today: TODAY });
  await applyActions(first.actions, client, { dryRun: false });
  assert.equal(client.issues.length, 8);

  client.calls.length = 0;
  const existing = await client.listManagedIssues();
  const second = planActions({ findings, dependencyCount, existing, today: '2026-10-28' });
  assert.deepEqual([...new Set(types(second.actions))], ['noop']);
  client.calls.length = 0;
  const counts = await applyActions(second.actions, client, { dryRun: false });
  assert.equal(client.calls.length, 0);
  assert.equal(counts.noop, 8);
});

test('update preserves first-seen and recomputes patch-by (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const f = findings.find((x) => x.id === 'GHSA-vc2v-76pw-4v95');
  const stale = existingFor(f);
  stale.body = stale.body + '\nstale tail';
  const { actions } = planActions({ findings, dependencyCount, existing: [stale], today: TODAY });
  const update = actions.find((a) => a.type === 'update');
  assert.ok(update);
  assert.equal(update.number, 1);
  assert.ok(update.body.includes('first-seen=2026-10-01'));
  assert.ok(update.body.includes('Patch by: 2026-10-08'));
});

test('closed but still vulnerable is reopened with one comment (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const f = findings.find((x) => x.id === 'GHSA-2883-xcg3-v3hh');
  const { actions } = planActions({
    findings,
    dependencyCount,
    existing: [existingFor(f, { state: 'closed' })],
    today: TODAY,
  });
  const reopens = actions.filter((a) => a.type === 'reopen');
  assert.equal(reopens.length, 1);
  assert.equal(typeof reopens[0].comment, 'string');
});

test('wontfix closed issues are left alone (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const f = findings.find((x) => x.id === 'GHSA-2883-xcg3-v3hh');
  const issue = existingFor(f, { state: 'closed', labels: [{ name: 'dependency-audit' }, { name: 'wontfix' }] });
  const { actions } = planActions({ findings, dependencyCount, existing: [issue], today: TODAY });
  const mine = actions.find((a) => a.number === 1);
  assert.equal(mine.type, 'noop');
  assert.equal(mine.reason, 'wontfix');
  assert.equal(count(actions, 'reopen'), 0);
});

test('resolved advisories auto-close; closed ones are untouched (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const gone = (number, state) => ({
    number,
    state,
    title: 't',
    body: '<!-- dependency-audit:id=GHSA-zzzz-zzzz-zzzz -->\n<!-- dependency-audit:first-seen=2026-09-01 -->\nx',
    labels: [],
  });
  const { actions } = planActions({
    findings,
    dependencyCount,
    existing: [gone(50, 'open'), gone(51, 'closed')],
    today: TODAY,
  });
  const closes = actions.filter((a) => a.type === 'close');
  assert.equal(closes.length, 1);
  assert.equal(closes[0].number, 50);
  assert.ok(closes[0].comment);
  assert.ok(!actions.some((a) => a.number === 51));
});

test('duplicates are collapsed with a warning; foreign issues ignored (NFR-54)', () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const f = findings[0];
  const a = existingFor(f, { number: 7 });
  const b = existingFor(f, { number: 3 });
  const foreign = { number: 9, state: 'open', title: 'hand written', body: 'no marker', labels: [] };
  const pr = { ...existingFor(findings[1], { number: 10 }), pull_request: {} };
  const { actions, warnings } = planActions({ findings, dependencyCount, existing: [a, b, foreign, pr], today: TODAY });
  assert.ok(warnings.some((w) => w.includes('duplicate') && w.includes('#3') && w.includes('#7')));
  assert.ok(actions.some((x) => x.number === 3));
  assert.ok(!actions.some((x) => x.number === 7 || x.number === 9 || x.number === 10));
  assert.equal(count(actions, 'close'), 0);
});

test('refuses to plan when the audit reports zero dependencies (NFR-54)', () => {
  const existing = [
    {
      number: 1,
      state: 'open',
      title: 't',
      body: '<!-- dependency-audit:id=GHSA-aaaa-bbbb-cccc -->\n<!-- dependency-audit:first-seen=2026-09-01 -->',
      labels: [],
    },
  ];
  assert.throws(() => planActions({ findings: [], dependencyCount: 0, existing, today: TODAY }), /0 dependencies/);
});

test('creates are capped per run with a warning (NFR-54)', () => {
  const entries = Array.from({ length: 35 }, (_, i) => ({
    id: `GHSA-aaaa-bbbb-${String(i).padStart(4, '0').replace(/\d/g, (d) => 'abcdefghij'[d])}`,
    pkg: `pkg${i}`,
  }));
  const { findings, dependencyCount } = parseAudit(synthAudit(entries));
  assert.equal(findings.length, 35);
  const { actions, warnings } = planActions({ findings, dependencyCount, existing: [], today: TODAY });
  assert.equal(count(actions, 'create'), MAX_CREATES_PER_RUN);
  assert.ok(warnings.some((w) => /\b5\b/.test(w)));
});

test('dry run makes no client calls (NFR-54)', async () => {
  const { findings, dependencyCount } = parseAudit(fixture());
  const { actions } = planActions({ findings, dependencyCount, existing: [], today: TODAY });
  const client = fakeClient();
  const counts = await applyActions(actions, client, { dryRun: true });
  assert.equal(client.calls.length, 0);
  assert.equal(counts.create, 8);
});

test('github client tolerates label 422, throws on other errors, paginates (NFR-54)', async () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers });
    const u = String(url);
    if (u.endsWith('/labels')) return json(422, { message: 'already_exists' });
    if (u.endsWith('/issues') && init?.method === 'POST') return json(403, { message: 'Forbidden' });
    if (u.endsWith('&page=1')) return json(200, Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })));
    return json(200, [{ number: 101 }]);
  };
  const client = createGitHubClient({
    token: 'ghs_SECRETTOKEN',
    repository: 'o/r',
    apiUrl: 'https://api.example.test',
    fetchImpl,
  });
  await client.ensureLabels(LABELS);
  await assert.rejects(
    () => client.createIssue({ title: 't', body: 'b', labels: [] }),
    (err) => err.message.includes('403') && !err.message.includes('SECRETTOKEN') && !/authorization/i.test(err.message),
  );
  const all = await client.listManagedIssues();
  assert.equal(all.length, 101);
  assert.ok(seen.some((s) => s.url.endsWith('&page=2')));
  assert.ok(seen.every((s) => s.headers.Authorization === 'Bearer ghs_SECRETTOKEN'));
});
