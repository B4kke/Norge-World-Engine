import { resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { resolveCanvasSafeRendererPreference } from './rendererBackendPreflight.mjs';
import { createThreeGroundRenderer } from './threeGroundRenderer.mjs';
import { loadNannestadRealismRuntime } from './nannestadRealismRuntime.mjs';
import { enrichBuildingsForWeb } from './buildingRealismEnrichment.mjs';
import { buildForgeVegetationPlacement } from './forgeVegetationPlacement.mjs';

const NANNESTAD_TILE_ID = 'epsg25832_611000_6677000_1000m';
const SOURCE_WIDTH_OVERLAY_LIFT_M = 0.005;

function normalizeRendererInterface(renderer) {
  if (!renderer) return renderer;
  const invalidate = typeof renderer.invalidate === 'function' ? renderer.invalidate.bind(renderer) : null;
  const dispose = typeof renderer.dispose === 'function' ? renderer.dispose.bind(renderer) : null;
  if (!invalidate || !dispose) throw new Error('PREVIEW1_RENDERER_INTERFACE_INVALID');
  return { ...renderer, invalidate, dispose };
}

function realismRequired() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('requireRealism') === '1';
  } catch {
    return false;
  }
}

function realismTransportEnabled(manifestUrl) {
  if (!manifestUrl) return true;
  try {
    return new URL(manifestUrl, globalThis.location?.href ?? 'https://nwe.invalid/').searchParams.get('nweRealism') !== '0';
  } catch {
    return true;
  }
}

export function enrichRoadsForWeb(baseArtifact, roadRealism) {
  if (!Array.isArray(baseArtifact?.paths)) throw new TypeError('NANNESTAD_ROAD_BASE_PATHS_REQUIRED');
  if (!Array.isArray(roadRealism?.width_features) || roadRealism.width_features.length === 0) return baseArtifact;
  const overlays = roadRealism.width_features.map((feature) => ({
    path_id: `nvdb-width:${feature.source_type_id}:${feature.source_object_id}:${feature.part_index}`,
    road_type: 'source-width-overlay',
    source_segment_ids: [],
    source_sequence_ids: [...new Set((feature.locations ?? []).map((location) => location.sequence_id).filter(Number.isInteger))],
    length_m: null,
    points: feature.points,
    width_m: Number(feature.width_m),
    surface_lift_m: SOURCE_WIDTH_OVERLAY_LIFT_M,
    width_source: `NVDB-${feature.source_type_id}`,
    width_source_object_id: feature.source_object_id,
    width_priority: feature.priority,
  }));
  return {
    ...baseArtifact,
    paths: [...baseArtifact.paths, ...overlays],
    web_realism: {
      schema: 'nwe.web-road-realism/0.1',
      base_path_count: baseArtifact.paths.length,
      source_width_overlay_count: overlays.length,
      source_width_range_m: roadRealism.stats?.width_range_m ?? null,
      source_width_semantics: 'NVDB-838-primary-583-nonoverlap-fallback-overlay',
      surface_material_counts: roadRealism.stats?.surface_material_counts ?? {},
      fallback_semantics: 'accepted road network remains 3.2m renderer fallback where no source-width overlay exists',
      overlay_lift_m: SOURCE_WIDTH_OVERLAY_LIFT_M,
      truth_guard: roadRealism.policy?.truth_guard ?? 'no inferred width is source truth',
    },
  };
}

export async function createPreview1Renderer({
  backend = 'auto',
  graphicsProfile = 'balanced',
  onBackendFallback = () => {},
  enableRealism = true,
  realismManifestUrl = null,
  fetchImpl = globalThis.fetch,
  ...options
} = {}) {
  const rendererPreference = resolveRendererPreference(backend);
  const backendPreflight = await resolveCanvasSafeRendererPreference({ requestedBackend: rendererPreference });
  if (backendPreflight.fallback) onBackendFallback(backendPreflight.fallback);

  const profile = typeof graphicsProfile === 'string'
    ? resolveGraphicsProfile(graphicsProfile)
    : graphicsProfile;

  let buildingsArtifact = options.buildingsArtifact;
  let roadsArtifact = options.roadsArtifact;
  let vegetationPlacement = null;
  let roadRealism = null;
  let realismEvidence = Object.freeze({ status: 'NOT_REQUESTED' });
  const targetTile = options.terrainPayload?.artifact?.header?.tile_id;
  const canLoadRealism = enableRealism
    && realismTransportEnabled(realismManifestUrl)
    && targetTile === NANNESTAD_TILE_ID
    && typeof fetchImpl === 'function'
    && Boolean(realismManifestUrl || globalThis.location);

  if (canLoadRealism) {
    try {
      const runtime = await loadNannestadRealismRuntime({ fetchImpl, manifestUrl: realismManifestUrl });
      buildingsArtifact = enrichBuildingsForWeb(
        options.buildingsArtifact,
        runtime.building_surface,
        runtime.roof_orientation,
      );
      vegetationPlacement = buildForgeVegetationPlacement({
        artifact: runtime.vegetation,
        terrainPayload: options.terrainPayload,
        roadsArtifact: options.roadsArtifact,
        buildingsArtifact,
        maxInstances: Number(profile?.vegetationInstanceBudget) || Number.POSITIVE_INFINITY,
      });
      roadRealism = runtime.road_realism;
      roadsArtifact = enrichRoadsForWeb(options.roadsArtifact, roadRealism);
      realismEvidence = Object.freeze({
        status: 'READY',
        schema: runtime.schema,
        transport: runtime.transport,
        buildings: buildingsArtifact.web_realism,
        vegetation: vegetationPlacement.stats,
        roads: roadRealism ? Object.freeze({
          ...roadsArtifact.web_realism,
          width_feature_part_count: roadRealism.stats?.width_feature_part_count ?? 0,
          width_range_m: roadRealism.stats?.width_range_m ?? null,
          surface_material_counts: roadRealism.stats?.surface_material_counts ?? {},
          policy: roadRealism.policy,
        }) : Object.freeze({ status: 'BASE_ROAD_FALLBACK_ONLY' }),
      });
    } catch (error) {
      if (realismRequired()) throw error;
      realismEvidence = Object.freeze({
        status: 'DEGRADED_BASE_WORLD',
        error: error instanceof Error ? error.message : String(error),
        truth_guard: 'base verified terrain/roads/buildings remain usable; failed realism enrichment is never silently treated as authoritative',
      });
      globalThis.console?.warn?.('NWE realism enrichment unavailable; rendering verified base world.', error);
    }
  }

  const renderer = await createThreeGroundRenderer({
    ...options,
    roadsArtifact,
    buildingsArtifact,
    vegetationPlacement,
    realismEvidence,
    graphicsProfile: profile,
    backend: backendPreflight.backend,
    onBackendFallback,
  });
  return normalizeRendererInterface(renderer);
}
