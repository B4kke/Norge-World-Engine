import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { decodeForgeVegetationSnapshot, FORGE_VEGETATION_SNAPSHOT } from './forgeVegetationSnapshot.mjs';
import { rendererRoadWidthMeters } from './roadSurfaceGeometry.mjs';

const BUILDING_CLEARANCE_M = 2.5;
const ROAD_CLEARANCE_M = 1.75;
const SPAWN_CLEARANCE_M = 12;
const VEGETATION_GROUND_LIFT_M = 0.03;

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (!(lengthSquared > 1e-12)) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function polygonWithoutClosure(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
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
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointNearPolygon(x, y, polygon, clearanceMeters) {
  if (polygon.length < 3) return false;
  if (pointInPolygon(x, y, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (distancePointToSegment(x, y, a[0], a[1], b[0], b[1]) <= clearanceMeters) return true;
  }
  return false;
}

function compileRoadCorridors(roadsArtifact) {
  const segments = [];
  for (const path of roadsArtifact?.paths ?? []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    const halfWidth = rendererRoadWidthMeters(path) * 0.5 + ROAD_CLEARANCE_M;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const ax = Number(a?.[0]); const ay = Number(a?.[1]);
      const bx = Number(b?.[0]); const by = Number(b?.[1]);
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const minX = Math.min(ax, bx) - halfWidth;
      const maxX = Math.max(ax, bx) + halfWidth;
      const minY = Math.min(ay, by) - halfWidth;
      const maxY = Math.max(ay, by) + halfWidth;
      segments.push({ ax, ay, bx, by, radius: halfWidth, minX, maxX, minY, maxY });
    }
  }
  return segments;
}

function nearRoad(x, y, segments) {
  for (const segment of segments) {
    if (x < segment.minX || x > segment.maxX || y < segment.minY || y > segment.maxY) continue;
    if (distancePointToSegment(x, y, segment.ax, segment.ay, segment.bx, segment.by) <= segment.radius) return true;
  }
  return false;
}

function classToSpecies(classId) {
  // FORGE classes are vegetation-composition classes, not exact tree species.
  // Renderer class 0 = conifer silhouette, 1 = broadleaf/mixed silhouette.
  return classId <= 2 ? 0 : 1;
}

function heightSampler(terrainPayload) {
  const header = terrainPayload?.artifact?.header;
  if (!header) throw new TypeError('VEGETATION_TERRAIN_HEADER_REQUIRED');
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

export function buildForgeVegetationPlacement({
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  origin,
  snapshot = FORGE_VEGETATION_SNAPSHOT,
} = {}) {
  if (!origin || !Number.isFinite(Number(origin.e)) || !Number.isFinite(Number(origin.n)) || !Number.isFinite(Number(origin.h))) {
    throw new TypeError('VEGETATION_RENDER_ORIGIN_REQUIRED');
  }
  const decoded = decodeForgeVegetationSnapshot(snapshot);
  const tileId = terrainPayload?.artifact?.header?.tile_id;
  if (tileId !== snapshot.tile_id) throw new Error(`VEGETATION_TILE_MISMATCH: ${snapshot.tile_id} != ${tileId ?? 'missing'}`);
  const sampleHeight = heightSampler(terrainPayload);
  const roadSegments = compileRoadCorridors(roadsArtifact);
  const buildingPolygons = (buildingsArtifact?.features ?? []).map((feature) => polygonWithoutClosure(feature?.polygon)).filter((polygon) => polygon.length >= 3);

  const positions = [];
  const heights = [];
  const yaws = [];
  const species = [];
  const sourceClasses = [];
  const rejected = { road: 0, building: 0, spawn: 0, invalid_height: 0 };
  let coniferCount = 0;
  let broadleafCount = 0;

  for (let index = 0; index < decoded.count; index += 1) {
    const easting = decoded.eastings[index];
    const northing = decoded.northings[index];
    if (Math.hypot(easting - Number(origin.e), northing - Number(origin.n)) < SPAWN_CLEARANCE_M) {
      rejected.spawn += 1;
      continue;
    }
    if (nearRoad(easting, northing, roadSegments)) {
      rejected.road += 1;
      continue;
    }
    if (buildingPolygons.some((polygon) => pointNearPolygon(easting, northing, polygon, BUILDING_CLEARANCE_M))) {
      rejected.building += 1;
      continue;
    }
    const ground = Number(sampleHeight(easting, northing));
    if (!Number.isFinite(ground)) {
      rejected.invalid_height += 1;
      continue;
    }
    const classId = decoded.classes[index];
    const renderSpecies = classToSpecies(classId);
    positions.push(easting - Number(origin.e), ground - Number(origin.h) + VEGETATION_GROUND_LIFT_M, Number(origin.n) - northing);
    heights.push(Math.max(0.8, Math.min(24, decoded.heights[index])));
    yaws.push(decoded.yaws[index]);
    species.push(renderSpecies);
    sourceClasses.push(classId);
    if (renderSpecies === 0) coniferCount += 1;
    else broadleafCount += 1;
  }

  const count = species.length;
  return Object.freeze({
    schema: 'nwe.forge-vegetation-render-placement/0.1',
    positions: new Float32Array(positions),
    heights: new Float32Array(heights),
    yaws: new Float32Array(yaws),
    species: new Uint8Array(species),
    source_classes: new Uint8Array(sourceClasses),
    count,
    metadata: Object.freeze({
      authority: 'forge-derived-representative-distribution',
      individual_tree_truth: false,
      source_artifact_schema: snapshot.source_artifact_schema,
      source_artifact_sha256: snapshot.source_artifact_sha256,
      source_semantic_sha256: snapshot.source_semantic_sha256,
      source_compiler_config_id: snapshot.source_compiler_config_id,
      source_evidence_run_id: snapshot.source_evidence_run_id,
      source_instance_count: decoded.count,
      accepted_instance_count: count,
      rejected_instance_count: decoded.count - count,
      rejected,
      conifer_count: coniferCount,
      broadleaf_count: broadleafCount,
      source_class_labels: [...decoded.class_labels],
      placement_xy_semantics: 'forge-deterministic-representatives-not-observed-individual-trees',
      height_semantics: 'forge-segment-mean-height-clamped-for-presentation',
      grounding_semantics: 'accepted-dtm-grid-nn2000',
      exclusion_semantics: 'renderer-only-road-building-spawn-clearance',
      road_clearance_extra_m: ROAD_CLEARANCE_M,
      building_clearance_m: BUILDING_CLEARANCE_M,
      spawn_clearance_m: SPAWN_CLEARANCE_M,
      ground_lift_m: VEGETATION_GROUND_LIFT_M,
    }),
  });
}
