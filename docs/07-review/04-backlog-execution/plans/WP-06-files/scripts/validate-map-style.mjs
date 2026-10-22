#!/usr/bin/env node
// ci:validate-map-style — CI/CD §4.1 `map-style`, TC-GEO-48, SPEC-008-R74 (static half).
// SCRUM-24: also guards that the spike style keeps its label/POI/sprite/glyph complexity.
//
// 1. The template names only {{TILE_ORIGIN}} for tiles, sprite and glyphs, and never "latest".
// 2. The archive it resolves to is one dated archive (sharecropr-basemap-YYYYMM.pmtiles).
// 3. The resolved style validates against the MapLibre style spec that
//    @maplibre/maplibre-react-native itself ships (pinned to the same version).
// 4. Style complexity floor for the EPIC-01 spike: >=1 symbol layer with icon-image,
//    >=2 distinct text-font stacks, source-layers from the Protomaps basemap schema only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

const root = fileURLToPath(new URL('..', import.meta.url));
const STYLE_PATH = 'src/features/map/style/sharecropr-basemap.json';
const DATED_ARCHIVE = /^sharecropr-basemap-\d{6}\.pmtiles$/; // matches scripts/tile-build.sh
// Protomaps basemap tileset layers (@protomaps/basemaps v5 / tiles v4).
const PROTOMAPS_LAYERS = new Set([
  'boundaries', 'buildings', 'earth', 'landcover', 'landuse', 'places', 'pois', 'roads', 'transit', 'water',
]);

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => readFileSync(`${root}${rel}`, 'utf8');

const raw = read(STYLE_PATH);
if (/latest/i.test(raw)) fail(`${STYLE_PATH}: contains "latest" — name one dated archive (CI/CD §4.1)`);
const template = JSON.parse(raw);

// --- 1. hosts --------------------------------------------------------------
const ORIGIN = '{{TILE_ORIGIN}}/';
if (!template.glyphs?.startsWith(ORIGIN)) fail(`glyphs must start with ${ORIGIN}`);
if (!template.glyphs?.includes('{fontstack}') || !template.glyphs?.includes('{range}')) {
  fail('glyphs must contain {fontstack} and {range}');
}
if (!template.sprite || typeof template.sprite !== 'string' || !template.sprite.startsWith(ORIGIN)) {
  fail(`sprite must be a single URL starting with ${ORIGIN}`);
}
for (const [id, source] of Object.entries(template.sources ?? {})) {
  const urls = [source.url, ...(source.tiles ?? [])].filter(Boolean);
  for (const url of urls) {
    if (!url.startsWith(`pmtiles://${ORIGIN}`) && !url.startsWith(ORIGIN)) {
      fail(`source "${id}": ${url} is not on {{TILE_ORIGIN}}`);
    }
  }
}
if (template.sources?.basemap?.url !== 'pmtiles://{{TILE_ORIGIN}}/{{BASEMAP_ARCHIVE}}') {
  fail('sources.basemap.url must be pmtiles://{{TILE_ORIGIN}}/{{BASEMAP_ARCHIVE}}');
}

// --- 2. dated archive ------------------------------------------------------
function defaultFrom(rel, pattern) {
  const m = read(rel).match(pattern);
  if (!m) fail(`${rel}: could not find the default basemap archive`);
  return m?.[1];
}
const configDefault = defaultFrom('app.config.ts', /BASEMAP_ARCHIVE\s*\?\?\s*'([^']+)'/);
const clientDefault = defaultFrom('src/features/map/config/basemap.ts', /basemapArchive\s*\?\?\s*'([^']+)'/);
if (configDefault !== clientDefault) {
  fail(`archive defaults disagree: app.config.ts=${configDefault} basemap.ts=${clientDefault}`);
}
const archive = process.env.BASEMAP_ARCHIVE ?? configDefault;
if (!DATED_ARCHIVE.test(archive ?? '')) {
  fail(`archive "${archive}" is not a dated archive (sharecropr-basemap-YYYYMM.pmtiles)`);
}
const tileOrigin = process.env.TILE_ORIGIN ?? 'https://tiles.staging.sharecropr.com';
if (!tileOrigin.startsWith('https://')) fail(`TILE_ORIGIN must be https: ${tileOrigin}`);

// --- 3. spec validation on the resolved style -------------------------------
const resolved = JSON.parse(
  raw.replaceAll('{{TILE_ORIGIN}}', tileOrigin).replaceAll('{{BASEMAP_ARCHIVE}}', archive ?? ''),
);
for (const e of validateStyleMin(resolved)) fail(`style-spec: ${e.message}`);

// --- 4. spike complexity floor (SCRUM-24) -----------------------------------
const layers = template.layers ?? [];
const fontStacks = new Set();
const collectFonts = (v) => {
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') && !/^[a-z-]+$/.test(v[0])) {
    fontStacks.add(v.join(','));
  } else if (Array.isArray(v)) v.forEach(collectFonts);
};
for (const layer of layers) {
  if (layer['source-layer'] && !PROTOMAPS_LAYERS.has(layer['source-layer'])) {
    fail(`layer "${layer.id}": source-layer "${layer['source-layer']}" is not in the Protomaps schema`);
  }
  if (layer.layout?.['text-font']) collectFonts(layer.layout['text-font']);
}
const iconLayers = layers.filter((l) => l.type === 'symbol' && l.layout?.['icon-image']);
if (iconLayers.length < 1) fail('no symbol layer uses icon-image from the sprite');
if (fontStacks.size < 2) fail(`only ${fontStacks.size} glyph stack(s); the spike needs >= 2`);

if (failures.length) {
  for (const f of failures) console.error(`map-style: ${f}`);
  process.exit(1);
}
console.log(
  `map-style: ok — ${layers.length} layers, ${iconLayers.length} sprite-icon layers, ` +
    `${fontStacks.size} glyph stacks [${[...fontStacks].join(' | ')}], archive ${archive}`,
);
