import * as THREE from 'three/webgpu';

const VEGETATION_RENDER_SCHEMA = 'nwe.vegetation-render-layer/0.1';

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

function configureInstanceMesh(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = true;
  return mesh;
}

function composeMatrix(matrix, position, quaternion, scale, x, y, z, yaw, sx, sy, sz) {
  position.set(x, y, z);
  quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  scale.set(sx, sy, sz);
  matrix.compose(position, quaternion, scale);
  return matrix;
}

function geometryPayloadBytes(geometry) {
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) bytes += attribute?.array?.byteLength ?? 0;
  return bytes;
}

function geometryBufferCount(geometry) {
  return Object.keys(geometry.attributes ?? {}).length + (geometry.index ? 1 : 0);
}

function disposeInstancedMesh(mesh) {
  mesh.geometry.dispose();
  mesh.material.dispose();
}

export function createThreeVegetationLayer({ scene, placement } = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('Three scene is required');
  const count = assertPlacement(placement);
  const coniferCount = placement.metadata.conifer_count ?? Array.from(placement.species).filter((kind) => kind === 0).length;
  const broadleafCount = placement.metadata.broadleaf_count ?? count - coniferCount;

  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.68, 1, 7, 1, false);
  const coniferGeometry = new THREE.ConeGeometry(0.5, 1, 9, 3, false);
  const broadleafGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5f4934, roughness: 0.98, metalness: 0, flatShading: true });
  const coniferMaterial = new THREE.MeshStandardMaterial({ color: 0x315b38, roughness: 0.94, metalness: 0, flatShading: true });
  const broadleafMaterial = new THREE.MeshStandardMaterial({ color: 0x4c743d, roughness: 0.92, metalness: 0, flatShading: true });

  const trunks = configureInstanceMesh(new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count));
  const conifers = configureInstanceMesh(new THREE.InstancedMesh(coniferGeometry, coniferMaterial, coniferCount));
  const broadleaves = configureInstanceMesh(new THREE.InstancedMesh(broadleafGeometry, broadleafMaterial, broadleafCount));
  trunks.name = 'nwe-vegetation-trunks';
  conifers.name = 'nwe-vegetation-conifers';
  broadleaves.name = 'nwe-vegetation-broadleaves';

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  let coniferIndex = 0;
  let broadleafIndex = 0;

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const x = placement.positions[offset];
    const groundY = placement.positions[offset + 1];
    const z = placement.positions[offset + 2];
    const height = placement.heights[index];
    const yaw = placement.yaws[index];
    const kind = placement.species[index];
    const trunkHeight = height * (kind === 0 ? 0.38 : 0.46);
    const trunkRadius = Math.max(0.14, Math.min(0.42, height * 0.025));
    trunks.setMatrixAt(index, composeMatrix(matrix, position, quaternion, scale, x, groundY + trunkHeight * 0.5, z, yaw, trunkRadius * 2, trunkHeight, trunkRadius * 2));

    if (kind === 0) {
      const crownHeight = height * 0.78;
      const crownRadius = height * 0.20;
      conifers.setMatrixAt(coniferIndex, composeMatrix(matrix, position, quaternion, scale, x, groundY + height * 0.60, z, yaw, crownRadius * 2, crownHeight, crownRadius * 2));
      color.setHSL(0.34 + ((index % 7) - 3) * 0.003, 0.31, 0.29 + (index % 5) * 0.012);
      conifers.setColorAt(coniferIndex, color);
      coniferIndex += 1;
    } else {
      const crownWidth = height * 0.44;
      const crownHeight = height * 0.34;
      broadleaves.setMatrixAt(broadleafIndex, composeMatrix(matrix, position, quaternion, scale, x, groundY + height * 0.73, z, yaw, crownWidth, crownHeight, crownWidth));
      color.setHSL(0.28 + ((index % 9) - 4) * 0.004, 0.36, 0.34 + (index % 6) * 0.012);
      broadleaves.setColorAt(broadleafIndex, color);
      broadleafIndex += 1;
    }
  }

  for (const mesh of [trunks, conifers, broadleaves]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  scene.add(trunks, conifers, broadleaves);

  const meshes = [trunks, conifers, broadleaves];
  const drawCalls = meshes.filter((mesh) => mesh.count > 0).length;
  const matrixPayloadBytes = (count + coniferCount + broadleafCount) * 16 * Float32Array.BYTES_PER_ELEMENT;
  const colorPayloadBytes = (coniferCount + broadleafCount) * 3 * Float32Array.BYTES_PER_ELEMENT;
  const sharedGeometryPayloadBytes = geometryPayloadBytes(trunkGeometry) + geometryPayloadBytes(coniferGeometry) + geometryPayloadBytes(broadleafGeometry);
  const gpuBufferPayloadBytes = matrixPayloadBytes + colorPayloadBytes + sharedGeometryPayloadBytes;
  const gpuBufferCount = meshes.reduce((sum, mesh) => sum + geometryBufferCount(mesh.geometry) + 1 + (mesh.instanceColor ? 1 : 0), 0);
  const snapshot = () => ({
    schema: VEGETATION_RENDER_SCHEMA,
    authority: placement.metadata.authority,
    placement_schema: placement.schema,
    instance_count: count,
    conifer_count: coniferCount,
    broadleaf_count: broadleafCount,
    draw_calls: drawCalls,
    mesh_count: 3,
    gpu_buffer_count: gpuBufferCount,
    gpu_buffer_payload_bytes: gpuBufferPayloadBytes,
    instance_matrix_payload_bytes: matrixPayloadBytes,
    instance_color_payload_bytes: colorPayloadBytes,
    shared_geometry_payload_bytes: sharedGeometryPayloadBytes,
    geometry_strategy: 'three-instancedmesh-shared-lowpoly-primitives',
    material_strategy: 'three-shared-pbr-flat-shaded',
    source_asset: null,
    source_asset_status: 'procedural-proof; replaceable-by-vendored-cc0-tree-set',
    placement: placement.metadata,
  });

  return {
    meshes,
    snapshot,
    dispose() {
      scene.remove(trunks, conifers, broadleaves);
      disposeInstancedMesh(trunks);
      disposeInstancedMesh(conifers);
      disposeInstancedMesh(broadleaves);
    },
  };
}
