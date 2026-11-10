import assert from 'node:assert/strict';
import { drapeRoadOnTerrain } from './src/roadTerrainDrape.mjs';
const terrain = { positions: new Float32Array([0,0,0, 1,0,0, 0,0,1, 1,4,1]) };
const road = {positions:new Float32Array([0,-2,0, 0,-2,1, 1,-2,0, 1,-2,1]), uvs:new Float32Array([0,0,0,1,1,0,1,1]), indices:new Uint16Array([0,1,3,0,3,2]), metadata:{}};
const result = drapeRoadOnTerrain(road, terrain);
assert.ok(result.indices.length > road.indices.length);
for (let i=0; i<result.positions.length; i+=3) {
  const [x,y,z] = result.positions.slice(i,i+3);
  assert.ok(Math.abs(y-(Math.max(0,x+z-1)*4+0.06)) < 1e-6);
}
assert.deepEqual([...road.positions], [0,-2,0,0,-2,1,1,-2,0,1,-2,1]);
assert.equal(result.metadata.winding, 'upward-y');
for (let i = 0; i < result.indices.length; i += 3) {
  const ia = result.indices[i] * 3;
  const ib = result.indices[i + 1] * 3;
  const ic = result.indices[i + 2] * 3;
  const ax = result.positions[ia], az = result.positions[ia + 2];
  const bx = result.positions[ib], bz = result.positions[ib + 2];
  const cx = result.positions[ic], cz = result.positions[ic + 2];
  const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  assert.ok(crossY > 1e-10, `draped triangle must face upward; crossY=${crossY}`);
}

const relief = { ...road, vertex_lifts_m: new Float32Array([0, 0.012, 0.024, 0.036]) };
const drapedRelief = drapeRoadOnTerrain(relief, terrain);
assert.equal(drapedRelief.metadata.vertex_lift_semantics, 'interpolated-source-detail-lift');
for (let i = 0; i < drapedRelief.positions.length; i += 3) {
  const [x, y, z] = drapedRelief.positions.slice(i, i + 3);
  const expected = Math.max(0, x + z - 1) * 4 + 0.06 + 0.024 * x + 0.012 * z;
  assert.ok(Math.abs(y - expected) < 0.000002, `per-vertex relief lost at ${x},${z}`);
}
for (const invalid of [new Float32Array([0]), new Float32Array([0, -0.01, 0, 0])]) {
  assert.throws(() => drapeRoadOnTerrain({ ...road, vertex_lifts_m: invalid }, terrain), /ROAD_DRAPE_VERTEX_LIFT_INVALID/);
}
console.log('ROAD_TERRAIN_DRAPE_PASS');
