import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const TILE_BYTES = 100;
const MAX_RETAINED_BYTES = 2 * TILE_BYTES;
const MAX_CONCURRENT_LOADS = 2;

async function waitUntil(predicate, label, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const materializationStarts = [];
const schedulerEvents = [];
const budgetEvents = [];
const disposalOrder = [];

const adapter = createRetainedBudgetLifecycleAdapter({
  maxRetainedBytes: MAX_RETAINED_BYTES,
  estimateTileBytes: () => TILE_BYTES,
  loadTile: async (tile) => {
    materializationStarts.push(tile.id);
    return { payload: { id: tile.id }, byteSize: TILE_BYTES };
  },
  disposeTile: async (tile) => {
    disposalOrder.push(tile.id);
  },
  onEvent: (event) => budgetEvents.push(event),
});

const scheduler = new TileStreamingScheduler({
  activeRadiusMeters: 160,
  retainRadiusMeters: 1200,
  maxConcurrentLoads: MAX_CONCURRENT_LOADS,
  maxResidentTiles: 2,
  maxResidentBytes: 2 * TILE_BYTES,
  maxCacheBytes: 2 * TILE_BYTES,
  admitLoad: adapter.tryAdmitLoad,
  loadTile: adapter.loadTile,
  disposeTile: adapter.disposeTile,
  onEvent: (event) => schedulerEvents.push(event),
});

const tiles = [
  { id: 'A', centerE: -50, centerN: 0 },
  { id: 'B', centerE: 50, centerN: 0 },
  { id: 'C', centerE: 950, centerN: 0 },
  { id: 'E', centerE: 1050, centerN: 0 },
  { id: 'D', centerE: 2000, centerN: 0 },
];

await scheduler.update({ e: 0, n: 0 }, tiles);
await scheduler.whenIdle();
if (adapter.snapshot().budget.committedBytes !== MAX_RETAINED_BYTES) {
  throw new Error('setup failed to fill retained-byte budget');
}

await scheduler.update({ e: 1000, n: 0 }, tiles);
const pressureSnapshot = scheduler.snapshot();
const pressureAdapter = adapter.snapshot();
if (pressureSnapshot.metrics.activeLoads !== 0) {
  throw new Error('budget-deferred candidates consumed scheduler load slots');
}
if (pressureSnapshot.metrics.queueDepth !== 2) {
  throw new Error(`expected two budget-deferred queued candidates, got ${pressureSnapshot.metrics.queueDepth}`);
}
if (pressureAdapter.waitingLoads !== 0 || pressureAdapter.preAdmittedLoads !== 0) {
  throw new Error('non-blocking scheduler admission unexpectedly created adapter waiters/reservations');
}
if (materializationStarts.some((id) => id === 'C' || id === 'E')) {
  throw new Error('budget-deferred stale candidates materialized before capacity existed');
}

await scheduler.update({ e: 2000, n: 0 }, tiles);
await waitUntil(() => materializationStarts.includes('D'), 'reprioritized desired tile materialization');
await scheduler.whenIdle();

const staleMaterializationsBeforeD = materializationStarts
  .slice(0, materializationStarts.indexOf('D'))
  .filter((id) => id === 'C' || id === 'E').length;
if (staleMaterializationsBeforeD !== 0) {
  throw new Error('stale budget-deferred candidate materialized before reprioritized tile D');
}

await scheduler.update({ e: 4000, n: 0 }, tiles);
await scheduler.whenIdle();

const finalSnapshot = scheduler.snapshot();
const finalAdapterSnapshot = adapter.snapshot();
const report = {
  schema: 'nwe.streaming-retained-admission-priority-benchmark/0.2',
  scope: 'synthetic scheduler+retained-adapter pressure; no production budget or neighbouring-terrain claim',
  configuration: {
    tileBytes: TILE_BYTES,
    maxRetainedBytes: MAX_RETAINED_BYTES,
    maxConcurrentLoads: MAX_CONCURRENT_LOADS,
    activeRadiusMeters: 160,
    retainRadiusMeters: 1200,
  },
  evidence: {
    deferredQueueDepthAtPressure: pressureSnapshot.metrics.queueDepth,
    activeLoadsAtPressure: pressureSnapshot.metrics.activeLoads,
    adapterWaitingLoadsAtPressure: pressureAdapter.waitingLoads,
    preAdmittedLoadsAtPressure: pressureAdapter.preAdmittedLoads,
    staleMaterializationsBeforeCurrentDesiredTile: staleMaterializationsBeforeD,
    currentDesiredTileStarted: materializationStarts.includes('D'),
    materializationStarts,
    disposalOrder,
    schedulerAdmissionDeferrals: finalSnapshot.metrics.loadAdmissionDeferrals,
    schedulerAdmissionFailures: finalSnapshot.metrics.loadAdmissionFailures,
    preAdmissionsGranted: finalAdapterSnapshot.metrics.preAdmissionsGranted,
    preAdmissionsConsumed: finalAdapterSnapshot.metrics.preAdmissionsConsumed,
  },
  final: {
    activeLoads: finalSnapshot.metrics.activeLoads,
    queueDepth: finalSnapshot.metrics.queueDepth,
    retainedBudget: finalAdapterSnapshot.budget,
    schedulerMetrics: finalSnapshot.metrics,
  },
  interpretation: {
    fact: 'retained-budget deferrals remain in the scheduler priority queue without consuming activeLoads, and camera reprioritization selects D once capacity is released',
    consequence: 'the previously reproduced FIFO waiter slot-blocking mechanism is removed without moving retained-byte policy into scheduler core',
    notProven: 'production impact magnitude, optimal admission policy, production retained-byte cap, or device/GPU behavior',
  },
};

if (report.final.activeLoads !== 0 || report.final.queueDepth !== 0) {
  throw new Error('benchmark cleanup left scheduler work active');
}
if (report.final.retainedBudget.reservedBytes !== 0) throw new Error('benchmark cleanup leaked retained-byte reservations');
if (report.final.retainedBudget.overcommitBytes !== 0) throw new Error('benchmark exceeded retained-byte accounting cap');

console.log(JSON.stringify(report, null, 2));
