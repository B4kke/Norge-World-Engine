import assert from 'node:assert/strict';
import {
  CharacterTransformError,
  characterTransformContract,
  createCharacterWorldTransform,
  deriveCharacterRenderTransform,
  moveCharacterPlanar,
  setCharacterHeading,
  setCharacterWorldHeight,
} from './character_transform_contract.mjs';
import {
  createRenderOrigin,
  createWorldFrame,
  createWorldPosition,
  renderLocalToWorld,
  shiftRenderOrigin,
} from './world_contract.mjs';

const frame = createWorldFrame({
  id: 'prototype0-nannestad-epsg25832-nn2000',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

function close(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (tol ${tolerance})`);
}

function assertWorldPosition(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.worldFrameId, expected.worldFrameId);
  close(actual.easting, expected.easting, tolerance, 'easting');
  close(actual.northing, expected.northing, tolerance, 'northing');
  close(actual.height, expected.height, tolerance, 'height');
}

const spawn = createWorldPosition(frame, {
  easting: 611500.25,
  northing: 6677500.5,
  height: 205.125,
});

// 1. Character identity and authoritative transform stay renderer-neutral.
{
  const transform = createCharacterWorldTransform({
    entityId: 'player-1',
    worldFrame: frame,
    position: spawn,
    headingRadians: -Math.PI / 2,
  });
  assert.equal(transform.schema, 'nwe.character-world-transform/0.1-candidate');
  assert.equal(transform.entityId, 'player-1');
  assert.equal(transform.worldFrameId, frame.id);
  assertWorldPosition(transform.position, spawn);
  close(transform.headingRadians, Math.PI * 1.5, 1e-12, 'normalized heading');
  assert.ok(!('originEpoch' in transform));
  assert.ok(!('originSeriesId' in transform));
  assert.ok(!('renderOrigin' in transform));
  assert.equal(characterTransformContract.headingConvention, 'clockwise-radians-from-projected-grid-north');
  assert.equal(characterTransformContract.headingRange, '[0, 2π)');

  const negativeZero = createCharacterWorldTransform({
    entityId: 'player-2',
    worldFrame: frame,
    position: spawn,
    headingRadians: -0,
  });
  assert.equal(negativeZero.headingRadians, 0);
  assert.equal(Object.is(negativeZero.headingRadians, -0), false, 'authoritative heading must have one canonical zero');
}

// 2. Planar locomotion uses projected-grid bearing semantics without renderer axes.
{
  let transform = createCharacterWorldTransform({
    entityId: 'player-1',
    worldFrame: frame,
    position: spawn,
    headingRadians: 0,
  });
  transform = moveCharacterPlanar(frame, transform, { forwardMeters: 3, rightMeters: 2 });
  close(transform.position.easting, spawn.easting + 2, 1e-12, 'north-heading right/east');
  close(transform.position.northing, spawn.northing + 3, 1e-12, 'north-heading forward/north');

  transform = setCharacterHeading(frame, transform, Math.PI / 2);
  const eastFacing = moveCharacterPlanar(frame, transform, { forwardMeters: 4, rightMeters: 1 });
  close(eastFacing.position.easting, transform.position.easting + 4, 1e-12, 'east-heading forward/east');
  close(eastFacing.position.northing, transform.position.northing - 1, 1e-12, 'east-heading right/south');
  close(eastFacing.position.height, spawn.height, 1e-12, 'planar move preserves height');
}

// 3. Terrain/grounding code may supply a world height without owning horizontal movement or renderer state.
{
  const transform = createCharacterWorldTransform({
    entityId: 'player-1',
    worldFrame: frame,
    position: spawn,
    headingRadians: 0.25,
  });
  const grounded = setCharacterWorldHeight(frame, transform, 207.75);
  close(grounded.position.easting, transform.position.easting, 0, 'grounding preserves easting');
  close(grounded.position.northing, transform.position.northing, 0, 'grounding preserves northing');
  close(grounded.position.height, 207.75, 0, 'grounding updates authoritative world height');
  close(grounded.headingRadians, transform.headingRadians, 0, 'grounding preserves heading');
}

// 4. Render-local character state is derived and epoch-scoped, never authoritative.
{
  const transform = createCharacterWorldTransform({
    entityId: 'player-1',
    worldFrame: frame,
    position: spawn,
    headingRadians: Math.PI / 3,
  });
  const origin = createRenderOrigin({
    worldFrame: frame,
    originSeriesId: 'ground-view',
    epoch: 4,
    anchorWorld: createWorldPosition(frame, { easting: 611000, northing: 6677000, height: 200 }),
  });
  const rendered = deriveCharacterRenderTransform(frame, transform, origin);
  assert.equal(rendered.entityId, transform.entityId);
  assert.equal(rendered.originSeriesId, 'ground-view');
  assert.equal(rendered.originEpoch, 4);
  assert.ok(rendered.position instanceof Float32Array);
  close(rendered.position[0], 500.25, 0.00001, 'render-local east');
  close(rendered.position[1], 500.5, 0.00001, 'render-local north');
  close(rendered.position[2], 5.125, 0.00001, 'render-local up');
  close(rendered.headingRadians, transform.headingRadians, 0, 'render heading remains world heading');

  const reconstructed = renderLocalToWorld(frame, {
    worldFrameId: rendered.worldFrameId,
    originSeriesId: rendered.originSeriesId,
    originEpoch: rendered.originEpoch,
    xyz: rendered.position,
  }, origin);
  assertWorldPosition(reconstructed, transform.position, 0.0001);
}

// 5. Exit gate: render-origin shifts may change local coordinates but cannot change authoritative character replay.
{
  function run(originShiftStep = null) {
    let transform = createCharacterWorldTransform({
      entityId: 'player-1',
      worldFrame: frame,
      position: spawn,
      headingRadians: 0,
    });
    let origin = createRenderOrigin({
      worldFrame: frame,
      originSeriesId: 'ground-view',
      epoch: 0,
      anchorWorld: createWorldPosition(frame, { easting: 611000, northing: 6677000, height: 200 }),
    });

    const commands = [
      { forwardMeters: 1.25, rightMeters: 0 },
      { forwardMeters: 0.75, rightMeters: 0.2 },
      { turn: Math.PI / 2 },
      { forwardMeters: 2.5, rightMeters: -0.4 },
      { groundHeight: 206.875 },
      { forwardMeters: 0.5, rightMeters: 0.1 },
    ];

    for (let step = 0; step < commands.length; step += 1) {
      if (step === originShiftStep) {
        origin = shiftRenderOrigin(frame, origin, createWorldPosition(frame, {
          easting: 612250,
          northing: 6678250,
          height: 225,
        })).origin;
      }
      const command = commands[step];
      if ('turn' in command) transform = setCharacterHeading(frame, transform, command.turn);
      if ('forwardMeters' in command) transform = moveCharacterPlanar(frame, transform, command);
      if ('groundHeight' in command) transform = setCharacterWorldHeight(frame, transform, command.groundHeight);
      deriveCharacterRenderTransform(frame, transform, origin);
    }
    return transform;
  }

  const fixedOrigin = run(null);
  const shiftedOrigin = run(3);
  assert.deepEqual(shiftedOrigin, fixedOrigin, 'render-origin schedule must not affect authoritative character state');
}

// 6. World-frame ambiguity, malformed canonical state and invalid movement fail closed.
{
  const otherFrame = createWorldFrame({
    id: 'other-frame',
    horizontalCrs: 'EPSG:25833',
    verticalDatum: 'NN2000',
  });
  const foreignPosition = createWorldPosition(otherFrame, {
    easting: 300000,
    northing: 6677500,
    height: 205,
  });
  assert.throws(
    () => createCharacterWorldTransform({ entityId: 'player-1', worldFrame: frame, position: foreignPosition }),
    (error) => error instanceof CharacterTransformError && error.code === 'WORLD_FRAME_MISMATCH',
  );

  const transform = createCharacterWorldTransform({ entityId: 'player-1', worldFrame: frame, position: spawn });
  assert.throws(
    () => moveCharacterPlanar(frame, transform, { forwardMeters: Number.NaN }),
    (error) => error instanceof CharacterTransformError && error.code === 'NON_FINITE',
  );
  assert.throws(
    () => setCharacterHeading(frame, transform, Number.POSITIVE_INFINITY),
    (error) => error instanceof CharacterTransformError && error.code === 'NON_FINITE',
  );
  assert.throws(
    () => setCharacterWorldHeight(frame, transform, Number.NaN),
    (error) => error instanceof CharacterTransformError && error.code === 'NON_FINITE',
  );

  const forgedHeading = Object.freeze({ ...transform, headingRadians: Math.PI * 2 });
  assert.throws(
    () => moveCharacterPlanar(frame, forgedHeading, { forwardMeters: 1 }),
    (error) => error instanceof CharacterTransformError && error.code === 'NON_CANONICAL_HEADING',
  );
}

// 7. Hot-path no-ops preserve object identity and changed heading reuses immutable world position.
{
  const transform = createCharacterWorldTransform({
    entityId: 'player-fast-path',
    worldFrame: frame,
    position: spawn,
    headingRadians: Math.PI / 4,
  });

  assert.strictEqual(moveCharacterPlanar(frame, transform), transform, 'zero movement must allocate no new transform');
  assert.strictEqual(setCharacterHeading(frame, transform, transform.headingRadians), transform, 'unchanged heading must allocate no new transform');
  assert.strictEqual(setCharacterHeading(frame, transform, transform.headingRadians + Math.PI * 2), transform, 'equivalent wrapped heading must allocate no new transform');
  assert.strictEqual(setCharacterWorldHeight(frame, transform, transform.position.height), transform, 'unchanged grounding height must allocate no new transform');

  const turned = setCharacterHeading(frame, transform, Math.PI / 2);
  assert.notStrictEqual(turned, transform);
  assert.strictEqual(turned.position, transform.position, 'heading-only update must reuse immutable authoritative position');

  const moved = moveCharacterPlanar(frame, turned, { forwardMeters: 1 });
  assert.notStrictEqual(moved.position, turned.position, 'physical movement must create a new authoritative position');
}

console.log(JSON.stringify({
  status: 'PASS',
  contract: 'nwe.character-world-transform/0.1-candidate',
  cases: 7,
  authoritative: 'WorldPosition Float64 + renderer-neutral canonical heading',
  renderLocal: 'derived Float32Array / origin epoch scoped',
  hotPath: 'no-op identity reuse + no redundant WorldPosition clone on updates',
  assetAnimationInputCamera: 'LUMEN boundary / not implemented here',
}));
