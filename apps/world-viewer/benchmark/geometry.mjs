export const TILE_BOUNDS = Object.freeze([611000, 6677000, 612000, 6678000]);
export const LOCAL_ORIGIN = Object.freeze([TILE_BOUNDS[0], TILE_BOUNDS[1]]);
export const TILE_LOCAL_BOUNDS = Object.freeze([0, 0, TILE_BOUNDS[2] - TILE_BOUNDS[0], TILE_BOUNDS[3] - TILE_BOUNDS[1]]);

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function pushVertex(targetPositions, targetColors, point, color) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);
  const z = point?.length > 2 && finiteNumber(point[2]) ? Number(point[2]) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`invalid vertex ${JSON.stringify(point)}`);
  }
  targetPositions.push(x - LOCAL_ORIGIN[0], y - LOCAL_ORIGIN[1], z);
  targetColors.push(color[0], color[1], color[2]);
}

function sameXY(a, b) {
  return Number(a?.[0]) === Number(b?.[0]) && Number(a?.[1]) === Number(b?.[1]);
}

function polygonEdges(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const edges = [];
  const closed = sameXY(points[0], points.at(-1));
  const limit = closed ? points.length - 1 : points.length;
  for (let index = 0; index < limit; index += 1) {
    const next = (index + 1) % limit;
    if (!sameXY(points[index], points[next])) edges.push([points[index], points[next]]);
  }
  return edges;
}

export function buildVectorBenchmarkGeometry(roadsArtifact, buildingsArtifact) {
  if (roadsArtifact?.schema !== 'nwe.road-network-artifact/0.1') {
    throw new Error(`unexpected roads schema: ${roadsArtifact?.schema}`);
  }
  if (buildingsArtifact?.schema !== 'nwe.building-footprint-artifact/0.1') {
    throw new Error(`unexpected buildings schema: ${buildingsArtifact?.schema}`);
  }
  if (roadsArtifact.tile_id !== buildingsArtifact.tile_id) {
    throw new Error(`tile mismatch: ${roadsArtifact.tile_id} != ${buildingsArtifact.tile_id}`);
  }

  const roadPositions = [];
  const roadColors = [];
  const roadRanges = [];
  const roadDebug = [];
  const roadColor = [0.25, 0.78, 1.0];

  for (const path of roadsArtifact.paths ?? []) {
    const first = roadPositions.length / 3;
    const points = Array.isArray(path.points) ? path.points : [];
    for (let index = 0; index + 1 < points.length; index += 1) {
      pushVertex(roadPositions, roadColors, points[index], roadColor);
      pushVertex(roadPositions, roadColors, points[index + 1], roadColor);
    }
    const count = roadPositions.length / 3 - first;
    if (count === 0) continue;
    const debugIndex = roadDebug.length;
    roadRanges.push({ first, count, debugIndex });
    roadDebug.push({
      kind: 'road',
      path_id: path.path_id,
      road_type: path.road_type,
      source_segment_ids: [...(path.source_segment_ids ?? [])],
      source_sequence_ids: [...(path.source_sequence_ids ?? [])],
      length_m: path.length_m,
      points,
    });
  }

  const buildingPositions = [];
  const buildingColors = [];
  const buildingRanges = [];
  const buildingDebug = [];
  const resolvedColor = [0.34, 0.94, 0.55];
  const unresolvedColor = [1.0, 0.68, 0.22];

  for (const feature of buildingsArtifact.features ?? []) {
    const first = buildingPositions.length / 3;
    const polygon = Array.isArray(feature.polygon) ? feature.polygon : [];
    const authoritativeHeight = finiteNumber(feature.height_m);
    const color = authoritativeHeight ? resolvedColor : unresolvedColor;
    for (const [a, b] of polygonEdges(polygon)) {
      pushVertex(buildingPositions, buildingColors, a, color);
      pushVertex(buildingPositions, buildingColors, b, color);
    }
    const count = buildingPositions.length / 3 - first;
    if (count === 0) continue;
    const debugIndex = buildingDebug.length;
    buildingRanges.push({ first, count, debugIndex });
    buildingDebug.push({
      kind: 'building',
      source_id: feature.source_id,
      area_m2: feature.area_m2,
      height_m: authoritativeHeight ? feature.height_m : null,
      height_source: feature.height_source ?? null,
      height_render_semantics: authoritativeHeight ? 'SOURCE_BACKED_METADATA' : 'UNRESOLVED_NO_DEBUG_EXTRUSION',
      clipped: Boolean(feature.clipped),
      building: feature.building ?? 'yes',
      polygon,
    });
  }

  return {
    tileId: roadsArtifact.tile_id,
    roadPositions: new Float32Array(roadPositions),
    roadColors: new Float32Array(roadColors),
    roadRanges,
    roadDebug,
    buildingPositions: new Float32Array(buildingPositions),
    buildingColors: new Float32Array(buildingColors),
    buildingRanges,
    buildingDebug,
    objectCounts: {
      road_paths: roadRanges.length,
      building_footprints: buildingRanges.length,
      total_objects: roadRanges.length + buildingRanges.length,
      source_backed_building_heights: buildingDebug.filter((item) => item.height_m !== null).length,
      unresolved_building_heights: buildingDebug.filter((item) => item.height_m === null).length,
    },
    vertexCounts: {
      road_line_vertices: roadPositions.length / 3,
      building_line_vertices: buildingPositions.length / 3,
    },
  };
}

function pointInPolygon(x, y, points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i][0]);
    const yi = Number(points[i][1]);
    const xj = Number(points[j][0]);
    const yj = Number(points[j][1]);
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentDistanceSquared(px, py, a, b) {
  const ax = Number(a[0]);
  const ay = Number(a[1]);
  const bx = Number(b[0]);
  const by = Number(b[1]);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return (px - qx) ** 2 + (py - qy) ** 2;
}

export function traceVisibleObjectAtWorld(geometry, x, y, roadToleranceM = 6) {
  for (let index = geometry.buildingDebug.length - 1; index >= 0; index -= 1) {
    const building = geometry.buildingDebug[index];
    if (pointInPolygon(x, y, building.polygon)) return building;
  }

  const toleranceSquared = roadToleranceM ** 2;
  let best = null;
  let bestDistance = Infinity;
  for (const road of geometry.roadDebug) {
    const points = road.points ?? [];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const distance = segmentDistanceSquared(x, y, points[index], points[index + 1]);
      if (distance <= toleranceSquared && distance < bestDistance) {
        best = road;
        bestDistance = distance;
      }
    }
  }
  return best;
}

export function worldFromCanvas(clientX, clientY, rect, bounds = TILE_BOUNDS) {
  const [minX, minY, maxX, maxY] = bounds;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  return {
    x: minX + u * (maxX - minX),
    y: maxY - v * (maxY - minY),
  };
}
