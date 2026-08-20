import assert from 'node:assert/strict';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const identityProject = (point) => [Number(point[0]), Number(point[2] ?? 0), Number(point[1])];

function triangleNormalY(geometry, offset) {
  const [ia, ib, ic] = [geometry.indices[offset], geometry.indices[offset + 1], geometry.indices[offset + 2]];
  const ax = geometry.positions[ia * 3]; const az = geometry.positions[ia * 3 + 2];
  const bx = geometry.positions[ib * 3]; const bz = geometry.positions[ib * 3 + 2];
  const cx = geometry.positions[ic * 3]; const cz = geometry.positions[ic * 3 + 2];
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

function assertStableRoadSurface(geometry) {
  assert.equal(geometry.normals.length, geometry.positions.length, 'road normals cover every vertex');
  for (let index = 0; index < geometry.normals.length; index += 3) {
    assert.deepEqual(Array.from(geometry.normals.slice(index, index + 3)), [0, 1, 0], 'road normals remain stable +Y');
  }
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    assert.ok(triangleNormalY(geometry, offset) > 0, `triangle ${offset / 3} must face +Y`);
  }
}

const corner = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 10], [10, 0, 10], [10, 10, 10]] }],
}, { projectPoint: identityProject, widthMeters: 4, miterLimit: 1.5, uvPeriodMeters: 5 });
assert.equal(corner.metadata.path_count, 1);
assert.equal(corner.metadata.segment_count, 2);
assert.equal(corner.metadata.width_semantics, 'renderer-only-fallback');
assert.equal(corner.metadata.normal_semantics, 'renderer-stable-up-normal');
assert.equal(corner.metadata.winding, 'per-triangle-counter-clockwise-upward');
assert.equal(corner.positions.length / 3, 6);
assert.equal(corner.indices.length, 12);
assert.equal(corner.uvs.length, 12);
assert.equal(corner.metadata.skipped_degenerate_triangles, 0);
assertStableRoadSurface(corner);

const sourceWidth = buildRoadSurfaceGeometry({
  paths: [{ width_m: 6.4, points: [[0, 0, 0], [10, 0, 0]] }],
}, { projectPoint: identityProject, widthMeters: 3.2 });
assert.equal(sourceWidth.metadata.source_width_path_count, 1);
assert.equal(sourceWidth.metadata.fallback_width_path_count, 0);
assert.deepEqual(sourceWidth.metadata.width_range_m, [6.4, 6.4]);
assert.equal(sourceWidth.metadata.width_semantics, 'source-backed-when-present-otherwise-renderer-fallback');
assertStableRoadSurface(sourceWidth);

const separate = buildRoadSurfaceGeometry({
  paths: [
    { points: [[0, 0, 1], [2, 0, 1]] },
    { points: [[100, 100, 2], [102, 100, 2]] },
  ],
}, { projectPoint: identityProject });
assert.equal(separate.metadata.path_count, 2);
assert.equal(separate.metadata.segment_count, 2);
assert.equal(separate.positions.length / 3, 8);
assertStableRoadSurface(separate);

const deduped = buildRoadSurfaceGeometry({
  paths: [{ points: [[0, 0, 0], [0, 0, 0], [5, 0, 0]] }],
}, { projectPoint: identityProject });
assert.equal(deduped.metadata.segment_count, 1);
assert.equal(deduped.positions.length / 3, 4);
assertStableRoadSurface(deduped);

assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, { projectPoint: identityProject, widthMeters: 0 }), /widthMeters/);
assert.throws(() => buildRoadSurfaceGeometry({ paths: [] }, {}), /projectPoint/);

console.log('ROAD_SURFACE_GEOMETRY_PASS');
