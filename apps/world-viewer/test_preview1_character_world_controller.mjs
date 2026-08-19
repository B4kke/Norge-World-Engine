import assert from 'node:assert/strict';
import { createRenderOrigin, createWorldPosition } from '../../engine/world/world_contract.mjs';
import {
  atlasRenderTransformToThreePose,
  createPreview1CharacterWorldController,
  PREVIEW1_CHARACTER_WORLD_FRAME,
} from './src/preview1CharacterWorldController.mjs';

const terrainPayload = {
  elevations: new Float32Array([55, 55, 55, 55]),
  artifact: {
    header: {
      tile_id: 'nannestad-character-test',
      width: 2,
      height: 2,
      bounds: [100, 200, 102, 202],
      pixel_size_m: 1,
      nodata: -9999,
    },
  },
  mesh: {
    metadata: {
      origin: [101, 201, 50],
    },
  },
};

const controller = createPreview1CharacterWorldController({ terrainPayload });
const initial = controller.snapshot();
assert.equal(initial.worldTransform.position.easting, 101);
assert.equal(initial.worldTransform.position.northing, 201);
assert.equal(initial.worldTransform.position.height, 55);
assert.deepEqual(Array.from(initial.threePose.position), [0, 5, 0]);
assert.equal(initial.grounding.source, 'accepted-dtm-grid');
assert.equal(initial.grounding.verticalDatum, 'NN2000');

const north = controller.move({ forwardMeters: 0.5 });
assert.equal(north.worldTransform.position.easting, 101);
assert.equal(north.worldTransform.position.northing, 201.5);
assert.equal(north.worldTransform.position.height, 55);
assert.deepEqual(Array.from(north.threePose.position), [0, 5, -0.5]);

controller.setHeading(Math.PI / 2);
const east = controller.move({ forwardMeters: 0.5 });
assert.ok(Math.abs(east.worldTransform.position.easting - 101.5) < 1e-12);
assert.ok(Math.abs(east.worldTransform.position.northing - 201.5) < 1e-12);
assert.deepEqual(Array.from(east.threePose.position), [0.5, 5, -0.5]);
assert.equal(east.threePose.headingRadians, Math.PI / 2);

const authoritativeBeforeOriginShift = {
  easting: east.worldTransform.position.easting,
  northing: east.worldTransform.position.northing,
  height: east.worldTransform.position.height,
  headingRadians: east.worldTransform.headingRadians,
};
const shiftedOrigin = createRenderOrigin({
  worldFrame: PREVIEW1_CHARACTER_WORLD_FRAME,
  originSeriesId: 'preview1-character-origin',
  epoch: 1,
  anchorWorld: createWorldPosition(PREVIEW1_CHARACTER_WORLD_FRAME, {
    easting: 101.25,
    northing: 201.25,
    height: 50,
  }),
});
const shifted = controller.setRenderOrigin(shiftedOrigin);
assert.deepEqual({
  easting: shifted.worldTransform.position.easting,
  northing: shifted.worldTransform.position.northing,
  height: shifted.worldTransform.position.height,
  headingRadians: shifted.worldTransform.headingRadians,
}, authoritativeBeforeOriginShift, 'render-origin change must not mutate authoritative character state');
assert.deepEqual(Array.from(shifted.threePose.position), [0.25, 5, -0.25]);
assert.equal(shifted.threePose.originEpoch, 1);

assert.throws(() => atlasRenderTransformToThreePose({ position: new Float64Array(3) }), /ATLAS_RENDER_TRANSFORM_POSITION_REQUIRED/);

console.log('PREVIEW1_CHARACTER_WORLD_CONTROLLER_PASS');
