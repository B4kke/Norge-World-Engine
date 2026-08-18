import assert from 'node:assert/strict';
import { buildDeviceEvidence, compareDeviceEvidenceContext, evidenceFilename, isRawSourceRuntimeUrl } from './src/deviceEvidence.mjs';

const result = {
  schema: 'nwe.world-preview-runtime/0.1', status: 'PASS', manifestUrl: 'https://example.invalid/manifest.json', tile_id: 'epsg25832_611000_6677000_1000m', graphics_profile: 'balanced', renderer_preference: 'webgl2',
  timing_ms: { input_to_first_frame_ready_ms: 321, startup_raf_gap: { p50_ms: 16.7 }, renderer_frame_benchmark: { requested_frames: 90, measured_frames: 90 } },
  browser_memory: { used_js_heap_bytes: 123 },
  terrain: { artifact_sha256: 'terrain-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', retained_bytes: 4729120, timing_ms: { verify_ms: 20 } },
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

const build = (overrides = {}) => buildDeviceEvidence({
  result,
  runtimeRequests: ['https://runtime.example/manifest.json', 'https://runtime.example/terrain.bundle'],
  locationHref: 'https://preview.example/device-evidence.html?renderer=webgl2',
  navigatorLike: { userAgent: 'Android Chrome test', platform: 'Linux armv8l', hardwareConcurrency: 8, deviceMemory: 8, language: 'nb-NO' },
  screenLike: { width: 412, height: 915 },
  canvasLike: { clientWidth: 412, clientHeight: 600, width: 824, height: 1200 },
  devicePixelRatioLike: 2,
  buildIdentity: { git_commit_sha: '0123456789abcdef0123456789abcdef01234567', deployment_id: 'dpl_test' },
  capturedAt: '2026-08-18T18:00:00.000Z',
  ...overrides,
});

const evidence = build();
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.build.git_commit_sha, '0123456789abcdef0123456789abcdef01234567');
assert.equal(evidence.world.raw_source_runtime_calls, 0);
assert.equal(evidence.world.artifact_sha256.terrain, 'terrain-sha');
assert.equal(evidence.renderer.active_backend, 'webgl2');
assert.equal(evidence.renderer.camera.distance, 1450);
assert.deepEqual(evidence.renderer.render_surface.backing_px, { width: 824, height: 1200 });
assert.equal(evidence.renderer.render_surface.pixel_ratio, 2);
assert.equal(evidence.timing_ms.repeated_draw.measured_frames, 90);
assert.match(evidenceFilename(evidence), /webgl2-0123456789ab\.json$/);
assert.equal(isRawSourceRuntimeUrl('https://www.vegvesen.no/nvdb'), true);

const webgpuResult = structuredClone(result);
webgpuResult.renderer.backend = 'webgpu';
webgpuResult.renderer_preference = 'webgpu';
const comparable = build({ result: webgpuResult });
assert.deepEqual(compareDeviceEvidenceContext(evidence, comparable).mismatches, []);
assert.equal(compareDeviceEvidenceContext(evidence, comparable).comparable, true);

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

assert.throws(() => buildDeviceEvidence({ result, runtimeRequests: ['https://api.openstreetmap.org/api/0.6/map'], locationHref: 'x' }), /DEVICE_EVIDENCE_RAW_SOURCE_CALL/);
const bad = structuredClone(result);
bad.terrain.verification_code = 'FAIL';
assert.throws(() => buildDeviceEvidence({ result: bad, runtimeRequests: [], locationHref: 'x' }), /DEVICE_EVIDENCE_PROVENANCE_NOT_READY/);
console.log('device evidence regressions: PASS');
