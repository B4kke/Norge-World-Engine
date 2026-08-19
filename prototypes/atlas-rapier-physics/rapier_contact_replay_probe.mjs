import crypto from 'node:crypto';
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
const SETTLE_STEPS = 720;
const CONTINUE_STEPS = 720;
const WAKE_OFFSET_STEPS = 90;
const REBASE_EAST_M = 1000.125;
const REBASE_NORTH_M = -750.375;
const FLOOR_WORLD_HEIGHT_M = 188.25;

const worldFrame = createWorldFrame({
  id: 'nwe-world-nannestad-rapier-contact-replay',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

const initialAnchor = createWorldPosition(worldFrame, {
  easting: 618000,
  northing: 6690000,
  height: 180,
});

function makeFrame(epoch = 0, anchorWorld = initialAnchor) {
  return createPhysicsSpatialFrame({
    physicsFrameId: 'rapier-contact-island-a',
    worldFrame,
    epoch,
    anchorWorld,
  });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function vecDistance(a, b) {
  return Math.hypot(a.easting - b.easting, a.northing - b.northing, a.height - b.height);
}

function velocityDistance(a, b) {
  return Math.hypot(a.east - b.east, a.north - b.north, a.up - b.up);
}

function quatAngularDistance(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot);
}

function localToWorld(local, frame) {
  return {
    easting: frame.anchorWorld.easting + local.x,
    northing: frame.anchorWorld.northing + local.z,
    height: frame.anchorWorld.height + local.y,
  };
}

function rapierVelocityToWorld(v) {
  return { east: v.x, north: v.z, up: v.y };
}

function createScene(frame) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;

  const floorY = FLOOR_WORLD_HEIGHT_M - frame.anchorWorld.height;
  const floor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY - 0.5, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setFriction(0.9).setRestitution(0),
    floor,
  );

  const handles = [];
  for (let i = 0; i < 6; i += 1) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0.015 * (i % 2), floorY + 0.5 + i * 1.01, 0.01 * (i % 3))
        .setLinearDamping(0.05)
        .setAngularDamping(0.05)
        .setCanSleep(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setFriction(0.9).setRestitution(0),
      body,
    );
    handles.push(body.handle);
  }

  const striker = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(-4.5, floorY + 0.55, 0.2)
      .setLinvel(3.0, 0, 0)
      .setAngvel({ x: 0.1, y: 0.35, z: -0.15 })
      .setLinearDamping(0.08)
      .setAngularDamping(0.08)
      .setCanSleep(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(0.5).setFriction(0.7).setRestitution(0.05),
    striker,
  );
  handles.push(striker.handle);

  return { world, floorHandle: floor.handle, dynamicHandles: handles };
}

function bodyState(world, handle, frame) {
  const body = world.getRigidBody(handle);
  const p = body.translation();
  const v = body.linvel();
  const r = body.rotation();
  return {
    handle,
    worldPosition: localToWorld(p, frame),
    worldVelocity: rapierVelocityToWorld(v),
    rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    sleeping: body.isSleeping(),
  };
}

function capture(world, handles, frame) {
  return handles.map((handle) => bodyState(world, handle, frame));
}

function compareStates(reference, candidate) {
  let maxPositionDriftM = 0;
  let maxVelocityDriftMps = 0;
  let maxRotationDriftRad = 0;
  let sleepingMismatchCount = 0;
  for (let i = 0; i < reference.length; i += 1) {
    maxPositionDriftM = Math.max(maxPositionDriftM, vecDistance(reference[i].worldPosition, candidate[i].worldPosition));
    maxVelocityDriftMps = Math.max(maxVelocityDriftMps, velocityDistance(reference[i].worldVelocity, candidate[i].worldVelocity));
    maxRotationDriftRad = Math.max(maxRotationDriftRad, quatAngularDistance(reference[i].rotation, candidate[i].rotation));
    if (reference[i].sleeping !== candidate[i].sleeping) sleepingMismatchCount += 1;
  }
  return { maxPositionDriftM, maxVelocityDriftMps, maxRotationDriftRad, sleepingMismatchCount };
}

function sleepingCount(world, handles) {
  return handles.reduce((count, handle) => count + (world.getRigidBody(handle).isSleeping() ? 1 : 0), 0);
}

function stepContinuation(world, dynamicHandles, stepCount, wakeAtOffset = WAKE_OFFSET_STEPS) {
  for (let step = 0; step < stepCount; step += 1) {
    if (step === wakeAtOffset) {
      world.getRigidBody(dynamicHandles.at(-1)).applyImpulse({ x: 2.25, y: 4.5, z: -1.25 }, true);
    }
    world.step();
  }
}

function applyTranslationOnlyRebase(world, frame, handles) {
  const nextAnchor = createWorldPosition(worldFrame, {
    easting: frame.anchorWorld.easting + REBASE_EAST_M,
    northing: frame.anchorWorld.northing + REBASE_NORTH_M,
    height: frame.anchorWorld.height,
  });
  const shifted = rebasePhysicsSpatialFrame({ worldFrame, currentFrame: frame, newAnchorWorld: nextAnchor });
  const beforeSleeping = sleepingCount(world, handles);

  for (const handle of handles) {
    const body = world.getRigidBody(handle);
    const p = body.translation();
    body.setTranslation({ x: p.x - REBASE_EAST_M, y: p.y, z: p.z - REBASE_NORTH_M }, false);
  }

  const afterSleeping = sleepingCount(world, handles);
  return { frame: shifted.frame, beforeSleeping, afterSleeping };
}

const frame0 = makeFrame();
const scene = createScene(frame0);
for (let step = 0; step < SETTLE_STEPS; step += 1) scene.world.step();

const sleepingAtCheckpoint = sleepingCount(scene.world, scene.dynamicHandles);
const checkpointBytes = scene.world.takeSnapshot();
const checkpointSha256 = sha256(checkpointBytes);

// Fixed continuation from the original world.
stepContinuation(scene.world, scene.dynamicHandles, CONTINUE_STEPS);
const fixedFinal = capture(scene.world, scene.dynamicHandles, frame0);
const fixedFinalSnapshotSha256 = sha256(scene.world.takeSnapshot());
scene.world.free();

// Determinism control: restore the exact checkpoint and run the exact same continuation.
const replayControl = RAPIER.World.restoreSnapshot(checkpointBytes);
replayControl.timestep = DT;
stepContinuation(replayControl, scene.dynamicHandles, CONTINUE_STEPS);
const replayControlFinal = capture(replayControl, scene.dynamicHandles, frame0);
const replayControlFinalSnapshotSha256 = sha256(replayControl.takeSnapshot());
const replayControlComparison = compareStates(fixedFinal, replayControlFinal);
replayControl.free();

// Epoch/rebase candidate: restore the same checkpoint, translate the whole physics scene,
// keep sleeping state untouched if the backend permits it, then apply the same wake input.
const rebased = RAPIER.World.restoreSnapshot(checkpointBytes);
rebased.timestep = DT;
const allHandles = [scene.floorHandle, ...scene.dynamicHandles];
const rebase = applyTranslationOnlyRebase(rebased, frame0, allHandles);
stepContinuation(rebased, scene.dynamicHandles, CONTINUE_STEPS);
const rebasedFinal = capture(rebased, scene.dynamicHandles, rebase.frame);
const rebasedFinalSnapshotSha256 = sha256(rebased.takeSnapshot());
const rebasedComparison = compareStates(fixedFinal, rebasedFinal);
rebased.free();

if (replayControlComparison.maxPositionDriftM !== 0 || replayControlComparison.maxVelocityDriftMps !== 0 || replayControlComparison.maxRotationDriftRad !== 0 || replayControlComparison.sleepingMismatchCount !== 0) {
  throw new Error(`snapshot replay control diverged: ${JSON.stringify(replayControlComparison)}`);
}
if (fixedFinalSnapshotSha256 !== replayControlFinalSnapshotSha256) {
  throw new Error('same-schedule restored Rapier snapshot bytes are not identical');
}
if (rebase.frame.epoch !== frame0.epoch + 1) throw new Error('physics epoch did not advance exactly once');
for (const value of Object.values(rebasedComparison)) {
  if (!Number.isFinite(value)) throw new Error('rebased comparison produced a non-finite value');
}

console.log(JSON.stringify({
  status: 'ATLAS_RAPIER_CONTACT_REPLAY_PROBE_PASS',
  rapierPackage: '@dimforge/rapier3d-compat@0.19.3',
  evidenceClass: 'hosted-node-wasm-candidate',
  horizontalCrs: worldFrame.horizontalCrs,
  verticalDatum: worldFrame.verticalDatum,
  settleSteps: SETTLE_STEPS,
  continuationSteps: CONTINUE_STEPS,
  checkpointSha256,
  sleepingAtCheckpoint,
  sameScheduleReplay: {
    ...replayControlComparison,
    finalSnapshotByteIdentical: fixedFinalSnapshotSha256 === replayControlFinalSnapshotSha256,
  },
  translationOnlyEpochRebase: {
    rebaseEastM: REBASE_EAST_M,
    rebaseNorthM: REBASE_NORTH_M,
    epochBefore: frame0.epoch,
    epochAfter: rebase.frame.epoch,
    sleepingBeforeRebase: rebase.beforeSleeping,
    sleepingAfterRebase: rebase.afterSleeping,
    ...rebasedComparison,
    fixedFinalSnapshotSha256,
    rebasedFinalSnapshotSha256,
    backendSnapshotByteIdentical: fixedFinalSnapshotSha256 === rebasedFinalSnapshotSha256,
  },
  authority: {
    renderOriginAuthority: false,
    physicsLocalAuthority: false,
    authoritativeWorldStateRequiresFrameAwareReconstruction: true,
  },
  policy: {
    wholeNorwayCoordinatePolicy: 'OPEN',
    physicsPrecisionPolicy: 'OPEN',
    physicsRebasePolicy: 'OPEN',
    physicsSnapshotPolicy: 'OPEN',
  },
}, null, 2));
