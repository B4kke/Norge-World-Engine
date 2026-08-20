import { readFileSync } from 'node:fs';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const input = process.argv[2];
if (!input) throw new Error('usage: node inspect_real_road_surface.mjs <compiled-road-artifact.json>');

const artifact = JSON.parse(readFileSync(input, 'utf8'));
if (artifact?.schema !== 'nwe.road-network-artifact/0.1' || !Array.isArray(artifact.paths)) {
  throw new Error('ROAD_SURFACE_INSPECTOR_ARTIFACT_INVALID');
}

const allPoints = artifact.paths.flatMap((path) => path?.points ?? []);
if (allPoints.length === 0) throw new Error('ROAD_SURFACE_INSPECTOR_EMPTY');
const minE = Math.min(...allPoints.map((point) => Number(point[0])));
const maxE = Math.max(...allPoints.map((point) => Number(point[0])));
const minN = Math.min(...allPoints.map((point) => Number(point[1])));
const maxN = Math.max(...allPoints.map((point) => Number(point[1])));
const renderOrigin = Object.freeze({ e: (minE + maxE) / 2, n: (minN + maxN) / 2 });

function triangleNormalY(positions, ia, ib, ic) {
  const ax = positions[ia * 3]; const az = positions[ia * 3 + 2];
  const bx = positions[ib * 3]; const bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3]; const cz = positions[ic * 3 + 2];
  const abx = bx - ax; const abz = bz - az;
  const acx = cx - ax; const acz = cx * 0 + (positions[ic * 3 + 2] - az);
  return abz * acx - abx * acz;
}

function inspect(minimumPointSpacingMeters, { includeAnomalies = false } = {}) {
  const EPSILON = 1e-6;
  const anomalies = [];
  let renderedPaths = 0;
  let triangles = 0;
  let negativeTriangles = 0;
  let degenerateTriangles = 0;
  let segmentTriangles = 0;
  let joinTriangles = 0;
  let minimumNormalY = Number.POSITIVE_INFINITY;
  let sourcePoints = 0;
  let sampledPoints = 0;

  for (let pathIndex = 0; pathIndex < artifact.paths.length; pathIndex += 1) {
    const path = artifact.paths[pathIndex];
    const geometry = buildRoadSurfaceGeometry({ paths: [path] }, {
      projectPoint: (point) => [
        Number(point[0]) - renderOrigin.e,
        Number(point[2]),
        renderOrigin.n - Number(point[1]),
      ],
      minimumPointSpacingMeters,
    });
    sourcePoints += geometry.metadata.source_point_count;
    sampledPoints += geometry.metadata.sampled_point_count;
    if (geometry.metadata.path_count === 0) continue;
    renderedPaths += 1;

    const issues = [];
    const segmentIndexCount = geometry.metadata.segment_count * 6;
    for (let offset = 0; offset < geometry.indices.length; offset += 3) {
      const n = triangleNormalY(geometry.positions, geometry.indices[offset], geometry.indices[offset + 1], geometry.indices[offset + 2]);
      minimumNormalY = Math.min(minimumNormalY, n);
      triangles += 1;
      const isSegmentTriangle = offset < segmentIndexCount;
      if (isSegmentTriangle) segmentTriangles += 1;
      else joinTriangles += 1;
      const negative = n < -EPSILON;
      const degenerate = Math.abs(n) <= EPSILON;
      negativeTriangles += Number(negative);
      degenerateTriangles += Number(degenerate);
      if (includeAnomalies && (negative || degenerate)) {
        issues.push({ triangle: offset / 3, role: isSegmentTriangle ? 'segment' : 'bevel-join', triangle_normal_y: n });
      }
    }

    if (includeAnomalies && issues.length > 0) {
      anomalies.push({
        path_index: pathIndex,
        path_id: path?.path_id ?? null,
        road_type: path?.road_type ?? null,
        source_point_count: path?.points?.length ?? 0,
        join_strategy: geometry.metadata.join_strategy,
        issues: issues.slice(0, 12),
        issue_count: issues.length,
      });
    }
  }

  return {
    minimum_point_spacing_m: minimumPointSpacingMeters,
    status: negativeTriangles === 0 && degenerateTriangles === 0 ? 'PASS' : 'FAIL',
    join_strategy: 'segment-safe-bevel',
    rendered_paths: renderedPaths,
    source_points: sourcePoints,
    sampled_points: sampledPoints,
    removed_samples: sourcePoints - sampledPoints,
    triangles,
    segment_triangles: segmentTriangles,
    join_triangles: joinTriangles,
    negative_triangles: negativeTriangles,
    degenerate_triangles: degenerateTriangles,
    minimum_normal_y: Number.isFinite(minimumNormalY) ? minimumNormalY : null,
    anomalies,
  };
}

const active = inspect(0, { includeAnomalies: true });
const report = {
  schema: 'nwe.real-road-surface-inspection/0.7',
  status: active.status,
  coordinate_semantics: 'render-local-float32-matching-preview-planar-origin',
  render_origin: renderOrigin,
  artifact: { tile_id: artifact.tile_id, schema: artifact.schema, path_count: artifact.paths.length },
  active_source_point_geometry: active,
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 2;
