import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createThreeVegetationLayer } from './src/threeVegetationLayer.mjs';

const placement = {
  schema: 'nwe.web-vegetation-placement/0.1',
  stats: { placement_semantics: 'deterministic-source-backed-representatives' },
  instances: [
    { id: 'spruce-1', species_group: 'spruce', visual_height_m: 16, yaw_rad: 0.25, local_position: [0, 0, 0] },
    { id: 'pine-1', species_group: 'pine', visual_height_m: 14, yaw_rad: 1.2, local_position: [12, 0, -8] },
    { id: 'leaf-1', species_group: 'deciduous', visual_height_m: 12, yaw_rad: 2.4, local_position: [-10, 0, 6] },
  ],
};

const layer = createThreeVegetationLayer({
  placement,
  profile: { vegetationInstanceBudget: 3, shadows: false },
});

assert.equal(layer.stats.schema, 'nwe.three-vegetation-layer/0.2');
assert.equal(layer.stats.rendered_representative_count, 3);
assert.equal(layer.stats.mesh_count, 6);
assert.equal(layer.stats.draw_calls, 6);
assert.equal(layer.stats.crown_proxy_instance_count, 13);
assert.equal(layer.stats.tree_groups.spruce, 1);
assert.equal(layer.stats.tree_groups.pine, 1);
assert.equal(layer.stats.tree_groups.deciduous, 1);
assert.equal(layer.stats.near_field_authored_asset, false);
assert.match(layer.stats.renderer_strategy, /multi-lobe-naturalized-proxy/);
assert.equal(layer.root.children.length, 6);
for (const mesh of layer.root.children) {
  assert.equal(mesh.isInstancedMesh, true);
  assert.equal(mesh.castShadow, false);
}

layer.dispose();
assert.equal(layer.root.parent, null);

const visibleTerrain = { positions: new Float32Array([
  -20, 0, 20, 20, 0, 20,
  -20, 0, -20, 20, 5, -20,
]) };
const aligned = createThreeVegetationLayer({
  placement,
  profile: { vegetationInstanceBudget: 3, shadows: false },
  terrainMesh: visibleTerrain,
});
assert.equal(aligned.stats.terrain_alignment, 'exact-rendered-terrain-triangle-presentation-only');
assert.equal(aligned.stats.height_adjusted_instance_count, 1);
assert.ok(Math.abs(aligned.stats.maximum_renderer_vertical_adjustment_m - 2.5) < 1e-6);
const pineTrunk = aligned.root.children[2];
const pineMatrix = new THREE.Matrix4();
pineTrunk.getMatrixAt(0, pineMatrix);
assert.ok(Math.abs(pineMatrix.elements[13] - (2.5 + 14 * 0.58 / 2)) < 1e-5);
assert.deepEqual(placement.instances[1].local_position, [12, 0, -8], 'renderer must not mutate authoritative source placement');
aligned.dispose();
console.log('three vegetation layer regression passed');
