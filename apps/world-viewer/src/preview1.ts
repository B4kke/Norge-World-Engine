import { loadCompiledJsonArtifact } from '../artifact_consumer.mjs';
import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';
import { verifyRuntimeBundleWeb } from '../../../engine/streaming/runtime_verifier_web.mjs';
import { TerrainMeshWorkerClient } from '../../../engine/streaming/terrain_mesh_worker_client.mjs';
import { createTerrainTileLoadFunction } from '../../../engine/streaming/terrain_tile_loader.mjs';
import { createObservedTerrainTileLoadFunction } from '../../../engine/streaming/terrain_load_observer.mjs';
import { observeStreamingLifecycleAdapters } from '../../../engine/streaming/lifecycle_observer.mjs';
import { createStreamingTraceRecorder } from '../../../engine/streaming/streaming_trace_recorder.mjs';
import { TileStreamingScheduler } from '../../../engine/streaming/tile_scheduler.mjs';
import { resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { createPreview1Renderer } from './preview1Renderer.mjs';
import { browserMemorySnapshot, createFrameGapMonitor, monotonicNow, summarizeFrameGaps } from './rendererObservability.mjs';

export const DEFAULT_PREVIEW1_MANIFEST = 'https://raw.githubusercontent.com/B4kke/Norge-World-Engine/preview-runtime/nannestad-preview-1/manifest.json';

const STREAMING_ACTIVE_RADIUS_M = 800;
const STREAMING_RETAIN_RADIUS_M = 1200;
const STREAMING_MOVEMENT_OFFSET_M = 1000;
const STREAMING_TRACE_MAX_ENTRIES = 256;
const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';

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

function animationFrame() {
  return new Promise<number>((resolve) => requestAnimationFrame(resolve));
}

async function runRendererFrameBenchmark(renderer: any, frameEvents: any[], requestedFrames: number) {
  if (!Number.isInteger(requestedFrames) || requestedFrames <= 0) return null;
  const startIndex = frameEvents.length;
  const maxAttempts = requestedFrames + 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    renderer.invalidate();
    await animationFrame();
    const measured = frameEvents.slice(startIndex).filter((frame) => Number.isFinite(frame?.drawGapMs));
    if (measured.length >= requestedFrames) break;
  }
  const measured = frameEvents.slice(startIndex).filter((frame) => Number.isFinite(frame?.drawGapMs)).slice(0, requestedFrames);
  const frameGaps = measured.map((frame) => Number(frame.drawGapMs));
  const drawCpu = measured.map((frame) => Number(frame.drawCpuMs)).filter(Number.isFinite);
  return {
    requested_frames: requestedFrames,
    measured_frames: measured.length,
    frame_gap: summarizeFrameGaps(frameGaps),
    draw_cpu: summarizeFrameGaps(drawCpu),
    draw_calls: measured.length ? Math.max(...measured.map((frame) => Number(frame.drawCalls) || 0)) : null,
    note: 'Repeated identical-scene draws for renderer comparison; not a gameplay camera-path or device acceptance trace.',
  };
}

function lifecycleCheckpoint(label: string, state: any) {
  if (!state || state.schema !== TERRAIN_RESOURCE_SCHEMA) {
    throw new Error(`PREVIEW_TERRAIN_RESOURCE_STATE_INVALID: ${label}`);
  }
  return {
    label,
    backend: state.backend ?? null,
    tile_id: state.tile_id ?? null,
    artifact_sha256: state.artifact_sha256 ?? null,
    active: state.active === true,
    creates: Number(state.creates),
    destroys: Number(state.destroys),
    current_buffer_count: Number(state.current_buffer_count),
    current_payload_bytes: Number(state.current_payload_bytes),
    physical_vram_release_observed: state.physical_vram_release_observed === true,
  };
}

async function loadTerrain(manifest: any, manifestUrl: string, onPhase: (phase: string) => void, fetchImpl: typeof globalThis.fetch, graphicsProfile: any) {
  const terrainBundleUrl = absoluteUrl(manifest.terrain.bundle, manifestUrl);
  const center = centerFromBounds(manifest.tile.bounds);
  const descriptor = { id: manifest.tile.id, centerE: center.e, centerN: center.n };
  const workerClient = new TerrainMeshWorkerClient();
  const traceRecorder = createStreamingTraceRecorder({ maxEntries: STREAMING_TRACE_MAX_ENTRIES });
  let payload: any = null;
  let resolverCalls = 0;
  let latestSnapshot: any = null;
  let rendererLifecycle: any = null;
  let rendererLifecycleObserved = false;
  let lastMovementProbe: any = null;

  const baseLoadTile = createTerrainTileLoadFunction({
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

  const observedLoadTile = createObservedTerrainTileLoadFunction({
    loadTile: baseLoadTile,
    onObservation: traceRecorder.onLoadObservation,
  });

  const lifecycleAdapters = observeStreamingLifecycleAdapters({
    activateTile: async (_tile: any, nextPayload: any) => {
      payload = nextPayload;
      if (rendererLifecycle) rendererLifecycle.activateTerrainResource(nextPayload);
    },
    deactivateTile: async () => {
      if (!rendererLifecycle) throw new Error('PREVIEW_TERRAIN_RESOURCE_DEACTIVATE_BEFORE_BIND');
      rendererLifecycle.deactivateTerrainResource();
    },
    disposeTile: async () => {
      if (!rendererLifecycle) return;
      const state = rendererLifecycle.getTerrainResourceLifecycle();
      if (state?.active) rendererLifecycle.deactivateTerrainResource();
    },
    onObservation: traceRecorder.onLifecycleObservation,
  });

  const scheduler = new TileStreamingScheduler({
    loadTile: observedLoadTile,
    ...lifecycleAdapters,
    activeRadiusMeters: STREAMING_ACTIVE_RADIUS_M,
    retainRadiusMeters: STREAMING_RETAIN_RADIUS_M,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxCacheBytes: 24 * 1024 * 1024,
    onEvent: traceRecorder.onSchedulerEvent,
  });

  await scheduler.update({ e: center.e, n: center.n }, [descriptor]);
  latestSnapshot = await scheduler.whenIdle();
  traceRecorder.captureSnapshot(latestSnapshot, 'initial-resident');
  if (!payload || payload.verification?.code !== 'RUNTIME_VERIFICATION_PASS') throw new Error('PREVIEW_TERRAIN_NOT_READY: terrain payload failed runtime verification');
  if (latestSnapshot.metrics.loadsCompleted !== 1 || latestSnapshot.metrics.loadsFailed !== 0) throw new Error(`PREVIEW_TERRAIN_SCHEDULER: ${JSON.stringify(latestSnapshot.metrics)}`);

  const bindRendererLifecycle = (renderer: any) => {
    if (!renderer
      || typeof renderer.getTerrainResourceLifecycle !== 'function'
      || typeof renderer.activateTerrainResource !== 'function'
      || typeof renderer.deactivateTerrainResource !== 'function') {
      throw new Error('PREVIEW_TERRAIN_RESOURCE_ADAPTER_MISSING');
    }
    rendererLifecycle = renderer;
    const initial = lifecycleCheckpoint('initial-resident', rendererLifecycle.getTerrainResourceLifecycle());
    if (!initial.active || initial.tile_id !== descriptor.id || initial.artifact_sha256 !== payload.artifact.sha256) {
      throw new Error(`PREVIEW_TERRAIN_RESOURCE_INITIAL_STATE: ${JSON.stringify(initial)}`);
    }
    return initial;
  };

  const runMovementProbe = async () => {
    if (!rendererLifecycle) throw new Error('PREVIEW_TERRAIN_RESOURCE_ADAPTER_NOT_BOUND');
    const startedAt = monotonicNow();
    const resolverCallsBefore = resolverCalls;
    const cacheHitsBefore = latestSnapshot.metrics.cacheHits;
    const loadsStartedBefore = latestSnapshot.metrics.loadsStarted;
    const outsideCamera = { e: center.e + STREAMING_MOVEMENT_OFFSET_M, n: center.n };
    const initialRenderer = lifecycleCheckpoint('initial-resident', rendererLifecycle.getTerrainResourceLifecycle());

    await scheduler.update(outsideCamera, [descriptor]);
    const outsideSnapshot = await scheduler.whenIdle();
    traceRecorder.captureSnapshot(outsideSnapshot, 'outside-active-inside-retain');
    const outsideRecord = outsideSnapshot.records.find((record: any) => record.id === descriptor.id);
    if (outsideRecord?.state !== 'cached') {
      throw new Error(`PREVIEW_STREAMING_MOVEMENT_OUTSIDE_STATE: ${outsideRecord?.state ?? 'missing'}`);
    }
    const outsideRenderer = lifecycleCheckpoint('outside-active-inside-retain', rendererLifecycle.getTerrainResourceLifecycle());
    if (outsideRenderer.active || outsideRenderer.current_buffer_count !== 0 || outsideRenderer.current_payload_bytes !== 0) {
      throw new Error(`PREVIEW_TERRAIN_RESOURCE_NOT_RELEASED: ${JSON.stringify(outsideRenderer)}`);
    }
    await animationFrame();

    await scheduler.update({ e: center.e, n: center.n }, [descriptor]);
    latestSnapshot = await scheduler.whenIdle();
    traceRecorder.captureSnapshot(latestSnapshot, 'returned-center');
    const returnRecord = latestSnapshot.records.find((record: any) => record.id === descriptor.id);
    if (returnRecord?.state !== 'resident') {
      throw new Error(`PREVIEW_STREAMING_MOVEMENT_RETURN_STATE: ${returnRecord?.state ?? 'missing'}`);
    }
    const returnedRenderer = lifecycleCheckpoint('returned-center', rendererLifecycle.getTerrainResourceLifecycle());
    if (!returnedRenderer.active || returnedRenderer.current_buffer_count !== 3 || returnedRenderer.current_payload_bytes <= 0) {
      throw new Error(`PREVIEW_TERRAIN_RESOURCE_NOT_RECREATED: ${JSON.stringify(returnedRenderer)}`);
    }
    await animationFrame();

    const cacheHitsDelta = latestSnapshot.metrics.cacheHits - cacheHitsBefore;
    const loadsStartedDelta = latestSnapshot.metrics.loadsStarted - loadsStartedBefore;
    const createsDelta = returnedRenderer.creates - initialRenderer.creates;
    const destroysDelta = returnedRenderer.destroys - initialRenderer.destroys;
    if (resolverCalls !== resolverCallsBefore || loadsStartedDelta !== 0 || cacheHitsDelta !== 1) {
      throw new Error(`PREVIEW_STREAMING_MOVEMENT_REFETCH: ${JSON.stringify({ resolverCallsBefore, resolverCallsAfter: resolverCalls, loadsStartedDelta, cacheHitsDelta })}`);
    }
    if (createsDelta !== 1 || destroysDelta !== 1 || outsideRenderer.destroys - initialRenderer.destroys !== 1) {
      throw new Error(`PREVIEW_TERRAIN_RESOURCE_LIFECYCLE_COUNTS: ${JSON.stringify({ initialRenderer, outsideRenderer, returnedRenderer, createsDelta, destroysDelta })}`);
    }
    if (initialRenderer.backend !== outsideRenderer.backend || initialRenderer.backend !== returnedRenderer.backend) {
      throw new Error('PREVIEW_TERRAIN_RESOURCE_BACKEND_CHANGED');
    }
    if (initialRenderer.physical_vram_release_observed || outsideRenderer.physical_vram_release_observed || returnedRenderer.physical_vram_release_observed) {
      throw new Error('PREVIEW_TERRAIN_RESOURCE_VRAM_CLAIM_INVALID');
    }

    const rawLifecycle = rendererLifecycle.getTerrainResourceLifecycle();
    const createTimings = Array.isArray(rawLifecycle?.create_timing_ms) ? rawLifecycle.create_timing_ms : [];
    const destroyTimings = Array.isArray(rawLifecycle?.destroy_timing_ms) ? rawLifecycle.destroy_timing_ms : [];
    rendererLifecycleObserved = true;
    lastMovementProbe = {
      schema: 'nwe.single-tile-streaming-movement-probe/0.1',
      status: 'PASS',
      path: 'center->outside-active-inside-retain->center',
      tile_id: descriptor.id,
      movement_offset_e_m: STREAMING_MOVEMENT_OFFSET_M,
      active_radius_m: STREAMING_ACTIVE_RADIUS_M,
      retain_radius_m: STREAMING_RETAIN_RADIUS_M,
      checkpoints: ['initial-resident', 'outside-active-inside-retain', 'returned-center'],
      resolver_calls_before: resolverCallsBefore,
      resolver_calls_after: resolverCalls,
      loads_started_delta: loadsStartedDelta,
      cache_hits_delta: cacheHitsDelta,
      duration_ms: monotonicNow() - startedAt,
      renderer_resource_lifecycle_observed: true,
      renderer_backend: returnedRenderer.backend,
      renderer_resource_checkpoints: [initialRenderer, outsideRenderer, returnedRenderer],
      renderer_resource_creates_delta: createsDelta,
      renderer_resource_destroys_delta: destroysDelta,
      renderer_resource_timing_ms: {
        deactivate: destroyTimings.length ? Number(destroyTimings.at(-1)) : null,
        reactivate: createTimings.length ? Number(createTimings.at(-1)) : null,
      },
      physical_vram_release_observed: false,
      note: 'Verified runtime/cache and renderer terrain-resource round-trip. Terrain buffers are removed while cached and recreated from retained verified payload without refetch. Physical VRAM reclamation timing is not observed.',
    };
    return lastMovementProbe;
  };

  const exportStreamingTrace = (movementProbeEnabled: boolean) => traceRecorder.exportTrace({
    tile_id: descriptor.id,
    probe_id: 'preview1-single-tile-cache-roundtrip-v0.1',
    movement_probe_enabled: movementProbeEnabled,
    active_radius_m: STREAMING_ACTIVE_RADIUS_M,
    retain_radius_m: STREAMING_RETAIN_RADIUS_M,
    movement_offset_e_m: STREAMING_MOVEMENT_OFFSET_M,
    renderer_resource_lifecycle_observed: movementProbeEnabled && rendererLifecycleObserved,
    renderer_backend: movementProbeEnabled ? lastMovementProbe?.renderer_backend ?? null : null,
    physical_vram_release_observed: false,
  });

  return {
    payload,
    bundleUrl: terrainBundleUrl,
    bindRendererLifecycle,
    getSnapshot: () => latestSnapshot,
    getResolverCalls: () => resolverCalls,
    getRendererLifecycle: () => rendererLifecycle?.getTerrainResourceLifecycle?.() ?? null,
    runMovementProbe,
    exportStreamingTrace,
  };
}

export async function runPreview1({
  canvas,
  manifestUrl = DEFAULT_PREVIEW1_MANIFEST,
  fetchImpl = globalThis.fetch,
  graphicsProfile = 'balanced',
  rendererPreference = 'auto',
  benchmarkFrameCount = Number(new URLSearchParams(location.search).get('previewBenchmarkFrames') || '0'),
  streamingMovementProbe = false,
  onPhase = () => {},
  onReady = () => {},
  onFrame = () => {},
}: {
  canvas: HTMLCanvasElement;
  manifestUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
  graphicsProfile?: string;
  rendererPreference?: string;
  benchmarkFrameCount?: number;
  streamingMovementProbe?: boolean;
  onPhase?: (phase: string) => void;
  onReady?: (result: any) => void;
  onFrame?: (frame: any) => void;
}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (typeof streamingMovementProbe !== 'boolean') throw new TypeError('streamingMovementProbe must be boolean');
  if (!Number.isInteger(benchmarkFrameCount) || benchmarkFrameCount < 0 || benchmarkFrameCount > 600) {
    throw new RangeError('benchmarkFrameCount must be an integer within [0, 600]');
  }
  const profile = resolveGraphicsProfile(graphicsProfile);
  const rendererChoice = resolveRendererPreference(rendererPreference);
  const startedAt = monotonicNow();
  const startupFrameMonitor = createFrameGapMonitor();
  startupFrameMonitor.start();
  const rendererFrames: any[] = [];

  try {
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
      onFrame: (frame: any) => {
        rendererFrames.push(frame);
        onFrame(frame);
      },
    });
    terrain.bindRendererLifecycle(renderer);

    onPhase('first-frame');
    const firstFrame = await renderer.firstFrame;
    const inputToFirstFrameReadyMs = monotonicNow() - startedAt;
    const startupRafGap = startupFrameMonitor.stop();

    let movementProbe = null;
    if (streamingMovementProbe) {
      onPhase('streaming-movement-probe');
      movementProbe = await terrain.runMovementProbe();
    }
    const streamingTrace = terrain.exportStreamingTrace(streamingMovementProbe);
    if (streamingTrace.droppedEntries !== 0) {
      throw new Error(`PREVIEW_STREAMING_TRACE_DROPPED: ${streamingTrace.droppedEntries}`);
    }

    let rendererFrameBenchmark = null;
    if (benchmarkFrameCount > 0) {
      onPhase('renderer-benchmark');
      rendererFrameBenchmark = await runRendererFrameBenchmark(renderer, rendererFrames, benchmarkFrameCount);
      if (rendererFrameBenchmark.measured_frames !== benchmarkFrameCount) {
        throw new Error(`PREVIEW_RENDERER_BENCHMARK_INCOMPLETE: ${rendererFrameBenchmark.measured_frames}/${benchmarkFrameCount}`);
      }
    }

    const terrainSnapshot = terrain.getSnapshot();
    const result = {
      schema: 'nwe.world-preview-runtime/0.1',
      status: 'PASS',
      manifest,
      manifestUrl: manifestBase,
      tile_id: manifest.tile.id,
      graphics_profile: profile.id,
      renderer_preference: rendererChoice,
      timing_ms: {
        input_to_first_frame_ready_ms: inputToFirstFrameReadyMs,
        startup_raf_gap: startupRafGap,
        renderer_frame_benchmark: rendererFrameBenchmark,
      },
      browser_memory: browserMemorySnapshot(),
      terrain: {
        artifact_sha256: terrain.payload.artifact.sha256,
        verification_code: terrain.payload.verification.code,
        retained_bytes: terrainSnapshot.records.find((record: any) => record.id === manifest.tile.id)?.byteSize ?? null,
        scheduler: terrainSnapshot.metrics,
        resolver_calls: terrain.getResolverCalls(),
        timing_ms: terrain.payload.timingMs,
        movement_probe: movementProbe,
        streaming_trace: streamingTrace,
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
        terrain_resource_lifecycle: terrain.getRendererLifecycle(),
        fallback: rendererFallback,
        first_frame: firstFrame,
      },
      attribution: manifest.attribution ?? [],
    };
    onPhase('ready');
    onReady(result);
    return { result, renderer };
  } catch (error) {
    startupFrameMonitor.stop();
    throw error;
  }
}
