import {
  createWorldPosition,
  worldToRenderLocal,
} from './world_contract.mjs';

const CHARACTER_TRANSFORM_SCHEMA = 'nwe.character-world-transform/0.1-candidate';
const TAU = Math.PI * 2;

export class CharacterTransformError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CharacterTransformError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CharacterTransformError(code, message);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail('NON_FINITE', `${label} must be finite`);
  return value;
}

function normalizeHeadingRadians(value) {
  const wrapped = finite(value, 'headingRadians') % TAU;
  if (wrapped === 0) return 0;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

function assertCanonicalHeading(value) {
  const heading = finite(value, 'headingRadians');
  if (heading < 0 || heading >= TAU || Object.is(heading, -0)) {
    fail('NON_CANONICAL_HEADING', 'headingRadians must be canonical in [0, 2π)');
  }
  return heading;
}

function assertWorldPosition(worldFrame, position, label = 'character position') {
  if (!position || typeof position !== 'object') {
    fail('INVALID_WORLD_POSITION', `${label} is required`);
  }
  if (position.worldFrameId !== worldFrame?.id) {
    fail('WORLD_FRAME_MISMATCH', `${label} belongs to ${position.worldFrameId}, expected ${worldFrame?.id}`);
  }
  finite(position.easting, `${label}.easting`);
  finite(position.northing, `${label}.northing`);
  finite(position.height, `${label}.height`);
  return position;
}

function cloneWorldPosition(worldFrame, position, label = 'character position') {
  const valid = assertWorldPosition(worldFrame, position, label);
  return createWorldPosition(worldFrame, {
    easting: valid.easting,
    northing: valid.northing,
    height: valid.height,
  });
}

function freezeCharacterTransform({ entityId, worldFrameId, position, headingRadians }) {
  return Object.freeze({
    schema: CHARACTER_TRANSFORM_SCHEMA,
    entityId,
    worldFrameId,
    position,
    headingRadians,
  });
}

function assertCharacterTransform(worldFrame, transform) {
  if (!transform || typeof transform !== 'object') {
    fail('INVALID_CHARACTER_TRANSFORM', 'character transform is required');
  }
  if (transform.schema !== CHARACTER_TRANSFORM_SCHEMA) {
    fail('INVALID_CHARACTER_TRANSFORM', `character transform schema must be ${CHARACTER_TRANSFORM_SCHEMA}`);
  }
  nonEmpty(transform.entityId, 'entityId');
  if (transform.worldFrameId !== worldFrame?.id) {
    fail('WORLD_FRAME_MISMATCH', `character transform belongs to ${transform.worldFrameId}, expected ${worldFrame?.id}`);
  }
  assertWorldPosition(worldFrame, transform.position);
  assertCanonicalHeading(transform.headingRadians);
  return transform;
}

export function createCharacterWorldTransform({ entityId, worldFrame, position, headingRadians = 0 }) {
  return freezeCharacterTransform({
    entityId: nonEmpty(entityId, 'entityId'),
    worldFrameId: worldFrame?.id,
    position: cloneWorldPosition(worldFrame, position),
    headingRadians: normalizeHeadingRadians(headingRadians),
  });
}

export function setCharacterHeading(worldFrame, transform, headingRadians) {
  const current = assertCharacterTransform(worldFrame, transform);
  const nextHeading = normalizeHeadingRadians(headingRadians);
  if (nextHeading === current.headingRadians) return current;

  return freezeCharacterTransform({
    entityId: current.entityId,
    worldFrameId: current.worldFrameId,
    position: current.position,
    headingRadians: nextHeading,
  });
}

export function moveCharacterPlanar(worldFrame, transform, { forwardMeters = 0, rightMeters = 0 } = {}) {
  const current = assertCharacterTransform(worldFrame, transform);
  const forward = finite(forwardMeters, 'forwardMeters');
  const right = finite(rightMeters, 'rightMeters');
  if (forward === 0 && right === 0) return current;

  const heading = current.headingRadians;

  // Heading is clockwise from projected-grid north. This keeps locomotion
  // renderer-neutral while matching common geospatial bearing semantics.
  const sinHeading = Math.sin(heading);
  const cosHeading = Math.cos(heading);
  const eastDelta = sinHeading * forward + cosHeading * right;
  const northDelta = cosHeading * forward - sinHeading * right;
  const position = createWorldPosition(worldFrame, {
    easting: current.position.easting + eastDelta,
    northing: current.position.northing + northDelta,
    height: current.position.height,
  });

  return freezeCharacterTransform({
    entityId: current.entityId,
    worldFrameId: current.worldFrameId,
    position,
    headingRadians: heading,
  });
}

export function setCharacterWorldHeight(worldFrame, transform, height) {
  const current = assertCharacterTransform(worldFrame, transform);
  const nextHeight = finite(height, 'height');
  if (nextHeight === current.position.height) return current;

  const position = createWorldPosition(worldFrame, {
    easting: current.position.easting,
    northing: current.position.northing,
    height: nextHeight,
  });

  return freezeCharacterTransform({
    entityId: current.entityId,
    worldFrameId: current.worldFrameId,
    position,
    headingRadians: current.headingRadians,
  });
}

export function deriveCharacterRenderTransform(worldFrame, transform, renderOrigin) {
  const current = assertCharacterTransform(worldFrame, transform);
  const local = worldToRenderLocal(worldFrame, current.position, renderOrigin);
  return Object.freeze({
    entityId: current.entityId,
    worldFrameId: current.worldFrameId,
    originSeriesId: local.originSeriesId,
    originEpoch: local.originEpoch,
    position: local.xyz,
    headingRadians: current.headingRadians,
  });
}

export const characterTransformContract = Object.freeze({
  schema: CHARACTER_TRANSFORM_SCHEMA,
  headingConvention: 'clockwise-radians-from-projected-grid-north',
  headingRange: '[0, 2π)',
  authoritativePosition: 'WorldPosition/Float64',
  renderPosition: 'derived Float32Array(3), origin-epoch scoped',
});
