const SNAPSHOT_SCHEMA = 'nwe.authoritative-world-snapshot/0.1';
const WORLD_FRAME_MODEL = 'projected-cartesian-height';

export class WorldContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorldContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new WorldContractError(code, message);
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail('NON_FINITE', `${label} must be finite`);
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_IDENTITY', `${label} must be a non-empty string`);
  return value;
}

function safeEpoch(value, label = 'epoch') {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_EPOCH', `${label} must be a non-negative safe integer`);
  return value;
}

function cloneWorldPosition(position) {
  return Object.freeze({
    worldFrameId: position.worldFrameId,
    easting: position.easting,
    northing: position.northing,
    height: position.height,
  });
}

function assertWorldFrame(frame) {
  if (!frame || typeof frame !== 'object') fail('INVALID_WORLD_FRAME', 'world frame is required');
  nonEmpty(frame.id, 'worldFrame.id');
  if (frame.coordinateModel !== WORLD_FRAME_MODEL) {
    fail('UNSUPPORTED_COORDINATE_MODEL', `coordinate model must be ${WORLD_FRAME_MODEL}`);
  }
  nonEmpty(frame.horizontalCrs, 'worldFrame.horizontalCrs');
  nonEmpty(frame.verticalDatum, 'worldFrame.verticalDatum');
  if (frame.horizontalUnit !== 'metre' || frame.verticalUnit !== 'metre') {
    fail('UNSUPPORTED_UNIT', 'world contract v0.1 requires metre horizontal and vertical units');
  }
  if (!Array.isArray(frame.axisOrder) || frame.axisOrder.join(',') !== 'easting,northing,height') {
    fail('INVALID_AXIS_ORDER', 'axisOrder must be [easting, northing, height]');
  }
  return frame;
}

function assertSameFrame(frameId, valueFrameId, label) {
  if (frameId !== valueFrameId) fail('WORLD_FRAME_MISMATCH', `${label} belongs to ${valueFrameId}, expected ${frameId}`);
}

export function createWorldFrame({ id, horizontalCrs, verticalDatum }) {
  const frame = {
    id: nonEmpty(id, 'id'),
    coordinateModel: WORLD_FRAME_MODEL,
    horizontalCrs: nonEmpty(horizontalCrs, 'horizontalCrs'),
    horizontalUnit: 'metre',
    verticalDatum: nonEmpty(verticalDatum, 'verticalDatum'),
    verticalUnit: 'metre',
    axisOrder: Object.freeze(['easting', 'northing', 'height']),
  };
  return Object.freeze(frame);
}

export function createWorldPosition(worldFrame, { easting, northing, height }) {
  const frame = assertWorldFrame(worldFrame);
  return Object.freeze({
    worldFrameId: frame.id,
    easting: finite(easting, 'easting'),
    northing: finite(northing, 'northing'),
    height: finite(height, 'height'),
  });
}

export function createTileFrame({ tileId, worldFrame, anchorWorld }) {
  const frame = assertWorldFrame(worldFrame);
  nonEmpty(tileId, 'tileId');
  if (!anchorWorld) fail('INVALID_TILE_FRAME', 'anchorWorld is required');
  assertSameFrame(frame.id, anchorWorld.worldFrameId, 'tile anchor');
  finite(anchorWorld.easting, 'tile anchor easting');
  finite(anchorWorld.northing, 'tile anchor northing');
  finite(anchorWorld.height, 'tile anchor height');
  return Object.freeze({
    tileId,
    worldFrameId: frame.id,
    anchorWorld: cloneWorldPosition(anchorWorld),
  });
}

export function tileLocalToWorld(worldFrame, tileFrame, { east, north, up }) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, tileFrame.worldFrameId, 'tile frame');
  return createWorldPosition(frame, {
    easting: tileFrame.anchorWorld.easting + finite(east, 'tile east'),
    northing: tileFrame.anchorWorld.northing + finite(north, 'tile north'),
    height: tileFrame.anchorWorld.height + finite(up, 'tile up'),
  });
}

export function worldToTileLocal(worldFrame, tileFrame, worldPosition) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, tileFrame.worldFrameId, 'tile frame');
  assertSameFrame(frame.id, worldPosition.worldFrameId, 'world position');
  return new Float64Array([
    worldPosition.easting - tileFrame.anchorWorld.easting,
    worldPosition.northing - tileFrame.anchorWorld.northing,
    worldPosition.height - tileFrame.anchorWorld.height,
  ]);
}

export function createRenderOrigin({ worldFrame, originSeriesId, epoch = 0, anchorWorld }) {
  const frame = assertWorldFrame(worldFrame);
  nonEmpty(originSeriesId, 'originSeriesId');
  safeEpoch(epoch);
  if (!anchorWorld) fail('INVALID_RENDER_ORIGIN', 'anchorWorld is required');
  assertSameFrame(frame.id, anchorWorld.worldFrameId, 'render origin anchor');
  return Object.freeze({
    worldFrameId: frame.id,
    originSeriesId,
    epoch,
    anchorWorld: cloneWorldPosition(anchorWorld),
  });
}

export function shiftRenderOrigin(worldFrame, currentOrigin, newAnchorWorld) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, currentOrigin.worldFrameId, 'current render origin');
  assertSameFrame(frame.id, newAnchorWorld.worldFrameId, 'new render origin anchor');
  const nextEpoch = currentOrigin.epoch + 1;
  safeEpoch(nextEpoch, 'next epoch');
  const next = createRenderOrigin({ worldFrame: frame, originSeriesId: currentOrigin.originSeriesId, epoch: nextEpoch, anchorWorld: newAnchorWorld });
  const deltaWorld = new Float64Array([
    next.anchorWorld.easting - currentOrigin.anchorWorld.easting,
    next.anchorWorld.northing - currentOrigin.anchorWorld.northing,
    next.anchorWorld.height - currentOrigin.anchorWorld.height,
  ]);
  return Object.freeze({ origin: next, deltaWorld });
}

export function worldToRenderLocal(worldFrame, worldPosition, renderOrigin) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, worldPosition.worldFrameId, 'world position');
  assertSameFrame(frame.id, renderOrigin.worldFrameId, 'render origin');
  safeEpoch(renderOrigin.epoch);
  return Object.freeze({
    worldFrameId: frame.id,
    originSeriesId: renderOrigin.originSeriesId,
    originEpoch: renderOrigin.epoch,
    xyz: new Float32Array([
      worldPosition.easting - renderOrigin.anchorWorld.easting,
      worldPosition.northing - renderOrigin.anchorWorld.northing,
      worldPosition.height - renderOrigin.anchorWorld.height,
    ]),
  });
}

export function tileLocalToRenderLocal(worldFrame, tileFrame, tileLocal, renderOrigin) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, tileFrame.worldFrameId, 'tile frame');
  assertSameFrame(frame.id, renderOrigin.worldFrameId, 'render origin');
  const east = finite(tileLocal.east, 'tile east');
  const north = finite(tileLocal.north, 'tile north');
  const up = finite(tileLocal.up, 'tile up');
  return Object.freeze({
    worldFrameId: frame.id,
    originSeriesId: renderOrigin.originSeriesId,
    originEpoch: renderOrigin.epoch,
    xyz: new Float32Array([
      (tileFrame.anchorWorld.easting - renderOrigin.anchorWorld.easting) + east,
      (tileFrame.anchorWorld.northing - renderOrigin.anchorWorld.northing) + north,
      (tileFrame.anchorWorld.height - renderOrigin.anchorWorld.height) + up,
    ]),
  });
}

export function renderLocalToWorld(worldFrame, renderSample, renderOrigin) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, renderSample.worldFrameId, 'render sample');
  assertSameFrame(frame.id, renderOrigin.worldFrameId, 'render origin');
  if (renderSample.originSeriesId !== renderOrigin.originSeriesId) {
    fail('ORIGIN_SERIES_MISMATCH', `render sample series ${renderSample.originSeriesId} does not match origin series ${renderOrigin.originSeriesId}`);
  }
  if (renderSample.originEpoch !== renderOrigin.epoch) {
    fail('ORIGIN_EPOCH_MISMATCH', `render sample epoch ${renderSample.originEpoch} does not match origin epoch ${renderOrigin.epoch}`);
  }
  if (!(renderSample.xyz instanceof Float32Array) || renderSample.xyz.length !== 3) {
    fail('INVALID_RENDER_SAMPLE', 'render sample xyz must be Float32Array(3)');
  }
  return createWorldPosition(frame, {
    easting: renderOrigin.anchorWorld.easting + renderSample.xyz[0],
    northing: renderOrigin.anchorWorld.northing + renderSample.xyz[1],
    height: renderOrigin.anchorWorld.height + renderSample.xyz[2],
  });
}

export function sameEpochLocalDelta(previousSample, currentSample) {
  if (previousSample.worldFrameId !== currentSample.worldFrameId) {
    fail('WORLD_FRAME_MISMATCH', 'render samples use different world frames');
  }
  if (previousSample.originSeriesId !== currentSample.originSeriesId) {
    fail('ORIGIN_SERIES_MISMATCH', 'render samples use different origin series');
  }
  if (previousSample.originEpoch !== currentSample.originEpoch) {
    fail('TEMPORAL_EPOCH_DISCONTINUITY', 'raw local delta is invalid across an origin epoch boundary');
  }
  return new Float64Array([
    currentSample.xyz[0] - previousSample.xyz[0],
    currentSample.xyz[1] - previousSample.xyz[1],
    currentSample.xyz[2] - previousSample.xyz[2],
  ]);
}

export function compensatedWorldDelta(worldFrame, previousSample, previousOrigin, currentSample, currentOrigin) {
  const previousWorld = renderLocalToWorld(worldFrame, previousSample, previousOrigin);
  const currentWorld = renderLocalToWorld(worldFrame, currentSample, currentOrigin);
  return new Float64Array([
    currentWorld.easting - previousWorld.easting,
    currentWorld.northing - previousWorld.northing,
    currentWorld.height - previousWorld.height,
  ]);
}

export class RenderOriginHistory {
  #worldFrame;
  #origins = new Map();
  #current;

  constructor(worldFrame, initialOrigin) {
    this.#worldFrame = assertWorldFrame(worldFrame);
    assertSameFrame(this.#worldFrame.id, initialOrigin.worldFrameId, 'initial render origin');
    nonEmpty(initialOrigin.originSeriesId, 'initial render origin series');
    safeEpoch(initialOrigin.epoch);
    this.#current = initialOrigin;
    this.#origins.set(initialOrigin.epoch, initialOrigin);
  }

  get current() {
    return this.#current;
  }

  shift(newAnchorWorld) {
    const shifted = shiftRenderOrigin(this.#worldFrame, this.#current, newAnchorWorld);
    this.#current = shifted.origin;
    this.#origins.set(this.#current.epoch, this.#current);
    return shifted;
  }

  derive(worldPosition) {
    return worldToRenderLocal(this.#worldFrame, worldPosition, this.#current);
  }

  reconstruct(renderSample) {
    if (renderSample.originSeriesId !== this.#current.originSeriesId) fail('ORIGIN_SERIES_MISMATCH', 'render sample belongs to another origin series');
    const origin = this.#origins.get(renderSample.originEpoch);
    if (!origin) fail('UNKNOWN_ORIGIN_EPOCH', `origin epoch ${renderSample.originEpoch} is not retained`);
    return renderLocalToWorld(this.#worldFrame, renderSample, origin);
  }

  delta(previousSample, currentSample) {
    if (previousSample.originSeriesId !== this.#current.originSeriesId || currentSample.originSeriesId !== this.#current.originSeriesId) {
      fail('ORIGIN_SERIES_MISMATCH', 'render samples belong to another origin series');
    }
    const previousOrigin = this.#origins.get(previousSample.originEpoch);
    const currentOrigin = this.#origins.get(currentSample.originEpoch);
    if (!previousOrigin || !currentOrigin) fail('UNKNOWN_ORIGIN_EPOCH', 'both render-sample epochs must be retained');
    return compensatedWorldDelta(this.#worldFrame, previousSample, previousOrigin, currentSample, currentOrigin);
  }

  dropBefore(minEpoch) {
    safeEpoch(minEpoch, 'minEpoch');
    for (const epoch of this.#origins.keys()) {
      if (epoch < minEpoch && epoch !== this.#current.epoch) this.#origins.delete(epoch);
    }
  }
}

export function createSubsystemLocalFrame({ spaceId, purpose, worldFrame, epoch = 0, anchorWorld }) {
  const frame = assertWorldFrame(worldFrame);
  nonEmpty(spaceId, 'spaceId');
  nonEmpty(purpose, 'purpose');
  safeEpoch(epoch);
  assertSameFrame(frame.id, anchorWorld.worldFrameId, 'subsystem anchor');
  return Object.freeze({
    spaceId,
    purpose,
    worldFrameId: frame.id,
    epoch,
    anchorWorld: cloneWorldPosition(anchorWorld),
  });
}

export function worldToSubsystemLocal64(worldFrame, worldPosition, localFrame) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, worldPosition.worldFrameId, 'world position');
  assertSameFrame(frame.id, localFrame.worldFrameId, 'subsystem local frame');
  return new Float64Array([
    worldPosition.easting - localFrame.anchorWorld.easting,
    worldPosition.northing - localFrame.anchorWorld.northing,
    worldPosition.height - localFrame.anchorWorld.height,
  ]);
}

export function subsystemLocal64ToWorld(worldFrame, localPosition, localFrame) {
  const frame = assertWorldFrame(worldFrame);
  assertSameFrame(frame.id, localFrame.worldFrameId, 'subsystem local frame');
  if (!(localPosition instanceof Float64Array) || localPosition.length !== 3) {
    fail('INVALID_SUBSYSTEM_LOCAL', 'subsystem local position must be Float64Array(3)');
  }
  return createWorldPosition(frame, {
    easting: localFrame.anchorWorld.easting + localPosition[0],
    northing: localFrame.anchorWorld.northing + localPosition[1],
    height: localFrame.anchorWorld.height + localPosition[2],
  });
}

export function serializeAuthoritativeSnapshot({ worldFrame, tick, entities }) {
  const frame = assertWorldFrame(worldFrame);
  if (!Number.isSafeInteger(tick) || tick < 0) fail('INVALID_TICK', 'tick must be a non-negative safe integer');
  if (!Array.isArray(entities)) fail('INVALID_ENTITIES', 'entities must be an array');
  const normalizedEntities = [...entities].map((entity) => {
    nonEmpty(entity.id, 'entity.id');
    assertSameFrame(frame.id, entity.position.worldFrameId, `entity ${entity.id} position`);
    return {
      id: entity.id,
      position: {
        easting: finite(entity.position.easting, `entity ${entity.id} easting`),
        northing: finite(entity.position.northing, `entity ${entity.id} northing`),
        height: finite(entity.position.height, `entity ${entity.id} height`),
      },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({
    schema: SNAPSHOT_SCHEMA,
    worldFrame: {
      id: frame.id,
      coordinateModel: frame.coordinateModel,
      horizontalCrs: frame.horizontalCrs,
      horizontalUnit: frame.horizontalUnit,
      verticalDatum: frame.verticalDatum,
      verticalUnit: frame.verticalUnit,
      axisOrder: [...frame.axisOrder],
    },
    tick,
    entities: normalizedEntities,
  });
}

export function deserializeAuthoritativeSnapshot(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_SNAPSHOT_JSON', 'snapshot must be valid JSON');
  }
  if (parsed?.schema !== SNAPSHOT_SCHEMA) fail('UNSUPPORTED_SNAPSHOT_SCHEMA', `snapshot schema must be ${SNAPSHOT_SCHEMA}`);
  const frame = createWorldFrame({
    id: parsed.worldFrame?.id,
    horizontalCrs: parsed.worldFrame?.horizontalCrs,
    verticalDatum: parsed.worldFrame?.verticalDatum,
  });
  if (parsed.worldFrame?.coordinateModel !== WORLD_FRAME_MODEL || parsed.worldFrame?.horizontalUnit !== 'metre' || parsed.worldFrame?.verticalUnit !== 'metre') {
    fail('INVALID_WORLD_FRAME', 'serialized world frame semantics do not match contract v0.1');
  }
  if (!Array.isArray(parsed.entities)) fail('INVALID_ENTITIES', 'serialized entities must be an array');
  if (!Number.isSafeInteger(parsed.tick) || parsed.tick < 0) fail('INVALID_TICK', 'serialized tick is invalid');
  return Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    worldFrame: frame,
    tick: parsed.tick,
    entities: Object.freeze(parsed.entities.map((entity) => Object.freeze({
      id: nonEmpty(entity.id, 'entity.id'),
      position: createWorldPosition(frame, entity.position),
    }))),
  });
}

export const WORLD_CONTRACT_V0_1 = Object.freeze({
  snapshotSchema: SNAPSHOT_SCHEMA,
  coordinateModel: WORLD_FRAME_MODEL,
});
