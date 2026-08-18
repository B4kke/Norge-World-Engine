import assert from 'node:assert/strict';

import { createObservedTerrainTileLoadFunction } from './terrain_load_observer.mjs';

function clockFrom(values) {
  let index = 0;
  return () => {
    if (index >= values.length) throw new Error('clock exhausted');
    return values[index++];
  };
}

async function testCompletedLoadPreservesResultAndCapturesPhaseTiming() {
  const observations = [];
  const signal = new AbortController().signal;
  let receivedContext = null;
  const result = {
    byteSize: 4729120,
    payload: {
      artifact: { sha256: 'a'.repeat(64) },
      timingMs: {
        resolveInput: 44.2,
        verify: 20.1,
        decode: 137.5,
        workerRoundtrip: 72.2,
        workerReported: 49.0,
        total: 290.6,
      },
    },
  };
  const loadTile = async (_tile, context) => {
    receivedContext = context;
    return result;
  };
  const observed = createObservedTerrainTileLoadFunction({
    loadTile,
    onObservation: (observation) => observations.push(observation),
    clock: clockFrom([100, 145]),
  });

  const actual = await observed({ id: 'nannestad-center' }, { signal, attempt: 3 });
  assert.equal(actual, result, 'observer must preserve exact load result identity');
  assert.equal(receivedContext.signal, signal);
  assert.equal(receivedContext.attempt, 3);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0], {
    schema: 'nwe.terrain-load-observation/0.1',
    tileId: 'nannestad-center',
    attempt: 3,
    status: 'completed',
    durationMs: 45,
    retainedByteSize: 4729120,
    artifactSha256: 'a'.repeat(64),
    phaseTimingMs: {
      resolveInput: 44.2,
      verify: 20.1,
      decode: 137.5,
      workerRoundtrip: 72.2,
      workerReported: 49.0,
      total: 290.6,
    },
    errorName: null,
    errorCode: null,
    errorMessage: null,
  });
}

async function testFailureIsObservedAndOriginalErrorIsRethrown() {
  const observations = [];
  const failure = new Error('bundle rejected');
  failure.name = 'TerrainTileLoadError';
  failure.code = 'RUNTIME_VERIFICATION_REJECTED';
  const observed = createObservedTerrainTileLoadFunction({
    loadTile: async () => { throw failure; },
    onObservation: (observation) => observations.push(observation),
    clock: clockFrom([200, 237]),
  });

  await assert.rejects(observed({ id: 'nannestad-center' }, { attempt: 2 }), (error) => error === failure);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0], {
    schema: 'nwe.terrain-load-observation/0.1',
    tileId: 'nannestad-center',
    attempt: 2,
    status: 'failed',
    durationMs: 37,
    retainedByteSize: null,
    artifactSha256: null,
    phaseTimingMs: null,
    errorName: 'TerrainTileLoadError',
    errorCode: 'RUNTIME_VERIFICATION_REJECTED',
    errorMessage: 'bundle rejected',
  });
}

async function testAbortIsDistinguishedFromFailure() {
  const observations = [];
  const aborted = new Error('camera moved outside retain radius');
  aborted.name = 'AbortError';
  const observed = createObservedTerrainTileLoadFunction({
    loadTile: async () => { throw aborted; },
    onObservation: (observation) => observations.push(observation),
    clock: clockFrom([300, 305]),
  });

  await assert.rejects(observed({ id: 'nannestad-east' }, { attempt: 1 }), (error) => error === aborted);
  assert.equal(observations[0].status, 'aborted');
  assert.equal(observations[0].durationMs, 5);
  assert.equal(observations[0].errorName, 'AbortError');
  assert.equal(observations[0].errorCode, null);
}

async function testBrokenObserverCannotChangeLifecycleResult() {
  const result = { byteSize: 1, payload: { timingMs: { total: 1 } } };
  const observed = createObservedTerrainTileLoadFunction({
    loadTile: async () => result,
    onObservation: () => { throw new Error('telemetry sink unavailable'); },
    clock: clockFrom([400, 401]),
  });

  assert.equal(await observed({ id: 'safe-observer-boundary' }, { attempt: 1 }), result);
}

async function main() {
  await testCompletedLoadPreservesResultAndCapturesPhaseTiming();
  await testFailureIsObservedAndOriginalErrorIsRethrown();
  await testAbortIsDistinguishedFromFailure();
  await testBrokenObserverCannotChangeLifecycleResult();
  console.log('terrain load observer regressions: PASS (4 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
