import { loadCompiledJsonArtifact } from '../artifact_consumer.mjs';
import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';
import { verifyRuntimeBundleWeb } from '../../../engine/streaming/runtime_verifier_web.mjs';
import { TerrainMeshWorkerClient } from '../../../engine/streaming/terrain_mesh_worker_client.mjs';
import { createTerrainTileLoadFunction } from '../../../engine/streaming/terrain_tile_loader.mjs';
import { TileStreamingScheduler } from '../../../engine/streaming/tile_scheduler.mjs';
import { resolveGraphicsProfile } from './graphicsProfiles.mjs';
import { createPreview3WebGl2Renderer } from './preview3WebGl2Renderer.mjs';
import { monotonicNow } from './rendererObservability.mjs';

export const DEFAULT_PREVIEW3_MANIFEST = 'https://raw.githubusercontent.com/B4kke/Norge-World-Engine/preview-runtime/nannestad-preview-1/manifest.json';

const EXPECTED_TERRAIN_TILES = 9;
const ACTIVE_RADIUS_M = 1600;
const RETAIN_RADIUS_M = 2300;
const MAX_CONCURRENT_LOADS = 2;
const MAX_RESIDENT_TILES = 9;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

function absoluteUrl(reference: string, base: string) {
  return new URL(reference, base).href;
}

function previewTransportResolver(manifestBase: string) {
  return (reference: string, bundleUrl: string) => {
    if (reference.startsWith('cache://compiled/')) {
      const relative = reference.slice('cache://compiled/'.length);
      return new URL(`./compiled/${relative}`, manifestBase).href;
    }
    return new URL(reference, bundleUrl).href;
  };
}

function assertManifest(value: any) {
  if (!value || value.schema !== 'nwe.world-preview-manifest/0.1' || value.status !== 'REAL_COMPILED') {
    throw new Error(`PREVIEW3_MANIFEST_INVALID: ${value?.schema ?? 'missing'}/${value?.status ?? 'missing'}`);
  }
  if (!value.tile?.id || !Number.isFinite(value.tile?.center_e) || !Number.isFinite(value.tile?.center_n)) {
    throw new Error('PREVIEW3_CENTER_TILE_INVALID');
  }
  if (!Number.isFinite(value.tile?.elevation_min_m)) {
    throw new Error('PREVIEW3_CENTER_ORIGIN_HEIGHT_MISSING');
  }
  if (!Array.isArray(value.terrain_tiles) || value.terrain_tiles.length !== EXPECTED_TERRAIN_TILES) {
    throw new Error(`PREVIEW3_TERRAIN_COUNT: ${value.terrain_tiles?.length ?? 'missing'} != ${EXPECTED_TERRAIN_TILES}`);
  }
  const ids = value.terrain_tiles.map((entry: any) => entry?.tile?.id);
  if (ids.some((id: unknown) => typeof id !== 'string' || !id)) throw new Error('PREVIEW3_TERRAIN_TILE_ID_MISSING');
  if (new Set(ids).size !== EXPECTED_TERRAIN_TILES) throw new Error('PREVIEW3_TERRAIN_TILE_IDS_NOT_UNIQUE');
  if (!ids.includes(value.tile.id)) throw new Error(`PREVIEW3_CENTER_TILE_NOT_IN_GRID: ${value.tile.id}`);
  for (const entry of value.terrain_tiles) {
    if (typeof entry.bundle !== 'string' || !entry.bundle) throw new Error(`PREVIEW3_TERRAIN_BUNDLE_MISSING: ${entry?.tile?.id}`);
    if (!Array.isArray(entry.tile?.bounds) || entry.tile.bounds.length !== 4) throw new Error(`PREVIEW3_TERRAIN_BOUNDS_INVALID: ${entry?.tile?.id}`);
    if (!Number.isFinite(entry.tile?.center_e) || !Number.isFinite(entry.tile?.center_n)) throw new Error(`PREVIEW3_TERRAIN_CENTER_INVALID: ${entry?.tile?.id}`);
  }
  for (const key of ['roads', 'buildings']) {
    if (typeof value[key]?.bundle !== 'string' || !value[key].bundle) throw new Error(`PREVIEW3_LAYER_MISSING: ${key}`);
  }
  return value;
}

async function fetchManifest(manifestUrl: string, fetchImpl: typeof globalThis.fetch) {
  const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`PREVIEW3_MANIFEST_FETCH: ${response.status} ${manifestUrl}`);
  return assertManifest(await response.json());
}

function terrainDescriptors(manifest: any) {
  return manifest.terrain_tiles.map((entry: any) => ({
    id: entry.tile.id,
    centerE: Number(entry.tile.center_e),
    centerN: Number(entry.tile.center_n),
  }));
}

function tileEntryMap(manifest: any) {
  return new Map(manifest.terrain_tiles.map((entry: any) => [entry.tile.id, entry]));
}

function summarizeTile(payload: any) {
  return {
    tile_id: payload.tileId,
    artifact_sha256: payload.artifact.sha256,
    verification_code: payload.verification.code,
    retained_bytes: Number(payload.elevations?.byteLength ?? 0) + Number(payload.mesh?.metadata?.byteSize ?? 0),
    vertices: Number(payload.mesh?.metadata?.vertexCount ?? 0),
    triangles: Number(payload.mesh?.metadata?.triangleCount ?? 0),
    timing_ms: payload.timingMs,
  };
}

export async function runPreview3({
  canvas,
  manifestUrl = DEFAULT_PREVIEW3_MANIFEST,
  fetchImpl = globalThis.fetch,
  graphicsProfile = 'balanced',
  onPhase = () => {},
  onFrame = () => {},
}: {
  canvas: HTMLCanvasElement;
  manifestUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
  graphicsProfile?: string;
  onPhase?: (phase: string) => void;
  onFrame?: (frame: any) => void;
}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const profile = resolveGraphicsProfile(graphicsProfile);
  const startedAt = monotonicNow();
  const manifestBase = new URL(manifestUrl, location.href).href;
  const resolveTransport = previewTransportResolver(manifestBase);

  onPhase('manifest');
  const manifest = await fetchManifest(manifestBase, fetchImpl);
  const entries = tileEntryMap(manifest);
  const descriptors = terrainDescriptors(manifest);
  const center = { e: Number(manifest.tile.center_e), n: Number(manifest.tile.center_n) };
  const renderOrigin = {
    e: center.e,
    n: center.n,
    h: Number(manifest.tile.elevation_min_m),
  };

  let resolverCalls = 0;
  const payloads = new Map<string, any>();
  let renderer: any = null;
  const workerClient = new TerrainMeshWorkerClient();

  const loadTile = createTerrainTileLoadFunction({
    resolveRuntimeInput: async (tile: any, { signal }: any) => {
      const entry: any = entries.get(tile.id);
      if (!entry) throw new Error(`PREVIEW3_TERRAIN_DESCRIPTOR_UNKNOWN: ${tile.id}`);
      resolverCalls += 1;
      onPhase(`terrain-fetch:${tile.id}`);
      return loadTerrainRuntimeInput({
        bundleUrl: absoluteUrl(entry.bundle, manifestBase),
        expectedTileId: tile.id,
        fetchImpl,
        resolveTransport,
        signal,
      });
    },
    verifyBundle: async (bundle: any, bytes: Uint8Array) => {
      onPhase('terrain-verify');
      return verifyRuntimeBundleWeb(bundle, bytes);
    },
    meshWorkerClient: {
      build: async (input: any) => {
        onPhase('terrain-worker');
        return workerClient.build(input);
      },
    },
    meshOptionsForTile: () => ({
      outputSize: profile.terrainOutputSize,
      originE: renderOrigin.e,
      originN: renderOrigin.n,
      originH: renderOrigin.h,
    }),
  });

  const scheduler = new TileStreamingScheduler({
    loadTile,
    activateTile: async (tile: any, payload: any) => {
      payloads.set(tile.id, payload);
      if (renderer) renderer.activateTerrainResource(tile.id, payload);
    },
    deactivateTile: async (tile: any) => {
      if (renderer) renderer.deactivateTerrainResource(tile.id);
    },
    disposeTile: async (tile: any) => {
      payloads.delete(tile.id);
      const state = renderer?.getTerrainResourceLifecycle?.();
      if (state?.tiles?.some((item: any) => item.tile_id === tile.id)) renderer.deactivateTerrainResource(tile.id);
    },
    activeRadiusMeters: ACTIVE_RADIUS_M,
    retainRadiusMeters: RETAIN_RADIUS_M,
    maxConcurrentLoads: MAX_CONCURRENT_LOADS,
    maxResidentTiles: MAX_RESIDENT_TILES,
    maxCacheBytes: MAX_CACHE_BYTES,
  });

  onPhase('terrain-stream');
  await scheduler.update(center, descriptors);
  const schedulerSnapshot = await scheduler.whenIdle();
  const records = schedulerSnapshot.records ?? [];
  const residentIds = records.filter((record: any) => record.state === 'resident').map((record: any) => record.id).sort();
  const expectedIds = descriptors.map((tile: any) => tile.id).sort();
  if (resolverCalls !== EXPECTED_TERRAIN_TILES) throw new Error(`PREVIEW3_RESOLVER_CALLS: ${resolverCalls} != ${EXPECTED_TERRAIN_TILES}`);
  if (payloads.size !== EXPECTED_TERRAIN_TILES) throw new Error(`PREVIEW3_PAYLOAD_COUNT: ${payloads.size} != ${EXPECTED_TERRAIN_TILES}`);
  if (JSON.stringify(residentIds) !== JSON.stringify(expectedIds)) throw new Error(`PREVIEW3_RESIDENT_SET_MISMATCH: ${JSON.stringify(residentIds)}`);
  if (schedulerSnapshot.metrics.loadsCompleted !== EXPECTED_TERRAIN_TILES || schedulerSnapshot.metrics.loadsFailed !== 0) {
    throw new Error(`PREVIEW3_SCHEDULER_REJECTED: ${JSON.stringify(schedulerSnapshot.metrics)}`);
  }
  for (const payload of payloads.values()) {
    if (payload.verification?.code !== 'RUNTIME_VERIFICATION_PASS') throw new Error(`PREVIEW3_TERRAIN_VERIFY_FAIL: ${payload.tileId}`);
  }

  onPhase('compiled-vectors');
  const [roads, buildings] = await Promise.all([
    loadCompiledJsonArtifact({
      bundleUrl: absoluteUrl(manifest.roads.bundle, manifestBase),
      expectedRole: 'road-network',
      fetchImpl,
    }),
    loadCompiledJsonArtifact({
      bundleUrl: absoluteUrl(manifest.buildings.bundle, manifestBase),
      expectedRole: 'building-footprints',
      fetchImpl,
    }),
  ]);
  if (roads.artifact?.tile_id !== manifest.tile.id || buildings.artifact?.tile_id !== manifest.tile.id) {
    throw new Error('PREVIEW3_VECTOR_TILE_ID_MISMATCH');
  }

  const orderedPayloads = manifest.terrain_tiles.map((entry: any) => payloads.get(entry.tile.id));
  onPhase('renderer');
  renderer = createPreview3WebGl2Renderer({
    canvas,
    terrainPayloads: orderedPayloads,
    centerTileId: manifest.tile.id,
    roadsArtifact: roads.artifact,
    buildingsArtifact: buildings.artifact,
    graphicsProfile: profile,
    onFrame,
  });
  const firstFrame = await renderer.firstFrame;
  const lifecycle = renderer.getTerrainResourceLifecycle();
  if (lifecycle.active_tile_count !== EXPECTED_TERRAIN_TILES || lifecycle.current_buffer_count !== EXPECTED_TERRAIN_TILES * 3) {
    throw new Error(`PREVIEW3_RENDERER_RESOURCE_COUNT: ${JSON.stringify(lifecycle)}`);
  }

  const terrainTiles = orderedPayloads.map(summarizeTile);
  const retainedBytes = terrainTiles.reduce((sum: number, tile: any) => sum + tile.retained_bytes, 0);
  const result = {
    schema: 'nwe.world-preview-runtime/0.2',
    status: 'PASS',
    manifest,
    manifestUrl: manifestBase,
    tile_id: manifest.tile.id,
    world_extent: '3x3-km-terrain-center-vectors',
    graphics_profile: profile.id,
    raw_source_runtime_calls: 0,
    render_origin: renderOrigin,
    terrain: {
      tile_count: terrainTiles.length,
      tiles: terrainTiles,
      artifact_sha256: terrainTiles.find((tile: any) => tile.tile_id === manifest.tile.id)?.artifact_sha256 ?? null,
      verification_code: 'RUNTIME_VERIFICATION_PASS',
      resolver_calls: resolverCalls,
      retained_bytes: retainedBytes,
      scheduler: schedulerSnapshot.metrics,
      active_radius_m: ACTIVE_RADIUS_M,
      retain_radius_m: RETAIN_RADIUS_M,
      max_concurrent_loads: MAX_CONCURRENT_LOADS,
      max_resident_tiles: MAX_RESIDENT_TILES,
    },
    roads: {
      artifact_sha256: roads.artifactRef.sha256,
      verification_code: roads.verification.code,
      count: roads.artifact.paths?.length ?? 0,
      scope: 'center-1x1km-only',
    },
    buildings: {
      artifact_sha256: buildings.artifactRef.sha256,
      verification_code: buildings.verification.code,
      count: buildings.artifact.features?.length ?? 0,
      scope: 'center-1x1km-only',
    },
    renderer: {
      ...renderer.stats,
      backend: 'webgl2',
      first_frame: firstFrame,
      resource_lifecycle: lifecycle,
      multi_tile_webgpu_status: 'NOT_TESTED_IN_PREVIEW3',
    },
    timing_ms: {
      total_to_first_frame: monotonicNow() - startedAt,
    },
  };
  return { result, renderer, scheduler };
}
