import { Earcut } from 'three/src/extras/Earcut.js';

const DEFAULT_FALLBACK_HEIGHT_M = 5;
const DEFAULT_GROUND_LIFT_M = 0.08;
const SURFACE_UV_TILE_M = 4;

function polygonWithoutDuplicateClosure(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  const deduped = [];
  for (const point of points) {
    const previous = deduped.at(-1);
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
    deduped.push(point);
  }
  return deduped;
}

function pushQuad(positions, indices, uvs, a, b, c, d, edgeLengthM, heightM) {
  const base = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  const repeatU = edgeLengthM / SURFACE_UV_TILE_M;
  const repeatV = heightM / SURFACE_UV_TILE_M;
  uvs.push(0, 0, repeatU, 0, repeatU, repeatV, 0, repeatV);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function signedTriangleNormalY(a, b, c) {
  const abx = b[0] - a[0];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acz = c[2] - a[2];
  return abz * acx - abx * acz;
}

function appendRoof(top, positions, indices, uvs) {
  const flattened = [];
  for (const point of top) flattened.push(point[0], point[2]);
  const faces = Earcut.triangulate(flattened, null, 2);
  if (faces.length !== Math.max(0, top.length - 2) * 3) {
    throw new Error(`BUILDING_ROOF_TRIANGULATION_INVALID: ${faces.length} indices for ${top.length} vertices`);
  }
  const base = positions.length / 3;
  for (const point of top) {
    positions.push(...point);
    uvs.push(point[0] / SURFACE_UV_TILE_M, point[2] / SURFACE_UV_TILE_M);
  }
  for (let offset = 0; offset < faces.length; offset += 3) {
    let ia = faces[offset];
    let ib = faces[offset + 1];
    let ic = faces[offset + 2];
    if (signedTriangleNormalY(top[ia], top[ib], top[ic]) < 0) [ib, ic] = [ic, ib];
    indices.push(base + ia, base + ib, base + ic);
  }
}

function typedGeometry(positions, indices, uvs) {
  const vertexCount = positions.length / 3;
  if (uvs.length !== vertexCount * 2) throw new Error('BUILDING_UV_ATTRIBUTE_MISMATCH');
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    indices: new IndexArray(indices),
    uvs: new Float32Array(uvs),
    vertexCount,
    triangleCount: indices.length / 3,
  };
}

function combineGeometry(walls, roofs) {
  const positions = new Float32Array(walls.positions.length + roofs.positions.length);
  positions.set(walls.positions, 0);
  positions.set(roofs.positions, walls.positions.length);
  const uvs = new Float32Array(walls.uvs.length + roofs.uvs.length);
  uvs.set(walls.uvs, 0);
  uvs.set(roofs.uvs, walls.uvs.length);
  const totalVertices = positions.length / 3;
  const IndexArray = totalVertices <= 65535 ? Uint16Array : Uint32Array;
  const indices = new IndexArray(walls.indices.length + roofs.indices.length);
  indices.set(walls.indices, 0);
  const roofVertexOffset = walls.positions.length / 3;
  for (let index = 0; index < roofs.indices.length; index += 1) {
    indices[walls.indices.length + index] = roofs.indices[index] + roofVertexOffset;
  }
  return { positions, indices, uvs };
}

function appendBuilding(feature, wallPositions, wallIndices, wallUvs, roofPositions, roofIndices, roofUvs, projectPoint, heightMeters) {
  const polygon = polygonWithoutDuplicateClosure(feature?.polygon);
  if (polygon.length < 3) return false;
  const base = polygon.map((point) => {
    const projected = projectPoint(point);
    if (!Array.isArray(projected) || projected.length < 3 || projected.some((value) => !Number.isFinite(value))) {
      throw new Error('BUILDING_PROJECTED_POINT_INVALID');
    }
    return [Number(projected[0]), Number(projected[1]), Number(projected[2])];
  });
  const top = base.map((point) => [point[0], point[1] + heightMeters, point[2]]);
  for (let index = 0; index < base.length; index += 1) {
    const next = (index + 1) % base.length;
    const edgeLengthM = Math.hypot(
      base[next][0] - base[index][0],
      base[next][2] - base[index][2],
    );
    pushQuad(
      wallPositions,
      wallIndices,
      wallUvs,
      base[index],
      base[next],
      top[next],
      top[index],
      edgeLengthM,
      heightMeters,
    );
  }
  appendRoof(top, roofPositions, roofIndices, roofUvs);
  return true;
}

export function buildBuildingSurfaceGeometry(buildingsArtifact, {
  projectPoint,
  resolved,
  fallbackHeightMeters = DEFAULT_FALLBACK_HEIGHT_M,
  groundLiftMeters = DEFAULT_GROUND_LIFT_M,
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (typeof resolved !== 'boolean') throw new TypeError('resolved must be boolean');
  if (!(Number.isFinite(fallbackHeightMeters) && fallbackHeightMeters > 0)) throw new RangeError('fallbackHeightMeters must be > 0');
  if (!(Number.isFinite(groundLiftMeters) && groundLiftMeters >= 0)) throw new RangeError('groundLiftMeters must be >= 0');

  const wallPositions = [];
  const wallIndices = [];
  const wallUvs = [];
  const roofPositions = [];
  const roofIndices = [];
  const roofUvs = [];
  let count = 0;
  let sourceBackedHeightCount = 0;
  let fallbackHeightCount = 0;

  for (const feature of buildingsArtifact?.features ?? []) {
    const sourceHeight = Number(feature?.height_m);
    const hasSourceHeight = Number.isFinite(sourceHeight) && sourceHeight > 0;
    if (hasSourceHeight !== resolved) continue;
    const heightMeters = hasSourceHeight ? sourceHeight : fallbackHeightMeters;
    const didAppend = appendBuilding(
      feature,
      wallPositions,
      wallIndices,
      wallUvs,
      roofPositions,
      roofIndices,
      roofUvs,
      (point) => {
        const projected = projectPoint(point);
        return [projected[0], projected[1] + groundLiftMeters, projected[2]];
      },
      heightMeters,
    );
    if (!didAppend) continue;
    count += 1;
    if (hasSourceHeight) sourceBackedHeightCount += 1;
    else fallbackHeightCount += 1;
  }

  const walls = typedGeometry(wallPositions, wallIndices, wallUvs);
  const roofs = typedGeometry(roofPositions, roofIndices, roofUvs);
  const combined = combineGeometry(walls, roofs);
  return {
    positions: combined.positions,
    indices: combined.indices,
    uvs: combined.uvs,
    walls: { positions: walls.positions, indices: walls.indices, uvs: walls.uvs },
    roofs: { positions: roofs.positions, indices: roofs.indices, uvs: roofs.uvs },
    count,
    metadata: {
      schema: 'nwe.building-surface-render-geometry/0.1',
      footprint_source: 'compiled-building-footprints',
      height_semantics: resolved ? 'source-backed' : 'renderer-only-fallback',
      fallback_height_m: resolved ? null : fallbackHeightMeters,
      ground_lift_m: groundLiftMeters,
      roof_triangulation: 'three-earcut-2d-footprint',
      uv_semantics: 'renderer-only-meter-scaled-surface-uv',
      uv_tile_m: SURFACE_UV_TILE_M,
      source_backed_height_count: sourceBackedHeightCount,
      fallback_height_count: fallbackHeightCount,
      wall_vertices: walls.vertexCount,
      wall_triangles: walls.triangleCount,
      roof_vertices: roofs.vertexCount,
      roof_triangles: roofs.triangleCount,
    },
  };
}
