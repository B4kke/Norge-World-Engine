export const PHYSICS_TOPOLOGY_TRANSITION_SCHEMA = 'nwe.physics-frame-topology-transition/0.1-candidate';

export class PhysicsTopologyContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhysicsTopologyContractError';
    this.code = code;
  }
}

function fail(code, message) { throw new PhysicsTopologyContractError(code, message); }
function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}
function safeInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INTEGER', `${label} must be a non-negative safe integer`);
  return value;
}
function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}
function frameKey(id, epoch) { return `${id}@${epoch}`; }

function normalizeAssignment(value) {
  exactKeys(value, ['entityId','fromPhysicsFrameId','fromEpoch','toPhysicsFrameId','toEpoch'], 'entity assignment');
  return Object.freeze({
    entityId: nonEmpty(value.entityId, 'entityId'),
    fromPhysicsFrameId: nonEmpty(value.fromPhysicsFrameId, 'fromPhysicsFrameId'),
    fromEpoch: safeInt(value.fromEpoch, 'fromEpoch'),
    toPhysicsFrameId: nonEmpty(value.toPhysicsFrameId, 'toPhysicsFrameId'),
    toEpoch: safeInt(value.toEpoch, 'toEpoch'),
  });
}
function normalizeConstraint(value) {
  exactKeys(value, ['constraintId','entityAId','entityBId'], 'constraint');
  const constraintId = nonEmpty(value.constraintId, 'constraintId');
  const entityAId = nonEmpty(value.entityAId, 'entityAId');
  const entityBId = nonEmpty(value.entityBId, 'entityBId');
  if (entityAId === entityBId) fail('SELF_CONSTRAINT', `constraint ${constraintId} cannot bind an entity to itself`);
  const [a, b] = entityAId < entityBId ? [entityAId, entityBId] : [entityBId, entityAId];
  return Object.freeze({ constraintId, entityAId: a, entityBId: b });
}
function currentFrameMap(currentFrames, worldFrameId) {
  if (!Array.isArray(currentFrames) || currentFrames.length === 0) fail('INVALID_CURRENT_FRAMES', 'currentFrames must be a non-empty array');
  const map = new Map();
  for (const frame of currentFrames) {
    exactKeys(frame, ['physicsFrameId','worldFrameId','epoch'], 'current physics frame');
    const id = nonEmpty(frame.physicsFrameId, 'physicsFrameId');
    if (frame.worldFrameId !== worldFrameId) fail('WORLD_FRAME_MISMATCH', `physics frame ${id} belongs to another world frame`);
    const epoch = safeInt(frame.epoch, 'physics frame epoch');
    if (map.has(id)) fail('DUPLICATE_PHYSICS_FRAME', `duplicate physics frame ${id}`);
    map.set(id, { physicsFrameId: id, worldFrameId, epoch });
  }
  return map;
}
function membershipMap(currentMemberships, worldFrameId) {
  if (!Array.isArray(currentMemberships) || currentMemberships.length === 0) fail('INVALID_CURRENT_MEMBERSHIPS', 'currentMemberships must be a non-empty array');
  const map = new Map();
  for (const membership of currentMemberships) {
    exactKeys(membership, ['entityId','worldFrameId','physicsFrameId','physicsFrameEpoch'], 'current membership');
    const entityId = nonEmpty(membership.entityId, 'membership.entityId');
    if (membership.worldFrameId !== worldFrameId) fail('WORLD_FRAME_MISMATCH', `membership ${entityId} belongs to another world frame`);
    if (map.has(entityId)) fail('DUPLICATE_MEMBERSHIP', `duplicate membership ${entityId}`);
    map.set(entityId, {
      entityId,
      worldFrameId,
      physicsFrameId: nonEmpty(membership.physicsFrameId, 'membership.physicsFrameId'),
      physicsFrameEpoch: safeInt(membership.physicsFrameEpoch, 'membership.physicsFrameEpoch'),
    });
  }
  return map;
}

export function createPhysicsTopologyTransition({ tick, worldFrameId, transitionId, assignments, activeConstraints = [], reason = 'topology-repartition' }) {
  safeInt(tick, 'tick');
  nonEmpty(worldFrameId, 'worldFrameId');
  nonEmpty(transitionId, 'transitionId');
  nonEmpty(reason, 'reason');
  if (!Array.isArray(assignments) || assignments.length === 0) fail('INVALID_ASSIGNMENTS', 'assignments must be a non-empty array');
  if (!Array.isArray(activeConstraints)) fail('INVALID_CONSTRAINTS', 'activeConstraints must be an array');

  const normalizedAssignments = assignments.map(normalizeAssignment);
  const seenEntities = new Set();
  for (const assignment of normalizedAssignments) {
    if (seenEntities.has(assignment.entityId)) fail('DUPLICATE_ENTITY_ASSIGNMENT', `entity ${assignment.entityId} appears more than once`);
    seenEntities.add(assignment.entityId);
  }
  normalizedAssignments.sort((a, b) => a.entityId.localeCompare(b.entityId));

  const normalizedConstraints = activeConstraints.map(normalizeConstraint);
  const seenConstraints = new Set();
  for (const constraint of normalizedConstraints) {
    if (seenConstraints.has(constraint.constraintId)) fail('DUPLICATE_CONSTRAINT', `constraint ${constraint.constraintId} appears more than once`);
    seenConstraints.add(constraint.constraintId);
  }
  normalizedConstraints.sort((a, b) => a.constraintId.localeCompare(b.constraintId));

  const fromFrames = new Set(normalizedAssignments.map((a) => frameKey(a.fromPhysicsFrameId, a.fromEpoch)));
  const toFrames = new Set(normalizedAssignments.map((a) => frameKey(a.toPhysicsFrameId, a.toEpoch)));
  const transitionKind = fromFrames.size === 1 && toFrames.size > 1 ? 'split'
    : fromFrames.size > 1 && toFrames.size === 1 ? 'merge'
      : 'repartition';

  return Object.freeze({
    schema: PHYSICS_TOPOLOGY_TRANSITION_SCHEMA,
    tick,
    worldFrameId,
    transitionId,
    phase: 'after-frame-maintenance',
    transitionKind,
    assignments: Object.freeze(normalizedAssignments),
    activeConstraints: Object.freeze(normalizedConstraints),
    reason,
  });
}

export function deserializePhysicsTopologyTransition(serialized) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_EVENT_JSON', 'physics topology transition must be valid JSON'); }
  exactKeys(parsed, ['schema','tick','worldFrameId','transitionId','phase','transitionKind','assignments','activeConstraints','reason'], 'physics topology transition');
  if (parsed.schema !== PHYSICS_TOPOLOGY_TRANSITION_SCHEMA) fail('UNSUPPORTED_EVENT_SCHEMA', `schema must be ${PHYSICS_TOPOLOGY_TRANSITION_SCHEMA}`);
  if (parsed.phase !== 'after-frame-maintenance') fail('UNSUPPORTED_PHASE', 'topology transition phase must be after-frame-maintenance');
  const normalized = createPhysicsTopologyTransition(parsed);
  if (normalized.transitionKind !== parsed.transitionKind) fail('TRANSITION_KIND_MISMATCH', `declared transitionKind ${parsed.transitionKind} does not match derived ${normalized.transitionKind}`);
  return normalized;
}

export function serializePhysicsTopologyTransition(event) {
  return JSON.stringify(deserializePhysicsTopologyTransition(JSON.stringify(event)));
}

export function applyPhysicsTopologyTransition({ worldFrameId, currentFrames, currentMemberships, event }) {
  nonEmpty(worldFrameId, 'worldFrameId');
  const transition = typeof event === 'string' ? deserializePhysicsTopologyTransition(event) : deserializePhysicsTopologyTransition(JSON.stringify(event));
  if (transition.worldFrameId !== worldFrameId) fail('WORLD_FRAME_MISMATCH', 'topology transition belongs to another authoritative world frame');
  const frames = currentFrameMap(currentFrames, worldFrameId);
  const memberships = membershipMap(currentMemberships, worldFrameId);
  if (memberships.size !== transition.assignments.length) fail('PARTIAL_TOPOLOGY_SCOPE', 'transition must cover the complete supplied membership scope');

  const targets = new Map();
  for (const assignment of transition.assignments) {
    const current = memberships.get(assignment.entityId);
    if (!current) fail('UNKNOWN_ENTITY', `entity ${assignment.entityId} is not in current membership scope`);
    if (current.physicsFrameId !== assignment.fromPhysicsFrameId || current.physicsFrameEpoch !== assignment.fromEpoch) {
      fail('STALE_MEMBERSHIP', `entity ${assignment.entityId} source frame/epoch does not match current membership`);
    }
    for (const [label, frameId, epoch] of [
      ['from', assignment.fromPhysicsFrameId, assignment.fromEpoch],
      ['to', assignment.toPhysicsFrameId, assignment.toEpoch],
    ]) {
      const frame = frames.get(frameId);
      if (!frame) fail('MISSING_PHYSICS_FRAME', `${label} frame ${frameId} is not present after maintenance`);
      if (frame.epoch !== epoch) fail('STALE_PHYSICS_EPOCH', `${label} frame ${frameId} epoch ${epoch} does not match current epoch ${frame.epoch}`);
    }
    targets.set(assignment.entityId, { physicsFrameId: assignment.toPhysicsFrameId, physicsFrameEpoch: assignment.toEpoch });
  }

  for (const constraint of transition.activeConstraints) {
    const a = targets.get(constraint.entityAId);
    const b = targets.get(constraint.entityBId);
    if (!a || !b) fail('UNKNOWN_CONSTRAINT_ENDPOINT', `constraint ${constraint.constraintId} endpoint is outside the transition scope`);
    if (a.physicsFrameId !== b.physicsFrameId || a.physicsFrameEpoch !== b.physicsFrameEpoch) {
      fail('CROSS_FRAME_CONSTRAINT', `constraint ${constraint.constraintId} would span physics frames after ${transition.transitionKind}`);
    }
  }

  const nextMemberships = transition.assignments.map((assignment) => Object.freeze({
    entityId: assignment.entityId,
    worldFrameId,
    physicsFrameId: assignment.toPhysicsFrameId,
    physicsFrameEpoch: assignment.toEpoch,
  })).sort((a, b) => a.entityId.localeCompare(b.entityId));

  return Object.freeze({ transition, memberships: Object.freeze(nextMemberships) });
}
