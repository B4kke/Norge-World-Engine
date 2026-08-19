import assert from 'node:assert/strict';

import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const BLOCKED_CYCLES = 12;
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

function assertAccountingBounded(harness) {
  const budget = harness.adapter.snapshot().budget;
  assert.ok(budget.committedBytes + budget.reservedBytes <= 250);
  assert.equal(budget.overcommitBytes, 0);
}

async function testRepeatedDeferralCancellationEventuallyProgresses() {
  const harness = createHarness();
  const allTiles = Object.values(TILES);

  await harness.scheduler.update({ e: 0, n: 0 }, [TILES.incumbent]);
  await harness.scheduler.whenIdle();
  assert.deepEqual(harness.materialized, ['incumbent']);

  for (let cycle = 0; cycle < BLOCKED_CYCLES; cycle += 1) {
    await harness.scheduler.update({ e: 100, n: 0 }, allTiles);
    await harness.scheduler.whenIdle();

    const pressure = harness.scheduler.snapshot();
    assert.equal(pressure.records.find((record) => record.id === 'large').state, 'queued');
    assert.equal(pressure.records.find((record) => record.id === 'small').state, 'resident');
    assert.equal(pressure.metrics.activeLoads, 0);
    assert.equal(pressure.metrics.queueDepth, 1);
    assert.equal(harness.materialized.includes('large'), false);
    assertAccountingBounded(harness);

    await harness.scheduler.update({ e: 0, n: 0 }, allTiles);
    await harness.scheduler.whenIdle();

    const reset = harness.scheduler.snapshot();
    assert.equal(reset.records.find((record) => record.id === 'large').state, 'idle');
    assert.equal(reset.records.find((record) => record.id === 'incumbent').state, 'resident');
    assert.equal(reset.metrics.activeLoads, 0);
    assert.equal(reset.metrics.queueDepth, 0);
    assertAccountingBounded(harness);
  }

  await harness.scheduler.update({ e: 100, n: 0 }, allTiles);
  await harness.scheduler.whenIdle();
  const beforeRelease = harness.scheduler.snapshot();
  assert.equal(beforeRelease.records.find((record) => record.id === 'large').state, 'queued');
  assert.equal(harness.materialized.includes('large'), false);
  assert.ok(beforeRelease.metrics.loadAdmissionDeferrals >= BLOCKED_CYCLES + 1);
  assertAccountingBounded(harness);

  await harness.scheduler.update({ e: 121, n: 0 }, allTiles);
  await harness.scheduler.whenIdle();

  const recovered = harness.scheduler.snapshot();
  const budget = harness.adapter.snapshot().budget;
  assert.equal(recovered.records.find((record) => record.id === 'large').state, 'resident');
  assert.equal(harness.materialized.filter((id) => id === 'large').length, 1);
  assert.ok(harness.disposed.includes('incumbent'));
  assert.equal(recovered.metrics.activeLoads, 0);
  assert.equal(recovered.metrics.queueDepth, 0);
  assert.equal(budget.reservedBytes, 0);
  assert.equal(budget.overcommitBytes, 0);
  assert.ok(budget.committedBytes <= 250);
}

await testRepeatedDeferralCancellationEventuallyProgresses();

console.log(`retained admission starvation regressions: PASS (1 case, ${BLOCKED_CYCLES} blocked cycles)`);
