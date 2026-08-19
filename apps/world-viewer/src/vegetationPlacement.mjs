import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';

const DEFAULT_GRID_SPACING_M = 18;
const DEFAULT_OCCUPANCY = 0.44;
const DEFAULT_ROAD_CLEARANCE_M = 8;
const DEFAULT_BUILDING_CLEARANCE_M = 6;
const DEFAULT_SPAWN_CLEARANCE_M = 18;
const DEFAULT_MAX_GRADE = 0.75;
const DEFAULT_SEED = 0x4e5745;

function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function hash01(x, y, seed) {
  let value = Math.imul((x | 0) + 1, 374761393) ^ Math.imul((y | 0) + 1, 668265263) ^ Math.imul(seed | 0, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function finiteWorldPoint(point) {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

function distancePointToSegmentSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 1e-12)) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared);
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return (px - qx) ** 2 + (py - qy) ** 2;
}

function roadSegments(roadsArtifact, clearanceMeters) {
  const segments = [];
  for (const path of roadsArtifact?.paths ?? []) {
    const points = (path?.points ?? []).filter(finiteWorldPoint);
    for (let index = 0; index + 1 < points.length; index += 1) {
      const ax = Number(points[index][0]);
      const ay = Number(points[index][1]);
      const bx = Number(points[index + 1][0]);
      const by = Number(points[index + 1][1]);
      if (Math.hypot(bx - ax, by - ay) <= 1e-5) continue;
      segments.push({
        ax, ay, bx, by,
        minE: Math.min(ax, bx) - clearanceMeters,
        maxE: Math.max(ax, bx) + clearanceMeters,
        minN: Math.min(ay, by) - clearanceMeters,
        maxN: Math.max(ay, by) + clearanceMeters,
      });
    }
  }
  return segments;
}

function polygonWithoutDuplicateClosure(polygon) {
  const points = (polygon ?? [])
    .filter(finiteWorldPoint)
    .map((point) => [Number(point[0]), Number(point[1])]);
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function buildingPolygons(buildingsArtifact, clearanceMeters) {
  const polygons = [];
  for (const feature of buildingsArtifact?.features ?? []) {
    const points = polygonWithoutDuplicateClosure(feature?.polygon);
    if (points.length < 3) continue;
    const eastings = points.map((point) => point[0]);
    const northings = points.map((point) => point[1]);
    polygons.push({
      points,
      minE: Math.min(...eastings) - clearanceMeters,
      maxE: Math.max(...eastings) + clearanceMeters,
      minN: Math.min(...northings) - clearanceMeters,
      maxN: Math.max(...northings) + clearanceMeters,
    });
  }
  return polygons;
}

function pointInsidePolygon(easting, northing, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0]; const yi = points[i][1];
    const xj = points[j][0]; const yj = points[j][1];
    const intersects = ((yi > northing) !== (yj > northing))
      && (easting < (xj - xi) * (northing - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function nearRoad(easting, northing, segments, clearanceMeters) {
  const limitSquared = clearanceMeters * clearanceMeters;
  for (const segment of segments) {
    if (easting < segment.minE || easting > segment.maxE || northing < segment.minN || northing > segment.maxN) continue;
    if (distancePointToSegmentSquared(easting, northing, segment.ax, segment.ay, segment.bx, segment.by) <= limitSquared) return true;
  }
  return false;
}

function nearBuilding(easting, northing, polygons, clearanceMeters) {
  const limitSquared = clearanceMeters * clearanceMeters;
  for (const polygon of polygons) {
    if (easting < polygon.minE || easting > polygon.maxE || northing < polygon.minN || northing > polygon.maxN) continue;
    if (pointInsidePolygon(easting, northing, polygon.points)) return true;
    for (let index = 0; index < polygon.points.length; index += 1) {
      const next = (index + 1) % polygon.points.length;
      const a = polygon.points[index];
      const b = polygon.points[next];
      if (distancePointToSegmentSquared(easting, northing, a[0], a[1], b[0], b[1]) <= limitSquared) return true;
    }
  }
  return false;
}

function createHeightSampler(terrainPayload) {
  const header = terrainPayload?.artifact?.header;
  if (!header || !terrainPayload?.elevations) throw new TypeError('terrainPayload with decoded elevations is required');
  return (easting, northing) => sampleHeightGrid(terrainPayload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  });
}

function localPosition(easting, northing, elevation, origin) {
  return [easting - origin.e, elevation - origin.h, origin.n - northing];
}

export function buildSyntheticVegetationPlacement({
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  origin,
  gridSpacingMeters = DEFAULT_GRID_SPACING_M,
  occupancy = DEFAULT_OCCUPANCY,
  roadClearanceMeters = DEFAULT_ROAD_CLEARANCE_M,
  buildingClearanceMeters = DEFAULT_BUILDING_CLEARANCE_M,
  spawnClearanceMeters = DEFAULT_SPAWN_CLEARANCE_M,
  maxGrade = DEFAULT_MAX_GRADE,
  seed = DEFAULT_SEED,
} = {}) {
  const bounds = terrainPayload?.artifact?.header?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4) throw new TypeError('terrain bounds are required');
  if (!origin || ![origin.e, origin.n, origin.h].every(Number.isFinite)) throw new TypeError('finite render origin is required');
  if (!(Number.isFinite(gridSpacingMeters) && gridSpacingMeters >= 8)) throw new RangeError('gridSpacingMeters must be >= 8');
  if (!(Number.isFinite(occupancy) && occupancy > 0 && occupancy <= 1)) throw new RangeError('occupancy must be in (0, 1]');
  if (![roadClearanceMeters, buildingClearanceMeters, spawnClearanceMeters].every((value) => Number.isFinite(value) && value >= 0)) throw new RangeError('clearance values must be >= 0');
  if (!(Number.isFinite(maxGrade) && maxGrade > 0)) throw new RangeError('maxGrade must be > 0');

  const sampleHeight = createHeightSampler(terrainPayload);
  const roads = roadSegments(roadsArtifact, roadClearanceMeters);
  const buildings = buildingPolygons(buildingsArtifact, buildingClearanceMeters);
  const [minE, minN, maxE, maxN] = bounds.map(Number);
  const centerE = (minE + maxE) / 2;
  const centerN = (minN + maxN) / 2;
  const sampleOffset = Math.min(2, gridSpacingMeters * 0.2);
  const margin = Math.max(3, sampleOffset + 1);
  const columns = Math.max(1, Math.floor((maxE - minE - margin * 2) / gridSpacingMeters));
  const rows = Math.max(1, Math.floor((maxN - minN - margin * 2) / gridSpacingMeters));

  const positions = [];
  const heights = [];
  const yaws = [];
  const species = [];
  let roadRejected = 0;
  let buildingRejected = 0;
  let slopeRejected = 0;
  let spawnRejected = 0;
  let densityRejected = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cluster = 0.55 + 0.9 * hash01(Math.floor(column / 4), Math.floor(row / 4), seed + 31);
      const threshold = clamp01(occupancy * cluster);
      if (hash01(column, row, seed + 7) > threshold) { densityRejected += 1; continue; }

      const jitterE = (hash01(column, row, seed + 11) - 0.5) * gridSpacingMeters * 0.72;
      const jitterN = (hash01(column, row, seed + 13) - 0.5) * gridSpacingMeters * 0.72;
      const easting = minE + margin + (column + 0.5) * gridSpacingMeters + jitterE;
      const northing = minN + margin + (row + 0.5) * gridSpacingMeters + jitterN;
      if (easting <= minE + margin || easting >= maxE - margin || northing <= minN + margin || northing >= maxN - margin) continue;

      if (Math.hypot(easting - centerE, northing - centerN) < spawnClearanceMeters) { spawnRejected += 1; continue; }
      if (nearRoad(easting, northing, roads, roadClearanceMeters)) { roadRejected += 1; continue; }
      if (nearBuilding(easting, northing, buildings, buildingClearanceMeters)) { buildingRejected += 1; continue; }

      const elevation = sampleHeight(easting, northing);
      const eastHeight = sampleHeight(Math.min(maxE - margin, easting + sampleOffset), northing);
      const northHeight = sampleHeight(easting, Math.min(maxN - margin, northing + sampleOffset));
      const grade = Math.hypot(eastHeight - elevation, northHeight - elevation) / sampleOffset;
      if (!Number.isFinite(elevation) || !Number.isFinite(grade) || grade > maxGrade) { slopeRejected += 1; continue; }

      const speciesRoll = hash01(column, row, seed + 17);
      const kind = speciesRoll < 0.62 ? 0 : 1;
      const heightRoll = hash01(column, row, seed + 19);
      const heightMeters = kind === 0 ? 8 + heightRoll * 10 : 7 + heightRoll * 8;
      const yaw = hash01(column, row, seed + 23) * Math.PI * 2;
      positions.push(...localPosition(easting, northing, elevation, origin));
      heights.push(heightMeters);
      yaws.push(yaw);
      species.push(kind);
    }
  }

  return {
    schema: 'nwe.synthetic-vegetation-placement/0.1',
    positions: new Float32Array(positions),
    heights: new Float32Array(heights),
    yaws: new Float32Array(yaws),
    species: new Uint8Array(species),
    count: heights.length,
    metadata: {
      authority: 'renderer-only-synthetic',
      placement_source: 'deterministic-terrain-conditioned-preview-placement',
      future_replacement: 'source-backed-vegetation-mask-or-compiled-placement-artifact',
      seed,
      grid_spacing_m: gridSpacingMeters,
      occupancy,
      road_clearance_m: roadClearanceMeters,
      building_clearance_m: buildingClearanceMeters,
      spawn_clearance_m: spawnClearanceMeters,
      max_grade: maxGrade,
      road_segment_count: roads.length,
      building_polygon_count: buildings.length,
      candidate_cells: rows * columns,
      rejected: { density: densityRejected, road: roadRejected, building: buildingRejected, spawn: spawnRejected, slope: slopeRejected },
      conifer_count: species.filter((kind) => kind === 0).length,
      broadleaf_count: species.filter((kind) => kind === 1).length,
      render_origin: [origin.e, origin.n, origin.h],
    },
  };
}
