import assert from 'node:assert/strict';
import {
  createRuntimeState,
  deriveLocalPositions,
  integrateWorldState,
  maxPositionError,
  reconstructWorldFromLocal,
  shiftRenderOrigin,
} from './origin_runtime.mjs';

function seededState(count) {
  const positions = new Float64Array(count * 3);
  const velocities = new Float64Array(count * 3);
  let seed = 0xdecafbad;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = 611_500 + (random() - 0.5) * 1_800;
    positions[i * 3 + 1] = 6_677_500 + (random() - 0.5) * 1_800;
    positions[i * 3 + 2] = 190 + (random() - 0.5) * 60;
    velocities[i * 3] = (random() - 0.5) * 40;
    velocities[i * 3 + 1] = (random() - 0.5) * 40;
    velocities[i * 3 + 2] = (random() - 0.5) * 2;
  }

  return createRuntimeState(positions, velocities);
}

function cloneState(state) {
  return createRuntimeState(
    new Float64Array(state.worldPositions),
    new Float64Array(state.worldVelocities),
  );
}

const base = seededState(2_048);
const fixed = cloneState(base);
const shifted = cloneState(base);
const dt = 1 / 60;
const fixedOrigin = [611_500, 6_677_500, 180];
let shiftedOrigin = [...fixedOrigin];
const fixedLocal = new Float32Array(fixed.worldPositions.length);
const shiftedLocal = new Float32Array(shifted.worldPositions.length);
const reconstructed = new Float64Array(shifted.worldPositions.length);
let maxReconstructionError = 0;
let shiftCount = 0;

for (let tick = 0; tick < 3_600; tick += 1) {
  integrateWorldState(fixed, dt);
  integrateWorldState(shifted, dt);

  deriveLocalPositions(fixed, fixedOrigin, fixedLocal);
  if (tick > 0 && tick % 120 === 0) {
    const phase = tick / 120;
    shiftedOrigin = [
      fixedOrigin[0] + Math.sin(phase * 0.73) * 4_000,
      fixedOrigin[1] + Math.cos(phase * 0.51) * 4_000,
      fixedOrigin[2] + Math.sin(phase * 0.37) * 50,
    ];
    shiftRenderOrigin(shifted, shiftedOrigin, shiftedLocal);
    shiftCount += 1;
  } else {
    deriveLocalPositions(shifted, shiftedOrigin, shiftedLocal);
  }

  reconstructWorldFromLocal(shiftedLocal, shiftedOrigin, reconstructed);
  maxReconstructionError = Math.max(
    maxReconstructionError,
    maxPositionError(shifted.worldPositions, reconstructed),
  );
}

assert.deepEqual(
  [...shifted.worldPositions],
  [...fixed.worldPositions],
  'render-origin schedule mutated authoritative world trajectory',
);
assert.deepEqual(
  [...shifted.worldVelocities],
  [...fixed.worldVelocities],
  'render-origin schedule mutated authoritative velocity',
);
assert.ok(
  maxReconstructionError < 0.0005,
  `reconstruction exceeded 0.5 mm: ${maxReconstructionError} m`,
);
assert.equal(shiftCount, 29);

const beforeWorld = new Float64Array(shifted.worldPositions);
const beforeVelocity = new Float64Array(shifted.worldVelocities);
shiftRenderOrigin(shifted, [612_000, 6_678_000, 200], shiftedLocal);
assert.deepEqual([...shifted.worldPositions], [...beforeWorld], 'shift mutated world positions');
assert.deepEqual([...shifted.worldVelocities], [...beforeVelocity], 'shift mutated velocities');

assert.throws(() => integrateWorldState(shifted, 0), /dtSeconds/);
assert.throws(() => shiftRenderOrigin(shifted, [NaN, 0, 0], shiftedLocal), /origin/);

console.log(JSON.stringify({
  status: 'PASS',
  entities: base.entityCount,
  ticks: 3_600,
  origin_shifts: shiftCount,
  max_reconstruction_error_mm: maxReconstructionError * 1_000,
  world_state_identical: true,
  velocity_state_identical: true,
}, null, 2));
