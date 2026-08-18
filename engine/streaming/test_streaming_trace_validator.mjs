import assert from 'node:assert/strict';

import {
  validateCompletedStreamingMovementCapture,
  validateStreamingMovementTrace,
} from './streaming_trace_validator.mjs';

function makeTrace({
  droppedEntries = 0,
  entries = null,
  maxEntries = 32,
} = {}) {
  const actualEntries = entries ?? [
    { sequence: 1, recordedAt: 1, kind: 'scheduler-event', payload: { type: 'load-started', tileId: 'a', attempt: 1 } },
    { sequence: 2, recordedAt: 2, kind: 'terrain-load-observation', payload: { tileId: 'a', attempt: 1, status: 'completed' } },
    {
      sequence: 3,
      recordedAt: 3,
      kind: 'scheduler-snapshot',
      payload: { label: 'done', snapshot: { metrics: { activeLoads: 0, queueDepth: 0 } } },
    },
  ];
  return {
    schema: 'nwe.streaming-movement-trace/0.1',
    metadata: { path: 'fixture' },
    maxEntries,
    retainedEntries: actualEntries.length,
    droppedEntries,
    firstSequence: actualEntries[0]?.sequence ?? null,
    lastSequence: actualEntries.at(-1)?.sequence ?? null,
    entries: actualEntries,
  };
}

function testCompleteCaptureAccepted() {
  const result = validateCompletedStreamingMovementCapture(makeTrace());
  assert.equal(result.ok, true);
  assert.equal(result.code, 'TRACE_ACCEPTED');
  assert.equal(result.summary.loadStarts, 1);
  assert.equal(result.summary.loadObservations, 1);
  assert.equal(result.summary.snapshots, 1);
}

function testDroppedEvidenceRejected() {
  const result = validateCompletedStreamingMovementCapture(makeTrace({ droppedEntries: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_DROPPED_ENTRIES');
}

function testMissingObservationRejected() {
  const trace = makeTrace();
  trace.entries = trace.entries.filter((entry) => entry.kind !== 'terrain-load-observation');
  trace.entries[1].sequence = 2;
  trace.retainedEntries = 2;
  trace.firstSequence = 1;
  trace.lastSequence = 2;
  const result = validateCompletedStreamingMovementCapture(trace);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_REQUIRED_KIND_MISSING');
}

function testFinalSnapshotMustBeIdle() {
  const trace = makeTrace();
  trace.entries.at(-1).payload.snapshot.metrics.activeLoads = 1;
  const result = validateCompletedStreamingMovementCapture(trace);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_FINAL_SNAPSHOT_NOT_IDLE');
}

function testSequenceGapRejectedEvenWhenRetentionMetadataMatches() {
  const trace = makeTrace();
  trace.entries[1].sequence = 4;
  trace.entries[2].sequence = 5;
  trace.lastSequence = 5;
  const result = validateStreamingMovementTrace(trace);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_SEQUENCE_GAP');
}

function testUnmatchedObservationRejected() {
  const trace = makeTrace();
  trace.entries[1].payload.tileId = 'b';
  const result = validateCompletedStreamingMovementCapture(trace);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_LOAD_OBSERVATION_MISSING');
  assert.equal(result.issues.some((candidate) => candidate.code === 'TRACE_LOAD_START_MISSING'), true);
}

testCompleteCaptureAccepted();
testDroppedEvidenceRejected();
testMissingObservationRejected();
testFinalSnapshotMustBeIdle();
testSequenceGapRejectedEvenWhenRetentionMetadataMatches();
testUnmatchedObservationRejected();
console.log('streaming trace validator regressions: PASS (6 cases)');
