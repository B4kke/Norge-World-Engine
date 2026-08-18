export function createPreview1Renderer(options: any): Promise<{
  header: any;
  firstFrame: Promise<{
    at: number;
    drawGapMs: number | null;
    drawCpuMs: number;
    drawCalls: number;
    backend: 'webgpu' | 'webgl2';
    pixelRatio: number;
    camera: { yaw: number; pitch: number; distance: number };
  }>;
  stats: {
    terrain_vertices: number;
    terrain_triangles: number;
    road_paths: number;
    building_footprints: number;
    source_backed_building_heights: number;
    unresolved_building_heights: number;
    debug_road_width_m: number;
    debug_unresolved_building_height_m: number;
    backend: 'webgpu' | 'webgl2';
    graphics_profile: 'low' | 'balanced' | 'high' | string;
    max_dpr: number;
    pixel_ratio: number;
    msaa_samples: number | null;
    power_preference?: string;
    draw_calls_per_frame: number;
    gpu_buffer_count: number;
    gpu_buffer_payload_bytes: number;
    gpu_attachment_estimated_bytes?: number;
    timestamp_query_supported: boolean;
    timing_ms: {
      adapter_device_cpu_ms?: number;
      scene_build_cpu_ms: number;
      gpu_resource_apply_cpu_ms: number;
      renderer_init_cpu_ms: number;
    };
  };
  invalidate(): void;
  dispose(): void;
}>;
