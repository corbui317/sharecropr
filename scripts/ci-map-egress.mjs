#!/usr/bin/env node
// ci:map-egress-static — the STATIC half of SPEC-008-T74 (R74, R78, R79, R80), with T81 covered by
// the fixture self-test in ci-map-egress.test.mjs.
//
// This is NOT `ci:assert-map-egress` (CI/CD §4.1), which is the wire capture (T78–T80,
// TC-GEO-41..43). A transitive dependency that phones home is only caught at the wire.
//
// Every URL in the style, the app config and the map source must be https, on the Sharecropr tile
// origin or the configured Supabase origin (R79), with no userinfo, query, credential, non-z/x/y
// template token or coordinate-shaped value (R78, R80). Config defaults must agree, and the style
// must come from the in-repo JSON, never from a remote value (T74).
//
// Node builtins only, so it runs before `npm ci` like doc-gates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_STYLE = 'src/features/map/style/sharecropr-basemap.json';
export const ALLOWED_TOKENS = new Set(['{z}', '{x}', '{y}', '{fontstack}', '{range}']);
const URL_LIKE = /^(pmtiles:\/\/)?(\{\{TILE_ORIGIN\}\}|[a-z][a-z0-9+.-]*:\/\/)/i;
const DECIMAL_DEGREES = /-?\d{1,3}\.\d{3,}/; // does not match 202608.pmtiles
const CREDENTIAL = /(^|[?&;])(key|api_?key|access_?token|token|auth|sig(nature)?|session|uid|user_?id|device_?id)=/i;
const CONTROLLED_TILE_HOST = /^([a-z0-9-]+\.)*sharecropr\.com$/;

const APP_CONFIG = 'app.config.ts';
const BASEMAP_TS = 'src/features/map/config/basemap.ts';
const MAP_CANVAS = 'src/features/map/components/MapCanvas.tsx';

const hostOf = (value) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
};

/** Every string value in a parsed JSON document that looks like a URL (sources, glyphs, sprite, metadata). */
export function collectUrls(json, at = '$') {
  if (typeof json === 'string') return URL_LIKE.test(json) ? [{ at, url: json }] : [];
  if (Array.isArray(json)) return json.flatMap((v, i) => collectUrls(v, `${at}[${i}]`));
  if (json && typeof json === 'object') {
    return Object.entries(json).flatMap(([k, v]) => collectUrls(v, `${at}.${k}`));
  }
  return [];
}

/** Returns the reasons a single URL (possibly a template) breaks R78/R79/R80. Empty means clean. */
export function checkUrl(url, { tileOrigin, archive = 'x.pmtiles', supabaseUrl } = {}) {
  const reasons = [];
  const withoutPlaceholders = url.replace(/\{\{[A-Z_]+\}\}/g, '');
  for (const token of withoutPlaceholders.match(/\{[^{}]*\}/g) ?? []) {
    if (!ALLOWED_TOKENS.has(token)) reasons.push(`template token ${token} is not z/x/y/fontstack/range (R80)`);
  }

  let resolved = url
    .replaceAll('{{TILE_ORIGIN}}', tileOrigin ?? '')
    .replaceAll('{{BASEMAP_ARCHIVE}}', archive)
    .replace(/^pmtiles:\/\//i, '');
  for (const token of ALLOWED_TOKENS) resolved = resolved.replaceAll(token, '0');
  // Unknown tokens were reported above; neutralise them so the URL still parses.
  resolved = resolved.replace(/\{[^{}]*\}/g, '0');

  let parsed;
  try {
    parsed = new URL(resolved);
  } catch {
    reasons.push('does not parse as a URL (R78)');
    return reasons;
  }
  if (parsed.protocol !== 'https:') reasons.push(`scheme ${parsed.protocol} is not https (R78)`);
  if (parsed.username || parsed.password) reasons.push('userinfo in URL (R78)');
  if (parsed.search) {
    reasons.push(
      CREDENTIAL.test(parsed.search)
        ? 'credential-like query parameter (R78)'
        : 'query string on a map URL (R78/R80)',
    );
  }
  if (parsed.hash) reasons.push('fragment on a map URL (R78)');

  const allowed = new Set([hostOf(tileOrigin ?? ''), hostOf(supabaseUrl ?? '')].filter(Boolean));
  const host = parsed.host.toLowerCase();
  if (!allowed.has(host)) {
    reasons.push(`host ${host} is not the tile origin or the configured Supabase origin (R79)`);
  }
  let decoded = parsed.pathname;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    // keep the raw path
  }
  if (DECIMAL_DEGREES.test(decoded)) reasons.push('coordinate-shaped value in path (R80)');
  return reasons;
}

/** The tile origin must be a Sharecropr host; the Supabase URL, when set, must be https (or local). */
export function checkOrigins({ tileOrigin, supabaseUrl }) {
  const failures = [];
  let t;
  try {
    t = new URL(tileOrigin);
  } catch {
    failures.push(`tile origin ${tileOrigin} does not parse (R79)`);
  }
  if (t) {
    if (t.protocol !== 'https:') failures.push(`tile origin ${tileOrigin} is not https (R78)`);
    if (!CONTROLLED_TILE_HOST.test(t.hostname.toLowerCase())) {
      failures.push(`tile origin ${tileOrigin} is not Sharecropr-controlled (R79)`);
    }
    if ((t.pathname !== '/' && t.pathname !== '') || t.search || t.hash || t.username || t.password) {
      failures.push(`tile origin ${tileOrigin} must be a bare origin: no path, query or userinfo (R78)`);
    }
  }
  if (supabaseUrl) {
    let s;
    try {
      s = new URL(supabaseUrl);
    } catch {
      failures.push(`Supabase URL ${supabaseUrl} does not parse (R79)`);
    }
    if (s) {
      const local = s.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(s.hostname);
      if (s.protocol !== 'https:' && !local) failures.push(`Supabase URL ${supabaseUrl} is not https (R78)`);
      if (s.search || s.username || s.password) {
        failures.push(`Supabase URL ${supabaseUrl} must carry no query or userinfo (R78)`);
      }
    }
  }
  return failures;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** Extracts the tile-origin defaults from app.config.ts and basemap.ts. */
export function extractTileOriginDefaults(files) {
  const found = [];
  const app = files[APP_CONFIG];
  if (app !== undefined) {
    const m = /TILE_ORIGIN\s*\?\?\s*'([^']+)'/.exec(stripComments(app));
    if (m) found.push({ where: APP_CONFIG, value: m[1] });
  }
  const bm = files[BASEMAP_TS];
  if (bm !== undefined) {
    for (const m of stripComments(bm).matchAll(/tileOrigin\s*\?\?\s*'([^']+)'/g)) {
      found.push({ where: BASEMAP_TS, value: m[1] });
    }
  }
  return found;
}

export function checkConfigDefaults(files) {
  const failures = [];
  const found = extractTileOriginDefaults(files);
  if (found.length === 0) return ['no tile-origin default found in app config or basemap.ts'];
  if (new Set(found.map((f) => f.value)).size > 1) {
    failures.push(`tile origin defaults disagree: ${found.map((f) => `${f.where}=${f.value}`).join(', ')}`);
  }
  for (const f of found) {
    for (const reason of checkOrigins({ tileOrigin: f.value })) failures.push(`${f.where}: ${reason}`);
  }
  return failures;
}

/** The style must come from the in-repo JSON: no JSX styleUrl, no mapStyle from any other value (T74). */
export function checkRemoteStyle(files) {
  const failures = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!/\.(ts|tsx)$/.test(file) || file.includes('__tests__')) continue;
    const src = stripComments(raw);
    if (/\bstyleUrl\s*=(?!=)/.test(src)) failures.push(`${file}: JSX styleUrl= loads a style from a remote value (T74)`);
    for (const m of src.matchAll(/\bmapStyle\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
      if (!(file === MAP_CANVAS && m[1] === '{mapStyle}')) {
        failures.push(`${file}: mapStyle=${m[1]} is not the in-repo resolved style (T74)`);
      }
    }
  }
  const bm = files[BASEMAP_TS];
  if (bm !== undefined && !/from\s+'@\/features\/map\/style\/sharecropr-basemap\.json'/.test(bm)) {
    failures.push(`${BASEMAP_TS}: must import the in-repo sharecropr-basemap.json (T74)`);
  }
  return failures;
}

/** Scans every http(s) literal in map source and app.config.ts; returns the failures and how many were checked. */
export function scanSourceLiterals(files, ctx = {}) {
  const failures = [];
  let count = 0;
  for (const [file, raw] of Object.entries(files)) {
    const inScope =
      file === APP_CONFIG ||
      (file.startsWith('src/features/map/') &&
        !file.startsWith('src/features/map/style/') &&
        !file.includes('__tests__'));
    if (!inScope) continue;
    for (const m of stripComments(raw).matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      if (m[0].includes('${')) continue; // composed at runtime from a checked origin
      count += 1;
      let reasons = checkUrl(m[0], ctx);
      // With no configured origin to compare against, any Sharecropr host is acceptable.
      if (!ctx.tileOrigin && CONTROLLED_TILE_HOST.test(new URL(m[0]).hostname)) {
        reasons = reasons.filter((r) => !r.endsWith('(R79)'));
      }
      for (const r of reasons) failures.push(`${file}: ${m[0]}: ${r}`);
    }
  }
  return { failures, count };
}

export const checkSourceLiterals = (files, ctx = {}) => scanSourceLiterals(files, ctx).failures;

function walk(root, dir, out) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = {};
  walk(root, 'src', files);
  walk(root, 'app', files);
  files[APP_CONFIG] = fs.readFileSync(path.join(root, APP_CONFIG), 'utf8');

  const stylePath = argv[0] ?? DEFAULT_STYLE;
  const styleAbs = path.isAbsolute(stylePath) ? stylePath : path.join(root, stylePath);
  const style = JSON.parse(fs.readFileSync(styleAbs, 'utf8'));

  const defaults = extractTileOriginDefaults(files);
  const tileOrigin = env.TILE_ORIGIN ?? defaults[0]?.value;
  const archive =
    env.BASEMAP_ARCHIVE ??
    /BASEMAP_ARCHIVE\s*\?\?\s*'([^']+)'/.exec(stripComments(files[APP_CONFIG]))?.[1] ??
    'sharecropr-basemap-202608.pmtiles';
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL || undefined;

  const failures = [];
  failures.push(...checkOrigins({ tileOrigin, supabaseUrl }).map((r) => `config: ${r}`));
  failures.push(...checkConfigDefaults(files).map((r) => `config: ${r}`));
  failures.push(...checkRemoteStyle(files));

  const ctx = { tileOrigin, archive, supabaseUrl };
  const styleUrls = collectUrls(style);
  for (const { at, url } of styleUrls) {
    for (const r of checkUrl(url, ctx)) failures.push(`${stylePath} ${at}: ${url}: ${r}`);
  }
  const source = scanSourceLiterals(files, ctx);
  failures.push(...source.failures);

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`map-egress: ${f}\n`);
    return 1;
  }
  const hosts = [hostOf(tileOrigin), supabaseUrl && hostOf(supabaseUrl)].filter(Boolean);
  process.stdout.write(
    `map-egress: ok — ${styleUrls.length} style URLs + ${source.count} config/source URLs; hosts [${hosts.join(', ')}]; ` +
      'static half of SPEC-008-T74 only (wire capture T78–T80 is not this check)\n',
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
