const RAW_SOURCE_MARKERS = ['kartverket.no', 'geonorge.no', 'vegvesen.no', 'nvdb', 'overpass', 'openstreetmap.org'];
const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';

export function isRawSourceRuntimeUrl(url) {
  const lower = String(url).toLowerCase();
  return RAW_SOURCE_MARKERS.some((marker) => lower.includes(marker));
}

function safeNavigatorValue(navigatorLike, key) {
  const value = navigatorLike?.[key];
  return value === undefined ? null : value;
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
  }
  return value;
}

function normalizedBuildIdentity(buildIdentity = {}) {
  return {
    git_commit_sha: typeof buildIdentity?.git_commit_sha === 'string' && buildIdentity.git_commit_sha.length ? buildIdentity.git_commit_sha : null,
    deployment_id: typeof buildIdentity?.deployment_id === 'string' && buildIdentity.deployment_id.length ? buildIdentity.deployment_id : null,
  };
}

function normalizedCaptureSessionId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{8,128}$/.test(value) ? value : null;
}

function stableLifecycleCheckpoint(checkpoint) {
  return checkpoint ? {
    label: checkpoint.label ?? null,
    active: checkpoint.active === true,
    creates: finiteNumberOrNull(checkpoint.creates),
    destroys: finiteNumberOrNull(checkpoint.destroys),
    current_buffer_count: finiteNumberOrNull(checkpoint.current_buffer_count),
    current_payload_bytes: finiteNumberOrNull(checkpoint.current_payload_bytes),
    physical_vram_release_observed: checkpoint.physical_vram_release_observed === true,
  } : null;
}

function streamingComparisonContract(streaming) {
  const probe = streaming?.movement_probe ?? null;
  const trace = streaming?.trace ?? null;
  return stableObject({
    movement_probe: probe ? {
      schema: probe.schema ?? null,
      status: probe.status ?? null,
      path: probe.path ?? null,
      tile_id: probe.tile_id ?? null,
      movement_offset_e_m: finiteNumberOrNull(probe.movement_offset_e_m),
      active_radius_m: finiteNumberOrNull(probe.active_radius_m),
      retain_radius_m: finiteNumberOrNull(probe.retain_radius_m),
      checkpoints: Array.isArray(probe.checkpoints) ? [...probe.checkpoints] : null,
      resolver_calls_before: finiteNumberOrNull(probe.resolver_calls_before),
      resolver_calls_after: finiteNumberOrNull(probe.resolver_calls_after),
      loads_started_delta: finiteNumberOrNull(probe.loads_started_delta),
      cache_hits_delta: finiteNumberOrNull(probe.cache_hits_delta),
      renderer_resource_lifecycle_observed: probe.renderer_resource_lifecycle_observed === true,
      renderer_resource_checkpoints: Array.isArray(probe.renderer_resource_checkpoints)
        ? probe.renderer_resource_checkpoints.map(stableLifecycleCheckpoint)
        : null,
      renderer_resource_creates_delta: finiteNumberOrNull(probe.renderer_resource_creates_delta),
      renderer_resource_destroys_delta: finiteNumberOrNull(probe.renderer_resource_destroys_delta),
      physical_vram_release_observed: probe.physical_vram_release_observed === true,
    } : null,
    trace: trace ? {
      schema: trace.schema ?? null,
      max_entries: finiteNumberOrNull(trace.maxEntries),
      dropped_entries: finiteNumberOrNull(trace.droppedEntries),
      probe_id: trace.metadata?.probe_id ?? null,
      movement_probe_enabled: trace.metadata?.movement_probe_enabled === true,
      active_radius_m: finiteNumberOrNull(trace.metadata?.active_radius_m),
      retain_radius_m: finiteNumberOrNull(trace.metadata?.retain_radius_m),
      movement_offset_e_m: finiteNumberOrNull(trace.metadata?.movement_offset_e_m),
      renderer_resource_lifecycle_observed: trace.metadata?.renderer_resource_lifecycle_observed === true,
      physical_vram_release_observed: trace.metadata?.physical_vram_release_observed === true,
    } : null,
  });
}

function validateRendererLifecycleProbe(movementProbe, streamingTrace, rendererResult, expectedTileId, expectedArtifactSha) {
  if (!expectedTileId || movementProbe.tile_id !== expectedTileId) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_MOVEMENT_TILE_MISMATCH');
  }
  if (!expectedArtifactSha) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_TERRAIN_ARTIFACT_MISSING');
  }
  if (movementProbe.renderer_resource_lifecycle_observed !== true) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_LIFECYCLE_MISSING');
  }
  if (movementProbe.physical_vram_release_observed !== false) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_VRAM_CLAIM_INVALID');
  }
  if (movementProbe.renderer_resource_creates_delta !== 1 || movementProbe.renderer_resource_destroys_delta !== 1) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_LIFECYCLE_COUNTS');
  }
  const checkpoints = Array.isArray(movementProbe.renderer_resource_checkpoints)
    ? movementProbe.renderer_resource_checkpoints
    : [];
  if (checkpoints.length !== 3) throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_CHECKPOINTS_MISSING');
  const byLabel = Object.fromEntries(checkpoints.map((checkpoint) => [checkpoint?.label, checkpoint]));
  const initial = byLabel['initial-resident'];
  const cached = byLabel['outside-active-inside-retain'];
  const returned = byLabel['returned-center'];
  if (!initial || initial.active !== true || initial.current_buffer_count !== 3 || !(initial.current_payload_bytes > 0)) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_INITIAL_INVALID');
  }
  if (!cached || cached.active !== false || cached.current_buffer_count !== 0 || cached.current_payload_bytes !== 0) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_CACHED_INVALID');
  }
  if (!returned || returned.active !== true || returned.current_buffer_count !== 3 || !(returned.current_payload_bytes > 0)) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_RETURN_INVALID');
  }
  if ([initial, cached, returned].some((checkpoint) => checkpoint.tile_id !== expectedTileId)) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_TILE_MISMATCH');
  }
  if ([initial, cached, returned].some((checkpoint) => checkpoint.artifact_sha256 !== expectedArtifactSha)) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_ARTIFACT_MISMATCH');
  }
  const backend = rendererResult?.backend ?? null;
  if (!backend || movementProbe.renderer_backend !== backend || [initial, cached, returned].some((checkpoint) => checkpoint.backend !== backend)) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_BACKEND_MISMATCH');
  }
  if ([initial, cached, returned].some((checkpoint) => checkpoint.physical_vram_release_observed !== false)) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_VRAM_CHECKPOINT_INVALID');
  }
  const finalLifecycle = rendererResult?.terrain_resource_lifecycle;
  if (!finalLifecycle || finalLifecycle.schema !== TERRAIN_RESOURCE_SCHEMA || finalLifecycle.active !== true) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_FINAL_STATE_INVALID');
  }
  if (finalLifecycle.tile_id !== expectedTileId || finalLifecycle.artifact_sha256 !== expectedArtifactSha || finalLifecycle.backend !== backend) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_FINAL_IDENTITY_INVALID');
  }
  if (finalLifecycle.physical_vram_release_observed !== false) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_RENDERER_FINAL_VRAM_CLAIM_INVALID');
  }
  if (streamingTrace?.metadata?.renderer_resource_lifecycle_observed !== true) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_TRACE_RENDERER_LIFECYCLE_MISSING');
  }
  if (streamingTrace?.metadata?.physical_vram_release_observed !== false) {
    throw new Error('DEVICE_EVIDENCE_STREAMING_TRACE_VRAM_CLAIM_INVALID');
  }
}

export function classifyBrowserEnvironment(navigatorLike = {}) {
  const userAgent = String(navigatorLike?.userAgent ?? '');
  const uaData = navigatorLike?.userAgentData ?? null;
  const uaPlatform = typeof uaData?.platform === 'string' ? uaData.platform : null;
  const uaMobile = typeof uaData?.mobile === 'boolean' ? uaData.mobile : null;
  const brands = Array.isArray(uaData?.brands)
    ? uaData.brands.map((item) => String(item?.brand ?? '')).filter(Boolean).sort()
    : [];
  const android = /android/i.test(uaPlatform ?? '') || /android/i.test(userAgent);
  const explicitChromeBrand = brands.some((brand) => /google chrome/i.test(brand));
  const chromeUa = /(?:chrome|crios)\//i.test(userAgent)
    && !/(?:edga|edgios|opr|opera|samsungbrowser)\//i.test(userAgent);
  const chromiumFamily = brands.length > 0 ? explicitChromeBrand : chromeUa;
  const androidChrome = android && chromiumFamily && uaMobile !== false;
  return {
    user_agent_data_mobile: uaMobile,
    user_agent_data_platform: uaPlatform,
    user_agent_data_brands: brands,
    inferred_android: android,
    inferred_chromium_family: chromiumFamily,
    inferred_android_chrome: androidChrome,
    physical_device_attested: false,
  };
}

function comparisonContext(evidence) {
  return stableObject({
    build: {
      git_commit_sha: evidence?.build?.git_commit_sha ?? null,
    },
    capture: {
      session_id: evidence?.capture?.session_id ?? null,
      target: evidence?.capture?.target ?? null,
    },
    tile_id: evidence?.world?.tile_id ?? null,
    artifact_sha256: evidence?.world?.artifact_sha256 ?? null,
    verification: evidence?.world?.verification ?? null,
    streaming: evidence?.streaming?.comparison_contract ?? null,
    graphics_profile: evidence?.renderer?.graphics_profile ?? null,
    renderer_workload: {
      max_dpr: evidence?.renderer?.max_dpr ?? null,
      msaa_samples: evidence?.renderer?.msaa_samples ?? null,
      power_preference: evidence?.renderer?.power_preference ?? null,
    },
    camera: evidence?.renderer?.camera ?? null,
    render_surface: evidence?.renderer?.render_surface ?? null,
    measurement_window: {
      requested_frames: evidence?.timing_ms?.repeated_draw?.requested_frames ?? null,
      measured_frames: evidence?.timing_ms?.repeated_draw?.measured_frames ?? null,
    },
    device: evidence?.device ?? null,
  });
}

export function compareDeviceEvidenceContext(left, right) {
  if (left?.schema !== 'nwe.world-viewer-device-evidence/0.1' || left?.status !== 'PASS') {
    throw new Error('DEVICE_EVIDENCE_COMPARE_LEFT_INVALID');
  }
  if (right?.schema !== 'nwe.world-viewer-device-evidence/0.1' || right?.status !== 'PASS') {
    throw new Error('DEVICE_EVIDENCE_COMPARE_RIGHT_INVALID');
  }

  const lhs = comparisonContext(left);
  const rhs = comparisonContext(right);
  const mismatches = [];
  if (!lhs.build.git_commit_sha || !rhs.build.git_commit_sha) mismatches.push('build_identity_missing');
  if (!lhs.capture.session_id || !rhs.capture.session_id) mismatches.push('capture_session_missing');
  for (const key of Object.keys(lhs)) {
    if (JSON.stringify(lhs[key]) !== JSON.stringify(rhs[key])) mismatches.push(key);
  }
  return {
    comparable: mismatches.length === 0,
    mismatches,
    left_backend: left.renderer?.active_backend ?? null,
    right_backend: right.renderer?.active_backend ?? null,
    context: lhs,
    physical_device_attested: false,
  };
}

export function buildDeviceEvidence({
  result,
  runtimeRequests,
  locationHref,
  navigatorLike = {},
  screenLike = {},
  canvasLike = {},
  devicePixelRatioLike = globalThis.devicePixelRatio,
  buildIdentity = {},
  captureSessionId = null,
  evidenceTarget = 'generic-browser',
  capturedAt = new Date().toISOString(),
}) {
  if (!result || result.schema !== 'nwe.world-preview-runtime/0.1' || result.status !== 'PASS') {
    throw new Error('DEVICE_EVIDENCE_RUNTIME_RESULT_INVALID');
  }
  const requests = Array.isArray(runtimeRequests) ? [...runtimeRequests] : [];
  const rawCalls = requests.filter(isRawSourceRuntimeUrl);
  const artifacts = {
    terrain: result.terrain?.artifact_sha256 ?? null,
    roads: result.roads?.artifact_sha256 ?? null,
    buildings: result.buildings?.artifact_sha256 ?? null,
  };
  const verification = {
    terrain: result.terrain?.verification_code ?? null,
    roads: result.roads?.verification_code ?? null,
    buildings: result.buildings?.verification_code ?? null,
  };
  if (Object.values(verification).some((code) => code !== 'RUNTIME_VERIFICATION_PASS')) {
    throw new Error(`DEVICE_EVIDENCE_PROVENANCE_NOT_READY: ${JSON.stringify(verification)}`);
  }
  if (rawCalls.length) throw new Error(`DEVICE_EVIDENCE_RAW_SOURCE_CALL: ${rawCalls[0]}`);

  const movementProbe = result.terrain?.movement_probe ?? null;
  const streamingTrace = result.terrain?.streaming_trace ?? null;
  if (movementProbe != null) {
    if (movementProbe.schema !== 'nwe.single-tile-streaming-movement-probe/0.1' || movementProbe.status !== 'PASS') {
      throw new Error('DEVICE_EVIDENCE_STREAMING_MOVEMENT_INVALID');
    }
    if (streamingTrace?.schema !== 'nwe.streaming-movement-trace/0.1') {
      throw new Error('DEVICE_EVIDENCE_STREAMING_TRACE_MISSING');
    }
    validateRendererLifecycleProbe(
      movementProbe,
      streamingTrace,
      result.renderer,
      result.tile_id ?? null,
      result.terrain?.artifact_sha256 ?? null,
    );
  }
  if (streamingTrace != null) {
    if (streamingTrace.schema !== 'nwe.streaming-movement-trace/0.1') {
      throw new Error('DEVICE_EVIDENCE_STREAMING_TRACE_INVALID');
    }
    if (!Number.isInteger(streamingTrace.droppedEntries) || streamingTrace.droppedEntries !== 0) {
      throw new Error(`DEVICE_EVIDENCE_STREAMING_TRACE_INCOMPLETE: ${streamingTrace.droppedEntries}`);
    }
  }
  const streaming = movementProbe || streamingTrace ? {
    movement_probe: movementProbe,
    trace: streamingTrace,
  } : null;
  if (streaming) streaming.comparison_contract = streamingComparisonContract(streaming);

  const normalizedTarget = evidenceTarget === 'android-chrome' ? 'android-chrome' : 'generic-browser';
  const browserEnvironment = classifyBrowserEnvironment(navigatorLike);
  if (normalizedTarget === 'android-chrome' && !browserEnvironment.inferred_android_chrome) {
    throw new Error('DEVICE_EVIDENCE_TARGET_MISMATCH_ANDROID_CHROME');
  }

  const firstFrame = result.renderer?.first_frame ?? null;
  const camera = firstFrame?.camera ?? null;
  const rendererPixelRatio = finiteNumberOrNull(result.renderer?.pixel_ratio ?? firstFrame?.pixelRatio);

  return {
    schema: 'nwe.world-viewer-device-evidence/0.1',
    status: 'PASS',
    captured_at: capturedAt,
    evidence_class: normalizedTarget === 'android-chrome' ? 'android-chrome-browser-capture' : 'interactive-browser-device',
    page_url: String(locationHref ?? ''),
    build: normalizedBuildIdentity(buildIdentity),
    capture: {
      target: normalizedTarget,
      session_id: normalizedCaptureSessionId(captureSessionId),
      physical_device_attested: false,
    },
    device: {
      user_agent: safeNavigatorValue(navigatorLike, 'userAgent'),
      platform: safeNavigatorValue(navigatorLike, 'platform'),
      hardware_concurrency: safeNavigatorValue(navigatorLike, 'hardwareConcurrency'),
      device_memory_gib: safeNavigatorValue(navigatorLike, 'deviceMemory'),
      language: safeNavigatorValue(navigatorLike, 'language'),
      browser_environment: browserEnvironment,
      screen_css_px: {
        width: finiteNumberOrNull(screenLike?.width),
        height: finiteNumberOrNull(screenLike?.height),
      },
      device_pixel_ratio: finiteNumberOrNull(devicePixelRatioLike),
    },
    world: {
      manifest_url: result.manifestUrl ?? null,
      tile_id: result.tile_id ?? null,
      artifact_sha256: artifacts,
      verification,
      runtime_request_count: requests.length,
      raw_source_runtime_calls: 0,
    },
    streaming,
    renderer: {
      requested_backend: result.renderer_preference ?? null,
      active_backend: result.renderer?.backend ?? null,
      fallback: result.renderer?.fallback ?? null,
      graphics_profile: result.graphics_profile ?? null,
      webgpu_feature_level: result.renderer?.webgpu_feature_level ?? null,
      webgpu_adapter_request_mode: result.renderer?.webgpu_adapter_request_mode ?? result.renderer?.webgpu_feature_level ?? null,
      webgpu_core_features_and_limits: result.renderer?.webgpu_core_features_and_limits ?? null,
      max_dpr: finiteNumberOrNull(result.renderer?.max_dpr),
      msaa_samples: finiteNumberOrNull(result.renderer?.msaa_samples),
      power_preference: result.renderer?.power_preference ?? null,
      draw_calls_per_frame: result.renderer?.draw_calls_per_frame ?? null,
      gpu_buffer_count: result.renderer?.gpu_buffer_count ?? null,
      gpu_buffer_payload_bytes: result.renderer?.gpu_buffer_payload_bytes ?? null,
      gpu_attachment_estimated_bytes: result.renderer?.gpu_attachment_estimated_bytes ?? null,
      timestamp_query_supported: result.renderer?.timestamp_query_supported ?? false,
      terrain_vertices: result.renderer?.terrain_vertices ?? null,
      terrain_triangles: result.renderer?.terrain_triangles ?? null,
      terrain_resource_lifecycle: result.renderer?.terrain_resource_lifecycle ?? null,
      camera: camera ? {
        yaw: finiteNumberOrNull(camera.yaw),
        pitch: finiteNumberOrNull(camera.pitch),
        distance: finiteNumberOrNull(camera.distance),
      } : null,
      render_surface: {
        css_px: {
          width: finiteNumberOrNull(canvasLike?.clientWidth),
          height: finiteNumberOrNull(canvasLike?.clientHeight),
        },
        backing_px: {
          width: finiteNumberOrNull(canvasLike?.width),
          height: finiteNumberOrNull(canvasLike?.height),
        },
        pixel_ratio: rendererPixelRatio,
      },
    },
    timing_ms: {
      input_to_first_frame_ready_ms: result.timing_ms?.input_to_first_frame_ready_ms ?? null,
      startup_raf_gap: result.timing_ms?.startup_raf_gap ?? null,
      repeated_draw: result.timing_ms?.renderer_frame_benchmark ?? null,
      terrain_pipeline: result.terrain?.timing_ms ?? null,
      renderer: result.renderer?.timing_ms ?? null,
      terrain_resource_lifecycle: movementProbe?.renderer_resource_timing_ms ?? null,
    },
    memory: {
      browser: result.browser_memory ?? null,
      retained_terrain_bytes: result.terrain?.retained_bytes ?? null,
    },
    geometry: {
      road_paths: result.roads?.count ?? null,
      building_footprints: result.buildings?.count ?? null,
      source_backed_building_heights: result.renderer?.source_backed_building_heights ?? null,
      unresolved_building_heights: result.renderer?.unresolved_building_heights ?? null,
    },
    interpretation: 'Browser evidence cannot attest physical device identity. WebGL2/WebGPU timing is comparable only when compareDeviceEvidenceContext reports comparable=true; comparison requires the same capture session, viewer commit, measurement window, accepted artifacts, stable streaming/resource-lifecycle contract, camera, render workload/surface and exposed device/browser context. The single-tile movement probe proves resident→cached→resident runtime/cache behavior with no refetch and observes renderer terrain resource objects present→absent→present across the same transition. This does not observe when the browser/driver physically reclaims VRAM. The android-chrome target validates browser signals only; operator/device-lab evidence is still required to claim the same physical phone. Debug geometry remains non-authoritative.',
  };
}

export function evidenceFilename(evidence) {
  const backend = String(evidence?.renderer?.active_backend ?? 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const tile = String(evidence?.world?.tile_id ?? 'tile').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const commit = String(evidence?.build?.git_commit_sha ?? 'unbound').slice(0, 12).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const session = String(evidence?.capture?.session_id ?? 'nosession').slice(0, 16).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `nwe-device-evidence-${tile}-${backend}-${commit}-${session}.json`;
}