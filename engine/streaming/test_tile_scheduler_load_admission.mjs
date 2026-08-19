import assert from 'node:assert/strict';
import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const tile = (id, centerE) => ({ id, centerE, centerN: 0 });

// A deferred admission remains queued and does not consume bounded load concurrency.
{
  let loadCalls = 0;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    admitLoad: () => null,
    loadTile: async () => {
      loadCalls += 1;
      return { payload: {}, byteSize: 1 };
    },
  });
  await scheduler.update({ e: 0, n: 0 }, [tile('A', 0)]);
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.metrics.activeLoads, 0);
  assert.equal(snapshot.metrics.queueDepth, 1);
  assert.equal(snapshot.metrics.loadAdmissionDeferrals, 1);
  assert.equal(loadCalls, 0);
}

// An opaque admission token is forwarded to loadTile, and actual load concurrency stays bounded.
{
  const token = Object.freeze({ token: 'opaque' });
  let observedContext = null;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    admitLoad: () => token,
    loadTile: async (_tile, context) => {
      observedContext = context;
      return { payload: {}, byteSize: 1 };
    },
  });
  await scheduler.update({ e: 0, n: 0 }, [tile('A', 0)]);
  await scheduler.whenIdle();
  assert.equal(observedContext.admission, token);
  assert.equal(observedContext.attempt, 1);
  assert.equal(scheduler.snapshot().metrics.peakActiveLoads, 1);
}

// The retained adapter uses synchronous pre-admission without creating FIFO waiters.
{
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 100,
    estimateTileBytes: () => 100,
    loadTile: async (candidate) => ({ payload: { id: candidate.id }, byteSize: 100 }),
  });
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 1000,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxCacheBytes: 100,
    admitLoad: adapter.tryAdmitLoad,
    loadTile: adapter.loadTile,
    disposeTile: adapter.disposeTile,
  });
  const tiles = [tile('A', 0), tile('B', 500)];
  await scheduler.update({ e: 0, n: 0 }, tiles);
  await scheduler.whenIdle();
  await scheduler.update({ e: 500, n: 0 }, tiles);
  const pressure = scheduler.snapshot();
  const budget = adapter.snapshot();
  assert.equal(pressure.metrics.activeLoads, 0);
  assert.equal(pressure.metrics.queueDepth, 1);
  assert.equal(budget.waitingLoads, 0);
  assert.equal(budget.preAdmittedLoads, 0);
  assert.equal(budget.budget.overcommitBytes, 0);
}

// Admission must be synchronous: Promise-returning hooks fail closed before loadTile starts.
{
  let loadCalls = 0;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxLoadAttemptsPerInterest: 1,
    admitLoad: async () => true,
    loadTile: async () => {
      loadCalls += 1;
      return { payload: {}, byteSize: 1 };
    },
  });
  await scheduler.update({ e: 0, n: 0 }, [tile('A', 0)]);
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.metrics.loadAdmissionFailures, 1);
  assert.equal(snapshot.metrics.activeLoads, 0);
  assert.equal(snapshot.metrics.failedCount, 1);
  assert.equal(loadCalls, 0);
}

console.log('tile scheduler load admission regressions: PASS (4 cases)');
