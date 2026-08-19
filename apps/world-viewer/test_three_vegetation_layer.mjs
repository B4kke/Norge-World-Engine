import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { selectPolyHavenLodRoots } from './src/polyHavenVegetationAssets.mjs';
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

const lodScene = new THREE.Group();
const lod0 = new THREE.Group();
lod0.name = 'tree_small_02_LOD0';
lod0.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial()));
const lod3 = new THREE.Group();
lod3.name = 'tree_small_02_LOD3';
lod3.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial()));
lodScene.add(lod0, lod3);
const lodSelection = selectPolyHavenLodRoots(lodScene, { requireLodMarker: true });
assert.equal(lodSelection.selectedLod, 3, 'Poly Haven LOD policy must choose the lowest-detail available LOD for the runtime template');
assert.deepEqual(lodSelection.availableLods, [0, 3]);
assert.deepEqual(lodSelection.roots, [lod3]);

function template({ id, classId, color, selectedLod = null, availableLods = [] }) {
  const geometry = new THREE.BoxGeometry(1.2, 4, 1.2);
  geometry.translate(0, 2, 0);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  return {
    asset: {
      id,
      provider: 'Poly Haven',
      license: 'CC0-1.0',
      class_id: classId,
      source_slug: id,
      source_page: `https://polyhaven.com/a/${id}`,
      url: `https://dl.polyhaven.org/${id}.gltf`,
      runtime_resolution: '1k',
      lod_policy: selectedLod === null ? 'native-small-source' : 'lowest-available-polyhaven-lod',
      source_triangle_count: 12,
    },
    meshes: [{ geometry, materials: [material], source_name: `${id}-mesh` }],
    native_height_m: 4,
    selected_lod: selectedLod,
    available_lods: availableLods,
    selected_triangle_count: 12,
  };
}

const templates = [
  template({ id: 'pine_sapling_small', classId: 0, color: 0x315b38 }),
  template({ id: 'tree_small_02', classId: 1, color: 0x4c743d, selectedLod: 3, availableLods: [0, 1, 2, 3] }),
];

const scene = new THREE.Scene();
const layer = await createThreeVegetationLayer({ scene, placement, templates });
const snapshot = layer.snapshot();
assert.equal(snapshot.schema, 'nwe.vegetation-render-layer/0.2');
assert.equal(snapshot.authority, 'renderer-only-synthetic');
assert.equal(snapshot.instance_count, 4);
assert.equal(snapshot.rendered_instance_count, 4);
assert.equal(snapshot.conifer_count, 2);
assert.equal(snapshot.broadleaf_count, 2);
assert.equal(snapshot.rendered_conifer_count, 2);
assert.equal(snapshot.rendered_broadleaf_count, 2);
assert.equal(snapshot.draw_calls, 2, 'one instanced draw per selected Poly Haven template mesh is expected in the injected fixture');
assert.equal(snapshot.mesh_count, 2);
assert.equal(snapshot.geometry_strategy, 'polyhaven-gltf-instanced-selected-lod');
assert.equal(snapshot.material_strategy, 'polyhaven-original-gltf-pbr-materials');
assert.equal(snapshot.source_assets.length, 2);
assert(snapshot.source_assets.every((asset) => asset.provider === 'Poly Haven' && asset.license === 'CC0-1.0'));
assert.equal(snapshot.source_assets.find((asset) => asset.id === 'tree_small_02')?.selected_lod, 3);
assert.equal(scene.children.length, 2);
assert(layer.meshes.every((mesh) => mesh.isInstancedMesh === true), 'vegetation must remain GPU-instanced rather than one Object3D per tree');
assert(layer.meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow), 'vegetation should participate in bounded lighting/shadows');
assert(snapshot.instance_matrix_payload_bytes > 0);
assert(snapshot.instance_color_payload_bytes === 0, 'Poly Haven material color must not be replaced by synthetic instance tinting');
layer.dispose();
assert.equal(scene.children.length, 0, 'vegetation dispose must remove instanced meshes from the scene');

await assert.rejects(
  createThreeVegetationLayer({ scene, placement: { ...placement, metadata: { ...placement.metadata, authority: 'source-backed' } }, templates }),
  /VEGETATION_AUTHORITY_MUST_REMAIN_SYNTHETIC/,
);
await assert.rejects(
  createThreeVegetationLayer({ scene, placement, templates: [{ ...templates[0], asset: { ...templates[0].asset, provider: 'Other' } }] }),
  /VEGETATION_ASSET_PROVIDER_MUST_BE_POLY_HAVEN_CC0/,
);
console.log('THREE_VEGETATION_LAYER_PASS');
