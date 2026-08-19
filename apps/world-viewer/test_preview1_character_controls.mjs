import assert from 'node:assert/strict';
import { createCharacterInputState, stepCharacterInput } from './src/preview1CharacterControls.mjs';

let heading = 0;
let northing = 200;
let moving = false;
const calls = [];
const runtime = {
  snapshot() {
    return {
      moving,
      character: {
        worldTransform: {
          headingRadians: heading,
          position: { easting: 100, northing, height: 55 },
        },
      },
    };
  },
  setHeading(next) {
    heading = next;
    calls.push({ type: 'heading', value: next });
    return this.snapshot().character;
  },
  move({ forwardMeters }) {
    northing += Math.cos(heading) * forwardMeters;
    moving = true;
    calls.push({ type: 'move', forwardMeters });
    return this.snapshot().character;
  },
  stop() {
    moving = false;
    calls.push({ type: 'stop' });
    return this.snapshot();
  },
};

const input = createCharacterInputState();
assert.deepEqual(input, { forward: false, backward: false, turnLeft: false, turnRight: false });

input.forward = true;
stepCharacterInput({ runtime, input, deltaSeconds: 0.5, moveSpeedMps: 4 });
assert.equal(calls.at(-1).type, 'move');
assert.equal(calls.at(-1).forwardMeters, 0.2, 'input dt must clamp to 50 ms to avoid background-tab jumps');
assert.equal(northing, 200.2);

input.turnRight = true;
stepCharacterInput({ runtime, input, deltaSeconds: 0.05, moveSpeedMps: 4, turnSpeedRadps: 2 });
assert.ok(Math.abs(heading - 0.1) < 1e-12);
assert.equal(calls.at(-1).type, 'move');

input.forward = false;
input.turnRight = false;
stepCharacterInput({ runtime, input, deltaSeconds: 0.05 });
assert.equal(calls.at(-1).type, 'stop');
assert.equal(moving, false);

input.backward = true;
const beforeBack = northing;
stepCharacterInput({ runtime, input, deltaSeconds: 0.05, moveSpeedMps: 4 });
assert.ok(northing < beforeBack, 'backward input must move opposite the authoritative heading');

assert.throws(() => stepCharacterInput({ runtime: {}, input, deltaSeconds: 0.01 }), /character runtime is required/);

console.log('PREVIEW1_CHARACTER_CONTROLS_PASS');
