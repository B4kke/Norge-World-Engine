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
  assert.equal(snapshot.records.find((record) => record.id === 'a').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'b').state, 'cached');
}

async function main() {
  await testNearerTilePreemptsLowerPriorityResidentAfterOutOfOrderLoads();
  await testOversizedHigherPriorityTileDoesNotEvictUsefulResident();
  await testEqualDistanceUsesTileIdTieBreakForPreemption();
  console.log('resident budget priority regressions: PASS (3 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
