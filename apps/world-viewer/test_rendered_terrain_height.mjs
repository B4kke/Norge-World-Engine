import assert from 'node:assert/strict';
import { sampleRenderedTerrainY } from './src/renderedTerrainHeight.mjs';

// Same corner order and diagonal split as the actual road-terrain draper.
// NW=0, NE=0, SW=0, SE=4. This is NOT bilinear interpolation.
const mesh = { positions: new Float32Array([
  0, 0, 0, 1, 0, 0,
  0, 0, 1, 1, 4, 1,
]) };
assert.equal(sampleRenderedTerrainY(mesh, 0.25, 0.25), 0);
assert.ok(Math.abs(sampleRenderedTerrainY(mesh, 0.8, 0.8) - 2.4) < 1e-6);
assert.equal(sampleRenderedTerrainY(mesh, 1, 1), 4);
assert.equal(sampleRenderedTerrainY(mesh, 0, 0), 0);
assert.equal(sampleRenderedTerrainY(mesh, -0.01, 0.5), null);
assert.equal(sampleRenderedTerrainY(mesh, 0.5, 1.01), null);
assert.equal(sampleRenderedTerrainY(null, 0.5, 0.5), null);
assert.equal(sampleRenderedTerrainY({ positions: new Float32Array([0, 0, 0]) }, 0, 0), null);
console.log('RENDERED_TERRAIN_TRIANGLE_HEIGHT_PASS');
