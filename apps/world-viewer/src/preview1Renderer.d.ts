export function createPreview1Renderer(options: any): Promise<{
  header: any;
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
  };
  invalidate(): void;
  dispose(): void;
}>;
