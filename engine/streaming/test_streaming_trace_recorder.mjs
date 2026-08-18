import assert from 'node:assert/strict';

import { createStreamingTraceRecorder } from './streaming_trace_recorder.mjs';
import { createObservedTerrainTileLoadFunction } from './terrain_load_observer.mjs';
import { TileStreamingScheduler } from './tile_scheduler.mjs';

function deterministicClock() {
  let now = 0;
  return () => ++now;
}

async function testMovementCorrelatesSchedulerAndLoadAttempts() {
  const clock = deterministicClock();
  const recorder = createStreamingTraceRecorder({ clock, maxEntries: 64 });
  const tiles = [
    { id: 'a', centerE: 0, centerN: 0 },
    { id: 'b', centerE: 1000, centerN: 0 },
  ];

  const loadTile = createObservedTerrainTileLoadFunction({
    clock,
    onObservation: recorder.onLoadObservation,
    loadTile: async (tile) => ({
      byteSize: 100,
      payload: {
        artifact: { sha256: tile.id.repeat(64).slice(0, 64) },
        timingMs: { verify: 2, decode: 3, workerRoundtrip: 4, total: 10 },
      },
    }),
  });

  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 150,
    retainRadiusMeters: 1500,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    clock,
    onEvent: recorder.onSchedulerEvent,
    loadTile,
  });

  await scheduler.update({ e: 0, n: 0 }, tiles);
  recorder.captureSnapshot(await scheduler.whenIdle(), 'at-a');
  await scheduler.update({ e: 1000, n: 0 }, tiles);
  recorder.captureSnapshot(await scheduler.whenIdle(), 'at-b');
  await scheduler.update({ e: 0, n: 0 }, tiles);
  recorder.captureSnapshot(await scheduler.whenIdle(), 'back-at-a');

  const trace = recorder.exportTrace({ path: 'a-b-a' });
  const loadObservations = trace.entries.filter((entry) => entry.kind === 'terrain-load-observation');
  const events = trace.entries.filter((entry) => entry.kind === 'scheduler-event').map((entry) => entry.payload);
  const snapshots = trace.entries.filter((entry) => entry.kind === 'scheduler-snapshot');

  assert.equal(trace.schema, 'nwe.streaming-movement-trace/0.1');
  assert.equal(trace.metadata.path, 'a-b-a');
  assert.equal(loadObservations.length, 2, 'returning to A must be a cache hit, not a third load');
  assert.deepEqual(loadObservations.map((entry) => [entry.payload.tileId, entry.payload.attempt]), [['a', 1], ['b', 1]]);
  assert.equal(events.filter((event) => event.type === 'load-started').length, 2);
  assert.equal(events.filter((event) => event.type === 'tile-activated').length, 3);
  assert.equal(events.filter((event) => event.type === 'tile-deactivated').length, 2);
  assert.equal(snapshots.length, 3);

  const finalSnapshot = snapshots.at(-1).payload.snapshot;
  assert.equal(finalSnapshot.metrics.cacheHits, 1);
  assert.equal(finalSnapshot.metrics.loadsStarted, 2);
  assert.equal(finalSnapshot.metrics.bytesResident, 100);
  assert.equal(finalSnapshot.metrics.bytesCached, 100);
  assert.equal(finalSnapshot.records.find((record) => record.id === 'a').state, 'resident');
  assert.equal(finalSnapshot.records.find((record) => record.id === 'b').state, 'cached');
}

function testTraceRetentionIsHardBounded() {
  const recorder = createStreamingTraceRecorder({ clock: deterministicClock(), maxEntries: 3 });
  recorder.onSchedulerEvent({ type: 'one' });
  recorder.onSchedulerEvent({ type: 'two' });
  recorder.onSchedulerEvent({ type: 'three' });
  recorder.onSchedulerEvent({ type: 'four' });
  recorder.onSchedulerEvent({ type: 'five' });

  const trace = recorder.exportTrace();
  assert.equal(trace.retainedEntries, 3);
  assert.equal(trace.droppedEntries, 2);
  assert.equal(trace.firstSequence, 3);
  assert.equal(trace.lastSequence, 5);
  assert.deepEqual(trace.entries.map((entry) => entry.payload.type), ['three', 'four', 'five']);
}

function testExportIsDetachedFromMutableInputs() {
  const recorder = createStreamingTraceRecorder({ clock: deterministicClock(), maxEntries: 4 });
  const event = { type: 'load-started', nested: { attempt: 1 } };
  recorder.onSchedulerEvent(event);
  event.nested.attempt = 99;

  const trace = recorder.exportTrace({ device: { class: 'test' } });
  assert.equal(trace.entries[0].payload.nested.attempt, 1);
  assert.equal(trace.metadata.device.class, 'test');
}

await testMovementCorrelatesSchedulerAndLoadAttempts();
testTraceRetentionIsHardBounded();
testExportIsDetachedFromMutableInputs();
console.log('streaming trace recorder regressions: PASS (3 cases)');
