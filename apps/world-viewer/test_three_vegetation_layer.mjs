import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createThreeVegetationLayer } from './src/threeVegetationLayer.mjs';

const placement = {
  schema: 'nwe.forge-vegetation-render-placement/0.1',
  positions: new Float32Array([0, 0, 0, 10, 1, 5, -7, -0.5, 12, 16, 2, -8]),
  heights: new Float32Array([12, 9, 15, 11]),
  yaws: new Float32Array([0, 0.5, 1.2, 2.4]),
  species: new Uint8Array([0, 1, 0, 1]),
  source_classes: new Uint8Array([0, 4, 1, 3]),
  count: 4,
  metadata: {
    authority: 'forge-derived-representative-distribution',
    individual_tree_truth: false,
    source_artifact_sha256: 'fixture-sha',
    source_semantic_sha256: 'fixture-semantic-sha',
    source_instance_count: 4,
    conifer_count: 2,
    broadleaf_count: 2,
  },
};

function template(id, classIds) {
  const geometry = new THREE.BoxGeometry(0.8, 4, 0.8);
  geometry.translate(0, 2, 0);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  return {
    asset: {
      id,
      provider: 'Kenney',
      license: 'CC0-1.0',
      class_ids: classIds,
      source_page: 'https://kenney.nl/assets/nature-kit',
      renderer_role: 'test-tree',
      runtime_transport: 'fixture',
      transport_repository: 'fixture',
      transport_commit: 'fixture',
    },
    meshes: [{ geometry, materials: [material], source_name: id }],
    native_height_m: 4,
    selected_triangle_count: 12,
  };
}

const templates = [
  template('conifer-a', [0, 2]),
  template('conifer-b', [1]),
  template('mixed', [3]),
  template('broadleaf', [4]),
];

const scene = new THREE.Scene();
const layer = createThreeVegetationLayer({ scene, placement, templates });
let snapshot = layer.snapshot();
assert.equal(snapshot.schema, 'nwe.vegetation-render-layer/0.5');
assert.equal(snapshot.individual_tree_truth, false);
assert.equal(snapshot.rendered_proxy_instance_count, 0);
assert.equal(snapshot.proxy_draw_calls, 0);
assert.equal(snapshot.proxy_mesh_count, 0);
assert.equal(snapshot.proxy_geometry_strategy, 'disabled-real-glb-assets-only');
assert.equal(scene.children.length, 0, 'no primitive geometry may be inserted before real assets are ready');

await layer.detailReady;
snapshot = layer.snapshot();
assert.equal(snapshot.asset_state.status, 'ready');
assert.equal(snapshot.rendered_asset_instance_count, 4);
assert.equal(snapshot.accepted_instance_count, 4);
assert.equal(snapshot.asset_draw_calls, 4, 'one instanced mesh per used asset class in the fixture');
assert.equal(snapshot.asset_state.assets.every((asset) => asset.provider === 'Kenney' && asset.license === 'CC0-1.0'), true);
assert.equal(layer.meshes.length, 4);
assert.equal(layer.meshes.every((mesh) => mesh.isInstancedMesh), true);
assert.equal(layer.meshes.every((mesh) => mesh.castShadow === false && mesh.receiveShadow === true), true);
assert.equal(scene.children.length, 4);
layer.dispose();
assert.equal(scene.children.length, 0);

const failedScene = new THREE.Scene();
const failedLayer = createThreeVegetationLayer({ scene: failedScene, placement, templateLoader: async () => { throw new Error('offline'); } });
await assert.rejects(failedLayer.detailReady, /offline/);
assert.equal(failedLayer.snapshot().asset_state.status, 'failed');
assert.equal(failedScene.children.length, 0, 'asset failure must fail closed rather than showing primitive substitute trees');
failedLayer.dispose();

assert.throws(() => createThreeVegetationLayer({ scene, placement: { ...placement, metadata: { ...placement.metadata, individual_tree_truth: true } } }), /VEGETATION_AUTHORITY_INVALID/);
console.log('THREE_VEGETATION_LAYER_PASS');
