import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../engine/streaming/terrain_mesh_buffers.mjs';
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

const layer = createThreeBuildingFacadeLayer({ buildingsArtifact, terrainPayload, profile: { id: 'high' } });
assert.equal(layer.stats.schema, 'nwe.three-building-facade-layer/0.2');
assert.equal(layer.stats.source_building_count, 1);
assert.ok(layer.stats.rendered_window_count > 0);
assert.equal(layer.stats.rendered_window_frame_count, layer.stats.rendered_window_count);
assert.equal(layer.stats.rendered_door_count, 1);
assert.equal(layer.stats.draw_calls, 3);
assert.match(layer.stats.material_model.glazing, /reflective/);
assert.match(layer.stats.semantics, /renderer-only/);
assert.match(layer.stats.truth_guard, /not source-backed/);
assert.equal(layer.root.children.length, 3);
assert.ok(layer.root.children.some((child) => child.name === 'NWE_Procedural_Window_Glass' && child.material?.isMeshPhysicalMaterial));
assert.ok(layer.root.children.some((child) => child.name === 'NWE_Procedural_Window_Frames'));
for (const child of layer.root.children) assert.equal(child.isInstancedMesh, true);
layer.dispose();
assert.equal(layer.root.parent, null);
assert.match(layer.stats.facade_alignment, /linear-wall-height/);
const slopedTerrain = {
  ...terrainPayload,
  artifact: { header: { ...terrainPayload.artifact.header, width: 3, height: 3 } },
  elevations: new Float32Array([100, 110, 100, 100, 110, 100, 100, 110, 100]),
};
const sloped = createThreeBuildingFacadeLayer({
  buildingsArtifact,
  terrainPayload: slopedTerrain,
  profile: { id: 'high' },
});
const firstPane = sloped.root.children.find((child) => child.name === 'NWE_Procedural_Window_Glass');
const transform = new THREE.Matrix4();
firstPane.getMatrixAt(0, transform);
const [firstX, firstY, firstZ] = [transform.elements[12], transform.elements[13], transform.elements[14]];
const hA = sampleHeightGrid(slopedTerrain.elevations, {
  width: 3, height: 3, bounds: [0, 0, 10, 10], pixelSizeMeters: 5,
  nodata: null, easting: 1, northing: 1,
});
const hB = sampleHeightGrid(slopedTerrain.elevations, {
  width: 3, height: 3, bounds: [0, 0, 10, 10], pixelSizeMeters: 5,
  nodata: null, easting: 9, northing: 1,
});
const along = (firstX + 5 - 1) / 8;
const wallGround = hA + (hB - hA) * along;
assert.ok(Math.abs(firstY - (wallGround - 100 + 0.085 + 1.55)) < 0.0001,
  'window must follow the SAME linearly interpolated wall-edge elevation, not a new center-pixel DTM sample');
assert.ok(Math.abs(firstZ - 4.04) < 0.00001, 'window panel should face exterior, not sit half inside the wall');
sloped.dispose();

// OSM polygon winding is not a guaranteed normal direction; both ring
// orders should give exterior-facing panels, not mirror-inward windows.
for (const polygon of [
  buildingsArtifact.features[0].polygon,
  [...buildingsArtifact.features[0].polygon].reverse(),
]) {
  const winding = createThreeBuildingFacadeLayer({
    buildingsArtifact: { features: [{ ...buildingsArtifact.features[0], polygon }] },
    terrainPayload,
    profile: { id: 'high' },
  });
  const pane = winding.root.children.find((child) => child.name === 'NWE_Procedural_Window_Glass');
  const orientation = new THREE.Matrix4();
  pane.getMatrixAt(0, orientation);
  const position = new THREE.Vector3().setFromMatrixPosition(orientation);
  const facing = new THREE.Vector3(0, 0, 1).transformDirection(orientation);
  const centerToPanel = new THREE.Vector3(position.x, 0, position.z - 1);
  assert.ok(facing.dot(centerToPanel) > 0, 'clockwise and counter-clockwise facade panels must face outside');
  winding.dispose();
}
console.log('three building facade layer regression passed');
