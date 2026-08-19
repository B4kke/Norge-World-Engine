import assert from 'node:assert/strict';
import {
  createStaticCollisionOccupancySnapshot,
  deriveStaticCollisionDependencies,
  STATIC_COLLISION_OCCUPANCY_PHASE,
  STATIC_COLLISION_OCCUPANCY_SCHEMA,
} from './static_collision_occupancy_contract.mjs';
import { createStaticCollisionLifecycleState } from './static_collision_lifecycle_contract.mjs';
import { createStaticCollisionStreamingGuard } from './static_collision_streaming_guard.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const frame = Object.freeze({ physicsFrameId: 'physics:nannestad', epoch: 4 });
const state = createStaticCollisionLifecycleState({
  worldFrameId: 'world:nannestad',
  physicsFrameId: frame.physicsFrameId,
  physicsEpoch: frame.epoch,
  collisions: [
    { collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: A, dependentEntityIds: [] },
    { collisionId: 'collision:b', tileId: 'tile:b', artifactSha256: B, dependentEntityIds: [] },
  ],
});

function snapshot(contacts, overrides = {}) {
  return {
    schema: STATIC_COLLISION_OCCUPANCY_SCHEMA,
    phase: STATIC_COLLISION_OCCUPANCY_PHASE,
    tick: 120,
    worldFrameId: state.worldFrameId,
    physicsFrame: frame,
    contacts,
    ...overrides,
  };
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await check('canonical contact order yields deterministic dependency sets', async () => {
  const contacts = [
    { entityId: 'entity:2', collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: A },
    { entityId: 'entity:1', collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: A },
    { entityId: 'entity:3', collisionId: 'collision:b', tileId: 'tile:b', artifactSha256: B },
  ];
  const left = createStaticCollisionOccupancySnapshot(snapshot(contacts));
  const right = createStaticCollisionOccupancySnapshot(snapshot([...contacts].reverse()));
  assert.equal(JSON.stringify(left), JSON.stringify(right));
  const deps = deriveStaticCollisionDependencies({ snapshot: left, collisionState: state, expectedTick: 120, currentPhysicsFrame: frame });
  assert.deepEqual(deps, [
    { collisionId: 'collision:a', dependentEntityIds: ['entity:1', 'entity:2'] },
    { collisionId: 'collision:b', dependentEntityIds: ['entity:3'] },
  ]);
});

await check('streaming guard can replace manual pins from solver occupancy', async () => {
  const guard = createStaticCollisionStreamingGuard({
    initialState: state,
    getCurrentPhysicsFrame: () => frame,
    getSimulationTick: () => 121,
    getCollisionIdentity: () => null,
  });
  guard.syncDependenciesFromOccupancy({
    snapshot: snapshot([{ entityId: 'entity:1', collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: A }]),
    expectedCompletedPhysicsTick: 120,
    lifecycleTick: 121,
  });
  assert.deepEqual(guard.getState().collisions.find((entry) => entry.collisionId === 'collision:a').dependentEntityIds, ['entity:1']);
  assert.deepEqual(guard.getState().collisions.find((entry) => entry.collisionId === 'collision:b').dependentEntityIds, []);
});

await check('zero-contact resident collision derives an empty dependency set', async () => {
  const deps = deriveStaticCollisionDependencies({ snapshot: snapshot([]), collisionState: state, expectedTick: 120, currentPhysicsFrame: frame });
  assert.deepEqual(deps, [
    { collisionId: 'collision:a', dependentEntityIds: [] },
    { collisionId: 'collision:b', dependentEntityIds: [] },
  ]);
});

await check('duplicate entity/collision contact fails closed', async () => {
  const c = { entityId: 'entity:1', collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: A };
  assert.throws(() => createStaticCollisionOccupancySnapshot(snapshot([c, c])), /unique/);
});
await check('stale completed-tick occupancy fails closed', async () => {
  assert.throws(() => deriveStaticCollisionDependencies({ snapshot: snapshot([]), collisionState: state, expectedTick: 121, currentPhysicsFrame: frame }), /expected completed physics tick/);
});
await check('stale physics epoch fails closed', async () => {
  assert.throws(() => deriveStaticCollisionDependencies({ snapshot: snapshot([], { physicsFrame: { ...frame, epoch: 3 } }), collisionState: state, expectedTick: 120, currentPhysicsFrame: frame }), /current physics epoch/);
});
await check('unknown collision fails closed', async () => {
  const contact = { entityId: 'entity:1', collisionId: 'collision:missing', tileId: 'tile:x', artifactSha256: A };
  assert.throws(() => deriveStaticCollisionDependencies({ snapshot: snapshot([contact]), collisionState: state, expectedTick: 120, currentPhysicsFrame: frame }), /non-resident collision/);
});
await check('tile identity mismatch fails closed', async () => {
  const contact = { entityId: 'entity:1', collisionId: 'collision:a', tileId: 'tile:wrong', artifactSha256: A };
  assert.throws(() => deriveStaticCollisionDependencies({ snapshot: snapshot([contact]), collisionState: state, expectedTick: 120, currentPhysicsFrame: frame }), /contact tile/);
});
await check('artifact replacement race fails closed', async () => {
  const contact = { entityId: 'entity:1', collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: B };
  assert.throws(() => deriveStaticCollisionDependencies({ snapshot: snapshot([contact]), collisionState: state, expectedTick: 120, currentPhysicsFrame: frame }), /contact artifact/);
});
await check('render or presentation fields are rejected', async () => {
  assert.throws(() => createStaticCollisionOccupancySnapshot({ ...snapshot([]), renderOriginEpoch: 9 }), /unsupported field/);
});
await check('foreign world frame fails closed', async () => {
  assert.throws(() => deriveStaticCollisionDependencies({ snapshot: snapshot([], { worldFrameId: 'world:foreign' }), collisionState: state, expectedTick: 120, currentPhysicsFrame: frame }), /another world frame/);
});

console.log(`static collision occupancy regressions: ${passed}/11 PASS`);
