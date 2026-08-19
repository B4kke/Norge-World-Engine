import assert from 'node:assert/strict';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const identityProject = (point) => [Number(point[0]), Number(point[2] ?? 0), Number(point[1])];

const corner = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 10], [10, 0, 10], [10, 10, 10]] }],
}, { projectPoint: identityProject, widthMeters: 4, miterLimit: 2, uvPeriodMeters: 5 });

assert.equal(corner.metadata.path_count, 1);
assert.equal(corner.metadata.segment_count, 2);
assert.equal(corner.metadata.width_semantics, 'renderer-only-fallback');
assert.equal(corner.positions.length / 3, 6, 'one shared left/right pair must be emitted per centerline point');
assert.equal(corner.indices.length, 12, 'two connected surface quads must emit four triangles');
assert.equal(corner.uvs.length, 12);
assert.deepEqual(Array.from(corner.indices), [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);

const joinLeft = [corner.positions[6], corner.positions[8]];
const joinRight = [corner.positions[9], corner.positions[11]];
assert.ok(Math.hypot(joinLeft[0] - 10, joinLeft[1]) <= 4.0001, 'miter must remain capped');
assert.ok(Math.hypot(joinRight[0] - 10, joinRight[1]) <= 4.0001, 'opposite miter must remain capped');
assert.equal(corner.positions[7], 10, 'surface must preserve projected centerline height');
assert.equal(corner.positions[10], 10, 'both road edges must share projected centerline height');

const separate = buildRoadSurfaceGeometry({
  paths: [
    { points: [[0, 0, 1], [2, 0, 1]] },
    { points: [[100, 100, 2], [102, 100, 2]] },
  ],
}, { projectPoint: identityProject });
assert.equal(separate.metadata.path_count, 2);
assert.equal(separate.metadata.segment_count, 2);
assert.equal(separate.positions.length / 3, 8);
assert.deepEqual(Array.from(separate.indices), [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6], 'distinct NVDB paths must not be bridged');

const deduped = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 0], [0, 0, 0], [5, 0, 0]] }],
}, { projectPoint: identityProject });
assert.equal(deduped.metadata.segment_count, 1, 'duplicate centerline points must not create zero-length surface segments');
assert.equal(deduped.positions.length / 3, 4);

assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, widthMeters: 0 }), /widthMeters/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, {}), /projectPoint/);

console.log('ROAD_SURFACE_GEOMETRY_PASS');
