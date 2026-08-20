import assert from 'node:assert/strict';
import { buildBuildingSurfaceGeometry, rendererFallbackBuildingHeightMeters } from './src/buildingSurfaceGeometry.mjs';

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
  features: [{ polygon: concaveFootprint, height_m: 7.5, height_source: 'source', building: 'civic' }],
}, {
  resolved: true,
  projectPoint: ([x, z]) => [x, 10 + x * 0.1, z],
  groundLiftMeters: 0.08,
});

assert.equal(sourceBacked.count, 1);
assert.equal(sourceBacked.metadata.height_semantics, 'source-backed-envelope');
assert.equal(sourceBacked.metadata.source_backed_height_count, 1);
assert.equal(sourceBacked.metadata.fallback_height_count, 0);
assert.equal(sourceBacked.metadata.roof_triangulation, 'three-earcut-flat-or-bounded-quad-gable');
assert.equal(sourceBacked.metadata.foundation_semantics, 'renderer-only-level-pad-min-accepted-dtm');
assert.equal(sourceBacked.metadata.roof_morphology_semantics, 'renderer-only-type-and-footprint-heuristic');
assert.equal(sourceBacked.metadata.gable_roof_count, 0, 'concave civic footprint must remain polygon-safe flat roof');
assert.equal(sourceBacked.metadata.flat_roof_count, 1);
assert.equal(sourceBacked.metadata.uv_semantics, 'renderer-only-meter-scaled');
assert.equal(sourceBacked.metadata.wall_uv_period_m, 2);
assert.equal(sourceBacked.metadata.roof_uv_period_m, 1.5);
assert.equal(sourceBacked.metadata.roof_vertices, 6);
assert.equal(sourceBacked.metadata.roof_triangles, 4, 'simple six-vertex footprint must triangulate to n-2 roof triangles');
assert.equal(sourceBacked.metadata.wall_triangles, 12, 'six footprint edges must emit two wall triangles each');
assert.equal(sourceBacked.walls.uvs.length, (sourceBacked.walls.positions.length / 3) * 2, 'every wall vertex needs a UV');
assert.equal(sourceBacked.roofs.uvs.length, (sourceBacked.roofs.positions.length / 3) * 2, 'every roof vertex needs a UV');
assert.equal(sourceBacked.uvs.length, (sourceBacked.positions.length / 3) * 2, 'combined compatibility geometry needs matching UVs');
for (const uv of sourceBacked.uvs) assert.ok(Number.isFinite(uv), 'building UVs must remain finite');
for (const centroid of roofTriangleCentroids(sourceBacked)) {
  assert.ok(pointInPolygon(centroid, concaveFootprint.slice(0, -1)), `roof triangle centroid escaped footprint: ${centroid}`);
}
const flatRoofY = [];
for (let index = 1; index < sourceBacked.roofs.positions.length; index += 3) flatRoofY.push(sourceBacked.roofs.positions[index]);
assert.ok(flatRoofY.every((value) => Math.abs(value - flatRoofY[0]) < 1e-5), 'rigid building roof must stay level even when sampled DTM varies across footprint');
assert.ok(Math.abs(flatRoofY[0] - 17.58) < 1e-5, 'source-backed envelope height is preserved above the level minimum-DTM foundation');
assert.equal(sourceBacked.indices.length, sourceBacked.walls.indices.length + sourceBacked.roofs.indices.length, 'combined compatibility geometry contains wall + roof indices');

const house = buildBuildingSurfaceGeometry({
  features: [{
    building: 'house',
    clipped: false,
    polygon: [[0, 0], [12, 0], [12, 8], [0, 8], [0, 0]],
    height_m: null,
  }],
}, {
  resolved: false,
  projectPoint: ([x, z]) => [x, 2 + z * 0.05, z],
  groundLiftMeters: 0,
});
assert.equal(rendererFallbackBuildingHeightMeters({ building: 'house' }), 6.5);
assert.equal(rendererFallbackBuildingHeightMeters({ building: 'garage' }), 3.2);
assert.equal(rendererFallbackBuildingHeightMeters({ building: 'barn' }), 7.5);
assert.equal(house.metadata.height_semantics, 'renderer-only-building-type-fallback');
assert.equal(house.metadata.fallback_height_policy, 'renderer-only-building-type-heuristic');
assert.deepEqual(house.metadata.fallback_height_range_m, [6.5, 6.5]);
assert.equal(house.metadata.gable_roof_count, 1, 'simple house quad gets bounded renderer-only gable morphology');
assert.equal(house.metadata.flat_roof_count, 0);
assert.equal(house.metadata.roof_triangles, 4, 'gable roof is two quads / four triangles');
assert.ok(house.metadata.wall_triangles > 8, 'gable end triangles are included with wall material');
roofTriangleCentroids(house);
const houseRoofHeights = [];
for (let index = 1; index < house.roofs.positions.length; index += 3) houseRoofHeights.push(house.roofs.positions[index]);
assert.ok(Math.max(...houseRoofHeights) > Math.min(...houseRoofHeights) + 0.4, 'gable roof must have a visible ridge');
assert.ok(Math.max(...houseRoofHeights) <= 2 + 6.5 + 1e-5, 'renderer gable stays inside the 6.5 m fallback envelope above level foundation');

const fallback = buildBuildingSurfaceGeometry({
  features: [{ building: 'unknown', polygon: [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]], height_m: null }],
}, {
  resolved: false,
  projectPoint: ([x, z]) => [x, 2, z],
  fallbackHeightMeters: 5,
  groundLiftMeters: 0,
});
assert.equal(fallback.count, 1);
assert.equal(fallback.metadata.fallback_height_m, 5);
assert.equal(fallback.metadata.fallback_height_count, 1);
assert.equal(fallback.metadata.source_backed_height_count, 0);
assert.equal(fallback.metadata.flat_roof_count, 1);
for (let index = 1; index < fallback.roofs.positions.length; index += 3) {
  assert.equal(fallback.roofs.positions[index], 7, 'unknown fallback roof uses explicit baseline renderer-only height');
}

assert.throws(() => buildBuildingSurfaceGeometry({}, { resolved: true }), /projectPoint/);
assert.throws(() => buildBuildingSurfaceGeometry({}, { projectPoint: () => [0, 0, 0] }), /resolved/);
assert.throws(() => buildBuildingSurfaceGeometry({}, { projectPoint: () => [0, 0, 0], resolved: true, wallUvPeriodMeters: 0 }), /wallUvPeriodMeters/);
assert.throws(() => buildBuildingSurfaceGeometry({}, { projectPoint: () => [0, 0, 0], resolved: true, roofUvPeriodMeters: 0 }), /roofUvPeriodMeters/);

console.log('BUILDING_SURFACE_GEOMETRY_PASS');
