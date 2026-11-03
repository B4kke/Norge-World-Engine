import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const sceneGeometry = readFileSync(new URL('./src/preview1SceneGeometry.mjs', import.meta.url), 'utf8');
const roadGeometry = readFileSync(new URL('./src/roadSurfaceGeometry.mjs', import.meta.url), 'utf8');

assert.match(sceneGeometry, /buildRoadSurfaceGeometry/, 'Preview 1 must consume the connected road surface builder');
assert.match(sceneGeometry, /ROAD_VISUAL_WIDTH_M\s*=\s*3\.2/, 'visual width fallback must stay explicit');
assert.match(sceneGeometry, /ROAD_SURFACE_LIFT_M\s*=\s*0\.06/, 'road surface lift must remain a small renderer-only anti-z-fighting offset');
assert.match(sceneGeometry, /road_width_semantics:\s*roads\.metadata\.width_semantics/, 'runtime stats must expose width semantics');
assert.doesNotMatch(sceneGeometry, /0\.35/, 'legacy 35 cm road lift must not return');
assert.match(roadGeometry, /path\?\.width_m \?\? path\?\.physical_width_m \?\? path\?\.surface_width_m/, 'only explicit compiled width fields may replace the renderer fallback');
assert.match(roadGeometry, /'renderer-only-fallback'/, 'fallback semantics must remain explicit');
assert.match(roadGeometry, /'source-backed-when-present-otherwise-renderer-fallback'/, 'mixed source/fallback semantics must remain explicit');
assert.match(roadGeometry, /cappedLength/, 'road joins must cap miter spikes');
assert.match(roadGeometry, /baseVertex \+ index \* 2/, 'each path must form one connected strip instead of independent segment quads');

const identityProject = ([x, z, y = 0]) => [Number(x), Number(y), Number(z)];
const fallbackOnly = buildRoadSurfaceGeometry({ paths: [{ points: [[0, 0, 0], [5, 0, 0]] }] }, { projectPoint: identityProject });
assert.equal(fallbackOnly.metadata.width_semantics, 'renderer-only-fallback');
assert.equal(fallbackOnly.metadata.source_width_path_count, 0);
assert.equal(fallbackOnly.metadata.fallback_width_path_count, 1);

const mixed = buildRoadSurfaceGeometry({
  paths: [
    { width_m: 6.2, points: [[0, 0, 0], [5, 0, 0]] },
    { points: [[10, 0, 0], [15, 0, 0]] },
  ],
}, { projectPoint: identityProject });
assert.equal(mixed.metadata.width_semantics, 'source-backed-when-present-otherwise-renderer-fallback');
assert.equal(mixed.metadata.source_width_path_count, 1);
assert.equal(mixed.metadata.fallback_width_path_count, 1);
assert.deepEqual(mixed.metadata.width_range_m, [3.2, 6.2]);

console.log('ROAD_SURFACE_SCENE_CONTRACT_PASS');
