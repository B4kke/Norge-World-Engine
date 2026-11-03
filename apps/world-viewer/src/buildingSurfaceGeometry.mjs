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

function pushUpwardTriangle(positions, indices, uvs, a, b, c) {
  const base = positions.length / 3;
  let first = a; let second = b; let third = c;
  if (signedTriangleNormalY(first, second, third) < 0) [second, third] = [third, second];
  positions.push(...first, ...second, ...third);
  uvs.push(
    first[0] / SURFACE_UV_TILE_M, first[2] / SURFACE_UV_TILE_M,
    second[0] / SURFACE_UV_TILE_M, second[2] / SURFACE_UV_TILE_M,
    third[0] / SURFACE_UV_TILE_M, third[2] / SURFACE_UV_TILE_M,
  );
  indices.push(base, base + 1, base + 2);
}

function appendFlatRoof(top, positions, indices, uvs) {
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

function projection(point, axis) {
  return point[0] * axis[0] + point[2] * axis[1];
}

function gableDescriptor(feature, base, totalHeightM) {
  const degrees = Number(feature?.presentation_gable_direction_deg_from_east_ccw);
  if (!Number.isFinite(degrees) || base.length !== 4 || feature?.presentation_roof_shape !== 'gabled') return null;
  const requestedRise = Number(feature?.presentation_gable_rise_m);
  const rise = Math.max(0.5, Math.min(Number.isFinite(requestedRise) ? requestedRise : 1.5, totalHeightM * 0.45, 5));
  if (!(rise > 0 && totalHeightM - rise >= 1.5)) return null;
  const radians = degrees * Math.PI / 180;
  const ridgeAxis = [Math.cos(radians), -Math.sin(radians)];
  const crossAxis = [-ridgeAxis[1], ridgeAxis[0]];
  const classified = base.map((point, index) => ({
    index,
    u: projection(point, ridgeAxis),
    v: projection(point, crossAxis),
  }));
  const sortedByV = [...classified].sort((a, b) => a.v - b.v);
  const low = sortedByV.slice(0, 2).sort((a, b) => a.u - b.u);
  const high = sortedByV.slice(2).sort((a, b) => a.u - b.u);
  if (low.length !== 2 || high.length !== 2) return null;
  const vSpan = Math.min(...high.map((item) => item.v)) - Math.max(...low.map((item) => item.v));
  if (!(vSpan > 0.5)) return null;
  const uMin = Math.min(...classified.map((item) => item.u));
  const uMax = Math.max(...classified.map((item) => item.u));
  const vCenter = (Math.min(...classified.map((item) => item.v)) + Math.max(...classified.map((item) => item.v))) * 0.5;
  if (!(uMax - uMin > 0.5)) return null;
  const groundMean = base.reduce((sum, point) => sum + point[1], 0) / base.length;
  const ridgeY = groundMean + totalHeightM;
  const pointAt = (u) => [
    ridgeAxis[0] * u + crossAxis[0] * vCenter,
    ridgeY,
    ridgeAxis[1] * u + crossAxis[1] * vCenter,
  ];
  return {
    rise,
    wallHeight: totalHeightM - rise,
    ridge: [pointAt(uMin), pointAt(uMax)],
    low,
    high,
  };
}

function appendGabledBuilding(base, descriptor, wallPositions, wallIndices, wallUvs, roofPositions, roofIndices, roofUvs) {
  const eaves = base.map((point) => [point[0], point[1] + descriptor.wallHeight, point[2]]);
  for (let index = 0; index < base.length; index += 1) {
    const next = (index + 1) % base.length;
    const edgeLengthM = Math.hypot(base[next][0] - base[index][0], base[next][2] - base[index][2]);
    pushQuad(wallPositions, wallIndices, wallUvs, base[index], base[next], eaves[next], eaves[index], edgeLengthM, descriptor.wallHeight);
  }

  const lowA = eaves[descriptor.low[0].index];
  const lowB = eaves[descriptor.low[1].index];
  const highA = eaves[descriptor.high[0].index];
  const highB = eaves[descriptor.high[1].index];
  const ridgeA = descriptor.ridge[0];
  const ridgeB = descriptor.ridge[1];

  pushUpwardTriangle(roofPositions, roofIndices, roofUvs, lowA, lowB, ridgeB);
  pushUpwardTriangle(roofPositions, roofIndices, roofUvs, lowA, ridgeB, ridgeA);
  pushUpwardTriangle(roofPositions, roofIndices, roofUvs, highA, ridgeA, ridgeB);
  pushUpwardTriangle(roofPositions, roofIndices, roofUvs, highA, ridgeB, highB);

  pushUpwardTriangle(wallPositions, wallIndices, wallUvs, lowA, highA, ridgeA);
  pushUpwardTriangle(wallPositions, wallIndices, wallUvs, lowB, ridgeB, highB);
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
  if (polygon.length < 3) return { appended: false, gabled: false };
  const base = polygon.map((point) => {
    const projected = projectPoint(point);
    if (!Array.isArray(projected) || projected.length < 3 || projected.some((value) => !Number.isFinite(value))) {
      throw new Error('BUILDING_PROJECTED_POINT_INVALID');
    }
    return [Number(projected[0]), Number(projected[1]), Number(projected[2])];
  });
  const descriptor = gableDescriptor(feature, base, heightMeters);
  if (descriptor) {
    appendGabledBuilding(base, descriptor, wallPositions, wallIndices, wallUvs, roofPositions, roofIndices, roofUvs);
    return { appended: true, gabled: true };
  }

  const top = base.map((point) => [point[0], point[1] + heightMeters, point[2]]);
  for (let index = 0; index < base.length; index += 1) {
    const next = (index + 1) % base.length;
    const edgeLengthM = Math.hypot(base[next][0] - base[index][0], base[next][2] - base[index][2]);
    pushQuad(wallPositions, wallIndices, wallUvs, base[index], base[next], top[next], top[index], edgeLengthM, heightMeters);
  }
  appendFlatRoof(top, roofPositions, roofIndices, roofUvs);
  return { appended: true, gabled: false };
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
  let derivedPresentationHeightCount = 0;
  let fallbackHeightCount = 0;
  let gabledPresentationCount = 0;

  for (const feature of buildingsArtifact?.features ?? []) {
    const height = Number(feature?.height_m);
    const hasResolvedHeight = Number.isFinite(height) && height > 0;
    if (hasResolvedHeight !== resolved) continue;
    const heightMeters = hasResolvedHeight ? height : fallbackHeightMeters;
    const result = appendBuilding(
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
    if (!result.appended) continue;
    count += 1;
    if (result.gabled) gabledPresentationCount += 1;
    if (hasResolvedHeight) {
      if (feature?.height_semantics === 'derived-nhm-dom-minus-dtm-p90-presentation') derivedPresentationHeightCount += 1;
      else sourceBackedHeightCount += 1;
    } else fallbackHeightCount += 1;
  }

  const walls = typedGeometry(wallPositions, wallIndices, wallUvs);
  const roofs = typedGeometry(roofPositions, roofIndices, roofUvs);
  const combined = combineGeometry(walls, roofs);
  const resolvedSemantics = derivedPresentationHeightCount > 0
    ? 'source-backed-or-verified-dom-derived-presentation'
    : 'source-backed';
  return {
    positions: combined.positions,
    indices: combined.indices,
    uvs: combined.uvs,
    walls: { positions: walls.positions, indices: walls.indices, uvs: walls.uvs },
    roofs: { positions: roofs.positions, indices: roofs.indices, uvs: roofs.uvs },
    count,
    metadata: {
      schema: 'nwe.building-surface-render-geometry/0.2',
      footprint_source: 'compiled-building-footprints',
      height_semantics: resolved ? resolvedSemantics : 'renderer-only-fallback',
      fallback_height_m: resolved ? null : fallbackHeightMeters,
      ground_lift_m: groundLiftMeters,
      roof_triangulation: gabledPresentationCount > 0 ? 'earcut-flat-plus-strong-dom-oriented-presentation-gables' : 'three-earcut-2d-footprint',
      roof_shape_truth: 'source roof shape is not inferred from DOM; gables are explicit renderer policy only',
      uv_semantics: 'renderer-only-meter-scaled-surface-uv',
      uv_tile_m: SURFACE_UV_TILE_M,
      source_backed_height_count: sourceBackedHeightCount,
      derived_presentation_height_count: derivedPresentationHeightCount,
      fallback_height_count: fallbackHeightCount,
      gabled_presentation_count: gabledPresentationCount,
      wall_vertices: walls.vertexCount,
      wall_triangles: walls.triangleCount,
      roof_vertices: roofs.vertexCount,
      roof_triangles: roofs.triangleCount,
    },
  };
}
