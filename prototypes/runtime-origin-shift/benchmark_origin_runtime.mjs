import { performance } from 'node:perf_hooks';
import {
  createRuntimeState,
  deriveLocalPositions,
  integrateWorldState,
  maxPositionError,
  reconstructWorldFromLocal,
} from './origin_runtime.mjs';

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function seededState(count) {
  const positions = new Float64Array(count * 3);
  const velocities = new Float64Array(count * 3);
  let seed = 0x1234abcd;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = 611_500 + (random() - 0.5) * 2_000;
    positions[i * 3 + 1] = 6_677_500 + (random() - 0.5) * 2_000;
    positions[i * 3 + 2] = 190 + (random() - 0.5) * 80;
    velocities[i * 3] = (random() - 0.5) * 30;
    velocities[i * 3 + 1] = (random() - 0.5) * 30;
    velocities[i * 3 + 2] = (random() - 0.5) * 2;
  }
  return createRuntimeState(positions, velocities);
}

function sample(fn, warmup = 30, runs = 120) {
  for (let i = 0; i < warmup; i += 1) fn();
  const values = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    fn();
    values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  return {
    median_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    min_ms: values[0],
    max_ms: values.at(-1),
  };
}

const results = [];
for (const entities of [1_000, 10_000, 100_000]) {
  const state = seededState(entities);
  const local = new Float32Array(state.worldPositions.length);
  const origin = [611_500, 6_677_500, 180];
  const shiftedOrigin = [614_500, 6_674_500, 210];

  const integrate = sample(() => integrateWorldState(state, 1 / 60));
  const derive = sample(() => deriveLocalPositions(state, origin, local));
  const shift = sample(() => deriveLocalPositions(state, shiftedOrigin, local), 20, 80);

  deriveLocalPositions(state, shiftedOrigin, local);
  const reconstructed = reconstructWorldFromLocal(local, shiftedOrigin);
  results.push({
    entities,
    integrate_world64: integrate,
    derive_local_float32: derive,
    origin_shift_rederive: shift,
    max_reconstruction_error_mm:
      maxPositionError(state.worldPositions, reconstructed) * 1_000,
  });
}

console.log(JSON.stringify({
  schema: 'nwe.runtime-origin-shift-benchmark/0.1',
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  results,
  interpretation_boundary:
    'Node/V8 CPU evidence only; no Android/browser/GPU/physics-engine budget is accepted.',
}, null, 2));
