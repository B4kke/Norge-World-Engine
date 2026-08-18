import {
  physicsBodyToWorldEntity,
  rebasePhysicsSpatialFrame,
  reframePhysicsBody,
  worldEntityToPhysicsBody,
} from '../../engine/world/physics_state_contract.mjs';

export class PhysicsLocalCollisionProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhysicsLocalCollisionProbeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhysicsLocalCollisionProbeError(code, message);
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail('NON_FINITE', `${label} must be finite`);
  return value;
}

function positive(value, label) {
  const number = finite(value, label);
  if (number <= 0) fail('INVALID_POSITIVE', `${label} must be > 0`);
  return number;
}

function backendArray(values, precision) {
  if (precision === 'float64-local') return new Float64Array(values);
  if (precision === 'float32-local') return new Float32Array(values);
  fail('UNSUPPORTED_PRECISION', `unsupported precision candidate: ${precision}`);
}

function asContractBody(state, physicsFrame) {
  return Object.freeze({
    id: state.id,
    physicsFrameId: physicsFrame.physicsFrameId,
    physicsEpoch: physicsFrame.epoch,
    localPosition: new Float64Array(state.localPosition),
    velocityWorldMps: new Float64Array(state.velocityWorldMps),
  });
}

function quantizeContractBody(body, precision) {
  return Object.freeze({
    id: body.id,
    localPosition: backendArray(body.localPosition, precision),
    velocityWorldMps: backendArray(body.velocityWorldMps, precision),
  });
}

/**
 * Deterministic translation-only physics probe.
 *
 * This is deliberately not a production integrator. It exists to test the
 * coordinate boundary with one concrete local-space dynamic/contact workload:
 * constant gravity, semi-implicit Euler integration and a horizontal plane
 * contact with restitution. The plane height is authoritative world height;
 * only its local-space representation is derived from the active physics frame.
 */
export function runPhysicsLocalCollisionProbe({
  worldFrame,
  initialPhysicsFrame,
  initialEntity,
  precision,
  steps,
  dtSeconds,
  floorWorldHeight,
  radiusM,
  gravityMps2 = -9.81,
  restitution = 0.35,
  rebases = [],
}) {
  if (!worldFrame || !initialPhysicsFrame || !initialEntity) fail('INVALID_INPUT', 'worldFrame, initialPhysicsFrame and initialEntity are required');
  if (!Number.isSafeInteger(steps) || steps <= 0) fail('INVALID_STEPS', 'steps must be a positive safe integer');
  const dt = positive(dtSeconds, 'dtSeconds');
  const radius = positive(radiusM, 'radiusM');
  const floorHeight = finite(floorWorldHeight, 'floorWorldHeight');
  const gravity = finite(gravityMps2, 'gravityMps2');
  const bounce = finite(restitution, 'restitution');
  if (bounce < 0 || bounce > 1) fail('INVALID_RESTITUTION', 'restitution must be within [0, 1]');
  if (!Array.isArray(rebases)) fail('INVALID_REBASE_PLAN', 'rebases must be an array');

  const rebaseByStep = new Map();
  for (const item of rebases) {
    if (!item || !Number.isSafeInteger(item.step) || item.step < 0 || item.step >= steps || !item.anchorWorld) {
      fail('INVALID_REBASE_PLAN', 'each rebase requires step within the run and anchorWorld');
    }
    if (rebaseByStep.has(item.step)) fail('INVALID_REBASE_PLAN', `duplicate rebase at step ${item.step}`);
    rebaseByStep.set(item.step, item.anchorWorld);
  }

  let physicsFrame = initialPhysicsFrame;
  let contractBody = worldEntityToPhysicsBody({ worldFrame, entity: initialEntity, physicsFrame });
  let state = quantizeContractBody(contractBody, precision);
  let collisionCount = 0;
  let rebaseCount = 0;
  let maxPreResolvePenetrationM = 0;

  for (let step = 0; step < steps; step += 1) {
    const newAnchorWorld = rebaseByStep.get(step);
    if (newAnchorWorld) {
      contractBody = asContractBody(state, physicsFrame);
      const shifted = rebasePhysicsSpatialFrame({ worldFrame, currentFrame: physicsFrame, newAnchorWorld });
      const reframed = reframePhysicsBody({
        worldFrame,
        body: contractBody,
        fromFrame: physicsFrame,
        toFrame: shifted.frame,
      });
      physicsFrame = shifted.frame;
      state = quantizeContractBody(reframed, precision);
      rebaseCount += 1;
    }

    const localPosition = backendArray(state.localPosition, precision);
    const velocity = backendArray(state.velocityWorldMps, precision);
    const scalar = (value) => backendArray([value], precision)[0];
    const localFloor = scalar(floorHeight - physicsFrame.anchorWorld.height);
    const localRadius = scalar(radius);
    const localDt = scalar(dt);
    const localGravity = scalar(gravity);
    const localRestitution = scalar(bounce);

    velocity[2] = scalar(velocity[2] + localGravity * localDt);
    localPosition[0] = scalar(localPosition[0] + velocity[0] * localDt);
    localPosition[1] = scalar(localPosition[1] + velocity[1] * localDt);
    localPosition[2] = scalar(localPosition[2] + velocity[2] * localDt);

    const penetrationM = Number(localFloor + localRadius - localPosition[2]);
    if (penetrationM > 0) {
      maxPreResolvePenetrationM = Math.max(maxPreResolvePenetrationM, penetrationM);
      localPosition[2] = scalar(localFloor + localRadius);
      velocity[2] = scalar(-velocity[2] * localRestitution);
      collisionCount += 1;
    }

    state = Object.freeze({
      id: state.id,
      localPosition,
      velocityWorldMps: velocity,
    });
  }

  contractBody = asContractBody(state, physicsFrame);
  const finalEntity = physicsBodyToWorldEntity({ worldFrame, body: contractBody, physicsFrame });
  return Object.freeze({
    precision,
    steps,
    collisionCount,
    rebaseCount,
    maxPreResolvePenetrationM,
    finalPhysicsFrame: physicsFrame,
    finalEntity,
  });
}
