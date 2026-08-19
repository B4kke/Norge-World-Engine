import assert from 'node:assert/strict';
import {
  DECODE_PLACEMENT_DEFAULT_ITERATIONS,
  normalizeDecodePlacementIterations,
  runBrowserDecodePlacementExperiment,
} from './src/browserDecodePlacementExperiment.mjs';

class FakeWorker {
  constructor() {
    this.listeners = new Map([['message', new Set()], ['error', new Set()]]);
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message) {
    const bytes = new Uint8Array(message.bytes);
    queueMicrotask(() => {
      try {
        const artifact = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        for (const listener of this.listeners.get('message')) {
          listener({ data: { id: message.id, status: 'PASS', worker_decode_ms: 0.25, artifact } });
        }
      } catch (error) {
        for (const listener of this.listeners.get('message')) {
          listener({ data: { id: message.id, status: 'ERROR', error: String(error) } });
        }
      }
    });
  }

  terminate() {
    this.terminated = true;
  }
}

assert.equal(normalizeDecodePlacementIterations(DECODE_PLACEMENT_DEFAULT_ITERATIONS), 20);
assert.equal(normalizeDecodePlacementIterations('3'), 3);
assert.throws(() => normalizeDecodePlacementIterations(0), /within/);
assert.throws(() => normalizeDecodePlacementIterations(41), /within/);
assert.throws(() => normalizeDecodePlacementIterations(1.5), /within/);

const bytes = new TextEncoder().encode(JSON.stringify({ schema: 'fixture', roads: [{ id: 1 }, { id: 2 }] }));
let clock = 0;
const now = () => {
  clock += 0.5;
  return clock;
};
let worker;
const report = await runBrowserDecodePlacementExperiment({
  bytes,
  artifactSha256: 'a'.repeat(64),
  iterations: 3,
  now,
  requestFrame: null,
  cancelFrame: null,
  workerFactory: () => {
    worker = new FakeWorker();
    return worker;
  },
});

assert.equal(report.schema, 'nwe.browser-decode-placement-experiment/0.1');
assert.equal(report.status, 'PASS');
assert.equal(report.experiment_only, true);
assert.equal(report.production_policy_selected, false);
assert.equal(report.provenance_reverified_in_experiment, false);
assert.equal(report.iterations, 3);
assert.equal(report.main_thread.per_iteration_ms.samples, 3);
assert.equal(report.worker_roundtrip.roundtrip_ms.samples, 3);
assert.equal(report.worker_roundtrip.worker_decode_ms.samples, 3);
assert.equal(report.artifact_sha256, 'a'.repeat(64));
assert.equal(worker.terminated, true);

await assert.rejects(
  runBrowserDecodePlacementExperiment({ bytes: new Uint8Array(), workerFactory: () => new FakeWorker() }),
  /non-empty Uint8Array/,
);

console.log('browser decode placement regressions: PASS');
