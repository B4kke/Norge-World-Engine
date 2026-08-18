const TAU = Math.PI * 2;

export const PREVIEW_CAMERA_LIMITS = Object.freeze({
  minDistance: 35,
  maxDistance: 4200,
  minPitch: 0.08,
  maxPitch: 1.48,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function applyOrbitDelta(camera, dx, dy) {
  camera.yaw = (camera.yaw - dx * 0.006) % TAU;
  camera.pitch = clamp(camera.pitch + dy * 0.0045, PREVIEW_CAMERA_LIMITS.minPitch, PREVIEW_CAMERA_LIMITS.maxPitch);
  return camera;
}

export function applyWheelZoom(camera, deltaY) {
  camera.distance = clamp(
    camera.distance * Math.exp(deltaY * 0.00115),
    PREVIEW_CAMERA_LIMITS.minDistance,
    PREVIEW_CAMERA_LIMITS.maxDistance,
  );
  return camera;
}

export function applyPinchZoom(camera, previousSpan, nextSpan) {
  if (!(previousSpan > 0) || !(nextSpan > 0)) return camera;
  camera.distance = clamp(
    camera.distance * (previousSpan / nextSpan),
    PREVIEW_CAMERA_LIMITS.minDistance,
    PREVIEW_CAMERA_LIMITS.maxDistance,
  );
  return camera;
}

export function applyPanDelta(camera, dx, dy) {
  const metresPerPixel = clamp(camera.distance * 0.00105, 0.04, 3.2);
  const rightX = Math.cos(camera.yaw);
  const rightZ = -Math.sin(camera.yaw);
  const forwardX = Math.sin(camera.yaw);
  const forwardZ = Math.cos(camera.yaw);

  // Dragging the scene right moves the orbit target left; dragging down moves it forward.
  camera.target[0] += (-dx * rightX + dy * forwardX) * metresPerPixel;
  camera.target[2] += (-dx * rightZ + dy * forwardZ) * metresPerPixel;
  return camera;
}

function centroid(points) {
  const values = [...points.values()];
  if (values.length === 0) return null;
  const x = values.reduce((sum, point) => sum + point.x, 0) / values.length;
  const y = values.reduce((sum, point) => sum + point.y, 0) / values.length;
  return { x, y };
}

function firstTwo(points) {
  const values = [...points.values()];
  if (values.length < 2) return null;
  return [values[0], values[1]];
}

function span(points) {
  const pair = firstTwo(points);
  if (!pair) return 0;
  return Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
}

export function installPreviewCameraControls(canvas, camera, onChange, { resetCamera } = {}) {
  const pointers = new Map();
  let mode = 'idle';
  let lastSingle = null;
  let lastCentroid = null;
  let lastSpan = 0;

  const resetGestureBaseline = () => {
    if (pointers.size >= 2) {
      mode = 'pinch-pan';
      lastCentroid = centroid(pointers);
      lastSpan = span(pointers);
      lastSingle = null;
    } else if (pointers.size === 1) {
      mode = 'orbit';
      lastSingle = [...pointers.values()][0];
      lastCentroid = null;
      lastSpan = 0;
    } else {
      mode = 'idle';
      lastSingle = null;
      lastCentroid = null;
      lastSpan = 0;
    }
  };

  const pointerDown = (event) => {
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType, button: event.button });
    canvas.setPointerCapture?.(event.pointerId);
    resetGestureBaseline();
  };

  const pointerMove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType, button: event.button });

    if (pointers.size >= 2) {
      const nextCentroid = centroid(pointers);
      const nextSpan = span(pointers);
      if (mode !== 'pinch-pan' || !lastCentroid || !(lastSpan > 0)) {
        resetGestureBaseline();
        return;
      }
      applyPinchZoom(camera, lastSpan, nextSpan);
      applyPanDelta(camera, nextCentroid.x - lastCentroid.x, nextCentroid.y - lastCentroid.y);
      lastCentroid = nextCentroid;
      lastSpan = nextSpan;
      onChange();
      return;
    }

    const point = [...pointers.values()][0];
    if (!point) return;
    if (mode !== 'orbit' || !lastSingle) {
      resetGestureBaseline();
      return;
    }
    const dx = point.x - lastSingle.x;
    const dy = point.y - lastSingle.y;
    lastSingle = point;

    const wantsPan = event.shiftKey || event.buttons === 4 || event.button === 1 || event.buttons === 2;
    if (wantsPan) applyPanDelta(camera, dx, dy);
    else applyOrbitDelta(camera, dx, dy);
    onChange();
  };

  const pointerUp = (event) => {
    event.preventDefault();
    pointers.delete(event.pointerId);
    canvas.releasePointerCapture?.(event.pointerId);
    resetGestureBaseline();
  };

  const wheel = (event) => {
    event.preventDefault();
    applyWheelZoom(camera, event.deltaY);
    onChange();
  };

  const doubleClick = (event) => {
    event.preventDefault();
    if (typeof resetCamera === 'function') resetCamera();
    onChange();
  };

  const contextMenu = (event) => event.preventDefault();

  canvas.addEventListener('pointerdown', pointerDown, { passive: false });
  canvas.addEventListener('pointermove', pointerMove, { passive: false });
  canvas.addEventListener('pointerup', pointerUp, { passive: false });
  canvas.addEventListener('pointercancel', pointerUp, { passive: false });
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('dblclick', doubleClick);
  canvas.addEventListener('contextmenu', contextMenu);

  return () => {
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('dblclick', doubleClick);
    canvas.removeEventListener('contextmenu', contextMenu);
  };
}
