// SPEC-008-T74 (static half: R74, R78, R79, R80) · SPEC-008-T81 · NOT T78–T80 (wire)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  checkConfigDefaults,
  checkRemoteStyle,
  checkSourceLiterals,
  checkUrl,
} from './ci-map-egress.mjs';

const FIX = 'scripts/fixtures/map-egress';
const cli = (args = [], envOverride = {}) => {
  const env = { ...process.env, ...envOverride };
  if (!('TILE_ORIGIN' in envOverride)) delete env.TILE_ORIGIN;
  if (!('EXPO_PUBLIC_SUPABASE_URL' in envOverride)) delete env.EXPO_PUBLIC_SUPABASE_URL;
  return spawnSync(process.execPath, ['scripts/ci-map-egress.mjs', ...args], { encoding: 'utf8', env });
};
const expectFail = (r, ...patterns) => {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const p of patterns) assert.match(r.stderr, p);
};

test('E-1 the real repo passes (SPEC-008-T74)', () => {
  const r = cli();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^map-egress: ok —/);
});

test('E-2 tiles on a public OSM host fail, naming host and R79 (SPEC-008-T81)', () => {
  expectFail(cli([`${FIX}/bad-tile-host.json`]), /tile\.openstreetmap\.org/, /R79/);
});

test('E-3 glyphs on a third-party host fail (R79)', () => {
  expectFail(cli([`${FIX}/bad-glyph-host.json`]), /demotiles\.maplibre\.org/, /R79/);
});

test('E-4 a credential query parameter fails (R78)', () => {
  expectFail(cli([`${FIX}/credential-query.json`]), /R78/);
});

test('E-5 userinfo in a URL fails (R78)', () => {
  expectFail(cli([`${FIX}/userinfo.json`]), /R78/);
});

test('E-6 a bbox/coordinate template token fails (R80)', () => {
  expectFail(cli([`${FIX}/coord-template.json`]), /R80/);
});

test('E-7 a coordinate-shaped literal fails (R80)', () => {
  expectFail(cli([`${FIX}/coord-literal.json`]), /R80/);
});

test('E-8 a non-https scheme fails (R78)', () => {
  expectFail(cli([`${FIX}/http-scheme.json`]), /R78/);
});

test('E-9 the known-good fixture passes', () => {
  const r = cli([`${FIX}/ok-style.json`]);
  assert.equal(r.status, 0, r.stderr);
});

test('E-10 a tile origin that Sharecropr does not control fails (T81 via config)', () => {
  expectFail(cli([], { TILE_ORIGIN: 'https://tiles.example.com' }), /not Sharecropr-controlled/);
});

test('E-11 the Supabase host is allowed only when configured (R79 two-entry allowlist)', () => {
  const url = 'https://abcd.supabase.co/storage/v1/x.pmtiles';
  const base = { tileOrigin: 'https://tiles.staging.sharecropr.com', archive: 'a.pmtiles' };
  assert.ok(checkUrl(url, base).length > 0);
  assert.deepEqual(checkUrl(url, { ...base, supabaseUrl: 'https://abcd.supabase.co' }), []);
});

test('E-12 disagreeing config defaults fail', () => {
  const failures = checkConfigDefaults({
    'app.config.ts': "const TILE_ORIGIN = process.env.TILE_ORIGIN ?? 'https://a.sharecropr.com';",
    'src/features/map/config/basemap.ts': "const o = extra.tileOrigin ?? 'https://b.sharecropr.com';",
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /defaults disagree/);
});

test('E-13 a style from a remote value fails (T74)', () => {
  assert.ok(
    checkRemoteStyle({ 'src/features/map/screens/X.tsx': '<MapCanvas styleUrl="https://x" />' }).length > 0,
  );
  assert.ok(checkRemoteStyle({ 'src/features/map/screens/Y.tsx': '<Map mapStyle={remote} />' }).length > 0);
});

test('E-14 a third-party host literal in map source fails (R79)', () => {
  const failures = checkSourceLiterals({
    'src/features/map/lib/x.ts': "const u = 'https://api.mapbox.com/v4'",
  });
  assert.ok(failures.length > 0);
});
