import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createThreeVegetationLayer } from './src/threeVegetationLayer.mjs';

const placement = {
  schema: 'nwe.synthetic-vegetation-placement/0.1',
  positions: new Float32Array([
    0, 0, 0,
    10, 1, 5,
    -7, -0.5, 12,
    16, 2, -8,
  ]),
  heights: new Float32Array([12, 9, 15, 11]),
  yaws: new Float32Array([0, 0.5, 1.2, 2.4]),
  species: new Uint8Array([0, 1, 0, 1]),
  count: 4,
  metadata: {
    authority: 'renderer-only-synthetic',
    conifer_count: 2,
    broadleaf_count: 2,
  },
};

const scene = new THREE.Scene();
const layer = createThreeVegetationLayer({ scene, placement });
const snapshot = layer.snapshot();
assert.equal(snapshot.schema, 'nwe.vegetation-render-layer/0.1');
assert.equal(snapshot.authority, 'renderer-only-synthetic');
assert.equal(snapshot.instance_count, 4);
assert.equal(snapshot.conifer_count, 2);
assert.equal(snapshot.broadleaf_count, 2);
assert.equal(snapshot.draw_calls, 3, 'tree layer must remain bounded to trunk + two crown draws');
assert.equal(snapshot.mesh_count, 3);
assert.equal(snapshot.geometry_strategy, 'three-instancedmesh-shared-lowpoly-primitives');
assert.equal(scene.children.length, 3);
assert(layer.meshes.every((mesh) => mesh.isInstancedMesh === true), 'vegetation must use Three InstancedMesh rather than per-tree meshes');
assert.equal(layer.meshes[0].count, 4, 'trunk instances should match all trees');
assert.equal(layer.meshes[1].count, 2, 'conifer crown count mismatch');
assert.equal(layer.meshes[2].count, 2, 'broadleaf crown count mismatch');
assert(layer.meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow), 'vegetation should participate in bounded lighting/shadows');
assert(snapshot.instance_matrix_payload_bytes > 0);
layer.dispose();
assert.equal(scene.children.length, 0, 'vegetation dispose must remove instanced meshes from the scene');

assert.throws(() => createThreeVegetationLayer({ scene, placement: { ...placement, metadata: { ...placement.metadata, authority: 'source-backed' } } }), /VEGETATION_AUTHORITY_MUST_REMAIN_SYNTHETIC/);
console.log('THREE_VEGETATION_LAYER_PASS');
