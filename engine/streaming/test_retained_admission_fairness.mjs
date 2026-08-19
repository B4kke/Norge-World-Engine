import assert from 'node:assert/strict';

import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const BYTES = Object.freeze({ incumbent: 150, large: 150, small: 100 });
const TILES = Object.freeze({
  incumbent: Object.freeze({ id: 'incumbent', centerE: 0, centerN: 0 }),
  large: Object.freeze({ id: 'large', centerE: 100, centerN: 0 }),
  small: Object.freeze({ id: 'small', centerE: 90, centerN: 0 }),
});

function createHarness() {
  const materialized = [];
  const disposed = [];
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 250,
    estimateTileBytes(tile) {
      return BYTES[tile.id];
    },
    async loadTile(tile) {
      materialized.push(tile.id);
      return { payload: { tileId: tile.id }, byteSize: BYTES[tile.id] };
    },
    async disposeTile(tile) {
      disposed.push(tile.id);
    },
  });

  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 40,
    retainRadiusMeters: 120,
    maxConcurrentLoads: 2,
    maxResidentTiles: 3,
    maxCacheBytes: 1024,
    admitLoad: adapter.tryAdmitLoad,
    loadTile: adapter.loadTile,
    disposeTile: adapter.disposeTile,
  });

  return { adapter, scheduler, materialized, disposed };
}

async function seedIncumbent(harness) {
  await harness.scheduler.update({ e: 0, n: 0 }, [TILES.incumbent]);
  await harness.scheduler.whenIdle();
  assert.deepEqual(harness.materialized, ['incumbent']);
  assert.equal(harness.adapter.snapshot().budget.committedBytes, 150);
}

async function testSmallerLowerPriorityTileBypassesBlockedLargeTile() {
  const harness = createHarness();
  await seedIncumbent(harness);

  await harness.scheduler.update({ e: 100, n: 0 }, Object.values(TILES));
  await harness.scheduler.whenIdle();

  const pressure = harness.scheduler.snapshot();
  const large = pressure.records.find((record) => record.id === 'large');
  const small = pressure.records.find((record) => record.id === 'small');
  assert.equal(large.state, 'queued');
  assert.equal(small.state, 'resident');
  assert.deepEqual(harness.materialized, ['incumbent', 'small']);
  assert.equal(pressure.metrics.activeLoads, 0);
  assert.equal(pressure.metrics.queueDepth, 1);
  assert.ok(pressure.metrics.loadAdmissionDeferrals >= 1);
  assert.equal(harness.adapter.snapshot().budget.committedBytes, 250);
  assert.equal(harness.adapter.snapshot().budget.reservedBytes, 0);

  await harness.scheduler.update({ e: 121, n: 0 }, Object.values(TILES));
  await harness.scheduler.whenIdle();

  const recovered = harness.scheduler.snapshot();
  assert.deepEqual(harness.materialized, ['incumbent', 'small', 'large']);
  assert.ok(harness.disposed.includes('incumbent'));
  assert.equal(recovered.records.find((record) => record.id === 'large').state, 'resident');
  assert.equal(recovered.metrics.activeLoads, 0);
  assert.equal(recovered.metrics.queueDepth, 0);
  assert.equal(harness.adapter.snapshot().budget.committedBytes, 250);
  assert.equal(harness.adapter.snapshot().budget.reservedBytes, 0);
  assert.equal(harness.adapter.snapshot().budget.overcommitBytes, 0);
}

async function testDeferredLargeTileCanBeCancelledWithoutReservationLeak() {
  const harness = createHarness();
  await seedIncumbent(harness);

  await harness.scheduler.update({ e: 100, n: 0 }, Object.values(TILES));
  await harness.scheduler.whenIdle();
  assert.equal(harness.scheduler.snapshot().records.find((record) => record.id === 'large').state, 'queued');
  assert.equal(harness.adapter.snapshot().preAdmittedLoads, 0);

  await harness.scheduler.update({ e: 0, n: 0 }, [TILES.incumbent]);
  await harness.scheduler.whenIdle();

  const finalScheduler = harness.scheduler.snapshot();
  const finalBudget = harness.adapter.snapshot();
  assert.equal(finalScheduler.records.find((record) => record.id === 'large').state, 'idle');
  assert.equal(harness.materialized.includes('large'), false);
  assert.equal(finalBudget.preAdmittedLoads, 0);
  assert.equal(finalBudget.budget.reservedBytes, 0);
  assert.equal(finalBudget.budget.overcommitBytes, 0);
}

await testSmallerLowerPriorityTileBypassesBlockedLargeTile();
await testDeferredLargeTileCanBeCancelledWithoutReservationLeak();

console.log('retained admission fairness regressions: PASS (2 cases)');
