const DEFAULT_VISUAL_WIDTH_M = 3.2;
const DEFAULT_UV_PERIOD_M = 4.0;
const DEFAULT_MINIMUM_POINT_SPACING_M = 0;
const DEFAULT_INNER_JOIN_LIMIT = 4.0;

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

function cross2(a, b) {
  return a[0] * b[1] - a[1] * b[0];
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

  const sampled = [projected[0]];
  for (let index = 1; index < projected.length - 1; index += 1) {
    if (planarDistance(sampled.at(-1), projected[index]) >= minimumPointSpacingMeters) sampled.push(projected[index]);
  }
  const last = projected.at(-1);
  if (planarDistance(sampled.at(-1), last) >= minimumPointSpacingMeters) sampled.push(last);
  else if (sampled.length > 1 && planarDistance(last, projected[0]) > 1e-4) sampled[sampled.length - 1] = last;
  else if (planarDistance(sampled.at(-1), last) > 1e-4) sampled.push(last);
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

function signedTriangleNormalY(positions, ia, ib, ic) {
  const ax = positions[ia * 3]; const az = positions[ia * 3 + 2];
  const bx = positions[ib * 3]; const bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3]; const cz = positions[ic * 3 + 2];
  const abx = bx - ax; const abz = bz - az;
  const acx = cx - ax; const acz = cz - az;
  return abz * acx - abx * acz;
}

function pushUpwardTriangle(indices, positions, a, b, c) {
  if (signedTriangleNormalY(positions, a, b, c) < 0) indices.push(a, c, b);
  else indices.push(a, b, c);
}

function offsetXZ(center, normal, sign, halfWidth) {
  return [center[0] + normal[0] * sign * halfWidth, center[2] + normal[1] * sign * halfWidth];
}

function lineIntersectionXZ(pointA, directionA, pointB, directionB) {
  const denominator = cross2(directionA, directionB);
  if (Math.abs(denominator) <= 1e-7) return null;
  const delta = [pointB[0] - pointA[0], pointB[1] - pointA[1]];
  const t = cross2(delta, directionB) / denominator;
  const x = pointA[0] + directionA[0] * t;
  const z = pointA[1] + directionA[1] * t;
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}

function createJoin(incoming, outgoing, center, halfWidth, joinLimit) {
  const turn = cross2(incoming.direction, outgoing.direction);
  if (Math.abs(turn) <= 1e-5) return null;
  const innerSign = turn > 0 ? 1 : -1;
  const outerSign = -innerSign;
  const incomingInnerBase = offsetXZ(center, incoming.normal, innerSign, halfWidth);
  const outgoingInnerBase = offsetXZ(center, outgoing.normal, innerSign, halfWidth);
  let inner = lineIntersectionXZ(incomingInnerBase, incoming.direction, outgoingInnerBase, outgoing.direction);
  let innerFallback = false;
  if (!inner || Math.hypot(inner[0] - center[0], inner[1] - center[2]) > halfWidth * joinLimit) {
    // Extremely acute/U-turn-ish source geometry should narrow locally rather than
    // produce a long miter spike. This fallback is still non-overlapping.
    inner = [center[0], center[2]];
    innerFallback = true;
  }
  return {
    innerSide: innerSign > 0 ? 'left' : 'right',
    inner,
    incomingOuter: offsetXZ(center, incoming.normal, outerSign, halfWidth),
    outgoingOuter: offsetXZ(center, outgoing.normal, outerSign, halfWidth),
    center,
    v: incoming.endV,
    innerFallback,
  };
}

function endpointXZ(segment, side, endpoint, join, halfWidth) {
  const sign = side === 'left' ? 1 : -1;
  if (!join) return offsetXZ(endpoint === 'start' ? segment.start : segment.end, segment.normal, sign, halfWidth);
  if (join.innerSide === side) return join.inner;
  return endpoint === 'start' ? join.outgoingOuter : join.incomingOuter;
}

export function buildRoadSurfaceGeometry(roadsArtifact, {
  projectPoint,
  widthMeters = DEFAULT_VISUAL_WIDTH_M,
  widthForPath = rendererRoadWidthMeters,
  uvPeriodMeters = DEFAULT_UV_PERIOD_M,
  minimumPointSpacingMeters = DEFAULT_MINIMUM_POINT_SPACING_M,
  innerJoinLimit = DEFAULT_INNER_JOIN_LIMIT,
  surfaceHeightAtLocalXZ = null,
  edgeHeightSemantics = surfaceHeightAtLocalXZ ? 'renderer-supplied-drape' : 'projected-centerline',
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (!(Number.isFinite(widthMeters) && widthMeters > 0)) throw new RangeError('widthMeters must be > 0');
  if (typeof widthForPath !== 'function') throw new TypeError('widthForPath must be a function');
  if (!(Number.isFinite(uvPeriodMeters) && uvPeriodMeters > 0)) throw new RangeError('uvPeriodMeters must be > 0');
  if (!(Number.isFinite(minimumPointSpacingMeters) && minimumPointSpacingMeters >= 0)) throw new RangeError('minimumPointSpacingMeters must be >= 0');
  if (!(Number.isFinite(innerJoinLimit) && innerJoinLimit >= 1)) throw new RangeError('innerJoinLimit must be >= 1');
  if (surfaceHeightAtLocalXZ !== null && typeof surfaceHeightAtLocalXZ !== 'function') throw new TypeError('surfaceHeightAtLocalXZ must be a function or null');

  const positions = [];
  const uvs = [];
  const indices = [];
  let pathCount = 0;
  let segmentCount = 0;
  let joinTriangleCount = 0;
  let joinInnerFallbackCount = 0;
  let centerlineLengthM = 0;
  let sourcePointCount = 0;
  let sampledPointCount = 0;
  let minimumWidthM = Number.POSITIVE_INFINITY;
  let maximumWidthM = 0;
  const widthClassCounts = {};

  const pushVertex = (x, z, fallbackY, uv, context) => {
    const y = resolveEdgeHeight(surfaceHeightAtLocalXZ, x, z, fallbackY, context);
    const vertex = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(uv[0], uv[1]);
    return vertex;
  };

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

    let distanceAlong = 0;
    const segments = [];
    for (let segmentIndex = 0; segmentIndex + 1 < points.length; segmentIndex += 1) {
      const start = points[segmentIndex];
      const end = points[segmentIndex + 1];
      const direction = normalizedDirection(start, end);
      if (!direction) continue;
      const length = planarDistance(start, end);
      const startV = distanceAlong / uvPeriodMeters;
      distanceAlong += length;
      const endV = distanceAlong / uvPeriodMeters;
      segments.push({
        sourceIndex: segmentIndex,
        start,
        end,
        direction,
        normal: leftNormal(direction),
        startV,
        endV,
      });
    }
    if (segments.length === 0) continue;

    const joins = new Array(Math.max(0, segments.length - 1)).fill(null);
    for (let index = 0; index + 1 < segments.length; index += 1) {
      const join = createJoin(segments[index], segments[index + 1], segments[index].end, halfWidth, innerJoinLimit);
      joins[index] = join;
      if (join?.innerFallback) joinInnerFallbackCount += 1;
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const startJoin = segmentIndex > 0 ? joins[segmentIndex - 1] : null;
      const endJoin = segmentIndex + 1 < segments.length ? joins[segmentIndex] : null;
      const leftStartXZ = endpointXZ(segment, 'left', 'start', startJoin, halfWidth);
      const rightStartXZ = endpointXZ(segment, 'right', 'start', startJoin, halfWidth);
      const leftEndXZ = endpointXZ(segment, 'left', 'end', endJoin, halfWidth);
      const rightEndXZ = endpointXZ(segment, 'right', 'end', endJoin, halfWidth);

      const leftStart = pushVertex(leftStartXZ[0], leftStartXZ[1], segment.start[1], [0, segment.startV], { path, segmentIndex: segment.sourceIndex, side: 'left-start', center: segment.start });
      const rightStart = pushVertex(rightStartXZ[0], rightStartXZ[1], segment.start[1], [1, segment.startV], { path, segmentIndex: segment.sourceIndex, side: 'right-start', center: segment.start });
      const leftEnd = pushVertex(leftEndXZ[0], leftEndXZ[1], segment.end[1], [0, segment.endV], { path, segmentIndex: segment.sourceIndex, side: 'left-end', center: segment.end });
      const rightEnd = pushVertex(rightEndXZ[0], rightEndXZ[1], segment.end[1], [1, segment.endV], { path, segmentIndex: segment.sourceIndex, side: 'right-end', center: segment.end });
      pushUpwardTriangle(indices, positions, leftStart, leftEnd, rightStart);
      pushUpwardTriangle(indices, positions, rightStart, leftEnd, rightEnd);
      segmentCount += 1;
    }

    for (let index = 0; index < joins.length; index += 1) {
      const join = joins[index];
      if (!join) continue;
      const outerU = join.innerSide === 'left' ? 1 : 0;
      const innerU = 1 - outerU;
      const uvSpan = Math.min(0.25, halfWidth / uvPeriodMeters * 0.2);
      const incomingOuter = pushVertex(join.incomingOuter[0], join.incomingOuter[1], join.center[1], [outerU, join.v - uvSpan], { path, pointIndex: index + 1, side: 'bevel-incoming-outer', center: join.center });
      const outgoingOuter = pushVertex(join.outgoingOuter[0], join.outgoingOuter[1], join.center[1], [outerU, join.v + uvSpan], { path, pointIndex: index + 1, side: 'bevel-outgoing-outer', center: join.center });
      const inner = pushVertex(join.inner[0], join.inner[1], join.center[1], [innerU, join.v], { path, pointIndex: index + 1, side: 'bevel-inner', center: join.center });
      pushUpwardTriangle(indices, positions, incomingOuter, outgoingOuter, inner);
      joinTriangleCount += 1;
    }

    pathCount += 1;
    centerlineLengthM += distanceAlong;
  }

  const vertexCount = positions.length / 3;
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new IndexArray(indices),
    metadata: {
      schema: 'nwe.road-surface-render-geometry/0.4',
      source: 'compiled-road-paths',
      width_m: widthMeters,
      width_semantics: 'renderer-only-road-type-fallback',
      width_range_m: pathCount > 0 ? [minimumWidthM, maximumWidthM] : [widthMeters, widthMeters],
      width_class_counts: widthClassCounts,
      join_strategy: 'nonoverlap-inner-intersection-bevel',
      join_triangle_count: joinTriangleCount,
      join_inner_fallback_count: joinInnerFallbackCount,
      inner_join_limit: innerJoinLimit,
      uv_period_m: uvPeriodMeters,
      minimum_point_spacing_m: minimumPointSpacingMeters,
      point_spacing_semantics: minimumPointSpacingMeters > 0 ? 'renderer-only-sampling' : 'source-points-after-exact-duplicate-filter',
      edge_height_semantics: edgeHeightSemantics,
      source_point_count: sourcePointCount,
      sampled_point_count: sampledPointCount,
      removed_sample_count: Math.max(0, sourcePointCount - sampledPointCount),
      overlap_policy: 'no-intentional-segment-overlap',
      winding: 'counter-clockwise-upward',
      path_count: pathCount,
      segment_count: segmentCount,
      centerline_length_m: centerlineLengthM,
      vertex_count: vertexCount,
      triangle_count: indices.length / 3,
    },
  };
}
