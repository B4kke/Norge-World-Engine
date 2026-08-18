const RAW_SOURCE_MARKERS = ['kartverket.no', 'geonorge.no', 'vegvesen.no', 'nvdb', 'overpass', 'openstreetmap.org'];

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

function comparisonContext(evidence) {
  return stableObject({
    tile_id: evidence?.world?.tile_id ?? null,
    artifact_sha256: evidence?.world?.artifact_sha256 ?? null,
    verification: evidence?.world?.verification ?? null,
    graphics_profile: evidence?.renderer?.graphics_profile ?? null,
    camera: evidence?.renderer?.camera ?? null,
    render_surface: evidence?.renderer?.render_surface ?? null,
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
  for (const key of Object.keys(lhs)) {
    if (JSON.stringify(lhs[key]) !== JSON.stringify(rhs[key])) mismatches.push(key);
  }
  return {
    comparable: mismatches.length === 0,
    mismatches,
    left_backend: left.renderer?.active_backend ?? null,
    right_backend: right.renderer?.active_backend ?? null,
    context: lhs,
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

  const firstFrame = result.renderer?.first_frame ?? null;
  const camera = firstFrame?.camera ?? null;
  const rendererPixelRatio = finiteNumberOrNull(result.renderer?.pixel_ratio ?? firstFrame?.pixelRatio);

  return {
    schema: 'nwe.world-viewer-device-evidence/0.1',
    status: 'PASS',
    captured_at: capturedAt,
    evidence_class: 'interactive-browser-device',
    page_url: String(locationHref ?? ''),
    device: {
      user_agent: safeNavigatorValue(navigatorLike, 'userAgent'),
      platform: safeNavigatorValue(navigatorLike, 'platform'),
      hardware_concurrency: safeNavigatorValue(navigatorLike, 'hardwareConcurrency'),
      device_memory_gib: safeNavigatorValue(navigatorLike, 'deviceMemory'),
      language: safeNavigatorValue(navigatorLike, 'language'),
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
    renderer: {
      requested_backend: result.renderer_preference ?? null,
      active_backend: result.renderer?.backend ?? null,
      fallback: result.renderer?.fallback ?? null,
      graphics_profile: result.graphics_profile ?? null,
      draw_calls_per_frame: result.renderer?.draw_calls_per_frame ?? null,
      gpu_buffer_count: result.renderer?.gpu_buffer_count ?? null,
      gpu_buffer_payload_bytes: result.renderer?.gpu_buffer_payload_bytes ?? null,
      gpu_attachment_estimated_bytes: result.renderer?.gpu_attachment_estimated_bytes ?? null,
      timestamp_query_supported: result.renderer?.timestamp_query_supported ?? false,
      terrain_vertices: result.renderer?.terrain_vertices ?? null,
      terrain_triangles: result.renderer?.terrain_triangles ?? null,
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
    interpretation: 'Device evidence only. WebGL2/WebGPU timing is comparable only when compareDeviceEvidenceContext reports comparable=true; debug geometry remains non-authoritative.',
  };
}

export function evidenceFilename(evidence) {
  const backend = String(evidence?.renderer?.active_backend ?? 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const tile = String(evidence?.world?.tile_id ?? 'tile').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `nwe-device-evidence-${tile}-${backend}.json`;
}
