import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MIRROR_REPOSITORY = 'jonathaneeckhout/pirate-zombies';
const MIRROR_COMMIT = 'f68d6d2724a63773bf9fee93898238b0ed205659';
const MIRROR_ROOT = `https://raw.githubusercontent.com/${MIRROR_REPOSITORY}/${MIRROR_COMMIT}/assets/Nature%20Kit%20(2.1)/Models/GLTF%20format`;

function asset({ id, file, classIds, role }) {
  return Object.freeze({
    schema: 'nwe.render-asset/0.1',
    id,
    provider: 'Kenney',
    source_pack: 'Nature Kit',
    source_page: 'https://kenney.nl/assets/nature-kit',
    license: 'CC0-1.0',
    class_ids: Object.freeze([...classIds]),
    renderer_role: role,
    runtime_transport: 'commit-pinned-public-mirror',
    transport_repository: MIRROR_REPOSITORY,
    transport_commit: MIRROR_COMMIT,
    transport_path: `assets/Nature Kit (2.1)/Models/GLTF format/${file}`,
    url: `${MIRROR_ROOT}/${file}`,
    truth_semantics: 'renderer-only-species-class-compatible-asset-not-observed-tree-identity',
  });
}

export const KENNEY_VEGETATION_ASSETS = Object.freeze([
  asset({
    id: 'kenney-nature-tree-pine-default-a',
    file: 'tree_pineDefaultA.glb',
    classIds: [0, 2],
    role: 'conifer-spruce-dominated-or-mixed-silhouette',
  }),
  asset({
    id: 'kenney-nature-tree-pine-default-b',
    file: 'tree_pineDefaultB.glb',
    classIds: [1],
    role: 'conifer-pine-dominated-silhouette',
  }),
  asset({
    id: 'kenney-nature-tree-default',
    file: 'tree_default.glb',
    classIds: [3],
    role: 'mixed-forest-broadleaf-compatible-silhouette',
  }),
  asset({
    id: 'kenney-nature-tree-oak',
    file: 'tree_oak.glb',
    classIds: [4],
    role: 'deciduous-dominated-broadleaf-silhouette',
  }),
]);

function cloneTemplateMeshes(scene) {
  const meshes = [];
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (!object?.isMesh || !object.geometry) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const materials = Array.isArray(object.material)
      ? object.material.map((material) => material?.clone?.() ?? material)
      : [object.material?.clone?.() ?? object.material];
    meshes.push({ geometry, materials, source_name: object.name || null });
  });
  if (meshes.length === 0) throw new Error('KENNEY_TREE_SELECTED_ASSET_HAS_NO_MESHES');
  return meshes;
}

function normalizeTemplateMeshes(meshes) {
  const box = new THREE.Box3();
  for (const { geometry } of meshes) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
  }
  if (box.isEmpty()) throw new Error('KENNEY_TREE_TEMPLATE_BOUNDS_EMPTY');
  const size = box.getSize(new THREE.Vector3());
  if (!(Number.isFinite(size.y) && size.y > 0.05)) throw new Error(`KENNEY_TREE_TEMPLATE_HEIGHT_INVALID: ${size.y}`);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const centerZ = (box.min.z + box.max.z) * 0.5;
  const normalize = new THREE.Matrix4().makeTranslation(-centerX, -box.min.y, -centerZ);
  for (const { geometry } of meshes) {
    geometry.applyMatrix4(normalize);
    geometry.computeBoundingSphere();
  }
  return size.y;
}

function geometryTriangles(geometry) {
  const count = geometry.index?.count ?? geometry.getAttribute?.('position')?.count ?? 0;
  return Math.floor(count / 3);
}

export async function loadKenneyVegetationTemplates({
  assets = KENNEY_VEGETATION_ASSETS,
  loader = new GLTFLoader(),
} = {}) {
  const templates = [];
  for (const descriptor of assets) {
    const gltf = await loader.loadAsync(descriptor.url);
    if (!gltf?.scene) throw new Error(`KENNEY_TREE_GLTF_SCENE_MISSING: ${descriptor.id}`);
    const meshes = cloneTemplateMeshes(gltf.scene);
    const nativeHeightM = normalizeTemplateMeshes(meshes);
    const triangleCount = meshes.reduce((sum, { geometry }) => sum + geometryTriangles(geometry), 0);
    templates.push(Object.freeze({
      asset: descriptor,
      meshes,
      native_height_m: nativeHeightM,
      selected_triangle_count: triangleCount,
    }));
  }
  return templates;
}
