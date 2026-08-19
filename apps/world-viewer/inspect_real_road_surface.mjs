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

function samePlanarPoint(a, b, epsilon = 1e-4) {
  return Array.isArray(a) && Array.isArray(b)
    && Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1])) <= epsilon;
}

function inspect(miterLimit, { includeAnomalies = false } = {}) {
  const EPSILON = 1e-6;
  const anomalies = [];
  let renderedPaths = 0;
  let triangles = 0;
  let negativeTriangles = 0;
  let degenerateTriangles = 0;
  let mixedSignSegments = 0;
  let fullyInvertedSegments = 0;
  let closedPaths = 0;
  let minimumNormalY = Number.POSITIVE_INFINITY;

  for (let pathIndex = 0; pathIndex < artifact.paths.length; pathIndex += 1) {
    const path = artifact.paths[pathIndex];
    if (samePlanarPoint(path?.points?.[0], path?.points?.at?.(-1))) closedPaths += 1;
    const geometry = buildRoadSurfaceGeometry({ paths: [path] }, {
      projectPoint: (point) => [Number(point[0]), Number(point[2]), -Number(point[1])],
      miterLimit,
    });
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
        const a = segment * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        segmentIssues.push({
          segment,
          triangle_normal_y: [n0, n1],
          alternate_diagonal_normal_y: [
            triangleNormalY(geometry.positions, a, d, b),
            triangleNormalY(geometry.positions, a, c, d),
          ],
          vertices_xz: [a, b, c, d].map((vertex) => [geometry.positions[vertex * 3], geometry.positions[vertex * 3 + 2]]),
        });
      }
    }

    if (includeAnomalies && segmentIssues.length > 0) {
      anomalies.push({
        path_index: pathIndex,
        path_id: path?.path_id ?? null,
        road_type: path?.road_type ?? null,
        point_count: path?.points?.length ?? 0,
        closed: samePlanarPoint(path?.points?.[0], path?.points?.at?.(-1)),
        issues: segmentIssues.slice(0, 12),
        issue_count: segmentIssues.length,
      });
    }
  }

  return {
    miter_limit: miterLimit,
    status: negativeTriangles === 0 && degenerateTriangles === 0 ? 'PASS' : 'FAIL',
    rendered_paths: renderedPaths,
    triangles,
    negative_triangles: negativeTriangles,
    degenerate_triangles: degenerateTriangles,
    mixed_sign_segments: mixedSignSegments,
    fully_inverted_segments: fullyInvertedSegments,
    closed_paths: closedPaths,
    minimum_normal_y: Number.isFinite(minimumNormalY) ? minimumNormalY : null,
    anomalies,
  };
}

const candidates = [1, 1.25, 1.5, 2].map((miterLimit) => inspect(miterLimit));
const active = inspect(2, { includeAnomalies: true });
const report = {
  schema: 'nwe.real-road-surface-inspection/0.3',
  status: active.status,
  artifact: { tile_id: artifact.tile_id, schema: artifact.schema, path_count: artifact.paths.length },
  candidate_join_budgets: candidates,
  active_geometry: active,
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 2;
