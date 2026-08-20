import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { selectPolyHavenLodRoots } from './src/polyHavenVegetationAssets.mjs';
import { createThreeVegetationLayer } from './src/threeVegetationLayer.mjs';

const placement = {
  schema: 'nwe.forge-vegetation-render-placement/0.1',
  positions: new Float32Array([
    0, 0, 0,
    10, 1, 5,
    -7, -0.5, 12,
    16, 2, -8,
  ]),
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

const lodScene = new THREE.Group();
const lod0 = new THREE.Group();
lod0.name = 'tree_LOD0';
lod0.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial()));
const lod3 = new THREE.Group();
lod3.name = 'tree_LOD3';
lod3.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial()));
lodScene.add(lod0, lod3);
const lodSelection = selectPolyHavenLodRoots(lodScene, { requireLodMarker: true });
assert.equal(lodSelection.selectedLod, 3, 'near detailed asset policy chooses the lowest-detail advertised LOD');
assert.deepEqual(lodSelection.availableLods, [0, 3]);

function template() {
  const geometry = new THREE.ConeGeometry(1, 4, 6);
  geometry.translate(0, 2, 0);
  const material = new THREE.MeshStandardMaterial({ color: 0x315b38, roughness: 0.9 });
  return {
    asset: {
      id: 'pine_sapling_small',
      provider: 'Poly Haven',
      license: 'CC0-1.0',
      class_id: 0,
      source_slug: 'pine_sapling_small',
      source_page: 'https://polyhaven.com/a/pine_sapling_small',
      runtime_resolution: '1k',
    },
    meshes: [{ geometry, materials: [material], source_name: 'pine-mesh' }],
    native_height_m: 4,
    selected_lod: null,
    available_lods: [],
    selected_triangle_count: 12,
  };
}

const scene = new THREE.Scene();
const layer = createThreeVegetationLayer({ scene, placement, templates: [template()], nearDetailConifers: 1 });
let snapshot = layer.snapshot();
assert.equal(snapshot.schema, 'nwe.vegetation-render-layer/0.4');
assert.equal(snapshot.authority, 'forge-derived-representative-distribution');
assert.equal(snapshot.individual_tree_truth, false);
assert.equal(snapshot.source_artifact_sha256, 'fixture-sha');
assert.equal(snapshot.accepted_instance_count, 4);
assert.equal(snapshot.rendered_proxy_instance_count, 4, 'all source-backed representatives get a lightweight visible LOD');
assert.equal(snapshot.conifer_count, 2);
assert.equal(snapshot.broadleaf_count, 2);
assert.equal(snapshot.proxy_draw_calls, 4, 'crown+trunk for two renderer vegetation classes');
assert.equal(snapshot.proxy_geometry_strategy, 'instanced-renderer-lod-cone-icosahedron-trunks');
assert.equal(snapshot.proxy_shadow_policy, 'receive-only-distant-lod; detailed-assets-may-cast');
assert.equal(scene.children.length, 4, 'proxy vegetation must be visible immediately without waiting on external GLTF');
assert(layer.meshes.every((mesh) => mesh.isInstancedMesh), 'proxy layer remains GPU-instanced');
assert(layer.meshes.every((mesh) => mesh.castShadow === false && mesh.receiveShadow === true), 'coarse proxy LOD must not cast hard polygonal shadows into roads/terrain');
assert(snapshot.proxy_estimated_triangles > 0);
assert(snapshot.proxy_geometry_payload_bytes > 0);
assert(snapshot.proxy_instance_matrix_payload_bytes > 0);

await layer.detailReady;
snapshot = layer.snapshot();
assert.equal(snapshot.detailed_asset_state.status, 'ready');
assert.equal(snapshot.detailed_asset_state.rendered_instances, 1, 'only bounded nearest conifers get high-detail asset overlay');
assert.equal(snapshot.detailed_asset_state.assets[0].provider, 'Poly Haven');
assert.equal(snapshot.detailed_asset_state.assets[0].license, 'CC0-1.0');
assert.equal(layer.detailMeshes.length, 1);
assert(layer.detailMeshes.every((mesh) => mesh.castShadow === true), 'real/detail vegetation may participate in bounded near shadows');
assert.equal(scene.children.length, 5);
layer.dispose();
assert.equal(scene.children.length, 0, 'vegetation dispose removes proxy and detailed instanced meshes');

const fallbackScene = new THREE.Scene();
const fallbackLayer = createThreeVegetationLayer({
  scene: fallbackScene,
  placement,
  nearDetailConifers: 1,
  templateLoader: async () => { throw new Error('offline'); },
});
assert.equal(fallbackScene.children.length, 4, 'external asset failure must never remove the source-backed proxy forest');
await fallbackLayer.detailReady;
assert.equal(fallbackLayer.snapshot().detailed_asset_state.status, 'failed');
assert.match(fallbackLayer.snapshot().detailed_asset_state.error, /offline/);
fallbackLayer.dispose();

assert.throws(() => createThreeVegetationLayer({ scene, placement: { ...placement, metadata: { ...placement.metadata, individual_tree_truth: true } } }), /VEGETATION_AUTHORITY_INVALID/);
console.log('THREE_VEGETATION_LAYER_PASS');
