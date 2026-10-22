// NFR-54 / SCR-0010: turn `npm audit --json` output into one GitHub issue per
// high/critical advisory (deduped by GHSA id). Pure functions + a thin REST client.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MARKER_PREFIX = 'dependency-audit';
export const ISSUE_LABEL = 'dependency-audit';
export const LABELS = {
  security: { color: 'b60205', description: 'Security finding' },
  'dependency-audit': { color: '5319e7', description: 'Opened by .github/workflows/dependency-audit.yml' },
  'needs-triage': { color: 'fbca04', description: 'Maintainer needs to evaluate this issue' },
};
export const MAX_CREATES_PER_RUN = 30;
export const PATCH_SLA_DAYS = 7; // NFR-54

const RANK = { critical: 2, high: 1 };
const GHSA_RE = /GHSA(-[0-9a-z]{4}){3}/;
const USAGE = 'usage: node scripts/dependency-audit.mjs --input <npm-audit.json> [--dry-run] [--today YYYY-MM-DD]';

const uniqSorted = (arr, cmp) => [...new Set(arr)].sort(cmp);
const byNumber = (a, b) => a - b;

export function parseAudit(input) {
  let obj = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      obj = JSON.parse(String(input));
    } catch {
      throw new Error('npm audit output is not JSON');
    }
  }
  if (obj && obj.error) throw new Error('npm audit failed: ' + obj.message);
  if (!obj || obj.auditReportVersion !== 2 || typeof obj.vulnerabilities !== 'object' || !obj.vulnerabilities) {
    throw new Error('unsupported npm audit report shape');
  }
  const vulns = obj.vulnerabilities;
  const byId = new Map();
  for (const [pkg, entry] of Object.entries(vulns)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || !(via.severity in RANK)) continue;
      const id = (GHSA_RE.exec(via.url ?? '') ?? [`npm-${via.source}`])[0];
      if (!byId.has(id)) byId.set(id, { id, advisories: [], pkgs: new Map() });
      const g = byId.get(id);
      g.advisories.push(via);
      if (!g.pkgs.has(pkg)) g.pkgs.set(pkg, { entry, ranges: [] });
      g.pkgs.get(pkg).ranges.push(via.range);
    }
  }
  const directFrom = (start) => {
    const seen = new Set();
    const stack = [start];
    const out = [];
    while (stack.length) {
      const name = stack.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      if (vulns[name]?.isDirect === true) out.push(name);
      for (const e of vulns[name]?.effects ?? []) stack.push(e);
    }
    return out;
  };
  const fixText = (fa) => {
    if (fa === true) return 'npm audit fix (non-breaking)';
    if (fa && typeof fa === 'object') {
      return `semver-major: npm proposes ${fa.name}@${fa.version} — review manually, never \`npm audit fix --force\``;
    }
    return 'no fix published';
  };
  const findings = [...byId.values()].map((g) => {
    const first = g.advisories[0];
    const severity = g.advisories.some((a) => a.severity === 'critical') ? 'critical' : 'high';
    const packages = [...g.pkgs.entries()]
      .map(([name, { entry, ranges }]) => ({
        name,
        vulnerableRanges: uniqSorted(ranges.filter(Boolean)),
        installedRange: entry.range ?? '',
        nodes: uniqSorted(entry.nodes ?? []),
        isDirect: entry.isDirect === true,
        fix: fixText(entry.fixAvailable),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: g.id,
      severity,
      title: first.title ?? '',
      url: first.url ?? '',
      cvss: Math.max(0, ...g.advisories.map((a) => a.cvss?.score ?? 0)),
      cwe: uniqSorted(g.advisories.flatMap((a) => a.cwe ?? [])),
      npmSources: uniqSorted(g.advisories.map((a) => a.source).filter((s) => s != null), byNumber),
      packages,
      directDependents: uniqSorted(packages.flatMap((p) => directFrom(p.name))),
    };
  });
  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.id.localeCompare(b.id));
  return { findings, dependencyCount: obj.metadata?.dependencies?.total ?? 0 };
}

// Advisory text is third-party data: neutralise anything that could forge a marker.
const clean = (s) => String(s ?? '').replaceAll('<!--', '').replaceAll('-->', '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
const cell = (s) => clean(s).replaceAll('|', '\\|');

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function renderIssue(finding, { firstSeen }) {
  const names = finding.packages.map((p) => p.name).join(', ');
  const title = `[${MARKER_PREFIX}] ${finding.id} (${finding.severity}) ${names}: ${clean(finding.title)}`.slice(0, 240);
  const rows = finding.packages.map(
    (p) =>
      `| ${cell(p.name)} | ${p.vulnerableRanges.map(cell).join('<br>')} | ${p.nodes.map(cell).join('<br>')} | ${cell(p.fix)} |`,
  );
  const body = [
    `<!-- ${MARKER_PREFIX}:id=${finding.id} -->`,
    `<!-- ${MARKER_PREFIX}:first-seen=${firstSeen} -->`,
    '',
    `**Severity:** ${finding.severity}${finding.cvss ? ` (CVSS ${finding.cvss})` : ''}`,
    `**Advisory:** ${clean(finding.url)}`,
    `**CWE:** ${finding.cwe.map(clean).join(', ') || 'n/a'}`,
    `Patch by: ${addDays(firstSeen, PATCH_SLA_DAYS)} (NFR-54)`,
    '',
    '| Package | Vulnerable range(s) | Install path(s) | Fix |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    finding.directDependents.length
      ? `Reached from direct dependencies: ${finding.directDependents.map((d) => `\`${clean(d)}\``).join(', ')}`
      : 'Reached from direct dependencies: transitive only',
    '',
    'Managed by `.github/workflows/dependency-audit.yml`. Closing this issue is fine once fixed — the job reopens it if npm audit still reports it. Add `wontfix` to accept the risk; the job will then leave it closed. Do not run `npm audit fix --force`.',
  ].join('\n');
  return { title, body };
}

export function readMarkers(body) {
  const [l1 = '', l2 = ''] = String(body ?? '').split('\n', 2).map((l) => l.trim());
  const id = new RegExp(`^<!-- ${MARKER_PREFIX}:id=([A-Za-z0-9-]+) -->$`).exec(l1);
  const fs = new RegExp(`^<!-- ${MARKER_PREFIX}:first-seen=(\\d{4}-\\d{2}-\\d{2}) -->$`).exec(l2);
  return { id: id ? id[1] : null, firstSeen: fs ? fs[1] : null };
}

export function planActions({ findings, dependencyCount, existing, today }) {
  if (!dependencyCount) throw new Error('audit reported 0 dependencies; refusing to plan');
  const warnings = [];
  const groups = new Map();
  for (const issue of existing) {
    if (issue.pull_request) continue;
    const { id } = readMarkers(issue.body);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(issue);
  }
  const managed = new Map();
  for (const [id, list] of groups) {
    const sorted = [...list].sort((a, b) => a.number - b.number);
    const keep = sorted.find((i) => i.state === 'open') ?? sorted[0];
    if (list.length > 1) warnings.push(`duplicate issues for ${id}: ${sorted.map((i) => `#${i.number}`).join(', ')}`);
    managed.set(id, keep);
  }
  const creates = [], reopens = [], updates = [], closes = [], noops = [];
  const current = new Set(findings.map((f) => f.id));
  for (const f of findings) {
    const issue = managed.get(f.id);
    if (!issue) {
      const { title, body } = renderIssue(f, { firstSeen: today });
      creates.push({ type: 'create', id: f.id, title, body, labels: Object.keys(LABELS) });
      continue;
    }
    const { title, body } = renderIssue(f, { firstSeen: readMarkers(issue.body).firstSeen ?? today });
    const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
    if (issue.state === 'open') {
      if (title !== issue.title || body !== issue.body) updates.push({ type: 'update', id: f.id, number: issue.number, title, body });
      else noops.push({ type: 'noop', id: f.id, number: issue.number });
    } else if (labels.includes('wontfix')) {
      noops.push({ type: 'noop', id: f.id, number: issue.number, reason: 'wontfix' });
    } else {
      reopens.push({
        type: 'reopen', id: f.id, number: issue.number, title, body,
        comment: `Still reported by \`npm audit\` on ${today}; reopened.`,
      });
    }
  }
  for (const [id, issue] of managed) {
    if (issue.state === 'open' && !current.has(id)) {
      closes.push({
        type: 'close', id, number: issue.number,
        comment: `No longer reported by \`npm audit\` as of ${today}. Closing.`,
      });
    }
  }
  if (creates.length > MAX_CREATES_PER_RUN) {
    warnings.push(`${creates.length - MAX_CREATES_PER_RUN} new advisories not filed this run (cap ${MAX_CREATES_PER_RUN}); they will be filed next run`);
    creates.length = MAX_CREATES_PER_RUN;
  }
  return { actions: [...creates, ...reopens, ...updates, ...closes, ...noops], warnings };
}

export async function applyActions(actions, client, { dryRun }) {
  const counts = { create: 0, update: 0, reopen: 0, close: 0, noop: 0 };
  for (const a of actions) counts[a.type]++;
  if (dryRun) return counts;
  if (counts.create || counts.reopen) await client.ensureLabels(LABELS);
  for (const a of actions) {
    if (a.type === 'create') await client.createIssue({ title: a.title, body: a.body, labels: a.labels });
    else if (a.type === 'update') await client.updateIssue(a.number, { title: a.title, body: a.body });
    else if (a.type === 'reopen') {
      await client.updateIssue(a.number, { state: 'open', title: a.title, body: a.body });
      await client.addComment(a.number, a.comment);
    } else if (a.type === 'close') {
      await client.addComment(a.number, a.comment);
      await client.updateIssue(a.number, { state: 'closed', state_reason: 'completed' });
    }
  }
  return counts;
}

export function createGitHubClient({ token, repository, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY must be owner/repo');
  const base = `/repos/${repository}`;
  async function request(method, path, body, okStatuses = []) {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      let message = '';
      try {
        message = (await res.json()).message ?? '';
      } catch {
        /* no body */
      }
      throw new Error(`GitHub ${method} ${path} -> ${res.status}${message ? `: ${clean(message)}` : ''}`);
    }
    return res.ok ? res.json() : null;
  }
  return {
    async listManagedIssues() {
      const all = [];
      for (let page = 1; ; page++) {
        const items = await request('GET', `${base}/issues?labels=${ISSUE_LABEL}&state=all&per_page=100&page=${page}`);
        all.push(...items);
        if (items.length < 100) return all;
      }
    },
    async ensureLabels(map) {
      for (const [name, { color, description }] of Object.entries(map)) {
        await request('POST', `${base}/labels`, { name, color, description }, [422]);
      }
    },
    createIssue: ({ title, body, labels }) => request('POST', `${base}/issues`, { title, body, labels }),
    updateIssue: (number, patch) => request('PATCH', `${base}/issues/${number}`, patch),
    addComment: (number, body) => request('POST', `${base}/issues/${number}/comments`, { body }),
  };
}

export async function main(argv, env) {
  const inActions = env.GITHUB_ACTIONS === 'true';
  let input = null, dryRun = false, today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--today' && /^\d{4}-\d{2}-\d{2}$/.test(argv[i + 1] ?? '')) today = argv[++i];
    else { console.error(USAGE); return 2; }
  }
  if (!input) { console.error(USAGE); return 2; }
  try {
    const { findings, dependencyCount } = parseAudit(readFileSync(input, 'utf8'));
    const offline = dryRun && !(env.GITHUB_TOKEN && env.GITHUB_REPOSITORY);
    const client = offline ? null : createGitHubClient({
      token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL || undefined,
    });
    if (!client && !dryRun) throw new Error('GITHUB_TOKEN is required');
    const existing = offline ? [] : await client.listManagedIssues();
    const { actions, warnings } = planActions({ findings, dependencyCount, existing, today });
    for (const w of warnings) console.warn(inActions ? `::warning::${w}` : `warning: ${w}`);
    const c = await applyActions(actions, client, { dryRun });
    const n = (s) => findings.filter((f) => f.severity === s).length;
    const lines = [
      `${findings.length} high/critical advisories (critical: ${n('critical')}, high: ${n('high')})`,
      `plan: create ${c.create}, update ${c.update}, reopen ${c.reopen}, close ${c.close}, unchanged ${c.noop}${dryRun ? ' (dry run)' : ''}`,
      ...actions.filter((a) => a.type !== 'noop').map((a) =>
        a.type === 'create' ? `create ${a.id} ${a.title}` : `${a.type} #${a.number} ${a.id}`),
    ];
    console.log(lines.join('\n'));
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Dependency audit\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
    }
    return 0;
  } catch (err) {
    console.error(inActions ? `::error::${err.message}` : `error: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
