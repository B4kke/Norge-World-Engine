import { TileStreamingScheduler, createSquareTileGrid } from './tile_scheduler.mjs';

const MiB = 1024 * 1024;
const tiles = createSquareTileGrid({
  originE: 611500,
  originN: 6677500,
  tileSizeMeters: 1000,
  radius: 1,
  idPrefix: 'nannestad-p0',
});

const events = [];
const scheduler = new TileStreamingScheduler({
  activeRadiusMeters: 1100,
  retainRadiusMeters: 1700,
  maxConcurrentLoads: 2,
  maxResidentTiles: 5,
  maxCacheBytes: 24 * MiB,
  loadTile: async (tile) => {
    // Synthetic only: models a verified terrain+vector tile payload at roughly
    // the current Prototype-0 artifact order of magnitude. It does not claim
    // that neighbour tiles have been compiled yet.
    await new Promise((resolve) => setTimeout(resolve, 1));
    return {
      payload: { id: tile.id, verified: true },
      byteSize: 4.25 * MiB,
    };
  },
  onEvent: (event) => events.push(event),
});

const path = [
  { label: 'center', e: 611500, n: 6677500 },
  { label: 'east', e: 612500, n: 6677500 },
  { label: 'north-east', e: 612500, n: 6678500 },
  { label: 'center-return', e: 611500, n: 6677500 },
];

const samples = [];
for (const camera of path) {
  await scheduler.update(camera, tiles);
  const snapshot = await scheduler.whenIdle();
  samples.push({
    label: camera.label,
    resident: snapshot.records.filter((record) => record.state === 'resident').map((record) => record.id),
    cached: snapshot.records.filter((record) => record.state === 'cached').map((record) => record.id),
    metrics: snapshot.metrics,
  });
}

const finalSnapshot = scheduler.snapshot();
const report = {
  schema: 'nwe.streaming-scheduler-benchmark/0.1',
  scope: 'synthetic 3x3 scheduler lifecycle; no neighbouring geodata claim',
  tile_count: tiles.length,
  camera_path: path,
  samples,
  final_metrics: finalSnapshot.metrics,
  event_counts: Object.fromEntries(
    [...new Set(events.map((event) => event.type))]
      .sort()
      .map((type) => [type, events.filter((event) => event.type === type).length]),
  ),
};

if (report.final_metrics.peakActiveLoads > 2) throw new Error('concurrency cap violated');
if (report.final_metrics.bytesCached > 24 * MiB) throw new Error('cache budget violated at rest');
if (report.final_metrics.cacheHits < 1) throw new Error('camera return produced no cache reuse');
if (report.final_metrics.evictions < 1) throw new Error('camera path produced no eviction evidence');

console.log(JSON.stringify(report, null, 2));
