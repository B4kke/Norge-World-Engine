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

export const THREE_FLY_CAMERA_DEFAULTS = Object.freeze({
  speedMps: 42,
  boostMultiplier: 4,
  precisionMultiplier: 0.24,
  verticalMultiplier: 0.85,
  maxStepSeconds: 0.05,
});

function finiteVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new TypeError(`${label} must be a finite [x,y,z] vector`);
  }
  return value.map(Number);
}

function editableTarget(target) {
  const tagName = String(target?.tagName ?? '').toLowerCase();
  return Boolean(target?.isContentEditable) || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function emptyFlyInput() {
  return { forward: false, backward: false, left: false, right: false, up: false, down: false, boost: false, precision: false };
}

export function stepFlyCamera({ eye, yaw, pitch, input, deltaSeconds, speedMps = THREE_FLY_CAMERA_DEFAULTS.speedMps } = {}) {
  const origin = finiteVector3(eye, 'eye');
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new TypeError('yaw/pitch must be finite');
  const dt = Math.max(0, Math.min(THREE_FLY_CAMERA_DEFAULTS.maxStepSeconds, Number(deltaSeconds) || 0));
  if (dt === 0 || !input) return origin;

  let speed = Number(speedMps) || THREE_FLY_CAMERA_DEFAULTS.speedMps;
  if (input.boost) speed *= THREE_FLY_CAMERA_DEFAULTS.boostMultiplier;
  if (input.precision) speed *= THREE_FLY_CAMERA_DEFAULTS.precisionMultiplier;

  const cp = Math.cos(pitch);
  const forward = [-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const forwardAxis = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const rightAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const verticalAxis = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (forwardAxis === 0 && rightAxis === 0 && verticalAxis === 0) return origin;

  const x = forward[0] * forwardAxis + right[0] * rightAxis;
  const y = forward[1] * forwardAxis + verticalAxis * THREE_FLY_CAMERA_DEFAULTS.verticalMultiplier;
  const z = forward[2] * forwardAxis + right[2] * rightAxis;
  const magnitude = Math.hypot(x, y, z) || 1;
  const metres = speed * dt;
  return [origin[0] + x / magnitude * metres, origin[1] + y / magnitude * metres, origin[2] + z / magnitude * metres];
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

function requestedInitialMode(firstPerson) {
  if (!firstPerson) return 'third-person-follow-orbit';
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('camera') === 'fly' ? 'free-fly' : 'first-person';
  } catch {
    return 'first-person';
  }
}

function installFlyOverlay({ canvas, documentRef, input, getMode, setMode }) {
  if (!documentRef?.createElement) return { sync() {}, dispose() {} };
  const parent = canvas?.parentElement ?? documentRef.body;
  if (!parent) return { sync() {}, dispose() {} };
  const root = documentRef.createElement('div');
  root.dataset.flyCameraControls = 'true';
  Object.assign(root.style, {
    position: parent === documentRef.body ? 'fixed' : 'absolute',
    right: 'max(12px, env(safe-area-inset-right))',
    bottom: 'max(12px, env(safe-area-inset-bottom))',
    zIndex: '35',
    display: 'grid',
    gap: '8px',
    justifyItems: 'end',
    pointerEvents: 'none',
    font: '600 12px/1.2 system-ui, sans-serif',
  });

  const toggle = documentRef.createElement('button');
  toggle.type = 'button';
  toggle.dataset.cameraModeToggle = 'true';
  Object.assign(toggle.style, {
    pointerEvents: 'auto', border: '1px solid rgba(255,255,255,.3)', borderRadius: '12px',
    background: 'rgba(8,17,21,.78)', color: '#fff', padding: '9px 11px', backdropFilter: 'blur(8px)',
  });
  root.append(toggle);

  const pad = documentRef.createElement('div');
  pad.dataset.flyPad = 'true';
  Object.assign(pad.style, { display: 'none', gridTemplateColumns: '42px 42px 42px', gridTemplateRows: '42px 42px 42px', gap: '5px', pointerEvents: 'auto' });
  const bindings = [
    ['↑', 'forward', 2, 1], ['←', 'left', 1, 2], ['↓', 'backward', 2, 2], ['→', 'right', 3, 2],
    ['+', 'up', 3, 1], ['−', 'down', 3, 3],
  ];
  const disposers = [];
  for (const [label, action, column, row] of bindings) {
    const button = documentRef.createElement('button');
    button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', `Fly ${action}`);
    button.style.gridColumn = String(column); button.style.gridRow = String(row);
    Object.assign(button.style, { border: '1px solid rgba(255,255,255,.26)', borderRadius: '10px', background: 'rgba(8,17,21,.7)', color: '#fff', font: '700 18px/1 system-ui, sans-serif', touchAction: 'none' });
    const press = (event) => { event.preventDefault(); event.stopPropagation(); input[action] = true; button.setPointerCapture?.(event.pointerId); };
    const release = (event) => { event.preventDefault(); event.stopPropagation(); input[action] = false; button.releasePointerCapture?.(event.pointerId); };
    button.addEventListener('pointerdown', press); button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
    disposers.push(() => { button.removeEventListener('pointerdown', press); button.removeEventListener('pointerup', release); button.removeEventListener('pointercancel', release); });
    pad.append(button);
  }
  root.append(pad);
  parent.append(root);

  const click = (event) => {
    event.preventDefault(); event.stopPropagation();
    setMode(getMode() === 'free-fly' ? 'first-person' : 'free-fly');
  };
  toggle.addEventListener('click', click);

  const sync = () => {
    const fly = getMode() === 'free-fly';
    toggle.textContent = fly ? 'Gåmodus · F' : 'Flymodus · F';
    toggle.setAttribute('aria-pressed', String(fly));
    pad.style.display = fly ? 'grid' : 'none';
    const characterTouch = documentRef.querySelector?.('[data-character-controls="touch"]');
    if (characterTouch?.style) characterTouch.style.display = fly ? 'none' : 'grid';
  };
  sync();
  return {
    sync,
    dispose() {
      toggle.removeEventListener('click', click);
      for (const dispose of disposers) dispose();
      root.remove();
    },
  };
}

export function installThreePreviewCameraControls({
  canvas,
  camera,
  target,
  firstPerson = false,
  onChange = () => {},
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  if (!canvas || !camera?.position || typeof camera.lookAt !== 'function') throw new TypeError('canvas and Three camera are required');
  const initialEye = [Number(camera.position.x), Number(camera.position.y), Number(camera.position.z)];
  const initial = cameraStateFromPose(initialEye, target);
  const state = { ...initial, target: [...initial.target] };
  const previousTouchAction = canvas.style?.touchAction ?? '';
  if (canvas.style) canvas.style.touchAction = 'none';

  let mode = requestedInitialMode(firstPerson);
  let lastHeading = 0;
  let eye = mode === 'free-fly' ? [...initialEye] : [...state.target];
  let lastFollowTarget = null;
  let disposed = false;
  let flyFrameId = 0;
  let lastFlyAt = 0;
  const flyInput = emptyFlyInput();

  const sync = () => {
    if (firstPerson || mode === 'free-fly') {
      state.target.splice(0, 3, ...eye);
      state.distance = 0;
      camera.position.set(...eye);
      const cp = Math.cos(state.pitch);
      camera.lookAt(state.target[0] - Math.sin(state.yaw) * cp,
        state.target[1] - Math.sin(state.pitch), state.target[2] - Math.cos(state.yaw) * cp);
    } else applyCameraState(camera, state);
    onChange(state);
  };

  const remove = installPreviewCameraControls(canvas, state, sync, {
    limits: THREE_GROUND_CAMERA_LIMITS,
    resetCamera: () => {
      state.yaw = initial.yaw;
      state.pitch = initial.pitch;
      state.distance = initial.distance;
      state.target.splice(0, 3, ...initial.target);
      eye = mode === 'free-fly' ? [...initialEye] : [...initial.target];
    },
  });

  let overlay = { sync() {}, dispose() {} };
  const setMode = (nextMode) => {
    if (!['first-person', 'free-fly', 'third-person-follow-orbit'].includes(nextMode)) throw new TypeError(`unsupported camera mode: ${nextMode}`);
    if (nextMode === 'third-person-follow-orbit' && firstPerson) nextMode = 'first-person';
    if (mode === nextMode) return snapshot();
    Object.assign(flyInput, emptyFlyInput());
    if (nextMode === 'free-fly') {
      eye = [Number(camera.position.x), Number(camera.position.y), Number(camera.position.z)];
      state.target.splice(0, 3, ...eye);
      state.distance = 0;
    } else if (firstPerson) {
      if (lastFollowTarget) eye = [...lastFollowTarget];
      state.target.splice(0, 3, ...eye);
      state.distance = 0;
    }
    mode = nextMode;
    overlay.sync();
    sync();
    return snapshot();
  };

  overlay = installFlyOverlay({ canvas, documentRef, input: flyInput, getMode: () => mode, setMode });

  const keyMap = new Map([
    ['KeyW', 'forward'], ['KeyS', 'backward'], ['KeyA', 'left'], ['KeyD', 'right'],
    ['Space', 'up'], ['KeyE', 'up'], ['KeyQ', 'down'], ['ControlLeft', 'down'], ['ControlRight', 'down'],
    ['ShiftLeft', 'boost'], ['ShiftRight', 'boost'], ['AltLeft', 'precision'], ['AltRight', 'precision'],
  ]);
  const keyDown = (event) => {
    if (editableTarget(event.target)) return;
    if (event.code === 'KeyF' && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      setMode(mode === 'free-fly' ? 'first-person' : 'free-fly');
      return;
    }
    if (mode !== 'free-fly') return;
    const action = keyMap.get(event.code);
    if (!action) return;
    flyInput[action] = true;
    event.preventDefault();
    event.stopImmediatePropagation?.();
  };
  const keyUp = (event) => {
    if (mode !== 'free-fly') return;
    const action = keyMap.get(event.code);
    if (!action) return;
    flyInput[action] = false;
    event.preventDefault();
    // Let downstream character keyup handlers clear any movement key that was
    // already held when fly mode was entered. Keydown stays intercepted.
  };
  const blur = () => Object.assign(flyInput, emptyFlyInput());
  windowRef?.addEventListener?.('keydown', keyDown);
  windowRef?.addEventListener?.('keyup', keyUp);
  windowRef?.addEventListener?.('blur', blur);

  const flyFrame = (now) => {
    if (disposed) return;
    const dt = lastFlyAt ? Math.max(0, (Number(now) - lastFlyAt) / 1000) : 0;
    lastFlyAt = Number(now) || 0;
    if (mode === 'free-fly') {
      const nextEye = stepFlyCamera({ eye, yaw: state.yaw, pitch: state.pitch, input: flyInput, deltaSeconds: dt });
      if (nextEye[0] !== eye[0] || nextEye[1] !== eye[1] || nextEye[2] !== eye[2]) {
        eye = nextEye;
        sync();
      }
    }
    if (typeof requestFrame === 'function') flyFrameId = requestFrame(flyFrame);
  };
  if (typeof requestFrame === 'function') flyFrameId = requestFrame(flyFrame);

  function snapshot() {
    return {
      mode,
      yaw: state.yaw,
      pitch: state.pitch,
      distance: state.distance,
      target: [...state.target],
      eye: [Number(camera.position.x), Number(camera.position.y), Number(camera.position.z)],
      fly_speed_mps: THREE_FLY_CAMERA_DEFAULTS.speedMps,
      fly_controls: 'F toggle · WASD move · Space/E up · Q/Ctrl down · Shift boost · Alt precision',
    };
  }

  if (mode === 'free-fly') sync();

  return {
    state,
    sync,
    setMode,
    toggleFlyMode() { return setMode(mode === 'free-fly' ? 'first-person' : 'free-fly'); },
    followTarget(position, { headingRadians = 0, initialize = false } = {}) {
      const character = finiteVector3(position, 'character position');
      if (!Number.isFinite(headingRadians)) throw new TypeError('headingRadians must be finite');
      const followEye = [character[0], character[1] + (firstPerson ? 1.7 : THREE_CHARACTER_FOLLOW_DEFAULTS.targetHeightM), character[2]];
      lastFollowTarget = followEye;
      if (mode === 'free-fly') {
        lastHeading = headingRadians;
        return snapshot();
      }
      state.target.splice(0, 3, ...followEye);
      if (firstPerson && !initialize) state.yaw -= headingRadians - lastHeading;
      lastHeading = headingRadians;
      eye = [...state.target];
      if (initialize) {
        state.yaw = -headingRadians;
        state.pitch = firstPerson ? 0 : THREE_CHARACTER_FOLLOW_DEFAULTS.pitchRadians;
        state.distance = firstPerson ? 0 : THREE_CHARACTER_FOLLOW_DEFAULTS.distanceM;
      }
      sync();
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (flyFrameId && typeof cancelFrame === 'function') cancelFrame(flyFrameId);
      windowRef?.removeEventListener?.('keydown', keyDown);
      windowRef?.removeEventListener?.('keyup', keyUp);
      windowRef?.removeEventListener?.('blur', blur);
      overlay.dispose();
      remove();
      if (canvas.style) canvas.style.touchAction = previousTouchAction;
    },
    snapshot,
  };
}
