import assert from 'node:assert/strict';
import {
  TileStreamingScheduler,
  createSquareTileGrid,
  rankTileCandidates,
} from './tile_scheduler.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testRanking() {
  const tiles = [
    { id: 'east', centerE: 1000, centerN: 0 },
    { id: 'center', centerE: 0, centerN: 0 },
    { id: 'west', centerE: -1000, centerN: 0 },
  ];
  const ranked = rankTileCandidates({ e: 0, n: 0 }, tiles, {
    activeRadiusMeters: 1200,
    maxResidentTiles: 3,
  });
  assert.deepEqual(ranked.map((entry) => entry.tile.id), ['center', 'east', 'west']);
  assert.throws(
    () => rankTileCandidates({ e: 0, n: 0 }, [...tiles, tiles[0]], { activeRadiusMeters: 1200, maxResidentTiles: 4 }),
    /duplicate tile id/,
  );
}

async function testConcurrencyAnd3x3Residency() {
  const tiles = createSquareTileGrid({ originE: 611500, originN: 6677500, radius: 1, idPrefix: 'nannestad' });
  let active = 0;
  let observedPeak = 0;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 1500,
    retainRadiusMeters: 2000,
    maxConcurrentLoads: 2,
    maxResidentTiles: 9,
    maxCacheBytes: 20 * 1024 * 1024,
    loadTile: async (tile) => {
      active += 1;
      observedPeak = Math.max(observedPeak, active);
      await sleep(2);
      active -= 1;
      return { payload: { id: tile.id }, byteSize: 1024 * 1024 };
    },
  });

  await scheduler.update({ e: 611500, n: 6677500 }, tiles);
  const snapshot = await scheduler.whenIdle();
  assert.equal(snapshot.metrics.loadsStarted, 9);
  assert.equal(snapshot.metrics.loadsCompleted, 9);
  assert.equal(snapshot.metrics.residentCount, 9);
  assert.equal(snapshot.metrics.peakActiveLoads, 2);
  assert.equal(observedPeak, 2);
  assert.equal(snapshot.metrics.bytesCached, 9 * 1024 * 1024);
}

async function testWarmCacheReentry() {
  const tiles = [
    { id: 'a', centerE: 0, centerN: 0 },
    { id: 'b', centerE: 1000, centerN: 0 },
  ];
  const activations = [];
  const deactivations = [];
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 150,
    retainRadiusMeters: 1500,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    loadTile: async (tile) => ({ payload: { id: tile.id }, byteSize: 100 }),
    activateTile: async (tile) => activations.push(tile.id),
    deactivateTile: async (tile) => deactivations.push(tile.id),
  });

  await scheduler.update({ e: 0, n: 0 }, tiles);
  await scheduler.whenIdle();
  await scheduler.update({ e: 1000, n: 0 }, tiles);
  await scheduler.whenIdle();
  await scheduler.update({ e: 0, n: 0 }, tiles);
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.loadsStarted, 2, 'returning to A must not refetch');
  assert.equal(snapshot.metrics.cacheHits, 1);
  assert.equal(snapshot.metrics.cacheMisses, 2);
  assert.deepEqual(activations, ['a', 'b', 'a']);
  assert.deepEqual(deactivations, ['a', 'b']);
  assert.equal(snapshot.records.find((record) => record.id === 'a').state, 'resident');
  assert.equal(snapshot.records.find((record) => record.id === 'b').state, 'cached');
}

async function testCacheBudgetEvictsOldestInactiveTile() {
  const tiles = [
    { id: 'a', centerE: 0, centerN: 0 },
    { id: 'b', centerE: 1000, centerN: 0 },
  ];
  const disposed = [];
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 2000,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 150,
    loadTile: async (tile) => ({ payload: { id: tile.id }, byteSize: 100 }),
    disposeTile: async (tile) => disposed.push(tile.id),
  });

  await scheduler.update({ e: 0, n: 0 }, tiles);
  await scheduler.whenIdle();
  await scheduler.update({ e: 1000, n: 0 }, tiles);
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.evictions, 1);
  assert.deepEqual(disposed, ['a']);
  assert.equal(snapshot.metrics.bytesCached, 100);
  assert.equal(snapshot.records.find((record) => record.id === 'a').state, 'idle');
  assert.equal(snapshot.records.find((record) => record.id === 'b').state, 'resident');
}

async function testStaleCompletionCannotResurrectAbortedTile() {
  const tiles = [
    { id: 'a', centerE: 0, centerN: 0 },
    { id: 'b', centerE: 1000, centerN: 0 },
  ];
  let resolveA;
  let loadAStarted;
  const aStarted = new Promise((resolve) => { loadAStarted = resolve; });
  const activated = [];

  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 150,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    loadTile: async (tile) => {
      if (tile.id === 'a') {
        loadAStarted();
        return new Promise((resolve) => { resolveA = resolve; });
      }
      return { payload: { id: tile.id }, byteSize: 100 };
    },
    activateTile: async (tile) => activated.push(tile.id),
  });

  await scheduler.update({ e: 0, n: 0 }, tiles);
  await aStarted;
  await scheduler.update({ e: 1000, n: 0 }, tiles);
  resolveA({ payload: { id: 'a' }, byteSize: 100 });
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.abortRequests, 1);
  assert.equal(snapshot.metrics.staleCompletionsDropped, 1);
  assert.deepEqual(activated, ['b']);
  assert.equal(snapshot.records.find((record) => record.id === 'a').state, 'idle');
  assert.equal(snapshot.records.find((record) => record.id === 'b').state, 'resident');
}

async function testFailedLoadCanRetryWithoutPoisoningTile() {
  const tile = { id: 'retry', centerE: 0, centerN: 0 };
  let attempts = 0;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    loadTile: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic transport failure');
      return { payload: { verified: true }, byteSize: 100 };
    },
  });

  await scheduler.update({ e: 0, n: 0 }, [tile]);
  let snapshot = await scheduler.whenIdle();
  assert.equal(snapshot.metrics.loadsFailed, 1);
  assert.equal(snapshot.records[0].state, 'failed');

  await scheduler.update({ e: 0, n: 0 }, [tile]);
  snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 2);
  assert.equal(snapshot.metrics.loadsCompleted, 1);
  assert.equal(snapshot.records[0].state, 'resident');
  assert.equal(snapshot.records[0].error, null);
}

async function main() {
  await testRanking();
  await testConcurrencyAnd3x3Residency();
  await testWarmCacheReentry();
  await testCacheBudgetEvictsOldestInactiveTile();
  await testStaleCompletionCannotResurrectAbortedTile();
  await testFailedLoadCanRetryWithoutPoisoningTile();
  console.log('tile scheduler regressions: PASS (6 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
