import * as THREE from 'three/webgpu';

function hashUnit(text, salt = '') {
  const value = `${text}:${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function paletteFor(group) {
  if (group === 'spruce') return { crown: 0x244d2b, crown2: 0x315f36, trunk: 0x4b3828 };
  if (group === 'pine' || group === 'conifer-mixed') return { crown: 0x365b36, crown2: 0x496b3f, trunk: 0x5a402b };
  if (group === 'mixed') return { crown: 0x496f37, crown2: 0x668546, trunk: 0x594334 };
  return { crown: 0x567a3d, crown2: 0x769451, trunk: 0x5d4634 };
}

function category(group) {
  if (group === 'spruce') return 'spruce';
  if (group === 'pine' || group === 'conifer-mixed') return 'pine';
  return 'deciduous';
}

function makeMaterials(group) {
  const palette = paletteFor(group);
  return {
    trunk: new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 0.96, metalness: 0 }),
    crown: new THREE.MeshStandardMaterial({ color: palette.crown, roughness: 0.9, metalness: 0 }),
    crown2: new THREE.MeshStandardMaterial({ color: palette.crown2, roughness: 0.88, metalness: 0 }),
  };
}

function addInstancedPart(group, geometry, material, count, shadowMode) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = shadowMode;
  mesh.receiveShadow = shadowMode;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = true;
  group.add(mesh);
  return mesh;
}

function coniferMeshes(container, count, groupName, shadowMode) {
  const materials = makeMaterials(groupName);
  const trunk = addInstancedPart(container, new THREE.CylinderGeometry(0.11, 0.18, 1, 7), materials.trunk, count, shadowMode);
  const lower = addInstancedPart(container, new THREE.ConeGeometry(0.48, 1, 9), materials.crown, count, shadowMode);
  const upper = addInstancedPart(container, new THREE.ConeGeometry(0.34, 1, 9), materials.crown2, count, shadowMode);
  return { trunk, lower, upper, materials };
}

function broadleafMeshes(container, count, groupName, shadowMode) {
  const materials = makeMaterials(groupName);
  const trunk = addInstancedPart(container, new THREE.CylinderGeometry(0.12, 0.2, 1, 7), materials.trunk, count, shadowMode);
  const crown = addInstancedPart(container, new THREE.IcosahedronGeometry(0.5, 1), materials.crown, count, shadowMode);
  const crown2 = addInstancedPart(container, new THREE.IcosahedronGeometry(0.5, 1), materials.crown2, count, shadowMode);
  return { trunk, crown, crown2, materials };
}

function matrixFor(position, yaw, scale, offsetY = 0) {
  const object = new THREE.Object3D();
  object.position.set(position[0], position[1] + offsetY, position[2]);
  object.rotation.y = yaw;
  object.scale.set(scale[0], scale[1], scale[2]);
  object.updateMatrix();
  return object.matrix;
}

function configureConifer(meshes, item, index, groupName) {
  const height = item.visual_height_m;
  const variation = 0.88 + hashUnit(item.id, 'height') * 0.24;
  const crownWidth = height * (groupName === 'spruce' ? 0.24 : 0.28) * (0.86 + hashUnit(item.id, 'width') * 0.28);
  const trunkHeight = height * 0.48;
  const crownHeight = height * 0.78;
  const yaw = item.yaw_rad;
  meshes.trunk.setMatrixAt(index, matrixFor(item.local_position, yaw, [Math.max(0.75, height * 0.075), trunkHeight, Math.max(0.75, height * 0.075)], trunkHeight * 0.5));
  meshes.lower.setMatrixAt(index, matrixFor(item.local_position, yaw, [crownWidth, crownHeight * 0.64, crownWidth], height * 0.54));
  meshes.upper.setMatrixAt(index, matrixFor(item.local_position, yaw + 0.7, [crownWidth * 0.72, crownHeight * 0.48, crownWidth * 0.72], height * 0.73));
  return height * variation;
}

function configureBroadleaf(meshes, item, index) {
  const height = item.visual_height_m;
  const trunkHeight = Math.max(2.4, height * 0.58);
  const crownDiameter = Math.max(2.8, height * (0.46 + hashUnit(item.id, 'crown') * 0.12));
  const yaw = item.yaw_rad;
  meshes.trunk.setMatrixAt(index, matrixFor(item.local_position, yaw, [Math.max(0.8, height * 0.085), trunkHeight, Math.max(0.8, height * 0.085)], trunkHeight * 0.5));
  meshes.crown.setMatrixAt(index, matrixFor(item.local_position, yaw, [crownDiameter, crownDiameter * 0.78, crownDiameter * 0.9], trunkHeight + crownDiameter * 0.2));
  meshes.crown2.setMatrixAt(index, matrixFor(item.local_position, yaw + 1.1, [crownDiameter * 0.72, crownDiameter * 0.56, crownDiameter * 0.7], trunkHeight + crownDiameter * 0.52));
}

export function createThreeVegetationLayer({ placement, profile } = {}) {
  if (placement?.schema !== 'nwe.web-vegetation-placement/0.1') throw new TypeError('THREE_VEGETATION_PLACEMENT_REQUIRED');
  const source = placement.instances ?? [];
  const requestedBudget = Number(profile?.vegetationInstanceBudget);
  const budget = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.floor(requestedBudget) : source.length;
  const visible = source.slice(0, Math.min(source.length, budget));
  const byCategory = new Map([['spruce', []], ['pine', []], ['deciduous', []]]);
  for (const item of visible) byCategory.get(category(item.species_group)).push(item);

  const root = new THREE.Group();
  root.name = 'NWE_Nannestad_Vegetation';
  const disposableGeometries = new Set();
  const disposableMaterials = new Set();
  let drawCalls = 0;
  let meshCount = 0;
  const shadowMode = profile?.shadows !== false;

  for (const [groupName, items] of byCategory) {
    if (!items.length) continue;
    const meshes = groupName === 'deciduous'
      ? broadleafMeshes(root, items.length, groupName, shadowMode)
      : coniferMeshes(root, items.length, groupName, shadowMode);
    for (const value of Object.values(meshes)) {
      if (value?.isInstancedMesh) {
        meshCount += 1;
        drawCalls += 1;
        disposableGeometries.add(value.geometry);
      }
    }
    for (const material of Object.values(meshes.materials)) disposableMaterials.add(material);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (groupName === 'deciduous') configureBroadleaf(meshes, item, index);
      else configureConifer(meshes, item, index, groupName);
    }
    for (const value of Object.values(meshes)) {
      if (value?.isInstancedMesh) {
        value.instanceMatrix.needsUpdate = true;
        value.computeBoundingSphere?.();
      }
    }
  }

  function dispose() {
    root.removeFromParent();
    for (const geometry of disposableGeometries) geometry.dispose();
    for (const material of disposableMaterials) material.dispose();
  }

  return Object.freeze({
    root,
    dispose,
    stats: Object.freeze({
      schema: 'nwe.three-vegetation-layer/0.1',
      source_representative_count: source.length,
      rendered_representative_count: visible.length,
      mesh_count: meshCount,
      draw_calls: drawCalls,
      renderer_strategy: 'instanced-source-backed-representatives-with-procedural-lod-proxy',
      source_semantics: placement.stats.placement_semantics,
      tree_groups: Object.freeze(Object.fromEntries([...byCategory].map(([key, value]) => [key, value.length]))),
      near_field_authored_asset: false,
      truth_guard: 'individual meshes are renderer proxies; no exact individual-tree observation is claimed',
    }),
  });
}
