import assert from 'node:assert/strict';
import { observeStreamingLifecycleAdapters } from './lifecycle_observer.mjs';
import { createStreamingTraceRecorder } from './streaming_trace_recorder.mjs';

{
  const observations = [];
  const times = [10, 13, 20, 25, 30, 37];
  const calls = [];
  const adapters = observeStreamingLifecycleAdapters({
    clock: () => times.shift(),
    onObservation: (observation) => observations.push(observation),
    activateTile: async (tile, payload, context) => { calls.push(['activate', tile.id, payload, context.reason]); return payload; },
    deactivateTile: async (tile, payload, context) => { calls.push(['deactivate', tile.id, payload, context.reason]); },
    disposeTile: async (tile, payload, context) => { calls.push(['dispose', tile.id, payload, context.reason]); },
  });
  const tile = { id: 'tile-a' };
  const payload = { mesh: true };
  assert.equal(await adapters.activateTile(tile, payload, { reason: 'cache-hit' }), payload);
  await adapters.deactivateTile(tile, payload, { reason: 'interest-lost' });
  await adapters.disposeTile(tile, payload, { reason: 'outside-retain-radius' });
  assert.deepEqual(calls.map((call) => [call[0], call[1], call[3]]), [
    ['activate', 'tile-a', 'cache-hit'],
    ['deactivate', 'tile-a', 'interest-lost'],
    ['dispose', 'tile-a', 'outside-retain-radius'],
  ]);
  assert.deepEqual(observations.map(({ phase, status, durationMs, reason }) => ({ phase, status, durationMs, reason })), [
    { phase: 'activate', status: 'completed', durationMs: 3, reason: 'cache-hit' },
    { phase: 'deactivate', status: 'completed', durationMs: 5, reason: 'interest-lost' },
    { phase: 'dispose', status: 'completed', durationMs: 7, reason: 'outside-retain-radius' },
  ]);
}

{
  const observations = [];
  const expected = Object.assign(new Error('gpu release failed'), { code: 'GPU_RELEASE_FAILED' });
  const adapters = observeStreamingLifecycleAdapters({
    clock: (() => { const times = [100, 109]; return () => times.shift(); })(),
    onObservation: (observation) => observations.push(observation),
    deactivateTile: async () => { throw expected; },
  });
  await assert.rejects(() => adapters.deactivateTile({ id: 'tile-b' }, {}, { reason: 'interest-lost' }), (error) => error === expected);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0].error, { name: 'Error', code: 'GPU_RELEASE_FAILED', message: 'gpu release failed' });
  assert.equal(observations[0].durationMs, 9);
}

{
  let activated = 0;
  const adapters = observeStreamingLifecycleAdapters({
    onObservation: () => { throw new Error('telemetry sink unavailable'); },
    activateTile: async () => { activated += 1; return 42; },
  });
  assert.equal(await adapters.activateTile({ id: 'tile-c' }, {}, { reason: 'load-complete' }), 42);
  assert.equal(activated, 1);
}

{
  const observations = [];
  const adapters = observeStreamingLifecycleAdapters({
    clock: (() => { const times = [50, 49]; return () => times.shift(); })(),
    onObservation: (observation) => observations.push(observation),
  });
  await adapters.disposeTile({ id: 'tile-d' }, {}, { reason: 'test' });
  assert.equal(observations[0].durationMs, 0);
}

{
  const recorder = createStreamingTraceRecorder({ clock: () => 123, maxEntries: 4 });
  const adapters = observeStreamingLifecycleAdapters({
    clock: (() => { const times = [1, 3]; return () => times.shift(); })(),
    onObservation: recorder.onLifecycleObservation,
  });
  await adapters.activateTile({ id: 'tile-e' }, {}, { reason: 'cache-hit' });
  const trace = recorder.exportTrace({ device: 'test' });
  assert.equal(trace.entries.length, 1);
  assert.equal(trace.entries[0].kind, 'lifecycle-observation');
  assert.equal(trace.entries[0].payload.phase, 'activate');
  assert.equal(trace.entries[0].payload.durationMs, 2);
}

console.log('streaming lifecycle observer regressions: PASS (5 cases)');
