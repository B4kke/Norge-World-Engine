const FOLLOW_TARGET_HEIGHT_M = 1.2;

function finitePosition(transform, label) {
  const position = transform?.position;
  for (const key of ['easting', 'northing', 'height']) {
    if (!Number.isFinite(Number(position?.[key]))) throw new Error(`${label}.${key} must be finite`);
  }
  return position;
}

export async function runPreview1CharacterMovementProbe({ runtime, renderer, animationFrame = () => new Promise((resolve) => requestAnimationFrame(resolve)) } = {}) {
  if (!runtime?.snapshot || !runtime?.move || !runtime?.stop) throw new TypeError('character runtime is required');
  if (!renderer?.getCharacterState || !renderer?.getCameraState) throw new TypeError('character renderer state/camera is required');
  if (typeof animationFrame !== 'function') throw new TypeError('animationFrame is required');

  runtime.stop();
  const before = runtime.snapshot();
  const beforePosition = finitePosition(before.character?.worldTransform, 'before');
  const heading = Number(before.character?.worldTransform?.headingRadians);
  if (!Number.isFinite(heading)) throw new Error('before.headingRadians must be finite');

  runtime.move({ forwardMeters: 1 });
  const moved = runtime.snapshot();
  const movedPosition = finitePosition(moved.character?.worldTransform, 'moved');
  const walkRenderer = renderer.getCharacterState();
  const followCamera = renderer.getCameraState();
  if (moved.moving !== true || walkRenderer?.state !== 'walk') {
    throw new Error(`CHARACTER_MOVEMENT_WALK_STATE_FAILED: ${JSON.stringify({ moving: moved.moving, rendererState: walkRenderer?.state })}`);
  }
  await animationFrame();

  runtime.stop();
  const stopped = runtime.snapshot();
  const idleRenderer = renderer.getCharacterState();
  if (stopped.moving !== false || idleRenderer?.state !== 'idle') {
    throw new Error(`CHARACTER_MOVEMENT_IDLE_STATE_FAILED: ${JSON.stringify({ moving: stopped.moving, rendererState: idleRenderer?.state })}`);
  }

  const eastDelta = movedPosition.easting - beforePosition.easting;
  const northDelta = movedPosition.northing - beforePosition.northing;
  const planarDistance = Math.hypot(eastDelta, northDelta);
  const expectedEastDelta = Math.sin(heading);
  const expectedNorthDelta = Math.cos(heading);
  if (Math.abs(planarDistance - 1) > 1e-9
    || Math.abs(eastDelta - expectedEastDelta) > 1e-9
    || Math.abs(northDelta - expectedNorthDelta) > 1e-9) {
    throw new Error(`CHARACTER_MOVEMENT_DISTANCE_FAILED: ${JSON.stringify({ eastDelta, northDelta, planarDistance, heading })}`);
  }
  if (!Number.isFinite(movedPosition.height)) throw new Error('CHARACTER_MOVEMENT_GROUNDING_FAILED');

  const derivedPose = moved.character?.threePose;
  const renderedPose = walkRenderer?.render_pose;
  if (!derivedPose?.position || !renderedPose?.position) throw new Error('CHARACTER_MOVEMENT_RENDER_POSE_MISSING');
  const dx = Number(renderedPose.position[0]) - Number(derivedPose.position[0]);
  const dy = Number(renderedPose.position[1]) - Number(derivedPose.position[1]);
  const dz = Number(renderedPose.position[2]) - Number(derivedPose.position[2]);
  if (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5 || Math.abs(dy - 0.02) > 1e-5) {
    throw new Error(`CHARACTER_MOVEMENT_RENDER_POSE_DIVERGED: ${JSON.stringify({ derived: derivedPose.position, rendered: renderedPose.position })}`);
  }

  const cameraTarget = followCamera?.target;
  if (!Array.isArray(cameraTarget) || cameraTarget.length !== 3
    || Math.abs(Number(cameraTarget[0]) - Number(derivedPose.position[0])) > 1e-5
    || Math.abs(Number(cameraTarget[1]) - (Number(derivedPose.position[1]) + FOLLOW_TARGET_HEIGHT_M)) > 1e-5
    || Math.abs(Number(cameraTarget[2]) - Number(derivedPose.position[2])) > 1e-5) {
    throw new Error(`CHARACTER_MOVEMENT_CAMERA_FOLLOW_FAILED: ${JSON.stringify({ cameraTarget, derived: [...derivedPose.position] })}`);
  }

  return Object.freeze({
    schema: 'nwe.preview1-character-movement-probe/0.1',
    status: 'PASS',
    command: Object.freeze({ forward_m: 1, heading_radians: heading }),
    world_delta: Object.freeze({ east_m: eastDelta, north_m: northDelta, planar_m: planarDistance }),
    grounded_height_m: movedPosition.height,
    grounding: moved.character.grounding,
    walk_state_observed: walkRenderer.state,
    idle_state_observed_after_stop: idleRenderer.state,
    renderer_pose_matches_derived: true,
    presentation_ground_lift_m: 0.02,
    camera_follow: Object.freeze({ status: 'PASS', target: Object.freeze([...cameraTarget]), target_height_m: FOLLOW_TARGET_HEIGHT_M }),
  });
}
