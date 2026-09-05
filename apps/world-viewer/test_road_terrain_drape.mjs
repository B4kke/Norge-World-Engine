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
console.log('ROAD_TERRAIN_DRAPE_PASS');
