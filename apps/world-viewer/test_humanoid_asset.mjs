import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createLicensedHumanoid, KAYKIT_KNIGHT_ASSET, resolveHumanoidClips } from './src/humanoidAsset.mjs';

assert.equal(KAYKIT_KNIGHT_ASSET.license, 'CC0-1.0');
assert.equal(KAYKIT_KNIGHT_ASSET.source_commit, '672074b73ba276876a19e8816ecdc5241817ab47');
assert.equal(KAYKIT_KNIGHT_ASSET.source_git_blob_sha1, '717b56ca2b5ff5392679774725201ba03a3eefab');
assert.equal(KAYKIT_KNIGHT_ASSET.source_byte_size, 3659532);
assert.ok(KAYKIT_KNIGHT_ASSET.url.includes(KAYKIT_KNIGHT_ASSET.source_commit), 'runtime proof URL must be commit-pinned');
assert.ok(!KAYKIT_KNIGHT_ASSET.url.includes('/main/'), 'unversioned upstream main URL is forbidden');
assert.equal(new URL(KAYKIT_KNIGHT_ASSET.url).origin, 'https://raw.githubusercontent.com');

const synthetic = [
  { name: 'Attack_A' },
  { name: 'Idle_A' },
  { name: 'Walking_A' },
];
const resolved = resolveHumanoidClips(synthetic);
assert.equal(resolved.idle.name, 'Idle_A');
assert.equal(resolved.walk.name, 'Walking_A');
assert.throws(() => resolveHumanoidClips([{ name: 'Walking_A' }]), /HUMANOID_IDLE_CLIP_MISSING/);
assert.throws(() => resolveHumanoidClips([{ name: 'Idle_A' }]), /HUMANOID_WALK_CLIP_MISSING/);

const scene = new THREE.Scene();
const root = new THREE.Group();
root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
const fakeLoader = {
  async loadAsync() {
    return {
      scene: root,
      animations: [
        new THREE.AnimationClip('Idle_A', 1, []),
        new THREE.AnimationClip('Walking_A', 1, []),
      ],
    };
  },
};
const runtimeHumanoid = await createLicensedHumanoid({ scene, loader: fakeLoader, targetHeightM: 1.75 });
const pose = Object.freeze({
  entityId: 'player-1',
  worldFrameId: 'frame-1',
  originSeriesId: 'origin-1',
  originEpoch: 3,
  position: new Float32Array([12, 4.5, -8]),
  headingRadians: Math.PI / 2,
});
const poseState = runtimeHumanoid.setRenderPose(pose);
assert.deepEqual([root.position.x, root.position.y, root.position.z], [12, 4.5, -8]);
assert.ok(Math.abs(root.rotation.y - Math.PI / 2) < 1e-12, 'heading π/2 must rotate calibrated Knight toward Three +X/east');
assert.equal(poseState.render_pose.entity_id, 'player-1');
assert.equal(poseState.render_pose.origin_epoch, 3);
assert.deepEqual(poseState.render_pose.position, [12, 4.5, -8]);
assert.throws(() => runtimeHumanoid.setRenderPose({ position: new Float64Array(3), headingRadians: 0 }), /HUMANOID_RENDER_POSE_POSITION_REQUIRED/);
runtimeHumanoid.dispose();

const humanoid = readFileSync(new URL('./src/humanoidAsset.mjs', import.meta.url), 'utf8');
assert.match(humanoid, /HUMANOID_ANIMATION_STATE_PROBE_FAILED/, 'runtime loader must fail closed if idle/walk/idle state transition fails');
assert.match(humanoid, /commit-pinned-renderer-asset/, 'renderer asset network dependency must be explicit');
assert.match(humanoid, /animation_state_probe/, 'runtime character snapshot must expose the animation state probe');
assert.match(humanoid, /setRenderPose/, 'humanoid must expose a renderer-only pose sink');

const renderer = readFileSync(new URL('./src/threeGroundRenderer.mjs', import.meta.url), 'utf8');
assert.match(renderer, /createLicensedHumanoid/, 'normal Three ground renderer must load the licensed humanoid');
assert.match(renderer, /setCharacterAnimationState/, 'renderer adapter must expose animation state change');
assert.match(renderer, /getCharacterState/, 'renderer adapter must expose renderer-local character state');
assert.match(renderer, /renderer_only_spawn:\s*true|characterSnapshot/, 'character renderer state must remain presentation-only');
assert.match(renderer, /humanoid\.update\(deltaSeconds\)/, 'animation mixer must advance on the renderer animation loop');

console.log('HUMANOID_ASSET_CONTRACT_PASS');
