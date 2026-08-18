export function createPreview1Renderer(options: any): {
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
  };
  invalidate(): void;
  dispose(): void;
};
