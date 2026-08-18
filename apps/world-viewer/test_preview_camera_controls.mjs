import assert from 'node:assert/strict';
import {
  PREVIEW_CAMERA_LIMITS,
  applyOrbitDelta,
  applyPanDelta,
  applyPinchZoom,
  applyWheelZoom,
} from './src/previewCameraControls.mjs';

function camera() {
  return { yaw: 0, pitch: 0.62, distance: 1000, target: [0, 7, 0] };
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

console.log(JSON.stringify({
  status: 'PASS',
  cases: 4,
  min_distance_m: PREVIEW_CAMERA_LIMITS.minDistance,
  max_distance_m: PREVIEW_CAMERA_LIMITS.maxDistance,
}));
