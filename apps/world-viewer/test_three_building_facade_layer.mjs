import assert from 'node:assert/strict';
import { createThreeBuildingFacadeLayer } from './src/threeBuildingFacadeLayer.mjs';

const terrainPayload = {
  artifact: {
    header: {
      tile_id: 'epsg25832_611000_6677000_1000m',
      width: 2,
      height: 2,
      bounds: [0, 0, 10, 10],
      pixel_size_m: 5,
      nodata: null,
    },
  },
  elevations: new Float32Array([100, 100, 100, 100]),
  mesh: { metadata: { origin: [5, 5, 100] } },
};

const buildingsArtifact = {
  features: [
    {
      source_id: 1,
      building: 'house',
      height_m: 6.5,
      height_semantics: 'derived-nhm-dom-minus-dtm-p90-presentation',
      presentation_roof_shape: 'gabled',
      presentation_gable_rise_m: 1.4,
      polygon: [[1, 1], [9, 1], [9, 7], [1, 7], [1, 1]],
    },
  ],
};

const layer = createThreeBuildingFacadeLayer({
  buildingsArtifact,
  terrainPayload,
  profile: { id: 'high' },
});
assert.equal(layer.stats.schema, 'nwe.three-building-facade-layer/0.1');
assert.equal(layer.stats.source_building_count, 1);
assert.ok(layer.stats.rendered_window_count > 0);
assert.equal(layer.stats.rendered_door_count, 1);
assert.equal(layer.stats.draw_calls, 2);
assert.match(layer.stats.semantics, /renderer-only/);
assert.match(layer.stats.truth_guard, /not source-backed/);
assert.equal(layer.root.children.length, 2);
for (const child of layer.root.children) assert.equal(child.isInstancedMesh, true);
layer.dispose();
assert.equal(layer.root.parent, null);
console.log('three building facade layer regression passed');
