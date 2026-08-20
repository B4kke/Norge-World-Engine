import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneGeometry = readFileSync(new URL('./src/preview1SceneGeometry.mjs', import.meta.url), 'utf8');
const roadGeometry = readFileSync(new URL('./src/roadSurfaceGeometry.mjs', import.meta.url), 'utf8');

assert.match(sceneGeometry, /buildRoadSurfaceGeometry/, 'Preview 1 must consume the road surface builder');
assert.match(sceneGeometry, /ROAD_VISUAL_WIDTH_M\s*=\s*3\.2/, 'baseline visual width fallback stays explicit');
assert.match(sceneGeometry, /ROAD_SURFACE_LIFT_M\s*=\s*0\.06/, 'road surface lift remains a small renderer-only anti-z-fighting offset');
assert.match(sceneGeometry, /ROAD_MINIMUM_POINT_SPACING_M\s*=\s*0/, 'safe bevel tessellation must keep non-duplicate source points by default');
assert.match(sceneGeometry, /ROAD_VERTICAL_SEMANTICS\s*=\s*'renderer-only-accepted-dtm-edge-drape'/, 'generic road surface vertical placement remains an explicit DTM presentation fallback');
assert.match(sceneGeometry, /ROAD_TILE_EDGE_HEIGHT_SEMANTICS\s*=\s*'renderer-only-clamp-height-sample-to-accepted-dtm-bounds'/, 'tile-edge road draping must remain explicitly renderer-only');
assert.match(sceneGeometry, /roadEdgeHeightAtLocalXZ/, 'road edges sample terrain independently rather than sharing centerline height');
assert.match(sceneGeometry, /Math\.max\(minE, Math\.min\(maxE, requestedEasting\)\)/, 'road-edge height sampling must clamp only the DTM lookup at the tile boundary');
assert.match(sceneGeometry, /Math\.max\(minN, Math\.min\(maxN, requestedNorthing\)\)/, 'road-edge height sampling must clamp northing at the accepted terrain boundary');
assert.match(sceneGeometry, /road_join_strategy:\s*roads\.metadata\.join_strategy/, 'runtime stats expose the safe tessellation policy');
assert.match(sceneGeometry, /road_vertical_semantics:\s*roads\.metadata\.edge_height_semantics/, 'runtime stats expose road vertical fallback semantics');
assert.match(sceneGeometry, /road_tile_edge_height_semantics:\s*ROAD_TILE_EDGE_HEIGHT_SEMANTICS/, 'runtime stats expose the tile-edge height fallback');
assert.match(sceneGeometry, /road_width_semantics:\s*roads\.metadata\.width_semantics/, 'runtime stats expose fallback width semantics');
assert.match(sceneGeometry, /road_renderer_sampling_semantics:\s*roads\.metadata\.point_spacing_semantics/, 'runtime stats expose source-point vs optional renderer sampling semantics');
assert.doesNotMatch(sceneGeometry, /sourceZ\s*=\s*Number\(point\?\.\[2\]\)/, 'generic presentation roads must not blindly use source Z until bridge/tunnel semantics are compiled');
assert.doesNotMatch(sceneGeometry, /0\.35/, 'legacy 35 cm road lift must not return');
assert.match(roadGeometry, /width_semantics:\s*'renderer-only-road-type-fallback'/, 'road width never becomes authoritative semantics');
assert.match(roadGeometry, /join_strategy:\s*'nonoverlap-inner-intersection-bevel'/, 'road joins must use the bow-tie- and z-fight-resistant non-overlap bevel strategy');
assert.match(roadGeometry, /overlap_policy:\s*'no-intentional-segment-overlap'/, 'road builder must explicitly prohibit the previous overlapping join coverage');
assert.match(roadGeometry, /lineIntersectionXZ/, 'inner road boundaries must meet at offset-line intersections');
assert.match(roadGeometry, /innerFallback/, 'extreme turns need a bounded no-spike fallback without overlapping rectangles');
assert.match(roadGeometry, /rendererRoadWidthMeters/, 'road classes have bounded renderer-only width fallbacks');
assert.match(roadGeometry, /surfaceHeightAtLocalXZ/, 'road builder supports per-edge terrain draping');
assert.doesNotMatch(roadGeometry, /cappedLength|joinOffset/, 'fragile shared miter strip must not return');

console.log('ROAD_SURFACE_SCENE_CONTRACT_PASS');
