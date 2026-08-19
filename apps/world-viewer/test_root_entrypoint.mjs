import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const preview1 = readFileSync(new URL('./preview1.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('./vite.config.mjs', import.meta.url), 'utf8');

assert.match(index, /src\/preview3Entry\.ts/, 'root index.html must load Preview 3');
assert.doesNotMatch(index, /src\/main\.ts/, 'root index.html must not silently fall back to Preview 1');
assert.match(preview1, /src\/main\.ts/, 'Preview 1 must remain explicitly available');
assert.match(viteConfig, /preview1:\s*resolve\(import\.meta\.dirname, 'preview1\.html'\)/, 'Vite must publish preview1.html');
assert.match(viteConfig, /preview3:\s*resolve\(import\.meta\.dirname, 'preview3\.html'\)/, 'Vite must publish preview3.html');

console.log('ROOT_ENTRYPOINT_PREVIEW3_PASS');
