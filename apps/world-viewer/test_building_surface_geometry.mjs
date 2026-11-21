import assert from 'node:assert/strict';
import { buildBuildingSurfaceGeometry } from './src/buildingSurfaceGeometry.mjs';
import { buildingPresentationPalette, hexToLinearRgb } from './src/buildingPresentationPalette.mjs';

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


const development = [
  { source_id: 'house-a', building: 'house', height_m: 7.5, presentation_roof_shape: 'gabled',
    polygon: [[0, 0], [14, 0], [14, 8], [0, 8], [0, 0]] },
  { source_id: 'house-b', building: 'house', height_m: 7.1, presentation_roof_shape: 'gabled',
    polygon: [[30, 0], [44, 0], [44, 8], [30, 8], [30, 0]] },
  { source_id: 'barn-c', building: 'barn', height_m: 9, presentation_roof_shape: 'gabled',
    polygon: [[60, 0], [82, 0], [82, 10], [60, 10], [60, 0]] },
  { source_id: 'warehouse-d', building: 'warehouse', height_m: 8.3, presentation_roof_shape: 'flat',
    polygon: [[100, 0], [116, 0], [116, 12], [100, 12], [100, 0]] },
];
const varied = buildBuildingSurfaceGeometry({ features: development }, {
  resolved: true, projectPoint: ([x, z]) => [x, 20, z],
});
const reversed = buildBuildingSurfaceGeometry({ features: [...development].reverse() }, {
  resolved: true, projectPoint: ([x, z]) => [x, 20, z],
});
assert.equal(varied.count, 4);
assert.equal(varied.metadata.presentation_building_families.residential, 2);
assert.equal(varied.metadata.presentation_building_families.agricultural, 1);
assert.equal(varied.metadata.presentation_building_families.commercial, 1);
assert.equal(varied.metadata.presentation_roof_types.fallback_visual_gable, 3);
assert.equal(varied.metadata.presentation_roof_types.flat_presentation, 1);
assert.ok(varied.metadata.distinct_wall_palette_keys >= 3, 'different buildings should have several stable presentation wall materials');
assert.ok(varied.metadata.distinct_roof_palette_keys >= 2);
assert.equal(varied.walls.colors.length, varied.walls.positions.length);
assert.equal(varied.roofs.colors.length, varied.roofs.positions.length);
assert.equal(varied.colors.length, varied.positions.length);
assert.equal(reversed.walls.colors.length, varied.walls.colors.length);
assert.match(varied.metadata.vertex_color_semantics, /per-source-id/);
for (const feature of development) {
  const a = buildingPresentationPalette(feature);
  const b = buildingPresentationPalette({ ...feature, polygon: [...feature.polygon].reverse() });
  assert.equal(a.wall_hex, b.wall_hex, 'material keyed by stable ID, not footprint winding');
  assert.equal(a.roof_hex, b.roof_hex);
  assert.deepEqual(a.wall_rgb_linear, hexToLinearRgb(a.wall_hex));
  assert.ok(a.wall_rgb_linear.every((n) => n > 0 && n <= 1));
}
const knownGable = buildBuildingSurfaceGeometry({
  features: [{ ...development[0], presentation_gable_direction_deg_from_east_ccw: 0, presentation_gable_rise_m: 2 }],
}, { resolved: true, projectPoint: ([x, z]) => [x, 20, z] });
assert.equal(knownGable.metadata.presentation_roof_types.dom_oriented_gable, 1);
const notRectangular = buildBuildingSurfaceGeometry({
  features: [{ ...development[0], polygon: [[0, 0], [14, 0], [12, 8], [0, 8], [0, 0]] }],
}, { resolved: true, projectPoint: ([x, z]) => [x, 20, z] });
assert.equal(notRectangular.metadata.presentation_roof_types.fallback_visual_gable, 0,
  'non-rectangular unknown roof geometry must not invent a gable');

console.log('BUILDING_SURFACE_GEOMETRY_PASS');
