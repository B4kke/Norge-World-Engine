const DEFAULT_VISUAL_WIDTH_M = 3.2;

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

function projectPath(points, projectPoint) {
  const projected = [];
  for (const point of points ?? []) {
    const local = projectPoint(point);
    if (!finitePoint(local)) throw new Error('ROAD_CENTERLINE_PROJECTED_POINT_INVALID');
    if (projected.length && planarDistance(projected.at(-1), local) <= 1e-4) continue;
    projected.push([Number(local[0]), Number(local[1]), Number(local[2])]);
  }
  return projected;
}

function explicitWidth(path) {
  const value = Number(path?.width_m ?? path?.physical_width_m ?? path?.surface_width_m);
  return Number.isFinite(value) && value >= 0.8 && value <= 30 ? value : null;
}

export function buildRoadCenterlineSegments(roadsArtifact, {
  projectPoint,
  fallbackWidthMeters = DEFAULT_VISUAL_WIDTH_M,
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (!(Number.isFinite(fallbackWidthMeters) && fallbackWidthMeters > 0)) throw new RangeError('fallbackWidthMeters must be > 0');

  const positions = [];
  let pathCount = 0;
  let segmentCount = 0;
  let centerlineLengthM = 0;
  let sourceWidthPathCount = 0;
  let fallbackWidthPathCount = 0;
  const sourceWidths = new Set();

  for (const path of roadsArtifact?.paths ?? []) {
    const points = projectPath(path?.points, projectPoint);
    if (points.length < 2) continue;
    const width = explicitWidth(path);
    if (width === null) fallbackWidthPathCount += 1;
    else {
      sourceWidthPathCount += 1;
      sourceWidths.add(width);
    }

    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      segmentCount += 1;
      centerlineLengthM += planarDistance(a, b);
    }
    pathCount += 1;
  }

  // The current accepted road-network/0.1 artifact contains no physical width.
  // Keep one truthful fallback width for the GPU line batch. When source width is
  // compiled, renderer batches must be split/grouped by source width rather than
  // silently flattening different physical widths into one material.
  const heterogeneousSourceWidths = sourceWidths.size > 1;
  if (heterogeneousSourceWidths) throw new Error('ROAD_CENTERLINE_HETEROGENEOUS_SOURCE_WIDTH_REQUIRES_GROUPED_BATCHES');
  const singleSourceWidth = sourceWidths.size === 1 ? [...sourceWidths][0] : null;
  if (singleSourceWidth !== null && fallbackWidthPathCount > 0) {
    throw new Error('ROAD_CENTERLINE_MIXED_SOURCE_AND_FALLBACK_WIDTH_REQUIRES_GROUPED_BATCHES');
  }

  const activeWidthM = singleSourceWidth ?? fallbackWidthMeters;
  return Object.freeze({
    schema: 'nwe.road-centerline-render-segments/0.1',
    positions: new Float32Array(positions),
    metadata: Object.freeze({
      source: 'compiled-road-paths',
      renderer_primitive: 'three-linesegments2-world-units',
      path_count: pathCount,
      segment_count: segmentCount,
      centerline_length_m: centerlineLengthM,
      width_m: activeWidthM,
      width_semantics: singleSourceWidth === null ? 'renderer-only-fallback' : 'explicit-compiled-source-width',
      source_width_path_count: sourceWidthPathCount,
      fallback_width_path_count: fallbackWidthPathCount,
      join_semantics: 'gpu-fat-line-segment-caps-no-custom-road-strip-miter',
      lighting_semantics: 'unlit-line2-node-material',
      position_count: positions.length / 3,
    }),
  });
}
