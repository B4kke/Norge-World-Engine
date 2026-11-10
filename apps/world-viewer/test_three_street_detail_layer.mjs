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
  // Deliberately coarse render triangles disagree with the flat 1 m DTM.
  mesh: {
    metadata: { origin: [1, 1, 100] },
    positions: new Float32Array([-1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0.8, -1]),
  },
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
      properties: { Farge: 'Hvit', Type: 'Skillelinje (1008)', Materialtype: 'Ekstrudert plast', Tykkelse: 3, 'Bredde, enkeltlinje': 0.12 },
    },
    {
      source_type_id: 95,
      source_type_name: 'Skiltpunkt',
      source_object_id: 2,
      part_index: 0,
      geometry_type: 'point',
      point: [0.6, 1.4],
      properties: { Oppsettingsutstyr: 'Stolpe 88,9 mm (3")', 'Høyde over vegkant': 2.3 },
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
    {
      source_type_id: 181,
      source_type_name: 'Lysmast',
      source_object_id: 4,
      part_index: 0,
      geometry_type: 'point',
      point: [1.6, 1.6],
      properties: { Type: 'Tremast' },
    },
  ],
  stats: { feature_part_count: 4, feature_parts_by_type_id: { '99': 1, '95': 1, '181': 2 } },
};

const layer = createThreeStreetDetailLayer({ artifact, terrainPayload, profile: { id: 'high' } });
assert.equal(layer.stats.schema, 'nwe.three-street-detail-layer/0.3');
assert.equal(layer.stats.source_feature_part_count, 4);
assert.equal(layer.stats.source_width_marking_parts, 1);
assert.equal(layer.stats.renderer_fallback_width_marking_parts, 0);
assert.equal(layer.stats.source_thickness_marking_parts, 1);
assert.equal(layer.stats.marking_material_parts.plastic, 1);
assert.equal(layer.stats.sign_point_count, 1);
assert.equal(layer.stats.source_sign_plate_count, 0);
assert.equal(layer.stats.source_sign_support_count, 1);
assert.equal(layer.stats.source_sign_mount_height_count, 1);
assert.equal(layer.stats.sign_support_counts['pole-88.9'], 1);
assert.equal(layer.stats.generic_fallback_sign_plate_count, 1);
assert.equal(layer.stats.traffic_signs.status, 'NO_TYPE96_SIGN_PLATES');
assert.match(layer.stats.sign_face_semantics, /no-traffic-symbol/);
assert.equal(layer.stats.source_light_mast_count, 2);
assert.equal(layer.stats.steel_light_mast_count, 1);
assert.equal(layer.stats.wood_light_mast_count, 1);
assert.ok(layer.stats.rendered_line_mesh_count >= 1);
assert.match(layer.stats.street_surface_alignment, /same-rendered-terrain-triangles/);
const marking = layer.root.children.find((child) => child.name === 'NWE_Street_whitePlastic');
assert.ok(marking, 'extruded-plastic road marking must be rendered');
const position = marking.geometry.getAttribute('position');
assert.ok(position.count > 4, 'marking strip must be clipped to terrain triangles');
for (let vertex = 0; vertex < position.count; vertex += 1) {
  const x = position.getX(vertex);
  const y = position.getY(vertex);
  const z = position.getZ(vertex);
  const u = (x + 1) / 2;
  const w = (1 - z) / 2;
  const renderedHeight = Math.max(0, u + w - 1) * 0.8;
  const expected = renderedHeight + 0.06 + 0.00405;
  assert.ok(Math.abs(y - expected) < 0.00001, `road paint off visible road at (${x},${z}): ${y} != ${expected}`);
}
assert.ok(layer.stats.rendered_instanced_mesh_count >= 5);
assert.ok(layer.stats.draw_calls >= 6);
assert.match(layer.stats.truth_guard, /sign face identity\/orientation/);
assert.equal(layer.root.children.length, layer.stats.draw_calls);
assert.ok(layer.root.children.some((child) => child.name === 'NWE_Sign_Support_pole-88.9'));
assert.ok(layer.root.children.some((child) => child.name === 'NWE_Light_Masts_Wood'));
for (const child of layer.root.children) assert.equal(child.isMesh || child.isInstancedMesh, true);
layer.dispose();
assert.equal(layer.root.parent, null);
console.log('three street detail layer regression passed');
