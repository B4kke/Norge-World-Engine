import assert from 'node:assert/strict';
import { runPreview1CharacterMovementProbe } from './src/preview1CharacterMovementProbe.mjs';

let moving = false;
let northing = 201;
let rendererState = 'idle';
let renderZ = 0;
const runtime = {
  snapshot() {
    return {
      moving,
      character: {
        grounding: { source: 'accepted-dtm-grid', verticalDatum: 'NN2000' },
        worldTransform: { headingRadians: 0, position: { easting: 101, northing, height: 55 } },
        threePose: { position: new Float32Array([0, 5, renderZ]) },
      },
    };
  },
  move({ forwardMeters }) {
    northing += forwardMeters;
    renderZ -= forwardMeters;
    moving = true;
    rendererState = 'walk';
    return this.snapshot().character;
  },
  stop() {
    moving = false;
    rendererState = 'idle';
    return this.snapshot();
  },
};
const renderer = {
  getCharacterState() {
    return { state: rendererState, render_pose: { position: [0, 5.02, renderZ] } };
  },
  getCameraState() {
    return { yaw: 0, pitch: 0.22, distance: 6.5, target: [0, 6.2, renderZ] };
  },
};
let frames = 0;
const proof = await runPreview1CharacterMovementProbe({ runtime, renderer, animationFrame: async () => { frames += 1; } });
assert.equal(proof.status, 'PASS');
assert.equal(proof.world_delta.planar_m, 1);
assert.equal(proof.world_delta.north_m, 1);
assert.equal(proof.walk_state_observed, 'walk');
assert.equal(proof.idle_state_observed_after_stop, 'idle');
assert.equal(proof.grounded_height_m, 55);
assert.equal(proof.renderer_pose_matches_derived, true);
assert.equal(proof.camera_follow.status, 'PASS');
assert.deepEqual(proof.camera_follow.target, [0, 6.2, -1]);
assert.equal(frames, 1);

await assert.rejects(
  runPreview1CharacterMovementProbe({
    runtime: {
      ...runtime,
      move() {
        moving = true;
        rendererState = 'walk';
        northing += 2;
        renderZ -= 2;
        return this.snapshot().character;
      },
    },
    renderer,
    animationFrame: async () => {},
  }),
  /CHARACTER_MOVEMENT_DISTANCE_FAILED/,
);

console.log('PREVIEW1_CHARACTER_MOVEMENT_PROBE_PASS');
