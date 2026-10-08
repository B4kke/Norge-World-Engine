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
  if (group === 'spruce') return { crown: 0x183f25, trunk: 0x473526 };
  if (group === 'pine' || group === 'conifer-mixed') return { crown: 0x2f5532, trunk: 0x65432d };
  if (group === 'mixed') return { crown: 0x4e7037, trunk: 0x5b4433 };
  return { crown: 0x5b7d3d, trunk: 0x604735 };
}

function category(group) {
  if (group === 'spruce') return 'spruce';
  if (group === 'pine' || group === 'conifer-mixed') return 'pine';
  return 'deciduous';
}

function makeMaterials(group) {
  const palette = paletteFor(group);
  return {
    trunk: new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 0.97, metalness: 0 }),
    crown: new THREE.MeshStandardMaterial({ color: palette.crown, roughness: 0.92, metalness: 0 }),
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

function createCategoryMeshes(container, count, groupName, shadowMode) {
  const materials = makeMaterials(groupName);
  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.2, 1, 7, 1, false);
  const crownGeometry = groupName === 'deciduous'
    ? new THREE.DodecahedronGeometry(0.5, 0)
    : new THREE.ConeGeometry(0.5, 1, 10, 1, false);
  const crownInstancesPerTree = groupName === 'deciduous' ? 5 : 4;
  return {
    trunk: addInstancedPart(container, trunkGeometry, materials.trunk, count, shadowMode),
    crown: addInstancedPart(container, crownGeometry, materials.crown, count * crownInstancesPerTree, shadowMode),
    crownInstancesPerTree,
    materials,
  };
}

function matrixFor(position, yaw, scale, offset = [0, 0, 0], rotation = [0, 0, 0]) {
  const object = new THREE.Object3D();
  object.position.set(position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]);
  object.rotation.set(rotation[0], yaw + rotation[1], rotation[2]);
  object.scale.set(scale[0], scale[1], scale[2]);
  object.updateMatrix();
  return object.matrix;
}

function configureConifer(meshes, item, treeIndex, groupName) {
  const height = item.visual_height_m;
  const yaw = item.yaw_rad;
  const pine = groupName === 'pine';
  const trunkHeight = Math.max(2.1, height * (pine ? 0.58 : 0.48));
  const trunkRadiusScale = Math.max(0.7, height * 0.065);
  meshes.trunk.setMatrixAt(
    treeIndex,
    matrixFor(item.local_position, yaw, [trunkRadiusScale, trunkHeight, trunkRadiusScale], [0, trunkHeight * 0.5, 0]),
  );

  const baseWidth = height * (pine ? 0.22 : 0.25) * (0.88 + hashUnit(item.id, 'width') * 0.24);
  const crownBaseY = height * (pine ? 0.48 : 0.34);
  const crownTopY = height * 0.95;
  const span = crownTopY - crownBaseY;
  for (let tier = 0; tier < meshes.crownInstancesPerTree; tier += 1) {
    const t = tier / (meshes.crownInstancesPerTree - 1);
    const width = baseWidth * (1 - t * 0.55) * (0.92 + hashUnit(item.id, `tier-width-${tier}`) * 0.16);
    const tierHeight = Math.max(1.5, span * (0.54 - t * 0.08));
    const radialOffset = tier === 0 ? 0 : (hashUnit(item.id, `tier-offset-${tier}`) - 0.5) * width * 0.14;
    const angle = yaw + hashUnit(item.id, `tier-angle-${tier}`) * Math.PI * 2;
    const offset = [
      Math.cos(angle) * radialOffset,
      crownBaseY + span * (0.17 + t * 0.26),
      Math.sin(angle) * radialOffset,
    ];
    const leanX = (hashUnit(item.id, `tier-lean-x-${tier}`) - 0.5) * 0.08;
    const leanZ = (hashUnit(item.id, `tier-lean-z-${tier}`) - 0.5) * 0.08;
    meshes.crown.setMatrixAt(
      treeIndex * meshes.crownInstancesPerTree + tier,
      matrixFor(item.local_position, yaw + tier * 0.63, [width, tierHeight, width], offset, [leanX, 0, leanZ]),
    );
  }
}

function configureBroadleaf(meshes, item, treeIndex) {
  const height = item.visual_height_m;
  const yaw = item.yaw_rad;
  const trunkHeight = Math.max(2.6, height * 0.53);
  const trunkRadiusScale = Math.max(0.75, height * 0.075);
  meshes.trunk.setMatrixAt(
    treeIndex,
    matrixFor(item.local_position, yaw, [trunkRadiusScale, trunkHeight, trunkRadiusScale], [0, trunkHeight * 0.5, 0]),
  );

  const crownDiameter = Math.max(2.7, height * (0.42 + hashUnit(item.id, 'crown') * 0.12));
  const lobePattern = [
    [0, 0.22, 0, 0.82],
    [-0.24, 0.04, 0.05, 0.64],
    [0.24, 0.08, -0.04, 0.68],
    [-0.05, 0.08, -0.24, 0.62],
    [0.08, 0.12, 0.24, 0.60],
  ];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (let lobe = 0; lobe < meshes.crownInstancesPerTree; lobe += 1) {
    const [localX, localY, localZ, baseScale] = lobePattern[lobe];
    const jitter = 0.92 + hashUnit(item.id, `lobe-${lobe}`) * 0.18;
    const x = localX * crownDiameter;
    const z = localZ * crownDiameter;
    const rotatedX = x * cos - z * sin;
    const rotatedZ = x * sin + z * cos;
    const lobeScale = crownDiameter * baseScale * jitter;
    const offset = [rotatedX, trunkHeight + crownDiameter * (0.18 + localY), rotatedZ];
    meshes.crown.setMatrixAt(
      treeIndex * meshes.crownInstancesPerTree + lobe,
      matrixFor(
        item.local_position,
        yaw + hashUnit(item.id, `lobe-yaw-${lobe}`) * Math.PI,
        [lobeScale, lobeScale * (0.78 + hashUnit(item.id, `lobe-y-${lobe}`) * 0.14), lobeScale * (0.88 + hashUnit(item.id, `lobe-z-${lobe}`) * 0.18)],
        offset,
        [(hashUnit(item.id, `lobe-rx-${lobe}`) - 0.5) * 0.18, 0, (hashUnit(item.id, `lobe-rz-${lobe}`) - 0.5) * 0.18],
      ),
    );
  }
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
  let crownProxyInstances = 0;
  const shadowMode = profile?.shadows !== false;

  for (const [groupName, items] of byCategory) {
    if (!items.length) continue;
    const meshes = createCategoryMeshes(root, items.length, groupName, shadowMode);
    crownProxyInstances += items.length * meshes.crownInstancesPerTree;
    for (const key of ['trunk', 'crown']) {
      const value = meshes[key];
      meshCount += 1;
      drawCalls += 1;
      disposableGeometries.add(value.geometry);
    }
    for (const material of Object.values(meshes.materials)) disposableMaterials.add(material);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (groupName === 'deciduous') configureBroadleaf(meshes, item, index);
      else configureConifer(meshes, item, index, groupName);
    }
    for (const key of ['trunk', 'crown']) {
      meshes[key].instanceMatrix.needsUpdate = true;
      meshes[key].computeBoundingSphere?.();
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
      schema: 'nwe.three-vegetation-layer/0.2',
      source_representative_count: source.length,
      rendered_representative_count: visible.length,
      crown_proxy_instance_count: crownProxyInstances,
      mesh_count: meshCount,
      draw_calls: drawCalls,
      renderer_strategy: 'instanced-source-backed-representatives-with-multi-lobe-naturalized-proxy',
      source_semantics: placement.stats.placement_semantics,
      tree_groups: Object.freeze(Object.fromEntries([...byCategory].map(([key, value]) => [key, value.length]))),
      near_field_authored_asset: false,
      truth_guard: 'individual meshes are renderer proxies; no exact individual-tree observation is claimed',
    }),
  });
}
