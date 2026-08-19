import { applyPhysicsFrameMaintenanceEvent } from './physics_frame_event_contract.mjs';
import { createStaticCollisionLifecycleState } from './static_collision_lifecycle_contract.mjs';

export const STATIC_COLLISION_EPOCH_REBIND_SCHEMA = 'nwe.static-collision-epoch-rebind/0.1-candidate';

export class StaticCollisionEpochRebindError extends Error {
  constructor(code, message) { super(message); this.name = 'StaticCollisionEpochRebindError'; this.code = code; }
}
const fail = (code, message) => { throw new StaticCollisionEpochRebindError(code, message); };
const id = (value, label) => { if (typeof value !== 'string' || !value.trim()) fail('INVALID_IDENTITY', `${label} must be non-empty`); return value; };
const sha = (value, label) => { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail('INVALID_ARTIFACT_SHA256', `${label} must be lowercase SHA-256`); return value; };
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !keys.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}
function sortedIds(values) {
  if (!Array.isArray(values)) fail('INVALID_DEPENDENCIES', 'dependentEntityIds must be an array');
  const out = values.map((value, index) => id(value, `dependentEntityIds[${index}]`));
  if (new Set(out).size !== out.length) fail('DUPLICATE_DEPENDENCY', 'dependentEntityIds must be unique');
  return [...out].sort();
}
function equalArrays(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }

export function planStaticCollisionEpochRebind({ worldFrame, currentPhysicsFrame, lifecycleState, transaction }) {
  exact(transaction, ['schema','tick','worldFrameId','maintenanceEvent','replacement'], 'transaction');
  if (transaction.schema !== STATIC_COLLISION_EPOCH_REBIND_SCHEMA) fail('UNSUPPORTED_SCHEMA', `schema must be ${STATIC_COLLISION_EPOCH_REBIND_SCHEMA}`);
  if (!Number.isSafeInteger(transaction.tick) || transaction.tick < 0) fail('INVALID_TICK', 'tick must be a non-negative safe integer');
  if (transaction.worldFrameId !== worldFrame?.id || lifecycleState?.worldFrameId !== worldFrame?.id) fail('WORLD_FRAME_MISMATCH', 'transaction/state must belong to authoritative world frame');
  if (lifecycleState.physicsFrameId !== currentPhysicsFrame?.physicsFrameId || lifecycleState.physicsEpoch !== currentPhysicsFrame?.epoch) fail('STALE_LIFECYCLE_FRAME', 'lifecycle state must match current physics frame before maintenance');
  if (transaction.maintenanceEvent?.tick !== transaction.tick) fail('TICK_MISMATCH', 'maintenance event tick must equal transaction tick');

  const { frame: nextPhysicsFrame, event } = applyPhysicsFrameMaintenanceEvent({ worldFrame, currentFrame: currentPhysicsFrame, event: transaction.maintenanceEvent });
  const replacement = transaction.replacement;
  exact(replacement, ['collisionId','tileId','previousArtifactSha256','artifactSha256','dependentEntityIds','continuity'], 'replacement');
  if (replacement.continuity !== 'atomic-rebind') fail('CONTINUITY_REQUIRED', 'epoch+artifact replacement requires atomic-rebind');
  const collisionId = id(replacement.collisionId, 'replacement.collisionId');
  const tileId = id(replacement.tileId, 'replacement.tileId');
  const previousArtifactSha256 = sha(replacement.previousArtifactSha256, 'replacement.previousArtifactSha256');
  const artifactSha256 = sha(replacement.artifactSha256, 'replacement.artifactSha256');
  if (artifactSha256 === previousArtifactSha256) fail('NOOP_REPLACEMENT', 'replacement artifact must change');
  const dependentEntityIds = sortedIds(replacement.dependentEntityIds);
  const current = lifecycleState.collisions.find((collision) => collision.collisionId === collisionId);
  if (!current) fail('NOT_RESIDENT', 'replacement collision is not resident');
  if (current.tileId !== tileId) fail('TILE_ID_MISMATCH', 'replacement tile does not match resident collision');
  if (current.artifactSha256 !== previousArtifactSha256) fail('PREVIOUS_ARTIFACT_MISMATCH', 'replacement must name exact resident artifact');
  if (!equalArrays([...current.dependentEntityIds], dependentEntityIds)) fail('OCCUPANCY_CONTINUITY_MISMATCH', 'atomic rebind must preserve current solver-derived dependencies');

  const collisions = lifecycleState.collisions.map((collision) => collision.collisionId === collisionId
    ? { collisionId, tileId, artifactSha256, dependentEntityIds }
    : { collisionId: collision.collisionId, tileId: collision.tileId, artifactSha256: collision.artifactSha256, dependentEntityIds: [...collision.dependentEntityIds] });
  const nextLifecycleState = createStaticCollisionLifecycleState({
    worldFrameId: lifecycleState.worldFrameId,
    physicsFrameId: nextPhysicsFrame.physicsFrameId,
    physicsEpoch: nextPhysicsFrame.epoch,
    collisions,
  });
  return Object.freeze({
    nextPhysicsFrame,
    nextLifecycleState,
    maintenanceEvent: event,
    replacement: Object.freeze({ collisionId, tileId, previousArtifactSha256, artifactSha256, dependentEntityIds: Object.freeze(dependentEntityIds), continuity: 'atomic-rebind' }),
    solverLocalTranslation: Object.freeze({ x: -event.deltaWorld.east, y: -event.deltaWorld.up, z: -event.deltaWorld.north }),
  });
}
