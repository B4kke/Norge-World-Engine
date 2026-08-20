import { rendererFallbackBuildingHeightMeters } from './buildingSurfaceGeometry.mjs';

const DEFAULT_SURFACE_OFFSET_M = 0.035;
const DEFAULT_WINDOW_WIDTH_M = 1.15;
const DEFAULT_WINDOW_HEIGHT_M = 1.25;
const DEFAULT_WINDOW_SILL_M = 0.90;
const DEFAULT_FLOOR_PITCH_M = 2.9;

function polygonWithoutClosure(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function projectedFootprint(feature, projectPoint) {
  const polygon = polygonWithoutClosure(feature?.polygon);
  if (polygon.length < 3) return [];
  return polygon.map((point) => {
    const local = projectPoint(point);
    if (!Array.isArray(local) || local.length < 3 || local.some((value) => !Number.isFinite(value))) {
      throw new Error('BUILDING_FACADE_PROJECTED_POINT_INVALID');
    }
    return [Number(local[0]), Number(local[1]), Number(local[2])];
  });
}

function signedAreaXZ(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a[0] * b[2] - b[0] * a[2];
  }
  return area * 0.5;
}

function edgeFrame(a, b, orientation, surfaceOffsetMeters) {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dz);
  if (!(length > 1e-5)) return null;
  const tx = dx / length;
  const tz = dz / length;
  // CCW polygons have their interior on the left side of each directed edge.
  // Move facade cues slightly outward to avoid z-fighting with the wall batch.
  const outwardX = orientation >= 0 ? tz : -tz;
  const outwardZ = orientation >= 0 ? -tx : tx;
  return { length, tx, tz, outwardX: outwardX * surfaceOffsetMeters, outwardZ: outwardZ * surfaceOffsetMeters };
}

function pushFacadeQuad(positions, uvs, indices, a, b, frame, bottomY, topY, centerDistance, width) {
  const halfWidth = width * 0.5;
  const leftDistance = centerDistance - halfWidth;
  const rightDistance = centerDistance + halfWidth;
  const leftX = a[0] + frame.tx * leftDistance + frame.outwardX;
  const leftZ = a[2] + frame.tz * leftDistance + frame.outwardZ;
  const rightX = a[0] + frame.tx * rightDistance + frame.outwardX;
  const rightZ = a[2] + frame.tz * rightDistance + frame.outwardZ;
  const base = positions.length / 3;
  positions.push(
    leftX, bottomY, leftZ,
    rightX, bottomY, rightZ,
    rightX, topY, rightZ,
    leftX, topY, leftZ,
  );
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  // Double-sided facade materials make source polygon winding irrelevant.
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildingType(feature) {
  return String(feature?.building ?? 'yes').toLowerCase();
}

function windowEligible(type) {
  return !/carport|shed|garage|barn|warehouse|industrial|farm_auxiliary/.test(type);
}

function largeDoorKind(type) {
  if (/garage|carport/.test(type)) return 'garage';
  if (/barn|farm_auxiliary|warehouse|industrial/.test(type)) return 'service';
  return 'entry';
}

function resolvedHeight(feature, fallbackHeightMeters) {
  const sourceHeight = Number(feature?.height_m);
  if (Number.isFinite(sourceHeight) && sourceHeight > 0) return { height: sourceHeight, sourceBacked: true };
  return { height: rendererFallbackBuildingHeightMeters(feature, fallbackHeightMeters), sourceBacked: false };
}

function typedGeometry(positions, uvs, indices) {
  const vertexCount = positions.length / 3;
  if (uvs.length !== vertexCount * 2) throw new Error('BUILDING_FACADE_UV_ATTRIBUTE_MISMATCH');
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new IndexArray(indices),
    vertexCount,
    triangleCount: indices.length / 3,
  };
}

export function buildBuildingFacadeDetailGeometry(buildingsArtifact, {
  projectPoint,
  fallbackHeightMeters = 5,
  surfaceOffsetMeters = DEFAULT_SURFACE_OFFSET_M,
} = {}) {
  if (typeof projectPoint !== 'function') throw new TypeError('projectPoint is required');
  if (!(Number.isFinite(fallbackHeightMeters) && fallbackHeightMeters > 0)) throw new RangeError('fallbackHeightMeters must be > 0');
  if (!(Number.isFinite(surfaceOffsetMeters) && surfaceOffsetMeters > 0 && surfaceOffsetMeters < 0.25)) throw new RangeError('surfaceOffsetMeters must be within (0, 0.25)');

  const windowPositions = [];
  const windowUvs = [];
  const windowIndices = [];
  const doorPositions = [];
  const doorUvs = [];
  const doorIndices = [];
  let buildingsDecorated = 0;
  let windowCount = 0;
  let entryDoorCount = 0;
  let largeDoorCount = 0;
  let sourceBackedBuildingCount = 0;
  let fallbackBuildingCount = 0;

  for (const feature of buildingsArtifact?.features ?? []) {
    const projected = projectedFootprint(feature, projectPoint);
    if (projected.length < 3) continue;
    const foundationY = Math.min(...projected.map((point) => point[1]));
    const base = projected.map((point) => [point[0], foundationY, point[2]]);
    const orientation = signedAreaXZ(base);
    if (Math.abs(orientation) < 1e-8) continue;
    const { height: buildingHeight, sourceBacked } = resolvedHeight(feature, fallbackHeightMeters);
    if (!(Number.isFinite(buildingHeight) && buildingHeight >= 2.4)) continue;
    if (sourceBacked) sourceBackedBuildingCount += 1; else fallbackBuildingCount += 1;
    const type = buildingType(feature);
    const doorKind = largeDoorKind(type);
    let decorated = false;
    let doorPlaced = false;

    for (let edgeIndex = 0; edgeIndex < base.length; edgeIndex += 1) {
      const a = base[edgeIndex];
      const b = base[(edgeIndex + 1) % base.length];
      const frame = edgeFrame(a, b, orientation, surfaceOffsetMeters);
      if (!frame || frame.length < 2.2) continue;

      let reservedDoor = null;
      if (!doorPlaced && frame.length >= 2.6) {
        const centerDistance = Math.min(frame.length * 0.5, Math.max(1.3, frame.length * 0.28));
        let width = 1.05;
        let height = Math.min(2.15, buildingHeight - 0.2);
        if (doorKind === 'garage') {
          width = Math.min(3.0, frame.length - 0.5);
          height = Math.min(2.45, buildingHeight - 0.15);
          largeDoorCount += 1;
        } else if (doorKind === 'service') {
          width = Math.min(3.4, frame.length - 0.5);
          height = Math.min(3.2, buildingHeight - 0.15);
          largeDoorCount += 1;
        } else {
          entryDoorCount += 1;
        }
        if (width > 0.7 && height > 1.6) {
          pushFacadeQuad(doorPositions, doorUvs, doorIndices, a, b, frame, foundationY + 0.03, foundationY + height, centerDistance, width);
          reservedDoor = { centerDistance, radius: width * 0.5 + 0.45 };
          doorPlaced = true;
          decorated = true;
        }
      }

      if (!windowEligible(type) || frame.length < 4.1) continue;
      const margin = 1.15;
      const usable = frame.length - margin * 2;
      if (!(usable >= DEFAULT_WINDOW_WIDTH_M)) continue;
      const columns = Math.max(1, Math.min(8, Math.floor(usable / 2.6) + 1));
      const spacing = usable / columns;
      const rows = Math.max(1, Math.min(3, Math.floor((buildingHeight - 0.4) / DEFAULT_FLOOR_PITCH_M)));
      for (let row = 0; row < rows; row += 1) {
        const bottom = foundationY + DEFAULT_WINDOW_SILL_M + row * DEFAULT_FLOOR_PITCH_M;
        const top = Math.min(foundationY + buildingHeight - 0.35, bottom + DEFAULT_WINDOW_HEIGHT_M);
        if (top - bottom < 0.65) continue;
        for (let column = 0; column < columns; column += 1) {
          const centerDistance = margin + spacing * (column + 0.5);
          if (reservedDoor && row === 0 && Math.abs(centerDistance - reservedDoor.centerDistance) < reservedDoor.radius) continue;
          const width = Math.min(DEFAULT_WINDOW_WIDTH_M, spacing * 0.62);
          pushFacadeQuad(windowPositions, windowUvs, windowIndices, a, b, frame, bottom, top, centerDistance, width);
          windowCount += 1;
          decorated = true;
        }
      }
    }
    if (decorated) buildingsDecorated += 1;
  }

  const windows = typedGeometry(windowPositions, windowUvs, windowIndices);
  const doors = typedGeometry(doorPositions, doorUvs, doorIndices);
  return Object.freeze({
    windows,
    doors,
    metadata: Object.freeze({
      schema: 'nwe.building-facade-render-geometry/0.1',
      authority: 'renderer-only-procedural-facade-cues',
      source: 'compiled-building-footprints-plus-height-contract',
      geometry_truth_changed: false,
      surface_offset_m: surfaceOffsetMeters,
      buildings_decorated: buildingsDecorated,
      source_backed_building_count: sourceBackedBuildingCount,
      fallback_building_count: fallbackBuildingCount,
      window_count: windowCount,
      entry_door_count: entryDoorCount,
      large_door_count: largeDoorCount,
      window_triangles: windows.triangleCount,
      door_triangles: doors.triangleCount,
      semantics: 'presentation-only; windows-and-doors-are-not-observed-building-features',
    }),
  });
}
