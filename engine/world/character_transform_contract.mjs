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
  const heading = finite(value, 'headingRadians') % TAU;
  return heading < 0 ? heading + TAU : heading;
}

function cloneWorldPosition(worldFrame, position, label = 'character position') {
  if (!position || typeof position !== 'object') {
    fail('INVALID_WORLD_POSITION', `${label} is required`);
  }
  if (position.worldFrameId !== worldFrame?.id) {
    fail('WORLD_FRAME_MISMATCH', `${label} belongs to ${position.worldFrameId}, expected ${worldFrame?.id}`);
  }
  return createWorldPosition(worldFrame, {
    easting: position.easting,
    northing: position.northing,
    height: position.height,
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
  cloneWorldPosition(worldFrame, transform.position);
  finite(transform.headingRadians, 'headingRadians');
  return transform;
}

export function createCharacterWorldTransform({ entityId, worldFrame, position, headingRadians = 0 }) {
  const authoritativePosition = cloneWorldPosition(worldFrame, position);
  return Object.freeze({
    schema: CHARACTER_TRANSFORM_SCHEMA,
    entityId: nonEmpty(entityId, 'entityId'),
    worldFrameId: worldFrame.id,
    position: authoritativePosition,
    headingRadians: normalizeHeadingRadians(headingRadians),
  });
}

export function setCharacterHeading(worldFrame, transform, headingRadians) {
  const current = assertCharacterTransform(worldFrame, transform);
  return createCharacterWorldTransform({
    entityId: current.entityId,
    worldFrame,
    position: current.position,
    headingRadians,
  });
}

export function moveCharacterPlanar(worldFrame, transform, { forwardMeters = 0, rightMeters = 0 } = {}) {
  const current = assertCharacterTransform(worldFrame, transform);
  const forward = finite(forwardMeters, 'forwardMeters');
  const right = finite(rightMeters, 'rightMeters');
  const heading = current.headingRadians;

  // Heading is clockwise from projected-grid north. This keeps locomotion
  // renderer-neutral while matching common geospatial bearing semantics.
  const eastDelta = Math.sin(heading) * forward + Math.cos(heading) * right;
  const northDelta = Math.cos(heading) * forward - Math.sin(heading) * right;

  return createCharacterWorldTransform({
    entityId: current.entityId,
    worldFrame,
    position: createWorldPosition(worldFrame, {
      easting: current.position.easting + eastDelta,
      northing: current.position.northing + northDelta,
      height: current.position.height,
    }),
    headingRadians: heading,
  });
}

export function setCharacterWorldHeight(worldFrame, transform, height) {
  const current = assertCharacterTransform(worldFrame, transform);
  return createCharacterWorldTransform({
    entityId: current.entityId,
    worldFrame,
    position: createWorldPosition(worldFrame, {
      easting: current.position.easting,
      northing: current.position.northing,
      height: finite(height, 'height'),
    }),
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
  authoritativePosition: 'WorldPosition/Float64',
  renderPosition: 'derived Float32Array(3), origin-epoch scoped',
});
