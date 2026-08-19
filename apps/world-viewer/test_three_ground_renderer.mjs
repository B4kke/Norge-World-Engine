import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('./src/threeGroundRenderer.mjs', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./src/preview1Renderer.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

assert.equal(packageJson.dependencies.three, '0.185.0', 'Three.js version must be pinned');
assert.match(renderer, /from 'three\/webgpu'/, 'ground renderer must use the Three WebGPU-capable build');
assert.match(renderer, /new THREE\.WebGPURenderer/, 'ground renderer must instantiate Three WebGPURenderer');
assert.match(renderer, /forceWebGL/, 'ground renderer must retain an explicit WebGL2 fallback\/baseline path');
assert.match(renderer, /new THREE\.BufferGeometry/, 'verified terrain buffers must become Three BufferGeometry');
assert.match(renderer, /geometry\.setAttribute\('normal'/, 'worker-provided terrain normals must reach Three geometry');
assert.match(renderer, /geometry\.setAttribute\('uv'/, 'worker-provided terrain UVs must reach Three geometry');
assert.match(renderer, /geometry\.setAttribute\('color'/, 'renderer-only macro variation must use a dedicated vertex color attribute');
assert.match(renderer, /new THREE\.DataTexture/, 'walking-distance terrain detail must be generated without external source textures');
assert.match(renderer, /THREE\.RepeatWrapping/, 'terrain detail texture must repeat across normalized tile UVs');
assert.match(renderer, /TERRAIN_DETAIL_PERIOD_M\s*=\s*5/, 'terrain detail scale must be explicitly meter-based');
assert.match(renderer, /new THREE\.MeshStandardMaterial/, 'ground renderer must use a real lit PBR-compatible material path');
assert.match(renderer, /roughnessMap:\s*terrainSurfaceTexture/, 'terrain must carry roughness variation');
assert.match(renderer, /bumpMap:\s*terrainSurfaceTexture/, 'terrain must carry lighting-responsive walking-distance bump detail');
assert.match(renderer, /vertexColors:\s*true/, 'terrain material must consume renderer-only macro variation');
assert.match(renderer, /geometry_displacement:\s*false/, 'terrain styling must explicitly preserve accepted DTM geometry');
assert.doesNotMatch(renderer, /displacementMap\s*:/, 'renderer must not visually displace accepted DTM geometry');
assert.match(renderer, /draw_calls_per_frame:\s*4/, 'terrain material pass must not add draw calls');
assert.match(renderer, /camera\.position\.set\(0, centerGround \+ 1\.7, 14\)/, 'camera must start at human eye height over sampled ground');
assert.match(renderer, /renderer_adapter:\s*'three-ground\/0\.1'/, 'runtime stats must identify the Three renderer adapter');
assert.match(renderer, /terrain_material:\s*\{/, 'runtime stats must expose terrain material evidence');
assert.match(renderer, /getTerrainResourceLifecycle/, 'adapter must preserve terrain resource lifecycle integration');
assert.match(adapter, /createThreeGroundRenderer/, 'Preview 1 renderer boundary must route through Three.js');
assert.doesNotMatch(renderer, /kartverket|nvdb|overpass|openstreetmap/i, 'renderer must not gain raw-source knowledge');

console.log('THREE_GROUND_RENDERER_STRUCTURE_PASS');
