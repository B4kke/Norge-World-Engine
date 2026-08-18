import {
  createSubsystemLocalFrame,
  worldToSubsystemLocal64,
  subsystemLocal64ToWorld,
  createWorldFrame,
  createWorldPosition,
} from './world_contract.mjs';

const SIMULATION_SPATIAL_SNAPSHOT_SCHEMA = 'nwe.simulation-spatial-snapshot/0.1-candidate';

export class PhysicsSpatialContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhysicsSpatialContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhysicsSpatialContractError(code, message);
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

function assertWorldFrameIdentity(worldFrame) {
  if (!worldFrame || typeof worldFrame !== 'object') fail('INVALID_WORLD_FRAME', 'worldFrame is required');
  nonEmpty(worldFrame.id, 'worldFrame.id');
  nonEmpty(worldFrame.horizontalCrs, 'worldFrame.horizontalCrs');
  nonEmpty(worldFrame.verticalDatum, 'worldFrame.verticalDatum');
  if (worldFrame.horizontalUnit !== 'metre' || worldFrame.verticalUnit !== 'metre') {
    fail('UNSUPPORTED_UNIT', 'physics adapter candidate requires metre world units');
  }
}

function velocityToArray(velocity) {
  exactKeys(velocity, ['east', 'north', 'up'], 'velocity');
  return new Float64Array([
    finite(velocity.east, 'velocity.east'),
    finite(velocity.north, 'velocity.north'),
    finite(velocity.up, 'velocity.up'),
  ]);
}

function arrayToVelocity(velocityWorldMps) {
  if (!(velocityWorldMps instanceof Float64Array) || velocityWorldMps.length !== 3) {
    fail('INVALID_VELOCITY', 'velocityWorldMps must be Float64Array(3)');
  }
  return Object.freeze({
    east: finite(velocityWorldMps[0], 'velocityWorldMps[0]'),
    north: finite(velocityWorldMps[1], 'velocityWorldMps[1]'),
    up: finite(velocityWorldMps[2], 'velocityWorldMps[2]'),
  });
}

export function createPhysicsSpatialFrame({ physicsFrameId, worldFrame, epoch = 0, anchorWorld }) {
  assertWorldFrameIdentity(worldFrame);
  const frame = createSubsystemLocalFrame({
    spaceId: nonEmpty(physicsFrameId, 'physicsFrameId'),
    purpose: 'physics',
    worldFrame,
    epoch: safeNonNegativeInteger(epoch, 'epoch'),
    anchorWorld,
  });
  return Object.freeze({
    physicsFrameId: frame.spaceId,
    worldFrameId: frame.worldFrameId,
    epoch: frame.epoch,
    anchorWorld: frame.anchorWorld,
  });
}

function asSubsystemFrame(physicsFrame) {
  return Object.freeze({
    spaceId: physicsFrame.physicsFrameId,
    purpose: 'physics',
    worldFrameId: physicsFrame.worldFrameId,
    epoch: physicsFrame.epoch,
    anchorWorld: physicsFrame.anchorWorld,
  });
}

function assertBodyFrame(body, physicsFrame) {
  if (!body || typeof body !== 'object') fail('INVALID_BODY', 'physics body is required');
  if (body.physicsFrameId !== physicsFrame.physicsFrameId) fail('PHYSICS_FRAME_MISMATCH', 'physics body belongs to another physics frame');
  if (body.physicsEpoch !== physicsFrame.epoch) fail('PHYSICS_EPOCH_MISMATCH', 'physics body belongs to another physics epoch');
  if (!(body.localPosition instanceof Float64Array) || body.localPosition.length !== 3) {
    fail('INVALID_LOCAL_POSITION', 'physics body localPosition must be Float64Array(3)');
  }
  arrayToVelocity(body.velocityWorldMps);
}

export function rebasePhysicsSpatialFrame({ worldFrame, currentFrame, newAnchorWorld }) {
  assertWorldFrameIdentity(worldFrame);
  if (currentFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'current physics frame belongs to another world frame');
  const nextEpoch = currentFrame.epoch + 1;
  safeNonNegativeInteger(nextEpoch, 'nextEpoch');
  const nextFrame = createPhysicsSpatialFrame({
    physicsFrameId: currentFrame.physicsFrameId,
    worldFrame,
    epoch: nextEpoch,
    anchorWorld: newAnchorWorld,
  });
  return Object.freeze({
    frame: nextFrame,
    deltaWorld: new Float64Array([
      nextFrame.anchorWorld.easting - currentFrame.anchorWorld.easting,
      nextFrame.anchorWorld.northing - currentFrame.anchorWorld.northing,
      nextFrame.anchorWorld.height - currentFrame.anchorWorld.height,
    ]),
  });
}

export function worldEntityToPhysicsBody({ worldFrame, entity, physicsFrame }) {
  assertWorldFrameIdentity(worldFrame);
  if (!entity || typeof entity !== 'object') fail('INVALID_ENTITY', 'entity is required');
  exactKeys(entity, ['id', 'position', 'velocity'], `entity ${entity?.id ?? '<unknown>'}`);
  nonEmpty(entity.id, 'entity.id');
  if (physicsFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'physics frame belongs to another world frame');
  const localPosition = worldToSubsystemLocal64(worldFrame, entity.position, asSubsystemFrame(physicsFrame));
  return Object.freeze({
    id: entity.id,
    physicsFrameId: physicsFrame.physicsFrameId,
    physicsEpoch: physicsFrame.epoch,
    localPosition,
    velocityWorldMps: velocityToArray(entity.velocity),
  });
}

export function physicsBodyToWorldEntity({ worldFrame, body, physicsFrame }) {
  assertWorldFrameIdentity(worldFrame);
  if (physicsFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'physics frame belongs to another world frame');
  assertBodyFrame(body, physicsFrame);
  return Object.freeze({
    id: nonEmpty(body.id, 'body.id'),
    position: subsystemLocal64ToWorld(worldFrame, body.localPosition, asSubsystemFrame(physicsFrame)),
    velocity: arrayToVelocity(body.velocityWorldMps),
  });
}

export function reframePhysicsBody({ worldFrame, body, fromFrame, toFrame }) {
  assertBodyFrame(body, fromFrame);
  if (fromFrame.worldFrameId !== toFrame.worldFrameId || fromFrame.worldFrameId !== worldFrame.id) {
    fail('WORLD_FRAME_MISMATCH', 'physics reframe requires one world frame');
  }
  if (fromFrame.physicsFrameId !== toFrame.physicsFrameId) fail('PHYSICS_FRAME_MISMATCH', 'physics reframe requires one frame series');
  const worldEntity = physicsBodyToWorldEntity({ worldFrame, body, physicsFrame: fromFrame });
  return worldEntityToPhysicsBody({ worldFrame, entity: worldEntity, physicsFrame: toFrame });
}

export function integratePhysicsBody({ body, physicsFrame, dtSeconds }) {
  assertBodyFrame(body, physicsFrame);
  const dt = finite(dtSeconds, 'dtSeconds');
  if (dt < 0) fail('INVALID_DT', 'dtSeconds must be >= 0');
  return Object.freeze({
    id: body.id,
    physicsFrameId: body.physicsFrameId,
    physicsEpoch: body.physicsEpoch,
    localPosition: new Float64Array([
      body.localPosition[0] + body.velocityWorldMps[0] * dt,
      body.localPosition[1] + body.velocityWorldMps[1] * dt,
      body.localPosition[2] + body.velocityWorldMps[2] * dt,
    ]),
    velocityWorldMps: new Float64Array(body.velocityWorldMps),
  });
}

export function serializeSimulationSpatialSnapshot({ worldFrame, tick, bodies, physicsFrame }) {
  assertWorldFrameIdentity(worldFrame);
  safeNonNegativeInteger(tick, 'tick');
  if (!Array.isArray(bodies)) fail('INVALID_BODIES', 'bodies must be an array');
  if (physicsFrame.worldFrameId !== worldFrame.id) fail('WORLD_FRAME_MISMATCH', 'physics frame belongs to another world frame');
  const entities = bodies.map((body) => physicsBodyToWorldEntity({ worldFrame, body, physicsFrame }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entity) => ({
      id: entity.id,
      position: {
        easting: entity.position.easting,
        northing: entity.position.northing,
        height: entity.position.height,
      },
      velocity: entity.velocity,
    }));
  return JSON.stringify({
    schema: SIMULATION_SPATIAL_SNAPSHOT_SCHEMA,
    worldFrame: {
      id: worldFrame.id,
      coordinateModel: worldFrame.coordinateModel,
      horizontalCrs: worldFrame.horizontalCrs,
      horizontalUnit: worldFrame.horizontalUnit,
      verticalDatum: worldFrame.verticalDatum,
      verticalUnit: worldFrame.verticalUnit,
      axisOrder: [...worldFrame.axisOrder],
    },
    tick,
    entities,
  });
}

export function deserializeSimulationSpatialSnapshot(serialized) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_SNAPSHOT_JSON', 'snapshot must be valid JSON'); }
  exactKeys(parsed, ['schema', 'worldFrame', 'tick', 'entities'], 'snapshot');
  if (parsed.schema !== SIMULATION_SPATIAL_SNAPSHOT_SCHEMA) fail('UNSUPPORTED_SNAPSHOT_SCHEMA', `snapshot schema must be ${SIMULATION_SPATIAL_SNAPSHOT_SCHEMA}`);
  safeNonNegativeInteger(parsed.tick, 'tick');
  exactKeys(parsed.worldFrame, ['id', 'coordinateModel', 'horizontalCrs', 'horizontalUnit', 'verticalDatum', 'verticalUnit', 'axisOrder'], 'snapshot.worldFrame');
  if (parsed.worldFrame.coordinateModel !== 'projected-cartesian-height') fail('UNSUPPORTED_COORDINATE_MODEL', 'snapshot coordinateModel must be projected-cartesian-height');
  if (parsed.worldFrame.horizontalUnit !== 'metre' || parsed.worldFrame.verticalUnit !== 'metre') fail('UNSUPPORTED_UNIT', 'snapshot world units must be metre');
  if (!Array.isArray(parsed.worldFrame.axisOrder) || parsed.worldFrame.axisOrder.join(',') !== 'easting,northing,height') fail('INVALID_AXIS_ORDER', 'snapshot axis order must be easting,northing,height');
  const worldFrame = createWorldFrame({
    id: parsed.worldFrame.id,
    horizontalCrs: parsed.worldFrame.horizontalCrs,
    verticalDatum: parsed.worldFrame.verticalDatum,
  });
  if (!Array.isArray(parsed.entities)) fail('INVALID_ENTITIES', 'snapshot.entities must be an array');
  const entities = parsed.entities.map((entity) => {
    exactKeys(entity, ['id', 'position', 'velocity'], `snapshot entity ${entity?.id ?? '<unknown>'}`);
    exactKeys(entity.position, ['easting', 'northing', 'height'], `snapshot entity ${entity.id} position`);
    return Object.freeze({
      id: nonEmpty(entity.id, 'entity.id'),
      position: createWorldPosition(worldFrame, {
        easting: finite(entity.position.easting, 'position.easting'),
        northing: finite(entity.position.northing, 'position.northing'),
        height: finite(entity.position.height, 'position.height'),
      }),
      velocity: arrayToVelocity(velocityToArray(entity.velocity)),
    });
  });
  return Object.freeze({ worldFrame, tick: parsed.tick, entities: Object.freeze(entities) });
}
