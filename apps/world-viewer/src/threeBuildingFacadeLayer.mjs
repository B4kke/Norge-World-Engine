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
    case 'low': return { windows: 650, doors: 70 };
    case 'balanced': return { windows: 1450, doors: 105 };
    case 'high': return { windows: 2700, doors: 155 };
    case 'ultra': return { windows: 4300, doors: 195 };
    default: return { windows: 1450, doors: 105 };
  }
}

function typePolicy(feature) {
  const type = String(feature?.building ?? 'yes').toLowerCase();
  if (['garage', 'garages', 'shed', 'farm_auxiliary'].includes(type)) return { windows: false, doorWidth: 2.4, floorHeight: 3.0 };
  if (['warehouse', 'industrial', 'barn', 'farm'].includes(type)) return { windows: true, sparse: true, doorWidth: 2.8, floorHeight: 3.6 };
  return { windows: true, sparse: false, doorWidth: 1.0, floorHeight: 2.75 };
}

function worldToLocal(payload, easting, northing, heightOffset, wallGroundM = null, outward = [0, 0]) {
  const origin = payload.mesh.metadata.origin;
  const ground = Number.isFinite(wallGroundM) ? wallGroundM : sampleTerrain(payload, easting, northing);
  // These are renderer-only decorative panels. Offset outward so their
  // back faces touch, rather than become half-buried inside, the solid wall.
  return new THREE.Vector3(
    easting + outward[0] * 0.04 - origin[0],
    ground - origin[2] + GROUND_LIFT_M + heightOffset,
    origin[1] - northing - outward[1] * 0.04,
  );
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
  const signedArea = polygon.reduce((sum, point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const outwardSign = signedArea >= 0 ? 1 : -1;

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
    const outward = [outwardSign * un, -outwardSign * ux];
    // Building wall vertices are DTM-grounded separately. Each wall triangle
    // interpolates between its endpoint heights; facade panels must use that
    // same interpolation instead of re-sampling a different 1 m DTM pixel.
    const groundA = sampleTerrain(payload, a[0], a[1]);
    const groundB = sampleTerrain(payload, b[0], b[1]);

    if (edgeIndex === doorEdgeIndex && doorTransforms.length < budgets.doors && length >= policy.doorWidth + 0.5) {
      const e = (a[0] + b[0]) * 0.5;
      const n = (a[1] + b[1]) * 0.5;
      doorTransforms.push(matrix(worldToLocal(payload, e, n, 1.05, (groundA + groundB) / 2, outward), yaw, [policy.doorWidth, 2.1, 1]));
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
        windowTransforms.push(matrix(worldToLocal(payload, e, n, centerHeight, groundA + (groundB - groundA) * along / length, outward), yaw, [width, paneHeight, 1]));
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

function windowFrameGeometry() {
  const outerHalf = 0.5;
  const innerHalfX = 0.405;
  const innerHalfY = 0.39;
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalf, -outerHalf);
  shape.lineTo(outerHalf, -outerHalf);
  shape.lineTo(outerHalf, outerHalf);
  shape.lineTo(-outerHalf, outerHalf);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-innerHalfX, -innerHalfY);
  hole.lineTo(-innerHalfX, innerHalfY);
  hole.lineTo(innerHalfX, innerHalfY);
  hole.lineTo(innerHalfX, -innerHalfY);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.008,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -0.035);
  geometry.computeVertexNormals();
  return geometry;
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
  const windowPaneGeometry = new THREE.BoxGeometry(1, 1, 0.035);
  const windowFrame = windowFrameGeometry();
  const doorGeometry = new THREE.BoxGeometry(1, 1, 0.075);
  const windowGlassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x263c46, roughness: 0.16, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.15 });
  const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x353b3c, roughness: 0.5, metalness: 0.28 });
  const doorMaterial = new THREE.MeshPhysicalMaterial({ color: 0x5b4432, roughness: 0.72, metalness: 0.02, clearcoat: 0.12, clearcoatRoughness: 0.55 });

  const windowPaneMesh = makeInstanced(root, windowPaneGeometry, windowGlassMaterial, windowTransforms, 'NWE_Procedural_Window_Glass', false);
  const windowFrameMesh = makeInstanced(root, windowFrame, windowFrameMaterial, windowTransforms, 'NWE_Procedural_Window_Frames', true);
  const doorMesh = makeInstanced(root, doorGeometry, doorMaterial, doorTransforms, 'NWE_Procedural_Doors', true);

  function dispose() {
    root.removeFromParent();
    windowPaneGeometry.dispose();
    windowFrame.dispose();
    doorGeometry.dispose();
    windowGlassMaterial.dispose();
    windowFrameMaterial.dispose();
    doorMaterial.dispose();
  }

  return Object.freeze({
    root,
    dispose,
    stats: Object.freeze({
      schema: 'nwe.three-building-facade-layer/0.2',
      source_building_count: buildingsArtifact.features.length,
      facade_alignment: 'source-footprint-edge-linear-wall-height-and-exterior-panel-offset',
      rendered_window_count: windowTransforms.length,
      rendered_window_frame_count: windowTransforms.length,
      rendered_door_count: doorTransforms.length,
      draw_calls: Number(Boolean(windowPaneMesh)) + Number(Boolean(windowFrameMesh)) + Number(Boolean(doorMesh)),
      profile: profile?.id ?? 'unknown',
      budgets: Object.freeze({ ...budgets }),
      material_model: Object.freeze({
        glazing: 'clearcoated-dark-reflective-presentation-glass-no-interior-transmission',
        frames: 'bounded-instanced-metallic-frame',
        doors: 'clearcoated-painted-wood-like-presentation',
      }),
      semantics: 'deterministic-renderer-only-facade-detail-over-source-footprints-and-best-available-building-height',
      truth_guard: 'window and door positions/counts/dimensions/materials are not source-backed and must never be presented as observed Nannestad facade truth',
    }),
  });
}
