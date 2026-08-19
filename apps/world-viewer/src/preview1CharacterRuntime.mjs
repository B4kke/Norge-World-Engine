import { createPreview1CharacterWorldController } from './preview1CharacterWorldController.mjs';

function assertRendererAdapter(renderer) {
  for (const method of ['setCharacterRenderPose', 'setCharacterAnimationState']) {
    if (typeof renderer?.[method] !== 'function') {
      throw new TypeError(`PREVIEW1_CHARACTER_RENDERER_${method.toUpperCase()}_REQUIRED`);
    }
  }
  return renderer;
}

export function createPreview1CharacterRuntime({
  terrainPayload,
  renderer,
  controller = createPreview1CharacterWorldController({ terrainPayload }),
} = {}) {
  const adapter = assertRendererAdapter(renderer);
  let lastSnapshot = controller.snapshot();
  let moving = false;

  function applySnapshot(snapshot) {
    lastSnapshot = snapshot;
    adapter.setCharacterRenderPose(snapshot.threePose);
    return snapshot;
  }

  function setMoving(nextMoving) {
    const next = nextMoving === true;
    if (moving === next) return;
    moving = next;
    adapter.setCharacterAnimationState(moving ? 'walk' : 'idle');
  }

  applySnapshot(lastSnapshot);
  adapter.setCharacterAnimationState('idle', { fadeSeconds: 0 });

  return {
    schema: 'nwe.preview1-character-runtime/0.1',
    controller,
    snapshot() {
      return Object.freeze({
        schema: 'nwe.preview1-character-runtime-state/0.1',
        moving,
        character: lastSnapshot,
      });
    },
    setHeading(headingRadians) {
      return applySnapshot(controller.setHeading(headingRadians));
    },
    move({ forwardMeters = 0, rightMeters = 0 } = {}) {
      const hasMovement = Number(forwardMeters) !== 0 || Number(rightMeters) !== 0;
      setMoving(hasMovement);
      const snapshot = applySnapshot(controller.move({ forwardMeters, rightMeters }));
      return snapshot;
    },
    stop() {
      setMoving(false);
      return this.snapshot();
    },
  };
}
