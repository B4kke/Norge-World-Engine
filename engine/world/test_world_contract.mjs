import assert from 'node:assert/strict';
import {
  RenderOriginHistory,
  WorldContractError,
  compensatedWorldDelta,
  createRenderOrigin,
  createSubsystemLocalFrame,
  createTileFrame,
  createWorldFrame,
  createWorldPosition,
  deserializeAuthoritativeSnapshot,
  renderLocalToWorld,
  sameEpochLocalDelta,
  serializeAuthoritativeSnapshot,
  shiftRenderOrigin,
  subsystemLocal64ToWorld,
  tileLocalToRenderLocal,
  tileLocalToWorld,
  worldToRenderLocal,
  worldToSubsystemLocal64,
  worldToTileLocal,
} from './world_contract.mjs';

const frame = createWorldFrame({
  id: 'prototype0-nannestad-epsg25832-nn2000',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

function close(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (tol ${tolerance})`);
}

function assertWorldEqual(actual, expected, tolerance = 0) {
  assert.equal(actual.worldFrameId, expected.worldFrameId);
  close(actual.easting, expected.easting, tolerance, 'easting');
  close(actual.northing, expected.northing, tolerance, 'northing');
  close(actual.height, expected.height, tolerance, 'height');
}

// 1. Large absolute coordinates stay Float64 world truth; direct high-precision subtraction happens before Float32 render storage.
{
  const origin = createRenderOrigin({
    worldFrame: frame,
    originSeriesId: 'main-view',
    epoch: 7,
    anchorWorld: createWorldPosition(frame, { easting: 600000.125, northing: 6700000.375, height: 190.25 }),
  });
  const world = createWorldPosition(frame, { easting: 600987.654321, northing: 6700456.789123, height: 201.987654 });
  const local = worldToRenderLocal(frame, world, origin);
  close(local.xyz[0], 987.529321, 0.0001, 'render local east');
  close(local.xyz[1], 456.414123, 0.0001, 'render local north');
  close(local.xyz[2], 11.737654, 0.00001, 'render local up');
  const reconstructed = renderLocalToWorld(frame, local, origin);
  assertWorldEqual(reconstructed, world, 0.0001);

  const naiveAbsoluteFloat32North = Math.fround(world.northing) - Math.fround(origin.anchorWorld.northing);
  assert.ok(Math.abs(naiveAbsoluteFloat32North - (world.northing - origin.anchorWorld.northing)) > 0.01,
    'test must expose absolute Float32 precision loss at Norway-scale northings');
}

// 2. Origin shift mid-tick cannot mutate authoritative motion/state.
{
  const dt = 1 / 60;
  const velocity = { east: 12, north: -3, up: 0.5 };
  const before = createWorldPosition(frame, { easting: 600100.25, northing: 6700100.5, height: 180.125 });
  const expectedAfter = createWorldPosition(frame, {
    easting: before.easting + velocity.east * dt,
    northing: before.northing + velocity.north * dt,
    height: before.height + velocity.up * dt,
  });
  const origin0 = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 0, anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 180 }) });
  const renderedBefore = worldToRenderLocal(frame, before, origin0);
  const { origin: origin1 } = shiftRenderOrigin(frame, origin0, createWorldPosition(frame, { easting: 603000, northing: 6697000, height: 210 }));
  const renderedAfter = worldToRenderLocal(frame, expectedAfter, origin1);
  assertWorldEqual(before, createWorldPosition(frame, { easting: 600100.25, northing: 6700100.5, height: 180.125 }));
  assertWorldEqual(expectedAfter, createWorldPosition(frame, {
    easting: 600100.25 + 12 * dt,
    northing: 6700100.5 - 3 * dt,
    height: 180.125 + 0.5 * dt,
  }));
  assert.throws(() => sameEpochLocalDelta(renderedBefore, renderedAfter), (error) => error instanceof WorldContractError && error.code === 'TEMPORAL_EPOCH_DISCONTINUITY');
  const physical = compensatedWorldDelta(frame, renderedBefore, origin0, renderedAfter, origin1);
  close(physical[0], 12 * dt, 0.0001, 'compensated east motion');
  close(physical[1], -3 * dt, 0.0001, 'compensated north motion');
  close(physical[2], 0.5 * dt, 0.0001, 'compensated vertical motion');
}

// 3. Historical local samples require their origin epoch; history can reconstruct across shifts and fails closed after retention expires.
{
  const origin0 = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 10, anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 0 }) });
  const history = new RenderOriginHistory(frame, origin0);
  const p0 = createWorldPosition(frame, { easting: 600010.2, northing: 6700002.4, height: 188.5 });
  const s0 = history.derive(p0);
  history.shift(createWorldPosition(frame, { easting: 602500, northing: 6702500, height: 100 }));
  const p1 = createWorldPosition(frame, { easting: 600010.4, northing: 6700002.35, height: 188.508333333 });
  const s1 = history.derive(p1);
  assertWorldEqual(history.reconstruct(s0), p0, 0.0001);
  assertWorldEqual(history.reconstruct(s1), p1, 0.0001);
  const delta = history.delta(s0, s1);
  close(delta[0], 0.2, 0.0001, 'history east delta');
  close(delta[1], -0.05, 0.0001, 'history north delta');
  close(delta[2], 0.008333333, 0.0001, 'history height delta');
  history.dropBefore(11);
  assert.throws(() => history.reconstruct(s0), (error) => error instanceof WorldContractError && error.code === 'UNKNOWN_ORIGIN_EPOCH');
}

// 4. Tile-boundary crossing changes tile-local coordinates/identity, not world position or world frame.
{
  const west = createTileFrame({ tileId: '32VNM-599-6700', worldFrame: frame, anchorWorld: createWorldPosition(frame, { easting: 599000, northing: 6700000, height: 0 }) });
  const east = createTileFrame({ tileId: '32VNM-600-6700', worldFrame: frame, anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 0 }) });
  const crossingWorld = createWorldPosition(frame, { easting: 600000.25, northing: 6700450.5, height: 191.75 });
  const westLocal = worldToTileLocal(frame, west, crossingWorld);
  const eastLocal = worldToTileLocal(frame, east, crossingWorld);
  close(westLocal[0], 1000.25, 1e-12, 'west tile east');
  close(eastLocal[0], 0.25, 1e-12, 'east tile east');
  assertWorldEqual(tileLocalToWorld(frame, west, { east: westLocal[0], north: westLocal[1], up: westLocal[2] }), crossingWorld);
  assertWorldEqual(tileLocalToWorld(frame, east, { east: eastLocal[0], north: eastLocal[1], up: eastLocal[2] }), crossingWorld);

  const renderOrigin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 3, anchorWorld: createWorldPosition(frame, { easting: 599500.125, northing: 6700400.125, height: 180 }) });
  const viaTile = tileLocalToRenderLocal(frame, east, { east: eastLocal[0], north: eastLocal[1], up: eastLocal[2] }, renderOrigin);
  const viaWorld = worldToRenderLocal(frame, crossingWorld, renderOrigin);
  assert.deepEqual([...viaTile.xyz], [...viaWorld.xyz]);
}

// 5. Entity can cross the render-origin anchor without an identity or world-state discontinuity.
{
  const origin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 4, anchorWorld: createWorldPosition(frame, { easting: 600500, northing: 6700500, height: 190 }) });
  const before = createWorldPosition(frame, { easting: 600499.9, northing: 6700500, height: 190 });
  const after = createWorldPosition(frame, { easting: 600500.1, northing: 6700500, height: 190 });
  const localBefore = worldToRenderLocal(frame, before, origin);
  const localAfter = worldToRenderLocal(frame, after, origin);
  assert.ok(localBefore.xyz[0] < 0 && localAfter.xyz[0] > 0);
  close(sameEpochLocalDelta(localBefore, localAfter)[0], 0.2, 0.00001, 'origin-anchor crossing delta');
}

// 6. Authoritative serialization/replay is render-origin independent and deterministic by entity id.
{
  const initialEntities = [
    { id: 'b', position: createWorldPosition(frame, { easting: 600002, northing: 6700004, height: 181 }) },
    { id: 'a', position: createWorldPosition(frame, { easting: 600001, northing: 6700003, height: 180 }) },
  ];
  const snapshot = serializeAuthoritativeSnapshot({ worldFrame: frame, tick: 42, entities: initialEntities });
  assert.ok(!snapshot.includes('renderOrigin') && !snapshot.includes('originEpoch'), 'authoritative snapshot must exclude presentation-origin state');
  const parsed = deserializeAuthoritativeSnapshot(snapshot);
  assert.equal(parsed.entities[0].id, 'a');
  assert.equal(serializeAuthoritativeSnapshot(parsed), snapshot);

  function replay(originSchedule) {
    let entities = parsed.entities.map((entity) => ({ id: entity.id, position: entity.position }));
    let origin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 0, anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 180 }) });
    for (let tick = 43; tick <= 142; tick += 1) {
      entities = entities.map((entity, index) => ({
        id: entity.id,
        position: createWorldPosition(frame, {
          easting: entity.position.easting + 0.01 * (index + 1),
          northing: entity.position.northing - 0.02 * (index + 1),
          height: entity.position.height + 0.001,
        }),
      }));
      if (originSchedule.has(tick)) {
        origin = shiftRenderOrigin(frame, origin, createWorldPosition(frame, originSchedule.get(tick))).origin;
      }
      for (const entity of entities) worldToRenderLocal(frame, entity.position, origin);
    }
    return serializeAuthoritativeSnapshot({ worldFrame: frame, tick: 142, entities });
  }

  const fixed = replay(new Map());
  const shifted = replay(new Map([
    [60, { easting: 602000, northing: 6701000, height: 200 }],
    [90, { easting: 598000, northing: 6699000, height: 150 }],
    [120, { easting: 600500, northing: 6700500, height: 190 }],
  ]));
  assert.equal(shifted, fixed, 'render-origin schedule must not affect authoritative replay serialization');
}

// 7. Physics/subsystem local frame is independent from render-origin epochs and round-trips without render-origin drift.
{
  const world = createWorldPosition(frame, { easting: 600321.123456789, northing: 6700123.987654321, height: 187.123456789 });
  const physicsFrame = createSubsystemLocalFrame({
    spaceId: 'physics-island-0',
    purpose: 'physics',
    worldFrame: frame,
    epoch: 2,
    anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 180 }),
  });
  const physicsLocalBefore = worldToSubsystemLocal64(frame, world, physicsFrame);
  let renderOrigin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 0, anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 180 }) });
  for (let index = 0; index < 1000; index += 1) {
    renderOrigin = shiftRenderOrigin(frame, renderOrigin, createWorldPosition(frame, {
      easting: 600000 + ((index % 17) - 8) * 250,
      northing: 6700000 + ((index % 19) - 9) * 250,
      height: 180 + ((index % 7) - 3) * 10,
    })).origin;
    worldToRenderLocal(frame, world, renderOrigin);
  }
  const physicsLocalAfter = worldToSubsystemLocal64(frame, world, physicsFrame);
  assert.deepEqual([...physicsLocalAfter], [...physicsLocalBefore]);
  assertWorldEqual(subsystemLocal64ToWorld(frame, physicsLocalAfter, physicsFrame), world);
}

// 8. CRS/datum/frame/epoch ambiguity fails closed.
{
  assert.throws(() => createWorldFrame({ id: 'bad', horizontalCrs: 'EPSG:25832', verticalDatum: '' }), WorldContractError);
  const otherFrame = createWorldFrame({ id: 'other', horizontalCrs: 'EPSG:25833', verticalDatum: 'NN2000' });
  const otherWorld = createWorldPosition(otherFrame, { easting: 300000, northing: 6700000, height: 180 });
  const origin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 1, anchorWorld: createWorldPosition(frame, { easting: 600000, northing: 6700000, height: 180 }) });
  assert.throws(() => worldToRenderLocal(frame, otherWorld, origin), (error) => error instanceof WorldContractError && error.code === 'WORLD_FRAME_MISMATCH');
  const sample = worldToRenderLocal(frame, createWorldPosition(frame, { easting: 600001, northing: 6700001, height: 181 }), origin);
  const staleOrigin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'main-view', epoch: 2, anchorWorld: origin.anchorWorld });
  assert.throws(() => renderLocalToWorld(frame, sample, staleOrigin), (error) => error instanceof WorldContractError && error.code === 'ORIGIN_EPOCH_MISMATCH');
  const foreignOrigin = createRenderOrigin({ worldFrame: frame, originSeriesId: 'secondary-view', epoch: 1, anchorWorld: origin.anchorWorld });
  assert.throws(() => renderLocalToWorld(frame, sample, foreignOrigin), (error) => error instanceof WorldContractError && error.code === 'ORIGIN_SERIES_MISMATCH');
}

console.log(JSON.stringify({
  status: 'PASS',
  contract: 'nwe.world-coordinate-contract/0.1-candidate',
  cases: 8,
  authoritative: 'Float64 JS Number / explicit world frame',
  renderLocal: 'Float32Array / origin epoch scoped',
  wholeNorwayPolicy: 'OPEN',
}));
