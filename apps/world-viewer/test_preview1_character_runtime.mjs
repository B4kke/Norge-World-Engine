import assert from 'node:assert/strict';
import { createPreview1CharacterRuntime } from './src/preview1CharacterRuntime.mjs';

const terrainPayload = {
  elevations: new Float32Array([55, 55, 55, 55]),
  artifact: {
    header: {
      tile_id: 'nannestad-character-runtime-test',
      width: 2,
      height: 2,
      bounds: [100, 200, 102, 202],
      pixel_size_m: 1,
      nodata: -9999,
    },
  },
  mesh: { metadata: { origin: [101, 201, 50] } },
};

const calls = [];
const renderer = {
  setCharacterRenderPose(pose) {
    calls.push({ type: 'pose', position: [...pose.position], heading: pose.headingRadians });
  },
  setCharacterAnimationState(state) {
    calls.push({ type: 'animation', state });
  },
};

const runtime = createPreview1CharacterRuntime({ terrainPayload, renderer });
assert.deepEqual(calls.slice(0, 2), [
  { type: 'pose', position: [0, 5, 0], heading: 0 },
  { type: 'animation', state: 'idle' },
]);

const initialWorld = runtime.snapshot().character.worldTransform;
runtime.move({ forwardMeters: 0.5 });
const moved = runtime.snapshot();
assert.equal(moved.moving, true);
assert.equal(moved.character.worldTransform.position.northing, initialWorld.position.northing + 0.5);
assert.equal(moved.character.worldTransform.position.height, 55);
assert.deepEqual(calls.at(-1), { type: 'pose', position: [0, 5, -0.5], heading: 0 });
assert.ok(calls.some((call) => call.type === 'animation' && call.state === 'walk'));

runtime.stop();
assert.equal(runtime.snapshot().moving, false);
assert.deepEqual(calls.at(-1), { type: 'animation', state: 'idle' });

runtime.setHeading(Math.PI / 2);
runtime.move({ forwardMeters: 0.5 });
const east = runtime.snapshot();
assert.ok(Math.abs(east.character.worldTransform.position.easting - 101.5) < 1e-12);
assert.equal(east.character.worldTransform.position.height, 55);
assert.deepEqual(calls.at(-1), { type: 'pose', position: [0.5, 5, -0.5], heading: Math.PI / 2 });

assert.throws(() => createPreview1CharacterRuntime({ terrainPayload, renderer: {} }), /PREVIEW1_CHARACTER_RENDERER_/);

console.log('PREVIEW1_CHARACTER_RUNTIME_PASS');
