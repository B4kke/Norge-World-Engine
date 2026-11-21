import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';

const ROAD_CLEARANCE_M = 6;
const BUILDING_CLEARANCE_M = 5;
const SPAWN_CLEARANCE_M = 15;
const MAX_GRADE = 0.75;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polygonPoints(feature) {
  const polygon = Array.isArray(feature?.polygon) ? feature.polygon : [];
  const points = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [finite(point[0]), finite(point[1])])
    .filter(([x, y]) => x !== null && y !== null);
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]; const yi = polygon[i][1];
    const xj = polygon[j][0]; const yj = polygon[j][1];
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(x, y, polygon) {
  if (polygon.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(x, y, polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    best = Math.min(best, pointSegmentDistance(x, y, a[0], a[1], b[0], b[1]));
  }
  return best;
}

function normalizedRoadPaths(roadsArtifact) {
  return (roadsArtifact?.paths ?? [])
    .map((path) => (path?.points ?? path?.coordinates ?? path?.path ?? [])
      .filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point) => [finite(point[0]), finite(point[1])])
      .filter(([x, y]) => x !== null && y !== null))
    .filter((points) => points.length >= 2);
}

function roadDistance(x, y, paths) {
  let best = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    for (let index = 0; index < path.length - 1; index += 1) {
      best = Math.min(best, pointSegmentDistance(x, y, ...path[index], ...path[index + 1]));
      if (best <= ROAD_CLEARANCE_M) return best;
    }
  }
  return best;
}

function terrainSampler(terrainPayload) {
  const header = terrainPayload?.artifact?.header;
  if (!header || !(terrainPayload?.elevations instanceof Float32Array)) throw new TypeError('VEGETATION_TERRAIN_PAYLOAD_REQUIRED');
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

function localGrade(sampleHeight, easting, northing, stepM = 1) {
  const east = sampleHeight(easting + stepM, northing);
  const west = sampleHeight(easting - stepM, northing);
  const north = sampleHeight(easting, northing + stepM);
  const south = sampleHeight(easting, northing - stepM);
  if (![east, west, north, south].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const dzde = (east - west) / (2 * stepM);
  const dzdn = (north - south) / (2 * stepM);
  return Math.hypot(dzde, dzdn);
}

function speciesGroup(treeClass) {
  if (treeClass === 1) return 'spruce';
  if (treeClass === 2) return 'pine';
  if (treeClass === 3) return 'conifer-mixed';
  if (treeClass === 4) return 'mixed';
  return 'deciduous';
}

export function buildForgeVegetationPlacement({
  artifact,
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  origin = null,
  maxInstances = Number.POSITIVE_INFINITY,
} = {}) {
  if (artifact?.schema !== 'nwe.vegetation-representative-artifact/0.1-candidate') throw new TypeError('VEGETATION_ARTIFACT_REQUIRED');
  if (!Array.isArray(artifact.instances) || !Array.isArray(artifact.segments)) throw new TypeError('VEGETATION_ARTIFACT_CONTENT_REQUIRED');
  if (!(Number.isFinite(maxInstances) || maxInstances === Number.POSITIVE_INFINITY) || maxInstances <= 0) throw new RangeError('maxInstances must be positive');

  const sampleHeight = terrainSampler(terrainPayload);
  const renderOrigin = origin ?? {
    e: terrainPayload.mesh.metadata.origin[0],
    n: terrainPayload.mesh.metadata.origin[1],
    h: terrainPayload.mesh.metadata.origin[2],
  };
  const roadPaths = normalizedRoadPaths(roadsArtifact);
  const buildingPolygons = (buildingsArtifact?.features ?? []).map(polygonPoints).filter((polygon) => polygon.length >= 3);
  const headerBounds = terrainPayload.artifact.header.bounds;
  const spawnE = (headerBounds[0] + headerBounds[2]) / 2;
  const spawnN = (headerBounds[1] + headerBounds[3]) / 2;

  const rejectionCounts = {
    outside_tile: 0,
    road_clearance: 0,
    building_clearance: 0,
    spawn_clearance: 0,
    terrain_invalid: 0,
    slope: 0,
    invalid_segment: 0,
  };
  const accepted = [];
  const candidates = artifact.instances.length;

  for (const instance of artifact.instances) {
    if (accepted.length >= maxInstances) break;
    const easting = finite(instance?.easting_m);
    const northing = finite(instance?.northing_m);
    const segment = artifact.segments[Number(instance?.segment_index)];
    if (easting === null || northing === null || !segment) {
      rejectionCounts.invalid_segment += 1;
      continue;
    }
    if (easting < headerBounds[0] || easting > headerBounds[2] || northing < headerBounds[1] || northing > headerBounds[3]) {
      rejectionCounts.outside_tile += 1;
      continue;
    }
    if (Math.hypot(easting - spawnE, northing - spawnN) < SPAWN_CLEARANCE_M) {
      rejectionCounts.spawn_clearance += 1;
      continue;
    }
    if (roadDistance(easting, northing, roadPaths) < ROAD_CLEARANCE_M) {
      rejectionCounts.road_clearance += 1;
      continue;
    }
    let tooCloseToBuilding = false;
    for (const polygon of buildingPolygons) {
      if (distanceToPolygon(easting, northing, polygon) < BUILDING_CLEARANCE_M) {
        tooCloseToBuilding = true;
        break;
      }
    }
    if (tooCloseToBuilding) {
      rejectionCounts.building_clearance += 1;
      continue;
    }
    const elevation = sampleHeight(easting, northing);
    if (!Number.isFinite(elevation)) {
      rejectionCounts.terrain_invalid += 1;
      continue;
    }
    const grade = localGrade(sampleHeight, easting, northing);
    if (!Number.isFinite(grade) || grade > MAX_GRADE) {
      rejectionCounts.slope += 1;
      continue;
    }
    const sourceHeight = finite(segment.mean_height_m);
    const visualHeightM = Math.max(2, Math.min(28, sourceHeight ?? 8));
    const treeClass = Number(segment.tree_class);
    accepted.push(Object.freeze({
      id: String(instance.id ?? `${instance.segment_index}:${accepted.length}`),
      source_segment_index: Number(instance.segment_index),
      tree_class: treeClass,
      tree_class_label: String(segment.tree_class_label ?? 'unknown'),
      species_group: speciesGroup(treeClass),
      mean_height_m: sourceHeight,
      canopy_cover_percent: finite(segment.canopy_cover_percent),
      represented_tree_weight: finite(instance.represented_tree_weight),
      yaw_rad: finite(instance.yaw_rad) ?? 0,
      grade,
      world_easting_m: easting,
      world_northing_m: northing,
      world_elevation_m: elevation,
      local_position: new Float32Array([
        easting - renderOrigin.e,
        elevation - renderOrigin.h,
        renderOrigin.n - northing,
      ]),
      visual_height_m: visualHeightM,
      position_semantics: 'deterministic-procedural-representative-grounded-to-accepted-dtm',
    }));
  }

  const modeledTreeWeight = accepted.reduce((sum, item) => sum + (item.represented_tree_weight ?? 0), 0);
  return Object.freeze({
    schema: 'nwe.web-vegetation-placement/0.1',
    tile_id: artifact.tile_id,
    instances: Object.freeze(accepted),
    stats: Object.freeze({
      source_representative_count: candidates,
      visible_representative_count: accepted.length,
      represented_tree_weight_visible: modeledTreeWeight,
      rejection_counts: Object.freeze({ ...rejectionCounts }),
      road_clearance_m: ROAD_CLEARANCE_M,
      building_clearance_m: BUILDING_CLEARANCE_M,
      spawn_clearance_m: SPAWN_CLEARANCE_M,
      max_grade: MAX_GRADE,
      placement_semantics: 'source-backed forest class/height/density with deterministic representative positions; not observed individual-tree locations',
    }),
  });
}
