import assert from 'node:assert/strict';

import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const sizes = Object.freeze({ incumbent: 150, large: 150, small: 100 });
const tiles = Object.freeze({
  incumbent: Object.freeze({ id: 'incumbent', centerE: 0, centerN: 0 }),
  large: Object.freeze({ id: 'large', centerE: 100, centerN: 0 }),
  small: Object.freeze({ id: 'small', centerE: 90, centerN: 0 }),
});

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

await scheduler.update({ e: 100, n: 0 }, Object.values(tiles));
await scheduler.whenIdle();
const pressureScheduler = scheduler.snapshot();
const pressureBudget = adapter.snapshot();

assert.deepEqual(materialized, ['incumbent', 'small']);
assert.equal(pressureScheduler.records.find((record) => record.id === 'large').state, 'queued');
assert.equal(pressureScheduler.records.find((record) => record.id === 'small').state, 'resident');
assert.equal(pressureScheduler.metrics.activeLoads, 0);
assert.equal(pressureScheduler.metrics.queueDepth, 1);
assert.equal(pressureBudget.budget.committedBytes, 250);
assert.equal(pressureBudget.budget.reservedBytes, 0);
assert.equal(pressureBudget.budget.overcommitBytes, 0);

await scheduler.update({ e: 121, n: 0 }, Object.values(tiles));
await scheduler.whenIdle();
const finalScheduler = scheduler.snapshot();
const finalBudget = adapter.snapshot();

assert.deepEqual(materialized, ['incumbent', 'small', 'large']);
assert.ok(disposed.includes('incumbent'));
assert.equal(finalScheduler.metrics.activeLoads, 0);
assert.equal(finalScheduler.metrics.queueDepth, 0);
assert.equal(finalBudget.budget.committedBytes, 250);
assert.equal(finalBudget.budget.reservedBytes, 0);
assert.equal(finalBudget.budget.overcommitBytes, 0);

console.log(JSON.stringify({
  schema: 'nwe.streaming-retained-admission-fairness-benchmark/0.1',
  scenario: {
    maxRetainedBytes: 250,
    tileBytes: sizes,
    maxConcurrentLoads: 2,
    movement: [
      { e: 0, n: 0, purpose: 'seed-incumbent' },
      { e: 100, n: 0, purpose: 'large-blocked-small-fits' },
      { e: 121, n: 0, purpose: 'dispose-incumbent-large-progresses' },
    ],
  },
  pressure: {
    materialized: materialized.slice(0, 2),
    largeState: pressureScheduler.records.find((record) => record.id === 'large').state,
    smallState: pressureScheduler.records.find((record) => record.id === 'small').state,
    queueDepth: pressureScheduler.metrics.queueDepth,
    activeLoads: pressureScheduler.metrics.activeLoads,
    admissionDeferrals: pressureScheduler.metrics.loadAdmissionDeferrals,
    committedBytes: pressureBudget.budget.committedBytes,
    reservedBytes: pressureBudget.budget.reservedBytes,
    overcommitBytes: pressureBudget.budget.overcommitBytes,
  },
  recovered: {
    materialized,
    disposed,
    largeState: finalScheduler.records.find((record) => record.id === 'large').state,
    queueDepth: finalScheduler.metrics.queueDepth,
    activeLoads: finalScheduler.metrics.activeLoads,
    committedBytes: finalBudget.budget.committedBytes,
    reservedBytes: finalBudget.budget.reservedBytes,
    overcommitBytes: finalBudget.budget.overcommitBytes,
  },
}, null, 2));
