// Map feature unit tests (node:test). Loads every scripts/map-tests/*.test.mjs.
// Run: node --experimental-strip-types scripts/map-tests.mjs
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'map-tests');
for (const name of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(join(dir, name)).href);
}
