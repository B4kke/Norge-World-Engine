import { readFileSync } from 'node:fs';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const input = process.argv[2];
if (!input) throw new Error('usage: node inspect_real_road_surface.mjs <compiled-road-artifact.json>');

const artifact = JSON.parse(readFileSync(input, 'utf8'));
if (artifact?.schema !== 'nwe.road-network-artifact/0.1' || !Array.isArray(artifact.paths)) {
  throw new Error('ROAD_SURFACE_INSPECTOR_ARTIFACT_INVALID');
}

function triangleNormalY(positions, ia, ib, ic) {
  const ax = positions[ia * 3]; const az = positions[ia * 3 + 2];
  const bx = positions[ib * 3]; const bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3]; const cz = positions[ic * 3 + 2];
  const abx = bx - ax; const abz = bz - az;
  const acx = cx - ax; const acz = cz - az;
  return abz * acx - abx * acz;
}

function inspect(minimumPointSpacingMeters, { includeAnomalies = false } = {}) {
  const EPSILON = 1e-6;
  const anomalies = [];
  let renderedPaths = 0;
  let triangles = 0;
  let negativeTriangles = 0;
  let degenerateTriangles = 0;
  let mixedSignSegments = 0;
  let fullyInvertedSegments = 0;
  let minimumNormalY = Number.POSITIVE_INFINITY;
  let sourcePoints = 0;
  let sampledPoints = 0;

  for (let pathIndex = 0; pathIndex < artifact.paths.length; pathIndex += 1) {
    const path = artifact.paths[pathIndex];
    const geometry = buildRoadSurfaceGeometry({ paths: [path] }, {
      projectPoint: (point) => [Number(point[0]), Number(point[2]), -Number(point[1])],
      minimumPointSpacingMeters,
    });
    sourcePoints += geometry.metadata.source_point_count;
    sampledPoints += geometry.metadata.sampled_point_count;
    if (geometry.metadata.path_count === 0) continue;
    renderedPaths += 1;

    const segmentIssues = [];
    for (let segment = 0; segment < geometry.metadata.segment_count; segment += 1) {
      const offset = segment * 6;
      const n0 = triangleNormalY(geometry.positions, geometry.indices[offset], geometry.indices[offset + 1], geometry.indices[offset + 2]);
      const n1 = triangleNormalY(geometry.positions, geometry.indices[offset + 3], geometry.indices[offset + 4], geometry.indices[offset + 5]);
      minimumNormalY = Math.min(minimumNormalY, n0, n1);
      triangles += 2;
      const negative0 = n0 < -EPSILON;
      const negative1 = n1 < -EPSILON;
      const degenerate0 = Math.abs(n0) <= EPSILON;
      const degenerate1 = Math.abs(n1) <= EPSILON;
      negativeTriangles += Number(negative0) + Number(negative1);
      degenerateTriangles += Number(degenerate0) + Number(degenerate1);
      if (negative0 !== negative1) mixedSignSegments += 1;
      if (negative0 && negative1) fullyInvertedSegments += 1;
      if (includeAnomalies && (negative0 || negative1 || degenerate0 || degenerate1)) {
        segmentIssues.push({ segment, triangle_normal_y: [n0, n1] });
      }
    }

    if (includeAnomalies && segmentIssues.length > 0) {
      anomalies.push({
        path_index: pathIndex,
        path_id: path?.path_id ?? null,
        road_type: path?.road_type ?? null,
        source_point_count: path?.points?.length ?? 0,
        issues: segmentIssues.slice(0, 12),
        issue_count: segmentIssues.length,
      });
    }
  }

  return {
    minimum_point_spacing_m: minimumPointSpacingMeters,
    status: negativeTriangles === 0 && degenerateTriangles === 0 ? 'PASS' : 'FAIL',
    rendered_paths: renderedPaths,
    source_points: sourcePoints,
    sampled_points: sampledPoints,
    removed_samples: sourcePoints - sampledPoints,
    triangles,
    negative_triangles: negativeTriangles,
    degenerate_triangles: degenerateTriangles,
    mixed_sign_segments: mixedSignSegments,
    fully_inverted_segments: fullyInvertedSegments,
    minimum_normal_y: Number.isFinite(minimumNormalY) ? minimumNormalY : null,
    anomalies,
  };
}

const disabled = inspect(0);
const active = inspect(1.25, { includeAnomalies: true });
const report = {
  schema: 'nwe.real-road-surface-inspection/0.5',
  status: active.status,
  artifact: { tile_id: artifact.tile_id, schema: artifact.schema, path_count: artifact.paths.length },
  regression_reference_without_renderer_sampling: disabled,
  active_geometry: active,
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 2;
