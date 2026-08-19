import {
  applyPhysicsFrameMaintenanceEvent,
  deserializePhysicsFrameMaintenanceEvent,
} from './physics_frame_event_contract.mjs';

export const PHYSICS_FRAME_MAINTENANCE_BATCH_SCHEMA = 'nwe.physics-frame-maintenance-batch/0.1-candidate';

export class PhysicsFrameBatchContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhysicsFrameBatchContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhysicsFrameBatchContractError(code, message);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}

function safeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INTEGER', `${label} must be a non-negative safe integer`);
  return value;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeEvent(raw) {
  try {
    return typeof raw === 'string'
      ? deserializePhysicsFrameMaintenanceEvent(raw)
      : deserializePhysicsFrameMaintenanceEvent(JSON.stringify(raw));
  } catch (error) {
    fail(error?.code ?? 'INVALID_EVENT', error?.message ?? 'invalid physics frame maintenance event');
  }
}

function canonicalEventCompare(a, b) {
  const frameOrder = compareText(a.physicsFrameId, b.physicsFrameId);
  if (frameOrder !== 0) return frameOrder;
  if (a.fromEpoch !== b.fromEpoch) return a.fromEpoch - b.fromEpoch;
  if (a.toEpoch !== b.toEpoch) return a.toEpoch - b.toEpoch;
  return compareText(a.reason, b.reason);
}

function normalizeBatchObject(raw) {
  exactKeys(raw, ['schema', 'tick', 'worldFrameId', 'events'], 'physics frame maintenance batch');
  if (raw.schema !== PHYSICS_FRAME_MAINTENANCE_BATCH_SCHEMA) {
    fail('UNSUPPORTED_BATCH_SCHEMA', `batch schema must be ${PHYSICS_FRAME_MAINTENANCE_BATCH_SCHEMA}`);
  }

  const tick = safeNonNegativeInteger(raw.tick, 'tick');
  const worldFrameId = nonEmpty(raw.worldFrameId, 'worldFrameId');
  if (!Array.isArray(raw.events) || raw.events.length === 0) {
    fail('INVALID_EVENT_BATCH', 'physics frame maintenance batch must contain at least one event');
  }

  const events = raw.events.map(normalizeEvent).map((event) => {
    if (event.tick !== tick) fail('BATCH_TICK_MISMATCH', `event tick ${event.tick} does not match batch tick ${tick}`);
    if (event.worldFrameId !== worldFrameId) {
      fail('BATCH_WORLD_FRAME_MISMATCH', `event world frame ${event.worldFrameId} does not match batch world frame ${worldFrameId}`);
    }
    return event;
  }).sort(canonicalEventCompare);

  const lastByFrame = new Map();
  const seenTransition = new Set();
  for (const event of events) {
    const transitionKey = `${event.physicsFrameId}\u0000${event.fromEpoch}\u0000${event.toEpoch}`;
    if (seenTransition.has(transitionKey)) {
      fail('DUPLICATE_FRAME_TRANSITION', `physics frame ${event.physicsFrameId} repeats epoch transition ${event.fromEpoch}->${event.toEpoch}`);
    }
    seenTransition.add(transitionKey);

    const previous = lastByFrame.get(event.physicsFrameId);
    if (previous && event.fromEpoch !== previous.toEpoch) {
      fail('EPOCH_SEQUENCE_GAP', `physics frame ${event.physicsFrameId} has non-consecutive transitions within tick ${tick}`);
    }
    lastByFrame.set(event.physicsFrameId, event);
  }

  return Object.freeze({
    schema: PHYSICS_FRAME_MAINTENANCE_BATCH_SCHEMA,
    tick,
    worldFrameId,
    events: Object.freeze(events),
  });
}

export function createPhysicsFrameMaintenanceBatch({ tick, worldFrame, events }) {
  if (!worldFrame || typeof worldFrame !== 'object') fail('INVALID_WORLD_FRAME', 'worldFrame is required');
  const worldFrameId = nonEmpty(worldFrame.id, 'worldFrame.id');
  return normalizeBatchObject({
    schema: PHYSICS_FRAME_MAINTENANCE_BATCH_SCHEMA,
    tick,
    worldFrameId,
    events,
  });
}

export function serializePhysicsFrameMaintenanceBatch(batch) {
  const normalized = normalizeBatchObject(batch);
  return JSON.stringify(normalized);
}

export function deserializePhysicsFrameMaintenanceBatch(serialized) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_BATCH_JSON', 'physics frame maintenance batch must be valid JSON'); }
  return normalizeBatchObject(parsed);
}

export function applyPhysicsFrameMaintenanceBatch({ worldFrame, currentFrames, batch }) {
  if (!worldFrame || typeof worldFrame !== 'object') fail('INVALID_WORLD_FRAME', 'worldFrame is required');
  nonEmpty(worldFrame.id, 'worldFrame.id');
  if (!Array.isArray(currentFrames) || currentFrames.length === 0) {
    fail('INVALID_CURRENT_FRAMES', 'currentFrames must contain at least one physics frame');
  }

  const normalized = typeof batch === 'string'
    ? deserializePhysicsFrameMaintenanceBatch(batch)
    : normalizeBatchObject(batch);
  if (normalized.worldFrameId !== worldFrame.id) {
    fail('BATCH_WORLD_FRAME_MISMATCH', 'batch belongs to another authoritative world frame');
  }

  const framesById = new Map();
  for (const frame of currentFrames) {
    if (!frame || typeof frame !== 'object') fail('INVALID_PHYSICS_FRAME', 'current physics frame must be an object');
    const physicsFrameId = nonEmpty(frame.physicsFrameId, 'currentFrame.physicsFrameId');
    if (frame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', `physics frame ${physicsFrameId} belongs to another world frame`);
    if (framesById.has(physicsFrameId)) fail('DUPLICATE_CURRENT_FRAME', `duplicate current physics frame ${physicsFrameId}`);
    framesById.set(physicsFrameId, frame);
  }

  for (const event of normalized.events) {
    const currentFrame = framesById.get(event.physicsFrameId);
    if (!currentFrame) fail('MISSING_CURRENT_FRAME', `no current physics frame for ${event.physicsFrameId}`);
    let applied;
    try {
      applied = applyPhysicsFrameMaintenanceEvent({ worldFrame, currentFrame, event });
    } catch (error) {
      fail(error?.code ?? 'EVENT_APPLY_FAILED', error?.message ?? 'physics frame maintenance event could not be applied');
    }
    framesById.set(event.physicsFrameId, applied.frame);
  }

  const frames = [...framesById.values()].sort((a, b) => compareText(a.physicsFrameId, b.physicsFrameId));
  return Object.freeze({ batch: normalized, frames: Object.freeze(frames) });
}
