import assert from 'node:assert/strict';
import { buildDeviceEvidence, evidenceFilename, isRawSourceRuntimeUrl } from './src/deviceEvidence.mjs';

const result = {
  schema: 'nwe.world-preview-runtime/0.1', status: 'PASS', manifestUrl: 'https://example.invalid/manifest.json', tile_id: 'epsg25832_611000_6677000_1000m', graphics_profile: 'balanced', renderer_preference: 'webgl2',
  timing_ms: { input_to_first_frame_ready_ms: 321, startup_raf_gap: { p50_ms: 16.7 }, renderer_frame_benchmark: { requested_frames: 90, measured_frames: 90 } },
  browser_memory: { used_js_heap_bytes: 123 },
  terrain: { artifact_sha256: 'terrain-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', retained_bytes: 4729120, timing_ms: { verify_ms: 20 } },
  roads: { artifact_sha256: 'roads-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', count: 246 },
  buildings: { artifact_sha256: 'buildings-sha', verification_code: 'RUNTIME_VERIFICATION_PASS', count: 135 },
  renderer: { backend: 'webgl2', fallback: null, draw_calls_per_frame: 4, gpu_buffer_count: 9, gpu_buffer_payload_bytes: 849246, gpu_attachment_estimated_bytes: 1000, timestamp_query_supported: false, terrain_vertices: 16641, terrain_triangles: 32768, source_backed_building_heights: 15, unresolved_building_heights: 120, timing_ms: { gpu_resource_apply_cpu_ms: 5 } },
};

const evidence = buildDeviceEvidence({
  result,
  runtimeRequests: ['https://runtime.example/manifest.json', 'https://runtime.example/terrain.bundle'],
  locationHref: 'https://preview.example/device-evidence.html?renderer=webgl2',
  navigatorLike: { userAgent: 'Android Chrome test', platform: 'Linux armv8l', hardwareConcurrency: 8, deviceMemory: 8, language: 'nb-NO' },
  screenLike: { width: 412, height: 915 },
  capturedAt: '2026-08-18T18:00:00.000Z',
});
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.world.raw_source_runtime_calls, 0);
assert.equal(evidence.world.artifact_sha256.terrain, 'terrain-sha');
assert.equal(evidence.renderer.active_backend, 'webgl2');
assert.equal(evidence.timing_ms.repeated_draw.measured_frames, 90);
assert.match(evidenceFilename(evidence), /webgl2\.json$/);
assert.equal(isRawSourceRuntimeUrl('https://www.vegvesen.no/nvdb'), true);
assert.throws(() => buildDeviceEvidence({ result, runtimeRequests: ['https://api.openstreetmap.org/api/0.6/map'], locationHref: 'x' }), /DEVICE_EVIDENCE_RAW_SOURCE_CALL/);
const bad = structuredClone(result);
bad.terrain.verification_code = 'FAIL';
assert.throws(() => buildDeviceEvidence({ result: bad, runtimeRequests: [], locationHref: 'x' }), /DEVICE_EVIDENCE_PROVENANCE_NOT_READY/);
console.log('device evidence regressions: PASS');
