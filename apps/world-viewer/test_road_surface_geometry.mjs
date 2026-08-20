import assert from 'node:assert/strict';
import { buildRoadSurfaceGeometry, rendererRoadWidthMeters } from './src/roadSurfaceGeometry.mjs';

const identityProject = (point) => [Number(point[0]), Number(point[2] ?? 0), Number(point[1])];

function assertUpwardWinding(geometry) {
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const vertices = [geometry.indices[offset], geometry.indices[offset + 1], geometry.indices[offset + 2]].map((index) => [
      geometry.positions[index * 3],
      geometry.positions[index * 3 + 1],
      geometry.positions[index * 3 + 2],
    ]);
    const abx = vertices[1][0] - vertices[0][0];
    const abz = vertices[1][2] - vertices[0][2];
    const acx = vertices[2][0] - vertices[0][0];
    const acz = vertices[2][2] - vertices[0][2];
    const normalY = abz * acx - abx * acz;
    assert.ok(normalY > 0, `road triangle ${offset / 3} must face upward, got normalY=${normalY}`);
  }
}

const corner = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 10], [10, 0, 10], [10, 10, 10]] }],
}, { projectPoint: identityProject, widthMeters: 4, uvPeriodMeters: 5 });

assert.equal(corner.metadata.path_count, 1);
assert.equal(corner.metadata.segment_count, 2);
assert.equal(corner.metadata.join_strategy, 'nonoverlap-inner-intersection-bevel');
assert.equal(corner.metadata.overlap_policy, 'no-intentional-segment-overlap');
assert.equal(corner.metadata.join_triangle_count, 1);
assert.equal(corner.metadata.join_inner_fallback_count, 0);
assert.equal(corner.metadata.width_semantics, 'renderer-only-road-type-fallback');
assert.deepEqual(corner.metadata.width_range_m, [4, 4]);
assert.equal(corner.metadata.edge_height_semantics, 'projected-centerline');
assert.equal(corner.metadata.point_spacing_semantics, 'source-points-after-exact-duplicate-filter');
assert.equal(corner.metadata.minimum_point_spacing_m, 0);
assert.equal(corner.metadata.removed_sample_count, 0);
assert.equal(corner.metadata.winding, 'counter-clockwise-upward');
assert.equal(corner.positions.length / 3, 11, 'two trimmed segment quads plus one isolated three-vertex bevel triangle are emitted');
assert.equal(corner.indices.length, 15, 'two non-overlapping quads plus one outside bevel triangle are emitted');
assert.equal(corner.uvs.length, 22);
assert.deepEqual(Array.from(corner.indices.slice(0, 12)), [0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7], 'segment quads stay independently addressable but meet through the inner join point');
assertUpwardWinding(corner);

// At a left turn, the left/inner endpoints of incoming + outgoing segments must meet
// at the same offset-line intersection; the previous overlapping-rectangle strategy
// left different inner endpoints and caused coplanar overlap/z-fighting.
const incomingLeftEnd = [corner.positions[2 * 3], corner.positions[2 * 3 + 2]];
const outgoingLeftStart = [corner.positions[4 * 3], corner.positions[4 * 3 + 2]];
assert.deepEqual(incomingLeftEnd, outgoingLeftStart, 'inner road boundary must be shared geometrically across the bevel join');

const draped = buildRoadSurfaceGeometry({
  paths: [{ road_type: 'Enkel bilveg', points: [[0, 0, 99], [10, 0, 99]] }],
}, {
  projectPoint: ([x, z]) => [x, 50, z],
  surfaceHeightAtLocalXZ: (x, z) => 4 + x * 0.1 + z * 0.2,
  edgeHeightSemantics: 'renderer-only-accepted-dtm-edge-drape',
});
assert.equal(draped.metadata.edge_height_semantics, 'renderer-only-accepted-dtm-edge-drape');
assert.deepEqual(draped.metadata.width_range_m, [4.6, 4.6], 'Enkel bilveg gets an explicit renderer-only visual width');
assert.notEqual(draped.positions[1], 50, 'edge drape replaces projected centerline height');
assert.notEqual(draped.positions[1], draped.positions[4], 'cross-slope road edges may have distinct terrain heights');
assertUpwardWinding(draped);

assert.equal(rendererRoadWidthMeters({ road_type: 'Fortau' }), 1.8);
assert.equal(rendererRoadWidthMeters({ road_type: 'Gang- og sykkelveg' }), 3.0);
assert.equal(rendererRoadWidthMeters({ road_type: 'Gangveg' }), 2.4);
assert.equal(rendererRoadWidthMeters({ road_type: 'Enkel bilveg' }), 4.6);
assert.equal(rendererRoadWidthMeters({ road_type: 'unknown' }), 3.2);

const separate = buildRoadSurfaceGeometry({
  paths: [
    { points: [[0, 0, 1], [2, 0, 1]] },
    { points: [[100, 100, 2], [102, 100, 2]] },
  ],
}, { projectPoint: identityProject });
assert.equal(separate.metadata.path_count, 2);
assert.equal(separate.metadata.segment_count, 2);
assert.equal(separate.positions.length / 3, 8);
assert.deepEqual(Array.from(separate.indices), [0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7], 'distinct NVDB paths must not be bridged');
assertUpwardWinding(separate);

const deduped = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 0], [0, 0, 0], [5, 0, 0]] }],
}, { projectPoint: identityProject });
assert.equal(deduped.metadata.segment_count, 1, 'exact duplicate centerline points must not create zero-length surface segments');
assert.equal(deduped.metadata.source_point_count, 3);
assert.equal(deduped.metadata.sampled_point_count, 2);
assert.equal(deduped.positions.length / 3, 4);
assertUpwardWinding(deduped);

const dense = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 0], [0.4, 0, 0], [0.8, 0, 0], [1.2, 0, 0], [3, 0, 0]] }],
}, { projectPoint: identityProject });
assert.equal(dense.metadata.source_point_count, 5);
assert.equal(dense.metadata.sampled_point_count, 5, 'safe tessellation keeps non-duplicate source samples by default');
assert.equal(dense.metadata.removed_sample_count, 0);
assert.equal(dense.metadata.segment_count, 4);
assertUpwardWinding(dense);

const explicitlySampled = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 0], [0.4, 0, 0], [0.8, 0, 0], [1.2, 0, 0], [3, 0, 0]] }],
}, { projectPoint: identityProject, minimumPointSpacingMeters: 1.25 });
assert.equal(explicitlySampled.metadata.sampled_point_count, 2);
assert.equal(explicitlySampled.metadata.removed_sample_count, 3);
assert.equal(explicitlySampled.metadata.point_spacing_semantics, 'renderer-only-sampling');
assertUpwardWinding(explicitlySampled);

assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, widthMeters: 0 }), /widthMeters/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, minimumPointSpacingMeters: -1 }), /minimumPointSpacingMeters/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, innerJoinLimit: 0.5 }), /innerJoinLimit/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, {}), /projectPoint/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, surfaceHeightAtLocalXZ: 1 }), /surfaceHeightAtLocalXZ/);

console.log('ROAD_SURFACE_GEOMETRY_PASS');
