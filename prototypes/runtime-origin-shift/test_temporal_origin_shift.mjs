import assert from 'node:assert/strict';
import {
  createRuntimeState,
  deriveLocalPositions,
  integrateWorldState,
  worldDisplacementFromLocalFrames,
} from './origin_runtime.mjs';

const positions = new Float64Array([611_500.25, 6_677_500.25, 190.25]);
const velocities = new Float64Array([12, -3, 0.5]);
const state = createRuntimeState(positions, velocities);

const previousOrigin = [611_500, 6_677_500, 180];
const nextOrigin = [614_500, 6_674_500, 210];
const previousLocal = deriveLocalPositions(state, previousOrigin);
const previousWorld = new Float64Array(state.worldPositions);

integrateWorldState(state, 1 / 60);
const nextLocal = deriveLocalPositions(state, nextOrigin);
const naiveLocalDelta = [
  nextLocal[0] - previousLocal[0],
  nextLocal[1] - previousLocal[1],
  nextLocal[2] - previousLocal[2],
];
const compensated = worldDisplacementFromLocalFrames(
  previousLocal,
  previousOrigin,
  nextLocal,
  nextOrigin,
);
const expected = [
  state.worldPositions[0] - previousWorld[0],
  state.worldPositions[1] - previousWorld[1],
  state.worldPositions[2] - previousWorld[2],
];

function maxError(a, b) {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

assert.ok(
  Math.hypot(...naiveLocalDelta) > 4_000,
  'naive local-frame delta did not expose the expected render-origin discontinuity',
);
assert.ok(
  maxError([...compensated], expected) < 0.0002,
  `origin-compensated world displacement exceeded 0.2 mm error`,
);

console.log(JSON.stringify({
  status: 'PASS',
  naive_local_delta_m: naiveLocalDelta,
  naive_speed_if_interpreted_at_60hz_mps: naiveLocalDelta.map((value) => value * 60),
  expected_world_displacement_m: expected,
  compensated_world_displacement_m: [...compensated],
  max_compensation_error_mm: maxError([...compensated], expected) * 1_000,
}, null, 2));
