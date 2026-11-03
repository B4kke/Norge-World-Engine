import assert from 'node:assert/strict';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const identityProject = (point) => [Number(point[0]), Number(point[2] ?? 0), Number(point[1])];

function triangleNormalY(geometry, offset) {
  const [ia, ib, ic] = Array.from(geometry.indices.slice(offset, offset + 3));
  const a = [geometry.positions[ia * 3], geometry.positions[ia * 3 + 2]];
  const b = [geometry.positions[ib * 3], geometry.positions[ib * 3 + 2]];
  const c = [geometry.positions[ic * 3], geometry.positions[ic * 3 + 2]];
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
}

function assertAllTrianglesUpward(geometry) {
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    assert.ok(triangleNormalY(geometry, offset) > 0, `triangle ${offset / 3} must face +Y`);
  }
  for (let offset = 0; offset < geometry.normals.length; offset += 3) {
    assert.deepEqual(Array.from(geometry.normals.slice(offset, offset + 3)), [0, 1, 0]);
  }
}

const corner = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 10], [10, 0, 10], [10, 10, 10]] }],
}, { projectPoint: identityProject, widthMeters: 4, miterLimit: 2, uvPeriodMeters: 5 });

assert.equal(corner.metadata.path_count, 1);
assert.equal(corner.metadata.segment_count, 2);
assert.equal(corner.metadata.width_semantics, 'renderer-only-fallback');
assert.equal(corner.metadata.normal_semantics, 'renderer-stable-up-normal');
assert.equal(corner.metadata.winding, 'per-triangle-counter-clockwise-upward');
assert.equal(corner.positions.length / 3, 6, 'one shared left/right pair must be emitted per centerline point');
assert.equal(corner.indices.length, 12, 'two connected surface quads must emit four triangles');
assert.equal(corner.uvs.length, 12);
assertAllTrianglesUpward(corner);

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
assert.ok(Array.from(separate.indices.slice(0, 6)).every((index) => index < 4), 'first NVDB path must use only its own vertex range');
assert.ok(Array.from(separate.indices.slice(6)).every((index) => index >= 4), 'second NVDB path must use only its own vertex range');
assertAllTrianglesUpward(separate);

const sourceWidth = buildRoadSurfaceGeometry({
  paths: [{ width_m: 6.4, points: [[0, 0, 0], [10, 0, 0]] }],
}, { projectPoint: identityProject });
assert.equal(sourceWidth.metadata.source_width_path_count, 1);
assert.equal(sourceWidth.metadata.fallback_width_path_count, 0);
assert.deepEqual(sourceWidth.metadata.width_range_m, [6.4, 6.4]);
assert.equal(sourceWidth.metadata.width_semantics, 'source-backed-when-present-otherwise-renderer-fallback');

const deduped = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 0], [0, 0, 0], [5, 0, 0]] }],
}, { projectPoint: identityProject });
assert.equal(deduped.metadata.segment_count, 1, 'duplicate centerline points must not create zero-length surface segments');
assert.equal(deduped.positions.length / 3, 4);
assertAllTrianglesUpward(deduped);

assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, widthMeters: 0 }), /widthMeters/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, {}), /projectPoint/);

console.log('ROAD_SURFACE_GEOMETRY_PASS');
