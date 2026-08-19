import * as THREE from 'three/webgpu';
import { loadPolyHavenVegetationTemplates } from './polyHavenVegetationAssets.mjs';

const VEGETATION_RENDER_SCHEMA = 'nwe.vegetation-render-layer/0.2';
const MAX_RENDERED_TREE_INSTANCES = 48;
const MAX_CONIFER_INSTANCES = 32;
const MAX_BROADLEAF_INSTANCES = 16;

function assertPlacement(placement) {
  if (placement?.schema !== 'nwe.synthetic-vegetation-placement/0.1') throw new TypeError('VEGETATION_PLACEMENT_SCHEMA_INVALID');
  const count = Number(placement.count);
  if (!Number.isInteger(count) || count < 0) throw new TypeError('VEGETATION_PLACEMENT_COUNT_INVALID');
  if (!(placement.positions instanceof Float32Array) || placement.positions.length !== count * 3) throw new TypeError('VEGETATION_PLACEMENT_POSITIONS_INVALID');
  if (!(placement.heights instanceof Float32Array) || placement.heights.length !== count) throw new TypeError('VEGETATION_PLACEMENT_HEIGHTS_INVALID');
  if (!(placement.yaws instanceof Float32Array) || placement.yaws.length !== count) throw new TypeError('VEGETATION_PLACEMENT_YAWS_INVALID');
  if (!(placement.species instanceof Uint8Array) || placement.species.length !== count) throw new TypeError('VEGETATION_PLACEMENT_SPECIES_INVALID');
  if (placement.metadata?.authority !== 'renderer-only-synthetic') throw new Error('VEGETATION_AUTHORITY_MUST_REMAIN_SYNTHETIC');
  return count;
}

function geometryPayloadBytes(geometry) {
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) bytes += attribute?.array?.byteLength ?? 0;
  return bytes;
}

function geometryBufferCount(geometry) {
  return Object.keys(geometry.attributes ?? {}).length + (geometry.index ? 1 : 0);
}

function nearestPlacementIndices(placement, classId, limit) {
  const candidates = [];
  for (let index = 0; index < placement.count; index += 1) {
    if (placement.species[index] !== classId) continue;
    const offset = index * 3;
    const x = placement.positions[offset];
    const z = placement.positions[offset + 2];
    candidates.push({ index, distanceSquared: x * x + z * z });
  }
  candidates.sort((a, b) => a.distanceSquared - b.distanceSquared || a.index - b.index);
  return candidates.slice(0, limit).map(({ index }) => index);
}

function configureInstanceMesh(mesh, name) {
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = true;
  return mesh;
}

function composeTreeMatrix(matrix, position, quaternion, scale, placement, index, nativeHeightM) {
  const offset = index * 3;
  const targetHeightM = placement.heights[index];
  const uniformScale = targetHeightM / nativeHeightM;
  position.set(placement.positions[offset], placement.positions[offset + 1], placement.positions[offset + 2]);
  quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, placement.yaws[index]);
  scale.setScalar(uniformScale);
  matrix.compose(position, quaternion, scale);
  return matrix;
}

function materialsForInstancing(materials) {
  const resolved = materials.filter(Boolean);
  if (resolved.length === 0) throw new Error('POLY_HAVEN_TEMPLATE_MATERIAL_MISSING');
  return resolved.length === 1 ? resolved[0] : resolved;
}

function disposeMaterials(materials) {
  const materialSet = new Set();
  const textureSet = new Set();
  for (const material of materials) {
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) {
      if (!entry || materialSet.has(entry)) continue;
      materialSet.add(entry);
      for (const value of Object.values(entry)) if (value?.isTexture) textureSet.add(value);
    }
  }
  for (const texture of textureSet) texture.dispose?.();
  for (const material of materialSet) material.dispose?.();
}

export async function createThreeVegetationLayer({
  scene,
  placement,
  templates = null,
  templateLoader = loadPolyHavenVegetationTemplates,
  maxRenderedInstances = MAX_RENDERED_TREE_INSTANCES,
} = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('Three scene is required');
  const count = assertPlacement(placement);
  if (!(Number.isInteger(maxRenderedInstances) && maxRenderedInstances > 0)) throw new RangeError('maxRenderedInstances must be a positive integer');

  const loadedTemplates = templates ?? await templateLoader();
  if (!Array.isArray(loadedTemplates) || loadedTemplates.length === 0) throw new Error('POLY_HAVEN_VEGETATION_TEMPLATES_REQUIRED');
  if (loadedTemplates.some((template) => template?.asset?.provider !== 'Poly Haven' || template?.asset?.license !== 'CC0-1.0')) {
    throw new Error('VEGETATION_ASSET_PROVIDER_MUST_BE_POLY_HAVEN_CC0');
  }

  const coniferBudget = Math.min(MAX_CONIFER_INSTANCES, maxRenderedInstances);
  const broadleafBudget = Math.min(MAX_BROADLEAF_INSTANCES, Math.max(0, maxRenderedInstances - coniferBudget));
  const coniferIndices = nearestPlacementIndices(placement, 0, coniferBudget);
  const broadleafIndices = nearestPlacementIndices(placement, 1, broadleafBudget);
  const selectedByClass = new Map([[0, coniferIndices], [1, broadleafIndices]]);
  const templatesByClass = new Map();
  for (const template of loadedTemplates) {
    const classId = Number(template.asset.class_id);
    const list = templatesByClass.get(classId) ?? [];
    list.push(template);
    templatesByClass.set(classId, list);
  }
  for (const classId of [0, 1]) {
    if ((selectedByClass.get(classId)?.length ?? 0) > 0 && !(templatesByClass.get(classId)?.length > 0)) {
      throw new Error(`POLY_HAVEN_VEGETATION_CLASS_TEMPLATE_MISSING: ${classId}`);
    }
  }

  const meshes = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const assetSnapshots = [];
  let matrixPayloadBytes = 0;
  let sharedGeometryPayloadBytes = 0;
  let gpuBufferCount = 0;
  let selectedTriangleCount = 0;
  let estimatedRenderedTriangles = 0;

  for (const [classId, selectedIndices] of selectedByClass) {
    const classTemplates = templatesByClass.get(classId) ?? [];
    if (selectedIndices.length === 0 || classTemplates.length === 0) continue;
    const assignments = classTemplates.map(() => []);
    selectedIndices.forEach((placementIndex, sequence) => assignments[sequence % classTemplates.length].push(placementIndex));

    classTemplates.forEach((template, templateIndex) => {
      const indices = assignments[templateIndex];
      if (indices.length === 0) return;
      const nativeHeightM = Number(template.native_height_m);
      if (!(Number.isFinite(nativeHeightM) && nativeHeightM > 0.05)) throw new Error(`POLY_HAVEN_TEMPLATE_HEIGHT_INVALID: ${template.asset.id}`);
      const perAssetTriangles = Number(template.selected_triangle_count) || 0;
      selectedTriangleCount += perAssetTriangles;
      estimatedRenderedTriangles += perAssetTriangles * indices.length;
      const assetMeshStart = meshes.length;

      for (let partIndex = 0; partIndex < template.meshes.length; partIndex += 1) {
        const part = template.meshes[partIndex];
        const material = materialsForInstancing(part.materials ?? []);
        const mesh = configureInstanceMesh(
          new THREE.InstancedMesh(part.geometry, material, indices.length),
          `nwe-polyhaven-${template.asset.source_slug}-${partIndex}`,
        );
        indices.forEach((placementIndex, instanceIndex) => {
          mesh.setMatrixAt(instanceIndex, composeTreeMatrix(matrix, position, quaternion, scale, placement, placementIndex, nativeHeightM));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        scene.add(mesh);
        matrixPayloadBytes += indices.length * 16 * Float32Array.BYTES_PER_ELEMENT;
        sharedGeometryPayloadBytes += geometryPayloadBytes(part.geometry);
        gpuBufferCount += geometryBufferCount(part.geometry) + 1;
      }

      assetSnapshots.push(Object.freeze({
        id: template.asset.id,
        provider: template.asset.provider,
        license: template.asset.license,
        source_page: template.asset.source_page,
        source_request_url: template.asset.url,
        runtime_resolution: template.asset.runtime_resolution,
        lod_policy: template.asset.lod_policy,
        selected_lod: template.selected_lod,
        available_lods: [...(template.available_lods ?? [])],
        source_triangle_count: template.asset.source_triangle_count,
        selected_triangle_count: perAssetTriangles,
        selected_mesh_count: meshes.length - assetMeshStart,
        rendered_instances: indices.length,
        normalized_native_height_m: nativeHeightM,
      }));
    });
  }

  const renderedInstanceCount = coniferIndices.length + broadleafIndices.length;
  const gpuBufferPayloadBytes = matrixPayloadBytes + sharedGeometryPayloadBytes;
  const materialRefs = meshes.map((mesh) => mesh.material);
  const snapshot = () => ({
    schema: VEGETATION_RENDER_SCHEMA,
    authority: placement.metadata.authority,
    placement_schema: placement.schema,
    instance_count: count,
    rendered_instance_count: renderedInstanceCount,
    presentation_instance_cap: maxRenderedInstances,
    conifer_count: placement.metadata.conifer_count ?? Array.from(placement.species).filter((kind) => kind === 0).length,
    broadleaf_count: placement.metadata.broadleaf_count ?? Array.from(placement.species).filter((kind) => kind === 1).length,
    rendered_conifer_count: coniferIndices.length,
    rendered_broadleaf_count: broadleafIndices.length,
    draw_calls: meshes.length,
    mesh_count: meshes.length,
    gpu_buffer_count: gpuBufferCount,
    gpu_buffer_payload_bytes: gpuBufferPayloadBytes,
    instance_matrix_payload_bytes: matrixPayloadBytes,
    instance_color_payload_bytes: 0,
    shared_geometry_payload_bytes: sharedGeometryPayloadBytes,
    selected_template_triangles: selectedTriangleCount,
    estimated_rendered_triangles: estimatedRenderedTriangles,
    geometry_strategy: 'polyhaven-gltf-instanced-selected-lod',
    material_strategy: 'polyhaven-original-gltf-pbr-materials',
    source_asset_status: 'polyhaven-cc0-direct-1k-gltf; optimized-vendoring-pending',
    runtime_asset_dependency: 'external-cc0-renderer-assets',
    source_assets: assetSnapshots,
    placement: placement.metadata,
  });

  return {
    meshes,
    snapshot,
    dispose() {
      for (const mesh of meshes) scene.remove(mesh);
      for (const mesh of meshes) mesh.geometry?.dispose?.();
      disposeMaterials(materialRefs);
    },
  };
}
