const DEFAULT_VISUAL_WIDTH_M = 3.2;
const DEFAULT_MITER_LIMIT = 2.0;
const DEFAULT_UV_PERIOD_M = 4.0;

function finitePoint(point) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Number.isFinite(point[2]);
}

function planarDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

function normalizedDirection(a, b) {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dz);
  if (!(length > 1e-6)) return null;
  return [dx / length, dz / length];
}

function leftNormal(direction) {
  return [-direction[1], direction[0]];
}

function endpointOffset(points, index, halfWidth) {
  const neighbor = index === 0 ? 1 : index - 1;
  const direction = index === 0
    ? normalizedDirection(points[index], points[neighbor])
    : normalizedDirection(points[neighbor], points[index]);
  if (!direction) return [halfWidth, 0];
  const normal = leftNormal(direction);
  return [normal[0] * halfWidth, normal[1] * halfWidth];
}

function joinOffset(points, index, halfWidth, miterLimit) {
  if (index === 0 || index === points.length - 1) return endpointOffset(points, index, halfWidth);

  const incoming = normalizedDirection(points[index - 1], points[index]);
  const outgoing = normalizedDirection(points[index], points[index + 1]);
  if (!incoming || !outgoing) return endpointOffset(points, index, halfWidth);

  const incomingNormal = leftNormal(incoming);
  const outgoingNormal = leftNormal(outgoing);
  const sumX = incomingNormal[0] + outgoingNormal[0];
  const sumZ = incomingNormal[1] + outgoingNormal[1];
  const sumLength = Math.hypot(sumX, sumZ);
  if (!(sumLength > 1e-5)) {
    return [outgoingNormal[0] * halfWidth, outgoingNormal[1] * halfWidth];
  }

  const miterX = sumX / sumLength;
  const miterZ = sumZ / sumLength;
  const denominator = miterX * outgoingNormal[0] + miterZ * outgoingNormal[1];
  if (!(denominator > 0.2)) {
    return [outgoingNormal[0] * halfWidth, outgoingNormal[1] * halfWidth];
  }

  const requestedLength = halfWidth / denominator;
  const cappedLength = Math.min(requestedLength, halfWidth * miterLimit);
  return [miterX * cappedLength, miterZ * cappedLength];
}

function projectPath(points, projectPoint) {
  const projected = [];
  for (const point of points ?? []) {
    const local = projectPoint(point);
    if (!finitePoint(local)) throw new Error('ROAD_SURFACE_PROJECTED_POINT_INVALID');
    if (projected.length > 0 && planarDistance(projected.at(-1), local) <= 1e-4) continue;
    projected.push([Number(local[0]), Number(local[1]), Number(local[2])]);
  }
  return projected;
}

export function buildRoadSurfaceGeometry(roadsArtifact, {
  projectPoint,
  widthMeters = DEFAULT_VISUAL_WIDTH_M,
  miterLimit = DEFAULT_MITER_LIMIT,
  uvPeriodMeters = DEFAULT_UV_PERIOD_M,
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (!(Number.isFinite(widthMeters) && widthMeters > 0)) throw new RangeError('widthMeters must be > 0');
  if (!(Number.isFinite(miterLimit) && miterLimit >= 1)) throw new RangeError('miterLimit must be >= 1');
  if (!(Number.isFinite(uvPeriodMeters) && uvPeriodMeters > 0)) throw new RangeError('uvPeriodMeters must be > 0');

  const positions = [];
  const uvs = [];
  const indices = [];
  const halfWidth = widthMeters / 2;
  let pathCount = 0;
  let segmentCount = 0;
  let centerlineLengthM = 0;

  for (const path of roadsArtifact?.paths ?? []) {
    const points = projectPath(path?.points, projectPoint);
    if (points.length < 2) continue;

    const baseVertex = positions.length / 3;
    let distanceAlong = 0;
    for (let index = 0; index < points.length; index += 1) {
      if (index > 0) distanceAlong += planarDistance(points[index - 1], points[index]);
      const [offsetX, offsetZ] = joinOffset(points, index, halfWidth, miterLimit);
      const center = points[index];
      positions.push(
        center[0] + offsetX, center[1], center[2] + offsetZ,
        center[0] - offsetX, center[1], center[2] - offsetZ,
      );
      const v = distanceAlong / uvPeriodMeters;
      uvs.push(0, v, 1, v);
    }

    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = baseVertex + index * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    pathCount += 1;
    segmentCount += points.length - 1;
    centerlineLengthM += distanceAlong;
  }

  const vertexCount = positions.length / 3;
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new IndexArray(indices),
    metadata: {
      schema: 'nwe.road-surface-render-geometry/0.1',
      source: 'compiled-road-paths',
      width_m: widthMeters,
      width_semantics: 'renderer-only-fallback',
      miter_limit: miterLimit,
      uv_period_m: uvPeriodMeters,
      path_count: pathCount,
      segment_count: segmentCount,
      centerline_length_m: centerlineLengthM,
      vertex_count: vertexCount,
      triangle_count: indices.length / 3,
    },
  };
}
