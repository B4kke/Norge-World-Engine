import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const KAYKIT_KNIGHT_ASSET = Object.freeze({
  schema: 'nwe.render-asset/0.1',
  id: 'kaykit-adventurers-knight-1.0',
  creator: 'Kay Lousberg / KayKit',
  license: 'CC0-1.0',
  source_repository: 'KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0',
  source_commit: '672074b73ba276876a19e8816ecdc5241817ab47',
  source_path: 'addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb',
  source_git_blob_sha1: '717b56ca2b5ff5392679774725201ba03a3eefab',
  source_byte_size: 3659532,
  url: 'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/672074b73ba276876a19e8816ecdc5241817ab47/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb',
  license_url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/blob/672074b73ba276876a19e8816ecdc5241817ab47/LICENSE.txt',
});

const KAYKIT_MODEL_FORWARD_YAW_OFFSET = Math.PI;

function normalizedClipName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function resolveHumanoidClips(animations) {
  const clips = Array.isArray(animations) ? animations : [];
  const find = (patterns) => clips.find((clip) => patterns.some((pattern) => pattern.test(normalizedClipName(clip?.name))));
  const idle = find([/^idle(?:_|$)/, /(?:^|_)idle(?:_|$)/]);
  const walk = find([/^walk(?:ing)?(?:_|$)/, /(?:^|_)walk(?:ing)?(?:_|$)/]);
  if (!idle) throw new Error(`HUMANOID_IDLE_CLIP_MISSING: ${clips.map((clip) => clip?.name).join(',')}`);
  if (!walk) throw new Error(`HUMANOID_WALK_CLIP_MISSING: ${clips.map((clip) => clip?.name).join(',')}`);
  return { idle, walk };
}

function disposeObject(root) {
  root.traverse((object) => {
    if (!object?.isMesh) return;
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose?.();
      }
      material.dispose?.();
    }
  });
}

function assertRenderPose(pose) {
  if (!(pose?.position instanceof Float32Array) || pose.position.length !== 3) {
    throw new TypeError('HUMANOID_RENDER_POSE_POSITION_REQUIRED');
  }
  if (![...pose.position].every(Number.isFinite) || !Number.isFinite(pose.headingRadians)) {
    throw new TypeError('HUMANOID_RENDER_POSE_NON_FINITE');
  }
  return pose;
}

export async function createLicensedHumanoid({
  scene,
  asset = KAYKIT_KNIGHT_ASSET,
  position = [0, 0, 0],
  targetHeightM = 1.75,
  loader = new GLTFLoader(),
} = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('scene is required');
  if (!(Number.isFinite(targetHeightM) && targetHeightM > 0)) throw new RangeError('targetHeightM must be > 0');
  const gltf = await loader.loadAsync(asset.url);
  if (!gltf?.scene) throw new Error('HUMANOID_GLTF_SCENE_MISSING');
  const root = gltf.scene;
  const clips = resolveHumanoidClips(gltf.animations);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (!(Number.isFinite(size.y) && size.y > 0.01)) throw new Error(`HUMANOID_HEIGHT_INVALID: ${size.y}`);
  const scale = targetHeightM / size.y;
  root.scale.multiplyScalar(scale);
  root.position.set(Number(position[0]), Number(position[1]), Number(position[2]));
  root.rotation.y = KAYKIT_MODEL_FORWARD_YAW_OFFSET;

  let renderMeshCount = 0;
  root.traverse((object) => {
    if (!object?.isMesh) return;
    renderMeshCount += 1;
    object.frustumCulled = true;
  });
  if (renderMeshCount <= 0) throw new Error('HUMANOID_RENDER_MESH_MISSING');

  const mixer = new THREE.AnimationMixer(root);
  const actions = {
    idle: mixer.clipAction(clips.idle),
    walk: mixer.clipAction(clips.walk),
  };
  let state = 'idle';
  let animationStateProbe = null;
  let lastRenderPose = null;
  actions.idle.reset().play();
  scene.add(root);

  function setAnimationState(nextState, { fadeSeconds = 0.18 } = {}) {
    if (nextState !== 'idle' && nextState !== 'walk') throw new Error(`HUMANOID_ANIMATION_STATE_INVALID: ${nextState}`);
    if (state === nextState) return snapshot();
    const previous = actions[state];
    const next = actions[nextState];
    next.reset().play();
    if (fadeSeconds > 0) {
      previous.crossFadeTo(next, fadeSeconds, true);
    } else {
      previous.stop();
    }
    state = nextState;
    return snapshot();
  }

  function setRenderPose(pose) {
    const valid = assertRenderPose(pose);
    root.position.set(valid.position[0], valid.position[1], valid.position[2]);
    root.rotation.y = KAYKIT_MODEL_FORWARD_YAW_OFFSET - valid.headingRadians;
    lastRenderPose = Object.freeze({
      entity_id: valid.entityId ?? null,
      world_frame_id: valid.worldFrameId ?? null,
      origin_series_id: valid.originSeriesId ?? null,
      origin_epoch: valid.originEpoch ?? null,
      position: Object.freeze([...valid.position]),
      heading_radians: valid.headingRadians,
      model_forward_yaw_offset: KAYKIT_MODEL_FORWARD_YAW_OFFSET,
    });
    return snapshot();
  }

  function snapshot() {
    return {
      schema: 'nwe.humanoid-render-state/0.1',
      asset_id: asset.id,
      source_commit: asset.source_commit,
      source_git_blob_sha1: asset.source_git_blob_sha1,
      source_byte_size: asset.source_byte_size,
      license: asset.license,
      source_request_url: asset.url,
      source_request_origin: new URL(asset.url).origin,
      runtime_dependency: 'commit-pinned-renderer-asset',
      state,
      idle_clip: clips.idle.name,
      walk_clip: clips.walk.name,
      render_mesh_count: renderMeshCount,
      normalized_height_m: targetHeightM,
      renderer_only_spawn: true,
      animation_state_probe: animationStateProbe,
      render_pose: lastRenderPose,
    };
  }

  const initialState = state;
  const walkState = setAnimationState('walk', { fadeSeconds: 0 }).state;
  const returnedIdleState = setAnimationState('idle', { fadeSeconds: 0 }).state;
  if (initialState !== 'idle' || walkState !== 'walk' || returnedIdleState !== 'idle') {
    throw new Error(`HUMANOID_ANIMATION_STATE_PROBE_FAILED: ${initialState}->${walkState}->${returnedIdleState}`);
  }
  animationStateProbe = Object.freeze({
    schema: 'nwe.humanoid-animation-state-probe/0.1',
    status: 'PASS',
    states: Object.freeze([initialState, walkState, returnedIdleState]),
  });

  return {
    root,
    update(deltaSeconds) {
      if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) mixer.update(Math.min(deltaSeconds, 0.1));
    },
    setAnimationState,
    setRenderPose,
    snapshot,
    dispose() {
      mixer.stopAllAction();
      scene.remove(root);
      disposeObject(root);
    },
  };
}
