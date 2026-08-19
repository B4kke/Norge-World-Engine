import RAPIER from '@dimforge/rapier3d-compat';
import {
  createStaticCollisionOccupancySnapshot,
  deriveStaticCollisionDependencies,
} from '../../engine/world/static_collision_occupancy_contract.mjs';
import {
  applyStaticCollisionLifecycleEvent,
  createStaticCollisionLifecycleState,
} from '../../engine/world/static_collision_lifecycle_contract.mjs';

await RAPIER.init();

const DT = 1 / 60;
const MAX_STEPS = 420;
const WORLD_FRAME_ID = 'nwe-world-nannestad-rapier-tile-crossing';
const PHYSICS_FRAME = Object.freeze({ physicsFrameId: 'physics:terrain-crossing', epoch: 0 });
const ENTITY_ID = 'entity:crossing-body';
const TILE_A = Object.freeze({
  collisionId: 'terrain:tile-a:collision',
  tileId: 'nannestad:tile-a',
  artifactSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});
const TILE_B = Object.freeze({
  collisionId: 'terrain:tile-b:collision',
  tileId: 'nannestad:tile-b',
  artifactSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});

function lifecycleEvent({ tick, action, collision, dependentEntityIds = [] }) {
  return {
    schema: 'nwe.static-collision-lifecycle-event/0.1-candidate',
    phase: 'after-frame-maintenance-before-physics-step',
    tick,
    action,
    collisionId: collision.collisionId,
    tileId: collision.tileId,
    artifactSha256: collision.artifactSha256,
    previousArtifactSha256: null,
    worldFrameId: WORLD_FRAME_ID,
    physicsFrame: PHYSICS_FRAME,
    dependentEntityIds,
    continuity: 'none',
  };
}

function syncDependencies(state, tick, activeCollisionIds) {
  const contacts = [...activeCollisionIds].map((collisionId) => {
    const collision = collisionId === TILE_A.collisionId ? TILE_A : TILE_B;
    return {
      entityId: ENTITY_ID,
      collisionId: collision.collisionId,
      tileId: collision.tileId,
      artifactSha256: collision.artifactSha256,
    };
  });
  const snapshot = createStaticCollisionOccupancySnapshot({
    schema: 'nwe.static-collision-occupancy-snapshot/0.1-candidate',
    phase: 'after-physics-step',
    tick,
    worldFrameId: WORLD_FRAME_ID,
    physicsFrame: PHYSICS_FRAME,
    contacts,
  });
  const dependencies = deriveStaticCollisionDependencies({
    snapshot,
    collisionState: state,
    expectedTick: tick,
    currentPhysicsFrame: PHYSICS_FRAME,
  });
  let next = state;
  for (const dependency of dependencies) {
    const collision = dependency.collisionId === TILE_A.collisionId ? TILE_A : TILE_B;
    next = applyStaticCollisionLifecycleEvent({
      state: next,
      currentPhysicsFrame: PHYSICS_FRAME,
      event: lifecycleEvent({
        tick: tick + 1,
        action: 'SET_DEPENDENCIES',
        collision,
        dependentEntityIds: dependency.dependentEntityIds,
      }),
    });
  }
  return { state: next, snapshot, dependencies };
}

function tryEvict(state, tick, collision) {
  try {
    return {
      state: applyStaticCollisionLifecycleEvent({
        state,
        currentPhysicsFrame: PHYSICS_FRAME,
        event: lifecycleEvent({ tick, action: 'EVICT', collision }),
      }),
      errorCode: null,
    };
  } catch (error) {
    return { state, errorCode: error?.code ?? error?.name ?? 'UNKNOWN_ERROR' };
  }
}

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const eventQueue = new RAPIER.EventQueue(true);

const floorBodyA = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-2.5, 0, 0));
const floorColliderA = world.createCollider(
  RAPIER.ColliderDesc.cuboid(2.5, 0.25, 2)
    .setFriction(0)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
  floorBodyA,
);
const floorBodyB = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(2.5, 0, 0));
const floorColliderB = world.createCollider(
  RAPIER.ColliderDesc.cuboid(2.5, 0.25, 2)
    .setFriction(0)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
  floorBodyB,
);
const body = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(-4, 0.7, 0)
    .setLinvel(2, 0, 0)
    .setCanSleep(false),
);
const bodyCollider = world.createCollider(
  RAPIER.ColliderDesc.ball(0.45)
    .setFriction(0)
    .setRestitution(0)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
  body,
);

const staticByHandle = new Map([
  [floorColliderA.handle, TILE_A],
  [floorColliderB.handle, TILE_B],
]);
const activeCollisionIds = new Set();
const transitions = [];
let lifecycleState = createStaticCollisionLifecycleState({
  worldFrameId: WORLD_FRAME_ID,
  physicsFrameId: PHYSICS_FRAME.physicsFrameId,
  physicsEpoch: PHYSICS_FRAME.epoch,
  collisions: [
    { ...TILE_A, dependentEntityIds: [] },
    { ...TILE_B, dependentEntityIds: [] },
  ],
});

let rendererInterestRemovedTick = null;
let blockedEvictionTick = null;
let tileBContactStartedTick = null;
let tileAContactStoppedTick = null;
let successfulEvictionTick = null;
let staleEventOrderingDetected = false;

for (let tick = 0; tick < MAX_STEPS; tick += 1) {
  world.step(eventQueue);
  eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    const dynamicPair = handle1 === bodyCollider.handle ? handle2 : handle2 === bodyCollider.handle ? handle1 : null;
    if (dynamicPair == null) return;
    const collision = staticByHandle.get(dynamicPair);
    if (!collision) return;
    if (started) activeCollisionIds.add(collision.collisionId);
    else activeCollisionIds.delete(collision.collisionId);
    transitions.push({ tick, collisionId: collision.collisionId, started });
    if (collision.collisionId === TILE_B.collisionId && started && tileBContactStartedTick == null) tileBContactStartedTick = tick;
    if (collision.collisionId === TILE_A.collisionId && !started && tileAContactStoppedTick == null) tileAContactStoppedTick = tick;
  });

  const synced = syncDependencies(lifecycleState, tick, activeCollisionIds);
  lifecycleState = synced.state;

  const tileADependencies = synced.dependencies.find((item) => item.collisionId === TILE_A.collisionId)?.dependentEntityIds ?? [];
  if (rendererInterestRemovedTick == null && tick >= 30 && tileADependencies.includes(ENTITY_ID)) {
    rendererInterestRemovedTick = tick;
    const attempt = tryEvict(lifecycleState, tick + 1, TILE_A);
    blockedEvictionTick = tick;
    if (attempt.errorCode !== 'COLLISION_IN_USE') {
      throw new Error(`tile A eviction was not blocked while solver occupancy still pinned it; got ${attempt.errorCode}`);
    }
    lifecycleState = attempt.state;
  }

  if (tileAContactStoppedTick != null && successfulEvictionTick == null) {
    const afterStopDependencies = lifecycleState.collisions.find((item) => item.collisionId === TILE_A.collisionId)?.dependentEntityIds ?? [];
    if (afterStopDependencies.length !== 0) {
      staleEventOrderingDetected = true;
      throw new Error('tile A contact stop was observed but occupancy-derived dependencies were not released in the same completed step');
    }
    const attempt = tryEvict(lifecycleState, tick + 1, TILE_A);
    if (attempt.errorCode !== null) throw new Error(`tile A eviction stayed blocked after solver occupancy released it: ${attempt.errorCode}`);
    lifecycleState = attempt.state;
    successfulEvictionTick = tick;
    break;
  }
}

const tileAStillResident = lifecycleState.collisions.some((item) => item.collisionId === TILE_A.collisionId);
const tileBStillResident = lifecycleState.collisions.some((item) => item.collisionId === TILE_B.collisionId);

if (rendererInterestRemovedTick == null) throw new Error('probe never reached renderer-interest removal while tile A was occupied');
if (blockedEvictionTick == null) throw new Error('probe never attempted the required blocked eviction');
if (tileBContactStartedTick == null) throw new Error('body never established solver contact with tile B');
if (tileAContactStoppedTick == null) throw new Error('body never released solver contact with tile A');
if (successfulEvictionTick == null) throw new Error('tile A was never evicted after solver occupancy released it');
if (tileAStillResident) throw new Error('tile A collision remained resident after successful eviction');
if (!tileBStillResident) throw new Error('tile B collision unexpectedly disappeared');
if (!(tileBContactStartedTick <= tileAContactStoppedTick)) {
  throw new Error('expected tile B contact to begin no later than tile A contact release at the boundary crossing');
}

const finalPosition = body.translation();
eventQueue.free();
world.free();

console.log(JSON.stringify({
  schema: 'nwe.atlas-rapier-tile-crossing-occupancy-proof/0.1',
  backend: '@dimforge/rapier3d-compat@0.19.3',
  timestepSeconds: DT,
  worldFrame: {
    horizontalCrs: 'EPSG:25832',
    verticalDatum: 'NN2000',
    id: WORLD_FRAME_ID,
  },
  rendererInterestRemovedTick,
  blockedEvictionTick,
  tileBContactStartedTick,
  tileAContactStoppedTick,
  successfulEvictionTick,
  staleEventOrderingDetected,
  transitionCount: transitions.length,
  transitions,
  finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z },
  assertions: {
    rendererInterestCannotEvictOccupiedCollision: true,
    solverStopReleasesDependencyBeforeNextPhysicsStep: true,
    releasedCollisionCanEvict: true,
    adjacentTileCollisionRemainsResident: true,
  },
}, null, 2));
