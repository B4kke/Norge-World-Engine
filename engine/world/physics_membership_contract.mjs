export const PHYSICS_MEMBERSHIP_EVENT_SCHEMA = 'nwe.physics-frame-membership-event/0.1-candidate';

export class PhysicsMembershipContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhysicsMembershipContractError';
    this.code = code;
  }
}

function fail(code, message) { throw new PhysicsMembershipContractError(code, message); }
function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}
function safeEpoch(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_EPOCH', `${label} must be a non-negative safe integer`);
  return value;
}
function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}
function normalizeSide(frameId, epoch, label) {
  if (frameId === null) {
    if (epoch !== null) fail('EPOCH_WITHOUT_FRAME', `${label}Epoch must be null when ${label}PhysicsFrameId is null`);
    return { frameId: null, epoch: null };
  }
  return { frameId: nonEmpty(frameId, `${label}PhysicsFrameId`), epoch: safeEpoch(epoch, `${label}Epoch`) };
}
function frameMap(currentFrames, worldFrameId) {
  if (!Array.isArray(currentFrames)) fail('INVALID_CURRENT_FRAMES', 'currentFrames must be an array');
  const map = new Map();
  for (const frame of currentFrames) {
    if (!frame || typeof frame !== 'object') fail('INVALID_PHYSICS_FRAME', 'current frame must be an object');
    const id = nonEmpty(frame.physicsFrameId, 'currentFrame.physicsFrameId');
    if (map.has(id)) fail('DUPLICATE_PHYSICS_FRAME', `duplicate current physics frame ${id}`);
    if (frame.worldFrameId !== worldFrameId) fail('WORLD_FRAME_MISMATCH', `physics frame ${id} belongs to another world frame`);
    safeEpoch(frame.epoch, 'currentFrame.epoch');
    map.set(id, frame);
  }
  return map;
}

export function createPhysicsMembershipEvent({ tick, worldFrameId, entityId, fromPhysicsFrameId = null, fromEpoch = null, toPhysicsFrameId = null, toEpoch = null, reason = 'membership-change' }) {
  safeEpoch(tick, 'tick');
  nonEmpty(worldFrameId, 'worldFrameId');
  nonEmpty(entityId, 'entityId');
  nonEmpty(reason, 'reason');
  const from = normalizeSide(fromPhysicsFrameId, fromEpoch, 'from');
  const to = normalizeSide(toPhysicsFrameId, toEpoch, 'to');
  if (from.frameId === null && to.frameId === null) fail('EMPTY_MEMBERSHIP_CHANGE', 'membership event must attach, detach, or migrate');
  if (from.frameId !== null && from.frameId === to.frameId) {
    fail('SAME_FRAME_MEMBERSHIP_CHANGE', 'epoch/origin maintenance within one physics frame is not a membership event');
  }
  return Object.freeze({
    schema: PHYSICS_MEMBERSHIP_EVENT_SCHEMA,
    tick,
    worldFrameId,
    entityId,
    phase: 'after-frame-maintenance',
    fromPhysicsFrameId: from.frameId,
    fromEpoch: from.epoch,
    toPhysicsFrameId: to.frameId,
    toEpoch: to.epoch,
    reason,
  });
}

export function deserializePhysicsMembershipEvent(serialized) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_EVENT_JSON', 'physics membership event must be valid JSON'); }
  exactKeys(parsed, ['schema','tick','worldFrameId','entityId','phase','fromPhysicsFrameId','fromEpoch','toPhysicsFrameId','toEpoch','reason'], 'physics membership event');
  if (parsed.schema !== PHYSICS_MEMBERSHIP_EVENT_SCHEMA) fail('UNSUPPORTED_EVENT_SCHEMA', `event schema must be ${PHYSICS_MEMBERSHIP_EVENT_SCHEMA}`);
  if (parsed.phase !== 'after-frame-maintenance') fail('UNSUPPORTED_PHASE', 'membership event phase must be after-frame-maintenance');
  return createPhysicsMembershipEvent(parsed);
}

export function serializePhysicsMembershipEvent(event) {
  return JSON.stringify(deserializePhysicsMembershipEvent(JSON.stringify(event)));
}

export function applyPhysicsMembershipEvent({ worldFrameId, currentFrames, currentMembership = null, event }) {
  nonEmpty(worldFrameId, 'worldFrameId');
  const normalized = typeof event === 'string' ? deserializePhysicsMembershipEvent(event) : deserializePhysicsMembershipEvent(JSON.stringify(event));
  if (normalized.worldFrameId !== worldFrameId) fail('WORLD_FRAME_MISMATCH', 'membership event belongs to another authoritative world frame');
  const frames = frameMap(currentFrames, worldFrameId);

  if (currentMembership !== null) {
    exactKeys(currentMembership, ['entityId','worldFrameId','physicsFrameId','physicsFrameEpoch'], 'currentMembership');
    if (currentMembership.entityId !== normalized.entityId) fail('ENTITY_MISMATCH', 'current membership belongs to another entity');
    if (currentMembership.worldFrameId !== worldFrameId) fail('WORLD_FRAME_MISMATCH', 'current membership belongs to another world frame');
    if (currentMembership.physicsFrameId !== normalized.fromPhysicsFrameId || currentMembership.physicsFrameEpoch !== normalized.fromEpoch) {
      fail('STALE_MEMBERSHIP', 'event source membership does not match current entity membership');
    }
  } else if (normalized.fromPhysicsFrameId !== null) {
    fail('MISSING_SOURCE_MEMBERSHIP', 'attach/detach/migration source does not match current unowned entity');
  }

  for (const [side, frameId, epoch] of [
    ['from', normalized.fromPhysicsFrameId, normalized.fromEpoch],
    ['to', normalized.toPhysicsFrameId, normalized.toEpoch],
  ]) {
    if (frameId === null) continue;
    const frame = frames.get(frameId);
    if (!frame) fail('MISSING_PHYSICS_FRAME', `${side} physics frame ${frameId} is not present after maintenance`);
    if (frame.epoch !== epoch) fail('STALE_PHYSICS_EPOCH', `${side} physics frame ${frameId} epoch ${epoch} does not match post-maintenance epoch ${frame.epoch}`);
  }

  if (normalized.toPhysicsFrameId === null) return Object.freeze({ membership: null, event: normalized });
  return Object.freeze({
    membership: Object.freeze({
      entityId: normalized.entityId,
      worldFrameId,
      physicsFrameId: normalized.toPhysicsFrameId,
      physicsFrameEpoch: normalized.toEpoch,
    }),
    event: normalized,
  });
}

export function canonicalizePhysicsMembershipBatch(events) {
  if (!Array.isArray(events) || events.length === 0) fail('INVALID_EVENT_BATCH', 'events must be a non-empty array');
  const normalized = events.map((event) => typeof event === 'string' ? deserializePhysicsMembershipEvent(event) : deserializePhysicsMembershipEvent(JSON.stringify(event)));
  const tick = normalized[0].tick;
  const worldFrameId = normalized[0].worldFrameId;
  const seenEntities = new Set();
  for (const event of normalized) {
    if (event.tick !== tick) fail('MIXED_TICKS', 'membership batch must contain exactly one simulation tick');
    if (event.worldFrameId !== worldFrameId) fail('MIXED_WORLD_FRAMES', 'membership batch must contain exactly one authoritative world frame');
    if (seenEntities.has(event.entityId)) fail('AMBIGUOUS_ENTITY_ORDER', `entity ${event.entityId} has multiple same-tick membership changes`);
    seenEntities.add(event.entityId);
  }
  normalized.sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
  return Object.freeze(normalized);
}
