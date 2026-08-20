import * as THREE from 'three/webgpu';
import { loadKenneyVegetationTemplates } from './kenneyVegetationAssets.mjs';

const VEGETATION_RENDER_SCHEMA = 'nwe.vegetation-render-layer/0.4';

function assertPlacement(placement) {
  if (placement?.schema !== 'nwe.forge-vegetation-render-placement/0.1') throw new TypeError('VEGETATION_PLACEMENT_SCHEMA_INVALID');
  const count = Number(placement.count);
  if (!Number.isInteger(count) || count < 0) throw new TypeError('VEGETATION_PLACEMENT_COUNT_INVALID');
  if (!(placement.positions instanceof Float32Array) || placement.positions.length !== count * 3) throw new TypeError('VEGETATION_PLACEMENT_POSITIONS_INVALID');
  if (!(placement.heights instanceof Float32Array) || placement.heights.length !== count) throw new TypeError('VEGETATION_PLACEMENT_HEIGHTS_INVALID');
  if (!(placement.yaws instanceof Float32Array) || placement.yaws.length !== count) throw new TypeError('VEGETATION_PLACEMENT_YAWS_INVALID');
  if (!(placement.species instanceof Uint8Array) || placement.species.length !== count) throw new TypeError('VEGETATION_PLACEMENT_SPECIES_INVALID');
  if (!(placement.source_classes instanceof Uint8Array) || placement.source_classes.length !== count) throw new TypeError('VEGETATION_PLACEMENT_SOURCE_CLASSES_INVALID');
  if (placement.metadata?.authority !== 'forge-derived-representative-distribution' || placement.metadata?.individual_tree_truth !== false) {
    throw new Error('VEGETATION_AUTHORITY_INVALID');
  }
  return count;
}

function configureInstanceMesh(mesh, name) {
  mesh.name = name;
  // Exact asset silhouettes are used everywhere in the current 1 km proof tile.
  // Keep tree shadows disabled until the road/material pass is visually closed;
  // this avoids coupling foliage shadow tuning to road acceptance.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = true;
  return mesh;
}

function materialsForInstancing(materials) {
  const resolved = materials.filter(Boolean);
  if (resolved.length === 0) throw new Error('KENNEY_TREE_TEMPLATE_MATERIAL_MISSING');
  return resolved.length === 1 ? resolved[0] : resolved;
}

function placementIndicesForAsset(placement, classIds) {
  const accepted = new Set(classIds);
  const output = [];
  for (let index = 0; index < placement.count; index += 1) {
    if (accepted.has(placement.source_classes[index])) output.push(index);
  }
  return output;
}

function composeMatrix(matrix, position, quaternion, scale, placement, index, nativeHeightM) {
  const offset = index * 3;
  const targetHeightM = placement.heights[index];
  const uniformScale = targetHeightM / nativeHeightM;
  position.set(placement.positions[offset], placement.positions[offset + 1], placement.positions[offset + 2]);
  quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, placement.yaws[index]);
  scale.setScalar(uniformScale);
  matrix.compose(position, quaternion, scale);
  return matrix;
}

function geometryPayloadBytes(geometry) {
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) bytes += attribute?.array?.byteLength ?? 0;
  return bytes;
}

function disposeMaterial(material, seenMaterials, seenTextures) {
  const list = Array.isArray(material) ? material : [material];
  for (const entry of list) {
    if (!entry || seenMaterials.has(entry)) continue;
    seenMaterials.add(entry);
    for (const value of Object.values(entry)) if (value?.isTexture) seenTextures.add(value);
  }
}

export function createThreeVegetationLayer({
  scene,
  placement,
  templateLoader = loadKenneyVegetationTemplates,
  templates = null,
} = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('Three scene is required');
  const count = assertPlacement(placement);
  const meshes = [];
  const state = {
    status: count > 0 ? 'loading' : 'ready',
    error: null,
    rendered_instances: 0,
    draw_calls: 0,
    geometry_payload_bytes: 0,
    instance_matrix_payload_bytes: 0,
    estimated_triangles: 0,
    assets: [],
  };
  let disposed = false;

  const detailReady = count === 0
    ? Promise.resolve(state)
    : Promise.resolve(templates ?? templateLoader()).then((loadedTemplates) => {
      if (disposed) return state;
      const compatible = (loadedTemplates ?? []).filter((template) => template?.asset?.provider === 'Kenney' && template?.asset?.license === 'CC0-1.0');
      if (compatible.length === 0) throw new Error('KENNEY_TREE_TEMPLATES_REQUIRED');

      const claimedClasses = new Set();
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();

      for (const template of compatible) {
        const classIds = template.asset.class_ids ?? [];
        for (const classId of classIds) {
          if (claimedClasses.has(classId)) throw new Error(`KENNEY_TREE_CLASS_MAPPING_AMBIGUOUS: ${classId}`);
          claimedClasses.add(classId);
        }
        const indices = placementIndicesForAsset(placement, classIds);
        if (indices.length === 0) continue;
        const nativeHeightM = Number(template.native_height_m);
        if (!(Number.isFinite(nativeHeightM) && nativeHeightM > 0.05)) throw new Error(`KENNEY_TREE_TEMPLATE_HEIGHT_INVALID: ${template.asset.id}`);

        for (let partIndex = 0; partIndex < template.meshes.length; partIndex += 1) {
          const part = template.meshes[partIndex];
          const mesh = configureInstanceMesh(
            new THREE.InstancedMesh(part.geometry, materialsForInstancing(part.materials ?? []), indices.length),
            `nwe-kenney-tree-${template.asset.id}-${partIndex}`,
          );
          indices.forEach((placementIndex, instanceIndex) => {
            mesh.setMatrixAt(instanceIndex, composeMatrix(matrix, position, quaternion, scale, placement, placementIndex, nativeHeightM));
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          scene.add(mesh);
          meshes.push(mesh);
          state.draw_calls += 1;
          state.geometry_payload_bytes += geometryPayloadBytes(part.geometry);
          state.instance_matrix_payload_bytes += indices.length * 16 * Float32Array.BYTES_PER_ELEMENT;
        }
        state.rendered_instances += indices.length;
        state.estimated_triangles += (Number(template.selected_triangle_count) || 0) * indices.length;
        state.assets.push({
          id: template.asset.id,
          provider: template.asset.provider,
          license: template.asset.license,
          source_page: template.asset.source_page,
          renderer_role: template.asset.renderer_role,
          class_ids: [...classIds],
          runtime_transport: template.asset.runtime_transport,
          transport_repository: template.asset.transport_repository,
          transport_commit: template.asset.transport_commit,
          rendered_instances: indices.length,
          triangle_count_per_instance: Number(template.selected_triangle_count) || 0,
        });
      }

      for (let classId = 0; classId <= 4; classId += 1) {
        const needed = placement.source_classes.includes(classId);
        if (needed && !claimedClasses.has(classId)) throw new Error(`KENNEY_TREE_CLASS_UNMAPPED: ${classId}`);
      }
      if (state.rendered_instances !== count) throw new Error(`KENNEY_TREE_INSTANCE_COVERAGE_MISMATCH: ${state.rendered_instances} != ${count}`);
      state.status = 'ready';
      return state;
    }).catch((error) => {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      throw error;
    });

  const snapshot = () => ({
    schema: VEGETATION_RENDER_SCHEMA,
    authority: placement.metadata.authority,
    individual_tree_truth: false,
    placement_schema: placement.schema,
    source_artifact_sha256: placement.metadata.source_artifact_sha256,
    source_semantic_sha256: placement.metadata.source_semantic_sha256,
    source_instance_count: placement.metadata.source_instance_count,
    accepted_instance_count: count,
    rendered_asset_instance_count: state.rendered_instances,
    rendered_proxy_instance_count: 0,
    conifer_count: placement.metadata.conifer_count ?? 0,
    broadleaf_count: placement.metadata.broadleaf_count ?? 0,
    asset_draw_calls: state.draw_calls,
    asset_mesh_count: meshes.length,
    asset_geometry_payload_bytes: state.geometry_payload_bytes,
    asset_instance_matrix_payload_bytes: state.instance_matrix_payload_bytes,
    asset_estimated_triangles: state.estimated_triangles,
    proxy_draw_calls: 0,
    proxy_mesh_count: 0,
    proxy_geometry_payload_bytes: 0,
    proxy_instance_matrix_payload_bytes: 0,
    proxy_estimated_triangles: 0,
    proxy_geometry_strategy: 'disabled-real-glb-assets-only',
    asset_strategy: 'all-accepted-forge-representatives-instanced-kenney-cc0-glb',
    asset_state: { ...state, assets: state.assets.map((asset) => ({ ...asset, class_ids: [...asset.class_ids] })) },
    detailed_asset_state: { ...state, assets: state.assets.map((asset) => ({ ...asset, class_ids: [...asset.class_ids] })) },
    placement: placement.metadata,
  });

  return {
    meshes,
    detailMeshes: [],
    detailReady,
    snapshot,
    dispose() {
      disposed = true;
      for (const mesh of meshes) scene.remove(mesh);
      const seenGeometries = new Set();
      const seenMaterials = new Set();
      const seenTextures = new Set();
      for (const mesh of meshes) {
        if (mesh.geometry && !seenGeometries.has(mesh.geometry)) {
          seenGeometries.add(mesh.geometry);
          mesh.geometry.dispose?.();
        }
        disposeMaterial(mesh.material, seenMaterials, seenTextures);
      }
      for (const texture of seenTextures) texture.dispose?.();
      for (const material of seenMaterials) material.dispose?.();
    },
  };
}
