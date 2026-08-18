import { rebasePositionsFloat64ToFloat32 } from '../runtime-coordinate-precision/precision.mjs';

function assertTriples(buffer, ctor, label) {
  if (!(buffer instanceof ctor)) throw new TypeError(`${label} must be ${ctor.name}`);
  if (buffer.length === 0 || buffer.length % 3 !== 0) {
    throw new RangeError(`${label} must contain xyz triples`);
  }
}

export function validateOrigin(origin) {
  if (!Array.isArray(origin) || origin.length !== 3 || origin.some((value) => !Number.isFinite(value))) {
    throw new TypeError('origin must be three finite numbers');
  }
  return origin;
}

export function createRuntimeState(worldPositions, worldVelocities) {
  assertTriples(worldPositions, Float64Array, 'worldPositions');
  assertTriples(worldVelocities, Float64Array, 'worldVelocities');
  if (worldPositions.length !== worldVelocities.length) {
    throw new RangeError('positions/velocities length mismatch');
  }
  return {
    worldPositions,
    worldVelocities,
    entityCount: worldPositions.length / 3,
  };
}

export function integrateWorldState(state, dtSeconds) {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new RangeError('dtSeconds must be finite and > 0');
  }
  const { worldPositions, worldVelocities } = state;
  for (let i = 0; i < worldPositions.length; i += 1) {
    worldPositions[i] += worldVelocities[i] * dtSeconds;
  }
  return state;
}

export function deriveLocalPositions(
  state,
  origin,
  output = new Float32Array(state.worldPositions.length),
) {
  validateOrigin(origin);
  return rebasePositionsFloat64ToFloat32(state.worldPositions, origin, output);
}

export function reconstructWorldFromLocal(
  localPositions,
  origin,
  output = new Float64Array(localPositions.length),
) {
  assertTriples(localPositions, Float32Array, 'localPositions');
  assertTriples(output, Float64Array, 'output');
  if (output.length !== localPositions.length) {
    throw new RangeError('local/output length mismatch');
  }
  validateOrigin(origin);
  for (let i = 0; i < localPositions.length; i += 3) {
    output[i] = origin[0] + localPositions[i];
    output[i + 1] = origin[1] + localPositions[i + 1];
    output[i + 2] = origin[2] + localPositions[i + 2];
  }
  return output;
}

export function shiftRenderOrigin(state, nextOrigin, localOutput) {
  validateOrigin(nextOrigin);
  return {
    origin: [...nextOrigin],
    localPositions: deriveLocalPositions(state, nextOrigin, localOutput),
  };
}

export function worldDisplacementFromLocalFrames(
  previousLocal,
  previousOrigin,
  nextLocal,
  nextOrigin,
  output = new Float64Array(previousLocal.length),
) {
  assertTriples(previousLocal, Float32Array, 'previousLocal');
  assertTriples(nextLocal, Float32Array, 'nextLocal');
  assertTriples(output, Float64Array, 'output');
  if (previousLocal.length !== nextLocal.length || output.length !== previousLocal.length) {
    throw new RangeError('frame buffers must have equal lengths');
  }
  validateOrigin(previousOrigin);
  validateOrigin(nextOrigin);
  for (let i = 0; i < previousLocal.length; i += 3) {
    output[i] = (nextOrigin[0] + nextLocal[i]) - (previousOrigin[0] + previousLocal[i]);
    output[i + 1] = (nextOrigin[1] + nextLocal[i + 1]) - (previousOrigin[1] + previousLocal[i + 1]);
    output[i + 2] = (nextOrigin[2] + nextLocal[i + 2]) - (previousOrigin[2] + previousLocal[i + 2]);
  }
  return output;
}

export function maxPositionError(reference, actual) {
  if (reference.length !== actual.length) {
    throw new RangeError('reference/actual lengths differ');
  }
  let max = 0;
  for (let i = 0; i < reference.length; i += 1) {
    max = Math.max(max, Math.abs(reference[i] - actual[i]));
  }
  return max;
}
