import assert from 'node:assert/strict';

import {
  THREE_CHARACTER_FOLLOW_DEFAULTS,
  THREE_GROUND_CAMERA_LIMITS,
  cameraStateFromPose,
  installThreePreviewCameraControls,
} from './src/threePreviewCameraControls.mjs';

function fakeCanvas() {
  const listeners = new Map();
  return {
    style: { touchAction: '' },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatch(type, values = {}) {
      const handler = listeners.get(type);
      assert.equal(typeof handler, 'function', `missing ${type} listener`);
      let prevented = false;
      handler({
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        shiftKey: false,
        deltaY: 0,
        preventDefault() { prevented = true; },
        ...values,
      });
      return prevented;
    },
    listenerCount() { return listeners.size; },
  };
}

function fakeCamera(position) {
  return {
    position: {
      x: position[0], y: position[1], z: position[2],
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    lastLookAt: null,
    lookAt(x, y, z) { this.lastLookAt = [x, y, z]; },
  };
}

const centerGround = 5;
const initialPosition = [0, centerGround + 1.7, 14];
const initialTarget = [0, centerGround + 1.55, -28];
const initialState = cameraStateFromPose(initialPosition, initialTarget);
assert.ok(initialState.pitch > -0.01 && initialState.pitch < 0.01, 'ground camera should start near the horizon');
assert.ok(initialState.pitch > THREE_GROUND_CAMERA_LIMITS.minPitch, 'ground camera limits must not clamp the initial pose');
assert.ok(initialState.distance > THREE_GROUND_CAMERA_LIMITS.minDistance);

const canvas = fakeCanvas();
const camera = fakeCamera(initialPosition);
let changes = 0;
const controls = installThreePreviewCameraControls({
  canvas,
  camera,
  target: initialTarget,
  onChange: () => { changes += 1; },
});

assert.equal(canvas.style.touchAction, 'none', 'touch gestures must stay owned by the 3D canvas');
assert.equal(canvas.listenerCount(), 7, 'camera controls must install pointer, wheel, reset and context-menu listeners');

const follow = controls.followTarget([10, 20, -30], { headingRadians: Math.PI / 2, initialize: true });
assert.deepEqual(follow.target, [10, 20 + THREE_CHARACTER_FOLLOW_DEFAULTS.targetHeightM, -30]);
assert.ok(Math.abs(follow.yaw + Math.PI / 2) < 1e-12, 'initial follow camera must sit behind an east-facing character');
assert.equal(follow.pitch, THREE_CHARACTER_FOLLOW_DEFAULTS.pitchRadians);
assert.equal(follow.distance, THREE_CHARACTER_FOLLOW_DEFAULTS.distanceM);
const followYaw = follow.yaw;
const movedFollow = controls.followTarget([11, 21, -31], { headingRadians: 0, initialize: false });
assert.deepEqual(movedFollow.target, [11, 21 + THREE_CHARACTER_FOLLOW_DEFAULTS.targetHeightM, -31]);
assert.equal(movedFollow.yaw, followYaw, 'character movement must translate the orbit target without stealing the user orbit angle');

const beforeOrbit = controls.snapshot();
assert.equal(canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 }), true);
assert.equal(canvas.dispatch('pointermove', { clientX: 130, clientY: 110 }), true);
const afterOrbit = controls.snapshot();
assert.notEqual(afterOrbit.yaw, beforeOrbit.yaw, 'pointer drag must orbit the Three camera');
assert.notEqual(afterOrbit.pitch, beforeOrbit.pitch, 'pointer drag must change ground-camera pitch');
assert.ok(changes >= 1);
assert.ok(camera.lastLookAt, 'orbit must update the Three camera pose');

const beforeWheel = controls.snapshot().distance;
assert.equal(canvas.dispatch('wheel', { deltaY: 120 }), true);
assert.notEqual(controls.snapshot().distance, beforeWheel, 'wheel input must dolly the Three camera');

assert.equal(canvas.dispatch('dblclick'), true);
const reset = controls.snapshot();
assert.ok(Math.abs(reset.yaw - initialState.yaw) < 1e-12);
assert.ok(Math.abs(reset.pitch - initialState.pitch) < 1e-12);
assert.ok(Math.abs(reset.distance - initialState.distance) < 1e-12);
assert.deepEqual(reset.target, initialTarget);

controls.dispose();
assert.equal(canvas.style.touchAction, '', 'disposing controls must restore the prior touch-action');
assert.equal(canvas.listenerCount(), 0, 'disposing controls must remove all interaction listeners');

console.log('THREE_PREVIEW_CAMERA_CONTROLS_PASS');
