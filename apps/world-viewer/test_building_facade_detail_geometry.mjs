import assert from 'node:assert/strict';
import { buildBuildingFacadeDetailGeometry } from './src/buildingFacadeDetailGeometry.mjs';

const artifact = {
  features: [
    {
      building: 'house',
      height_m: 6.5,
      polygon: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]],
    },
    {
      building: 'garage',
      height_m: null,
      polygon: [[20, 0], [26, 0], [26, 6], [20, 6], [20, 0]],
    },
  ],
};

const geometry = buildBuildingFacadeDetailGeometry(artifact, {
  projectPoint: ([x, z]) => [x, 10, z],
  fallbackHeightMeters: 5,
});

assert.equal(geometry.metadata.schema, 'nwe.building-facade-render-geometry/0.1');
assert.equal(geometry.metadata.authority, 'renderer-only-procedural-facade-cues');
assert.equal(geometry.metadata.geometry_truth_changed, false);
assert.match(geometry.metadata.semantics, /not-observed-building-features/);
assert.equal(geometry.metadata.source_backed_building_count, 1);
assert.equal(geometry.metadata.fallback_building_count, 1);
assert.equal(geometry.metadata.buildings_decorated, 2);
assert.ok(geometry.metadata.window_count >= 8, 'house should receive multiple batched window cues');
assert.equal(geometry.metadata.entry_door_count, 1, 'house should receive one entry cue');
assert.equal(geometry.metadata.large_door_count, 1, 'garage should receive one large door cue');
assert.equal(geometry.windows.indices.length, geometry.metadata.window_count * 6, 'every window is one two-triangle quad');
assert.equal(geometry.doors.indices.length, (geometry.metadata.entry_door_count + geometry.metadata.large_door_count) * 6, 'every door is one two-triangle quad');
assert.equal(geometry.windows.uvs.length, (geometry.windows.positions.length / 3) * 2);
assert.equal(geometry.doors.uvs.length, (geometry.doors.positions.length / 3) * 2);
for (const value of [...geometry.windows.positions, ...geometry.doors.positions]) assert.ok(Number.isFinite(value));

// First house edge lies on z=0. Facade cues must sit slightly outside the wall plane
// rather than coplanar with it, otherwise exact WebGL/WebGPU will z-fight.
const firstWindowZ = geometry.windows.positions[2];
assert.ok(Math.abs(firstWindowZ) >= 0.03, `window plane should be offset from wall, got z=${firstWindowZ}`);

assert.throws(() => buildBuildingFacadeDetailGeometry(artifact, {}), /projectPoint/);
assert.throws(() => buildBuildingFacadeDetailGeometry(artifact, { projectPoint: () => [0, 0, 0], surfaceOffsetMeters: 0 }), /surfaceOffsetMeters/);

console.log('BUILDING_FACADE_DETAIL_GEOMETRY_PASS');
