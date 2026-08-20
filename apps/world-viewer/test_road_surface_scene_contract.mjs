import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneGeometry = readFileSync(new URL('./src/preview1SceneGeometry.mjs', import.meta.url), 'utf8');
const roadGeometry = readFileSync(new URL('./src/roadSurfaceGeometry.mjs', import.meta.url), 'utf8');

assert.match(sceneGeometry, /buildRoadSurfaceGeometry/, 'Preview 1 must consume the connected road surface builder');
assert.match(sceneGeometry, /ROAD_VISUAL_WIDTH_M\s*=\s*3\.2/, 'baseline visual width fallback stays explicit');
assert.match(sceneGeometry, /ROAD_SURFACE_LIFT_M\s*=\s*0\.06/, 'road surface lift remains a small renderer-only anti-z-fighting offset');
assert.match(sceneGeometry, /ROAD_MINIMUM_POINT_SPACING_M\s*=\s*1\.25/, 'measured road renderer sampling guard remains explicit');
assert.match(sceneGeometry, /ROAD_VERTICAL_SEMANTICS\s*=\s*'renderer-only-accepted-dtm-edge-drape'/, 'generic road surface vertical placement must be an explicit DTM presentation fallback');
assert.match(sceneGeometry, /roadEdgeHeightAtLocalXZ/, 'road edges must sample terrain independently rather than sharing centerline height');
assert.match(sceneGeometry, /road_vertical_semantics:\s*roads\.metadata\.edge_height_semantics/, 'runtime stats expose road vertical fallback semantics');
assert.match(sceneGeometry, /road_width_semantics:\s*roads\.metadata\.width_semantics/, 'runtime stats expose fallback width semantics');
assert.match(sceneGeometry, /road_renderer_sampling_semantics:\s*roads\.metadata\.point_spacing_semantics/, 'runtime stats expose renderer-only centerline sampling');
assert.doesNotMatch(sceneGeometry, /sourceZ\s*=\s*Number\(point\?\.\[2\]\)/, 'generic presentation roads must not blindly use source Z until bridge/tunnel semantics are compiled');
assert.doesNotMatch(sceneGeometry, /0\.35/, 'legacy 35 cm road lift must not return');
assert.match(roadGeometry, /width_semantics:\s*'renderer-only-road-type-fallback'/, 'road width never becomes authoritative semantics');
assert.match(roadGeometry, /point_spacing_semantics:\s*'renderer-only-sampling'/, 'render sampling never becomes centerline truth');
assert.match(roadGeometry, /rendererRoadWidthMeters/, 'road classes must have bounded renderer-only width fallbacks');
assert.match(roadGeometry, /surfaceHeightAtLocalXZ/, 'road builder must support per-edge terrain draping');
assert.match(roadGeometry, /cappedLength/, 'road joins must cap miter spikes');
assert.match(roadGeometry, /baseVertex \+ index \* 2/, 'each path remains one connected strip instead of independent segment quads');

console.log('ROAD_SURFACE_SCENE_CONTRACT_PASS');
