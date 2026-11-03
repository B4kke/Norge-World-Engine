import assert from 'node:assert/strict';
import { buildForgeVegetationPlacement } from './src/forgeVegetationPlacement.mjs';

const width = 100;
const height = 100;
const elevations = new Float32Array(width * height).fill(100);
const terrainPayload = {
  elevations,
  artifact: {
    header: {
      tile_id: 'test',
      width,
      height,
      bounds: [0, 0, 100, 100],
      pixel_size_m: 1,
      nodata: null,
    },
  },
  mesh: { metadata: { origin: [50, 50, 100] } },
};

const artifact = {
  schema: 'nwe.vegetation-representative-artifact/0.1-candidate',
  tile_id: 'test',
  segments: [
    { tree_class: 1, tree_class_label: 'spruce-dominated', mean_height_m: 12, canopy_cover_percent: 72 },
  ],
  instances: [
    { id: 'accepted', segment_index: 0, easting_m: 20, northing_m: 80, yaw_rad: 0.4, represented_tree_weight: 30 },
    { id: 'road', segment_index: 0, easting_m: 20, northing_m: 20, yaw_rad: 0.2, represented_tree_weight: 20 },
    { id: 'building', segment_index: 0, easting_m: 80, northing_m: 80, yaw_rad: 0.1, represented_tree_weight: 10 },
    { id: 'spawn', segment_index: 0, easting_m: 50, northing_m: 50, yaw_rad: 0, represented_tree_weight: 5 },
  ],
};
const roadsArtifact = { paths: [{ points: [[20, 15], [20, 25]] }] };
const buildingsArtifact = {
  features: [{ polygon: [[76, 76], [84, 76], [84, 84], [76, 84], [76, 76]] }],
};

const placement = buildForgeVegetationPlacement({ artifact, terrainPayload, roadsArtifact, buildingsArtifact });
assert.equal(placement.schema, 'nwe.web-vegetation-placement/0.1');
assert.equal(placement.stats.source_representative_count, 4);
assert.equal(placement.stats.visible_representative_count, 1);
assert.equal(placement.stats.represented_tree_weight_visible, 30);
assert.equal(placement.stats.rejection_counts.road_clearance, 1);
assert.equal(placement.stats.rejection_counts.building_clearance, 1);
assert.equal(placement.stats.rejection_counts.spawn_clearance, 1);
assert.equal(placement.instances[0].id, 'accepted');
assert.equal(placement.instances[0].species_group, 'spruce');
assert.equal(placement.instances[0].visual_height_m, 12);
assert.deepEqual(Array.from(placement.instances[0].local_position), [-30, 0, -30]);
assert.match(placement.instances[0].position_semantics, /representative/);
assert.match(placement.stats.placement_semantics, /not observed individual-tree/);

console.log('FORGE_VEGETATION_PLACEMENT_PASS');
