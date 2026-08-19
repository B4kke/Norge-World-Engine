import { TileStreamingScheduler, createSquareTileGrid } from './tile_scheduler.mjs';

const MiB = 1024 * 1024;
const tileBytes = 4.25 * MiB;
const tiles = createSquareTileGrid({
  originE: 611500,
  originN: 6677500,
  tileSizeMeters: 1000,
  radius: 1,
  idPrefix: 'nannestad-p0',
});

const path = [
  { label: 'center', e: 611500, n: 6677500 },
  { label: 'east', e: 612500, n: 6677500 },
  { label: 'north-east', e: 612500, n: 6678500 },
  { label: 'north', e: 611500, n: 6678500 },
  { label: 'west', e: 610500, n: 6677500 },
  { label: 'center-return', e: 611500, n: 6677500 },
];

const profiles = [
  {
    id: 'loose-5r-4c',
    note: 'synthetic comparison input only; not a selected production/device policy',
    maxResidentBytes: 5 * tileBytes,
    maxCacheBytes: 4 * tileBytes,
  },
  {
    id: 'balanced-2r-2c',
    note: 'synthetic comparison input only; not a selected production/device policy',
    maxResidentBytes: 2 * tileBytes,
    maxCacheBytes: 2 * tileBytes,
  },
  {
    id: 'tight-1r-1c',
    note: 'synthetic comparison input only; not a selected production/device policy',
    maxResidentBytes: tileBytes,
    maxCacheBytes: tileBytes,
  },
];

async function runProfile(profile) {
  const events = [];
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 1100,
    retainRadiusMeters: 1700,
    maxConcurrentLoads: 2,
    maxResidentTiles: 5,
    maxResidentBytes: profile.maxResidentBytes,
    maxCacheBytes: profile.maxCacheBytes,
    loadTile: async (tile) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return {
        payload: { id: tile.id, verified: true },
        byteSize: tileBytes,
      };
    },
    onEvent: (event) => events.push(event),
  });

  const samples = [];
  for (const camera of path) {
    await scheduler.update(camera, tiles);
    const snapshot = await scheduler.whenIdle();
    const retainedAtIdle = snapshot.metrics.bytesResident + snapshot.metrics.bytesCached;
    if (snapshot.metrics.retainedBytes !== retainedAtIdle) {
      throw new Error(`${profile.id}: retained byte accounting mismatch at ${camera.label}`);
    }
    if (snapshot.metrics.bytesResident > profile.maxResidentBytes) {
      throw new Error(`${profile.id}: resident byte cap exceeded at ${camera.label}`);
    }
    if (snapshot.metrics.bytesCached > profile.maxCacheBytes) {
      throw new Error(`${profile.id}: cache byte cap exceeded at ${camera.label}`);
    }
    samples.push({
      label: camera.label,
      resident_count: snapshot.records.filter((record) => record.state === 'resident').length,
      cached_count: snapshot.records.filter((record) => record.state === 'cached').length,
      bytes_resident: snapshot.metrics.bytesResident,
      bytes_cached: snapshot.metrics.bytesCached,
      retained_bytes: snapshot.metrics.retainedBytes,
      cache_hits: snapshot.metrics.cacheHits,
      evictions: snapshot.metrics.evictions,
      resident_budget_preemptions: snapshot.metrics.residentBudgetPreemptions,
    });
  }

  const final = scheduler.snapshot();
  const loadStarted = events.filter((event) => event.type === 'load-started');
  const uniqueLoadedTiles = new Set(loadStarted.map((event) => event.tileId));
  const eventCounts = Object.fromEntries(
    [...new Set(events.map((event) => event.type))]
      .sort()
      .map((type) => [type, events.filter((event) => event.type === type).length]),
  );

  const summary = {
    id: profile.id,
    max_resident_bytes: profile.maxResidentBytes,
    max_cache_bytes: profile.maxCacheBytes,
    loads_started: final.metrics.loadsStarted,
    unique_loaded_tiles: uniqueLoadedTiles.size,
    refetches: final.metrics.loadsStarted - uniqueLoadedTiles.size,
    cache_hits: final.metrics.cacheHits,
    cache_misses: final.metrics.cacheMisses,
    activations: final.metrics.activations,
    deactivations: final.metrics.deactivations,
    activation_deactivation_churn: final.metrics.activations + final.metrics.deactivations,
    evictions: final.metrics.evictions,
    resident_budget_deferrals: final.metrics.residentBudgetDeferrals,
    resident_budget_preemptions: final.metrics.residentBudgetPreemptions,
    resident_budget_preemption_failures: final.metrics.residentBudgetPreemptionFailures,
    peak_active_loads: final.metrics.peakActiveLoads,
    peak_resident_bytes: final.metrics.peakBytesResident,
    peak_cache_bytes: final.metrics.peakBytesCached,
    peak_retained_bytes: final.metrics.peakRetainedBytes,
    resident_budget_overcommit_bytes: final.metrics.residentBudgetOvercommitBytes,
    cache_budget_overcommit_bytes: final.metrics.cacheBudgetOvercommitBytes,
    final_resident_bytes: final.metrics.bytesResident,
    final_cache_bytes: final.metrics.bytesCached,
    final_retained_bytes: final.metrics.retainedBytes,
  };

  if (summary.peak_active_loads > 2) throw new Error(`${profile.id}: concurrency cap violated`);
  if (summary.resident_budget_overcommit_bytes !== 0) throw new Error(`${profile.id}: resident budget overcommitted`);
  if (summary.cache_budget_overcommit_bytes !== 0) throw new Error(`${profile.id}: cache budget overcommitted`);
  if (summary.final_resident_bytes > profile.maxResidentBytes) throw new Error(`${profile.id}: final resident cap violated`);
  if (summary.final_cache_bytes > profile.maxCacheBytes) throw new Error(`${profile.id}: final cache cap violated`);
  if (summary.final_retained_bytes !== summary.final_resident_bytes + summary.final_cache_bytes) {
    throw new Error(`${profile.id}: final retained byte accounting mismatch`);
  }

  return {
    profile,
    samples,
    summary,
    event_counts: eventCounts,
  };
}

const results = [];
for (const profile of profiles) results.push(await runProfile(profile));

const byId = Object.fromEntries(results.map((result) => [result.profile.id, result.summary]));
const loose = byId['loose-5r-4c'];
const balanced = byId['balanced-2r-2c'];
const tight = byId['tight-1r-1c'];

if (balanced.resident_budget_preemptions < 1 || tight.resident_budget_preemptions < 1) {
  throw new Error('constrained profiles produced no resident-budget preemption evidence');
}
if (tight.evictions < loose.evictions) {
  throw new Error('tight cache profile unexpectedly evicted fewer tiles than loose profile');
}
if (tight.refetches < loose.refetches) {
  throw new Error('tight profile unexpectedly refetched fewer tiles than loose profile');
}
if (tight.peak_retained_bytes > loose.peak_retained_bytes) {
  throw new Error('tight profile retained more peak bytes than loose profile');
}

const report = {
  schema: 'nwe.streaming-scheduler-budget-profile-benchmark/0.1',
  scope: 'synthetic 3x3 scheduler budget/churn comparison only; no neighbouring geodata or production budget claim',
  tile_count: tiles.length,
  tile_bytes: tileBytes,
  camera_path: path,
  results,
};

console.log(JSON.stringify(report, null, 2));
