import assert from 'node:assert/strict';
import { buildDeviceEvidence, compareDeviceEvidenceContext } from './src/deviceEvidence.mjs';

const TILE_ID = 'epsg25832_611000_6677000_1000m';
const TERRAIN_SHA = 'terrain-sha';
const TERRAIN_PAYLOAD_BYTES = 729120;

function lifecycleCheckpoint(label, backend, active, creates, destroys) {
  return {
    label,
    backend,
    tile_id: TILE_ID,
    artifact_sha256: TERRAIN_SHA,
    active,
    creates,
    destroys,
    current_buffer_count: active ? 3 : 0,
    current_payload_bytes: active ? TERRAIN_PAYLOAD_BYTES : 0,
    physical_vram_release_observed: false,
  };
}

function movementProbeFor(backend = 'webgl2') {
  return {
    schema: 'nwe.single-tile-streaming-movement-probe/0.1',
    status: 'PASS',
    path: 'center->outside-active-inside-retain->center',
    tile_id: TILE_ID,
    movement_offset_e_m: 1000,
    active_radius_m: 800,
    retain_radius_m: 1200,
    checkpoints: ['initial-resident', 'outside-active-inside-retain', 'returned-center'],
    resolver_calls_before: 1,
    resolver_calls_after: 1,
    loads_started_delta: 0,
    cache_hits_delta: 1,
    duration_ms: 4.5,
    renderer_resource_lifecycle_observed: true,
    renderer_backend: backend,
    renderer_resource_checkpoints: [
      lifecycleCheckpoint('initial-resident', backend, true, 1, 0),
      lifecycleCheckpoint('outside-active-inside-retain', backend, false, 1, 1),
      lifecycleCheckpoint('returned-center', backend, true, 2, 1),
    ],
    renderer_resource_creates_delta: 1,
    renderer_resource_destroys_delta: 1,
    renderer_resource_timing_ms: { deactivate: 0.3, reactivate: 0.7 },
    physical_vram_release_observed: false,
  };
}

function traceFor() {
  const entries = [
    { sequence: 1, recordedAt: 1, kind: 'scheduler-event', payload: { type: 'load-started', tileId: TILE_ID, attempt: 1 } },
    { sequence: 2, recordedAt: 2, kind: 'terrain-load-observation', payload: { tileId: TILE_ID, attempt: 1, status: 'completed' } },
    { sequence: 3, recordedAt: 3, kind: 'lifecycle-observation', payload: { schema: 'nwe.streaming-lifecycle-observation/0.1', phase: 'activate', status: 'completed', tileId: TILE_ID, reason: 'load-complete', durationMs: 0.2 } },
    { sequence: 4, recordedAt: 4, kind: 'scheduler-event', payload: { type: 'tile-activated', tileId: TILE_ID, reason: 'load-complete' } },
    { sequence: 5, recordedAt: 5, kind: 'scheduler-snapshot', payload: { label: 'initial-resident', snapshot: { metrics: { activeLoads: 0, queueDepth: 0 } } } },
    { sequence: 6, recordedAt: 6, kind: 'lifecycle-observation', payload: { schema: 'nwe.streaming-lifecycle-observation/0.1', phase: 'deactivate', status: 'completed', tileId: TILE_ID, reason: 'interest-lost', durationMs: 0.3 } },
    { sequence: 7, recordedAt: 7, kind: 'scheduler-event', payload: { type: 'tile-deactivated', tileId: TILE_ID, reason: 'interest-lost' } },
    { sequence: 8, recordedAt: 8, kind: 'scheduler-snapshot', payload: { label: 'outside-active-inside-retain', snapshot: { metrics: { activeLoads: 0, queueDepth: 0 } } } },
    { sequence: 9, recordedAt: 9, kind: 'lifecycle-observation', payload: { schema: 'nwe.streaming-lifecycle-observation/0.1', phase: 'activate', status: 'completed', tileId: TILE_ID, reason: 'cache-hit', durationMs: 0.7 } },
    { sequence: 10, recordedAt: 10, kind: 'scheduler-event', payload: { type: 'tile-activated', tileId: TILE_ID, reason: 'cache-hit' } },
    { sequence: 11, recordedAt: 11, kind: 'scheduler-snapshot', payload: { label: 'returned-center', snapshot: { metrics: { activeLoads: 0, queueDepth: 0 } } } },
  ];
  return {
    schema: 'nwe.streaming-movement-trace/0.1',
    metadata: {
      tile_id: TILE_ID,
      probe_id: 'preview1-single-tile-cache-roundtrip-v0.1',
      movement_probe_enabled: true,
      active_radius_m: 800,
      retain_radius_m: 1200,
      movement_offset_e_m: 1000,
      renderer_resource_lifecycle_observed: true,
      renderer_backend: 'webgl2',
      physical_vram_release_observed: false,
    },
    maxEntries: 256,
    retainedEntries: entries.length,
    droppedEntries: 0,
    firstSequence: 1,
    lastSequence: entries.length,
    entries,
  };
}

function terrainLifecycleFor(backend = 'webgl2') {
  return {
    schema: 'nwe.preview-terrain-resource-lifecycle/0.1',
    backend,
    tile_id: TILE_ID,
    artifact_sha256: TERRAIN_SHA,
    active: true,
    creates: 2,
    destroys: 1,
    create_timing_ms: [5, 0.7],
    destroy_timing_ms: [0.3],
    current_buffer_count: 3,
    current_payload_bytes: TERRAIN_PAYLOAD_BYTES,
    physical_vram_release_observed: false,
  };
}

function runtimeResultFor(backend = 'webgl2') {
  const trace = traceFor();
  trace.metadata.renderer_backend = backend;
  return {
    schema: 'nwe.world-preview-runtime/0.1',
    status: 'PASS',
    manifestUrl: 'https://runtime.example/manifest.json',
    tile_id: TILE_ID,
    graphics_profile: 'balanced',
    renderer_preference: backend,
    timing_ms: { input_to_first_frame_ready_ms: 321, startup_raf_gap: { p50_ms: 16.7 }, renderer_frame_benchmark: { requested_frames: 90, measured_frames: 90 } },
    browser_memory: { used_js_heap_bytes: 123 },
    terrain: {
      artifact_sha256: TERRAIN_SHA,
      verification_code: 'RUNTIME_VERIFICATION_PASS',
      retained_bytes: 4729120,
      timing_ms: { verify_ms: 20 },
      movement_probe: movementProbeFor(backend),
      streaming_trace: trace,
    },
    roads: { artifact_sha256: 'roads-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', count: 246 },
    buildings: { artifact_sha256: 'buildings-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', count: 135 },
    renderer: {
      backend,
      fallback: null,
      graphics_profile: 'balanced',
      max_dpr: 1.5,
      msaa_samples: 1,
      power_preference: 'default',
      draw_calls_per_frame: 4,
      gpu_buffer_count: backend === 'webgpu' ? 13 : 9,
      gpu_buffer_payload_bytes: 849246,
      gpu_attachment_estimated_bytes: 1000,
      timestamp_query_supported: backend === 'webgpu',
      terrain_vertices: 16641,
      terrain_triangles: 32768,
      source_backed_building_heights: 15,
      unresolved_building_heights: 120,
      pixel_ratio: 1.5,
      terrain_resource_lifecycle: terrainLifecycleFor(backend),
      first_frame: { pixelRatio: 1.5, camera: { yaw: 0.4, pitch: -0.65, distance: 1450 } },
      timing_ms: { gpu_resource_apply_cpu_ms: 5 },
    },
  };
}

const navigatorLike = {
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  language: 'nb-NO',
  userAgentData: { mobile: true, platform: 'Android', brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] },
};

function build(result) {
  return buildDeviceEvidence({
    result,
    runtimeRequests: ['https://runtime.example/manifest.json', 'https://runtime.example/terrain.bundle'],
    locationHref: 'https://preview.example/device-evidence.html?renderer=webgl2&target=android-chrome&session=sentinel-session-001',
    navigatorLike,
    screenLike: { width: 412, height: 915 },
    canvasLike: { clientWidth: 412, clientHeight: 600, width: 618, height: 900 },
    devicePixelRatioLike: 1.5,
    buildIdentity: { git_commit_sha: '0123456789abcdef0123456789abcdef01234567', deployment_id: 'dpl_test' },
    captureSessionId: 'sentinel-session-001',
    evidenceTarget: 'android-chrome',
    capturedAt: '2026-08-19T00:00:00.000Z',
  });
}

const webgl = build(runtimeResultFor('webgl2'));
assert.equal(webgl.streaming.strict_trace_validation.ok, true);
assert.equal(webgl.streaming.strict_trace_validation.code, 'TRACE_ACCEPTED');
assert.equal(webgl.streaming.strict_trace_validation.summary.lifecycleObservations, 3);
assert.equal(webgl.streaming.comparison_contract.movement_probe.cache_hits_delta, 1);
assert.equal(webgl.renderer.terrain_resource_lifecycle.active, true);

const webgpuResult = runtimeResultFor('webgpu');
for (const checkpoint of webgpuResult.terrain.movement_probe.renderer_resource_checkpoints) checkpoint.backend = 'webgpu';
const webgpu = build(webgpuResult);
assert.equal(compareDeviceEvidenceContext(webgl, webgpu).comparable, true);

const changedStreaming = runtimeResultFor('webgpu');
changedStreaming.terrain.movement_probe.active_radius_m = 900;
for (const checkpoint of changedStreaming.terrain.movement_probe.renderer_resource_checkpoints) checkpoint.backend = 'webgpu';
assert.deepEqual(compareDeviceEvidenceContext(webgl, build(changedStreaming)).mismatches, ['streaming']);

const dropped = runtimeResultFor();
dropped.terrain.streaming_trace.droppedEntries = 1;
assert.throws(() => build(dropped), /DEVICE_EVIDENCE_STREAMING_TRACE_REJECTED|DEVICE_EVIDENCE_STREAMING_TRACE_INCOMPLETE/);

const missingLifecycle = runtimeResultFor();
missingLifecycle.terrain.streaming_trace.entries.splice(5, 1);
missingLifecycle.terrain.streaming_trace.entries.forEach((entry, index) => { entry.sequence = index + 1; });
missingLifecycle.terrain.streaming_trace.retainedEntries = missingLifecycle.terrain.streaming_trace.entries.length;
missingLifecycle.terrain.streaming_trace.lastSequence = missingLifecycle.terrain.streaming_trace.entries.length;
assert.throws(() => build(missingLifecycle), /DEVICE_EVIDENCE_STREAMING_TRACE_REJECTED: TRACE_LIFECYCLE_CORRELATION_MISMATCH/);

const wrongArtifact = runtimeResultFor();
wrongArtifact.terrain.movement_probe.renderer_resource_checkpoints[1].artifact_sha256 = 'other-sha';
assert.throws(() => build(wrongArtifact), /DEVICE_EVIDENCE_STREAMING_RENDERER_ARTIFACT_MISMATCH/);

const falseVram = runtimeResultFor();
falseVram.terrain.movement_probe.physical_vram_release_observed = true;
assert.throws(() => build(falseVram), /DEVICE_EVIDENCE_STREAMING_VRAM_CLAIM_INVALID/);

const fallback = runtimeResultFor('webgl2');
fallback.renderer_preference = 'webgpu';
const fallbackEvidence = build(fallback);
assert.deepEqual(compareDeviceEvidenceContext(webgl, fallbackEvidence).mismatches, ['backend_fallback', 'backend_pair']);

console.log('device lifecycle evidence regressions: PASS');
