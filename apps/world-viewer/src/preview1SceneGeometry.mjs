import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { installPreviewCameraControls } from './previewCameraControls.mjs';

function identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize3(subtract(eye, target));
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  const out = identity();
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2];
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return out;
}

function terrainHeightSampler(payload) {
  const header = payload.artifact.header;
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

function worldPointToLocal(point, origin, sampleHeight, lift = 0) {
  const easting = Number(point?.[0]);
  const northing = Number(point?.[1]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error('invalid world point');
  const sourceZ = Number(point?.[2]);
  const elevation = Number.isFinite(sourceZ) && sourceZ > -10000 ? sourceZ : sampleHeight(easting, northing);
  return [easting - origin.e, elevation - origin.h + lift, origin.n - northing];
}

function pushQuad(positions, indices, a, b, c, d) {
  const base = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildRoadRibbonGeometry(roadsArtifact, origin, sampleHeight, widthMeters = 3.2) {
  const positions = [];
  const indices = [];
  const half = widthMeters / 2;
  for (const path of roadsArtifact?.paths ?? []) {
    const points = Array.isArray(path.points) ? path.points : [];
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = worldPointToLocal(points[i], origin, sampleHeight, 0.35);
      const b = worldPointToLocal(points[i + 1], origin, sampleHeight, 0.35);
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dz);
      if (!(length > 0.001)) continue;
      const px = -dz / length * half;
      const pz = dx / length * half;
      pushQuad(positions, indices,
        [a[0] + px, a[1], a[2] + pz],
        [a[0] - px, a[1], a[2] - pz],
        [b[0] - px, b[1], b[2] - pz],
        [b[0] + px, b[1], b[2] + pz]);
    }
  }
  const IndexArray = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array;
  return { positions: new Float32Array(positions), indices: new IndexArray(indices) };
}

function polygonWithoutDuplicateClosure(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon.filter((point) => Array.isArray(point) && point.length >= 2);
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (Number(first[0]) === Number(last[0]) && Number(first[1]) === Number(last[1])) return points.slice(0, -1);
  }
  return points;
}

function appendBuilding(feature, positions, indices, origin, sampleHeight, fallbackHeight) {
  const polygon = polygonWithoutDuplicateClosure(feature.polygon);
  if (polygon.length < 3) return false;
  const height = Number.isFinite(feature.height_m) ? Number(feature.height_m) : fallbackHeight;
  const base = polygon.map((point) => {
    const e = Number(point[0]);
    const n = Number(point[1]);
    const h = sampleHeight(e, n);
    return [e - origin.e, h - origin.h + 0.08, origin.n - n];
  });
  const top = base.map((point) => [point[0], point[1] + height, point[2]]);
  for (let i = 0; i < base.length; i += 1) {
    const j = (i + 1) % base.length;
    pushQuad(positions, indices, base[i], base[j], top[j], top[i]);
  }
  const roofBase = positions.length / 3;
  for (const point of top) positions.push(...point);
  for (let i = 1; i + 1 < top.length; i += 1) indices.push(roofBase, roofBase + i, roofBase + i + 1);
  return true;
}

function buildBuildingGeometry(buildingsArtifact, origin, sampleHeight, { resolved, fallbackHeight = 5 } = {}) {
  const positions = [];
  const indices = [];
  let count = 0;
  for (const feature of buildingsArtifact?.features ?? []) {
    const hasHeight = Number.isFinite(feature.height_m);
    if (hasHeight !== resolved) continue;
    if (appendBuilding(feature, positions, indices, origin, sampleHeight, fallbackHeight)) count += 1;
  }
  const IndexArray = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array;
  return { positions: new Float32Array(positions), indices: new IndexArray(indices), count };
}

export function createPreviewCamera() {
  return { yaw: -0.78, pitch: 0.62, distance: 1180, target: [0, 7, 0] };
}

function cameraEye(camera) {
  const cp = Math.cos(camera.pitch);
  return [
    camera.target[0] + Math.sin(camera.yaw) * cp * camera.distance,
    camera.target[1] + Math.sin(camera.pitch) * camera.distance,
    camera.target[2] + Math.cos(camera.yaw) * cp * camera.distance,
  ];
}

export function cameraViewProjection(camera, width, height) {
  const projection = perspective(52 * Math.PI / 180, Math.max(0.1, width / height), 1, 5000);
  return multiply(projection, lookAt(cameraEye(camera), camera.target));
}

export function installPreviewSceneControls(canvas, camera, onChange) {
  return installPreviewCameraControls(canvas, camera, onChange, {
    resetCamera: () => {
      const reset = createPreviewCamera();
      Object.assign(camera, { yaw: reset.yaw, pitch: reset.pitch, distance: reset.distance });
      camera.target.splice(0, 3, ...reset.target);
    },
  });
}

export function createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact }) {
  if (!terrainPayload?.mesh?.positions || !terrainPayload?.artifact?.header) throw new TypeError('terrainPayload is required');
  const origin = {
    e: terrainPayload.mesh.metadata.origin[0],
    n: terrainPayload.mesh.metadata.origin[1],
    h: terrainPayload.mesh.metadata.origin[2],
  };
  const sampleHeight = terrainHeightSampler(terrainPayload);
  const roads = buildRoadRibbonGeometry(roadsArtifact, origin, sampleHeight);
  const buildingsResolved = buildBuildingGeometry(buildingsArtifact, origin, sampleHeight, { resolved: true });
  const buildingsFallback = buildBuildingGeometry(buildingsArtifact, origin, sampleHeight, { resolved: false, fallbackHeight: 5 });
  return {
    header: terrainPayload.artifact.header,
    origin,
    terrain: terrainPayload.mesh,
    roads,
    buildingsResolved,
    buildingsFallback,
    stats: {
      terrain_vertices: terrainPayload.mesh.metadata.vertexCount,
      terrain_triangles: terrainPayload.mesh.metadata.triangleCount,
      road_paths: roadsArtifact?.paths?.length ?? 0,
      building_footprints: buildingsArtifact?.features?.length ?? 0,
      source_backed_building_heights: buildingsResolved.count,
      unresolved_building_heights: buildingsFallback.count,
      debug_road_width_m: 3.2,
      debug_unresolved_building_height_m: 5,
    },
  };
}
