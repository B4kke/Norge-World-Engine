import assert from 'node:assert/strict';
import { assessWebGpuMilestoneEvidence } from './src/deviceMilestoneEvidence.mjs';

const viewerCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const runtimeCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const evidence = {
  schema: 'nwe.world-viewer-device-evidence/0.1',
  status: 'PASS',
  build: { git_commit_sha: viewerCommit, deployment_id: 'dpl_test' },
  capture: { target: 'android-chrome', session_id: 'physical-session-001', physical_device_attested: false },
  device: { browser_environment: { inferred_android_chrome: true } },
  world: {
    raw_source_runtime_calls: 0,
    verification: { terrain: 'RUNTIME_VERIFICATION_PASS', roads: 'RUNTIME_VERIFICATION_PASS', buildings: 'RUNTIME_VERIFICATION_PASS' },
  },
  streaming: { strict_trace_validation: { ok: true, code: 'STREAMING_TRACE_PASS' } },
  renderer: {
    requested_backend: 'webgpu', active_backend: 'webgpu', fallback: null, graphics_profile: 'high',
    draw_calls_per_frame: 18, gpu_buffer_count: 31, gpu_buffer_payload_bytes: 8_492_460,
    gpu_attachment_estimated_bytes: 24_000_000, timestamp_query_supported: false,
  },
  timing_ms: {
    input_to_first_frame_ready_ms: 418.2,
    repeated_draw: {
      requested_frames: 90, measured_frames: 90, draw_calls: 18,
      frame_gap: { samples: 90, p50_ms: 16.8, p95_ms: 22.4, p99_ms: 31.1, largest_ms: 37.5 },
      draw_cpu: { samples: 90, p50_ms: 2.1, p95_ms: 3.7, p99_ms: 4.2, largest_ms: 4.6 },
    },
  },
};
const runtimeResult = {
  manifest: { generated_from_commit: runtimeCommit },
  renderer: { web_realism: { status: 'READY' } },
};

const ready = assessWebGpuMilestoneEvidence({
  evidence,
  runtimeResult,
  operatorPhysicalDeviceAttestation: true,
  expectedViewerCommitSha: viewerCommit,
  expectedRuntimeCommitSha: runtimeCommit,
});
assert.equal(ready.status, 'READY_FOR_REVIEW');
assert.deepEqual(ready.failures, []);
assert.equal(ready.requirements.active_backend_webgpu, true);
assert.equal(ready.requirements.timestamp_query_capability_recorded, true);
assert.equal(ready.observations.timestamp_query_supported, false);
assert.equal(ready.observations.frame_gap_p95_ms, 22.4);

const noAttestation = assessWebGpuMilestoneEvidence({ evidence, runtimeResult });
assert.equal(noAttestation.status, 'INCOMPLETE');
assert.deepEqual(noAttestation.failures, ['operator_physical_device_attested']);

const webgl = structuredClone(evidence);
webgl.renderer.requested_backend = 'webgl2';
webgl.renderer.active_backend = 'webgl2';
const webglAssessment = assessWebGpuMilestoneEvidence({ evidence: webgl, runtimeResult, operatorPhysicalDeviceAttestation: true });
assert.equal(webglAssessment.status, 'INCOMPLETE');
assert.ok(webglAssessment.failures.includes('requested_backend_webgpu'));
assert.ok(webglAssessment.failures.includes('active_backend_webgpu'));

const fallback = structuredClone(evidence);
fallback.renderer.active_backend = 'webgl2';
fallback.renderer.fallback = { from: 'webgpu', to: 'webgl2', reason: 'unavailable' };
const fallbackAssessment = assessWebGpuMilestoneEvidence({ evidence: fallback, runtimeResult, operatorPhysicalDeviceAttestation: true });
assert.ok(fallbackAssessment.failures.includes('active_backend_webgpu'));
assert.ok(fallbackAssessment.failures.includes('no_backend_fallback'));

const missingRealism = structuredClone(runtimeResult);
missingRealism.renderer.web_realism.status = 'DEGRADED';
const realismAssessment = assessWebGpuMilestoneEvidence({ evidence, runtimeResult: missingRealism, operatorPhysicalDeviceAttestation: true });
assert.deepEqual(realismAssessment.failures, ['realism_ready']);

const shortWindow = structuredClone(evidence);
shortWindow.timing_ms.repeated_draw.requested_frames = 30;
shortWindow.timing_ms.repeated_draw.measured_frames = 30;
shortWindow.timing_ms.repeated_draw.frame_gap.samples = 30;
shortWindow.timing_ms.repeated_draw.draw_cpu.samples = 30;
const shortAssessment = assessWebGpuMilestoneEvidence({ evidence: shortWindow, runtimeResult, operatorPhysicalDeviceAttestation: true });
assert.deepEqual(shortAssessment.failures, ['measurement_window_complete']);

const wrongViewer = assessWebGpuMilestoneEvidence({ evidence, runtimeResult, operatorPhysicalDeviceAttestation: true, expectedViewerCommitSha: 'cccc' });
assert.deepEqual(wrongViewer.failures, ['viewer_build_matches_expected']);
const wrongRuntime = assessWebGpuMilestoneEvidence({ evidence, runtimeResult, operatorPhysicalDeviceAttestation: true, expectedRuntimeCommitSha: 'dddd' });
assert.deepEqual(wrongRuntime.failures, ['runtime_snapshot_matches_expected']);

assert.throws(() => assessWebGpuMilestoneEvidence({ evidence, runtimeResult, minMeasuredFrames: 9 }), /WEBGPU_MILESTONE_MIN_FRAMES_OUT_OF_RANGE/);
console.log('device WebGPU milestone evidence regressions: PASS');
