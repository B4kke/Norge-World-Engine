import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneGeometry = readFileSync(new URL('./src/preview1SceneGeometry.mjs', import.meta.url), 'utf8');
const roadGeometry = readFileSync(new URL('./src/roadSurfaceGeometry.mjs', import.meta.url), 'utf8');

assert.match(sceneGeometry, /buildRoadSurfaceGeometry/, 'Preview 1 must consume the road surface builder');
assert.match(sceneGeometry, /ROAD_VISUAL_WIDTH_M\s*=\s*3\.2/, 'baseline visual width fallback stays explicit until physical width is compiled');
assert.match(sceneGeometry, /ROAD_SURFACE_LIFT_M\s*=\s*0\.10/, 'road surface lift remains a small renderer-only anti-z-fighting offset');
assert.match(sceneGeometry, /ROAD_MINIMUM_POINT_SPACING_M\s*=\s*0/, 'safe bevel tessellation must keep non-duplicate source points by default');
assert.match(sceneGeometry, /ROAD_VERTICAL_SEMANTICS\s*=\s*'renderer-only-level-cross-section-from-accepted-dtm-centerline'/, 'road vertical fallback must follow accepted DTM longitudinally without reproducing raw terrain as asphalt crossfall');
assert.match(sceneGeometry, /levelRoadCrossSectionHeight/, 'road cross-sections must use the projected DTM-backed centerline station height');
assert.match(sceneGeometry, /const centerY = Number\(context\?\.center\?\.\[1\]\)/, 'road cross-section height must derive from the active segment endpoint centerline station');
assert.doesNotMatch(sceneGeometry, /roadEdgeHeightAtLocalXZ/, 'active Preview 1 must not independently DTM-drape left and right road edges');
assert.doesNotMatch(sceneGeometry, /ROAD_TILE_EDGE_HEIGHT_SEMANTICS/, 'obsolete edge-clamp semantics must not survive the level cross-section pass');
assert.match(sceneGeometry, /road_join_strategy:\s*roads\.metadata\.join_strategy/, 'runtime stats expose the safe tessellation policy');
assert.match(sceneGeometry, /road_vertical_semantics:\s*roads\.metadata\.edge_height_semantics/, 'runtime stats expose road vertical fallback semantics');
assert.match(sceneGeometry, /road_width_semantics:\s*roads\.metadata\.width_semantics/, 'runtime stats expose fallback width semantics');
assert.match(sceneGeometry, /road_renderer_sampling_semantics:\s*roads\.metadata\.point_spacing_semantics/, 'runtime stats expose source-point vs optional renderer sampling semantics');
assert.doesNotMatch(sceneGeometry, /sourceZ\s*=\s*Number\(point\?\.\[2\]\)/, 'generic presentation roads must not blindly use source Z until bridge/tunnel semantics are compiled');
assert.doesNotMatch(sceneGeometry, /0\.35/, 'legacy 35 cm road lift must not return');
assert.match(roadGeometry, /width_semantics:\s*'renderer-only-road-type-fallback'/, 'road width must remain explicitly non-authoritative until physical width data is compiled');
assert.match(roadGeometry, /join_strategy:\s*'nonoverlap-inner-intersection-bevel'/, 'road joins must use the bow-tie- and z-fight-resistant non-overlap bevel strategy');
assert.match(roadGeometry, /overlap_policy:\s*'no-intentional-segment-overlap'/, 'road builder must explicitly prohibit the previous overlapping join coverage');
assert.match(roadGeometry, /lineIntersectionXZ/, 'inner road boundaries must meet at offset-line intersections');
assert.match(roadGeometry, /innerFallback/, 'extreme turns need a bounded no-spike fallback without overlapping rectangles');
assert.match(roadGeometry, /rendererRoadWidthMeters/, 'road classes retain bounded temporary renderer-only width fallbacks');
assert.match(roadGeometry, /surfaceHeightAtLocalXZ/, 'road builder retains an explicit vertical-policy callback rather than hard-coding world truth');
assert.doesNotMatch(roadGeometry, /cappedLength|joinOffset/, 'fragile shared miter strip must not return');

console.log('ROAD_SURFACE_SCENE_CONTRACT_PASS');
