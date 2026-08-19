import assert from 'node:assert/strict';
import { TileStreamingScheduler } from '../streaming/tile_scheduler.mjs';
import { createStaticCollisionLifecycleState } from './static_collision_lifecycle_contract.mjs';
import { createStaticCollisionStreamingGuard } from './static_collision_streaming_guard.mjs';

const SHA = 'a'.repeat(64);
const tile = { id: 'nannestad:0:0', centerE: 0, centerN: 0 };
const payload = { artifactSha256: SHA };
const physicsFrame = { physicsFrameId: 'physics:nannestad', epoch: 0 };

function initialState(dependentEntityIds = ['entity:car']) {
  return createStaticCollisionLifecycleState({
    worldFrameId: 'world:nannestad',
    physicsFrameId: physicsFrame.physicsFrameId,
    physicsEpoch: physicsFrame.epoch,
    collisions: [{
      collisionId: 'collision:nannestad:0:0',
      tileId: tile.id,
      artifactSha256: SHA,
      dependentEntityIds,
    }],
  });
}

function makeGuard({ state = initialState(), frame = physicsFrame, simulationTick = 10, downstreamDispose = async () => {} } = {}) {
  return createStaticCollisionStreamingGuard({
    initialState: state,
    getCurrentPhysicsFrame: () => frame,
    getSimulationTick: () => simulationTick,
    getCollisionIdentity: (candidateTile, candidatePayload) => candidateTile.id === tile.id
      ? { collisionId: 'collision:nannestad:0:0', artifactSha256: candidatePayload.artifactSha256 }
      : null,
    disposeTile: downstreamDispose,
  });
}

async function makeScheduler(guard) {
  const events = [];
  let deactivations = 0;
  const scheduler = new TileStreamingScheduler({
    loadTile: async () => ({ byteSize: 128, payload }),
    activateTile: async () => {},
    deactivateTile: async () => { deactivations += 1; },
    disposeTile: guard.disposeTile,
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxResidentTiles: 1,
    maxCacheBytes: 1024,
    onEvent: (event) => events.push(event),
  });
  await scheduler.update({ e: 0, n: 0 }, [tile]);
  await scheduler.whenIdle();
  assert.equal(scheduler.snapshot().records[0].state, 'resident');
  return { scheduler, events, getDeactivations: () => deactivations };
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await check('renderer deactivation cannot evict in-use world collision', async () => {
  const guard = makeGuard();
  const { scheduler, events, getDeactivations } = await makeScheduler(guard);
  await assert.rejects(
    scheduler.update({ e: 1000, n: 0 }, [tile]),
    (error) => error?.code === 'COLLISION_IN_USE',
  );
  const snapshot = scheduler.snapshot();
  assert.equal(getDeactivations(), 1);
  assert.equal(snapshot.records[0].state, 'cached');
  assert.equal(snapshot.metrics.evictions, 0);
  assert.equal(snapshot.metrics.disposalFailures, 1);
  assert.equal(guard.getState().collisions.length, 1);
  assert.ok(events.some((event) => event.type === 'tile-deactivated'));
  assert.ok(events.some((event) => event.type === 'disposal-failed'));
  assert.ok(!events.some((event) => event.type === 'tile-evicted'));
});

await check('dependency release permits later scheduler eviction', async () => {
  const guard = makeGuard();
  const { scheduler } = await makeScheduler(guard);
  await assert.rejects(scheduler.update({ e: 1000, n: 0 }, [tile]), (error) => error?.code === 'COLLISION_IN_USE');
  guard.setDependencies({ tick: 10, tile, payload, dependentEntityIds: [] });
  await scheduler.update({ e: 1000, n: 0 }, [tile]);
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.records[0].state, 'idle');
  assert.equal(snapshot.metrics.evictions, 1);
  assert.equal(guard.getState().collisions.length, 0);
});

await check('stale physics epoch blocks disposal before scheduler payload is released', async () => {
  const guard = makeGuard({ state: initialState([]), frame: { ...physicsFrame, epoch: 1 } });
  const { scheduler } = await makeScheduler(guard);
  await assert.rejects(
    scheduler.update({ e: 1000, n: 0 }, [tile]),
    (error) => error?.code === 'PHYSICS_EPOCH_MISMATCH',
  );
  assert.equal(scheduler.snapshot().records[0].state, 'cached');
  assert.equal(guard.getState().collisions.length, 1);
});

await check('artifact mismatch blocks disposal before downstream mutation', async () => {
  let downstreamCalls = 0;
  const guard = createStaticCollisionStreamingGuard({
    initialState: initialState([]),
    getCurrentPhysicsFrame: () => physicsFrame,
    getSimulationTick: () => 10,
    getCollisionIdentity: () => ({ collisionId: 'collision:nannestad:0:0', artifactSha256: 'b'.repeat(64) }),
    disposeTile: async () => { downstreamCalls += 1; },
  });
  await assert.rejects(guard.disposeTile(tile, payload), /artifact does not match/);
  assert.equal(downstreamCalls, 0);
  assert.equal(guard.getState().collisions.length, 1);
});

await check('downstream disposal failure rolls back collision lifecycle commit', async () => {
  const guard = makeGuard({
    state: initialState([]),
    downstreamDispose: async () => { throw new Error('renderer/runtime disposal failed'); },
  });
  await assert.rejects(guard.disposeTile(tile, payload), /disposal failed/);
  assert.equal(guard.getState().collisions.length, 1);
});

await check('unbound streaming tile passes through without collision authority', async () => {
  let downstreamCalls = 0;
  const guard = createStaticCollisionStreamingGuard({
    initialState: initialState([]),
    getCurrentPhysicsFrame: () => physicsFrame,
    getSimulationTick: () => 10,
    getCollisionIdentity: () => null,
    disposeTile: async () => { downstreamCalls += 1; },
  });
  await guard.disposeTile({ id: 'visual-only', centerE: 1, centerN: 1 }, {});
  assert.equal(downstreamCalls, 1);
  assert.equal(guard.getState().collisions.length, 1);
});

await check('missing simulation tick authority fails closed before disposal', async () => {
  let downstreamCalls = 0;
  const guard = makeGuard({
    state: initialState([]),
    simulationTick: undefined,
    downstreamDispose: async () => { downstreamCalls += 1; },
  });
  await assert.rejects(guard.disposeTile(tile, payload), /simulation tick/);
  assert.equal(downstreamCalls, 0);
  assert.equal(guard.getState().collisions.length, 1);
});

console.log(JSON.stringify({ schema: 'nwe.static-collision-streaming-guard-regression/0.1', passed, total: 7 }));
