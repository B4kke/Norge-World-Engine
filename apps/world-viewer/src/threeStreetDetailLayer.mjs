import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';

const TYPE = Object.freeze({
  MARKING_LONGITUDINAL: 99,
  MARKING_TRANSVERSE: 519,
  CROSSWALK: 174,
  SIGN_POINT: 95,
  LIGHT_POINT: 87,
  LIGHT_MAST: 181,
  EDGE_POST: 20,
  GUARDRAIL: 5,
  DITCH: 80,
  KERB: 9,
  SIDEWALK: 48,
  BIKE_LANE: 953,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function terrainSampler(payload) {
  const header = payload?.artifact?.header;
  if (!header || !(payload?.elevations instanceof Float32Array)) throw new TypeError('STREET_DETAIL_TERRAIN_REQUIRED');
  return (easting, northing) => sampleHeightGrid(payload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  });
}

function localPoint(world, payload, sampleHeight, lift = 0) {
  const easting = Number(world?.[0]);
  const northing = Number(world?.[1]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error('STREET_DETAIL_WORLD_POINT_INVALID');
  const origin = payload.mesh.metadata.origin;
  return new THREE.Vector3(
    easting - origin[0],
    sampleHeight(easting, northing) - origin[2] + lift,
    origin[1] - northing,
  );
}

function pushStripSegment(target, a, b, width) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0.01)) return;
  const nx = -dz / length;
  const nz = dx / length;
  const half = Math.max(0.02, width * 0.5);
  const base = target.positions.length / 3;
  const vertices = [
    [a.x + nx * half, a.y, a.z + nz * half],
    [a.x - nx * half, a.y, a.z - nz * half],
    [b.x + nx * half, b.y, b.z + nz * half],
    [b.x - nx * half, b.y, b.z - nz * half],
  ];
  for (const vertex of vertices) {
    target.positions.push(...vertex);
    target.normals.push(0, 1, 0);
  }
  target.uvs.push(0, 0, 0, 1, length, 0, length, 1);
  target.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  target.segments += 1;
}

function appendContinuous(target, points, width) {
  for (let index = 0; index < points.length - 1; index += 1) pushStripSegment(target, points[index], points[index + 1], width);
}

function appendDashed(target, points, width, dashM = 3, gapM = 3) {
  const period = dashM + gapM;
  let pathOffset = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (!(length > 0.01)) continue;
    let cursor = 0;
    while (cursor < length) {
      const global = pathOffset + cursor;
      const phase = ((global % period) + period) % period;
      const drawing = phase < dashM;
      const step = Math.min(length - cursor, drawing ? dashM - phase : period - phase);
      if (drawing && step > 0.03) {
        const t0 = cursor / length;
        const t1 = (cursor + step) / length;
        pushStripSegment(target,
          new THREE.Vector3(a.x + dx * t0, a.y + dy * t0, a.z + dz * t0),
          new THREE.Vector3(a.x + dx * t1, a.y + dy * t1, a.z + dz * t1),
          width,
        );
      }
      cursor += Math.max(step, 0.001);
    }
    pathOffset += length;
  }
}

function geometryFrom(target) {
  if (!target.indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(target.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(target.uvs, 2));
  geometry.setIndex(target.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createBucket() {
  return { positions: [], normals: [], uvs: [], indices: [], segments: 0 };
}

function markingColor(feature) {
  const color = String(feature?.properties?.Farge ?? '').toLowerCase();
  return color.includes('gul') ? 'yellow' : 'white';
}

function markingWidth(feature) {
  const sourceWidth = finite(feature?.properties?.['Bredde, enkeltlinje'], Number.NaN);
  if (Number.isFinite(sourceWidth) && sourceWidth >= 0.05 && sourceWidth <= 1) return { width: sourceWidth, source: true };
  return { width: feature.source_type_id === TYPE.MARKING_TRANSVERSE ? 0.3 : 0.1, source: false };
}

function isDashed(feature) {
  const value = String(feature?.properties?.Type ?? '').toLowerCase();
  return value.includes('stiplet') || value.includes('varsellinje');
}

function addBucketMesh(root, bucket, material, disposables, name) {
  const geometry = geometryFrom(bucket);
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  root.add(mesh);
  disposables.geometries.add(geometry);
  disposables.materials.add(material);
  return mesh;
}

function roundedPointKey(point, meters = 0.75) {
  return `${Math.round(point[0] / meters)}:${Math.round(point[1] / meters)}`;
}

function objectMatrix(position, scale, yaw = 0) {
  const object = new THREE.Object3D();
  object.position.copy(position);
  object.scale.set(scale[0], scale[1], scale[2]);
  object.rotation.y = yaw;
  object.updateMatrix();
  return object.matrix;
}

function addInstanced(root, geometry, material, count, name, disposables) {
  if (!count) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  root.add(mesh);
  disposables.geometries.add(geometry);
  disposables.materials.add(material);
  return mesh;
}

export function createThreeStreetDetailLayer({ artifact, terrainPayload, profile } = {}) {
  if (artifact?.schema !== 'nwe.nvdb-street-detail-artifact/0.1-candidate') throw new TypeError('STREET_DETAIL_ARTIFACT_REQUIRED');
  if (artifact?.tile_id !== terrainPayload?.artifact?.header?.tile_id) throw new Error('STREET_DETAIL_TILE_MISMATCH');
  const sampleHeight = terrainSampler(terrainPayload);
  const root = new THREE.Group();
  root.name = 'NWE_NVDB_Street_Detail';
  const disposables = { geometries: new Set(), materials: new Set() };
  const buckets = {
    white: createBucket(), yellow: createBucket(), kerb: createBucket(), sidewalk: createBucket(), ditch: createBucket(), guardrail: createBucket(),
  };
  let sourceWidthMarkings = 0;
  let fallbackWidthMarkings = 0;
  let skippedUnsupported = 0;

  const signFeatures = [];
  const mastFeatures = [];
  const lightFeatures = [];
  const edgePostFeatures = [];

  for (const feature of artifact.features ?? []) {
    const typeId = Number(feature.source_type_id);
    if (feature.geometry_type === 'point') {
      if (typeId === TYPE.SIGN_POINT) signFeatures.push(feature);
      else if (typeId === TYPE.LIGHT_MAST) mastFeatures.push(feature);
      else if (typeId === TYPE.LIGHT_POINT) lightFeatures.push(feature);
      else if (typeId === TYPE.EDGE_POST) edgePostFeatures.push(feature);
      else skippedUnsupported += 1;
      continue;
    }
    if (feature.geometry_type !== 'line') { skippedUnsupported += 1; continue; }
    const lift = (typeId === TYPE.MARKING_LONGITUDINAL || typeId === TYPE.MARKING_TRANSVERSE) ? 0.085
      : typeId === TYPE.KERB ? 0.07
        : typeId === TYPE.SIDEWALK ? 0.04 : 0.025;
    const points = feature.points.map((point) => localPoint(point, terrainPayload, sampleHeight, lift));
    if (typeId === TYPE.MARKING_LONGITUDINAL || typeId === TYPE.MARKING_TRANSVERSE) {
      const width = markingWidth(feature);
      if (width.source) sourceWidthMarkings += 1; else fallbackWidthMarkings += 1;
      const bucket = buckets[markingColor(feature)];
      if (isDashed(feature)) appendDashed(bucket, points, width.width);
      else appendContinuous(bucket, points, width.width);
    } else if (typeId === TYPE.KERB) appendContinuous(buckets.kerb, points, 0.18);
    else if (typeId === TYPE.SIDEWALK || typeId === TYPE.BIKE_LANE) appendContinuous(buckets.sidewalk, points, typeId === TYPE.SIDEWALK ? 1.5 : 1.2);
    else if (typeId === TYPE.DITCH) appendContinuous(buckets.ditch, points, 0.45);
    else if (typeId === TYPE.GUARDRAIL) appendContinuous(buckets.guardrail, points, 0.12);
    else skippedUnsupported += 1;
  }

  const lineMaterials = {
    white: new THREE.MeshStandardMaterial({ color: 0xe8e8df, roughness: 0.78, metalness: 0 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xe8c84d, roughness: 0.8, metalness: 0 }),
    kerb: new THREE.MeshStandardMaterial({ color: 0xa7a7a2, roughness: 0.92, metalness: 0 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: 0x676964, roughness: 0.96, metalness: 0 }),
    ditch: new THREE.MeshStandardMaterial({ color: 0x385337, roughness: 1, metalness: 0 }),
    guardrail: new THREE.MeshStandardMaterial({ color: 0x9ca1a3, roughness: 0.55, metalness: 0.45 }),
  };
  const lineMeshes = Object.entries(buckets).map(([name, bucket]) => addBucketMesh(root, bucket, lineMaterials[name], disposables, `NWE_Street_${name}`)).filter(Boolean);

  const mastPositionKeys = new Set(mastFeatures.map((feature) => roundedPointKey(feature.point)));
  const uniqueLightFeatures = lightFeatures.filter((feature) => !mastPositionKeys.has(roundedPointKey(feature.point)));
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x72797b, roughness: 0.55, metalness: 0.45 });
  const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x3c4143, roughness: 0.5, metalness: 0.5 });
  const signFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d9d7, roughness: 0.72, metalness: 0.08 });
  const reflectorMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e2d2, roughness: 0.7, metalness: 0.02 });

  const signPoles = addInstanced(root, new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), poleMaterial, signFeatures.length, 'NWE_Sign_Poles', disposables);
  const signPlates = addInstanced(root, new THREE.BoxGeometry(0.62, 0.62, 0.055), signFaceMaterial, signFeatures.length, 'NWE_Sign_Plates_GenericBack', disposables);
  signFeatures.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    signPoles?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 1.1, ground.z), [1, 1, 1]));
    signPlates?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 2.05, ground.z), [1, 1, 1]));
  });

  const allMasts = [...mastFeatures, ...uniqueLightFeatures];
  const mastPoles = addInstanced(root, new THREE.CylinderGeometry(0.065, 0.09, 7, 9), poleMaterial, allMasts.length, 'NWE_Light_Masts', disposables);
  const mastHeads = addInstanced(root, new THREE.BoxGeometry(0.85, 0.16, 0.28), darkMetalMaterial, allMasts.length, 'NWE_Light_Heads', disposables);
  allMasts.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    mastPoles?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 3.5, ground.z), [1, 1, 1]));
    mastHeads?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x + 0.28, ground.y + 6.92, ground.z), [1, 1, 1]));
  });

  const edgePosts = addInstanced(root, new THREE.BoxGeometry(0.11, 1.05, 0.11), reflectorMaterial, edgePostFeatures.length, 'NWE_Edge_Posts', disposables);
  edgePostFeatures.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    edgePosts?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 0.525, ground.z), [1, 1, 1]));
  });

  for (const mesh of [signPoles, signPlates, mastPoles, mastHeads, edgePosts]) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere?.();
  }

  const instancedMeshes = [signPoles, signPlates, mastPoles, mastHeads, edgePosts].filter(Boolean);
  const drawCalls = lineMeshes.length + instancedMeshes.length;

  function dispose() {
    root.removeFromParent();
    for (const geometry of disposables.geometries) geometry.dispose();
    for (const material of disposables.materials) material.dispose();
  }

  return Object.freeze({
    root,
    dispose,
    stats: Object.freeze({
      schema: 'nwe.three-street-detail-layer/0.1',
      source_feature_part_count: artifact.stats?.feature_part_count ?? artifact.features?.length ?? 0,
      source_feature_parts_by_type_id: Object.freeze({ ...(artifact.stats?.feature_parts_by_type_id ?? {}) }),
      rendered_line_mesh_count: lineMeshes.length,
      rendered_instanced_mesh_count: instancedMeshes.length,
      draw_calls: drawCalls,
      source_width_marking_parts: sourceWidthMarkings,
      renderer_fallback_width_marking_parts: fallbackWidthMarkings,
      sign_point_count: signFeatures.length,
      source_light_mast_count: mastFeatures.length,
      source_light_point_count: lightFeatures.length,
      deduplicated_additional_light_point_count: uniqueLightFeatures.length,
      edge_post_count: edgePostFeatures.length,
      skipped_unsupported_count: skippedUnsupported,
      profile: profile?.id ?? 'unknown',
      truth_guard: 'source positions/types/properties are NVDB-backed; sign face identity, pole/plate dimensions, missing line widths and visual ditch/sidewalk widths are renderer presentation only',
    }),
  });
}
