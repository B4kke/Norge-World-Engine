import crypto from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  createPhysicsSpatialFrame,
} from '../../engine/world/physics_state_contract.mjs';
import {
  createPhysicsTopologyTransition,
  applyPhysicsTopologyTransition,
  PhysicsTopologyContractError,
} from '../../engine/world/physics_topology_contract.mjs';
import {
  createWorldFrame,
  createWorldPosition,
} from '../../engine/world/world_contract.mjs';

await RAPIER.init();

const DT = 1 / 60;
const PRE_MIGRATION_STEPS = 360;
const POST_MIGRATION_STEPS = 1080;
const MIGRATION_EAST_M = 1000.125;
const MIGRATION_NORTH_M = -750.375;

const worldFrame = createWorldFrame({
  id: 'nwe-world-nannestad-rapier-constrained-migration',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

const frameA = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:island-a',
  worldFrame,
  epoch: 0,
  anchorWorld: createWorldPosition(worldFrame, {
    easting: 618000,
    northing: 6690000,
    height: 190,
  }),
});

const frameB = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:island-b',
  worldFrame,
  epoch: 0,
  anchorWorld: createWorldPosition(worldFrame, {
    easting: frameA.anchorWorld.easting + MIGRATION_EAST_M,
    northing: frameA.anchorWorld.northing + MIGRATION_NORTH_M,
    height: frameA.anchorWorld.height,
  }),
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function localToWorld(local, frame) {
  return {
    easting: frame.anchorWorld.easting + local.x,
    northing: frame.anchorWorld.northing + local.z,
    height: frame.anchorWorld.height + local.y,
  };
}

function worldVelocity(v) {
  return { east: v.x, north: v.z, up: v.y };
}

function vecDistance(a, b) {
  return Math.hypot(a.easting - b.easting, a.northing - b.northing, a.height - b.height);
}

function velocityDistance(a, b) {
  return Math.hypot(a.east - b.east, a.north - b.north, a.up - b.up);
}

function quaternionDistance(a, b) {
  const normA = Math.hypot(a.x, a.y, a.z, a.w);
  const normB = Math.hypot(b.x, b.y, b.z, b.w);
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) / (normA * normB);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

function makeScene() {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = DT;

  const bodyA = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(12.25, 6.5, -7.75)
      .setLinvel(4.25, 0.75, -2.5)
      .setAngvel({ x: 0.35, y: -0.2, z: 0.45 })
      .setLinearDamping(0.015)
      .setAngularDamping(0.02)
      .setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.4, 0.5).setDensity(1.25), bodyA);

  const bodyB = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(14.25, 6.5, -7.75)
      .setLinvel(4.25, 0.75, -2.5)
      .setAngvel({ x: 0.35, y: -0.2, z: 0.45 })
      .setLinearDamping(0.015)
      .setAngularDamping(0.02)
      .setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 0.55, 0.35).setDensity(0.9), bodyB);

  const identity = { w: 1, x: 0, y: 0, z: 0 };
  const jointParams = RAPIER.JointData.fixed(
    { x: 1, y: 0, z: 0 }, identity,
    { x: -1, y: 0, z: 0 }, identity,
  );
  const joint = world.createImpulseJoint(jointParams, bodyA, bodyB, true);

  return {
    world,
    bodyHandles: [bodyA.handle, bodyB.handle],
    jointHandle: joint.handle,
  };
}

function capture(world, bodyHandles, frame) {
  return bodyHandles.map((handle) => {
    const body = world.getRigidBody(handle);
    const position = body.translation();
    const velocity = body.linvel();
    const rotation = body.rotation();
    return {
      handle,
      worldPosition: localToWorld(position, frame),
      worldVelocity: worldVelocity(velocity),
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      sleeping: body.isSleeping(),
    };
  });
}

function compare(reference, candidate) {
  let maxPositionDriftM = 0;
  let maxVelocityDriftMps = 0;
  let maxRotationDriftRad = 0;
  let sleepingMismatchCount = 0;
  for (let i = 0; i < reference.length; i += 1) {
    maxPositionDriftM = Math.max(maxPositionDriftM, vecDistance(reference[i].worldPosition, candidate[i].worldPosition));
    maxVelocityDriftMps = Math.max(maxVelocityDriftMps, velocityDistance(reference[i].worldVelocity, candidate[i].worldVelocity));
    maxRotationDriftRad = Math.max(maxRotationDriftRad, quaternionDistance(reference[i].rotation, candidate[i].rotation));
    if (reference[i].sleeping !== candidate[i].sleeping) sleepingMismatchCount += 1;
  }
  return { maxPositionDriftM, maxVelocityDriftMps, maxRotationDriftRad, sleepingMismatchCount };
}

function step(world, count) {
  for (let i = 0; i < count; i += 1) world.step();
}

function currentFrames() {
  return [frameA, frameB].map((frame) => ({
    physicsFrameId: frame.physicsFrameId,
    worldFrameId: worldFrame.id,
    epoch: frame.epoch,
  }));
}

function memberships(frame) {
  return ['entity:a', 'entity:b'].map((entityId) => ({
    entityId,
    worldFrameId: worldFrame.id,
    physicsFrameId: frame.physicsFrameId,
    physicsFrameEpoch: frame.epoch,
  }));
}

function constrainedGroupMigrationEvent() {
  return createPhysicsTopologyTransition({
    tick: PRE_MIGRATION_STEPS,
    worldFrameId: worldFrame.id,
    transitionId: 'migration:a-to-b',
    assignments: ['entity:a', 'entity:b'].map((entityId) => ({
      entityId,
      fromPhysicsFrameId: frameA.physicsFrameId,
      fromEpoch: frameA.epoch,
      toPhysicsFrameId: frameB.physicsFrameId,
      toEpoch: frameB.epoch,
    })),
    activeConstraints: [{ constraintId: 'joint:a-b', entityAId: 'entity:a', entityBId: 'entity:b' }],
    reason: 'constrained-group-migration-probe',
  });
}

function illegalSplitEvent() {
  return createPhysicsTopologyTransition({
    tick: PRE_MIGRATION_STEPS,
    worldFrameId: worldFrame.id,
    transitionId: 'illegal-split:a-b',
    assignments: [
      {
        entityId: 'entity:a',
        fromPhysicsFrameId: frameA.physicsFrameId,
        fromEpoch: frameA.epoch,
        toPhysicsFrameId: frameA.physicsFrameId,
        toEpoch: frameA.epoch,
      },
      {
        entityId: 'entity:b',
        fromPhysicsFrameId: frameA.physicsFrameId,
        fromEpoch: frameA.epoch,
        toPhysicsFrameId: frameB.physicsFrameId,
        toEpoch: frameB.epoch,
      },
    ],
    activeConstraints: [{ constraintId: 'joint:a-b', entityAId: 'entity:a', entityBId: 'entity:b' }],
    reason: 'cross-frame-split-must-fail-before-solver-mutation',
  });
}

function translateBodiesIntoFrame(world, bodyHandles, fromFrame, toFrame) {
  const dx = toFrame.anchorWorld.easting - fromFrame.anchorWorld.easting;
  const dz = toFrame.anchorWorld.northing - fromFrame.anchorWorld.northing;
  const dy = toFrame.anchorWorld.height - fromFrame.anchorWorld.height;
  for (const handle of bodyHandles) {
    const body = world.getRigidBody(handle);
    const p = body.translation();
    body.setTranslation({ x: p.x - dx, y: p.y - dy, z: p.z - dz }, false);
  }
}

function preflightAndMigrate(world, bodyHandles) {
  const applied = applyPhysicsTopologyTransition({
    worldFrameId: worldFrame.id,
    currentFrames: currentFrames(),
    currentMemberships: memberships(frameA),
    event: constrainedGroupMigrationEvent(),
  });
  translateBodiesIntoFrame(world, bodyHandles, frameA, frameB);
  return applied;
}

function verifyIllegalSplitIsPreMutation(world) {
  const before = world.takeSnapshot();
  const beforeSha256 = sha256(before);
  let rejectionCode = null;
  try {
    applyPhysicsTopologyTransition({
      worldFrameId: worldFrame.id,
      currentFrames: currentFrames(),
      currentMemberships: memberships(frameA),
      event: illegalSplitEvent(),
    });
  } catch (error) {
    if (!(error instanceof PhysicsTopologyContractError)) throw error;
    rejectionCode = error.code;
  }
  const after = world.takeSnapshot();
  const afterSha256 = sha256(after);
  if (rejectionCode !== 'CROSS_FRAME_CONSTRAINT') {
    throw new Error(`illegal constrained split rejected with ${rejectionCode ?? 'no error'} instead of CROSS_FRAME_CONSTRAINT`);
  }
  if (beforeSha256 !== afterSha256) {
    throw new Error('solver snapshot changed during topology preflight rejection');
  }
  return { rejectionCode, beforeSha256, afterSha256, backendSnapshotByteIdentical: true };
}

const seed = makeScene();
step(seed.world, PRE_MIGRATION_STEPS);
const checkpointBytes = seed.world.takeSnapshot();
const checkpointSha256 = sha256(checkpointBytes);
const illegalSplit = verifyIllegalSplitIsPreMutation(seed.world);
seed.world.free();

const fixed = RAPIER.World.restoreSnapshot(checkpointBytes);
fixed.timestep = DT;
step(fixed, POST_MIGRATION_STEPS);
const fixedFinal = capture(fixed, seed.bodyHandles, frameA);
const fixedFinalSnapshotSha256 = sha256(fixed.takeSnapshot());
fixed.free();

const migrated = RAPIER.World.restoreSnapshot(checkpointBytes);
migrated.timestep = DT;
const migrationResult = preflightAndMigrate(migrated, seed.bodyHandles);
const immediatelyAfterMigration = capture(migrated, seed.bodyHandles, frameB);
const fixedAtCheckpoint = RAPIER.World.restoreSnapshot(checkpointBytes);
fixedAtCheckpoint.timestep = DT;
const checkpointWorldState = capture(fixedAtCheckpoint, seed.bodyHandles, frameA);
fixedAtCheckpoint.free();
const immediateMigrationComparison = compare(checkpointWorldState, immediatelyAfterMigration);
step(migrated, POST_MIGRATION_STEPS);
const migratedFinal = capture(migrated, seed.bodyHandles, frameB);
const migratedFinalSnapshotSha256 = sha256(migrated.takeSnapshot());
const finalComparison = compare(fixedFinal, migratedFinal);
migrated.free();

for (const [label, comparison] of Object.entries({ immediateMigrationComparison, finalComparison })) {
  for (const [metric, value] of Object.entries(comparison)) {
    if (!Number.isFinite(value)) throw new Error(`${label}.${metric} is not finite`);
  }
}
if (migrationResult.transition.transitionKind !== 'repartition') {
  throw new Error(`expected constrained co-migration to classify as repartition, got ${migrationResult.transition.transitionKind}`);
}
if (!migrationResult.memberships.every((membership) => membership.physicsFrameId === frameB.physicsFrameId)) {
  throw new Error('legal constrained co-migration did not move the complete group to frame B');
}

console.log(JSON.stringify({
  status: 'ATLAS_RAPIER_CONSTRAINED_MIGRATION_PROBE_COMPLETE',
  rapierPackage: '@dimforge/rapier3d-compat@0.19.3',
  evidenceClass: 'hosted-node-wasm-candidate',
  worldFrame: {
    id: worldFrame.id,
    horizontalCrs: worldFrame.horizontalCrs,
    verticalDatum: worldFrame.verticalDatum,
  },
  steps: {
    preMigration: PRE_MIGRATION_STEPS,
    postMigration: POST_MIGRATION_STEPS,
  },
  checkpointSha256,
  constrainedMigration: {
    transitionKind: migrationResult.transition.transitionKind,
    fromPhysicsFrameId: frameA.physicsFrameId,
    toPhysicsFrameId: frameB.physicsFrameId,
    migrationEastM: MIGRATION_EAST_M,
    migrationNorthM: MIGRATION_NORTH_M,
    immediate: immediateMigrationComparison,
    afterContinuation: finalComparison,
    fixedFinalSnapshotSha256,
    migratedFinalSnapshotSha256,
    backendSnapshotByteIdentical: fixedFinalSnapshotSha256 === migratedFinalSnapshotSha256,
  },
  illegalCrossFrameSplit: illegalSplit,
  authority: {
    authoritativeWorldStateIsWorldFrame: true,
    physicsFrameMembershipIsReplayState: true,
    renderOriginAuthority: false,
    backendIslandIdAuthority: false,
    backendSnapshotAuthority: false,
  },
  policy: {
    wholeNorwayCoordinatePolicy: 'OPEN',
    physicsBackendSelection: 'OPEN',
    physicsIslandExtent: 'OPEN',
    physicsRebaseThreshold: 'OPEN',
    crossFrameConstraintBridge: 'UNDEFINED_FAIL_CLOSED',
  },
}, null, 2));
