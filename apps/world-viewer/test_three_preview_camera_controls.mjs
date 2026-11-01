import assert from 'node:assert/strict';

import {
  THREE_CHARACTER_FOLLOW_DEFAULTS,
  THREE_FLY_CAMERA_DEFAULTS,
  THREE_GROUND_CAMERA_LIMITS,
  cameraStateFromPose,
  installThreePreviewCameraControls,
  stepFlyCamera,
} from './src/threePreviewCameraControls.mjs';

function fakeCanvas() {
  const listeners = new Map();
  return {
    style: { touchAction: '' },
    parentElement: null,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    setPointerCapture() {}, releasePointerCapture() {},
    dispatch(type, values = {}) {
      const handler = listeners.get(type);
      assert.equal(typeof handler, 'function', `missing ${type} listener`);
      let prevented = false;
      handler({ pointerId: 1, clientX: 0, clientY: 0, pointerType: 'mouse', button: 0, buttons: 1,
        shiftKey: false, deltaY: 0, preventDefault() { prevented = true; }, ...values });
      return prevented;
    },
    listenerCount() { return listeners.size; },
  };
}

function fakeCamera(position) {
  return {
    position: { x: position[0], y: position[1], z: position[2], set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lastLookAt: null,
    lookAt(x, y, z) { this.lastLookAt = [x, y, z]; },
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
    removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== handler)); },
    dispatch(type, values = {}) {
      const event = { code: '', repeat: false, target: null, preventDefault() {}, stopImmediatePropagation() {}, ...values };
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
  };
}

const centerGround = 5;
const initialPosition = [0, centerGround + 1.7, 14];
const initialTarget = [0, centerGround + 1.55, -28];
const initialState = cameraStateFromPose(initialPosition, initialTarget);
assert.ok(initialState.pitch > -0.01 && initialState.pitch < 0.01);
assert.ok(initialState.pitch > THREE_GROUND_CAMERA_LIMITS.minPitch);
assert.ok(initialState.distance > THREE_GROUND_CAMERA_LIMITS.minDistance);

const canvas = fakeCanvas();
const camera = fakeCamera(initialPosition);
let changes = 0;
const controls = installThreePreviewCameraControls({ canvas, camera, target: initialTarget, onChange: () => { changes += 1; } });
assert.equal(canvas.style.touchAction, 'none');
assert.equal(canvas.listenerCount(), 7);

const follow = controls.followTarget([10, 20, -30], { headingRadians: Math.PI / 2, initialize: true });
assert.deepEqual(follow.target, [10, 20 + THREE_CHARACTER_FOLLOW_DEFAULTS.targetHeightM, -30]);
assert.ok(Math.abs(follow.yaw + Math.PI / 2) < 1e-12);
assert.equal(follow.pitch, THREE_CHARACTER_FOLLOW_DEFAULTS.pitchRadians);
assert.equal(follow.distance, THREE_CHARACTER_FOLLOW_DEFAULTS.distanceM);

const beforeOrbit = controls.snapshot();
assert.equal(canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 }), true);
assert.equal(canvas.dispatch('pointermove', { clientX: 130, clientY: 110 }), true);
const afterOrbit = controls.snapshot();
assert.notEqual(afterOrbit.yaw, beforeOrbit.yaw);
assert.notEqual(afterOrbit.pitch, beforeOrbit.pitch);
assert.ok(changes >= 1);

const beforeWheel = controls.snapshot().distance;
assert.equal(canvas.dispatch('wheel', { deltaY: 120 }), true);
assert.notEqual(controls.snapshot().distance, beforeWheel);
assert.equal(canvas.dispatch('dblclick'), true);
assert.deepEqual(controls.snapshot().target, initialTarget);
controls.dispose();
assert.equal(canvas.style.touchAction, '');
assert.equal(canvas.listenerCount(), 0);

const straight = stepFlyCamera({ eye: [0, 10, 0], yaw: 0, pitch: 0, input: { forward: true }, deltaSeconds: 0.05 });
assert.deepEqual(straight, [0, 10, -THREE_FLY_CAMERA_DEFAULTS.speedMps * 0.05]);
const rise = stepFlyCamera({ eye: [0, 10, 0], yaw: 0, pitch: 0, input: { up: true }, deltaSeconds: 0.05 });
assert.ok(rise[1] > 10);
const boosted = stepFlyCamera({ eye: [0, 10, 0], yaw: 0, pitch: 0, input: { forward: true, boost: true }, deltaSeconds: 0.05 });
assert.ok(Math.abs(boosted[2]) > Math.abs(straight[2]) * 3.9);

const flyCanvas = fakeCanvas();
const flyCamera = fakeCamera(initialPosition);
const flyWindow = fakeWindow();
let scheduled = null;
const flyControls = installThreePreviewCameraControls({
  canvas: flyCanvas, camera: flyCamera, target: initialTarget, firstPerson: true,
  windowRef: flyWindow, documentRef: null,
  requestFrame(callback) { scheduled = callback; return 1; }, cancelFrame() {},
});
flyControls.followTarget([0, centerGround, 0], { headingRadians: 0, initialize: true });
assert.equal(flyControls.snapshot().mode, 'first-person');
flyWindow.dispatch('keydown', { code: 'KeyF' });
assert.equal(flyControls.snapshot().mode, 'free-fly');
flyWindow.dispatch('keydown', { code: 'KeyW' });
assert.equal(typeof scheduled, 'function');
scheduled(1000); scheduled(1050);
assert.ok(flyControls.snapshot().eye[2] < 0, 'free-fly W must move camera forward independently of the character');
const flyEye = [...flyControls.snapshot().eye];
flyControls.followTarget([100, 100, 100], { headingRadians: 0, initialize: false });
assert.deepEqual(flyControls.snapshot().eye, flyEye, 'character follow updates must not steal a free-fly camera');
flyWindow.dispatch('keyup', { code: 'KeyW' });
flyWindow.dispatch('keydown', { code: 'KeyF' });
assert.equal(flyControls.snapshot().mode, 'first-person');
assert.deepEqual(flyControls.snapshot().target, [100, 101.7, 100], 'returning to walk mode must reattach to the latest character pose');
flyControls.dispose();

console.log('THREE_PREVIEW_CAMERA_CONTROLS_PASS');
