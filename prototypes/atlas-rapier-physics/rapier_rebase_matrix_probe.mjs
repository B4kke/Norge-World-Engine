import RAPIER from '@dimforge/rapier3d-compat';
import {
  createPhysicsSpatialFrame,
  rebasePhysicsSpatialFrame,
} from '../../engine/world/physics_state_contract.mjs';
import {
  createWorldFrame,
  createWorldPosition,
} from '../../engine/world/world_contract.mjs';

await RAPIER.init();

const DT = 1 / 60;
const STEPS = 3600;
const BALL_RADIUS_M = 0.5;
const FLOOR_WORLD_HEIGHT_M = 188.25;
const REBASE_INTERVALS = [300, 900, 1800];
const ANCHOR_OFFSETS_M = [0, 100, 500, 1500];

const worldFrame = createWorldFrame({
  id: 'nwe-world-nannestad-rapier-matrix',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

const initialWorldPosition = createWorldPosition(worldFrame, {
  easting: 618432.123456789,
  northing: 6690123.987654321,
  height: 198.125,
});
const initialVelocityWorld = Object.freeze({ east: 7.25, north: -2.5, up: 0 });
const initialAnchor = createWorldPosition(worldFrame, {
  easting: 618000,
  northing: 6690000,
  height: 180,
});

function worldToLocal(position, frame) {
  return {
    x: position.easting - frame.anchorWorld.easting,
    y: position.height - frame.anchorWorld.height,
    z: position.northing - frame.anchorWorld.northing,
  };
}

function localToWorld(local, frame) {
  return createWorldPosition(worldFrame, {
    easting: frame.anchorWorld.easting + local.x,
    northing: frame.anchorWorld.northing + local.z,
    height: frame.anchorWorld.height + local.y,
  });
}

function worldVelocityToLocal(v) {
  return { x: v.east, y: v.up, z: v.north };
}

function localVelocityToWorld(v) {
  return { east: v.x, north: v.z, up: v.y };
}

function positionDistance(a, b) {
  return Math.hypot(a.easting - b.easting, a.northing - b.northing, a.height - b.height);
}

function velocityDistance(a, b) {
  return Math.hypot(a.east - b.east, a.north - b.north, a.up - b.up);
}

function finiteVector(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function makeFrame(epoch = 0, anchorWorld = initialAnchor) {
  return createPhysicsSpatialFrame({
    physicsFrameId: 'rapier-matrix-island-a',
    worldFrame,
    epoch,
    anchorWorld,
  });
}

function createRapierWorld(frame) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;

  const floorY = FLOOR_WORLD_HEIGHT_M - frame.anchorWorld.height;
  const floor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY - 0.5, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(25000, 0.5, 25000).setFriction(0).setRestitution(0.35),
    floor,
  );

  const local = worldToLocal(initialWorldPosition, frame);
  const velocity = worldVelocityToLocal(initialVelocityWorld);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(local.x, local.y, local.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS_M).setFriction(0).setRestitution(0.35),
    body,
  );

  return { world, floor, body };
}

function expectedHorizontalWorldPositionAt(step) {
  const t = step * DT;
  return {
    easting: initialWorldPosition.easting + initialVelocityWorld.east * t,
    northing: initialWorldPosition.northing + initialVelocityWorld.north * t,
  };
}

function anchorFor(step, anchorOffsetM) {
  const expected = expectedHorizontalWorldPositionAt(step);
  return createWorldPosition(worldFrame, {
    easting: expected.easting + anchorOffsetM,
    northing: expected.northing - anchorOffsetM * 0.5,
    height: FLOOR_WORLD_HEIGHT_M,
  });
}

function buildPlan(rebaseIntervalSteps, anchorOffsetM) {
  const plan = new Map();
  for (let step = rebaseIntervalSteps; step < STEPS; step += rebaseIntervalSteps) {
    plan.set(step, anchorFor(step, anchorOffsetM));
  }
  return plan;
}

function rebaseState({ frame, floor, body, anchorWorld }) {
  const authoritativePosition = localToWorld(body.translation(), frame);
  const authoritativeVelocity = localVelocityToWorld(body.linvel());
  const shifted = rebasePhysicsSpatialFrame({
    worldFrame,
    currentFrame: frame,
    newAnchorWorld: anchorWorld,
  });
  const nextFrame = shifted.frame;

  body.setTranslation(worldToLocal(authoritativePosition, nextFrame), true);
  body.setLinvel(worldVelocityToLocal(authoritativeVelocity), true);
  floor.setTranslation({
    x: 0,
    y: FLOOR_WORLD_HEIGHT_M - nextFrame.anchorWorld.height - 0.5,
    z: 0,
  }, true);

  const roundTrip = localToWorld(body.translation(), nextFrame);
  return {
    frame: nextFrame,
    roundTripErrorM: positionDistance(authoritativePosition, roundTrip),
  };
}

function runCandidate({ id, plan = new Map() }) {
  let frame = makeFrame();
  const { world, floor, body } = createRapierWorld(frame);
  let rebaseCount = 0;
  let maxRebaseRoundTripErrorM = 0;
  let maxHorizontalLocalDistanceM = 0;
  let maxSpeedMps = 0;

  for (let step = 0; step < STEPS; step += 1) {
    const nextAnchor = plan.get(step);
    if (nextAnchor) {
      const rebased = rebaseState({ frame, floor, body, anchorWorld: nextAnchor });
      frame = rebased.frame;
      rebaseCount += 1;
      maxRebaseRoundTripErrorM = Math.max(maxRebaseRoundTripErrorM, rebased.roundTripErrorM);
    }

    world.step();
    const velocity = body.linvel();
    const translation = body.translation();
    if (!finiteVector(velocity) || !finiteVector(translation)) {
      throw new Error(`${id}: Rapier produced non-finite state at step ${step}`);
    }
    maxSpeedMps = Math.max(maxSpeedMps, Math.hypot(velocity.x, velocity.y, velocity.z));
    maxHorizontalLocalDistanceM = Math.max(maxHorizontalLocalDistanceM, Math.hypot(translation.x, translation.z));
  }

  const finalWorldPosition = localToWorld(body.translation(), frame);
  const finalVelocityWorld = localVelocityToWorld(body.linvel());
  const floorTopLocal = FLOOR_WORLD_HEIGHT_M - frame.anchorWorld.height;
  const finalGroundClearanceM = body.translation().y - BALL_RADIUS_M - floorTopLocal;
  world.free();

  if (maxSpeedMps > 100) throw new Error(`${id}: implausible max speed`);
  if (Math.abs(finalGroundClearanceM) > 0.1) throw new Error(`${id}: did not finish near collision surface`);
  if (maxRebaseRoundTripErrorM > 0.1) throw new Error(`${id}: implausible immediate rebase round-trip error`);

  return {
    id,
    rebaseCount,
    finalPhysicsEpoch: frame.epoch,
    maxHorizontalLocalDistanceM,
    maxRebaseRoundTripErrorM,
    maxSpeedMps,
    finalGroundClearanceM,
    finalWorldPosition,
    finalVelocityWorld,
  };
}

function compare(reference, candidate) {
  return {
    finalPositionDriftM: positionDistance(reference.finalWorldPosition, candidate.finalWorldPosition),
    finalVelocityDriftMps: velocityDistance(reference.finalVelocityWorld, candidate.finalVelocityWorld),
  };
}

const fixed = runCandidate({ id: 'fixed' });
const matrix = [];

for (const rebaseIntervalSteps of REBASE_INTERVALS) {
  for (const anchorOffsetM of ANCHOR_OFFSETS_M) {
    const id = `interval-${rebaseIntervalSteps}-offset-${anchorOffsetM}`;
    const plan = buildPlan(rebaseIntervalSteps, anchorOffsetM);
    const candidate = runCandidate({ id, plan });
    const expectedRebases = Math.floor((STEPS - 1) / rebaseIntervalSteps);
    if (candidate.rebaseCount !== expectedRebases || candidate.finalPhysicsEpoch !== expectedRebases) {
      throw new Error(`${id}: rebase/epoch accounting mismatch`);
    }
    matrix.push({
      rebaseIntervalSteps,
      rebaseIntervalSeconds: rebaseIntervalSteps * DT,
      anchorOffsetM,
      ...candidate,
      comparisonToFixed: compare(fixed, candidate),
    });
  }
}

const repeatPlan = buildPlan(900, 0);
const repeatA = runCandidate({ id: 'repeat-a', plan: repeatPlan });
const repeatB = runCandidate({ id: 'repeat-b', plan: repeatPlan });
const repeatability = compare(repeatA, repeatB);
if (repeatability.finalPositionDriftM !== 0 || repeatability.finalVelocityDriftMps !== 0) {
  throw new Error('same-schedule repeatability control diverged');
}

const absoluteFloat32 = new Float32Array([
  initialWorldPosition.easting,
  initialWorldPosition.northing,
  initialWorldPosition.height,
]);
const absoluteFloat32ErrorM = Math.hypot(
  absoluteFloat32[0] - initialWorldPosition.easting,
  absoluteFloat32[1] - initialWorldPosition.northing,
  absoluteFloat32[2] - initialWorldPosition.height,
);
const initialLocal = worldToLocal(initialWorldPosition, makeFrame());
const relativeFloat32 = new Float32Array([initialLocal.x, initialLocal.z, initialLocal.y]);
const relativeRoundTrip = createWorldPosition(worldFrame, {
  easting: initialAnchor.easting + relativeFloat32[0],
  northing: initialAnchor.northing + relativeFloat32[1],
  height: initialAnchor.height + relativeFloat32[2],
});
const anchorRelativeFloat32ErrorM = positionDistance(initialWorldPosition, relativeRoundTrip);
if (!(anchorRelativeFloat32ErrorM < absoluteFloat32ErrorM)) {
  throw new Error('anchor-relative Float32 did not improve initial representation');
}

console.log(JSON.stringify({
  status: 'ATLAS_RAPIER_REBASE_MATRIX_COMPLETE',
  evidenceClass: 'hosted-node-wasm-physics-candidate',
  rapierPackage: '@dimforge/rapier3d-compat@0.19.3',
  worldFrame: {
    horizontalCrs: worldFrame.horizontalCrs,
    verticalDatum: worldFrame.verticalDatum,
    axisOrder: worldFrame.axisOrder,
  },
  workload: {
    steps: STEPS,
    timestepSeconds: DT,
    ballRadiusM: BALL_RADIUS_M,
    floorWorldHeightM: FLOOR_WORLD_HEIGHT_M,
    rebaseIntervals: REBASE_INTERVALS,
    anchorOffsetsM: ANCHOR_OFFSETS_M,
  },
  representation: { absoluteFloat32ErrorM, anchorRelativeFloat32ErrorM },
  fixed,
  matrix,
  sameScheduleRepeatability: repeatability,
  nonDecisions: {
    physicsEngine: true,
    physicsPrecision: true,
    rebaseThreshold: true,
    rebaseFrequency: true,
    islandExtent: true,
    wholeNorwayCoordinatePolicy: true,
  },
}, null, 2));
