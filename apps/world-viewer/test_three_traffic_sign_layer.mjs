import assert from 'node:assert/strict';
import { createThreeTrafficSignLayer } from './src/threeTrafficSignLayer.mjs';

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

const parentRelation = {
  foreldre: [{
    type: { id: 95, navn: 'Skiltpunkt' },
    vegobjekter: [10],
  }],
};

const artifact = {
  schema: 'nwe.nvdb-street-detail-artifact/0.1-candidate',
  tile_id: terrainPayload.artifact.header.tile_id,
  features: [
    {
      source_type_id: 99,
      source_object_id: 1,
      geometry_type: 'line',
      points: [[0, 1], [2, 1]],
      properties: { Type: 'Kjørefeltlinje' },
    },
    {
      source_type_id: 95,
      source_object_id: 10,
      geometry_type: 'point',
      point: [1, 1.2],
      properties: { 'Høyde over vegkant': 2.0, Oppsettingsutstyr: 'Stolpe 60,3 mm' },
    },
    {
      source_type_id: 96,
      source_object_id: 20,
      geometry_type: 'point',
      point: [1, 1.2],
      properties: {
        Skiltnummer: '202 - Vikeplikt',
        Plasseringskode: 1,
        'Ansiktsside, rettet mot': 'Trafikk mot metreringsretning',
      },
      relations: parentRelation,
    },
    {
      source_type_id: 96,
      source_object_id: 21,
      geometry_type: 'point',
      point: [1, 1.2],
      properties: {
        Skiltnummer: '362.50 - Fartsgrense 50 km/t',
        Plasseringskode: 2,
        'Ansiktsside, rettet mot': 'Trafikk mot metreringsretning',
        Størrelse: 'Middels størrelse',
      },
      relations: parentRelation,
    },
    {
      source_type_id: 96,
      source_object_id: 22,
      geometry_type: 'point',
      point: [1, 1.2],
      properties: {
        Skiltnummer: '802 - Avstand',
        Tekst: '100m',
        'Ansiktsside, rettet mot': 'Trafikk mot metreringsretning',
      },
      relations: parentRelation,
    },
  ],
};

const layer = createThreeTrafficSignLayer({ artifact, terrainPayload, profile: { id: 'high' } });
assert.equal(layer.stats.schema, 'nwe.three-traffic-sign-layer/0.1');
assert.equal(layer.stats.source_sign_point_count, 1);
assert.equal(layer.stats.source_sign_plate_count, 3);
assert.equal(layer.stats.linked_sign_plate_count, 3);
assert.equal(layer.stats.unresolved_parent_plate_count, 0);
assert.equal(layer.stats.linked_parent_sign_point_count, 1);
assert.equal(layer.stats.sign_points_without_plate_count, 0);
assert.equal(layer.stats.source_sign_mount_height_parent_count, 1);
assert.equal(layer.stats.source_placement_code_plate_count, 2);
assert.equal(layer.stats.renderer_fallback_placement_plate_count, 1);
assert.equal(layer.stats.supplementary_plate_count, 1);
assert.equal(layer.stats.source_orientation_semantic_plate_count, 3);
assert.equal(layer.stats.inferred_nearby_linear_axis_plate_count, 3);
assert.equal(layer.stats.sign_family_counts.yield, 1);
assert.equal(layer.stats.sign_family_counts.prohibition, 1);
assert.equal(layer.stats.sign_family_counts.supplementary, 1);
assert.equal(layer.stats.sign_number_counts['362.50'], 1);
assert.equal(layer.stats.rendered_artwork_group_count, 3);
assert.equal(layer.stats.renderer_canvas_texture_count, 0);
assert.equal(layer.stats.rendered_mesh_count, 6);
assert.equal(layer.stats.draw_calls, 6);
assert.equal(layer.root.children.length, 6);
assert.ok(layer.requiredSupportTopMByParent.get(10) > 2.5);
assert.match(layer.stats.face_artwork, /renderer-authored facsimile/);
assert.match(layer.stats.orientation_semantics, /front\/back 180-degree direction/);
assert.match(layer.stats.truth_guard, /official artwork/);
for (const child of layer.root.children) assert.equal(child.isInstancedMesh, true);
layer.dispose();
assert.equal(layer.root.parent, null);
console.log('three traffic sign layer regression passed');
