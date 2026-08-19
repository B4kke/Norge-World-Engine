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

await scheduler.update({ e: 0, n: 0 }, tiles);
await scheduler.whenIdle();
if (adapter.snapshot().budget.committedBytes !== MAX_RETAINED_BYTES) {
  throw new Error('setup failed to fill retained-byte budget');
}

await scheduler.update({ e: 1000, n: 0 }, tiles);
await waitUntil(() => adapter.snapshot().waitingLoads === 2, 'two retained-budget waiters');
const waitingSnapshot = scheduler.snapshot();

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
if (adapter.snapshot().budget.reservedBytes !== MAX_RETAINED_BYTES) {
  throw new Error('expected released retained capacity to be reserved by stale waiters');
}

staleMaterializationGate.resolve();
await waitUntil(
  () => schedulerEvents.filter((event) => event.type === 'load-completed' && (event.tileId === 'C' || event.tileId === 'E')).length === 2,
  'stale waiter completions',
);
await scheduler.update({ e: 4000, n: 0 }, tiles);
await scheduler.whenIdle();

const finalSnapshot = scheduler.snapshot();
const finalAdapterSnapshot = adapter.snapshot();
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
    waitingLoadsBeforeReprioritization: 2,
    occupiedSlotsAtPressure: waitingSnapshot.activeLoads,
    staleMaterializationsBeforeCurrentDesiredTile: staleStartedBeforeD,
    currentDesiredTileStartedBeforeStaleRelease: dStartedBeforeRelease,
    blockedPhaseActiveLoads: blockedSnapshot.activeLoads,
    blockedPhaseQueueDepth: blockedSnapshot.queueDepth,
    materializationStarts,
    disposalOrder,
    budgetWaitsQueued: finalAdapterSnapshot.metrics.waitsQueued,
    budgetWaitsGranted: finalAdapterSnapshot.metrics.waitsGranted,
    budgetWaitsCancelled: finalAdapterSnapshot.metrics.waitsCancelled,
  },
  final: {
    activeLoads: finalSnapshot.activeLoads,
    queueDepth: finalSnapshot.queueDepth,
    retainedBudget: finalAdapterSnapshot.budget,
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
if (report.final.retainedBudget.reservedBytes !== 0) throw new Error('benchmark cleanup leaked retained-byte reservations');

console.log(JSON.stringify(report, null, 2));
