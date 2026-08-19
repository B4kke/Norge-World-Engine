import { createPhysicsSpatialFrame } from './physics_state_contract.mjs';

export const PHYSICS_FRAME_MAINTENANCE_EVENT_SCHEMA = 'nwe.physics-frame-maintenance-event/0.1-candidate';

export class PhysicsFrameEventContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhysicsFrameEventContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhysicsFrameEventContractError(code, message);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}

function safeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INTEGER', `${label} must be a non-negative safe integer`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail('NON_FINITE', `${label} must be finite`);
  return value;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}

function assertWorldFrame(worldFrame) {
  if (!worldFrame || typeof worldFrame !== 'object') fail('INVALID_WORLD_FRAME', 'worldFrame is required');
  nonEmpty(worldFrame.id, 'worldFrame.id');
  nonEmpty(worldFrame.horizontalCrs, 'worldFrame.horizontalCrs');
  nonEmpty(worldFrame.verticalDatum, 'worldFrame.verticalDatum');
}

function anchorObject(anchor, label) {
  if (!anchor || typeof anchor !== 'object') fail('INVALID_ANCHOR', `${label} is required`);
  return Object.freeze({
    easting: finite(anchor.easting, `${label}.easting`),
    northing: finite(anchor.northing, `${label}.northing`),
    height: finite(anchor.height, `${label}.height`),
  });
}

function deltaObject(delta, label = 'deltaWorld') {
  exactKeys(delta, ['east', 'north', 'up'], label);
  return Object.freeze({
    east: finite(delta.east, `${label}.east`),
    north: finite(delta.north, `${label}.north`),
    up: finite(delta.up, `${label}.up`),
  });
}

function sameNumber(a, b) {
  return Object.is(a, b) || Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;
}

function assertDeltaMatchesAnchors(fromAnchor, toAnchor, delta) {
  const expected = {
    east: toAnchor.easting - fromAnchor.easting,
    north: toAnchor.northing - fromAnchor.northing,
    up: toAnchor.height - fromAnchor.height,
  };
  for (const axis of ['east', 'north', 'up']) {
    if (!sameNumber(delta[axis], expected[axis])) {
      fail('DELTA_MISMATCH', `deltaWorld.${axis} does not match authoritative anchor delta`);
    }
  }
}

function assertFrameIdentity(frame, label) {
  if (!frame || typeof frame !== 'object') fail('INVALID_PHYSICS_FRAME', `${label} is required`);
  nonEmpty(frame.physicsFrameId, `${label}.physicsFrameId`);
  nonEmpty(frame.worldFrameId, `${label}.worldFrameId`);
  safeNonNegativeInteger(frame.epoch, `${label}.epoch`);
  anchorObject(frame.anchorWorld, `${label}.anchorWorld`);
}

export function createPhysicsFrameMaintenanceEvent({
  tick,
  worldFrame,
  fromFrame,
  toFrame,
  reason = 'origin-maintenance',
}) {
  assertWorldFrame(worldFrame);
  assertFrameIdentity(fromFrame, 'fromFrame');
  assertFrameIdentity(toFrame, 'toFrame');
  safeNonNegativeInteger(tick, 'tick');
  nonEmpty(reason, 'reason');

  if (fromFrame.worldFrameId !== worldFrame.id || toFrame.worldFrameId !== worldFrame.id) {
    fail('WORLD_FRAME_MISMATCH', 'physics frame maintenance event must stay in one authoritative world frame');
  }
  if (fromFrame.physicsFrameId !== toFrame.physicsFrameId) {
    fail('PHYSICS_FRAME_MISMATCH', 'physics frame maintenance event cannot switch frame series');
  }
  if (toFrame.epoch !== fromFrame.epoch + 1) {
    fail('NON_CONSECUTIVE_EPOCH', 'physics frame maintenance event must advance exactly one epoch');
  }

  const fromAnchorWorld = anchorObject(fromFrame.anchorWorld, 'fromFrame.anchorWorld');
  const toAnchorWorld = anchorObject(toFrame.anchorWorld, 'toFrame.anchorWorld');
  const deltaWorld = Object.freeze({
    east: toAnchorWorld.easting - fromAnchorWorld.easting,
    north: toAnchorWorld.northing - fromAnchorWorld.northing,
    up: toAnchorWorld.height - fromAnchorWorld.height,
  });

  return Object.freeze({
    schema: PHYSICS_FRAME_MAINTENANCE_EVENT_SCHEMA,
    tick,
    worldFrameId: worldFrame.id,
    physicsFrameId: fromFrame.physicsFrameId,
    fromEpoch: fromFrame.epoch,
    toEpoch: toFrame.epoch,
    reason,
    fromAnchorWorld,
    toAnchorWorld,
    deltaWorld,
  });
}

export function serializePhysicsFrameMaintenanceEvent(event) {
  const normalized = deserializePhysicsFrameMaintenanceEvent(JSON.stringify(event));
  return JSON.stringify(normalized);
}

export function deserializePhysicsFrameMaintenanceEvent(serialized) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_EVENT_JSON', 'physics frame event must be valid JSON'); }
  exactKeys(parsed, [
    'schema', 'tick', 'worldFrameId', 'physicsFrameId', 'fromEpoch', 'toEpoch', 'reason',
    'fromAnchorWorld', 'toAnchorWorld', 'deltaWorld',
  ], 'physics frame event');
  if (parsed.schema !== PHYSICS_FRAME_MAINTENANCE_EVENT_SCHEMA) {
    fail('UNSUPPORTED_EVENT_SCHEMA', `event schema must be ${PHYSICS_FRAME_MAINTENANCE_EVENT_SCHEMA}`);
  }

  const tick = safeNonNegativeInteger(parsed.tick, 'tick');
  const worldFrameId = nonEmpty(parsed.worldFrameId, 'worldFrameId');
  const physicsFrameId = nonEmpty(parsed.physicsFrameId, 'physicsFrameId');
  const fromEpoch = safeNonNegativeInteger(parsed.fromEpoch, 'fromEpoch');
  const toEpoch = safeNonNegativeInteger(parsed.toEpoch, 'toEpoch');
  if (toEpoch !== fromEpoch + 1) fail('NON_CONSECUTIVE_EPOCH', 'event must advance exactly one physics epoch');
  const reason = nonEmpty(parsed.reason, 'reason');

  exactKeys(parsed.fromAnchorWorld, ['easting', 'northing', 'height'], 'fromAnchorWorld');
  exactKeys(parsed.toAnchorWorld, ['easting', 'northing', 'height'], 'toAnchorWorld');
  const fromAnchorWorld = anchorObject(parsed.fromAnchorWorld, 'fromAnchorWorld');
  const toAnchorWorld = anchorObject(parsed.toAnchorWorld, 'toAnchorWorld');
  const deltaWorld = deltaObject(parsed.deltaWorld);
  assertDeltaMatchesAnchors(fromAnchorWorld, toAnchorWorld, deltaWorld);

  return Object.freeze({
    schema: PHYSICS_FRAME_MAINTENANCE_EVENT_SCHEMA,
    tick,
    worldFrameId,
    physicsFrameId,
    fromEpoch,
    toEpoch,
    reason,
    fromAnchorWorld,
    toAnchorWorld,
    deltaWorld,
  });
}

export function applyPhysicsFrameMaintenanceEvent({ worldFrame, currentFrame, event }) {
  assertWorldFrame(worldFrame);
  assertFrameIdentity(currentFrame, 'currentFrame');
  const normalized = typeof event === 'string'
    ? deserializePhysicsFrameMaintenanceEvent(event)
    : deserializePhysicsFrameMaintenanceEvent(JSON.stringify(event));

  if (normalized.worldFrameId !== worldFrame.id || currentFrame.worldFrameId !== worldFrame.id) {
    fail('WORLD_FRAME_MISMATCH', 'event/current physics frame does not belong to the authoritative world frame');
  }
  if (normalized.physicsFrameId !== currentFrame.physicsFrameId) {
    fail('PHYSICS_FRAME_MISMATCH', 'event belongs to another physics frame series');
  }
  if (normalized.fromEpoch !== currentFrame.epoch) {
    fail('STALE_PHYSICS_EPOCH', `event starts at epoch ${normalized.fromEpoch}, current frame is epoch ${currentFrame.epoch}`);
  }

  const currentAnchor = anchorObject(currentFrame.anchorWorld, 'currentFrame.anchorWorld');
  for (const axis of ['easting', 'northing', 'height']) {
    if (!sameNumber(currentAnchor[axis], normalized.fromAnchorWorld[axis])) {
      fail('FROM_ANCHOR_MISMATCH', `event fromAnchorWorld.${axis} does not match current physics frame`);
    }
  }

  const frame = createPhysicsSpatialFrame({
    physicsFrameId: currentFrame.physicsFrameId,
    worldFrame,
    epoch: normalized.toEpoch,
    anchorWorld: {
      worldFrameId: worldFrame.id,
      easting: normalized.toAnchorWorld.easting,
      northing: normalized.toAnchorWorld.northing,
      height: normalized.toAnchorWorld.height,
    },
  });
  return Object.freeze({ frame, event: normalized });
}

export function validatePhysicsFrameMaintenanceSequence(events) {
  if (!Array.isArray(events)) fail('INVALID_EVENT_SEQUENCE', 'events must be an array');
  const lastByFrame = new Map();
  let previousTick = -1;
  for (const raw of events) {
    const event = typeof raw === 'string'
      ? deserializePhysicsFrameMaintenanceEvent(raw)
      : deserializePhysicsFrameMaintenanceEvent(JSON.stringify(raw));
    if (event.tick < previousTick) fail('NON_MONOTONIC_TICK', 'physics frame maintenance events must be globally ordered by non-decreasing tick');
    previousTick = event.tick;
    const key = `${event.worldFrameId}\u0000${event.physicsFrameId}`;
    const previous = lastByFrame.get(key);
    if (previous && event.fromEpoch !== previous.toEpoch) {
      fail('EPOCH_SEQUENCE_GAP', `physics frame ${event.physicsFrameId} event sequence has an epoch gap`);
    }
    lastByFrame.set(key, event);
  }
  return Object.freeze(events.map((event) => Object.freeze(event)));
}
