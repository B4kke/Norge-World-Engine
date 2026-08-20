import * as THREE from 'three/webgpu';
import { loadPolyHavenVegetationTemplates } from './polyHavenVegetationAssets.mjs';

const VEGETATION_RENDER_SCHEMA = 'nwe.vegetation-render-layer/0.4';
const DEFAULT_NEAR_DETAIL_CONIFERS = 16;

function assertPlacement(placement) {
  if (placement?.schema !== 'nwe.forge-vegetation-render-placement/0.1') throw new TypeError('VEGETATION_PLACEMENT_SCHEMA_INVALID');
  const count = Number(placement.count);
  if (!Number.isInteger(count) || count < 0) throw new TypeError('VEGETATION_PLACEMENT_COUNT_INVALID');
  if (!(placement.positions instanceof Float32Array) || placement.positions.length !== count * 3) throw new TypeError('VEGETATION_PLACEMENT_POSITIONS_INVALID');
  if (!(placement.heights instanceof Float32Array) || placement.heights.length !== count) throw new TypeError('VEGETATION_PLACEMENT_HEIGHTS_INVALID');
  if (!(placement.yaws instanceof Float32Array) || placement.yaws.length !== count) throw new TypeError('VEGETATION_PLACEMENT_YAWS_INVALID');
  if (!(placement.species instanceof Uint8Array) || placement.species.length !== count) throw new TypeError('VEGETATION_PLACEMENT_SPECIES_INVALID');
  if (placement.metadata?.authority !== 'forge-derived-representative-distribution' || placement.metadata?.individual_tree_truth !== false) {
    throw new Error('VEGETATION_AUTHORITY_INVALID');
  }
  return count;
}

function configureInstanceMesh(mesh, name, { castShadow = true } = {}) {
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = true;
  return mesh;
}

function placementIndices(placement, species) {
  const output = [];
  for (let index = 0; index < placement.count; index += 1) if (placement.species[index] === species) output.push(index);
  return output;
}

function nearestPlacementIndices(placement, species, limit) {
  const candidates = [];
  for (let index = 0; index < placement.count; index += 1) {
    if (placement.species[index] !== species) continue;
    const offset = index * 3;
    const x = placement.positions[offset];
    const z = placement.positions[offset + 2];
    candidates.push({ index, distanceSquared: x * x + z * z });
  }
  candidates.sort((a, b) => a.distanceSquared - b.distanceSquared || a.index - b.index);
  return candidates.slice(0, limit).map(({ index }) => index);
}

function makeProxyGeometry() {
  const coniferCrown = new THREE.ConeGeometry(1, 1, 8, 2, false);
  coniferCrown.translate(0, 0.5, 0);
  const coniferTrunk = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
  coniferTrunk.translate(0, 0.5, 0);
  const broadleafCrown = new THREE.IcosahedronGeometry(0.5, 1);
  const broadleafTrunk = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
  broadleafTrunk.translate(0, 0.5, 0);
  return { coniferCrown, coniferTrunk, broadleafCrown, broadleafTrunk };
}

function makeProxyMaterials() {
  return {
    coniferCrown: new THREE.MeshStandardMaterial({ color: 0x264c31, roughness: 0.96, metalness: 0 }),
    coniferTrunk: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, metalness: 0 }),
    broadleafCrown: new THREE.MeshStandardMaterial({ color: 0x476b35, roughness: 0.96, metalness: 0 }),
    broadleafTrunk: new THREE.MeshStandardMaterial({ color: 0x66503a, roughness: 1, metalness: 0 }),
  };
}

function composeProxyMatrix(matrix, position, quaternion, scale, placement, index, kind) {
  const offset = index * 3;
  const x = placement.positions[offset];
  const groundY = placement.positions[offset + 1];
  const z = placement.positions[offset + 2];
  const height = placement.heights[index];
  quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, placement.yaws[index]);

  if (kind === 'conifer-crown') {
    position.set(x, groundY + height * 0.16, z);
    scale.set(height * 0.21, height * 0.84, height * 0.21);
  } else if (kind === 'conifer-trunk') {
    position.set(x, groundY, z);
    scale.set(height * 0.025, height * 0.42, height * 0.025);
  } else if (kind === 'broadleaf-crown') {
    position.set(x, groundY + height * 0.70, z);
    scale.set(height * 0.30, height * 0.46, height * 0.28);
  } else {
    position.set(x, groundY, z);
    scale.set(height * 0.03, height * 0.58, height * 0.03);
  }
  matrix.compose(position, quaternion, scale);
  return matrix;
}

function addProxyMesh(scene, geometry, material, indices, placement, kind, name) {
  if (indices.length === 0) return null;
  // These proxies are deliberately cheap distant silhouettes. Letting their low-poly
  // cone/icosahedron shapes cast into the bounded player shadow map creates huge hard
  // black polygons on asphalt. Real/detail vegetation may cast shadows; proxy LODs do not.
  const mesh = configureInstanceMesh(new THREE.InstancedMesh(geometry, material, indices.length), name, { castShadow: false });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  indices.forEach((placementIndex, instanceIndex) => {
    mesh.setMatrixAt(instanceIndex, composeProxyMatrix(matrix, position, quaternion, scale, placement, placementIndex, kind));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

function geometryPayloadBytes(geometry) {
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) bytes += attribute?.array?.byteLength ?? 0;
  return bytes;
}

function geometryTriangles(geometry) {
  const count = geometry.index?.count ?? geometry.getAttribute?.('position')?.count ?? 0;
  return Math.floor(count / 3);
}

function materialsForInstancing(materials) {
  const resolved = materials.filter(Boolean);
  if (resolved.length === 0) throw new Error('POLY_HAVEN_TEMPLATE_MATERIAL_MISSING');
  return resolved.length === 1 ? resolved[0] : resolved;
}

function composeDetailedMatrix(matrix, position, quaternion, scale, placement, index, nativeHeightM) {
  const offset = index * 3;
  const targetHeightM = placement.heights[index];
  const uniformScale = targetHeightM / nativeHeightM;
  position.set(placement.positions[offset], placement.positions[offset + 1], placement.positions[offset + 2]);
  quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, placement.yaws[index]);
  scale.setScalar(uniformScale);
  matrix.compose(position, quaternion, scale);
  return matrix;
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
  templateLoader = loadPolyHavenVegetationTemplates,
  templates = null,
  nearDetailConifers = DEFAULT_NEAR_DETAIL_CONIFERS,
  enableDetailedAssets = true,
} = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('Three scene is required');
  const count = assertPlacement(placement);
  if (!(Number.isInteger(nearDetailConifers) && nearDetailConifers >= 0)) throw new RangeError('nearDetailConifers must be a non-negative integer');

  const geometries = makeProxyGeometry();
  const materials = makeProxyMaterials();
  const conifers = placementIndices(placement, 0);
  const broadleaves = placementIndices(placement, 1);
  const proxyMeshes = [
    addProxyMesh(scene, geometries.coniferCrown, materials.coniferCrown, conifers, placement, 'conifer-crown', 'nwe-vegetation-conifer-crown'),
    addProxyMesh(scene, geometries.coniferTrunk, materials.coniferTrunk, conifers, placement, 'conifer-trunk', 'nwe-vegetation-conifer-trunk'),
    addProxyMesh(scene, geometries.broadleafCrown, materials.broadleafCrown, broadleaves, placement, 'broadleaf-crown', 'nwe-vegetation-broadleaf-crown'),
    addProxyMesh(scene, geometries.broadleafTrunk, materials.broadleafTrunk, broadleaves, placement, 'broadleaf-trunk', 'nwe-vegetation-broadleaf-trunk'),
  ].filter(Boolean);

  const proxyGeometryPayloadBytes = Object.values(geometries).reduce((sum, geometry) => sum + geometryPayloadBytes(geometry), 0);
  const proxyMatrixPayloadBytes = proxyMeshes.reduce((sum, mesh) => sum + mesh.count * 16 * Float32Array.BYTES_PER_ELEMENT, 0);
  const proxyTrianglesPerInstance = {
    conifer: geometryTriangles(geometries.coniferCrown) + geometryTriangles(geometries.coniferTrunk),
    broadleaf: geometryTriangles(geometries.broadleafCrown) + geometryTriangles(geometries.broadleafTrunk),
  };

  const detailState = {
    status: enableDetailedAssets && nearDetailConifers > 0 && conifers.length > 0 ? 'loading' : 'disabled',
    error: null,
    rendered_instances: 0,
    draw_calls: 0,
    estimated_triangles: 0,
    assets: [],
  };
  const detailMeshes = [];
  let disposed = false;

  const detailReady = detailState.status === 'loading'
    ? Promise.resolve(templates ?? templateLoader()).then((loadedTemplates) => {
      if (disposed) return detailState;
      const compatible = (loadedTemplates ?? []).filter((template) => template?.asset?.class_id === 0 && template?.asset?.provider === 'Poly Haven' && template?.asset?.license === 'CC0-1.0');
      if (compatible.length === 0) throw new Error('POLY_HAVEN_CONIFER_TEMPLATES_REQUIRED');
      const selectedIndices = nearestPlacementIndices(placement, 0, Math.min(nearDetailConifers, conifers.length));
      const assignments = compatible.map(() => []);
      selectedIndices.forEach((placementIndex, sequence) => assignments[sequence % compatible.length].push(placementIndex));
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();

      compatible.forEach((template, templateIndex) => {
        const indices = assignments[templateIndex];
        if (indices.length === 0) return;
        const nativeHeightM = Number(template.native_height_m);
        if (!(Number.isFinite(nativeHeightM) && nativeHeightM > 0.05)) throw new Error(`POLY_HAVEN_TEMPLATE_HEIGHT_INVALID: ${template.asset.id}`);
        for (let partIndex = 0; partIndex < template.meshes.length; partIndex += 1) {
          const part = template.meshes[partIndex];
          const mesh = configureInstanceMesh(
            new THREE.InstancedMesh(part.geometry, materialsForInstancing(part.materials ?? []), indices.length),
            `nwe-polyhaven-near-${template.asset.source_slug}-${partIndex}`,
            { castShadow: true },
          );
          indices.forEach((placementIndex, instanceIndex) => {
            mesh.setMatrixAt(instanceIndex, composeDetailedMatrix(matrix, position, quaternion, scale, placement, placementIndex, nativeHeightM));
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          detailMeshes.push(mesh);
          scene.add(mesh);
          detailState.draw_calls += 1;
        }
        const selectedTriangles = Number(template.selected_triangle_count) || 0;
        detailState.estimated_triangles += selectedTriangles * indices.length;
        detailState.rendered_instances += indices.length;
        detailState.assets.push({
          id: template.asset.id,
          provider: template.asset.provider,
          license: template.asset.license,
          source_page: template.asset.source_page,
          runtime_resolution: template.asset.runtime_resolution,
          selected_lod: template.selected_lod,
          rendered_instances: indices.length,
          selected_triangle_count: selectedTriangles,
        });
      });
      detailState.status = 'ready';
      return detailState;
    }).catch((error) => {
      detailState.status = 'failed';
      detailState.error = error instanceof Error ? error.message : String(error);
      return detailState;
    })
    : Promise.resolve(detailState);

  const snapshot = () => ({
    schema: VEGETATION_RENDER_SCHEMA,
    authority: placement.metadata.authority,
    individual_tree_truth: false,
    placement_schema: placement.schema,
    source_artifact_sha256: placement.metadata.source_artifact_sha256,
    source_semantic_sha256: placement.metadata.source_semantic_sha256,
    source_instance_count: placement.metadata.source_instance_count,
    accepted_instance_count: count,
    rendered_proxy_instance_count: count,
    conifer_count: placement.metadata.conifer_count ?? conifers.length,
    broadleaf_count: placement.metadata.broadleaf_count ?? broadleaves.length,
    proxy_draw_calls: proxyMeshes.length,
    proxy_mesh_count: proxyMeshes.length,
    proxy_shadow_policy: 'receive-only-distant-lod; detailed-assets-may-cast',
    proxy_geometry_payload_bytes: proxyGeometryPayloadBytes,
    proxy_instance_matrix_payload_bytes: proxyMatrixPayloadBytes,
    proxy_estimated_triangles: proxyTrianglesPerInstance.conifer * conifers.length + proxyTrianglesPerInstance.broadleaf * broadleaves.length,
    proxy_geometry_strategy: 'instanced-renderer-lod-cone-icosahedron-trunks',
    proxy_material_strategy: 'bounded-pbr-foliage-and-bark',
    detailed_asset_strategy: 'async-nearest-conifers-polyhaven-cc0-1k-fail-soft',
    detailed_asset_state: { ...detailState, assets: detailState.assets.map((asset) => ({ ...asset })) },
    placement: placement.metadata,
  });

  return {
    meshes: proxyMeshes,
    detailMeshes,
    detailReady,
    snapshot,
    dispose() {
      disposed = true;
      for (const mesh of [...proxyMeshes, ...detailMeshes]) scene.remove(mesh);
      for (const geometry of Object.values(geometries)) geometry.dispose?.();
      for (const material of Object.values(materials)) material.dispose?.();
      const seenGeometries = new Set();
      const seenMaterials = new Set();
      const seenTextures = new Set();
      for (const mesh of detailMeshes) {
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
