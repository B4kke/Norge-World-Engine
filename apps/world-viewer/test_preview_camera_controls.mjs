import assert from 'node:assert/strict';
import {
  PREVIEW_CAMERA_LIMITS,
  applyOrbitDelta,
  applyPanDelta,
  applyPinchZoom,
  applyWheelZoom,
  installPreviewCameraControls,
} from './src/previewCameraControls.mjs';

function camera() {
  return { yaw: 0, pitch: 0.62, distance: 1000, target: [0, 7, 0] };
}

class FakeCanvas {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener));
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  dispatch(type, input = {}) {
    const event = {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
      button: 0,
      buttons: 1,
      shiftKey: false,
      preventDefault() {},
      ...input,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

{
  const value = camera();
  applyPinchZoom(value, 100, 200);
  assert.equal(value.distance, 500, 'spreading two fingers must zoom in');
  applyPinchZoom(value, 200, 100);
  assert.equal(value.distance, 1000, 'closing two fingers must zoom out');
}

{
  const value = camera();
  applyWheelZoom(value, -100000);
  assert.equal(value.distance, PREVIEW_CAMERA_LIMITS.minDistance, 'zoom-in must clamp at close inspection distance');
  applyWheelZoom(value, 100000);
  assert.equal(value.distance, PREVIEW_CAMERA_LIMITS.maxDistance, 'zoom-out must clamp at overview distance');
}

{
  const value = camera();
  applyPanDelta(value, 40, 0);
  assert.notEqual(value.target[0], 0, 'horizontal pan must move camera target');
  assert.equal(value.target[2], 0, 'yaw=0 horizontal pan should remain on local X axis');
}

{
  const value = camera();
  applyOrbitDelta(value, 30, -20);
  assert.notEqual(value.yaw, 0, 'orbit must change yaw');
  assert.ok(value.pitch >= PREVIEW_CAMERA_LIMITS.minPitch && value.pitch <= PREVIEW_CAMERA_LIMITS.maxPitch, 'pitch must stay bounded');
}

{
  const value = camera();
  const canvas = new FakeCanvas();
  let changes = 0;
  const remove = installPreviewCameraControls(canvas, value, () => { changes += 1; });

  canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  canvas.dispatch('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
  canvas.dispatch('pointermove', { pointerId: 2, clientX: 260, clientY: 120 });

  assert.ok(value.distance < 1000, 'wired two-pointer gesture must zoom camera');
  assert.notDeepEqual(value.target, [0, 7, 0], 'wired two-pointer centroid movement must pan camera target');
  assert.ok(changes > 0, 'wired gesture must invalidate renderer');
  remove();
}

{
  const value = camera();
  const canvas = new FakeCanvas();
  let changes = 0;
  const remove = installPreviewCameraControls(canvas, value, () => { changes += 1; });
  canvas.dispatch('pointerdown', { pointerId: 7, clientX: 50, clientY: 50 });
  canvas.dispatch('pointermove', { pointerId: 7, clientX: 90, clientY: 20 });
  assert.notEqual(value.yaw, 0, 'wired single touch must orbit camera');
  assert.ok(changes > 0, 'single-touch orbit must invalidate renderer');
  remove();
}

console.log(JSON.stringify({
  status: 'PASS',
  cases: 6,
  min_distance_m: PREVIEW_CAMERA_LIMITS.minDistance,
  max_distance_m: PREVIEW_CAMERA_LIMITS.maxDistance,
}));
