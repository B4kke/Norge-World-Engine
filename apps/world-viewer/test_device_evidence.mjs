import assert from 'node:assert/strict';
import { buildDeviceEvidence, classifyBrowserEnvironment, compareDeviceEvidenceContext, evidenceFilename, isRawSourceRuntimeUrl } from './src/deviceEvidence.mjs';

const movementProbe = {
  schema: 'nwe.single-tile-streaming-movement-probe/0.1',
  status: 'PASS',
  path: 'center->outside-active-inside-retain->center',
  tile_id: 'epsg25832_611000_6677000_1000m',
  movement_offset_e_m: 1000,
  active_radius_m: 800,
  retain_radius_m: 1200,
  checkpoints: ['initial-resident', 'outside-active-inside-retain', 'returned-center'],
  resolver_calls_before: 1,
  resolver_calls_after: 1,
  loads_started_delta: 0,
  cache_hits_delta: 1,
  duration_ms: 4.5,
  renderer_resource_lifecycle_observed: false,
};

const streamingTrace = {
  schema: 'nwe.streaming-movement-trace/0.1',
  metadata: {
    tile_id: 'epsg25832_611000_6677000_1000m',
    probe_id: 'preview1-single-tile-cache-roundtrip-v0.1',
    movement_probe_enabled: true,
    active_radius_m: 800,
    retain_radius_m: 1200,
    movement_offset_e_m: 1000,
    renderer_resource_lifecycle_observed: false,
  },
  maxEntries: 256,
  retainedEntries: 9,
  droppedEntries: 0,
  firstSequence: 1,
  lastSequence: 9,
  entries: [
    { sequence: 1, recordedAt: 10, kind: 'scheduler-event', payload: { type: 'load-started' } },
    { sequence: 9, recordedAt: 30, kind: 'scheduler-snapshot', payload: { label: 'returned-center' } },
  ],
};

const result = {
  schema: 'nwe.world-preview-runtime/0.1', status: 'PASS', manifestUrl: 'https://example.invalid/manifest.json', tile_id: 'epsg25832_611000_6677000_1000m', graphics_profile: 'balanced', renderer_preference: 'webgl2',
  timing_ms: { input_to_first_frame_ready_ms: 321, startup_raf_gap: { p50_ms: 16.7 }, renderer_frame_benchmark: { requested_frames: 90, measured_frames: 90 } },
  browser_memory: { used_js_heap_bytes: 123 },
  terrain: {
    artifact_sha256: 'terrain-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', retained_bytes: 4729120, timing_ms: { verify_ms: 20 },
    movement_probe: movementProbe, streaming_trace: streamingTrace,
  },
  roads: { artifact_sha256: 'roads-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', count: 246 },
  buildings: { artifact_sha256: 'buildings-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', count: 135 },
  renderer: {
    backend: 'webgl2', fallback: null, graphics_profile: 'balanced', max_dpr: 2, msaa_samples: 1, power_preference: 'default',
    draw_calls_per_frame: 4, gpu_buffer_count: 9, gpu_buffer_payload_bytes: 849246,
    gpu_attachment_estimated_bytes: 1000, timestamp_query_supported: false, terrain_vertices: 16641, terrain_triangles: 32768,
    source_backed_building_heights: 15, unresolved_building_heights: 120, pixel_ratio: 2,
    first_frame: { pixelRatio: 2, camera: { yaw: 0.4, pitch: -0.65, distance: 1450 } },
    timing_ms: { gpu_resource_apply_cpu_ms: 5 },
  },
};

const androidNavigator = {
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l', hardwareConcurrency: 8, deviceMemory: 8, language: 'nb-NO',
  userAgentData: { mobile: true, platform: 'Android', brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] },
};

const build = (overrides = {}) => buildDeviceEvidence({
  result,
  runtimeRequests: ['https://runtime.example/manifest.json', 'https://runtime.example/terrain.bundle'],
  locationHref: 'https://preview.example/device-evidence.html?renderer=webgl2&target=android-chrome&session=lumen-session-001',
  navigatorLike: androidNavigator,
  screenLike: { width: 412, height: 915 },
  canvasLike: { clientWidth: 412, clientHeight: 600, width: 824, height: 1200 },
  devicePixelRatioLike: 2,
  buildIdentity: { git_commit_sha: '0123456789abcdef0123456789abcdef01234567', deployment_id: 'dpl_test' },
  captureSessionId: 'lumen-session-001',
  evidenceTarget: 'android-chrome',
  capturedAt: '2026-08-18T18:00:00.000Z',
  ...overrides,
});

const evidence = build();
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.evidence_class, 'android-chrome-browser-capture');
assert.equal(evidence.capture.session_id, 'lumen-session-001');
assert.equal(evidence.capture.physical_device_attested, false);
assert.equal(evidence.device.browser_environment.inferred_android_chrome, true);
assert.equal(evidence.build.git_commit_sha, '0123456789abcdef0123456789abcdef01234567');
assert.equal(evidence.world.raw_source_runtime_calls, 0);
assert.equal(evidence.world.artifact_sha256.terrain, 'terrain-sha');
assert.equal(evidence.streaming.movement_probe.status, 'PASS');
assert.equal(evidence.streaming.trace.droppedEntries, 0);
assert.equal(evidence.streaming.comparison_contract.movement_probe.cache_hits_delta, 1);
assert.equal(evidence.streaming.comparison_contract.movement_probe.renderer_resource_lifecycle_observed, false);
assert.equal(evidence.renderer.active_backend, 'webgl2');
assert.equal(evidence.renderer.camera.distance, 1450);
assert.deepEqual(evidence.renderer.render_surface.backing_px, { width: 824, height: 1200 });
assert.equal(evidence.renderer.render_surface.pixel_ratio, 2);
assert.equal(evidence.timing_ms.repeated_draw.measured_frames, 90);
assert.match(evidenceFilename(evidence), /webgl2-0123456789ab-lumen-session-00\.json$/);
assert.equal(isRawSourceRuntimeUrl('https://www.vegvesen.no/nvdb'), true);
assert.equal(classifyBrowserEnvironment(androidNavigator).inferred_android_chrome, true);
assert.equal(classifyBrowserEnvironment({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0' }).inferred_android_chrome, false);
assert.equal(classifyBrowserEnvironment({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 EdgA/140.0.0.0 Mobile' }).inferred_android_chrome, false);
assert.equal(classifyBrowserEnvironment({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile', userAgentData: { mobile: true, platform: 'Android', brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] } }).inferred_android_chrome, false);

const webgpuResult = structuredClone(result);
webgpuResult.renderer.backend = 'webgpu';
webgpuResult.renderer.webgpu_feature_level = 'core';
webgpuResult.renderer_preference = 'webgpu';
webgpuResult.terrain.movement_probe.duration_ms = 8.5;
webgpuResult.terrain.streaming_trace.entries[0].recordedAt = 100;
const comparable = build({ result: webgpuResult });
assert.equal(comparable.renderer.webgpu_feature_level, 'core');
assert.equal(comparable.renderer.webgpu_adapter_request_mode, 'core');
assert.deepEqual(compareDeviceEvidenceContext(evidence, comparable).mismatches, []);
assert.equal(compareDeviceEvidenceContext(evidence, comparable).comparable, true);
assert.equal(compareDeviceEvidenceContext(evidence, comparable).physical_device_attested, false);

const changedSession = build({ result: webgpuResult, captureSessionId: 'lumen-session-002' });
assert.equal(compareDeviceEvidenceContext(evidence, changedSession).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, changedSession).mismatches, ['capture']);

const missingSession = build({ result: webgpuResult, captureSessionId: null });
assert.equal(compareDeviceEvidenceContext(evidence, missingSession).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, missingSession).mismatches, ['capture_session_missing', 'capture']);

const changedStreamingResult = structuredClone(webgpuResult);
changedStreamingResult.terrain.movement_probe.active_radius_m = 900;
const changedStreaming = build({ result: changedStreamingResult });
assert.equal(compareDeviceEvidenceContext(evidence, changedStreaming).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, changedStreaming).mismatches, ['streaming']);

const changedCameraResult = structuredClone(webgpuResult);
changedCameraResult.renderer.first_frame.camera.yaw = 0.5;
const changedCamera = build({ result: changedCameraResult });
assert.equal(compareDeviceEvidenceContext(evidence, changedCamera).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, changedCamera).mismatches, ['camera']);

const changedSurface = build({ result: webgpuResult, canvasLike: { clientWidth: 412, clientHeight: 600, width: 412, height: 600 } });
assert.equal(compareDeviceEvidenceContext(evidence, changedSurface).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, changedSurface).mismatches, ['render_surface']);

const changedBuild = build({ result: webgpuResult, buildIdentity: { git_commit_sha: '1111111111111111111111111111111111111111', deployment_id: 'dpl_other' } });
assert.equal(compareDeviceEvidenceContext(evidence, changedBuild).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, changedBuild).mismatches, ['build']);

const changedWindowResult = structuredClone(webgpuResult);
changedWindowResult.timing_ms.renderer_frame_benchmark = { requested_frames: 120, measured_frames: 120 };
const changedWindow = build({ result: changedWindowResult });
assert.equal(compareDeviceEvidenceContext(evidence, changedWindow).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, changedWindow).mismatches, ['measurement_window']);

const missingBuild = build({ result: webgpuResult, buildIdentity: {} });
assert.equal(compareDeviceEvidenceContext(evidence, missingBuild).comparable, false);
assert.deepEqual(compareDeviceEvidenceContext(evidence, missingBuild).mismatches, ['build_identity_missing', 'build']);

const droppedTrace = structuredClone(result);
droppedTrace.terrain.streaming_trace.droppedEntries = 1;
assert.throws(() => build({ result: droppedTrace }), /DEVICE_EVIDENCE_STREAMING_TRACE_INCOMPLETE/);
const ambiguousRendererBoundary = structuredClone(result);
ambiguousRendererBoundary.terrain.movement_probe.renderer_resource_lifecycle_observed = true;
assert.throws(() => build({ result: ambiguousRendererBoundary }), /DEVICE_EVIDENCE_STREAMING_RENDERER_BOUNDARY_AMBIGUOUS/);
const missingTrace = structuredClone(result);
delete missingTrace.terrain.streaming_trace;
assert.throws(() => build({ result: missingTrace }), /DEVICE_EVIDENCE_STREAMING_TRACE_MISSING/);

assert.throws(() => build({ navigatorLike: { userAgent: 'desktop chrome' }, evidenceTarget: 'android-chrome' }), /DEVICE_EVIDENCE_TARGET_MISMATCH_ANDROID_CHROME/);
assert.throws(() => buildDeviceEvidence({ result, runtimeRequests: ['https://api.openstreetmap.org/api/0.6/map'], locationHref: 'x' }), /DEVICE_EVIDENCE_RAW_SOURCE_CALL/);
const bad = structuredClone(result);
bad.terrain.verification_code = 'FAIL';
assert.throws(() => buildDeviceEvidence({ result: bad, runtimeRequests: [], locationHref: 'x' }), /DEVICE_EVIDENCE_PROVENANCE_NOT_READY/);
console.log('device evidence regressions: PASS');
