import assert from 'node:assert/strict';
import { buildSyntheticVegetationPlacement } from './src/vegetationPlacement.mjs';

function flatTerrain() {
  const width = 100;
  const height = 100;
  return {
    elevations: new Float32Array(width * height).fill(100),
    artifact: { header: { width, height, bounds: [0, 0, 100, 100], pixel_size_m: 1, nodata: null } },
    mesh: { metadata: { origin: [50, 50, 100] } },
  };
}

const roadsArtifact = {
  paths: [
    { points: [[50, 0, 100], [50, 100, 100]] },
  ],
};
const buildingsArtifact = {
  features: [
    { polygon: [[70, 70], [80, 70], [80, 80], [70, 80], [70, 70]], height_m: 8 },
  ],
};
const options = {
  terrainPayload: flatTerrain(),
  roadsArtifact,
  buildingsArtifact,
  origin: { e: 50, n: 50, h: 100 },
  gridSpacingMeters: 10,
  occupancy: 1,
  roadClearanceMeters: 8,
  buildingClearanceMeters: 6,
  spawnClearanceMeters: 10,
  seed: 12345,
};

const first = buildSyntheticVegetationPlacement(options);
const second = buildSyntheticVegetationPlacement(options);
assert.equal(first.schema, 'nwe.synthetic-vegetation-placement/0.1');
assert.equal(first.metadata.authority, 'renderer-only-synthetic');
assert.equal(first.metadata.future_replacement, 'source-backed-vegetation-mask-or-compiled-placement-artifact');
assert(first.count > 15, `expected useful synthetic vegetation density, got ${first.count}`);
assert.deepEqual(Array.from(first.positions), Array.from(second.positions), 'placement must be deterministic');
assert.deepEqual(Array.from(first.heights), Array.from(second.heights), 'height variation must be deterministic');
assert.deepEqual(Array.from(first.yaws), Array.from(second.yaws), 'yaw variation must be deterministic');
assert.deepEqual(Array.from(first.species), Array.from(second.species), 'species mix must be deterministic');
assert.equal(first.metadata.conifer_count + first.metadata.broadleaf_count, first.count);
assert(first.metadata.conifer_count > 0 && first.metadata.broadleaf_count > 0, 'both preview species classes should be represented');
assert(first.metadata.rejected.road > 0, 'road clearance must reject candidates');
assert(first.metadata.rejected.building > 0, 'building clearance must reject candidates');
assert(first.metadata.rejected.spawn > 0, 'spawn clearing must reject candidates');

for (let index = 0; index < first.count; index += 1) {
  const offset = index * 3;
  const easting = options.origin.e + first.positions[offset];
  const northing = options.origin.n - first.positions[offset + 2];
  const localY = first.positions[offset + 1];
  assert(Number.isFinite(easting) && Number.isFinite(northing) && Number.isFinite(localY));
  assert(Math.abs(easting - 50) > options.roadClearanceMeters - 1e-6, `tree entered road clearance at E${easting} N${northing}`);
  const insideExpandedBuilding = easting >= 64 && easting <= 86 && northing >= 64 && northing <= 86;
  if (insideExpandedBuilding) {
    const dx = Math.max(70 - easting, 0, easting - 80);
    const dy = Math.max(70 - northing, 0, northing - 80);
    assert(Math.hypot(dx, dy) > options.buildingClearanceMeters - 1e-6, `tree entered building clearance at E${easting} N${northing}`);
  }
  assert(Math.hypot(easting - 50, northing - 50) >= options.spawnClearanceMeters - 1e-6, 'tree entered spawn clearing');
  assert(first.heights[index] >= 7 && first.heights[index] <= 18, 'tree height must remain within bounded preview range');
}

console.log(JSON.stringify({
  status: 'VEGETATION_PLACEMENT_PASS',
  count: first.count,
  conifers: first.metadata.conifer_count,
  broadleaves: first.metadata.broadleaf_count,
  rejected: first.metadata.rejected,
}));
