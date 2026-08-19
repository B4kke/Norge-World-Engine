import { installPreviewCameraControls } from './previewCameraControls.mjs';

export const THREE_GROUND_CAMERA_LIMITS = Object.freeze({
  minDistance: 1.5,
  maxDistance: 4200,
  minPitch: -1.25,
  maxPitch: 1.25,
});

export const THREE_CHARACTER_FOLLOW_DEFAULTS = Object.freeze({
  targetHeightM: 1.2,
  distanceM: 6.5,
  pitchRadians: 0.22,
});

function finiteVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new TypeError(`${label} must be a finite [x,y,z] vector`);
  }
  return value.map(Number);
}

export function cameraStateFromPose(position, target) {
  const eye = finiteVector3(position, 'position');
  const focus = finiteVector3(target, 'target');
  const dx = eye[0] - focus[0];
  const dy = eye[1] - focus[1];
  const dz = eye[2] - focus[2];
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  return {
    yaw: Math.atan2(dx, dz),
    pitch: Math.asin(Math.max(-1, Math.min(1, dy / distance))),
    distance,
    target: [...focus],
  };
}

export function applyCameraState(camera, state) {
  const cp = Math.cos(state.pitch);
  camera.position.set(
    state.target[0] + Math.sin(state.yaw) * cp * state.distance,
    state.target[1] + Math.sin(state.pitch) * state.distance,
    state.target[2] + Math.cos(state.yaw) * cp * state.distance,
  );
  camera.lookAt(state.target[0], state.target[1], state.target[2]);
  return camera;
}

export function installThreePreviewCameraControls({ canvas, camera, target, onChange = () => {} } = {}) {
  if (!canvas || !camera?.position || typeof camera.lookAt !== 'function') throw new TypeError('canvas and Three camera are required');
  const initial = cameraStateFromPose([camera.position.x, camera.position.y, camera.position.z], target);
  const state = { ...initial, target: [...initial.target] };
  const previousTouchAction = canvas.style?.touchAction ?? '';
  if (canvas.style) canvas.style.touchAction = 'none';

  const sync = () => {
    applyCameraState(camera, state);
    onChange(state);
  };

  const remove = installPreviewCameraControls(canvas, state, sync, {
    limits: THREE_GROUND_CAMERA_LIMITS,
    resetCamera: () => {
      state.yaw = initial.yaw;
      state.pitch = initial.pitch;
      state.distance = initial.distance;
      state.target.splice(0, 3, ...initial.target);
    },
  });

  return {
    state,
    sync,
    followTarget(position, { headingRadians = 0, initialize = false } = {}) {
      const character = finiteVector3(position, 'character position');
      if (!Number.isFinite(headingRadians)) throw new TypeError('headingRadians must be finite');
      state.target.splice(0, 3, character[0], character[1] + THREE_CHARACTER_FOLLOW_DEFAULTS.targetHeightM, character[2]);
      if (initialize) {
        state.yaw = -headingRadians;
        state.pitch = THREE_CHARACTER_FOLLOW_DEFAULTS.pitchRadians;
        state.distance = THREE_CHARACTER_FOLLOW_DEFAULTS.distanceM;
      }
      sync();
      return this.snapshot();
    },
    dispose() {
      remove();
      if (canvas.style) canvas.style.touchAction = previousTouchAction;
    },
    snapshot() {
      return {
        yaw: state.yaw,
        pitch: state.pitch,
        distance: state.distance,
        target: [...state.target],
      };
    },
  };
}
