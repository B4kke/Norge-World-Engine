import { tileLocalToWorld } from './world_contract.mjs';

const STATIC_COLLISION_BINDING_SCHEMA = 'nwe.static-world-collision-binding/0.1-candidate';

export class StaticCollisionContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StaticCollisionContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new StaticCollisionContractError(code, message);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail('NON_FINITE', `${label} must be finite`);
  return value;
}

function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_EPOCH', 'physicsFrame.epoch must be a non-negative safe integer');
  return value;
}

function sha256(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail('INVALID_ARTIFACT_SHA256', 'artifactSha256 must be lowercase 64-hex SHA-256');
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
  if (worldFrame.horizontalUnit !== 'metre' || worldFrame.verticalUnit !== 'metre') fail('UNSUPPORTED_UNIT', 'static collision binding requires metre world units');
}

function assertFrameCompatibility(worldFrame, tileFrame, physicsFrame) {
  assertWorldFrame(worldFrame);
  if (!tileFrame || tileFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'tileFrame belongs to another world frame');
  if (!physicsFrame || physicsFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'physicsFrame belongs to another world frame');
  nonEmpty(tileFrame.tileId, 'tileFrame.tileId');
  nonEmpty(physicsFrame.physicsFrameId, 'physicsFrame.physicsFrameId');
  epoch(physicsFrame.epoch);
  for (const [label, anchor] of [['tileFrame.anchorWorld', tileFrame.anchorWorld], ['physicsFrame.anchorWorld', physicsFrame.anchorWorld]]) {
    if (!anchor || anchor.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', `${label} belongs to another world frame`);
    finite(anchor.easting, `${label}.easting`);
    finite(anchor.northing, `${label}.northing`);
    finite(anchor.height, `${label}.height`);
  }
}

export function createStaticCollisionBinding({
  collisionId,
  artifactSha256,
  worldFrame,
  tileFrame,
  physicsFrame,
}) {
  assertFrameCompatibility(worldFrame, tileFrame, physicsFrame);
  return Object.freeze({
    schema: STATIC_COLLISION_BINDING_SCHEMA,
    collisionId: nonEmpty(collisionId, 'collisionId'),
    artifactSha256: sha256(artifactSha256),
    tileId: tileFrame.tileId,
    worldFrame: Object.freeze({
      id: worldFrame.id,
      horizontalCrs: worldFrame.horizontalCrs,
      horizontalUnit: worldFrame.horizontalUnit,
      verticalDatum: worldFrame.verticalDatum,
      verticalUnit: worldFrame.verticalUnit,
    }),
    physicsFrame: Object.freeze({
      physicsFrameId: physicsFrame.physicsFrameId,
      epoch: physicsFrame.epoch,
    }),
    tileAnchorWorld: Object.freeze({
      easting: tileFrame.anchorWorld.easting,
      northing: tileFrame.anchorWorld.northing,
      height: tileFrame.anchorWorld.height,
    }),
    physicsAnchorWorld: Object.freeze({
      easting: physicsFrame.anchorWorld.easting,
      northing: physicsFrame.anchorWorld.northing,
      height: physicsFrame.anchorWorld.height,
    }),
    tileOriginPhysicsLocal64: new Float64Array([
      tileFrame.anchorWorld.easting - physicsFrame.anchorWorld.easting,
      tileFrame.anchorWorld.height - physicsFrame.anchorWorld.height,
      tileFrame.anchorWorld.northing - physicsFrame.anchorWorld.northing,
    ]),
  });
}

export function assertStaticCollisionBinding({ binding, worldFrame, tileFrame, physicsFrame }) {
  assertFrameCompatibility(worldFrame, tileFrame, physicsFrame);
  if (!binding || typeof binding !== 'object') fail('INVALID_BINDING', 'binding is required');
  if (binding.schema !== STATIC_COLLISION_BINDING_SCHEMA) fail('UNSUPPORTED_SCHEMA', `binding schema must be ${STATIC_COLLISION_BINDING_SCHEMA}`);
  if (binding.worldFrame?.id !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'binding belongs to another world frame');
  if (binding.worldFrame.horizontalCrs !== worldFrame.horizontalCrs) fail('HORIZONTAL_CRS_MISMATCH', 'binding horizontal CRS does not match world frame');
  if (binding.worldFrame.verticalDatum !== worldFrame.verticalDatum) fail('VERTICAL_DATUM_MISMATCH', 'binding vertical datum does not match world frame');
  if (binding.tileId !== tileFrame.tileId) fail('TILE_ID_MISMATCH', 'binding belongs to another runtime tile');
  if (binding.physicsFrame?.physicsFrameId !== physicsFrame.physicsFrameId) fail('PHYSICS_FRAME_MISMATCH', 'binding belongs to another physics frame');
  if (binding.physicsFrame.epoch !== physicsFrame.epoch) fail('PHYSICS_EPOCH_MISMATCH', 'binding belongs to another physics epoch');
  sha256(binding.artifactSha256);
  return binding;
}

export function tileCollisionPointToPhysicsLocal64({
  worldFrame,
  tileFrame,
  physicsFrame,
  tileLocal,
}) {
  assertFrameCompatibility(worldFrame, tileFrame, physicsFrame);
  exactKeys(tileLocal, ['east', 'north', 'up'], 'tileLocal');
  const worldPosition = tileLocalToWorld(worldFrame, tileFrame, {
    east: finite(tileLocal.east, 'tileLocal.east'),
    north: finite(tileLocal.north, 'tileLocal.north'),
    up: finite(tileLocal.up, 'tileLocal.up'),
  });
  return new Float64Array([
    worldPosition.easting - physicsFrame.anchorWorld.easting,
    worldPosition.height - physicsFrame.anchorWorld.height,
    worldPosition.northing - physicsFrame.anchorWorld.northing,
  ]);
}

export function physicsLocal64ToWorldCollisionPoint({ worldFrame, physicsFrame, localPosition }) {
  assertWorldFrame(worldFrame);
  if (!physicsFrame || physicsFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'physicsFrame belongs to another world frame');
  if (!(localPosition instanceof Float64Array) || localPosition.length !== 3) fail('INVALID_LOCAL_POSITION', 'localPosition must be Float64Array(3)');
  return Object.freeze({
    worldFrameId: worldFrame.id,
    easting: physicsFrame.anchorWorld.easting + finite(localPosition[0], 'localPosition[0]'),
    northing: physicsFrame.anchorWorld.northing + finite(localPosition[2], 'localPosition[2]'),
    height: physicsFrame.anchorWorld.height + finite(localPosition[1], 'localPosition[1]'),
  });
}

export function parseStaticCollisionBinding(document) {
  exactKeys(document, ['schema', 'collisionId', 'artifactSha256', 'tileId', 'worldFrame', 'physicsFrame', 'tileAnchorWorld', 'physicsAnchorWorld'], 'binding document');
  if (document.schema !== STATIC_COLLISION_BINDING_SCHEMA) fail('UNSUPPORTED_SCHEMA', `binding schema must be ${STATIC_COLLISION_BINDING_SCHEMA}`);
  exactKeys(document.worldFrame, ['id', 'horizontalCrs', 'horizontalUnit', 'verticalDatum', 'verticalUnit'], 'binding.worldFrame');
  exactKeys(document.physicsFrame, ['physicsFrameId', 'epoch'], 'binding.physicsFrame');
  exactKeys(document.tileAnchorWorld, ['easting', 'northing', 'height'], 'binding.tileAnchorWorld');
  exactKeys(document.physicsAnchorWorld, ['easting', 'northing', 'height'], 'binding.physicsAnchorWorld');
  nonEmpty(document.collisionId, 'collisionId');
  nonEmpty(document.tileId, 'tileId');
  nonEmpty(document.worldFrame.id, 'worldFrame.id');
  nonEmpty(document.worldFrame.horizontalCrs, 'worldFrame.horizontalCrs');
  nonEmpty(document.worldFrame.verticalDatum, 'worldFrame.verticalDatum');
  if (document.worldFrame.horizontalUnit !== 'metre' || document.worldFrame.verticalUnit !== 'metre') fail('UNSUPPORTED_UNIT', 'binding document units must be metre');
  nonEmpty(document.physicsFrame.physicsFrameId, 'physicsFrame.physicsFrameId');
  epoch(document.physicsFrame.epoch);
  sha256(document.artifactSha256);
  for (const anchor of [document.tileAnchorWorld, document.physicsAnchorWorld]) {
    finite(anchor.easting, 'anchor.easting');
    finite(anchor.northing, 'anchor.northing');
    finite(anchor.height, 'anchor.height');
  }
  return Object.freeze(structuredClone(document));
}
