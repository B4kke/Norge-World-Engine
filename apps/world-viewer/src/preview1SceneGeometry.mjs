import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { installPreviewCameraControls } from './previewCameraControls.mjs';
import { buildBuildingSurfaceGeometry } from './buildingSurfaceGeometry.mjs';
import { buildRoadSurfaceGeometry } from './roadSurfaceGeometry.mjs';

const ROAD_VISUAL_WIDTH_M = 3.2;
const ROAD_SURFACE_LIFT_M = 0.06;
const ROAD_MINIMUM_POINT_SPACING_M = 0;
const ROAD_VERTICAL_SEMANTICS = 'renderer-only-accepted-dtm-edge-drape';
const BUILDING_FALLBACK_HEIGHT_M = 5;
const BUILDING_GROUND_LIFT_M = 0.08;

function identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize3(subtract(eye, target));
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  const out = identity();
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2];
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return out;
}

function terrainHeightSampler(payload) {
  const header = payload.artifact.header;
  return (easting, northing) => sampleHeightGrid(payload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  });
}

function roadPointToLocal(point, origin, sampleHeight, lift = 0) {
  const easting = Number(point?.[0]);
  const northing = Number(point?.[1]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error('invalid road point');
  const elevation = sampleHeight(easting, northing);
  return [easting - origin.e, elevation - origin.h + lift, origin.n - northing];
}

function roadEdgeHeightAtLocalXZ(localX, localZ, origin, sampleHeight, lift = 0) {
  const easting = origin.e + localX;
  const northing = origin.n - localZ;
  return sampleHeight(easting, northing) - origin.h + lift;
}

function footprintPointToLocal(point, origin, sampleHeight) {
  const easting = Number(point?.[0]);
  const northing = Number(point?.[1]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error('invalid building footprint point');
  return [easting - origin.e, sampleHeight(easting, northing) - origin.h, origin.n - northing];
}

export function createPreviewCamera() {
  return { yaw: -0.78, pitch: 0.62, distance: 1180, target: [0, 7, 0] };
}

function cameraEye(camera) {
  const cp = Math.cos(camera.pitch);
  return [
    camera.target[0] + Math.sin(camera.yaw) * cp * camera.distance,
    camera.target[1] + Math.sin(camera.pitch) * camera.distance,
    camera.target[2] + Math.cos(camera.yaw) * cp * camera.distance,
  ];
}

export function cameraViewProjection(camera, width, height) {
  const projection = perspective(52 * Math.PI / 180, Math.max(0.1, width / height), 1, 5000);
  return multiply(projection, lookAt(cameraEye(camera), camera.target));
}

export function installPreviewSceneControls(canvas, camera, onChange) {
  return installPreviewCameraControls(canvas, camera, onChange, {
    resetCamera: () => {
      const reset = createPreviewCamera();
      Object.assign(camera, { yaw: reset.yaw, pitch: reset.pitch, distance: reset.distance });
      camera.target.splice(0, 3, ...reset.target);
    },
  });
}

export function createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact }) {
  if (!terrainPayload?.mesh?.positions || !terrainPayload?.artifact?.header) throw new TypeError('terrainPayload is required');
  const origin = {
    e: terrainPayload.mesh.metadata.origin[0],
    n: terrainPayload.mesh.metadata.origin[1],
    h: terrainPayload.mesh.metadata.origin[2],
  };
  const sampleHeight = terrainHeightSampler(terrainPayload);
  const roads = buildRoadSurfaceGeometry(roadsArtifact, {
    projectPoint: (point) => roadPointToLocal(point, origin, sampleHeight, ROAD_SURFACE_LIFT_M),
    widthMeters: ROAD_VISUAL_WIDTH_M,
    minimumPointSpacingMeters: ROAD_MINIMUM_POINT_SPACING_M,
    surfaceHeightAtLocalXZ: (x, z) => roadEdgeHeightAtLocalXZ(x, z, origin, sampleHeight, ROAD_SURFACE_LIFT_M),
    edgeHeightSemantics: ROAD_VERTICAL_SEMANTICS,
  });
  const buildingProjectPoint = (point) => footprintPointToLocal(point, origin, sampleHeight);
  const buildingsResolved = buildBuildingSurfaceGeometry(buildingsArtifact, {
    projectPoint: buildingProjectPoint,
    resolved: true,
    groundLiftMeters: BUILDING_GROUND_LIFT_M,
  });
  const buildingsFallback = buildBuildingSurfaceGeometry(buildingsArtifact, {
    projectPoint: buildingProjectPoint,
    resolved: false,
    fallbackHeightMeters: BUILDING_FALLBACK_HEIGHT_M,
    groundLiftMeters: BUILDING_GROUND_LIFT_M,
  });
  return {
    header: terrainPayload.artifact.header,
    origin,
    terrain: terrainPayload.mesh,
    roads,
    buildingsResolved,
    buildingsFallback,
    stats: {
      terrain_vertices: terrainPayload.mesh.metadata.vertexCount,
      terrain_triangles: terrainPayload.mesh.metadata.triangleCount,
      road_paths: roadsArtifact?.paths?.length ?? 0,
      road_surface_paths: roads.metadata.path_count,
      road_surface_segments: roads.metadata.segment_count,
      road_surface_triangles: roads.metadata.triangle_count,
      road_join_strategy: roads.metadata.join_strategy,
      road_join_triangles: roads.metadata.join_triangle_count,
      road_width_semantics: roads.metadata.width_semantics,
      road_width_range_m: roads.metadata.width_range_m,
      road_width_class_counts: roads.metadata.width_class_counts,
      road_vertical_semantics: roads.metadata.edge_height_semantics,
      road_renderer_sampling_semantics: roads.metadata.point_spacing_semantics,
      road_renderer_minimum_point_spacing_m: roads.metadata.minimum_point_spacing_m,
      road_source_point_count: roads.metadata.source_point_count,
      road_sampled_point_count: roads.metadata.sampled_point_count,
      road_removed_sample_count: roads.metadata.removed_sample_count,
      road_surface_lift_m: ROAD_SURFACE_LIFT_M,
      building_footprints: buildingsArtifact?.features?.length ?? 0,
      source_backed_building_heights: buildingsResolved.count,
      unresolved_building_heights: buildingsFallback.count,
      building_resolved_height_semantics: buildingsResolved.metadata.height_semantics,
      building_fallback_height_semantics: buildingsFallback.metadata.height_semantics,
      building_foundation_semantics: buildingsFallback.metadata.foundation_semantics,
      building_roof_morphology_semantics: buildingsFallback.metadata.roof_morphology_semantics,
      building_gable_roofs: buildingsResolved.metadata.gable_roof_count + buildingsFallback.metadata.gable_roof_count,
      building_flat_roofs: buildingsResolved.metadata.flat_roof_count + buildingsFallback.metadata.flat_roof_count,
      building_fallback_height_range_m: buildingsFallback.metadata.fallback_height_range_m,
      building_wall_triangles: buildingsResolved.metadata.wall_triangles + buildingsFallback.metadata.wall_triangles,
      building_roof_triangles: buildingsResolved.metadata.roof_triangles + buildingsFallback.metadata.roof_triangles,
      building_roof_triangulation: buildingsResolved.metadata.roof_triangulation,
      debug_road_width_m: ROAD_VISUAL_WIDTH_M,
      debug_unresolved_building_height_m: BUILDING_FALLBACK_HEIGHT_M,
    },
  };
}
