import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneGeometry = readFileSync(new URL('./src/preview1SceneGeometry.mjs', import.meta.url), 'utf8');
const roadGeometry = readFileSync(new URL('./src/roadSurfaceGeometry.mjs', import.meta.url), 'utf8');

assert.match(sceneGeometry, /buildRoadSurfaceGeometry/, 'Preview 1 must consume the connected road surface builder');
assert.match(sceneGeometry, /ROAD_VISUAL_WIDTH_M\s*=\s*3\.2/, 'visual width fallback must stay explicit');
assert.match(sceneGeometry, /ROAD_SURFACE_LIFT_M\s*=\s*0\.06/, 'road surface lift must remain a small renderer-only anti-z-fighting offset');
assert.match(sceneGeometry, /road_width_semantics:\s*roads\.metadata\.width_semantics/, 'runtime stats must expose fallback width semantics');
assert.doesNotMatch(sceneGeometry, /0\.35/, 'legacy 35 cm road lift must not return');
assert.match(roadGeometry, /width_semantics:\s*'renderer-only-fallback'/, 'road width must never be promoted to authoritative semantics');
assert.match(roadGeometry, /cappedLength/, 'road joins must cap miter spikes');
assert.match(roadGeometry, /baseVertex \+ index \* 2/, 'each path must form one connected strip instead of independent segment quads');

console.log('ROAD_SURFACE_SCENE_CONTRACT_PASS');
