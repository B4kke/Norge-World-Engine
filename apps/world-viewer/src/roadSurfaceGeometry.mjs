const DEFAULT_VISUAL_WIDTH_M = 3.2;
const DEFAULT_MITER_LIMIT = 2.0;
const DEFAULT_UV_PERIOD_M = 4.0;
const DEFAULT_MINIMUM_POINT_SPACING_M = 1.25;

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

function projectPath(points, projectPoint, minimumPointSpacingMeters) {
  const projected = [];
  for (const point of points ?? []) {
    const local = projectPoint(point);
    if (!finitePoint(local)) throw new Error('ROAD_SURFACE_PROJECTED_POINT_INVALID');
    if (projected.length > 0 && planarDistance(projected.at(-1), local) <= 1e-4) continue;
    projected.push([Number(local[0]), Number(local[1]), Number(local[2])]);
  }

  if (!(minimumPointSpacingMeters > 0) || projected.length <= 2) return projected;

  // Renderer-only sampling. The source centerline is retained in the compiled artifact.
  // The 1.25 m guard is the first measured threshold that removes the four bow-tie
  // ribbon quads in the accepted 246-path Nannestad artifact at the current visual widths.
  const sampled = [projected[0]];
  for (let index = 1; index < projected.length - 1; index += 1) {
    if (planarDistance(sampled.at(-1), projected[index]) >= minimumPointSpacingMeters) sampled.push(projected[index]);
  }

  const last = projected.at(-1);
  if (planarDistance(sampled.at(-1), last) >= minimumPointSpacingMeters) {
    sampled.push(last);
  } else if (sampled.length > 1 && planarDistance(last, projected[0]) > 1e-4) {
    sampled[sampled.length - 1] = last;
  } else if (planarDistance(sampled.at(-1), last) > 1e-4) {
    sampled.push(last);
  }
  return sampled;
}

export function rendererRoadWidthMeters(path, fallbackWidthMeters = DEFAULT_VISUAL_WIDTH_M) {
  const type = String(path?.road_type ?? '').toLocaleLowerCase('nb-NO');
  if (/fortau/.test(type)) return 1.8;
  if (/gang-?\s*og\s*sykkel|gang.*sykkel|sykkelveg/.test(type)) return 3.0;
  if (/gangveg|gangvei/.test(type)) return 2.4;
  if (/sti|traktor/.test(type)) return 2.2;
  if (/enkel\s+bilveg/.test(type)) return 4.6;
  if (/rundkjøring|rampe/.test(type)) return 5.2;
  if (/bilveg|kjøreveg|kjørevei|veg|vei/.test(type)) return 5.0;
  return fallbackWidthMeters;
}

function resolveEdgeHeight(surfaceHeightAtLocalXZ, x, z, fallbackY, context) {
  if (typeof surfaceHeightAtLocalXZ !== 'function') return fallbackY;
  const value = Number(surfaceHeightAtLocalXZ(x, z, context));
  if (!Number.isFinite(value)) throw new Error('ROAD_SURFACE_EDGE_HEIGHT_INVALID');
  return value;
}

export function buildRoadSurfaceGeometry(roadsArtifact, {
  projectPoint,
  widthMeters = DEFAULT_VISUAL_WIDTH_M,
  widthForPath = rendererRoadWidthMeters,
  miterLimit = DEFAULT_MITER_LIMIT,
  uvPeriodMeters = DEFAULT_UV_PERIOD_M,
  minimumPointSpacingMeters = DEFAULT_MINIMUM_POINT_SPACING_M,
  surfaceHeightAtLocalXZ = null,
  edgeHeightSemantics = surfaceHeightAtLocalXZ ? 'renderer-supplied-drape' : 'projected-centerline',
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (!(Number.isFinite(widthMeters) && widthMeters > 0)) throw new RangeError('widthMeters must be > 0');
  if (typeof widthForPath !== 'function') throw new TypeError('widthForPath must be a function');
  if (!(Number.isFinite(miterLimit) && miterLimit >= 1)) throw new RangeError('miterLimit must be >= 1');
  if (!(Number.isFinite(uvPeriodMeters) && uvPeriodMeters > 0)) throw new RangeError('uvPeriodMeters must be > 0');
  if (!(Number.isFinite(minimumPointSpacingMeters) && minimumPointSpacingMeters >= 0)) throw new RangeError('minimumPointSpacingMeters must be >= 0');
  if (surfaceHeightAtLocalXZ !== null && typeof surfaceHeightAtLocalXZ !== 'function') throw new TypeError('surfaceHeightAtLocalXZ must be a function or null');

  const positions = [];
  const uvs = [];
  const indices = [];
  let pathCount = 0;
  let segmentCount = 0;
  let centerlineLengthM = 0;
  let sourcePointCount = 0;
  let sampledPointCount = 0;
  let minimumWidthM = Number.POSITIVE_INFINITY;
  let maximumWidthM = 0;
  const widthClassCounts = {};

  for (const path of roadsArtifact?.paths ?? []) {
    sourcePointCount += path?.points?.length ?? 0;
    const points = projectPath(path?.points, projectPoint, minimumPointSpacingMeters);
    sampledPointCount += points.length;
    if (points.length < 2) continue;

    const requestedWidth = Number(widthForPath(path, widthMeters));
    const pathWidth = Number.isFinite(requestedWidth) && requestedWidth > 0 ? requestedWidth : widthMeters;
    const halfWidth = pathWidth / 2;
    minimumWidthM = Math.min(minimumWidthM, pathWidth);
    maximumWidthM = Math.max(maximumWidthM, pathWidth);
    const widthKey = `${pathWidth.toFixed(1)}m`;
    widthClassCounts[widthKey] = (widthClassCounts[widthKey] ?? 0) + 1;

    const baseVertex = positions.length / 3;
    let distanceAlong = 0;
    for (let index = 0; index < points.length; index += 1) {
      if (index > 0) distanceAlong += planarDistance(points[index - 1], points[index]);
      const [offsetX, offsetZ] = joinOffset(points, index, halfWidth, miterLimit);
      const center = points[index];
      const leftX = center[0] + offsetX;
      const leftZ = center[2] + offsetZ;
      const rightX = center[0] - offsetX;
      const rightZ = center[2] - offsetZ;
      const leftY = resolveEdgeHeight(surfaceHeightAtLocalXZ, leftX, leftZ, center[1], { path, pointIndex: index, side: 'left', center });
      const rightY = resolveEdgeHeight(surfaceHeightAtLocalXZ, rightX, rightZ, center[1], { path, pointIndex: index, side: 'right', center });
      positions.push(leftX, leftY, leftZ, rightX, rightY, rightZ);
      const v = distanceAlong / uvPeriodMeters;
      uvs.push(0, v, 1, v);
    }

    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = baseVertex + index * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
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
      schema: 'nwe.road-surface-render-geometry/0.2',
      source: 'compiled-road-paths',
      width_m: widthMeters,
      width_semantics: 'renderer-only-road-type-fallback',
      width_range_m: pathCount > 0 ? [minimumWidthM, maximumWidthM] : [widthMeters, widthMeters],
      width_class_counts: widthClassCounts,
      miter_limit: miterLimit,
      uv_period_m: uvPeriodMeters,
      minimum_point_spacing_m: minimumPointSpacingMeters,
      point_spacing_semantics: 'renderer-only-sampling',
      edge_height_semantics: edgeHeightSemantics,
      source_point_count: sourcePointCount,
      sampled_point_count: sampledPointCount,
      removed_sample_count: Math.max(0, sourcePointCount - sampledPointCount),
      winding: 'counter-clockwise-upward',
      path_count: pathCount,
      segment_count: segmentCount,
      centerline_length_m: centerlineLengthM,
      vertex_count: vertexCount,
      triangle_count: indices.length / 3,
    },
  };
}
