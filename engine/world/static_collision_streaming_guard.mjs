import {
  applyStaticCollisionLifecycleEvent,
  createStaticCollisionLifecycleEvent,
  STATIC_COLLISION_LIFECYCLE_PHASE,
  STATIC_COLLISION_LIFECYCLE_SCHEMA,
} from './static_collision_lifecycle_contract.mjs';
import { deriveStaticCollisionDependencies } from './static_collision_occupancy_contract.mjs';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function requireTick(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('simulation tick must be a non-negative safe integer');
  return value;
}

function requireIdentity(identity) {
  if (identity == null) return null;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new TypeError('getCollisionIdentity must return null or an object');
  }
  const allowed = ['collisionId', 'artifactSha256'];
  const extras = Object.keys(identity).filter((key) => !allowed.includes(key));
  if (extras.length) throw new TypeError(`collision identity contains unsupported field(s): ${extras.join(', ')}`);
  return identity;
}

/**
 * Adapter between STRØM's renderer-neutral payload disposal callback and ATLAS'
 * static collision lifecycle. Scheduler cache/residency is never collision
 * authority: a bound collision is preflighted against simulation dependencies
 * before payload disposal, and lifecycle state is committed only after the
 * downstream disposal succeeds.
 *
 * STRØM callbacks do not carry simulation time, so callers must provide the
 * current authoritative simulation tick explicitly. The guard never invents a
 * tick from scheduler generation, wall-clock time or renderer lifecycle state.
 */
export function createStaticCollisionStreamingGuard({
  initialState,
  getCurrentPhysicsFrame,
  getSimulationTick,
  getCollisionIdentity,
  disposeTile = async () => {},
} = {}) {
  if (!initialState || typeof initialState !== 'object') throw new TypeError('initialState is required');
  requireFunction(getCurrentPhysicsFrame, 'getCurrentPhysicsFrame');
  requireFunction(getSimulationTick, 'getSimulationTick');
  requireFunction(getCollisionIdentity, 'getCollisionIdentity');
  requireFunction(disposeTile, 'disposeTile');

  let state = initialState;

  function getState() {
    return state;
  }

  function collisionFor(identity, tileId) {
    const collision = state.collisions.find((entry) => entry.collisionId === identity.collisionId);
    if (!collision) throw new Error(`no resident static collision ${identity.collisionId} for ${tileId}`);
    if (collision.tileId !== tileId) throw new Error(`collision ${identity.collisionId} belongs to ${collision.tileId}, not ${tileId}`);
    if (collision.artifactSha256 !== identity.artifactSha256) {
      throw new Error(`collision ${identity.collisionId} artifact does not match streaming payload`);
    }
    return collision;
  }

  function makeEvent({ tick, action, tileId, identity, dependentEntityIds }) {
    const currentPhysicsFrame = getCurrentPhysicsFrame();
    return {
      event: createStaticCollisionLifecycleEvent({
        schema: STATIC_COLLISION_LIFECYCLE_SCHEMA,
        phase: STATIC_COLLISION_LIFECYCLE_PHASE,
        tick: requireTick(tick),
        action,
        collisionId: identity.collisionId,
        tileId,
        artifactSha256: identity.artifactSha256,
        previousArtifactSha256: null,
        worldFrameId: state.worldFrameId,
        physicsFrame: currentPhysicsFrame,
        dependentEntityIds,
        continuity: 'none',
      }),
      currentPhysicsFrame,
    };
  }

  function setDependencies({ tick, tile, payload, dependentEntityIds }) {
    const identity = requireIdentity(getCollisionIdentity(tile, payload));
    if (identity == null) throw new Error(`tile ${tile?.id ?? '<unknown>'} has no bound static collision`);
    collisionFor(identity, tile.id);
    const { event, currentPhysicsFrame } = makeEvent({
      tick,
      action: 'SET_DEPENDENCIES',
      tileId: tile.id,
      identity,
      dependentEntityIds,
    });
    state = applyStaticCollisionLifecycleEvent({ state, event, currentPhysicsFrame });
    return state;
  }

  function syncDependenciesFromOccupancy({ snapshot, expectedCompletedPhysicsTick, lifecycleTick = getSimulationTick() } = {}) {
    const currentPhysicsFrame = getCurrentPhysicsFrame();
    const derived = deriveStaticCollisionDependencies({
      snapshot,
      collisionState: state,
      expectedTick: requireTick(expectedCompletedPhysicsTick),
      currentPhysicsFrame,
    });
    let candidateState = state;
    for (const dependency of derived) {
      const collision = candidateState.collisions.find((entry) => entry.collisionId === dependency.collisionId);
      if (!collision) throw new Error(`no resident static collision ${dependency.collisionId}`);
      const event = createStaticCollisionLifecycleEvent({
        schema: STATIC_COLLISION_LIFECYCLE_SCHEMA,
        phase: STATIC_COLLISION_LIFECYCLE_PHASE,
        tick: requireTick(lifecycleTick),
        action: 'SET_DEPENDENCIES',
        collisionId: collision.collisionId,
        tileId: collision.tileId,
        artifactSha256: collision.artifactSha256,
        previousArtifactSha256: null,
        worldFrameId: candidateState.worldFrameId,
        physicsFrame: currentPhysicsFrame,
        dependentEntityIds: dependency.dependentEntityIds,
        continuity: 'none',
      });
      candidateState = applyStaticCollisionLifecycleEvent({ state: candidateState, event, currentPhysicsFrame });
    }
    state = candidateState;
    return state;
  }

  async function guardedDisposeTile(tile, payload, context = {}) {
    const identity = requireIdentity(getCollisionIdentity(tile, payload));
    if (identity == null) return disposeTile(tile, payload, context);

    collisionFor(identity, tile.id);
    const { event, currentPhysicsFrame } = makeEvent({
      tick: getSimulationTick(),
      action: 'EVICT',
      tileId: tile.id,
      identity,
      dependentEntityIds: [],
    });

    // Preflight produces the candidate collision state but does not publish it.
    // If downstream disposal fails, both scheduler payload and collision state
    // remain present instead of creating a split-brain lifecycle.
    const candidateState = applyStaticCollisionLifecycleEvent({ state, event, currentPhysicsFrame });
    const result = await disposeTile(tile, payload, context);
    state = candidateState;
    return result;
  }

  return Object.freeze({
    getState,
    setDependencies,
    syncDependenciesFromOccupancy,
    disposeTile: guardedDisposeTile,
  });
}
