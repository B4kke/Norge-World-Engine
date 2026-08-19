import RAPIER from '@dimforge/rapier3d-compat';
import {
  createWorldFrame,
  createWorldPosition,
  createTileFrame,
} from '../../engine/world/world_contract.mjs';
import { createPhysicsSpatialFrame } from '../../engine/world/physics_state_contract.mjs';
import {
  createStaticCollisionBinding,
  assertStaticCollisionBinding,
  tileCollisionPointToPhysicsLocal64,
  physicsLocal64ToWorldCollisionPoint,
} from '../../engine/world/static_collision_contract.mjs';

await RAPIER.init();

const DT = 1 / 60;
const PRE_MIGRATION_STEPS = 600;
const POST_MIGRATION_STEPS = 360;
const MIGRATION_EAST_M = 1000.125;
const MIGRATION_NORTH_M = -750.375;
const TERRAIN_ARTIFACT_SHA256 = '780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96';

const worldFrame = createWorldFrame({
  id: 'nwe-world-nannestad-static-collision-probe',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});
const frameA = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:island-contact',
  worldFrame,
  epoch: 0,
  anchorWorld: createWorldPosition(worldFrame, { easting: 618000, northing: 6690000, height: 190 }),
});
const frameB = createPhysicsSpatialFrame({
  physicsFrameId: frameA.physicsFrameId,
  worldFrame,
  epoch: 1,
  anchorWorld: createWorldPosition(worldFrame, {
    easting: frameA.anchorWorld.easting + MIGRATION_EAST_M,
    northing: frameA.anchorWorld.northing + MIGRATION_NORTH_M,
    height: frameA.anchorWorld.height,
  }),
});
const terrainTileFrame = createTileFrame({
  tileId: 'nannestad:618000:6690000:1000',
  worldFrame,
  anchorWorld: createWorldPosition(worldFrame, { easting: 618000, northing: 6690000, height: 189.5 }),
});

const bindingA = createStaticCollisionBinding({
  collisionId: 'terrain:center:collision',
  artifactSha256: TERRAIN_ARTIFACT_SHA256,
  worldFrame,
  tileFrame: terrainTileFrame,
  physicsFrame: frameA,
});
const bindingB = createStaticCollisionBinding({
  collisionId: bindingA.collisionId,
  artifactSha256: bindingA.artifactSha256,
  worldFrame,
  tileFrame: terrainTileFrame,
  physicsFrame: frameB,
});
assertStaticCollisionBinding({ binding: bindingA, worldFrame, tileFrame: terrainTileFrame, physicsFrame: frameA });
assertStaticCollisionBinding({ binding: bindingB, worldFrame, tileFrame: terrainTileFrame, physicsFrame: frameB });

function vecDistance(a, b) {
  return Math.hypot(a.easting - b.easting, a.northing - b.northing, a.height - b.height);
}

function quaternionDistance(a, b) {
  const normA = Math.hypot(a.x, a.y, a.z, a.w);
  const normB = Math.hypot(b.x, b.y, b.z, b.w);
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) / (normA * normB);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

function localBodyToWorld(body, physicsFrame) {
  const p = body.translation();
  return {
    easting: physicsFrame.anchorWorld.easting + p.x,
    northing: physicsFrame.anchorWorld.northing + p.z,
    height: physicsFrame.anchorWorld.height + p.y,
  };
}

function capture(world, handles, physicsFrame) {
  return handles.map((handle) => {
    const body = world.getRigidBody(handle);
    const r = body.rotation();
    const v = body.linvel();
    return {
      worldPosition: localBodyToWorld(body, physicsFrame),
      velocity: { x: v.x, y: v.y, z: v.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  });
}

function compare(reference, candidate) {
  let maxPositionDriftM = 0;
  let maxVelocityDriftMps = 0;
  let maxRotationDriftRad = 0;
  for (let i = 0; i < reference.length; i += 1) {
    maxPositionDriftM = Math.max(maxPositionDriftM, vecDistance(reference[i].worldPosition, candidate[i].worldPosition));
    maxVelocityDriftMps = Math.max(maxVelocityDriftMps, Math.hypot(
      reference[i].velocity.x - candidate[i].velocity.x,
      reference[i].velocity.y - candidate[i].velocity.y,
      reference[i].velocity.z - candidate[i].velocity.z,
    ));
    maxRotationDriftRad = Math.max(maxRotationDriftRad, quaternionDistance(reference[i].rotation, candidate[i].rotation));
  }
  return { maxPositionDriftM, maxVelocityDriftMps, maxRotationDriftRad };
}

function step(world, count) {
  for (let i = 0; i < count; i += 1) world.step();
}

function makeScene() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;

  const floorLocal = tileCollisionPointToPhysicsLocal64({
    worldFrame, tileFrame: terrainTileFrame, physicsFrame: frameA, tileLocal: { east: 0, north: 0, up: 0 },
  });
  const floor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(floorLocal[0], floorLocal[1], floorLocal[2]),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setFriction(0.9), floor);

  const bodyA = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(-1, 0.55, 0).setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(1).setFriction(0.8), bodyA);
  const bodyB = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 0.55, 0).setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(1).setFriction(0.8), bodyB);

  const identity = { w: 1, x: 0, y: 0, z: 0 };
  world.createImpulseJoint(
    RAPIER.JointData.fixed({ x: 1, y: 0, z: 0 }, identity, { x: -1, y: 0, z: 0 }, identity),
    bodyA,
    bodyB,
    true,
  );

  return { world, floorHandle: floor.handle, bodyHandles: [bodyA.handle, bodyB.handle] };
}

function migrateDynamics(world, bodyHandles) {
  const dx = frameB.anchorWorld.easting - frameA.anchorWorld.easting;
  const dy = frameB.anchorWorld.height - frameA.anchorWorld.height;
  const dz = frameB.anchorWorld.northing - frameA.anchorWorld.northing;
  for (const handle of bodyHandles) {
    const body = world.getRigidBody(handle);
    const p = body.translation();
    body.setTranslation({ x: p.x - dx, y: p.y - dy, z: p.z - dz }, false);
  }
}

function rebindStaticFloor(world, floorHandle) {
  const floorTarget = tileCollisionPointToPhysicsLocal64({
    worldFrame, tileFrame: terrainTileFrame, physicsFrame: frameB, tileLocal: { east: 0, north: 0, up: 0 },
  });
  world.getRigidBody(floorHandle).setTranslation({ x: floorTarget[0], y: floorTarget[1], z: floorTarget[2] }, false);
}

const staticWorldA = physicsLocal64ToWorldCollisionPoint({
  worldFrame,
  physicsFrame: frameA,
  localPosition: tileCollisionPointToPhysicsLocal64({
    worldFrame, tileFrame: terrainTileFrame, physicsFrame: frameA, tileLocal: { east: 0, north: 0, up: 0 },
  }),
});
const staticWorldB = physicsLocal64ToWorldCollisionPoint({
  worldFrame,
  physicsFrame: frameB,
  localPosition: tileCollisionPointToPhysicsLocal64({
    worldFrame, tileFrame: terrainTileFrame, physicsFrame: frameB, tileLocal: { east: 0, north: 0, up: 0 },
  }),
});
if (vecDistance(staticWorldA, staticWorldB) !== 0) throw new Error('static world anchor changed across physics-frame binding');

const seed = makeScene();
step(seed.world, PRE_MIGRATION_STEPS);
const checkpoint = seed.world.takeSnapshot();
seed.world.free();

const fixed = RAPIER.World.restoreSnapshot(checkpoint);
fixed.timestep = DT;
step(fixed, POST_MIGRATION_STEPS);
const fixedFinal = capture(fixed, seed.bodyHandles, frameA);
fixed.free();

const correct = RAPIER.World.restoreSnapshot(checkpoint);
correct.timestep = DT;
migrateDynamics(correct, seed.bodyHandles);
rebindStaticFloor(correct, seed.floorHandle);
step(correct, POST_MIGRATION_STEPS);
const correctFinal = capture(correct, seed.bodyHandles, frameB);
const correctComparison = compare(fixedFinal, correctFinal);
correct.free();

const dynamicsOnly = RAPIER.World.restoreSnapshot(checkpoint);
dynamicsOnly.timestep = DT;
migrateDynamics(dynamicsOnly, seed.bodyHandles);
step(dynamicsOnly, POST_MIGRATION_STEPS);
const dynamicsOnlyFinal = capture(dynamicsOnly, seed.bodyHandles, frameB);
const dynamicsOnlyComparison = compare(fixedFinal, dynamicsOnlyFinal);
dynamicsOnly.free();

if (!(dynamicsOnlyComparison.maxPositionDriftM > 1)) {
  throw new Error(`expected dynamics-only migration to diverge by >1 m when static world is left in the old local frame; got ${dynamicsOnlyComparison.maxPositionDriftM}`);
}
if (!(correctComparison.maxPositionDriftM < dynamicsOnlyComparison.maxPositionDriftM)) {
  throw new Error('rebinding static collision did not improve world-state preservation over dynamics-only migration');
}
for (const comparison of [correctComparison, dynamicsOnlyComparison]) {
  for (const value of Object.values(comparison)) if (!Number.isFinite(value)) throw new Error('non-finite comparison metric');
}

console.log(JSON.stringify({
  status: 'ATLAS_RAPIER_STATIC_WORLD_MIGRATION_PROBE_COMPLETE',
  rapierPackage: '@dimforge/rapier3d-compat@0.19.3',
  evidenceClass: 'hosted-node-wasm-candidate',
  worldFrame: {
    id: worldFrame.id,
    horizontalCrs: worldFrame.horizontalCrs,
    verticalDatum: worldFrame.verticalDatum,
  },
  terrainCollision: {
    tileId: bindingA.tileId,
    artifactSha256: bindingA.artifactSha256,
    staticWorldAnchorInvariantM: vecDistance(staticWorldA, staticWorldB),
    bindingEpochs: [bindingA.physicsFrame.epoch, bindingB.physicsFrame.epoch],
  },
  migration: {
    eastM: MIGRATION_EAST_M,
    northM: MIGRATION_NORTH_M,
    preMigrationSteps: PRE_MIGRATION_STEPS,
    postMigrationSteps: POST_MIGRATION_STEPS,
  },
  correctDynamicAndStaticRebind: correctComparison,
  adversarialDynamicsOnlyMigration: dynamicsOnlyComparison,
  authority: {
    staticTileArtifactIdentityIsWorldTruthInput: true,
    staticColliderPhysicsLocalPoseIsDerived: true,
    physicsFrameEpochRequiredForStaticCollisionBinding: true,
    renderOriginAuthority: false,
  },
  policy: {
    wholeNorwayCoordinatePolicy: 'OPEN',
    physicsBackendSelection: 'OPEN',
    physicsIslandExtent: 'OPEN',
    staticCollisionStreamingPolicy: 'OPEN',
  },
}, null, 2));
