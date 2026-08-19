const DEFAULT_MOVE_SPEED_MPS = 3.2;
const DEFAULT_TURN_SPEED_RADPS = 1.9;
const MAX_INPUT_STEP_SECONDS = 0.05;

function editableTarget(target) {
  const tagName = String(target?.tagName ?? '').toLowerCase();
  return Boolean(target?.isContentEditable) || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

export function createCharacterInputState() {
  return { forward: false, backward: false, turnLeft: false, turnRight: false };
}

export function stepCharacterInput({
  runtime,
  input,
  deltaSeconds,
  moveSpeedMps = DEFAULT_MOVE_SPEED_MPS,
  turnSpeedRadps = DEFAULT_TURN_SPEED_RADPS,
} = {}) {
  if (!runtime?.snapshot || !runtime?.setHeading || !runtime?.move || !runtime?.stop) throw new TypeError('character runtime is required');
  if (!input || typeof input !== 'object') throw new TypeError('character input state is required');
  const dt = Math.max(0, Math.min(MAX_INPUT_STEP_SECONDS, Number(deltaSeconds) || 0));
  if (dt === 0) return runtime.snapshot();

  const turnAxis = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
  const moveAxis = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  if (turnAxis !== 0) {
    const currentHeading = runtime.snapshot().character.worldTransform.headingRadians;
    runtime.setHeading(currentHeading + turnAxis * turnSpeedRadps * dt);
  }
  if (moveAxis !== 0) {
    runtime.move({ forwardMeters: moveAxis * moveSpeedMps * dt });
  } else {
    runtime.stop();
  }
  return runtime.snapshot();
}

function createTouchButton(documentRef, label, action) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', action);
  button.dataset.characterAction = action;
  Object.assign(button.style, {
    width: '52px',
    height: '52px',
    borderRadius: '14px',
    border: '1px solid rgba(255,255,255,0.32)',
    background: 'rgba(10,18,22,0.66)',
    color: '#fff',
    font: '700 20px/1 system-ui, sans-serif',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  });
  return button;
}

function installTouchOverlay({ canvas, input, documentRef }) {
  const parent = canvas?.parentElement ?? documentRef.body;
  if (!parent) return { dispose() {} };
  if (parent !== documentRef.body && globalThis.getComputedStyle?.(parent)?.position === 'static') parent.style.position = 'relative';

  const overlay = documentRef.createElement('div');
  overlay.dataset.characterControls = 'touch';
  Object.assign(overlay.style, {
    position: parent === documentRef.body ? 'fixed' : 'absolute',
    left: 'max(14px, env(safe-area-inset-left))',
    bottom: 'max(14px, env(safe-area-inset-bottom))',
    display: 'grid',
    gridTemplateColumns: '52px 52px 52px',
    gridTemplateRows: '52px 52px',
    gap: '7px',
    zIndex: '30',
    pointerEvents: 'auto',
  });

  const bindings = [
    ['↑', 'forward', 2, 1],
    ['←', 'turnLeft', 1, 2],
    ['↓', 'backward', 2, 2],
    ['→', 'turnRight', 3, 2],
  ];
  const disposers = [];
  for (const [label, action, column, row] of bindings) {
    const button = createTouchButton(documentRef, label, action);
    button.style.gridColumn = String(column);
    button.style.gridRow = String(row);
    const press = (event) => {
      event.preventDefault();
      event.stopPropagation();
      input[action] = true;
      button.setPointerCapture?.(event.pointerId);
    };
    const release = (event) => {
      event.preventDefault();
      event.stopPropagation();
      input[action] = false;
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture?.(event.pointerId);
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', () => { input[action] = false; });
    disposers.push(() => {
      button.removeEventListener('pointerdown', press);
      button.removeEventListener('pointerup', release);
      button.removeEventListener('pointercancel', release);
    });
    overlay.append(button);
  }
  parent.append(overlay);
  return {
    dispose() {
      for (const dispose of disposers) dispose();
      overlay.remove();
    },
  };
}

export function installPreview1CharacterControls({
  canvas,
  runtime,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  if (!canvas) throw new TypeError('canvas is required');
  if (!windowRef?.addEventListener || !documentRef?.createElement) throw new TypeError('browser window/document are required');
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') throw new TypeError('animation frame functions are required');
  const input = createCharacterInputState();
  let disposed = false;
  let frameId = 0;
  let lastAt = 0;

  const mapping = new Map([
    ['KeyW', 'forward'], ['ArrowUp', 'forward'],
    ['KeyS', 'backward'], ['ArrowDown', 'backward'],
    ['KeyA', 'turnLeft'], ['ArrowLeft', 'turnLeft'],
    ['KeyD', 'turnRight'], ['ArrowRight', 'turnRight'],
  ]);
  const keyDown = (event) => {
    if (editableTarget(event.target)) return;
    const action = mapping.get(event.code);
    if (!action) return;
    input[action] = true;
    event.preventDefault();
  };
  const keyUp = (event) => {
    const action = mapping.get(event.code);
    if (!action) return;
    input[action] = false;
    event.preventDefault();
  };
  const blur = () => {
    Object.assign(input, createCharacterInputState());
    runtime.stop();
  };
  windowRef.addEventListener('keydown', keyDown);
  windowRef.addEventListener('keyup', keyUp);
  windowRef.addEventListener('blur', blur);
  const touch = installTouchOverlay({ canvas, input, documentRef });

  const frame = (now) => {
    if (disposed) return;
    const dt = lastAt ? (now - lastAt) / 1000 : 0;
    lastAt = now;
    stepCharacterInput({ runtime, input, deltaSeconds: dt });
    frameId = requestFrame(frame);
  };
  frameId = requestFrame(frame);

  return {
    input,
    snapshot() {
      return {
        schema: 'nwe.preview1-character-controls/0.1',
        keyboard: 'W/S or arrows move; A/D or arrows turn',
        touch: 'separate overlay buttons',
        move_speed_mps: DEFAULT_MOVE_SPEED_MPS,
        turn_speed_radps: DEFAULT_TURN_SPEED_RADPS,
        active: { ...input },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelFrame(frameId);
      windowRef.removeEventListener('keydown', keyDown);
      windowRef.removeEventListener('keyup', keyUp);
      windowRef.removeEventListener('blur', blur);
      touch.dispose();
      runtime.stop();
    },
  };
}
