import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';

const FALLBACK_HEIGHT_M = 5;
const GROUND_LIFT_M = 0.085;

function polygonWithoutClosure(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter(([e, n]) => Number.isFinite(e) && Number.isFinite(n));
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function sampleTerrain(payload, easting, northing) {
  const header = payload.artifact.header;
  return sampleHeightGrid(payload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  });
}

function profileBudgets(profile) {
  switch (profile?.id) {
    case 'low': return { windows: 750, doors: 80 };
    case 'balanced': return { windows: 1600, doors: 110 };
    case 'high': return { windows: 3000, doors: 160 };
    case 'ultra': return { windows: 4800, doors: 200 };
    default: return { windows: 1600, doors: 110 };
  }
}

function typePolicy(feature) {
  const type = String(feature?.building ?? 'yes').toLowerCase();
  if (['garage', 'garages', 'shed', 'farm_auxiliary'].includes(type)) return { windows: false, doorWidth: 2.4, floorHeight: 3.0 };
  if (['warehouse', 'industrial', 'barn', 'farm'].includes(type)) return { windows: true, sparse: true, doorWidth: 2.8, floorHeight: 3.6 };
  return { windows: true, sparse: false, doorWidth: 1.0, floorHeight: 2.75 };
}

function worldToLocal(payload, easting, northing, heightOffset) {
  const origin = payload.mesh.metadata.origin;
  const ground = sampleTerrain(payload, easting, northing);
  return new THREE.Vector3(easting - origin[0], ground - origin[2] + GROUND_LIFT_M + heightOffset, origin[1] - northing);
}

function matrix(position, yaw, scale) {
  const object = new THREE.Object3D();
  object.position.copy(position);
  object.rotation.y = yaw;
  object.scale.set(scale[0], scale[1], scale[2]);
  object.updateMatrix();
  return object.matrix;
}

function wallHeight(feature) {
  const total = Number(feature?.height_m);
  const height = Number.isFinite(total) && total > 0 ? total : FALLBACK_HEIGHT_M;
  if (feature?.presentation_roof_shape === 'gabled') {
    const rise = Number(feature?.presentation_gable_rise_m);
    if (Number.isFinite(rise) && rise > 0 && height - rise >= 1.5) return height - Math.min(rise, height * 0.45, 5);
  }
  return height;
}

function deterministicIndex(feature, edgeCount) {
  const source = String(feature?.source_id ?? feature?.id ?? '0');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return edgeCount > 0 ? (hash >>> 0) % edgeCount : 0;
}

function pushFacadeInstances(feature, payload, windowTransforms, doorTransforms, budgets) {
  const polygon = polygonWithoutClosure(feature?.polygon);
  if (polygon.length < 3) return;
  const policy = typePolicy(feature);
  const height = wallHeight(feature);
  const floors = Math.max(1, Math.min(6, Math.floor(height / policy.floorHeight)));
  const doorEdgeIndex = deterministicIndex(feature, polygon.length);

  for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
    const a = polygon[edgeIndex];
    const b = polygon[(edgeIndex + 1) % polygon.length];
    const de = b[0] - a[0];
    const dn = b[1] - a[1];
    const length = Math.hypot(de, dn);
    if (!(length > 1.2)) continue;
    const yaw = Math.atan2(dn, de);
    const ux = de / length;
    const un = dn / length;

    if (edgeIndex === doorEdgeIndex && doorTransforms.length < budgets.doors && length >= policy.doorWidth + 0.5) {
      const e = (a[0] + b[0]) * 0.5;
      const n = (a[1] + b[1]) * 0.5;
      doorTransforms.push(matrix(worldToLocal(payload, e, n, 1.05), yaw, [policy.doorWidth, 2.1, 1]));
    }

    if (!policy.windows || windowTransforms.length >= budgets.windows || length < 2.2) continue;
    const spacing = policy.sparse ? 3.8 : 2.45;
    const columns = Math.max(1, Math.min(10, Math.floor((length - 0.8) / spacing)));
    for (let floor = 0; floor < floors && windowTransforms.length < budgets.windows; floor += 1) {
      if (policy.sparse && floor > 1) break;
      const centerHeight = Math.min(height - 0.7, 1.55 + floor * policy.floorHeight);
      if (!(centerHeight > 0.7)) continue;
      for (let column = 0; column < columns && windowTransforms.length < budgets.windows; column += 1) {
        const along = length * (column + 1) / (columns + 1);
        if (edgeIndex === doorEdgeIndex && floor === 0 && Math.abs(along - length * 0.5) < policy.doorWidth * 0.75) continue;
        const e = a[0] + ux * along;
        const n = a[1] + un * along;
        const width = policy.sparse ? 0.85 : 1.05;
        const paneHeight = policy.sparse ? 0.85 : 1.15;
        windowTransforms.push(matrix(worldToLocal(payload, e, n, centerHeight), yaw, [width, paneHeight, 1]));
      }
    }
  }
}

function makeInstanced(root, geometry, material, transforms, name, shadow) {
  if (!transforms.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  transforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere?.();
  root.add(mesh);
  return mesh;
}

export function createThreeBuildingFacadeLayer({ buildingsArtifact, terrainPayload, profile } = {}) {
  if (!Array.isArray(buildingsArtifact?.features)) throw new TypeError('BUILDING_FACADE_FEATURES_REQUIRED');
  if (!terrainPayload?.artifact?.header || !(terrainPayload?.elevations instanceof Float32Array)) throw new TypeError('BUILDING_FACADE_TERRAIN_REQUIRED');
  const budgets = profileBudgets(profile);
  const windowTransforms = [];
  const doorTransforms = [];
  for (const feature of buildingsArtifact.features) {
    if (windowTransforms.length >= budgets.windows && doorTransforms.length >= budgets.doors) break;
    pushFacadeInstances(feature, terrainPayload, windowTransforms, doorTransforms, budgets);
  }

  const root = new THREE.Group();
  root.name = 'NWE_Building_Facade_Detail';
  const windowGeometry = new THREE.BoxGeometry(1, 1, 0.055);
  const doorGeometry = new THREE.BoxGeometry(1, 1, 0.075);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x30434a, roughness: 0.42, metalness: 0.08 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x594333, roughness: 0.82, metalness: 0 });
  const windowMesh = makeInstanced(root, windowGeometry, windowMaterial, windowTransforms, 'NWE_Procedural_Windows', false);
  const doorMesh = makeInstanced(root, doorGeometry, doorMaterial, doorTransforms, 'NWE_Procedural_Doors', true);

  function dispose() {
    root.removeFromParent();
    windowGeometry.dispose();
    doorGeometry.dispose();
    windowMaterial.dispose();
    doorMaterial.dispose();
  }

  return Object.freeze({
    root,
    dispose,
    stats: Object.freeze({
      schema: 'nwe.three-building-facade-layer/0.1',
      source_building_count: buildingsArtifact.features.length,
      rendered_window_count: windowTransforms.length,
      rendered_door_count: doorTransforms.length,
      draw_calls: Number(Boolean(windowMesh)) + Number(Boolean(doorMesh)),
      profile: profile?.id ?? 'unknown',
      budgets: Object.freeze({ ...budgets }),
      semantics: 'deterministic-renderer-only-facade-detail-over-source-footprints-and-best-available-building-height',
      truth_guard: 'window and door positions/counts/dimensions are not source-backed and must never be presented as observed Nannestad facade truth',
    }),
  });
}
