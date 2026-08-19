import assert from 'node:assert/strict';

import {
  validateCompletedStreamingMovementCapture,
  validateRendererLifecycleMovementCapture,
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

function makeLifecycleTrace({ lifecycleReason = 'load-complete', schedulerReason = 'load-complete' } = {}) {
  return makeTrace({ entries: [
    { sequence: 1, recordedAt: 1, kind: 'scheduler-event', payload: { type: 'load-started', tileId: 'a', attempt: 1 } },
    { sequence: 2, recordedAt: 2, kind: 'terrain-load-observation', payload: { tileId: 'a', attempt: 1, status: 'completed' } },
    { sequence: 3, recordedAt: 3, kind: 'lifecycle-observation', payload: { phase: 'activate', status: 'completed', tileId: 'a', reason: lifecycleReason, durationMs: 4 } },
    { sequence: 4, recordedAt: 4, kind: 'scheduler-event', payload: { type: 'tile-activated', tileId: 'a', reason: schedulerReason } },
    { sequence: 5, recordedAt: 5, kind: 'lifecycle-observation', payload: { phase: 'deactivate', status: 'completed', tileId: 'a', reason: 'interest-lost', durationMs: 2 } },
    { sequence: 6, recordedAt: 6, kind: 'scheduler-event', payload: { type: 'tile-deactivated', tileId: 'a', reason: 'interest-lost' } },
    {
      sequence: 7,
      recordedAt: 7,
      kind: 'scheduler-snapshot',
      payload: { label: 'done', snapshot: { metrics: { activeLoads: 0, queueDepth: 0 } } },
    },
  ] });
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

function testRendererLifecycleCaptureAccepted() {
  const result = validateRendererLifecycleMovementCapture(makeLifecycleTrace());
  assert.equal(result.ok, true);
  assert.equal(result.code, 'TRACE_ACCEPTED');
  assert.equal(result.summary.schedulerLifecycleEvents, 2);
  assert.equal(result.summary.lifecycleObservations, 2);
}

function testRendererLifecycleKindRequired() {
  const result = validateRendererLifecycleMovementCapture(makeTrace());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_REQUIRED_KIND_MISSING');
}

function testRendererLifecycleReasonMismatchRejected() {
  const result = validateRendererLifecycleMovementCapture(makeLifecycleTrace({ lifecycleReason: 'cache-hit' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_LIFECYCLE_CORRELATION_MISMATCH');
  assert.equal(result.issues.some((candidate) => candidate.schedulerCount !== candidate.adapterCount), true);
}

function testInvalidLifecycleDurationRejected() {
  const trace = makeLifecycleTrace();
  trace.entries[2].payload.durationMs = -1;
  const result = validateRendererLifecycleMovementCapture(trace);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_LIFECYCLE_OBSERVATION_INVALID');
}

testCompleteCaptureAccepted();
testDroppedEvidenceRejected();
testMissingObservationRejected();
testFinalSnapshotMustBeIdle();
testSequenceGapRejectedEvenWhenRetentionMetadataMatches();
testUnmatchedObservationRejected();
testRendererLifecycleCaptureAccepted();
testRendererLifecycleKindRequired();
testRendererLifecycleReasonMismatchRejected();
testInvalidLifecycleDurationRejected();
console.log('streaming trace validator regressions: PASS (10 cases)');
