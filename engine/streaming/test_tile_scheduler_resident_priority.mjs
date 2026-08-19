import assert from 'node:assert/strict';
import { TileStreamingScheduler } from './tile_scheduler.mjs';

async function testNearerTilePreemptsLowerPriorityResidentAfterOutOfOrderLoads() {
  const tiles = [
    { id: 'near', centerE: 0, centerN: 0 },
    { id: 'far', centerE: 900, centerN: 0 },
  ];
  const resolvers = new Map();
  const started = new Map();
  const deactivations = [];

  const waitStarted = (id) => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    started.set(id, { promise, resolve });
    return promise;
  };
  const nearStarted = waitStarted('near');
  const farStarted = waitStarted('far');

  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 1000,
    retainRadiusMeters: 2000,
    maxResidentTiles: 2,
    maxConcurrentLoads: 2,
    maxCacheBytes: 1000,
    maxResidentBytes: 100,
    loadTile: async (tile) => {
      started.get(tile.id).resolve();
      return new Promise((resolve) => resolvers.set(tile.id, resolve));
    },
    deactivateTile: async (tile, _payload, { reason }) => deactivations.push([tile.id, reason]),
  });

  await scheduler.update({ e: 0, n: 0 }, tiles);
  await Promise.all([nearStarted, farStarted]);

  // Complete the lower-priority load first to reproduce the priority inversion.
  resolvers.get('far')({ payload: { id: 'far' }, byteSize: 100 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.snapshot().records.find((record) => record.id === 'far').state, 'resident');

  resolvers.get('near')({ payload: { id: 'near' }, byteSize: 100 });
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.residentBudgetOvercommitBytes, 0);
  assert.equal(snapshot.metrics.residentBudgetPreemptions, 1);
  assert.equal(snapshot.metrics.residentBudgetPreemptionFailures, 0);
  assert.equal(snapshot.metrics.residentBudgetDeferrals, 0);
  assert.equal(snapshot.records.find((record) => record.id === 'near').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'far').state, 'cached');
  assert.equal(snapshot.metrics.bytesResident, 100);
  assert.equal(snapshot.metrics.bytesCached, 100);
  assert.deepEqual(deactivations, [['far', 'resident-budget-preempted']]);
}

async function testOversizedHigherPriorityTileDoesNotEvictUsefulResident() {
  const tiles = [
    { id: 'near-big', centerE: 0, centerN: 0 },
    { id: 'far-small', centerE: 900, centerN: 0 },
  ];
  const deactivations = [];
  const loads = [];
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 1000,
    retainRadiusMeters: 2000,
    maxResidentTiles: 2,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    maxResidentBytes: 100,
    loadTile: async (tile) => {
      loads.push(tile.id);
      return {
        payload: { id: tile.id },
        byteSize: tile.id === 'near-big' ? 150 : 100,
      };
    },
    deactivateTile: async (tile, _payload, { reason }) => deactivations.push([tile.id, reason]),
  });

  // Establish the small tile as useful resident state first.
  await scheduler.update({ e: 900, n: 0 }, [tiles[1]]);
  await scheduler.whenIdle();
  assert.equal(scheduler.snapshot().records.find((record) => record.id === 'far-small').state, 'resident');

  await scheduler.update({ e: 0, n: 0 }, tiles);
  const snapshot = await scheduler.whenIdle();

  assert.deepEqual(loads, ['far-small', 'near-big']);
  assert.equal(snapshot.metrics.residentBudgetPreemptions, 0, 'an impossible candidate must not evict useful resident state');
  assert.equal(snapshot.metrics.residentBudgetPreemptionFailures, 0);
  assert.equal(snapshot.metrics.residentBudgetDeferrals, 1);
  assert.equal(snapshot.records.find((record) => record.id === 'far-small').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'near-big').state, 'cached');
  assert.equal(snapshot.metrics.bytesResident, 100);
  assert.equal(snapshot.metrics.bytesCached, 150);
  assert.deepEqual(deactivations, []);
}

async function testEqualDistanceUsesTileIdTieBreakForPreemption() {
  const tiles = [
    { id: 'a', centerE: -100, centerN: 0 },
    { id: 'b', centerE: 100, centerN: 0 },
  ];
  const resolvers = new Map();
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 200,
    retainRadiusMeters: 400,
    maxResidentTiles: 2,
    maxConcurrentLoads: 2,
    maxCacheBytes: 1000,
    maxResidentBytes: 100,
    loadTile: async (tile) => new Promise((resolve) => resolvers.set(tile.id, resolve)),
  });

  await scheduler.update({ e: 0, n: 0 }, tiles);
  while (resolvers.size < 2) await new Promise((resolve) => setImmediate(resolve));
  resolvers.get('b')({ payload: { id: 'b' }, byteSize: 100 });
  await new Promise((resolve) => setImmediate(resolve));
  resolvers.get('a')({ payload: { id: 'a' }, byteSize: 100 });
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.residentBudgetPreemptions, 1);
  assert.equal(snapshot.metrics.residentBudgetPreemptionFailures, 0);
  assert.equal(snapshot.records.find((record) => record.id === 'a').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'b').state, 'cached');
}

async function testFailedPreemptionDefersCandidateWithoutBreakingSchedulerLoop() {
  const tiles = [
    { id: 'near', centerE: 0, centerN: 0 },
    { id: 'far', centerE: 900, centerN: 0 },
  ];
  const events = [];
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 1000,
    retainRadiusMeters: 2000,
    maxResidentTiles: 2,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    maxResidentBytes: 100,
    loadTile: async (tile) => ({ payload: { id: tile.id }, byteSize: 100 }),
    deactivateTile: async (_tile, _payload, { reason }) => {
      if (reason === 'resident-budget-preempted') throw new Error('renderer refused deactivation');
    },
    onEvent: (event) => events.push(event),
  });

  await scheduler.update({ e: 900, n: 0 }, [tiles[1]]);
  await scheduler.whenIdle();
  assert.equal(scheduler.snapshot().records.find((record) => record.id === 'far').state, 'resident');

  await scheduler.update({ e: 0, n: 0 }, tiles);
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.residentBudgetOvercommitBytes, 0);
  assert.equal(snapshot.metrics.residentBudgetPreemptions, 0);
  assert.equal(snapshot.metrics.residentBudgetPreemptionFailures, 1);
  assert.equal(snapshot.metrics.deactivationFailures, 1);
  assert.equal(snapshot.metrics.residentBudgetDeferrals, 1);
  assert.equal(snapshot.metrics.lifecycleFailures, 0, 'contained preemption failure must not poison the async load lifecycle');
  assert.equal(snapshot.records.find((record) => record.id === 'far').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'near').state, 'cached');
  assert.equal(snapshot.metrics.bytesResident, 100);
  assert.equal(snapshot.metrics.bytesCached, 100);
  assert.equal(events.filter((event) => event.type === 'resident-budget-preemption-failed').length, 1);
  assert.equal(events.filter((event) => event.type === 'activation-deferred-budget').length, 1);
}

async function testConcurrentPreemptionDeactivatesIncumbentExactlyOnce() {
  const incumbent = { id: 'incumbent', centerE: 900, centerN: 0 };
  const winner = { id: 'winner', centerE: 0, centerN: 0 };
  const deferred = { id: 'deferred', centerE: 100, centerN: 0 };
  const loadResolvers = new Map();
  const loadStarted = new Map();
  const deactivations = [];
  const events = [];
  let releaseDeactivation;
  let notifyDeactivationStarted;
  const deactivationStarted = new Promise((resolve) => { notifyDeactivationStarted = resolve; });
  const deactivationGate = new Promise((resolve) => { releaseDeactivation = resolve; });

  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 1000,
    retainRadiusMeters: 2000,
    maxResidentTiles: 3,
    maxConcurrentLoads: 2,
    maxCacheBytes: 1000,
    maxResidentBytes: 100,
    loadTile: async (tile) => {
      if (tile.id === 'incumbent') return { payload: { id: tile.id }, byteSize: 100 };
      let notifyStarted;
      const started = new Promise((resolve) => { notifyStarted = resolve; });
      loadStarted.set(tile.id, started);
      notifyStarted();
      return new Promise((resolve) => loadResolvers.set(tile.id, resolve));
    },
    deactivateTile: async (tile, _payload, { reason }) => {
      deactivations.push([tile.id, reason]);
      if (reason === 'resident-budget-preempted') {
        notifyDeactivationStarted();
        await deactivationGate;
      }
    },
    onEvent: (event) => events.push(event),
  });

  await scheduler.update({ e: 900, n: 0 }, [incumbent]);
  await scheduler.whenIdle();
  assert.equal(scheduler.snapshot().records.find((record) => record.id === 'incumbent').state, 'resident');

  await scheduler.update({ e: 0, n: 0 }, [winner, deferred, incumbent]);
  while (loadResolvers.size < 2) await new Promise((resolve) => setImmediate(resolve));

  // Resolve both higher-priority loads in the same turn. The first activation starts
  // async preemption; the second must observe the incumbent as deactivating and defer.
  loadResolvers.get('winner')({ payload: { id: 'winner' }, byteSize: 100 });
  loadResolvers.get('deferred')({ payload: { id: 'deferred' }, byteSize: 100 });
  await deactivationStarted;
  await new Promise((resolve) => setImmediate(resolve));

  const mid = scheduler.snapshot();
  assert.equal(mid.records.find((record) => record.id === 'incumbent').state, 'deactivating');
  assert.equal(mid.metrics.deactivatingCount, 1);
  assert.equal(mid.metrics.bytesResident, 100, 'in-flight deactivation must retain resident byte accounting');
  assert.equal(mid.metrics.bytesActivating, 0);
  assert.equal(mid.metrics.residentBudgetOvercommitBytes, 0);
  assert.equal(events.filter((event) => event.type === 'activation-deferred-budget').length, 1);
  assert.deepEqual(deactivations, [['incumbent', 'resident-budget-preempted']], 'incumbent deactivation must be invoked exactly once');

  releaseDeactivation();
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.residentBudgetOvercommitBytes, 0);
  assert.equal(snapshot.metrics.residentBudgetPreemptions, 1);
  assert.equal(snapshot.metrics.residentBudgetDeferrals, 1);
  assert.equal(snapshot.metrics.residentBudgetPreemptionFailures, 0);
  assert.equal(snapshot.records.find((record) => record.id === 'winner').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'deferred').state, 'cached');
  assert.equal(snapshot.records.find((record) => record.id === 'incumbent').state, 'cached');
  assert.equal(snapshot.metrics.bytesResident, 100);
  assert.equal(snapshot.metrics.bytesActivating, 0);
  assert.equal(snapshot.metrics.bytesCached, 200);
  assert.deepEqual(deactivations, [['incumbent', 'resident-budget-preempted']]);
}

async function main() {
  await testNearerTilePreemptsLowerPriorityResidentAfterOutOfOrderLoads();
  await testOversizedHigherPriorityTileDoesNotEvictUsefulResident();
  await testEqualDistanceUsesTileIdTieBreakForPreemption();
  await testFailedPreemptionDefersCandidateWithoutBreakingSchedulerLoop();
  await testConcurrentPreemptionDeactivatesIncumbentExactlyOnce();
  console.log('resident budget priority regressions: PASS (5 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});