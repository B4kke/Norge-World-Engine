import { Earcut } from 'three/src/extras/Earcut.js';

const DEFAULT_FALLBACK_HEIGHT_M = 5;
const DEFAULT_GROUND_LIFT_M = 0.08;
const DEFAULT_WALL_UV_PERIOD_M = 2.0;
const DEFAULT_ROOF_UV_PERIOD_M = 1.5;
const MIN_EAVE_HEIGHT_M = 2.2;

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

function pushQuad(positions, uvs, indices, a, b, c, d, uvA, uvB, uvC, uvD) {
  const base = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  uvs.push(...uvA, ...uvB, ...uvC, ...uvD);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function pushTriangle(positions, uvs, indices, a, b, c, uvA, uvB, uvC) {
  const base = positions.length / 3;
  positions.push(...a, ...b, ...c);
  uvs.push(...uvA, ...uvB, ...uvC);
  indices.push(base, base + 1, base + 2);
}

function signedTriangleNormalY(a, b, c) {
  const abx = b[0] - a[0];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acz = c[2] - a[2];
  return abz * acx - abx * acz;
}

function pushUpwardQuad(positions, uvs, indices, points, uvPoints) {
  const base = positions.length / 3;
  for (const point of points) positions.push(...point);
  for (const uv of uvPoints) uvs.push(...uv);
  const triangles = [[0, 1, 2], [0, 2, 3]];
  for (const triangle of triangles) {
    let [a, b, c] = triangle;
    if (signedTriangleNormalY(points[a], points[b], points[c]) < 0) [b, c] = [c, b];
    indices.push(base + a, base + b, base + c);
  }
}

function appendFlatRoof(top, positions, uvs, indices, uvPeriodMeters) {
  const flattened = [];
  for (const point of top) flattened.push(point[0], point[2]);
  const faces = Earcut.triangulate(flattened, null, 2);
  if (faces.length !== Math.max(0, top.length - 2) * 3) {
    throw new Error(`BUILDING_ROOF_TRIANGULATION_INVALID: ${faces.length} indices for ${top.length} vertices`);
  }
  const base = positions.length / 3;
  const origin = top[0];
  for (const point of top) {
    positions.push(...point);
    uvs.push((point[0] - origin[0]) / uvPeriodMeters, (point[2] - origin[2]) / uvPeriodMeters);
  }
  for (let offset = 0; offset < faces.length; offset += 3) {
    let ia = faces[offset];
    let ib = faces[offset + 1];
    let ic = faces[offset + 2];
    if (signedTriangleNormalY(top[ia], top[ib], top[ic]) < 0) [ib, ic] = [ic, ib];
    indices.push(base + ia, base + ib, base + ic);
  }
}

function edgeLength(a, b) {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

function midpoint(a, b, y) {
  return [(a[0] + b[0]) * 0.5, y, (a[2] + b[2]) * 0.5];
}

function isConvexQuad(points) {
  if (points.length !== 4) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const abx = b[0] - a[0]; const abz = b[2] - a[2];
    const bcx = c[0] - b[0]; const bcz = c[2] - b[2];
    const cross = abx * bcz - abz * bcx;
    if (Math.abs(cross) < 1e-6) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return sign !== 0;
}

function gableCandidate(feature, base) {
  if (feature?.clipped || !isConvexQuad(base)) return false;
  const type = String(feature?.building ?? '').toLowerCase();
  return /house|detached|semidetached|terrace|residential|garage|shed|farm|barn|farm_auxiliary/.test(type);
}

export function rendererFallbackBuildingHeightMeters(feature, fallbackHeightMeters = DEFAULT_FALLBACK_HEIGHT_M) {
  const type = String(feature?.building ?? '').toLowerCase();
  if (/carport/.test(type)) return 2.8;
  if (/shed/.test(type)) return 2.8;
  if (/garage/.test(type)) return 3.2;
  if (/farm_auxiliary/.test(type)) return 3.8;
  if (/barn/.test(type)) return 7.5;
  if (/warehouse/.test(type)) return 7.5;
  if (/industrial/.test(type)) return 8.0;
  if (/school|civic/.test(type)) return 8.0;
  if (/apartments/.test(type)) return 10.5;
  if (/terrace/.test(type)) return 7.5;
  if (/house|detached|semidetached/.test(type)) return 6.5;
  if (/farm/.test(type)) return 6.5;
  if (/commercial/.test(type)) return 7.5;
  if (/retail/.test(type)) return 6.5;
  if (/residential/.test(type)) return 7.0;
  if (/yes/.test(type)) return 5.8;
  return fallbackHeightMeters;
}

function gableRoofRiseMeters(top, totalHeightMeters) {
  const lengths = [
    edgeLength(top[0], top[1]),
    edgeLength(top[1], top[2]),
    edgeLength(top[2], top[3]),
    edgeLength(top[3], top[0]),
  ];
  const pairA = (lengths[0] + lengths[2]) * 0.5;
  const pairB = (lengths[1] + lengths[3]) * 0.5;
  const shortSpan = Math.min(pairA, pairB);
  const geometricRise = shortSpan * Math.tan(28 * Math.PI / 180) * 0.5;
  const envelopeCap = Math.max(0.45, totalHeightMeters - MIN_EAVE_HEIGHT_M);
  return Math.max(0.45, Math.min(2.6, totalHeightMeters * 0.28, envelopeCap, geometricRise));
}

function appendGableRoof(eaveTop, roofRise, wallPositions, wallUvs, wallIndices, roofPositions, roofUvs, roofIndices, wallUvPeriodMeters, roofUvPeriodMeters) {
  const lengths = [
    edgeLength(eaveTop[0], eaveTop[1]),
    edgeLength(eaveTop[1], eaveTop[2]),
    edgeLength(eaveTop[2], eaveTop[3]),
    edgeLength(eaveTop[3], eaveTop[0]),
  ];
  const pairA = (lengths[0] + lengths[2]) * 0.5;
  const pairB = (lengths[1] + lengths[3]) * 0.5;
  const eaveY = eaveTop[0][1];
  const ridgeY = eaveY + roofRise;

  if (pairA >= pairB) {
    const ridgeA = midpoint(eaveTop[3], eaveTop[0], ridgeY);
    const ridgeB = midpoint(eaveTop[1], eaveTop[2], ridgeY);
    const slopeSpan = Math.hypot(pairB * 0.5, roofRise) / roofUvPeriodMeters;
    pushUpwardQuad(roofPositions, roofUvs, roofIndices,
      [eaveTop[0], eaveTop[1], ridgeB, ridgeA],
      [[0, 0], [lengths[0] / roofUvPeriodMeters, 0], [lengths[0] / roofUvPeriodMeters, slopeSpan], [0, slopeSpan]]);
    pushUpwardQuad(roofPositions, roofUvs, roofIndices,
      [eaveTop[2], eaveTop[3], ridgeA, ridgeB],
      [[0, 0], [lengths[2] / roofUvPeriodMeters, 0], [lengths[2] / roofUvPeriodMeters, slopeSpan], [0, slopeSpan]]);
    pushTriangle(wallPositions, wallUvs, wallIndices, eaveTop[1], eaveTop[2], ridgeB,
      [0, 0], [lengths[1] / wallUvPeriodMeters, 0], [lengths[1] / wallUvPeriodMeters * 0.5, roofRise / wallUvPeriodMeters]);
    pushTriangle(wallPositions, wallUvs, wallIndices, eaveTop[3], eaveTop[0], ridgeA,
      [0, 0], [lengths[3] / wallUvPeriodMeters, 0], [lengths[3] / wallUvPeriodMeters * 0.5, roofRise / wallUvPeriodMeters]);
  } else {
    const ridgeA = midpoint(eaveTop[0], eaveTop[1], ridgeY);
    const ridgeB = midpoint(eaveTop[2], eaveTop[3], ridgeY);
    const slopeSpan = Math.hypot(pairA * 0.5, roofRise) / roofUvPeriodMeters;
    pushUpwardQuad(roofPositions, roofUvs, roofIndices,
      [eaveTop[1], eaveTop[2], ridgeB, ridgeA],
      [[0, 0], [lengths[1] / roofUvPeriodMeters, 0], [lengths[1] / roofUvPeriodMeters, slopeSpan], [0, slopeSpan]]);
    pushUpwardQuad(roofPositions, roofUvs, roofIndices,
      [eaveTop[3], eaveTop[0], ridgeA, ridgeB],
      [[0, 0], [lengths[3] / roofUvPeriodMeters, 0], [lengths[3] / roofUvPeriodMeters, slopeSpan], [0, slopeSpan]]);
    pushTriangle(wallPositions, wallUvs, wallIndices, eaveTop[0], eaveTop[1], ridgeA,
      [0, 0], [lengths[0] / wallUvPeriodMeters, 0], [lengths[0] / wallUvPeriodMeters * 0.5, roofRise / wallUvPeriodMeters]);
    pushTriangle(wallPositions, wallUvs, wallIndices, eaveTop[2], eaveTop[3], ridgeB,
      [0, 0], [lengths[2] / wallUvPeriodMeters, 0], [lengths[2] / wallUvPeriodMeters * 0.5, roofRise / wallUvPeriodMeters]);
  }
}

function typedGeometry(positions, uvs, indices) {
  const vertexCount = positions.length / 3;
  if (uvs.length !== vertexCount * 2) throw new Error('BUILDING_UV_ATTRIBUTE_MISMATCH');
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new IndexArray(indices),
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
  return { positions, uvs, indices };
}

function appendBuilding(feature, wallPositions, wallUvs, wallIndices, roofPositions, roofUvs, roofIndices, projectPoint, totalHeightMeters, wallUvPeriodMeters, roofUvPeriodMeters) {
  const polygon = polygonWithoutDuplicateClosure(feature?.polygon);
  if (polygon.length < 3) return null;
  const projected = polygon.map((point) => {
    const local = projectPoint(point);
    if (!Array.isArray(local) || local.length < 3 || local.some((value) => !Number.isFinite(value))) {
      throw new Error('BUILDING_PROJECTED_POINT_INVALID');
    }
    return [Number(local[0]), Number(local[1]), Number(local[2])];
  });

  // Buildings are rigid structures. A level pad avoids twisting walls/roofs along the
  // DTM triangulation. Using the minimum sampled footprint height embeds the uphill
  // side rather than floating the downhill side. This is presentation geometry only.
  const foundationY = Math.min(...projected.map((point) => point[1]));
  const base = projected.map((point) => [point[0], foundationY, point[2]]);
  const useGable = gableCandidate(feature, base);
  const roofRise = useGable ? gableRoofRiseMeters(base, totalHeightMeters) : 0;
  const eaveHeight = Math.max(MIN_EAVE_HEIGHT_M, totalHeightMeters - roofRise);
  const top = base.map((point) => [point[0], point[1] + eaveHeight, point[2]]);

  for (let index = 0; index < base.length; index += 1) {
    const next = (index + 1) % base.length;
    const length = edgeLength(base[index], base[next]);
    const uMax = length / wallUvPeriodMeters;
    const vMax = eaveHeight / wallUvPeriodMeters;
    pushQuad(
      wallPositions,
      wallUvs,
      wallIndices,
      base[index], base[next], top[next], top[index],
      [0, 0], [uMax, 0], [uMax, vMax], [0, vMax],
    );
  }

  if (useGable) {
    appendGableRoof(top, roofRise, wallPositions, wallUvs, wallIndices, roofPositions, roofUvs, roofIndices, wallUvPeriodMeters, roofUvPeriodMeters);
  } else {
    appendFlatRoof(top, roofPositions, roofUvs, roofIndices, roofUvPeriodMeters);
  }
  return { morphology: useGable ? 'gable' : 'flat', foundationY, totalHeightMeters, eaveHeight, roofRise };
}

export function buildBuildingSurfaceGeometry(buildingsArtifact, {
  projectPoint,
  resolved,
  fallbackHeightMeters = DEFAULT_FALLBACK_HEIGHT_M,
  groundLiftMeters = DEFAULT_GROUND_LIFT_M,
  wallUvPeriodMeters = DEFAULT_WALL_UV_PERIOD_M,
  roofUvPeriodMeters = DEFAULT_ROOF_UV_PERIOD_M,
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (typeof resolved !== 'boolean') throw new TypeError('resolved must be boolean');
  if (!(Number.isFinite(fallbackHeightMeters) && fallbackHeightMeters > 0)) throw new RangeError('fallbackHeightMeters must be > 0');
  if (!(Number.isFinite(groundLiftMeters) && groundLiftMeters >= 0)) throw new RangeError('groundLiftMeters must be >= 0');
  if (!(Number.isFinite(wallUvPeriodMeters) && wallUvPeriodMeters > 0)) throw new RangeError('wallUvPeriodMeters must be > 0');
  if (!(Number.isFinite(roofUvPeriodMeters) && roofUvPeriodMeters > 0)) throw new RangeError('roofUvPeriodMeters must be > 0');

  const wallPositions = [];
  const wallUvs = [];
  const wallIndices = [];
  const roofPositions = [];
  const roofUvs = [];
  const roofIndices = [];
  let count = 0;
  let sourceBackedHeightCount = 0;
  let fallbackHeightCount = 0;
  let gableRoofCount = 0;
  let flatRoofCount = 0;
  let fallbackMinHeight = Number.POSITIVE_INFINITY;
  let fallbackMaxHeight = 0;

  for (const feature of buildingsArtifact?.features ?? []) {
    const sourceHeight = Number(feature?.height_m);
    const hasSourceHeight = Number.isFinite(sourceHeight) && sourceHeight > 0;
    if (hasSourceHeight !== resolved) continue;
    const heightMeters = hasSourceHeight ? sourceHeight : rendererFallbackBuildingHeightMeters(feature, fallbackHeightMeters);
    const result = appendBuilding(
      feature,
      wallPositions,
      wallUvs,
      wallIndices,
      roofPositions,
      roofUvs,
      roofIndices,
      (point) => {
        const projected = projectPoint(point);
        return [projected[0], projected[1] + groundLiftMeters, projected[2]];
      },
      heightMeters,
      wallUvPeriodMeters,
      roofUvPeriodMeters,
    );
    if (!result) continue;
    count += 1;
    if (result.morphology === 'gable') gableRoofCount += 1;
    else flatRoofCount += 1;
    if (hasSourceHeight) sourceBackedHeightCount += 1;
    else {
      fallbackHeightCount += 1;
      fallbackMinHeight = Math.min(fallbackMinHeight, heightMeters);
      fallbackMaxHeight = Math.max(fallbackMaxHeight, heightMeters);
    }
  }

  const walls = typedGeometry(wallPositions, wallUvs, wallIndices);
  const roofs = typedGeometry(roofPositions, roofUvs, roofIndices);
  const combined = combineGeometry(walls, roofs);
  return {
    positions: combined.positions,
    uvs: combined.uvs,
    indices: combined.indices,
    walls: { positions: walls.positions, uvs: walls.uvs, indices: walls.indices },
    roofs: { positions: roofs.positions, uvs: roofs.uvs, indices: roofs.indices },
    count,
    metadata: {
      schema: 'nwe.building-surface-render-geometry/0.2',
      footprint_source: 'compiled-building-footprints',
      height_semantics: resolved ? 'source-backed-envelope' : 'renderer-only-building-type-fallback',
      fallback_height_m: resolved ? null : fallbackHeightMeters,
      fallback_height_policy: resolved ? null : 'renderer-only-building-type-heuristic',
      fallback_height_range_m: resolved || fallbackHeightCount === 0 ? null : [fallbackMinHeight, fallbackMaxHeight],
      foundation_semantics: 'renderer-only-level-pad-min-accepted-dtm',
      roof_morphology_semantics: 'renderer-only-type-and-footprint-heuristic',
      ground_lift_m: groundLiftMeters,
      roof_triangulation: 'three-earcut-flat-or-bounded-quad-gable',
      uv_semantics: 'renderer-only-meter-scaled',
      wall_uv_period_m: wallUvPeriodMeters,
      roof_uv_period_m: roofUvPeriodMeters,
      source_backed_height_count: sourceBackedHeightCount,
      fallback_height_count: fallbackHeightCount,
      gable_roof_count: gableRoofCount,
      flat_roof_count: flatRoofCount,
      wall_vertices: walls.vertexCount,
      wall_triangles: walls.triangleCount,
      roof_vertices: roofs.vertexCount,
      roof_triangles: roofs.triangleCount,
    },
  };
}
