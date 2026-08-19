import assert from 'node:assert/strict';
import {
  createWorldFrame,
  createWorldPosition,
  createTileFrame,
} from './world_contract.mjs';
import { createPhysicsSpatialFrame } from './physics_state_contract.mjs';
import {
  StaticCollisionContractError,
  createStaticCollisionBinding,
  assertStaticCollisionBinding,
  tileCollisionPointToPhysicsLocal64,
  physicsLocal64ToWorldCollisionPoint,
  parseStaticCollisionBinding,
} from './static_collision_contract.mjs';

const worldFrame = createWorldFrame({
  id: 'world:nannestad-static-collision-test',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});
const tileFrame = createTileFrame({
  tileId: 'nannestad:618000:6690000:1000',
  worldFrame,
  anchorWorld: createWorldPosition(worldFrame, { easting: 618000, northing: 6690000, height: 180 }),
});
const physicsFrame0 = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:island-a',
  worldFrame,
  epoch: 0,
  anchorWorld: createWorldPosition(worldFrame, { easting: 618125.25, northing: 6690400.5, height: 175 }),
});
const physicsFrame1 = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:island-a',
  worldFrame,
  epoch: 1,
  anchorWorld: createWorldPosition(worldFrame, { easting: 619125.375, northing: 6689650.125, height: 175 }),
});
const artifactSha256 = 'a'.repeat(64);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}
function expectCode(code, fn) {
  assert.throws(fn, (error) => error instanceof StaticCollisionContractError && error.code === code);
}

const binding0 = createStaticCollisionBinding({
  collisionId: 'terrain-collision:center', artifactSha256, worldFrame, tileFrame, physicsFrame: physicsFrame0,
});

test('binding keeps horizontal CRS and vertical datum explicit and separate', () => {
  assert.equal(binding0.worldFrame.horizontalCrs, 'EPSG:25832');
  assert.equal(binding0.worldFrame.verticalDatum, 'NN2000');
  assert.notEqual(binding0.worldFrame.horizontalCrs, binding0.worldFrame.verticalDatum);
});

test('tile-local collision point reconstructs identical world point across physics epochs', () => {
  const tileLocal = { east: 432.125, north: 721.875, up: 13.625 };
  const local0 = tileCollisionPointToPhysicsLocal64({ worldFrame, tileFrame, physicsFrame: physicsFrame0, tileLocal });
  const local1 = tileCollisionPointToPhysicsLocal64({ worldFrame, tileFrame, physicsFrame: physicsFrame1, tileLocal });
  const world0 = physicsLocal64ToWorldCollisionPoint({ worldFrame, physicsFrame: physicsFrame0, localPosition: local0 });
  const world1 = physicsLocal64ToWorldCollisionPoint({ worldFrame, physicsFrame: physicsFrame1, localPosition: local1 });
  assert.deepEqual(world0, world1);
  assert.equal(world0.easting, 618432.125);
  assert.equal(world0.northing, 6690721.875);
  assert.equal(world0.height, 193.625);
});

test('binding is epoch-specific and stale static collider state fails closed', () => {
  expectCode('PHYSICS_EPOCH_MISMATCH', () => assertStaticCollisionBinding({
    binding: binding0, worldFrame, tileFrame, physicsFrame: physicsFrame1,
  }));
});

test('foreign runtime tile identity fails closed', () => {
  const otherTile = createTileFrame({
    tileId: 'nannestad:619000:6690000:1000',
    worldFrame,
    anchorWorld: tileFrame.anchorWorld,
  });
  expectCode('TILE_ID_MISMATCH', () => assertStaticCollisionBinding({
    binding: binding0, worldFrame, tileFrame: otherTile, physicsFrame: physicsFrame0,
  }));
});

test('foreign world frame fails closed', () => {
  const foreignWorld = createWorldFrame({ id: 'world:foreign', horizontalCrs: 'EPSG:25833', verticalDatum: 'NN2000' });
  expectCode('WORLD_FRAME_MISMATCH', () => createStaticCollisionBinding({
    collisionId: 'bad', artifactSha256, worldFrame: foreignWorld, tileFrame, physicsFrame: physicsFrame0,
  }));
});

test('invalid artifact identity fails closed', () => {
  expectCode('INVALID_ARTIFACT_SHA256', () => createStaticCollisionBinding({
    collisionId: 'bad', artifactSha256: 'not-a-sha', worldFrame, tileFrame, physicsFrame: physicsFrame0,
  }));
});

test('serialized binding document rejects render-origin leakage', () => {
  const document = {
    schema: binding0.schema,
    collisionId: binding0.collisionId,
    artifactSha256: binding0.artifactSha256,
    tileId: binding0.tileId,
    worldFrame: binding0.worldFrame,
    physicsFrame: binding0.physicsFrame,
    tileAnchorWorld: binding0.tileAnchorWorld,
    physicsAnchorWorld: binding0.physicsAnchorWorld,
    renderOriginEpoch: 99,
  };
  expectCode('UNEXPECTED_FIELD', () => parseStaticCollisionBinding(document));
});

test('serialized binding document rejects conflated vertical metadata', () => {
  const document = {
    schema: binding0.schema,
    collisionId: binding0.collisionId,
    artifactSha256: binding0.artifactSha256,
    tileId: binding0.tileId,
    worldFrame: { ...binding0.worldFrame, verticalDatum: '' },
    physicsFrame: binding0.physicsFrame,
    tileAnchorWorld: binding0.tileAnchorWorld,
    physicsAnchorWorld: binding0.physicsAnchorWorld,
  };
  expectCode('INVALID_IDENTITY', () => parseStaticCollisionBinding(document));
});

console.log(JSON.stringify({ status: 'ATLAS_STATIC_COLLISION_CONTRACT_PASS', passed, total: 8 }));
