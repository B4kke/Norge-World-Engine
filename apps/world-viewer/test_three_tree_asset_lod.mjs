import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { decodeNearFieldTreeResource, selectNearFieldTreeRepresentatives } from './src/threeTreeAssetLOD.mjs';
import { createThreeVegetationLayer } from './src/threeVegetationLayer.mjs';

const placement = {
  schema: 'nwe.web-vegetation-placement/0.1',
  stats: { placement_semantics: 'SR16-representatives-not-observed-individual-trees' },
  instances: [
    { id: 'spruce-a', species_group: 'spruce', visual_height_m: 16, yaw_rad: 0, local_position: [0, 0, 0] },
    { id: 'pine-b', species_group: 'pine', visual_height_m: 14, yaw_rad: 1, local_position: [12, 0, -8] },
    { id: 'leaf-c', species_group: 'deciduous', visual_height_m: 11, yaw_rad: 1, local_position: [1, 0, 0] },
  ],
};
assert.deepEqual(selectNearFieldTreeRepresentatives(placement.instances, [0, 2, 0], 20, 1).map(x => x.id), ['spruce-a']);
assert.deepEqual(selectNearFieldTreeRepresentatives(placement.instances, [12, 1, -8], 10, 4).map(x => x.id), ['pine-b']);
assert.equal(selectNearFieldTreeRepresentatives(placement.instances, [0, 0, 0], 20, 0).length, 0);
assert.throws(() => selectNearFieldTreeRepresentatives(placement.instances, [NaN, 0, 0], 20, 3), /NWE_TREE_NEAR_FIELD_INPUT_INVALID/);
await assert.rejects(() => decodeNearFieldTreeResource({ bytes: new Uint8Array(10) }), /NWE_TREE_RESOURCE_NOT_ADMITTED/);

const detailedTreeResource = {
  geometry: new THREE.ConeGeometry(1, 8, 12),
  material: new THREE.MeshStandardMaterial({ color: 0x275b30 }),
  nominalHeightM: 8,
  maxInstances: 36,
  radiusM: 10,
  triangleCount: 24,
  presentationOnly: true,
  sourceSha256: 'fixture-source',
  runtimeSha256: 'fixture-runtime',
};
const layer = createThreeVegetationLayer({
  placement,
  profile: { id: 'high', vegetationInstanceBudget: 3, shadows: false },
  detailedTreeResource,
});
assert.equal(layer.stats.near_field_authored_asset, true);
assert.equal(layer.stats.mesh_count, 7);
assert.equal(layer.stats.draw_calls, 7);
assert.equal(layer.stats.near_field_initial_count, 1);
assert.deepEqual(layer.nearFieldSnapshot().selected_ids, ['spruce-a']);
const detailed = layer.root.children.find(x => x.name === 'NWE_CC0_Near_Conifer_One_Mesh');
assert.ok(detailed?.isInstancedMesh);
assert.equal(detailed.count, 1);
const transform = new THREE.Matrix4();
layer.root.children[0].getMatrixAt(0, transform);
assert.equal(transform.determinant(), 0, 'near spruce cone/trunk must be hidden');
layer.root.children[2].getMatrixAt(0, transform);
assert.notEqual(transform.determinant(), 0, 'far pine proxy must remain visible');
const moved = layer.updateNearField([12, 4, -8]);
assert.equal(moved.active, 1);
assert.deepEqual(layer.nearFieldSnapshot().selected_ids, ['pine-b']);
layer.root.children[0].getMatrixAt(0, transform);
assert.notEqual(transform.determinant(), 0, 'spruce proxy restored after movement');
layer.root.children[2].getMatrixAt(0, transform);
assert.equal(transform.determinant(), 0, 'near pine proxy suppressed');
const far = layer.updateNearField([400, 6, 0]);
assert.equal(far.active, 0);
assert.equal(detailed.count, 0);
layer.root.children[2].getMatrixAt(0, transform);
assert.notEqual(transform.determinant(), 0, 'no permanent holes in proxy forest');
assert.deepEqual(placement.instances[0].local_position, [0, 0, 0]);
assert.deepEqual(placement.instances[1].local_position, [12, 0, -8]);
layer.dispose();

const lowGeometry = new THREE.ConeGeometry(1, 8, 12);
const lowMaterial = new THREE.MeshStandardMaterial();
const low = createThreeVegetationLayer({
  placement,
  profile: { id: 'low', vegetationInstanceBudget: 3, shadows: false },
  detailedTreeResource: { ...detailedTreeResource, geometry: lowGeometry, material: lowMaterial },
});
assert.equal(low.stats.near_field_authored_asset, false);
assert.equal(low.stats.draw_calls, 6);
low.dispose(); lowGeometry.dispose(); lowMaterial.dispose();
console.log('THREE_TREE_ASSET_NEAR_LOD_PASS');
