import assert from 'node:assert/strict';
import { createThreeStreetDetailLayer } from './src/threeStreetDetailLayer.mjs';

const terrainPayload = {
  artifact: {
    header: {
      tile_id: 'epsg25832_611000_6677000_1000m',
      width: 2,
      height: 2,
      bounds: [0, 0, 2, 2],
      pixel_size_m: 1,
      nodata: null,
    },
  },
  elevations: new Float32Array([100, 100, 100, 100]),
  mesh: { metadata: { origin: [1, 1, 100] } },
};

const artifact = {
  schema: 'nwe.nvdb-street-detail-artifact/0.1-candidate',
  tile_id: terrainPayload.artifact.header.tile_id,
  horizontal_crs: 'EPSG:25832',
  features: [
    {
      source_type_id: 99,
      source_type_name: 'Vegoppmerking, langsgående',
      source_object_id: 1,
      part_index: 0,
      geometry_type: 'line',
      points: [[0.4, 0.4], [1.6, 0.4]],
      properties: { Farge: 'Hvit', Type: 'Kantlinje, heltrukken', 'Bredde, enkeltlinje': 0.12 },
    },
    {
      source_type_id: 95,
      source_type_name: 'Skiltpunkt',
      source_object_id: 2,
      part_index: 0,
      geometry_type: 'point',
      point: [0.6, 1.4],
      properties: { Oppsettingsutstyr: 'Stolpe' },
    },
    {
      source_type_id: 181,
      source_type_name: 'Lysmast',
      source_object_id: 3,
      part_index: 0,
      geometry_type: 'point',
      point: [1.4, 1.4],
      properties: { Type: 'Stålmast, konisk' },
    },
  ],
  stats: {
    feature_part_count: 3,
    feature_parts_by_type_id: { '99': 1, '95': 1, '181': 1 },
  },
};

const layer = createThreeStreetDetailLayer({ artifact, terrainPayload, profile: { id: 'high' } });
assert.equal(layer.stats.schema, 'nwe.three-street-detail-layer/0.1');
assert.equal(layer.stats.source_feature_part_count, 3);
assert.equal(layer.stats.source_width_marking_parts, 1);
assert.equal(layer.stats.renderer_fallback_width_marking_parts, 0);
assert.equal(layer.stats.sign_point_count, 1);
assert.equal(layer.stats.source_light_mast_count, 1);
assert.equal(layer.stats.source_light_point_count, 0);
assert.ok(layer.stats.rendered_line_mesh_count >= 1);
assert.ok(layer.stats.rendered_instanced_mesh_count >= 4);
assert.ok(layer.stats.draw_calls >= 5);
assert.match(layer.stats.truth_guard, /renderer presentation only/);
assert.equal(layer.root.children.length, layer.stats.draw_calls);
for (const child of layer.root.children) {
  assert.equal(child.isMesh || child.isInstancedMesh, true);
}
layer.dispose();
assert.equal(layer.root.parent, null);
console.log('three street detail layer regression passed');
