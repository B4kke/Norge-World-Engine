import assert from 'node:assert/strict';
import { enrichRoadsForWeb } from './src/preview1Renderer.mjs';
import { buildRoadSurfaceGeometry } from './src/roadSurfaceGeometry.mjs';

const base = {
  schema: 'nwe.road-network-artifact/0.1',
  paths: [
    { path_id: 'base-1', points: [[0, 0, 100], [10, 0, 100]] },
    { path_id: 'base-2', points: [[0, 10, 100], [10, 10, 100]] },
  ],
};
const realism = {
  stats: { width_range_m: [5.75, 8.98], surface_material_counts: { Asfaltbetong: 4 } },
  policy: { truth_guard: 'no inferred width or surface type is promoted as source truth' },
  width_features: [
    {
      source_type_id: 838,
      source_object_id: 123,
      part_index: 0,
      width_m: 7.2,
      priority: 'primary-838',
      locations: [{ sequence_id: 77 }],
      points: [[0, 0, null], [10, 0, null]],
    },
  ],
};

const enriched = enrichRoadsForWeb(base, realism);
assert.equal(enriched.paths.length, 3);
assert.equal(enriched.web_realism.base_path_count, 2);
assert.equal(enriched.web_realism.source_width_overlay_count, 1);
assert.deepEqual(enriched.web_realism.source_width_range_m, [5.75, 8.98]);
assert.equal(enriched.paths[2].width_m, 7.2);
assert.equal(enriched.paths[2].surface_lift_m, 0.005);
assert.deepEqual(enriched.paths[2].source_sequence_ids, [77]);
assert.match(enriched.paths[2].width_source, /NVDB-838/);
assert.match(enriched.web_realism.fallback_semantics, /3\.2m/);

const geometry = buildRoadSurfaceGeometry(enriched, {
  projectPoint: ([x, z, sourceZ]) => [x, sourceZ == null ? 50 : sourceZ, z],
  widthMeters: 3.2,
});
assert.equal(geometry.metadata.path_count, 3);
assert.equal(geometry.metadata.fallback_width_path_count, 2);
assert.equal(geometry.metadata.source_width_path_count, 1);
assert.equal(geometry.metadata.lifted_overlay_path_count, 1);
assert.deepEqual(geometry.metadata.width_range_m, [3.2, 7.2]);
assert.equal(geometry.metadata.width_semantics, 'source-backed-when-present-otherwise-renderer-fallback');

// Third path begins after 8 base vertices. Its first edge must sit 5 mm above the sampled base plane.
const overlayVertexOffset = 8 * 3;
assert.ok(Math.abs(geometry.positions[overlayVertexOffset + 1] - 50.005) < 1e-4);

assert.strictEqual(enrichRoadsForWeb(base, null), base, 'missing road realism must leave accepted artifact untouched');

console.log('ROAD_REALISM_OVERLAY_PASS');
