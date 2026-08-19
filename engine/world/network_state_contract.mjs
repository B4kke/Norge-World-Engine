const NETWORK_SNAPSHOT_SCHEMA = 'nwe.network-spatial-snapshot/0.1-candidate';

export class NetworkSpatialContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NetworkSpatialContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NetworkSpatialContractError(code, message);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) fail('INVALID_QUANTUM', `${label} must be finite and > 0`);
  return value;
}

function safeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INTEGER', `${label} must be a non-negative safe integer`);
  return value;
}

function finiteWorldPosition(position, expectedFrameId, label) {
  if (!position || position.worldFrameId !== expectedFrameId) fail('WORLD_FRAME_MISMATCH', `${label} must belong to ${expectedFrameId}`);
  for (const axis of ['easting', 'northing', 'height']) {
    if (!Number.isFinite(position[axis])) fail('NON_FINITE', `${label}.${axis} must be finite`);
  }
  return position;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}

export function createNetworkSpatialFrame({ networkFrameId, worldFrame, epoch = 0, anchorWorld, positionQuantumMeters }) {
  if (!worldFrame || typeof worldFrame !== 'object') fail('INVALID_WORLD_FRAME', 'worldFrame is required');
  nonEmpty(worldFrame.id, 'worldFrame.id');
  nonEmpty(worldFrame.horizontalCrs, 'worldFrame.horizontalCrs');
  nonEmpty(worldFrame.verticalDatum, 'worldFrame.verticalDatum');
  if (worldFrame.horizontalUnit !== 'metre' || worldFrame.verticalUnit !== 'metre') fail('UNSUPPORTED_UNIT', 'network candidate requires metre world units');
  finiteWorldPosition(anchorWorld, worldFrame.id, 'anchorWorld');
  return Object.freeze({
    networkFrameId: nonEmpty(networkFrameId, 'networkFrameId'),
    worldFrameId: worldFrame.id,
    epoch: safeNonNegativeInteger(epoch, 'epoch'),
    anchorWorld: Object.freeze({
      worldFrameId: anchorWorld.worldFrameId,
      easting: anchorWorld.easting,
      northing: anchorWorld.northing,
      height: anchorWorld.height,
    }),
    positionQuantumMeters: finitePositive(positionQuantumMeters, 'positionQuantumMeters'),
  });
}

function assertSampleFrame(sample, networkFrame) {
  exactKeys(sample, ['networkFrameId', 'networkEpoch', 'q'], 'network sample');
  if (sample.networkFrameId !== networkFrame.networkFrameId) fail('NETWORK_FRAME_MISMATCH', 'network sample belongs to another network frame');
  if (sample.networkEpoch !== networkFrame.epoch) fail('NETWORK_EPOCH_MISMATCH', 'network sample belongs to another network epoch');
  if (!Array.isArray(sample.q) || sample.q.length !== 3 || !sample.q.every(Number.isSafeInteger)) {
    fail('INVALID_QUANTIZED_POSITION', 'network sample q must be three safe integers');
  }
}

export function encodeNetworkPosition(worldPosition, networkFrame) {
  finiteWorldPosition(worldPosition, networkFrame.worldFrameId, 'worldPosition');
  const quantum = networkFrame.positionQuantumMeters;
  const values = [
    (worldPosition.easting - networkFrame.anchorWorld.easting) / quantum,
    (worldPosition.northing - networkFrame.anchorWorld.northing) / quantum,
    (worldPosition.height - networkFrame.anchorWorld.height) / quantum,
  ].map((value) => {
    const quantized = Math.round(value);
    if (!Number.isSafeInteger(quantized)) fail('QUANTIZED_RANGE_EXCEEDED', 'quantized coordinate exceeds JavaScript safe-integer range');
    return quantized;
  });
  return Object.freeze({ networkFrameId: networkFrame.networkFrameId, networkEpoch: networkFrame.epoch, q: Object.freeze(values) });
}

export function decodeNetworkPosition(sample, networkFrame) {
  assertSampleFrame(sample, networkFrame);
  const quantum = networkFrame.positionQuantumMeters;
  return Object.freeze({
    worldFrameId: networkFrame.worldFrameId,
    easting: networkFrame.anchorWorld.easting + sample.q[0] * quantum,
    northing: networkFrame.anchorWorld.northing + sample.q[1] * quantum,
    height: networkFrame.anchorWorld.height + sample.q[2] * quantum,
  });
}

export function serializeNetworkSpatialSnapshot({ worldFrame, tick, sequence, networkFrame, entities }) {
  if (!worldFrame || worldFrame.id !== networkFrame.worldFrameId) fail('WORLD_FRAME_MISMATCH', 'worldFrame and networkFrame must match');
  safeNonNegativeInteger(tick, 'tick');
  safeNonNegativeInteger(sequence, 'sequence');
  if (!Array.isArray(entities)) fail('INVALID_ENTITIES', 'entities must be an array');
  const normalizedEntities = entities.map((entity) => {
    exactKeys(entity, ['id', 'position'], `entity ${entity?.id ?? '<unknown>'}`);
    nonEmpty(entity.id, 'entity.id');
    return { id: entity.id, position: encodeNetworkPosition(entity.position, networkFrame) };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({
    schema: NETWORK_SNAPSHOT_SCHEMA,
    worldFrame: {
      id: worldFrame.id,
      horizontalCrs: worldFrame.horizontalCrs,
      horizontalUnit: worldFrame.horizontalUnit,
      verticalDatum: worldFrame.verticalDatum,
      verticalUnit: worldFrame.verticalUnit,
    },
    tick,
    sequence,
    networkFrame: {
      networkFrameId: networkFrame.networkFrameId,
      epoch: networkFrame.epoch,
      anchorWorld: {
        easting: networkFrame.anchorWorld.easting,
        northing: networkFrame.anchorWorld.northing,
        height: networkFrame.anchorWorld.height,
      },
      positionQuantumMeters: networkFrame.positionQuantumMeters,
    },
    entities: normalizedEntities,
  });
}

export function deserializeNetworkSpatialSnapshot(serialized) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_SNAPSHOT_JSON', 'snapshot must be valid JSON'); }
  exactKeys(parsed, ['schema', 'worldFrame', 'tick', 'sequence', 'networkFrame', 'entities'], 'snapshot');
  if (parsed.schema !== NETWORK_SNAPSHOT_SCHEMA) fail('UNSUPPORTED_SNAPSHOT_SCHEMA', `snapshot schema must be ${NETWORK_SNAPSHOT_SCHEMA}`);
  exactKeys(parsed.worldFrame, ['id', 'horizontalCrs', 'horizontalUnit', 'verticalDatum', 'verticalUnit'], 'worldFrame');
  exactKeys(parsed.networkFrame, ['networkFrameId', 'epoch', 'anchorWorld', 'positionQuantumMeters'], 'networkFrame');
  exactKeys(parsed.networkFrame.anchorWorld, ['easting', 'northing', 'height'], 'networkFrame.anchorWorld');
  safeNonNegativeInteger(parsed.tick, 'tick');
  safeNonNegativeInteger(parsed.sequence, 'sequence');
  if (!Array.isArray(parsed.entities)) fail('INVALID_ENTITIES', 'entities must be an array');
  for (const entity of parsed.entities) {
    exactKeys(entity, ['id', 'position'], 'entity');
    nonEmpty(entity.id, 'entity.id');
    exactKeys(entity.position, ['networkFrameId', 'networkEpoch', 'q'], `entity ${entity.id}.position`);
  }
  return Object.freeze(parsed);
}

export function networkSnapshotToWorldEntities(snapshot) {
  const worldFrame = {
    id: snapshot.worldFrame.id,
    horizontalCrs: snapshot.worldFrame.horizontalCrs,
    horizontalUnit: snapshot.worldFrame.horizontalUnit,
    verticalDatum: snapshot.worldFrame.verticalDatum,
    verticalUnit: snapshot.worldFrame.verticalUnit,
  };
  const networkFrame = createNetworkSpatialFrame({
    networkFrameId: snapshot.networkFrame.networkFrameId,
    worldFrame,
    epoch: snapshot.networkFrame.epoch,
    anchorWorld: { worldFrameId: worldFrame.id, ...snapshot.networkFrame.anchorWorld },
    positionQuantumMeters: snapshot.networkFrame.positionQuantumMeters,
  });
  return snapshot.entities.map((entity) => Object.freeze({ id: entity.id, position: decodeNetworkPosition(entity.position, networkFrame) }));
}

export { NETWORK_SNAPSHOT_SCHEMA };
