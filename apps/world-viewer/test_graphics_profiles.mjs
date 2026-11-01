import assert from 'node:assert/strict';
import {
  GRAPHICS_PROFILE_IDS,
  RENDERER_PREFERENCES,
  resolveGraphicsProfile,
  resolveRendererPreference,
} from './src/graphicsProfiles.mjs';

assert.deepEqual(GRAPHICS_PROFILE_IDS, ['low', 'balanced', 'high', 'ultra']);
assert.deepEqual(RENDERER_PREFERENCES, ['auto', 'webgpu', 'webgl2']);

const low = resolveGraphicsProfile('low');
const balanced = resolveGraphicsProfile('balanced');
const high = resolveGraphicsProfile('high');
const ultra = resolveGraphicsProfile('ultra');

assert.equal(low.terrainOutputSize, 65);
assert.equal(balanced.terrainOutputSize, 129);
assert.equal(high.terrainOutputSize, 257);
assert.equal(ultra.terrainOutputSize, 513);
assert.ok(low.maxDpr < balanced.maxDpr && balanced.maxDpr < high.maxDpr && high.maxDpr < ultra.maxDpr);
assert.equal(low.msaaSamples, 1);
assert.equal(high.msaaSamples, 4);
assert.ok(low.vegetationBudget < balanced.vegetationBudget && balanced.vegetationBudget < high.vegetationBudget && high.vegetationBudget < ultra.vegetationBudget);
assert.ok(low.textureAnisotropy < balanced.textureAnisotropy && balanced.textureAnisotropy < high.textureAnisotropy && high.textureAnisotropy < ultra.textureAnisotropy);
assert.equal(low.normalMaps, false);
assert.equal(high.ambientOcclusion, true);
assert.equal(high.bloom, true);
assert.equal(ultra.shadowMapSize, 4096);
assert.equal(ultra.ambientOcclusionSamples, 16);
assert.equal(resolveGraphicsProfile('garbage').id, 'balanced');
assert.equal(resolveRendererPreference('webgpu'), 'webgpu');
assert.equal(resolveRendererPreference('webgl2'), 'webgl2');
assert.equal(resolveRendererPreference('garbage'), 'auto');

console.log(JSON.stringify({
  status: 'PASS',
  profiles: GRAPHICS_PROFILE_IDS,
  renderers: RENDERER_PREFERENCES,
  terrain_output_sizes: GRAPHICS_PROFILE_IDS.map((id) => resolveGraphicsProfile(id).terrainOutputSize),
}));
