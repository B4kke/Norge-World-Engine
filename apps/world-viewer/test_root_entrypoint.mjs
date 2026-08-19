import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const preview1 = readFileSync(new URL('./preview1.html', import.meta.url), 'utf8');
const preview3 = readFileSync(new URL('./preview3.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('./vite.config.mjs', import.meta.url), 'utf8');

assert.match(index, /src\/main\.ts/, 'root index.html must load the accepted single-tile ground viewer');
assert.doesNotMatch(index, /src\/preview3Entry\.ts/, 'root must not use the deferred 3x3 candidate viewer');
assert.match(index, /Walkable Nannestad/, 'root metadata must identify the active ground-level milestone');
assert.match(preview1, /src\/main\.ts/, 'Preview 1 must remain explicitly available');
assert.match(preview3, /src\/preview3Entry\.ts/, 'Preview 3 must remain available as a deferred multi-tile evidence surface');
assert.match(viteConfig, /preview1:\s*resolve\(import\.meta\.dirname, 'preview1\.html'\)/, 'Vite must publish preview1.html');
assert.match(viteConfig, /preview3:\s*resolve\(import\.meta\.dirname, 'preview3\.html'\)/, 'Vite must publish preview3.html');

console.log('ROOT_ENTRYPOINT_GROUND_PASS');
