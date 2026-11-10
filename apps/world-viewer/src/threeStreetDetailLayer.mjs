import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { createThreeTrafficSignLayer } from './threeTrafficSignLayer.mjs';
import { drapeRoadOnTerrain } from './roadTerrainDrape.mjs';

const TYPE = Object.freeze({
  MARKING_LONGITUDINAL: 99,
  MARKING_TRANSVERSE: 519,
  CROSSWALK: 174,
  SIGN_POINT: 95,
  SIGN_PLATE: 96,
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

function pushStripSegment(target, a, b, width, localLift = 0) {
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
    target.lifts.push(localLift);
  }
  target.uvs.push(0, 0, 0, 1, length, 0, length, 1);
  target.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  target.segments += 1;
}

function appendContinuous(target, points, width, localLift = 0) {
  for (let index = 0; index < points.length - 1; index += 1) pushStripSegment(target, points[index], points[index + 1], width, localLift);
}

function appendDashed(target, points, width, localLift = 0, dashM = 3, gapM = 3) {
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
          width, localLift,
        );
      }
      cursor += Math.max(step, 0.001);
    }
    pathOffset += length;
  }
}

function geometryFrom(target, terrainMesh, surfaceLiftM) {
  if (!target.indices.length) return null;
  // Drape the paint/curb strips onto the *same triangles* as visible asphalt.
  // Sampling the higher-resolution DTM alone makes narrow markings float or
  // vanish when balanced/high terrain mesh LOD differs from 1 m source.
  const draped = drapeRoadOnTerrain({
    positions: new Float32Array(target.positions),
    uvs: new Float32Array(target.uvs),
    indices: new Uint32Array(target.indices),
    vertex_lifts_m: new Float32Array(target.lifts),
    metadata: {},
  }, terrainMesh, surfaceLiftM);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(draped.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(draped.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(draped.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createBucket() {
  return { positions: [], normals: [], uvs: [], indices: [], lifts: [], segments: 0 };
}

function markingColor(feature) {
  const color = String(feature?.properties?.Farge ?? '').toLowerCase();
  return color.includes('gul') ? 'yellow' : 'white';
}

function markingWidth(feature) {
  const sourceWidth = finite(feature?.properties?.['Bredde, enkeltlinje'], Number.NaN);
  if (Number.isFinite(sourceWidth) && sourceWidth >= 0.05 && sourceWidth <= 1) return { width: sourceWidth, source: true };
  const transverseWidth = finite(feature?.properties?.Bredde, Number.NaN);
  if (feature?.source_type_id === TYPE.MARKING_TRANSVERSE && Number.isFinite(transverseWidth) && transverseWidth >= 0.05 && transverseWidth <= 6) {
    return { width: Math.min(0.5, transverseWidth), source: true };
  }
  return { width: feature.source_type_id === TYPE.MARKING_TRANSVERSE ? 0.3 : 0.1, source: false };
}

function markingMaterialKind(feature) {
  const material = String(feature?.properties?.Materialtype ?? '').toLowerCase();
  return material.includes('plast') ? 'plastic' : 'paint';
}

function markingThickness(feature) {
  const mm = finite(feature?.properties?.Tykkelse, Number.NaN);
  if (Number.isFinite(mm) && mm >= 0.5 && mm <= 20) return { meters: mm / 1000, source: true };
  return { meters: markingMaterialKind(feature) === 'plastic' ? 0.003 : 0.0015, source: false };
}

function markingLift(feature) {
  const thickness = markingThickness(feature);
  return {
    lift: Math.max(0.0035, Math.min(0.012, thickness.meters * 0.85 + 0.0015)),
    sourceThickness: thickness.source,
  };
}

function isDashed(feature) {
  const value = String(feature?.properties?.Type ?? '').toLowerCase();
  return value.includes('stiplet') || value.includes('varsellinje');
}

function addBucketMesh(root, bucket, material, disposables, name, terrainMesh, surfaceLiftM) {
  const geometry = geometryFrom(bucket, terrainMesh, surfaceLiftM);
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

function signSupportProfile(feature) {
  const raw = String(feature?.properties?.Oppsettingsutstyr ?? '').toLowerCase();
  if (raw.includes('gittermast')) return { id: 'lattice', diameterM: 0.22, segments: 4, source: true };
  if (raw.includes('søyle') && raw.includes('150')) return { id: 'column-150', diameterM: 0.15, segments: 8, source: true };
  if (raw.includes('søyle') && raw.includes('120')) return { id: 'column-120', diameterM: 0.12, segments: 8, source: true };
  if (raw.includes('88,9') || raw.includes('88.9')) return { id: 'pole-88.9', diameterM: 0.0889, segments: 12, source: true };
  if (raw.includes('60,3') || raw.includes('60.3')) return { id: 'pole-60.3', diameterM: 0.0603, segments: 12, source: true };
  if (raw.includes('lysmast')) return { id: 'light-mast-support', diameterM: 0.12, segments: 12, source: true };
  return { id: 'generic-pole', diameterM: 0.0603, segments: 10, source: false };
}

function signMountHeight(feature) {
  const source = finite(feature?.properties?.['Høyde over vegkant'], Number.NaN);
  if (Number.isFinite(source) && source >= 1.2 && source <= 6) return { bottomM: source, source: true };
  return { bottomM: 1.75, source: false };
}

function roundedRectangleGeometry(width = 0.62, height = 0.62, radius = 0.055, depth = 0.038) {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + r, -halfH);
  shape.lineTo(halfW - r, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  shape.lineTo(halfW, halfH - r);
  shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  shape.lineTo(-halfW + r, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  shape.lineTo(-halfW, -halfH + r);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function groupBy(values, keyFn) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

export function createThreeStreetDetailLayer({ artifact, terrainPayload, profile } = {}) {
  if (artifact?.schema !== 'nwe.nvdb-street-detail-artifact/0.1-candidate') throw new TypeError('STREET_DETAIL_ARTIFACT_REQUIRED');
  if (artifact?.tile_id !== terrainPayload?.artifact?.header?.tile_id) throw new Error('STREET_DETAIL_TILE_MISMATCH');
  const sampleHeight = terrainSampler(terrainPayload);
  const root = new THREE.Group();
  root.name = 'NWE_NVDB_Street_Detail';
  const disposables = { geometries: new Set(), materials: new Set() };
  const buckets = {
    whitePaint: createBucket(),
    whitePlastic: createBucket(),
    yellowPaint: createBucket(),
    yellowPlastic: createBucket(),
    kerb: createBucket(),
    sidewalk: createBucket(),
    ditch: createBucket(),
    guardrail: createBucket(),
  };
  let sourceWidthMarkings = 0;
  let fallbackWidthMarkings = 0;
  let sourceThicknessMarkings = 0;
  let skippedUnsupported = 0;
  const markingMaterialParts = { paint: 0, plastic: 0 };

  const signFeatures = [];
  const signPlateFeatures = [];
  const mastFeatures = [];
  const lightFeatures = [];
  const edgePostFeatures = [];

  for (const feature of artifact.features ?? []) {
    const typeId = Number(feature.source_type_id);
    if (feature.geometry_type === 'point') {
      if (typeId === TYPE.SIGN_POINT) signFeatures.push(feature);
      else if (typeId === TYPE.SIGN_PLATE) signPlateFeatures.push(feature);
      else if (typeId === TYPE.LIGHT_MAST) mastFeatures.push(feature);
      else if (typeId === TYPE.LIGHT_POINT) lightFeatures.push(feature);
      else if (typeId === TYPE.EDGE_POST) edgePostFeatures.push(feature);
      else skippedUnsupported += 1;
      continue;
    }
    if (feature.geometry_type !== 'line') { skippedUnsupported += 1; continue; }

    if (typeId === TYPE.MARKING_LONGITUDINAL || typeId === TYPE.MARKING_TRANSVERSE) {
      const width = markingWidth(feature);
      const materialKind = markingMaterialKind(feature);
      const lift = markingLift(feature);
      if (width.source) sourceWidthMarkings += 1; else fallbackWidthMarkings += 1;
      if (lift.sourceThickness) sourceThicknessMarkings += 1;
      markingMaterialParts[materialKind] += 1;
      const color = markingColor(feature);
      const bucketName = `${color}${materialKind === 'plastic' ? 'Plastic' : 'Paint'}`;
      const points = feature.points.map((point) => localPoint(point, terrainPayload, sampleHeight));
      if (isDashed(feature)) appendDashed(buckets[bucketName], points, width.width, lift.lift);
      else appendContinuous(buckets[bucketName], points, width.width, lift.lift);
      continue;
    }

    const lift = typeId === TYPE.KERB ? 0.07 : typeId === TYPE.SIDEWALK ? 0.04 : 0.025;
    const points = feature.points.map((point) => localPoint(point, terrainPayload, sampleHeight));
    if (typeId === TYPE.KERB) appendContinuous(buckets.kerb, points, 0.18, lift);
    else if (typeId === TYPE.SIDEWALK || typeId === TYPE.BIKE_LANE) appendContinuous(buckets.sidewalk, points, typeId === TYPE.SIDEWALK ? 1.5 : 1.2, lift);
    else if (typeId === TYPE.DITCH) appendContinuous(buckets.ditch, points, 0.45, lift);
    else if (typeId === TYPE.GUARDRAIL) appendContinuous(buckets.guardrail, points, 0.12, lift);
    else skippedUnsupported += 1;
  }

  const markingBase = { metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  const lineMaterials = {
    whitePaint: new THREE.MeshStandardMaterial({ ...markingBase, color: 0xeeeade, roughness: 0.68 }),
    whitePlastic: new THREE.MeshPhysicalMaterial({ ...markingBase, color: 0xf1eee4, roughness: 0.44, clearcoat: 0.2, clearcoatRoughness: 0.42 }),
    yellowPaint: new THREE.MeshStandardMaterial({ ...markingBase, color: 0xe6c338, roughness: 0.7 }),
    yellowPlastic: new THREE.MeshPhysicalMaterial({ ...markingBase, color: 0xe9c93f, roughness: 0.46, clearcoat: 0.18, clearcoatRoughness: 0.45 }),
    kerb: new THREE.MeshStandardMaterial({ color: 0xa7a7a2, roughness: 0.92, metalness: 0 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: 0x676964, roughness: 0.96, metalness: 0 }),
    ditch: new THREE.MeshStandardMaterial({ color: 0x385337, roughness: 1, metalness: 0 }),
    guardrail: new THREE.MeshStandardMaterial({ color: 0xaab0b2, roughness: 0.42, metalness: 0.58 }),
  };
  // Asphalt is already projected at 6 cm above the visible terrain mesh.
  // This small offset belongs to the renderer, not to NVDB source geometry.
  const lineMeshes = Object.entries(buckets)
    .map(([name, bucket]) => addBucketMesh(root, bucket, lineMaterials[name], disposables,
      `NWE_Street_${name}`, terrainPayload.mesh, name.endsWith('Paint') || name.endsWith('Plastic') ? 0.06 : 0))
    .filter(Boolean);
  for (const [name, material] of Object.entries(lineMaterials)) {
    if (!buckets[name].indices.length) { material.dispose(); disposables.materials.delete(material); }
  }

  const trafficSignLayer = signPlateFeatures.length > 0 ? createThreeTrafficSignLayer({ artifact, terrainPayload, profile }) : null;
  if (trafficSignLayer?.stats.draw_calls > 0) root.add(trafficSignLayer.root);
  const fallbackSignFeatures = trafficSignLayer ? trafficSignLayer.signPointsWithoutPlate : signFeatures;

  const mastPositionKeys = new Set(mastFeatures.map((feature) => roundedPointKey(feature.point)));
  const uniqueLightFeatures = lightFeatures.filter((feature) => !mastPositionKeys.has(roundedPointKey(feature.point)));

  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x8d9496, roughness: 0.38, metalness: 0.62 });
  const latticeMaterial = new THREE.MeshStandardMaterial({ color: 0x777e80, roughness: 0.48, metalness: 0.58 });
  const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x3c4143, roughness: 0.42, metalness: 0.58 });
  const woodPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x5b4534, roughness: 0.88, metalness: 0 });
  const reflectorMaterial = new THREE.MeshPhysicalMaterial({ color: 0xece9dc, roughness: 0.45, metalness: 0.03, clearcoat: 0.45, clearcoatRoughness: 0.25 });

  const signSupportGroups = groupBy(signFeatures, (feature) => signSupportProfile(feature).id);
  const signMeshes = [];
  const signSupportCounts = {};
  let sourceSupportCount = 0;
  let sourceMountHeightCount = 0;

  for (const [supportId, features] of signSupportGroups.entries()) {
    const support = signSupportProfile(features[0]);
    signSupportCounts[supportId] = features.length;
    sourceSupportCount += features.filter((feature) => signSupportProfile(feature).source).length;
    const geometry = supportId === 'lattice'
      ? new THREE.BoxGeometry(support.diameterM, 1, support.diameterM)
      : new THREE.CylinderGeometry(support.diameterM / 2, support.diameterM / 2 * 1.08, 1, support.segments);
    const material = supportId === 'lattice' ? latticeMaterial : poleMaterial;
    const mesh = addInstanced(root, geometry, material, features.length, `NWE_Sign_Support_${supportId}`, disposables);
    features.forEach((feature, index) => {
      const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
      const mount = signMountHeight(feature);
      if (mount.source) sourceMountHeightCount += 1;
      const plateCenter = mount.bottomM + 0.31;
      const sourceTop = trafficSignLayer?.requiredSupportTopMByParent.get(Number(feature.source_object_id));
      const supportHeight = Math.max(1.9, plateCenter + 0.18, Number.isFinite(sourceTop) ? sourceTop + 0.18 : 0);
      mesh?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + supportHeight / 2, ground.z), [1, supportHeight, 1]));
    });
    signMeshes.push(mesh);
  }

  if (fallbackSignFeatures.length > 0) {
    const signFaceMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd9dcda, roughness: 0.38, metalness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.32 });
    const plateGeometry = roundedRectangleGeometry();
    const signPlates = addInstanced(root, plateGeometry, signFaceMaterial, fallbackSignFeatures.length, 'NWE_Sign_Plates_GenericNeutral', disposables);
    fallbackSignFeatures.forEach((feature, index) => {
      const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
      const mount = signMountHeight(feature);
      signPlates?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + mount.bottomM + 0.31, ground.z), [1, 1, 1]));
    });
    signMeshes.push(signPlates);
  }

  const allMasts = [...mastFeatures, ...uniqueLightFeatures];
  const steelMasts = allMasts.filter((feature) => !String(feature?.properties?.Type ?? '').toLowerCase().includes('tre'));
  const woodMasts = allMasts.filter((feature) => String(feature?.properties?.Type ?? '').toLowerCase().includes('tre'));
  const mastMeshes = [];

  const steelPoles = addInstanced(root, new THREE.CylinderGeometry(0.065, 0.09, 7, 12), poleMaterial, steelMasts.length, 'NWE_Light_Masts_Steel', disposables);
  steelMasts.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    steelPoles?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 3.5, ground.z), [1, 1, 1]));
  });
  mastMeshes.push(steelPoles);

  const woodPoles = addInstanced(root, new THREE.CylinderGeometry(0.09, 0.13, 7, 10), woodPoleMaterial, woodMasts.length, 'NWE_Light_Masts_Wood', disposables);
  woodMasts.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    woodPoles?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 3.5, ground.z), [1, 1, 1]));
  });
  mastMeshes.push(woodPoles);

  const mastHeads = addInstanced(root, new THREE.BoxGeometry(0.85, 0.14, 0.24), darkMetalMaterial, allMasts.length, 'NWE_Light_Heads', disposables);
  allMasts.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    mastHeads?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x + 0.28, ground.y + 6.92, ground.z), [1, 1, 1]));
  });
  mastMeshes.push(mastHeads);

  const edgePosts = addInstanced(root, new THREE.BoxGeometry(0.11, 1.05, 0.11), reflectorMaterial, edgePostFeatures.length, 'NWE_Edge_Posts', disposables);
  edgePostFeatures.forEach((feature, index) => {
    const ground = localPoint(feature.point, terrainPayload, sampleHeight, 0);
    edgePosts?.setMatrixAt(index, objectMatrix(new THREE.Vector3(ground.x, ground.y + 0.525, ground.z), [1, 1, 1]));
  });

  for (const mesh of [...signMeshes, ...mastMeshes, edgePosts]) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere?.();
  }

  const instancedMeshes = [...signMeshes, ...mastMeshes, edgePosts].filter(Boolean);
  const trafficSignDrawCalls = trafficSignLayer?.stats.draw_calls ?? 0;
  const trafficSignMeshCount = trafficSignLayer?.stats.rendered_mesh_count ?? 0;
  const drawCalls = lineMeshes.length + instancedMeshes.length + trafficSignDrawCalls;

  function dispose() {
    root.removeFromParent();
    trafficSignLayer?.dispose();
    for (const geometry of disposables.geometries) geometry.dispose();
    for (const material of disposables.materials) material.dispose();
  }

  return Object.freeze({
    root,
    dispose,
    stats: Object.freeze({
      schema: 'nwe.three-street-detail-layer/0.3',
      source_feature_part_count: artifact.stats?.feature_part_count ?? artifact.features?.length ?? 0,
      source_feature_parts_by_type_id: Object.freeze({ ...(artifact.stats?.feature_parts_by_type_id ?? {}) }),
      rendered_line_mesh_count: lineMeshes.length,
      street_surface_alignment: 'same-rendered-terrain-triangles-as-asphalt-with-per-feature-source-relief',
      rendered_instanced_mesh_count: instancedMeshes.length + trafficSignMeshCount,
      draw_calls: drawCalls,
      source_width_marking_parts: sourceWidthMarkings,
      renderer_fallback_width_marking_parts: fallbackWidthMarkings,
      source_thickness_marking_parts: sourceThicknessMarkings,
      marking_material_parts: Object.freeze({ ...markingMaterialParts }),
      sign_point_count: signFeatures.length,
      source_sign_plate_count: signPlateFeatures.length,
      source_sign_support_count: sourceSupportCount,
      source_sign_mount_height_count: sourceMountHeightCount,
      sign_support_counts: Object.freeze({ ...signSupportCounts }),
      generic_fallback_sign_plate_count: fallbackSignFeatures.length,
      sign_face_semantics: trafficSignLayer
        ? 'NVDB-type96-source-identity-text-parent-and-placement-with-renderer-facsimile-artwork'
        : 'generic-neutral-backplate-no-traffic-symbol-without-admitted-sign-face-relation',
      traffic_signs: trafficSignLayer?.stats ?? Object.freeze({ status: 'NO_TYPE96_SIGN_PLATES' }),
      source_light_mast_count: mastFeatures.length,
      source_light_point_count: lightFeatures.length,
      deduplicated_additional_light_point_count: uniqueLightFeatures.length,
      steel_light_mast_count: steelMasts.length,
      wood_light_mast_count: woodMasts.length,
      edge_post_count: edgePostFeatures.length,
      skipped_unsupported_count: skippedUnsupported,
      profile: profile?.id ?? 'unknown',
      truth_guard: trafficSignLayer
        ? 'NVDB positions/types/properties plus type96 sign identity/text/relations/placement drive presentation; exact sign dimensions, official face artwork, exact equal-slot arrangement and front/back metering direction remain explicitly unresolved'
        : 'NVDB positions/types/properties drive marking width/material/thickness where present plus sign support family/mount-height and light-mast material class; sign face identity/orientation and unresolved dimensions remain renderer presentation only',
    }),
  });
}
