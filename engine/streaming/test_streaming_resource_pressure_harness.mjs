import assert from 'node:assert/strict';

import { TileStreamingScheduler, createSquareTileGrid } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';
import { runStreamingResourcePressureHarness } from './streaming_resource_pressure_harness.mjs';

const tiles = createSquareTileGrid({ originE: 611500, originN: 6677500, tileSizeMeters: 1000, radius: 1, idPrefix: 'pressure' });
const tileBytes = 100;
const materialized = [];
const disposed = [];
const adapter = createRetainedBudgetLifecycleAdapter({
  maxRetainedBytes: 200,
  estimateTileBytes() { return tileBytes; },
  async loadTile(tile) {
    materialized.push(tile.id);
    return { payload: { tileId: tile.id }, byteSize: tileBytes };
  },
  async disposeTile(tile) { disposed.push(tile.id); },
});

const scheduler = new TileStreamingScheduler({
  activeRadiusMeters: 1100,
  retainRadiusMeters: 1500,
  maxConcurrentLoads: 2,
  maxResidentTiles: 2,
  maxResidentBytes: 200,
  maxCacheBytes: 100,
  admitLoad: adapter.tryAdmitLoad,
  loadTile: adapter.loadTile,
  disposeTile: adapter.disposeTile,
});

const path = [
  { label: 'center', e: 611500, n: 6677500 },
  { label: 'east', e: 612500, n: 6677500 },
  { label: 'north-east', e: 612500, n: 6678500 },
  { label: 'west', e: 610500, n: 6677500 },
  { label: 'center-return', e: 611500, n: 6677500 },
];

const report = await runStreamingResourcePressureHarness({
  scheduler,
  tiles,
  path,
  resourceSnapshot: () => adapter.snapshot().budget,
});

assert.equal(report.schema, 'nwe.streaming-resource-pressure-harness/0.1');
assert.equal(report.sampleCount, path.length);
assert.equal(report.tileCount, 9);
assert.ok(report.summary.peakActiveLoads <= 2);
assert.equal(report.summary.residentBudgetOvercommitBytes, 0);
assert.equal(report.summary.cacheBudgetOvercommitBytes, 0);
assert.ok(report.summary.loadAdmissionDeferrals > 0);
assert.ok(report.summary.evictions > 0);
assert.ok(materialized.length > 2);
assert.ok(disposed.length > 0);
for (const sample of report.samples) {
  assert.ok(sample.scheduler.bytesResident <= 200);
  assert.ok(sample.scheduler.bytesCached <= 100);
  assert.ok(sample.resource.committedBytes + sample.resource.reservedBytes <= 200);
  assert.equal(sample.resource.overcommitBytes, 0);
}
assert.equal(report.summary.finalActiveLoads, 0);

console.log('streaming resource pressure harness regressions: PASS (1 case)');
