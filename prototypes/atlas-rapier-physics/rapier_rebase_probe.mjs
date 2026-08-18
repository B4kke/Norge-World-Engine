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

const worldFrame = createWorldFrame({
  id: 'nwe-world-nannestad-rapier-probe',
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

function worldToRapierLocal(position, frame) {
  return {
    x: position.easting - frame.anchorWorld.easting,
    y: position.height - frame.anchorWorld.height,
    z: position.northing - frame.anchorWorld.northing,
  };
}

function rapierLocalToWorld(local, frame) {
  return createWorldPosition(worldFrame, {
    easting: frame.anchorWorld.easting + local.x,
    northing: frame.anchorWorld.northing + local.z,
    height: frame.anchorWorld.height + local.y,
  });
}

function worldVelocityToRapier(v) {
  return { x: v.east, y: v.up, z: v.north };
}

function rapierVelocityToWorld(v) {
  return { east: v.x, north: v.z, up: v.y };
}

function vecDistance(a, b) {
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
    physicsFrameId: 'rapier-island-a',
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

  const local = worldToRapierLocal(initialWorldPosition, frame);
  const velocity = worldVelocityToRapier(initialVelocityWorld);
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

function rebaseRapierState({ frame, floor, body, anchorWorld }) {
  const beforeLocal = body.translation();
  const beforeVelocity = body.linvel();
  const authoritativePosition = rapierLocalToWorld(beforeLocal, frame);
  const authoritativeVelocity = rapierVelocityToWorld(beforeVelocity);
  const shifted = rebasePhysicsSpatialFrame({ worldFrame, currentFrame: frame, newAnchorWorld: anchorWorld });
  const nextFrame = shifted.frame;
  const nextLocal = worldToRapierLocal(authoritativePosition, nextFrame);
  const nextVelocity = worldVelocityToRapier(authoritativeVelocity);

  body.setTranslation(nextLocal, true);
  body.setLinvel(nextVelocity, true);
  floor.setTranslation({
    x: 0,
    y: FLOOR_WORLD_HEIGHT_M - nextFrame.anchorWorld.height - 0.5,
    z: 0,
  }, true);

  const roundTrip = rapierLocalToWorld(body.translation(), nextFrame);
  return {
    frame: nextFrame,
    roundTripErrorM: vecDistance(authoritativePosition, roundTrip),
  };
}

function rebasePlan() {
  return new Map([
    [900, createWorldPosition(worldFrame, { easting: 621000.25, northing: 6689000.5, height: 185.125 })],
    [1800, createWorldPosition(worldFrame, { easting: 617250.75, northing: 6692250.25, height: 181.875 })],
    [2700, createWorldPosition(worldFrame, { easting: 619500.5, northing: 6690500.75, height: 190.25 })],
  ]);
}

function runCandidate({ rebased }) {
  let frame = makeFrame();
  const { world, floor, body } = createRapierWorld(frame);
  const plan = rebased ? rebasePlan() : new Map();
  let maxRebaseRoundTripErrorM = 0;
  let rebaseCount = 0;
  let maxSpeedMps = 0;
  const startMs = performance.now();

  for (let step = 0; step < STEPS; step += 1) {
    const anchorWorld = plan.get(step);
    if (anchorWorld) {
      const result = rebaseRapierState({ frame, floor, body, anchorWorld });
      frame = result.frame;
      maxRebaseRoundTripErrorM = Math.max(maxRebaseRoundTripErrorM, result.roundTripErrorM);
      rebaseCount += 1;
    }
    world.step();
    const velocity = body.linvel();
    if (!finiteVector(velocity) || !finiteVector(body.translation())) {
      throw new Error(`Rapier produced a non-finite state at step ${step}`);
    }
    maxSpeedMps = Math.max(maxSpeedMps, Math.hypot(velocity.x, velocity.y, velocity.z));
  }

  const elapsedMs = performance.now() - startMs;
  const finalWorldPosition = rapierLocalToWorld(body.translation(), frame);
  const finalVelocityWorld = rapierVelocityToWorld(body.linvel());
  const local = body.translation();
  const floorTopLocal = FLOOR_WORLD_HEIGHT_M - frame.anchorWorld.height;
  const finalGroundClearanceM = local.y - BALL_RADIUS_M - floorTopLocal;
  world.free();

  return {
    rebaseCount,
    maxRebaseRoundTripErrorM,
    maxSpeedMps,
    elapsedMs,
    finalWorldPosition,
    finalVelocityWorld,
    finalGroundClearanceM,
    finalPhysicsEpoch: frame.epoch,
  };
}

const fixed = runCandidate({ rebased: false });
const rebased = runCandidate({ rebased: true });
const finalPositionDriftM = vecDistance(fixed.finalWorldPosition, rebased.finalWorldPosition);
const finalVelocityDriftMps = velocityDistance(fixed.finalVelocityWorld, rebased.finalVelocityWorld);

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
const initialLocal = worldToRapierLocal(initialWorldPosition, makeFrame());
const relativeFloat32 = new Float32Array([initialLocal.x, initialLocal.z, initialLocal.y]);
const relativeRoundTrip = createWorldPosition(worldFrame, {
  easting: initialAnchor.easting + relativeFloat32[0],
  northing: initialAnchor.northing + relativeFloat32[1],
  height: initialAnchor.height + relativeFloat32[2],
});
const anchorRelativeFloat32ErrorM = vecDistance(initialWorldPosition, relativeRoundTrip);

if (rebased.rebaseCount !== 3 || fixed.rebaseCount !== 0) throw new Error('unexpected rebase count');
if (rebased.finalPhysicsEpoch !== 3 || fixed.finalPhysicsEpoch !== 0) throw new Error('unexpected physics epoch');
if (rebased.maxRebaseRoundTripErrorM > 0.1) throw new Error(`rebase round-trip error is implausibly large: ${rebased.maxRebaseRoundTripErrorM}`);
if (fixed.maxSpeedMps > 100 || rebased.maxSpeedMps > 100) throw new Error('probe produced implausible speed');
if (Math.abs(fixed.finalGroundClearanceM) > 0.1 || Math.abs(rebased.finalGroundClearanceM) > 0.1) {
  throw new Error('probe did not finish near the collision plane');
}
if (!(anchorRelativeFloat32ErrorM < absoluteFloat32ErrorM)) {
  throw new Error('anchor-relative Float32 did not improve initial coordinate representation');
}

console.log(JSON.stringify({
  status: 'ATLAS_RAPIER_REBASE_PROBE_COMPLETE',
  evidenceClass: 'hosted-node-wasm-physics-candidate',
  rapierPackage: '@dimforge/rapier3d-compat@0.19.3',
  worldFrame: {
    horizontalCrs: worldFrame.horizontalCrs,
    verticalDatum: worldFrame.verticalDatum,
    axisOrder: worldFrame.axisOrder,
  },
  workload: { steps: STEPS, timestepSeconds: DT, ballRadiusM: BALL_RADIUS_M, floorWorldHeightM: FLOOR_WORLD_HEIGHT_M },
  representation: { absoluteFloat32ErrorM, anchorRelativeFloat32ErrorM },
  fixed,
  rebased,
  comparison: { finalPositionDriftM, finalVelocityDriftMps },
  nonDecisions: {
    physicsEngine: true,
    physicsPrecision: true,
    rebaseThreshold: true,
    islandExtent: true,
    wholeNorwayCoordinatePolicy: true,
  },
}, null, 2));
