const RAW_SOURCE_MARKERS = ['kartverket.no', 'geonorge.no', 'vegvesen.no', 'nvdb', 'overpass', 'openstreetmap.org'];

export function isRawSourceRuntimeUrl(url) {
  const lower = String(url).toLowerCase();
  return RAW_SOURCE_MARKERS.some((marker) => lower.includes(marker));
}

function safeNavigatorValue(navigatorLike, key) {
  const value = navigatorLike?.[key];
  return value === undefined ? null : value;
}

export function buildDeviceEvidence({ result, runtimeRequests, locationHref, navigatorLike = {}, screenLike = {}, capturedAt = new Date().toISOString() }) {
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
        width: Number.isFinite(screenLike?.width) ? Number(screenLike.width) : null,
        height: Number.isFinite(screenLike?.height) ? Number(screenLike.height) : null,
      },
      device_pixel_ratio: Number.isFinite(globalThis.devicePixelRatio) ? Number(globalThis.devicePixelRatio) : null,
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
    interpretation: 'Device evidence only. Compare renderer backends only when artifact hashes, camera contract, graphics profile and device are held constant; do not promote debug geometry to world truth.',
  };
}

export function evidenceFilename(evidence) {
  const backend = String(evidence?.renderer?.active_backend ?? 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const tile = String(evidence?.world?.tile_id ?? 'tile').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `nwe-device-evidence-${tile}-${backend}.json`;
}
