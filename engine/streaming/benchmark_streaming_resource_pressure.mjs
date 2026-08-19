import { TileStreamingScheduler, createSquareTileGrid } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';
import { runStreamingResourcePressureHarness } from './streaming_resource_pressure_harness.mjs';

const MiB = 1024 * 1024;
const tileBytes = 4.25 * MiB;
const tiles = createSquareTileGrid({ originE: 611500, originN: 6677500, tileSizeMeters: 1000, radius: 1, idPrefix: 'nannestad-synthetic-pressure' });
const adapter = createRetainedBudgetLifecycleAdapter({
  maxRetainedBytes: 3 * tileBytes,
  estimateTileBytes() { return tileBytes; },
  async loadTile(tile) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { payload: { tileId: tile.id, verifiedFixture: true }, byteSize: tileBytes };
  },
  async disposeTile() {},
});
const scheduler = new TileStreamingScheduler({
  activeRadiusMeters: 1100,
  retainRadiusMeters: 1500,
  maxConcurrentLoads: 2,
  maxResidentTiles: 2,
  maxResidentBytes: 2 * tileBytes,
  maxCacheBytes: tileBytes,
  admitLoad: adapter.tryAdmitLoad,
  loadTile: adapter.loadTile,
  disposeTile: adapter.disposeTile,
});
const path = [
  { label: 'center', e: 611500, n: 6677500 },
  { label: 'east', e: 612500, n: 6677500 },
  { label: 'north-east', e: 612500, n: 6678500 },
  { label: 'north', e: 611500, n: 6678500 },
  { label: 'west', e: 610500, n: 6677500 },
  { label: 'center-return', e: 611500, n: 6677500 },
];

const report = await runStreamingResourcePressureHarness({ scheduler, tiles, path, resourceSnapshot: () => adapter.snapshot().budget });
const budget = adapter.snapshot().budget;
if (report.summary.peakActiveLoads > 2) throw new Error('bounded concurrency violated');
if (report.summary.residentBudgetOvercommitBytes !== 0) throw new Error('resident budget overcommit');
if (report.summary.cacheBudgetOvercommitBytes !== 0) throw new Error('cache budget overcommit');
if (budget.overcommitBytes !== 0) throw new Error('retained budget overcommit');

console.log(JSON.stringify({
  schema: 'nwe.streaming-multi-tile-resource-pressure-benchmark/0.1',
  scope: 'synthetic 3x3 scheduler/admission/cache pressure; no neighboring terrain or production budget claim',
  tileBytes,
  retainedCapBytes: 3 * tileBytes,
  residentCapBytes: 2 * tileBytes,
  cacheCapBytes: tileBytes,
  path,
  report,
  finalRetainedBudget: budget,
}, null, 2));
