import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneGeometry = readFileSync(new URL('./src/preview1SceneGeometry.mjs', import.meta.url), 'utf8');
const roadGeometry = readFileSync(new URL('./src/roadSurfaceGeometry.mjs', import.meta.url), 'utf8');

assert.match(sceneGeometry, /buildRoadSurfaceGeometry/, 'Preview 1 must consume the connected road surface builder');
assert.match(sceneGeometry, /ROAD_VISUAL_WIDTH_M\s*=\s*3\.2/, 'visual width fallback must stay explicit');
assert.match(sceneGeometry, /ROAD_SURFACE_LIFT_M\s*=\s*0\.06/, 'road surface lift must remain a small renderer-only anti-z-fighting offset');
assert.match(sceneGeometry, /road_width_semantics:\s*roads\.metadata\.width_semantics/, 'runtime stats must expose road width semantics');
assert.doesNotMatch(sceneGeometry, /0\.35/, 'legacy 35 cm road lift must not return');

// Width truth boundary: today's accepted artifact has no width, so the normal path
// remains the explicit renderer-only fallback. A later compiler may attach an
// explicit physical width field; only then may the renderer report that individual
// path as source-backed. The renderer must never infer source truth from road_type.
assert.match(roadGeometry, /'renderer-only-fallback'/, 'renderer-only width fallback must remain explicit');
assert.match(roadGeometry, /path\?\.width_m\s*\?\?\s*path\?\.physical_width_m\s*\?\?\s*path\?\.surface_width_m/, 'source-backed width requires an explicit compiled width field');
assert.match(roadGeometry, /source-backed-when-present-otherwise-renderer-fallback/, 'mixed width semantics must distinguish explicit source width from fallback');
assert.doesNotMatch(roadGeometry, /road_type[^\n]*width|rendererRoadWidthMeters/, 'road type must not be promoted to physical width truth');

assert.match(roadGeometry, /cappedLength/, 'road joins must cap miter spikes');
assert.match(roadGeometry, /baseVertex \+ index \* 2/, 'each path must form one connected strip instead of independent segment quads');
assert.match(roadGeometry, /renderer-stable-up-normal/, 'road surface must expose stable presentation normals');
assert.match(roadGeometry, /per-triangle-counter-clockwise-upward/, 'road triangles must expose upward winding semantics');

console.log('ROAD_SURFACE_SCENE_CONTRACT_PASS');
