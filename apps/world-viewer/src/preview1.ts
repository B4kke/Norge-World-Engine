import { loadCompiledJsonArtifact } from '../artifact_consumer.mjs';
import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';
import { verifyRuntimeBundleWeb } from '../../../engine/streaming/runtime_verifier_web.mjs';
import { TerrainMeshWorkerClient } from '../../../engine/streaming/terrain_mesh_worker_client.mjs';
import { createTerrainTileLoadFunction } from '../../../engine/streaming/terrain_tile_loader.mjs';
import { TileStreamingScheduler } from '../../../engine/streaming/tile_scheduler.mjs';
import { resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { createPreview1Renderer } from './preview1Renderer.mjs';

export const DEFAULT_PREVIEW1_MANIFEST = 'https://raw.githubusercontent.com/B4kke/Norge-World-Engine/preview-runtime/nannestad-preview-1/manifest.json';

function absoluteUrl(reference: string, base: string) {
  return new URL(reference, base).href;
}

function assertManifest(value: any) {
  if (!value || value.schema !== 'nwe.world-preview-manifest/0.1') throw new Error(`PREVIEW_MANIFEST_SCHEMA: ${value?.schema ?? 'missing'}`);
  if (!value.tile?.id || !Array.isArray(value.tile?.bounds) || value.tile.bounds.length !== 4) throw new Error('PREVIEW_MANIFEST_TILE: tile id/bounds missing');
  for (const key of ['terrain', 'roads', 'buildings']) {
    if (typeof value[key]?.bundle !== 'string' || !value[key].bundle) throw new Error(`PREVIEW_MANIFEST_LAYER: ${key}.bundle missing`);
  }
  return value;
}

async function fetchPreviewManifest(manifestUrl: string, fetchImpl: typeof globalThis.fetch) {
  const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`PREVIEW_MANIFEST_FETCH: ${response.status} ${manifestUrl}`);
  return assertManifest(await response.json());
}

function centerFromBounds(bounds: number[]) {
  return { e: (bounds[0] + bounds[2]) / 2, n: (bounds[1] + bounds[3]) / 2 };
}

async function loadTerrain(manifest: any, manifestUrl: string, onPhase: (phase: string) => void, fetchImpl: typeof globalThis.fetch, graphicsProfile: any) {
  const terrainBundleUrl = absoluteUrl(manifest.terrain.bundle, manifestUrl);
  const center = centerFromBounds(manifest.tile.bounds);
  const descriptor = { id: manifest.tile.id, centerE: center.e, centerN: center.n };
  const workerClient = new TerrainMeshWorkerClient();
  let payload: any = null;
  let resolverCalls = 0;

  const loadTile = createTerrainTileLoadFunction({
    resolveRuntimeInput: async (tile: any, { signal }: any) => {
      resolverCalls += 1;
      onPhase('terrain-fetch');
      return loadTerrainRuntimeInput({ bundleUrl: terrainBundleUrl, expectedTileId: tile.id, fetchImpl, signal });
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
    meshOptionsForTile: ({ header }: any) => ({
      outputSize: graphicsProfile.terrainOutputSize,
      originE: (header.bounds[0] + header.bounds[2]) / 2,
      originN: (header.bounds[1] + header.bounds[3]) / 2,
      originH: header.elevation_min_m,
    }),
  });

  const scheduler = new TileStreamingScheduler({
    loadTile,
    activateTile: async (_tile: any, nextPayload: any) => { payload = nextPayload; },
    activeRadiusMeters: 800,
    retainRadiusMeters: 1200,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxCacheBytes: 24 * 1024 * 1024,
  });

  await scheduler.update({ e: center.e, n: center.n }, [descriptor]);
  const snapshot = await scheduler.whenIdle();
  if (!payload || payload.verification?.code !== 'RUNTIME_VERIFICATION_PASS') throw new Error('PREVIEW_TERRAIN_NOT_READY: terrain payload failed runtime verification');
  if (snapshot.metrics.loadsCompleted !== 1 || snapshot.metrics.loadsFailed !== 0) throw new Error(`PREVIEW_TERRAIN_SCHEDULER: ${JSON.stringify(snapshot.metrics)}`);
  return { payload, snapshot, resolverCalls, bundleUrl: terrainBundleUrl };
}

export async function runPreview1({
  canvas,
  manifestUrl = DEFAULT_PREVIEW1_MANIFEST,
  fetchImpl = globalThis.fetch,
  graphicsProfile = 'balanced',
  rendererPreference = 'auto',
  onPhase = () => {},
  onReady = () => {},
  onFrame = () => {},
}: {
  canvas: HTMLCanvasElement;
  manifestUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
  graphicsProfile?: string;
  rendererPreference?: string;
  onPhase?: (phase: string) => void;
  onReady?: (result: any) => void;
  onFrame?: (frame: any) => void;
}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const profile = resolveGraphicsProfile(graphicsProfile);
  const rendererChoice = resolveRendererPreference(rendererPreference);

  onPhase('manifest');
  const manifestBase = new URL(manifestUrl, location.href).href;
  const manifest = await fetchPreviewManifest(manifestBase, fetchImpl);

  onPhase('compiled-vectors');
  const roadsPromise = loadCompiledJsonArtifact({ bundleUrl: absoluteUrl(manifest.roads.bundle, manifestBase), expectedRole: 'road-network', fetchImpl });
  const buildingsPromise = loadCompiledJsonArtifact({ bundleUrl: absoluteUrl(manifest.buildings.bundle, manifestBase), expectedRole: 'building-footprints', fetchImpl });
  const terrainPromise = loadTerrain(manifest, manifestBase, onPhase, fetchImpl, profile);
  const [roads, buildings, terrain] = await Promise.all([roadsPromise, buildingsPromise, terrainPromise]);

  if (roads.artifact?.tile_id !== manifest.tile.id || buildings.artifact?.tile_id !== manifest.tile.id) throw new Error('PREVIEW_TILE_ID_MISMATCH: vector layer tile id differs from manifest');

  let rendererFallback: any = null;
  onPhase('renderer');
  const renderer = await createPreview1Renderer({
    canvas,
    terrainPayload: terrain.payload,
    roadsArtifact: roads.artifact,
    buildingsArtifact: buildings.artifact,
    graphicsProfile: profile,
    backend: rendererChoice,
    onBackendFallback: (fallback: any) => {
      rendererFallback = {
        from: fallback.from,
        to: fallback.to,
        reason: fallback.error instanceof Error ? fallback.error.message : String(fallback.error),
      };
    },
    onFrame,
  });

  onPhase('first-frame');
  const firstFrame = await renderer.firstFrame;

  const result = {
    schema: 'nwe.world-preview-runtime/0.1',
    status: 'PASS',
    manifest,
    manifestUrl: manifestBase,
    tile_id: manifest.tile.id,
    graphics_profile: profile.id,
    renderer_preference: rendererChoice,
    terrain: {
      artifact_sha256: terrain.payload.artifact.sha256,
      verification_code: terrain.payload.verification.code,
      retained_bytes: terrain.snapshot.records.find((record: any) => record.id === manifest.tile.id)?.byteSize ?? null,
      scheduler: terrain.snapshot.metrics,
      resolver_calls: terrain.resolverCalls,
      timing_ms: terrain.payload.timingMs,
    },
    roads: {
      artifact_sha256: roads.artifactRef.sha256,
      verification_code: roads.verification.code,
      count: roads.artifact.paths?.length ?? 0,
    },
    buildings: {
      artifact_sha256: buildings.artifactRef.sha256,
      verification_code: buildings.verification.code,
      count: buildings.artifact.features?.length ?? 0,
    },
    renderer: {
      ...renderer.stats,
      fallback: rendererFallback,
      first_frame: firstFrame,
    },
    attribution: manifest.attribution ?? [],
  };
  onPhase('ready');
  onReady(result);
  return { result, renderer };
}
