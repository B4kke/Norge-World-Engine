import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Decode only a byte-verified, offline-batched GLB. Never download a provider
 * model from this function. Source admission and SHA verification belong to
 * nannestadRealismRuntime; this is a disposable presentation adapter.
 */
export async function decodeNearFieldTreeResource(asset) {
  if (asset?.schema !== 'nwe.tree-presentation-asset/0.1' || asset.presentation_only !== true
      || !(asset.bytes instanceof Uint8Array)
      || asset.bytes.byteLength > 700000
      || asset.max_near_instances !== 36
      || asset.near_radius_m !== 125
      || !(asset.nominal_height_m >= 7.5 && asset.nominal_height_m <= 8.5)
      || !(asset.triangle_count >= 100 && asset.triangle_count <= 12000)) {
    throw new Error('NWE_TREE_RESOURCE_NOT_ADMITTED');
  }
  const buffer = asset.bytes.buffer.slice(asset.bytes.byteOffset,
    asset.bytes.byteOffset + asset.bytes.byteLength);
  const parsed = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  const meshes = [];
  parsed.scene.updateMatrixWorld(true);
  parsed.scene.traverse((child) => { if (child.isMesh) meshes.push(child); });
  if (meshes.length !== 1 || Array.isArray(meshes[0].material)) {
    throw new Error('NWE_TREE_BAKED_MESH_COUNT_INVALID');
  }
  const original = meshes[0];
  const geometry = original.geometry.clone();
  geometry.applyMatrix4(original.matrixWorld);
  if (!geometry.getAttribute('position') || !geometry.getAttribute('color')) {
    geometry.dispose();
    throw new Error('NWE_TREE_BAKED_VERTEX_COLORS_MISSING');
  }
  const triangleCount = geometry.index?.count ? geometry.index.count / 3
    : geometry.getAttribute('position').count / 3;
  if (triangleCount !== asset.triangle_count) {
    geometry.dispose();
    throw new Error('NWE_TREE_BAKED_TRIANGLE_MISMATCH');
  }
  const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  const height = bounds.max.y - bounds.min.y;
  if (![centerX, centerZ, bounds.min.y, height].every(Number.isFinite)
      || Math.abs(centerX) > 0.02 || Math.abs(centerZ) > 0.02
      || Math.abs(bounds.min.y) > 0.02
      || Math.abs(height - asset.nominal_height_m) > 0.04) {
    geometry.dispose();
    throw new Error('NWE_TREE_BAKED_WORLD_SCALE_INVALID');
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const material = original.material.clone();
  material.vertexColors = true;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return Object.freeze({
    geometry, material,
    nominalHeightM: height,
    maxInstances: asset.max_near_instances,
    radiusM: asset.near_radius_m,
    sourceSha256: asset.source_sha256,
    runtimeSha256: asset.sha256,
    triangleCount,
    presentationOnly: true,
  });
}

/** Deterministic, bounded, non-authoritative near-camera candidate selection. */
export function selectNearFieldTreeRepresentatives(instances, cameraLocal, radiusM, maxInstances) {
  if (!Array.isArray(cameraLocal) || cameraLocal.length !== 3
      || !cameraLocal.every(Number.isFinite)
      || !Number.isFinite(radiusM) || radiusM <= 0
      || !Number.isInteger(maxInstances) || maxInstances < 0) {
    throw new TypeError('NWE_TREE_NEAR_FIELD_INPUT_INVALID');
  }
  const near = [];
  for (const item of instances) {
    if (!['spruce', 'pine', 'conifer-mixed'].includes(item.species_group)) continue;
    const p = item.local_position;
    if (!Array.isArray(p) || !p.every(Number.isFinite)) continue;
    const delta = Math.hypot(p[0] - cameraLocal[0], p[2] - cameraLocal[2]);
    if (delta <= radiusM) near.push({ item, distanceM: delta });
  }
  near.sort((a, b) => a.distanceM - b.distanceM || String(a.item.id).localeCompare(String(b.item.id)));
  return near.slice(0, maxInstances).map((entry) => entry.item);
}
