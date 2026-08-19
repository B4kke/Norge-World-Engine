import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const POLY_HAVEN_BASE = 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k';

export const POLY_HAVEN_VEGETATION_ASSETS = Object.freeze([
  Object.freeze({
    schema: 'nwe.render-asset/0.1',
    id: 'polyhaven-pine-sapling-small-1k',
    provider: 'Poly Haven',
    source_slug: 'pine_sapling_small',
    source_page: 'https://polyhaven.com/a/pine_sapling_small',
    license: 'CC0-1.0',
    class_id: 0,
    runtime_resolution: '1k',
    source_triangle_count: 398000,
    lod_policy: 'native-small-source',
    require_lod_marker: false,
    url: `${POLY_HAVEN_BASE}/pine_sapling_small/pine_sapling_small_1k.gltf`,
  }),
  Object.freeze({
    schema: 'nwe.render-asset/0.1',
    id: 'polyhaven-fir-sapling-1k',
    provider: 'Poly Haven',
    source_slug: 'fir_sapling',
    source_page: 'https://polyhaven.com/a/fir_sapling',
    license: 'CC0-1.0',
    class_id: 0,
    runtime_resolution: '1k',
    source_triangle_count: 433000,
    lod_policy: 'native-small-source',
    require_lod_marker: false,
    url: `${POLY_HAVEN_BASE}/fir_sapling/fir_sapling_1k.gltf`,
  }),
]);

function lodIndex(name) {
  const match = String(name ?? '').match(/(?:^|[_\-.\s])LOD[_\-.\s]?(\d+)(?:$|[_\-.\s])/i)
    ?? String(name ?? '').match(/_LOD(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function selectPolyHavenLodRoots(scene, { requireLodMarker = false } = {}) {
  if (!scene?.traverse) throw new TypeError('POLY_HAVEN_GLTF_SCENE_REQUIRED');
  const candidates = [];
  scene.traverse((object) => {
    const index = lodIndex(object?.name);
    if (Number.isInteger(index)) candidates.push({ object, index });
  });
  if (candidates.length === 0) {
    if (requireLodMarker) throw new Error('POLY_HAVEN_LOD_MARKER_REQUIRED');
    return { roots: [scene], selectedLod: null, availableLods: [] };
  }
  const availableLods = [...new Set(candidates.map(({ index }) => index))].sort((a, b) => a - b);
  const selectedLod = availableLods.at(-1);
  const roots = candidates.filter(({ index }) => index === selectedLod).map(({ object }) => object);
  return { roots, selectedLod, availableLods };
}

function cloneSelectedMeshes(roots) {
  const meshes = [];
  const seen = new Set();
  for (const root of roots) {
    root.updateWorldMatrix?.(true, true);
    root.traverse((object) => {
      if (!object?.isMesh || !object.geometry || seen.has(object.uuid)) return;
      seen.add(object.uuid);
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const materials = Array.isArray(object.material) ? object.material.map((material) => material?.clone?.() ?? material) : [object.material?.clone?.() ?? object.material];
      meshes.push({ geometry, materials, source_name: object.name || null });
    });
  }
  if (meshes.length === 0) throw new Error('POLY_HAVEN_SELECTED_LOD_HAS_NO_MESHES');
  return meshes;
}

function normalizeTemplateMeshes(meshes) {
  const box = new THREE.Box3();
  for (const { geometry } of meshes) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
  }
  if (box.isEmpty()) throw new Error('POLY_HAVEN_TEMPLATE_BOUNDS_EMPTY');
  const size = box.getSize(new THREE.Vector3());
  if (!(Number.isFinite(size.y) && size.y > 0.05)) throw new Error(`POLY_HAVEN_TEMPLATE_HEIGHT_INVALID: ${size.y}`);
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

export async function loadPolyHavenVegetationTemplates({
  assets = POLY_HAVEN_VEGETATION_ASSETS,
  loader = new GLTFLoader(),
} = {}) {
  const templates = [];
  for (const asset of assets) {
    const gltf = await loader.loadAsync(asset.url);
    if (!gltf?.scene) throw new Error(`POLY_HAVEN_GLTF_SCENE_MISSING: ${asset.id}`);
    gltf.scene.updateMatrixWorld(true);
    const selection = selectPolyHavenLodRoots(gltf.scene, { requireLodMarker: asset.require_lod_marker });
    const meshes = cloneSelectedMeshes(selection.roots);
    const nativeHeightM = normalizeTemplateMeshes(meshes);
    const selectedTriangleCount = meshes.reduce((sum, { geometry }) => sum + geometryTriangles(geometry), 0);
    templates.push(Object.freeze({
      asset,
      meshes,
      native_height_m: nativeHeightM,
      selected_lod: selection.selectedLod,
      available_lods: Object.freeze(selection.availableLods),
      selected_triangle_count: selectedTriangleCount,
    }));
  }
  return templates;
}
