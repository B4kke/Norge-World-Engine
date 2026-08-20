const DEFAULT_VISUAL_WIDTH_M = 3.2;
const DEFAULT_UV_PERIOD_M = 4.0;
const DEFAULT_MINIMUM_POINT_SPACING_M = 0;

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

export function buildRoadSurfaceGeometry(roadsArtifact, {
  projectPoint,
  widthMeters = DEFAULT_VISUAL_WIDTH_M,
  widthForPath = rendererRoadWidthMeters,
  uvPeriodMeters = DEFAULT_UV_PERIOD_M,
  minimumPointSpacingMeters = DEFAULT_MINIMUM_POINT_SPACING_M,
  surfaceHeightAtLocalXZ = null,
  edgeHeightSemantics = surfaceHeightAtLocalXZ ? 'renderer-supplied-drape' : 'projected-centerline',
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (!(Number.isFinite(widthMeters) && widthMeters > 0)) throw new RangeError('widthMeters must be > 0');
  if (typeof widthForPath !== 'function') throw new TypeError('widthForPath must be a function');
  if (!(Number.isFinite(uvPeriodMeters) && uvPeriodMeters > 0)) throw new RangeError('uvPeriodMeters must be > 0');
  if (!(Number.isFinite(minimumPointSpacingMeters) && minimumPointSpacingMeters >= 0)) throw new RangeError('minimumPointSpacingMeters must be >= 0');
  if (surfaceHeightAtLocalXZ !== null && typeof surfaceHeightAtLocalXZ !== 'function') throw new TypeError('surfaceHeightAtLocalXZ must be a function or null');

  const positions = [];
  const uvs = [];
  const indices = [];
  let pathCount = 0;
  let segmentCount = 0;
  let joinTriangleCount = 0;
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
      const normal = leftNormal(direction);
      const ox = normal[0] * halfWidth;
      const oz = normal[1] * halfWidth;
      const nextDistance = distanceAlong + length;
      const v0 = distanceAlong / uvPeriodMeters;
      const v1 = nextDistance / uvPeriodMeters;

      const leftStart = pushVertex(start[0] + ox, start[2] + oz, start[1], [0, v0], { path, segmentIndex, side: 'left-start', center: start });
      const rightStart = pushVertex(start[0] - ox, start[2] - oz, start[1], [1, v0], { path, segmentIndex, side: 'right-start', center: start });
      const leftEnd = pushVertex(end[0] + ox, end[2] + oz, end[1], [0, v1], { path, segmentIndex, side: 'left-end', center: end });
      const rightEnd = pushVertex(end[0] - ox, end[2] - oz, end[1], [1, v1], { path, segmentIndex, side: 'right-end', center: end });

      // Segment-local offset pairs cannot bow-tie, regardless of short source segments.
      indices.push(leftStart, leftEnd, rightStart, rightStart, leftEnd, rightEnd);
      segments.push({ direction, leftStart, rightStart, leftEnd, rightEnd, end, endV: v1, sourceIndex: segmentIndex });
      distanceAlong = nextDistance;
      segmentCount += 1;
    }

    // Fill the outside wedge between consecutive safe rectangles. The inside edges
    // intentionally overlap slightly; this is preferable to a crack and cannot invert
    // an entire road quad. All joins remain renderer-only presentation geometry.
    for (let index = 0; index + 1 < segments.length; index += 1) {
      const incoming = segments[index];
      const outgoing = segments[index + 1];
      const cross = incoming.direction[0] * outgoing.direction[1] - incoming.direction[1] * outgoing.direction[0];
      if (Math.abs(cross) <= 1e-5) continue;
      const outerIncoming = cross > 0 ? incoming.rightEnd : incoming.leftEnd;
      const outerOutgoing = cross > 0 ? outgoing.rightStart : outgoing.leftStart;
      const center = incoming.end;
      const centerVertex = pushVertex(center[0], center[2], center[1], [0.5, incoming.endV], { path, pointIndex: incoming.sourceIndex + 1, side: 'bevel-center', center });
      pushUpwardTriangle(indices, positions, outerIncoming, outerOutgoing, centerVertex);
      joinTriangleCount += 1;
    }

    if (segments.length > 0) {
      pathCount += 1;
      centerlineLengthM += distanceAlong;
    }
  }

  const vertexCount = positions.length / 3;
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new IndexArray(indices),
    metadata: {
      schema: 'nwe.road-surface-render-geometry/0.3',
      source: 'compiled-road-paths',
      width_m: widthMeters,
      width_semantics: 'renderer-only-road-type-fallback',
      width_range_m: pathCount > 0 ? [minimumWidthM, maximumWidthM] : [widthMeters, widthMeters],
      width_class_counts: widthClassCounts,
      join_strategy: 'segment-safe-bevel',
      join_triangle_count: joinTriangleCount,
      uv_period_m: uvPeriodMeters,
      minimum_point_spacing_m: minimumPointSpacingMeters,
      point_spacing_semantics: minimumPointSpacingMeters > 0 ? 'renderer-only-sampling' : 'source-points-after-exact-duplicate-filter',
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
