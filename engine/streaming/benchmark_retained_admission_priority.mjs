import { TileStreamingScheduler } from './tile_scheduler.mjs';
import { createRetainedBudgetLifecycleAdapter } from './retained_budget_lifecycle_adapter.mjs';

const TILE_BYTES = 100;
const MAX_RETAINED_BYTES = 2 * TILE_BYTES;
const MAX_CONCURRENT_LOADS = 2;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitUntil(predicate, label, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const staleMaterializationGate = deferred();
const materializationStarts = [];
const schedulerEvents = [];
const budgetEvents = [];
const disposalOrder = [];

const adapter = createRetainedBudgetLifecycleAdapter({
  maxRetainedBytes: MAX_RETAINED_BYTES,
  estimateTileBytes: async () => TILE_BYTES,
  loadTile: async (tile) => {
    materializationStarts.push(tile.id);
    if (tile.id === 'C' || tile.id === 'E') await staleMaterializationGate.promise;
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

// Phase 1: fill the total retained budget with two committed tiles.
await scheduler.update({ e: 0, n: 0 }, tiles);
await scheduler.whenIdle();
if (adapter.snapshot().budget.bytesCommitted !== MAX_RETAINED_BYTES) {
  throw new Error('setup failed to fill retained-byte budget');
}

// Phase 2: move one tile-width east. A/B become inactive-but-retained, while C/E
// take both scheduler load slots and queue inside the retained-budget adapter.
await scheduler.update({ e: 1000, n: 0 }, tiles);
await waitUntil(() => adapter.snapshot().waitingLoads === 2, 'two retained-budget waiters');
const waitingSnapshot = scheduler.snapshot();

// Phase 3: move to D. A/B are now outside retain radius and are disposed. Their
// released capacity is handed FIFO to the already-waiting C/E callbacks. C/E are
// no longer desired but still lie inside retain radius, so they are not aborted.
// They begin materializing and deliberately remain blocked, occupying both
// scheduler load slots before newly desired D can start.
await scheduler.update({ e: 2000, n: 0 }, tiles);
await waitUntil(
  () => materializationStarts.includes('C') && materializationStarts.includes('E'),
  'stale waiter materializations',
);

const blockedSnapshot = scheduler.snapshot();
const dStartedBeforeRelease = schedulerEvents.some(
  (event) => event.type === 'load-started' && event.tileId === 'D',
);
const staleStartedBeforeD = materializationStarts.filter((id) => id === 'C' || id === 'E').length;

if (dStartedBeforeRelease) throw new Error('benchmark failed to reproduce occupied-slot priority blocking');
if (staleStartedBeforeD !== 2) throw new Error('expected both stale waiters to materialize before D');
if (adapter.snapshot().budget.bytesReserved !== MAX_RETAINED_BYTES) {
  throw new Error('expected released retained capacity to be reserved by stale waiters');
}

// Cleanup: release C/E, then move far enough to cancel/evict any leftover work so
// the benchmark exits with no unresolved scheduler lifecycle.
staleMaterializationGate.resolve();
await scheduler.whenIdle();
await scheduler.update({ e: 4000, n: 0 }, tiles);
await scheduler.whenIdle();

const finalSnapshot = scheduler.snapshot();
const report = {
  schema: 'nwe.streaming-retained-admission-priority-benchmark/0.1',
  scope: 'synthetic scheduler+retained-adapter pressure; no production budget or neighbouring-terrain claim',
  configuration: {
    tileBytes: TILE_BYTES,
    maxRetainedBytes: MAX_RETAINED_BYTES,
    maxConcurrentLoads: MAX_CONCURRENT_LOADS,
    activeRadiusMeters: 160,
    retainRadiusMeters: 1200,
  },
  evidence: {
    waitingLoadsBeforeReprioritization: adapter.snapshot().metrics.waitsQueued,
    occupiedSlotsAtPressure: waitingSnapshot.activeLoads,
    staleMaterializationsBeforeCurrentDesiredTile: staleStartedBeforeD,
    currentDesiredTileStartedBeforeStaleRelease: dStartedBeforeRelease,
    blockedPhaseActiveLoads: blockedSnapshot.activeLoads,
    blockedPhaseQueueDepth: blockedSnapshot.queueDepth,
    materializationStarts,
    disposalOrder,
    budgetWaitsQueued: adapter.snapshot().metrics.waitsQueued,
    budgetWaitsGranted: adapter.snapshot().metrics.waitsGranted,
    budgetWaitsCancelled: adapter.snapshot().metrics.waitsCancelled,
  },
  final: {
    activeLoads: finalSnapshot.activeLoads,
    queueDepth: finalSnapshot.queueDepth,
    retainedBudget: adapter.snapshot().budget,
    schedulerMetrics: finalSnapshot.metrics,
  },
  interpretation: {
    fact: 'already-started retained-budget waiters can consume all scheduler load slots and preserve FIFO admission across camera reprioritization',
    consequence: 'a newly desired higher-priority tile can be delayed behind stale-but-retained waiters until at least one occupied slot completes or is cancelled',
    notProven: 'production impact magnitude, optimal admission policy, production retained-byte cap, or device/GPU behavior',
  },
};

if (report.final.activeLoads !== 0 || report.final.queueDepth !== 0) {
  throw new Error('benchmark cleanup left scheduler work active');
}
if (report.final.retainedBudget.bytesReserved !== 0) throw new Error('benchmark cleanup leaked retained-byte reservations');

console.log(JSON.stringify(report, null, 2));
