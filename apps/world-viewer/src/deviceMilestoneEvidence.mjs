const VERIFICATION_PASS = 'RUNTIME_VERIFICATION_PASS';
const REALISM_READY = 'READY';

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function completeTimingSummary(summary, measuredFrames) {
  return Boolean(summary)
    && Number(summary.samples) === Number(measuredFrames)
    && finitePositive(summary.p50_ms)
    && finitePositive(summary.p95_ms);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function assessWebGpuMilestoneEvidence({
  evidence,
  runtimeResult,
  operatorPhysicalDeviceAttestation = false,
  expectedViewerCommitSha = null,
  expectedRuntimeCommitSha = null,
  minMeasuredFrames = 90,
} = {}) {
  if (!Number.isInteger(minMeasuredFrames) || minMeasuredFrames < 10 || minMeasuredFrames > 600) {
    throw new RangeError('WEBGPU_MILESTONE_MIN_FRAMES_OUT_OF_RANGE');
  }

  const repeated = evidence?.timing_ms?.repeated_draw ?? null;
  const verification = evidence?.world?.verification ?? {};
  const runtimeGeneratedFromCommit = runtimeResult?.manifest?.generated_from_commit ?? null;
  const viewerCommit = evidence?.build?.git_commit_sha ?? null;
  const requestedBackend = String(evidence?.renderer?.requested_backend ?? '').toLowerCase();
  const activeBackend = String(evidence?.renderer?.active_backend ?? '').toLowerCase();
  const realismStatus = runtimeResult?.renderer?.web_realism?.status ?? null;
  const measuredFrames = Number(repeated?.measured_frames);
  const requestedFrames = Number(repeated?.requested_frames);

  const requirements = {
    capture_pass: evidence?.schema === 'nwe.world-viewer-device-evidence/0.1' && evidence?.status === 'PASS',
    viewer_build_bound: nonEmptyString(viewerCommit),
    viewer_build_matches_expected: !expectedViewerCommitSha || viewerCommit === expectedViewerCommitSha,
    runtime_snapshot_bound: nonEmptyString(runtimeGeneratedFromCommit),
    runtime_snapshot_matches_expected: !expectedRuntimeCommitSha || runtimeGeneratedFromCommit === expectedRuntimeCommitSha,
    capture_session_bound: nonEmptyString(evidence?.capture?.session_id),
    android_chrome_target: evidence?.capture?.target === 'android-chrome',
    android_chrome_detected: evidence?.device?.browser_environment?.inferred_android_chrome === true,
    operator_physical_device_attested: operatorPhysicalDeviceAttestation === true,
    requested_backend_webgpu: requestedBackend === 'webgpu',
    active_backend_webgpu: activeBackend === 'webgpu',
    no_backend_fallback: evidence?.renderer?.fallback == null,
    realism_ready: realismStatus === REALISM_READY,
    provenance_verified: ['terrain', 'roads', 'buildings'].every((key) => verification?.[key] === VERIFICATION_PASS),
    zero_raw_source_runtime_calls: evidence?.world?.raw_source_runtime_calls === 0,
    streaming_lifecycle_strict_pass: evidence?.streaming?.strict_trace_validation?.ok === true,
    first_visible_metric_recorded: finitePositive(evidence?.timing_ms?.input_to_first_frame_ready_ms),
    measurement_window_complete: Number.isInteger(requestedFrames)
      && Number.isInteger(measuredFrames)
      && requestedFrames >= minMeasuredFrames
      && measuredFrames === requestedFrames,
    frame_gap_summary_recorded: completeTimingSummary(repeated?.frame_gap, measuredFrames),
    draw_cpu_summary_recorded: completeTimingSummary(repeated?.draw_cpu, measuredFrames),
    draw_calls_recorded: finitePositive(evidence?.renderer?.draw_calls_per_frame) || finitePositive(repeated?.draw_calls),
    gpu_buffers_recorded: Number.isInteger(Number(evidence?.renderer?.gpu_buffer_count)) && Number(evidence.renderer.gpu_buffer_count) > 0,
    gpu_buffer_bytes_recorded: finitePositive(evidence?.renderer?.gpu_buffer_payload_bytes),
    gpu_attachment_bytes_recorded: finitePositive(evidence?.renderer?.gpu_attachment_estimated_bytes),
    timestamp_query_capability_recorded: typeof evidence?.renderer?.timestamp_query_supported === 'boolean',
    graphics_profile_recorded: nonEmptyString(evidence?.renderer?.graphics_profile),
  };

  const failures = Object.entries(requirements)
    .filter(([, passed]) => !passed)
    .map(([requirement]) => requirement);

  return {
    schema: 'nwe.webgpu-milestone-evidence-assessment/0.1',
    status: failures.length === 0 ? 'READY_FOR_REVIEW' : 'INCOMPLETE',
    failures,
    requirements,
    observations: {
      viewer_commit_sha: viewerCommit,
      runtime_generated_from_commit: runtimeGeneratedFromCommit,
      backend: activeBackend || null,
      requested_backend: requestedBackend || null,
      graphics_profile: evidence?.renderer?.graphics_profile ?? null,
      realism_status: realismStatus,
      first_visible_ms: evidence?.timing_ms?.input_to_first_frame_ready_ms ?? null,
      measured_frames: Number.isFinite(measuredFrames) ? measuredFrames : null,
      frame_gap_p50_ms: repeated?.frame_gap?.p50_ms ?? null,
      frame_gap_p95_ms: repeated?.frame_gap?.p95_ms ?? null,
      draw_cpu_p50_ms: repeated?.draw_cpu?.p50_ms ?? null,
      draw_cpu_p95_ms: repeated?.draw_cpu?.p95_ms ?? null,
      draw_calls: repeated?.draw_calls ?? evidence?.renderer?.draw_calls_per_frame ?? null,
      gpu_buffer_count: evidence?.renderer?.gpu_buffer_count ?? null,
      gpu_buffer_payload_bytes: evidence?.renderer?.gpu_buffer_payload_bytes ?? null,
      gpu_attachment_estimated_bytes: evidence?.renderer?.gpu_attachment_estimated_bytes ?? null,
      timestamp_query_supported: evidence?.renderer?.timestamp_query_supported ?? null,
      operator_physical_device_attested: operatorPhysicalDeviceAttestation === true,
      browser_physical_device_attested: evidence?.capture?.physical_device_attested === true,
    },
    interpretation: 'READY_FOR_REVIEW means the capture is milestone-grade evidence, not that a performance target has been met. NWE intentionally does not invent an FPS/frame-time threshold here. The operator physical-device attestation is an explicit human/device-lab assertion because browser APIs cannot prove that the run was not emulated or headless. Final P0 closure still requires reviewing the recorded real-device metrics and visual behavior.',
  };
}
