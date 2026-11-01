import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGroundPostProcessing } from './src/threeGroundPostProcessing.mjs';

let directRenders = 0;
const direct = createGroundPostProcessing({
  renderer: { render() { directRenders += 1; } },
  scene: {},
  camera: {},
  profile: { id: 'balanced', ambientOcclusion: false, bloom: false },
});
assert.equal(direct.stats.enabled, false);
direct.render();
assert.equal(directRenders, 1);

const source = readFileSync(new URL('./src/threeGroundPostProcessing.mjs', import.meta.url), 'utf8');
assert.match(source, /new THREE\.RenderPipeline/, 'post effects must use the WebGPURenderer RenderPipeline');
assert.match(source, /ao\(scenePass\.getTextureNode\('depth'\), null, camera\)/, 'GTAO must reconstruct normals from the depth pass');
assert.match(source, /mix\(float\(1\)/, 'GTAO must be strength-bounded rather than fully multiplying the scene');
assert.match(source, /bloomThreshold/, 'bloom must expose a profile threshold');
console.log('THREE_GROUND_POST_PROCESSING_PASS');
