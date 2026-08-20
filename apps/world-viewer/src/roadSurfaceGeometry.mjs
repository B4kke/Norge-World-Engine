const DEFAULT_VISUAL_WIDTH_M = 3.2;
const DEFAULT_MITER_LIMIT = 1.5;
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
  if (!(sumLength > 1e-5)) return [outgoingNormal[0] * halfWidth, outgoingNormal[1] * halfWidth];

  const miterX = sumX / sumLength;
  const miterZ = sumZ / sumLength;
  const denominator = miterX * outgoingNormal[0] + miterZ * outgoingNormal[1];
  if (!(denominator > 0.35)) return [outgoingNormal[0] * halfWidth, outgoingNormal[1] * halfWidth];

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

function pathWidth(path, fallbackWidthMeters) {
  const sourceWidth = Number(path?.width_m ?? path?.physical_width_m ?? path?.surface_width_m);
  if (Number.isFinite(sourceWidth) && sourceWidth >= 0.8 && sourceWidth <= 30) {
    return { width: sourceWidth, sourceBacked: true };
  }
  return { width: fallbackWidthMeters, sourceBacked: false };
}

function signedTriangleNormalY(positions, a, b, c) {
  const ax = positions[a * 3]; const az = positions[a * 3 + 2];
  const bx = positions[b * 3]; const bz = positions[b * 3 + 2];
  const cx = positions[c * 3]; const cz = positions[c * 3 + 2];
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

function pushUpwardTriangle(indices, positions, a, b, c) {
  const normalY = signedTriangleNormalY(positions, a, b, c);
  if (Math.abs(normalY) <= 1e-8) return false;
  if (normalY < 0) indices.push(a, c, b);
  else indices.push(a, b, c);
  return true;
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
  const normals = [];
  const uvs = [];
  const indices = [];
  let pathCount = 0;
  let segmentCount = 0;
  let centerlineLengthM = 0;
  let sourceWidthPathCount = 0;
  let fallbackWidthPathCount = 0;
  let minWidthM = Number.POSITIVE_INFINITY;
  let maxWidthM = 0;
  let skippedDegenerateTriangles = 0;

  for (const path of roadsArtifact?.paths ?? []) {
    const points = projectPath(path?.points, projectPoint);
    if (points.length < 2) continue;
    const resolvedWidth = pathWidth(path, widthMeters);
    const halfWidth = resolvedWidth.width / 2;
    if (resolvedWidth.sourceBacked) sourceWidthPathCount += 1;
    else fallbackWidthPathCount += 1;
    minWidthM = Math.min(minWidthM, resolvedWidth.width);
    maxWidthM = Math.max(maxWidthM, resolvedWidth.width);

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
      // Asphalt presentation uses a stable road-surface normal. Terrain-following
      // centerline elevation is geometry; raw DTM micro cross-slope is not used
      // as the asphalt normal because it created alternating lit/back-lit quads.
      normals.push(0, 1, 0, 0, 1, 0);
      const v = distanceAlong / uvPeriodMeters;
      uvs.push(0, v, 1, v);
    }

    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = baseVertex + index * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (!pushUpwardTriangle(indices, positions, a, b, c)) skippedDegenerateTriangles += 1;
      if (!pushUpwardTriangle(indices, positions, b, d, c)) skippedDegenerateTriangles += 1;
    }

    pathCount += 1;
    segmentCount += points.length - 1;
    centerlineLengthM += distanceAlong;
  }

  const vertexCount = positions.length / 3;
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new IndexArray(indices),
    metadata: {
      schema: 'nwe.road-surface-render-geometry/0.2',
      source: 'compiled-road-paths',
      width_m: widthMeters,
      width_semantics: sourceWidthPathCount > 0 ? 'source-backed-when-present-otherwise-renderer-fallback' : 'renderer-only-fallback',
      source_width_path_count: sourceWidthPathCount,
      fallback_width_path_count: fallbackWidthPathCount,
      width_range_m: pathCount ? [minWidthM, maxWidthM] : [widthMeters, widthMeters],
      miter_limit: miterLimit,
      uv_period_m: uvPeriodMeters,
      normal_semantics: 'renderer-stable-up-normal',
      winding: 'per-triangle-counter-clockwise-upward',
      skipped_degenerate_triangles: skippedDegenerateTriangles,
      path_count: pathCount,
      segment_count: segmentCount,
      centerline_length_m: centerlineLengthM,
      vertex_count: vertexCount,
      triangle_count: indices.length / 3,
    },
  };
}
