import assert from 'node:assert/strict';
import { buildVectorBenchmarkGeometry, traceVisibleObjectAtWorld, worldFromCanvas } from './benchmark/geometry.mjs';

const roads = {
  schema: 'nwe.road-network-artifact/0.1',
  tile_id: 'epsg25832_test',
  paths: [
    { path_id: 'road-a', road_type: 'test', source_segment_ids: ['seg-a'], source_sequence_ids: [1], length_m: 100, points: [[611100,6677100,10],[611200,6677100,11],[611300,6677100,12]] },
    { path_id: 'road-b', road_type: 'test', source_segment_ids: ['seg-b'], source_sequence_ids: [2], length_m: 50, points: [[611400,6677200,null],[611450,6677250,null]] },
  ],
};
const buildings = {
  schema: 'nwe.building-footprint-artifact/0.1',
  tile_id: 'epsg25832_test',
  features: [
    { source_id: 'building-1', polygon: [[611500,6677500],[611550,6677500],[611550,6677550],[611500,6677550],[611500,6677500]], area_m2: 2500, height_m: 8, height_source: 'height', clipped: false, building: 'yes' },
    { source_id: 'building-2', polygon: [[611650,6677600],[611700,6677600],[611700,6677650],[611650,6677650]], area_m2: 2500, height_m: null, height_source: null, clipped: false, building: 'yes' },
  ],
};

const geometry = buildVectorBenchmarkGeometry(roads, buildings);
assert.equal(geometry.objectCounts.road_paths, 2);
assert.equal(geometry.objectCounts.building_footprints, 2);
assert.equal(geometry.objectCounts.total_objects, 4);
assert.equal(geometry.objectCounts.source_backed_building_heights, 1);
assert.equal(geometry.objectCounts.unresolved_building_heights, 1);
assert.equal(geometry.roadRanges.length, 2);
assert.equal(geometry.buildingRanges.length, 2);
assert.deepEqual([...geometry.roadPositions.slice(0, 6)], [100,100,10,200,100,11]);
assert.equal(traceVisibleObjectAtWorld(geometry, 611525, 6677525)?.source_id, 'building-1');
assert.equal(traceVisibleObjectAtWorld(geometry, 611250, 6677102, 5)?.path_id, 'road-a');
assert.equal(traceVisibleObjectAtWorld(geometry, 611900, 6677900), null);
assert.deepEqual(worldFromCanvas(50, 50, { left: 0, top: 0, width: 100, height: 100 }), { x: 611500, y: 6677500 });
assert.equal(geometry.buildingDebug[1].height_render_semantics, 'UNRESOLVED_NO_DEBUG_EXTRUSION');

console.log(JSON.stringify({ status: 'PASS', cases: 10, per_object_draws: geometry.objectCounts.total_objects, batched_vector_draws: 2 }));
