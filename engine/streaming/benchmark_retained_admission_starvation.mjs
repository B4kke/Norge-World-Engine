import assert from 'node:assert/strict';

import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const blockedCycles = 12;
const sizes = Object.freeze({ incumbent: 150, large: 150, small: 100 });
const tiles = Object.freeze({
  incumbent: Object.freeze({ id: 'incumbent', centerE: 0, centerN: 0 }),
  large: Object.freeze({ id: 'large', centerE: 100, centerN: 0 }),
  small: Object.freeze({ id: 'small', centerE: 90, centerN: 0 }),
});
const allTiles = Object.values(tiles);

const materialized = [];
const disposed = [];
const adapter = createRetainedBudgetLifecycleAdapter({
  maxRetainedBytes: 250,
  estimateTileBytes(tile) {
    return sizes[tile.id];
  },
  async loadTile(tile) {
    materialized.push(tile.id);
    return { payload: { tileId: tile.id }, byteSize: sizes[tile.id] };
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

await scheduler.update({ e: 0, n: 0 }, [tiles.incumbent]);
await scheduler.whenIdle();

let maxQueueDepth = 0;
let maxActiveLoads = 0;
for (let cycle = 0; cycle < blockedCycles; cycle += 1) {
  await scheduler.update({ e: 100, n: 0 }, allTiles);
  await scheduler.whenIdle();
  const pressure = scheduler.snapshot();
  maxQueueDepth = Math.max(maxQueueDepth, pressure.metrics.queueDepth);
  maxActiveLoads = Math.max(maxActiveLoads, pressure.metrics.activeLoads);
  assert.equal(pressure.records.find((record) => record.id === 'large').state, 'queued');
  assert.equal(materialized.includes('large'), false);

  await scheduler.update({ e: 0, n: 0 }, allTiles);
  await scheduler.whenIdle();
  const reset = scheduler.snapshot();
  maxQueueDepth = Math.max(maxQueueDepth, reset.metrics.queueDepth);
  maxActiveLoads = Math.max(maxActiveLoads, reset.metrics.activeLoads);
  assert.equal(reset.records.find((record) => record.id === 'large').state, 'idle');
}

await scheduler.update({ e: 100, n: 0 }, allTiles);
await scheduler.whenIdle();
const beforeRelease = scheduler.snapshot();
const budgetBeforeRelease = adapter.snapshot().budget;
assert.equal(beforeRelease.records.find((record) => record.id === 'large').state, 'queued');
assert.equal(materialized.includes('large'), false);

await scheduler.update({ e: 121, n: 0 }, allTiles);
await scheduler.whenIdle();
const recovered = scheduler.snapshot();
const finalBudget = adapter.snapshot().budget;
assert.equal(recovered.records.find((record) => record.id === 'large').state, 'resident');
assert.equal(materialized.filter((id) => id === 'large').length, 1);
assert.equal(finalBudget.overcommitBytes, 0);
assert.equal(finalBudget.reservedBytes, 0);
assert.ok(finalBudget.committedBytes <= 250);

console.log(JSON.stringify({
  schema: 'nwe.streaming-retained-admission-starvation-benchmark/0.1',
  scenario: {
    blockedCycles,
    maxRetainedBytes: 250,
    tileBytes: sizes,
    maxConcurrentLoads: 2,
  },
  beforeRelease: {
    largeState: beforeRelease.records.find((record) => record.id === 'large').state,
    largeMaterializations: materialized.filter((id) => id === 'large').length - 1,
    admissionDeferrals: beforeRelease.metrics.loadAdmissionDeferrals,
    queueDepth: beforeRelease.metrics.queueDepth,
    activeLoads: beforeRelease.metrics.activeLoads,
    committedBytes: budgetBeforeRelease.committedBytes,
    reservedBytes: budgetBeforeRelease.reservedBytes,
    overcommitBytes: budgetBeforeRelease.overcommitBytes,
  },
  recovered: {
    largeState: recovered.records.find((record) => record.id === 'large').state,
    largeMaterializations: materialized.filter((id) => id === 'large').length,
    materialized,
    disposed,
    queueDepth: recovered.metrics.queueDepth,
    activeLoads: recovered.metrics.activeLoads,
    peakActiveLoads: recovered.metrics.peakActiveLoads,
    maxObservedQueueDepth: maxQueueDepth,
    maxObservedActiveLoads: maxActiveLoads,
    committedBytes: finalBudget.committedBytes,
    reservedBytes: finalBudget.reservedBytes,
    overcommitBytes: finalBudget.overcommitBytes,
  },
}, null, 2));
