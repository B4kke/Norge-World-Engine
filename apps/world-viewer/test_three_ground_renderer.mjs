import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('./src/threeGroundRenderer.mjs', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./src/preview1Renderer.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

assert.equal(packageJson.dependencies.three, '0.185.0', 'Three.js version must be pinned');
assert.match(renderer, /from 'three\/webgpu'/, 'ground renderer must use the Three WebGPU-capable build');
assert.match(renderer, /new THREE\.WebGPURenderer/, 'ground renderer must instantiate Three WebGPURenderer');
assert.match(renderer, /forceWebGL/, 'ground renderer must retain an explicit WebGL2 fallback/baseline path');
assert.match(renderer, /new THREE\.BufferGeometry/, 'verified terrain buffers must become Three BufferGeometry');
assert.match(renderer, /new THREE\.MeshStandardMaterial/, 'ground renderer must use a real lit material path rather than raw debug shaders');
assert.match(renderer, /camera\.position\.set\(0, centerGround \+ 1\.7, 14\)/, 'camera must start at human eye height over sampled ground');
assert.match(renderer, /renderer_adapter:\s*'three-ground\/0\.1'/, 'runtime stats must identify the Three renderer adapter');
assert.match(renderer, /three_revision:\s*THREE\.REVISION/, 'runtime stats must expose the exact Three revision');
assert.match(renderer, /camera_eye_height_m:\s*1\.7/, 'runtime stats must expose the human-scale eye height');
assert.match(renderer, /getTerrainResourceLifecycle/, 'adapter must preserve terrain resource lifecycle integration');
assert.match(adapter, /createThreeGroundRenderer/, 'Preview 1 renderer boundary must route through Three.js');
assert.doesNotMatch(renderer, /kartverket|nvdb|overpass|openstreetmap/i, 'renderer must not gain raw-source knowledge');

console.log('THREE_GROUND_RENDERER_STRUCTURE_PASS');
