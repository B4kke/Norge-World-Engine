const NETWORK_SNAPSHOT_SCHEMA = 'nwe.network-world-snapshot/0.1';
const MAX_Q = 2147483647;

export class NetworkSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NetworkSnapshotError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NetworkSnapshotError(code, message);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be non-empty`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail('NON_FINITE', `${label} must be finite`);
  return value;
}

function safeInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INTEGER', `${label} must be a non-negative safe integer`);
  return value;
}

function assertWorldFrame(frame) {
  if (!frame || typeof frame !== 'object') fail('INVALID_WORLD_FRAME', 'world frame required');
  nonEmpty(frame.id, 'worldFrame.id');
  nonEmpty(frame.horizontalCrs, 'worldFrame.horizontalCrs');
  nonEmpty(frame.verticalDatum, 'worldFrame.verticalDatum');
  if (frame.horizontalUnit !== 'metre' || frame.verticalUnit !== 'metre') {
    fail('UNSUPPORTED_UNIT', 'network snapshot v0.1 requires metre world units');
  }
  return frame;
}

function assertWorldPosition(frame, position, label) {
  if (!position || typeof position !== 'object') fail('INVALID_WORLD_POSITION', `${label} required`);
  if (position.worldFrameId !== frame.id) {
    fail('WORLD_FRAME_MISMATCH', `${label} belongs to ${position.worldFrameId}, expected ${frame.id}`);
  }
  finite(position.easting, `${label}.easting`);
  finite(position.northing, `${label}.northing`);
  finite(position.height, `${label}.height`);
}

function quantize(deltaMetres, resolutionMm, label) {
  const q = Math.round((deltaMetres * 1000) / resolutionMm);
  if (!Number.isSafeInteger(q) || Math.abs(q) > MAX_Q) {
    fail('QUANTIZATION_RANGE_EXCEEDED', `${label} exceeds signed 32-bit quantized range`);
  }
  return q;
}

function assertQ(value, label) {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_Q) {
    fail('INVALID_QUANTIZED_POSITION', `${label} must be signed 32-bit integer`);
  }
}

export function createNetworkWorldFrame({ id, worldFrame, anchorWorld, resolutionMm = 1 }) {
  const frame = assertWorldFrame(worldFrame);
  nonEmpty(id, 'networkFrame.id');
  if (!Number.isSafeInteger(resolutionMm) || resolutionMm <= 0) {
    fail('INVALID_RESOLUTION', 'resolutionMm must be a positive integer');
  }
  assertWorldPosition(frame, anchorWorld, 'anchorWorld');
  return Object.freeze({
    id,
    worldFrameId: frame.id,
    horizontalCrs: frame.horizontalCrs,
    verticalDatum: frame.verticalDatum,
    resolutionMm,
    anchorWorld: Object.freeze({
      worldFrameId: frame.id,
      easting: anchorWorld.easting,
      northing: anchorWorld.northing,
      height: anchorWorld.height,
    }),
  });
}

export function serializeNetworkWorldSnapshot({ worldFrame, networkFrame, tick, sequence, entities }) {
  const frame = assertWorldFrame(worldFrame);
  safeInt(tick, 'tick');
  safeInt(sequence, 'sequence');
  if (networkFrame?.worldFrameId !== frame.id) {
    fail('WORLD_FRAME_MISMATCH', 'network frame belongs to another world frame');
  }
  if (networkFrame.horizontalCrs !== frame.horizontalCrs || networkFrame.verticalDatum !== frame.verticalDatum) {
    fail('FRAME_METADATA_MISMATCH', 'network frame CRS/datum does not match world frame');
  }
  if (!Array.isArray(entities)) fail('INVALID_ENTITIES', 'entities must be an array');

  const normalized = entities.map((entity) => {
    nonEmpty(entity.id, 'entity.id');
    assertWorldPosition(frame, entity.position, `entity ${entity.id} position`);
    return {
      id: entity.id,
      q: [
        quantize(entity.position.easting - networkFrame.anchorWorld.easting, networkFrame.resolutionMm, `${entity.id}.east`),
        quantize(entity.position.northing - networkFrame.anchorWorld.northing, networkFrame.resolutionMm, `${entity.id}.north`),
        quantize(entity.position.height - networkFrame.anchorWorld.height, networkFrame.resolutionMm, `${entity.id}.up`),
      ],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({
    schema: NETWORK_SNAPSHOT_SCHEMA,
    worldFrame: {
      id: frame.id,
      horizontalCrs: frame.horizontalCrs,
      horizontalUnit: frame.horizontalUnit,
      verticalDatum: frame.verticalDatum,
      verticalUnit: frame.verticalUnit,
    },
    networkFrame: {
      id: networkFrame.id,
      anchorWorld: {
        easting: networkFrame.anchorWorld.easting,
        northing: networkFrame.anchorWorld.northing,
        height: networkFrame.anchorWorld.height,
      },
      resolutionMm: networkFrame.resolutionMm,
    },
    tick,
    sequence,
    entities: normalized,
  });
}

export function deserializeNetworkWorldSnapshot(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_JSON', 'snapshot must be valid JSON');
  }
  if (parsed?.schema !== NETWORK_SNAPSHOT_SCHEMA) {
    fail('UNSUPPORTED_SCHEMA', `snapshot schema must be ${NETWORK_SNAPSHOT_SCHEMA}`);
  }

  const frame = assertWorldFrame(parsed.worldFrame);
  nonEmpty(parsed.networkFrame?.id, 'networkFrame.id');
  safeInt(parsed.tick, 'tick');
  safeInt(parsed.sequence, 'sequence');
  if (!Number.isSafeInteger(parsed.networkFrame.resolutionMm) || parsed.networkFrame.resolutionMm <= 0) {
    fail('INVALID_RESOLUTION', 'resolutionMm must be positive integer');
  }

  const anchor = parsed.networkFrame.anchorWorld;
  finite(anchor?.easting, 'anchor.easting');
  finite(anchor?.northing, 'anchor.northing');
  finite(anchor?.height, 'anchor.height');
  if (!Array.isArray(parsed.entities)) fail('INVALID_ENTITIES', 'entities must be array');

  const ids = new Set();
  const entities = parsed.entities.map((entity) => {
    nonEmpty(entity.id, 'entity.id');
    if (ids.has(entity.id)) fail('DUPLICATE_ENTITY', `duplicate entity ${entity.id}`);
    ids.add(entity.id);
    if (!Array.isArray(entity.q) || entity.q.length !== 3) {
      fail('INVALID_QUANTIZED_POSITION', `${entity.id}.q must have three integers`);
    }
    entity.q.forEach((value, index) => assertQ(value, `${entity.id}.q[${index}]`));
    const scale = parsed.networkFrame.resolutionMm / 1000;
    return Object.freeze({
      id: entity.id,
      position: Object.freeze({
        worldFrameId: frame.id,
        easting: anchor.easting + entity.q[0] * scale,
        northing: anchor.northing + entity.q[1] * scale,
        height: anchor.height + entity.q[2] * scale,
      }),
    });
  });

  return Object.freeze({
    worldFrame: Object.freeze(frame),
    networkFrame: Object.freeze({
      id: parsed.networkFrame.id,
      worldFrameId: frame.id,
      horizontalCrs: frame.horizontalCrs,
      verticalDatum: frame.verticalDatum,
      resolutionMm: parsed.networkFrame.resolutionMm,
      anchorWorld: Object.freeze({
        worldFrameId: frame.id,
        easting: anchor.easting,
        northing: anchor.northing,
        height: anchor.height,
      }),
    }),
    tick: parsed.tick,
    sequence: parsed.sequence,
    entities: Object.freeze(entities),
  });
}
