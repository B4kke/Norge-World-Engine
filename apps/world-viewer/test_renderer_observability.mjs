import assert from 'node:assert/strict';
import { byteLengthOf, createFrameGapMonitor, percentile, summarizeFrameGaps } from './src/rendererObservability.mjs';

assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
assert.equal(percentile([10, 20, 30, 40], 0.95), 38.5);
assert.equal(percentile([7], 0.99), 7);
assert.equal(percentile([], 0.5), null);
assert.throws(() => percentile([1], 1.1), /quantile/);
assert.deepEqual(summarizeFrameGaps([16, 18, 20, 100]), {
  samples: 4,
  p50_ms: 19,
  p95_ms: 88,
  p99_ms: 97.6,
  largest_ms: 100,
});
assert.equal(byteLengthOf(new Uint8Array(4), new Float32Array(3), null), 16);

const callbacks = new Map();
let nextId = 1;
const requestFrame = (callback) => {
  const id = nextId++;
  callbacks.set(id, callback);
  return id;
};
const cancelFrame = (id) => callbacks.delete(id);
const monitor = createFrameGapMonitor({ requestFrame, cancelFrame });
monitor.start();
for (const timestamp of [0, 16, 33, 80]) {
  const [id, callback] = callbacks.entries().next().value;
  callbacks.delete(id);
  callback(timestamp);
}
const summary = monitor.stop();
assert.equal(summary.samples, 3);
assert.equal(summary.p50_ms, 17);
assert.equal(summary.largest_ms, 47);
console.log('renderer observability regression: PASS');
