import assert from 'node:assert/strict';
import { buildBuildingSurfaceGeometry } from './src/buildingSurfaceGeometry.mjs';

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function roofTriangleCentroids(geometry) {
  const output = [];
  const positions = geometry.roofs.positions;
  const indices = geometry.roofs.indices;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const points = [indices[offset], indices[offset + 1], indices[offset + 2]].map((index) => [
      positions[index * 3],
      positions[index * 3 + 1],
      positions[index * 3 + 2],
    ]);
    output.push([
      (points[0][0] + points[1][0] + points[2][0]) / 3,
      (points[0][2] + points[1][2] + points[2][2]) / 3,
    ]);
    const abx = points[1][0] - points[0][0];
    const abz = points[1][2] - points[0][2];
    const acx = points[2][0] - points[0][0];
    const acz = points[2][2] - points[0][2];
    const normalY = abz * acx - abx * acz;
    assert.ok(normalY > 0, 'roof triangle winding must face upward');
  }
  return output;
}

const concaveFootprint = [
  [0, 0],
  [6, 0],
  [6, 2],
  [2, 2],
  [2, 6],
  [0, 6],
  [0, 0],
];

const sourceBacked = buildBuildingSurfaceGeometry({
  features: [{ polygon: concaveFootprint, height_m: 7.5, height_source: 'source' }],
}, {
  resolved: true,
  projectPoint: ([x, z]) => [x, 10, z],
  groundLiftMeters: 0.08,
});

assert.equal(sourceBacked.count, 1);
assert.equal(sourceBacked.metadata.height_semantics, 'source-backed');
assert.equal(sourceBacked.metadata.source_backed_height_count, 1);
assert.equal(sourceBacked.metadata.fallback_height_count, 0);
assert.equal(sourceBacked.metadata.roof_triangulation, 'three-earcut-2d-footprint');
assert.equal(sourceBacked.metadata.roof_vertices, 6);
assert.equal(sourceBacked.metadata.roof_triangles, 4, 'simple six-vertex footprint must triangulate to n-2 roof triangles');
assert.equal(sourceBacked.metadata.wall_triangles, 12, 'six footprint edges must emit two wall triangles each');
assert.equal(sourceBacked.metadata.uv_semantics, 'renderer-only-meter-scaled-surface-uv');
assert.equal(sourceBacked.metadata.uv_tile_m, 4);
assert.equal(sourceBacked.walls.uvs.length, (sourceBacked.walls.positions.length / 3) * 2);
assert.equal(sourceBacked.roofs.uvs.length, (sourceBacked.roofs.positions.length / 3) * 2);
assert.ok(Math.max(...sourceBacked.walls.uvs) > 1, 'meter-scaled wall UVs must repeat instead of stretching one texel set over a building');
for (const centroid of roofTriangleCentroids(sourceBacked)) {
  assert.ok(pointInPolygon(centroid, concaveFootprint.slice(0, -1)), `roof triangle centroid escaped footprint: ${centroid}`);
}
for (let index = 1; index < sourceBacked.roofs.positions.length; index += 3) {
  assert.ok(Math.abs(sourceBacked.roofs.positions[index] - 17.58) < 1e-5, 'roof height must preserve source-backed height plus renderer ground lift');
}
assert.equal(
  sourceBacked.indices.length,
  sourceBacked.walls.indices.length + sourceBacked.roofs.indices.length,
  'combined compatibility geometry must contain exactly wall + roof indices',
);
assert.equal(sourceBacked.uvs.length, (sourceBacked.positions.length / 3) * 2, 'combined compatibility geometry must retain UV0');

const fallback = buildBuildingSurfaceGeometry({
  features: [{ polygon: [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]], height_m: null }],
}, {
  resolved: false,
  projectPoint: ([x, z]) => [x, 2, z],
  fallbackHeightMeters: 5,
  groundLiftMeters: 0,
});
assert.equal(fallback.count, 1);
assert.equal(fallback.metadata.height_semantics, 'renderer-only-fallback');
assert.equal(fallback.metadata.fallback_height_m, 5);
assert.equal(fallback.metadata.fallback_height_count, 1);
assert.equal(fallback.metadata.source_backed_height_count, 0);
for (let index = 1; index < fallback.roofs.positions.length; index += 3) {
  assert.equal(fallback.roofs.positions[index], 7, 'fallback roof must use explicit renderer-only fallback height');
}

assert.throws(() => buildBuildingSurfaceGeometry({}, { resolved: true }), /projectPoint/);
assert.throws(() => buildBuildingSurfaceGeometry({}, { projectPoint: () => [0, 0, 0] }), /resolved/);

console.log('BUILDING_SURFACE_GEOMETRY_PASS');
