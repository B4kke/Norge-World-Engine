import * as THREE from 'three/webgpu';

export const GROUND_VISUAL_STYLE = Object.freeze({
  schema: 'nwe.ground-visual-style/0.2',
  toneMapping: 'ACESFilmicToneMapping',
  toneMappingExposure: 1.04,
  outputColorSpace: 'SRGBColorSpace',
  skyColor: 0xb5ccdc,
  fogNearM: 180,
  fogFarM: 1300,
  shadowType: 'BasicShadowMap',
  shadowMapSize: 1024,
  shadowHalfExtentM: 70,
  shadowNearM: 1,
  shadowFarM: 280,
  shadowBias: -0.00015,
  shadowNormalBias: 0.035,
  shadowIntensity: 0.82,
  shadowAnchorUpdateDistanceM: 8,
  hemisphereIntensity: 1.2,
  sunIntensity: 3,
  sunColor: 0xffefcf,
  hemisphereSkyColor: 0xdcefff,
  hemisphereGroundColor: 0x4b5544,
  sunOffset: Object.freeze([-72, 125, 52]),
  sunTargetHeightM: 1,
});

export function resolveGroundVisualStyle(profile = {}) {
  const filteredShadows = profile.shadowFilter === 'pcf';
  return Object.freeze({
    ...GROUND_VISUAL_STYLE,
    graphicsProfile: profile.id ?? 'balanced',
    toneMappingExposure: profile.toneMappingExposure ?? GROUND_VISUAL_STYLE.toneMappingExposure,
    fogNearM: profile.fogNearM ?? GROUND_VISUAL_STYLE.fogNearM,
    fogFarM: profile.fogFarM ?? GROUND_VISUAL_STYLE.fogFarM,
    shadowType: filteredShadows ? 'PCFShadowMap' : 'BasicShadowMap',
    shadowMapSize: profile.shadowMapSize ?? GROUND_VISUAL_STYLE.shadowMapSize,
    shadowHalfExtentM: profile.shadowHalfExtentM ?? GROUND_VISUAL_STYLE.shadowHalfExtentM,
    shadowAnchorUpdateDistanceM: profile.shadowAnchorUpdateDistanceM ?? GROUND_VISUAL_STYLE.shadowAnchorUpdateDistanceM,
    hemisphereIntensity: profile.hemisphereIntensity ?? GROUND_VISUAL_STYLE.hemisphereIntensity,
    sunIntensity: profile.sunIntensity ?? GROUND_VISUAL_STYLE.sunIntensity,
  });
}

function finitePosition(position) {
  if (!Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(value))) {
    throw new TypeError('visual anchor must be a finite [x,y,z] position');
  }
  return position.map(Number);
}

export function configureGroundRendererVisualStyle(renderer, profile) {
  if (!renderer?.shadowMap) throw new TypeError('renderer with shadowMap is required');
  const style = resolveGroundVisualStyle(profile);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = style.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = style.shadowType === 'PCFShadowMap'
    ? THREE.PCFShadowMap
    : THREE.BasicShadowMap;
  return Object.freeze({
    schema: style.schema,
    graphics_profile: style.graphicsProfile,
    tone_mapping: style.toneMapping,
    tone_mapping_exposure: renderer.toneMappingExposure,
    output_color_space: style.outputColorSpace,
    shadows_enabled: renderer.shadowMap.enabled === true,
    shadow_filter: style.shadowType,
  });
}

export function configureMeshShadowRole(mesh, { cast = false, receive = false } = {}) {
  if (!mesh) throw new TypeError('mesh is required');
  mesh.castShadow = cast === true;
  mesh.receiveShadow = receive === true;
  return mesh;
}

export function configureObjectShadowRole(root, options) {
  if (!root?.traverse) throw new TypeError('shadow root is required');
  let meshCount = 0;
  root.traverse((object) => {
    if (!object?.isMesh) return;
    configureMeshShadowRole(object, options);
    meshCount += 1;
  });
  return meshCount;
}

export function createGroundLighting(scene, profile) {
  if (!scene?.add) throw new TypeError('scene is required');
  const style = resolveGroundVisualStyle(profile);
  scene.background = new THREE.Color(style.skyColor);
  scene.fog = new THREE.Fog(style.skyColor, style.fogNearM, style.fogFarM);

  const hemisphere = new THREE.HemisphereLight(
    style.hemisphereSkyColor,
    style.hemisphereGroundColor,
    style.hemisphereIntensity,
  );
  const sunTarget = new THREE.Object3D();
  const sun = new THREE.DirectionalLight(style.sunColor, style.sunIntensity);
  sun.castShadow = true;
  sun.target = sunTarget;
  sun.shadow.mapSize.set(style.shadowMapSize, style.shadowMapSize);
  sun.shadow.camera.left = -style.shadowHalfExtentM;
  sun.shadow.camera.right = style.shadowHalfExtentM;
  sun.shadow.camera.top = style.shadowHalfExtentM;
  sun.shadow.camera.bottom = -style.shadowHalfExtentM;
  sun.shadow.camera.near = style.shadowNearM;
  sun.shadow.camera.far = style.shadowFarM;
  sun.shadow.bias = style.shadowBias;
  sun.shadow.normalBias = style.shadowNormalBias;
  sun.shadow.intensity = style.shadowIntensity;
  sun.shadow.autoUpdate = false;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(hemisphere, sunTarget, sun);

  let requestedAnchor = Object.freeze([0, 0, 0]);
  let shadowAnchor = null;
  let shadowUpdates = 0;

  function applyShadowAnchor(anchor) {
    const [x, y, z] = anchor;
    shadowAnchor = Object.freeze([x, y, z]);
    sunTarget.position.set(x, y + style.sunTargetHeightM, z);
    sun.position.set(x + style.sunOffset[0], y + style.sunOffset[1], z + style.sunOffset[2]);
    sunTarget.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.needsUpdate = true;
    shadowUpdates += 1;
  }

  function updateAnchor(position) {
    requestedAnchor = Object.freeze(finitePosition(position));
    if (!shadowAnchor) {
      applyShadowAnchor(requestedAnchor);
      return snapshot();
    }
    const dx = requestedAnchor[0] - shadowAnchor[0];
    const dz = requestedAnchor[2] - shadowAnchor[2];
    if (Math.hypot(dx, dz) >= style.shadowAnchorUpdateDistanceM) {
      applyShadowAnchor(requestedAnchor);
    }
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      schema: style.schema,
      graphics_profile: style.graphicsProfile,
      sky: Object.freeze({ color: style.skyColor, fog_near_m: style.fogNearM, fog_far_m: style.fogFarM }),
      sun: Object.freeze({
        type: 'directional',
        intensity: sun.intensity,
        cast_shadow: sun.castShadow === true,
        requested_anchor: requestedAnchor,
        anchor: shadowAnchor ?? requestedAnchor,
        offset: style.sunOffset,
      }),
      shadow: Object.freeze({
        strategy: 'single-player-following-directional-frustum',
        filter: style.shadowType,
        map_size: style.shadowMapSize,
        half_extent_m: style.shadowHalfExtentM,
        near_m: style.shadowNearM,
        far_m: style.shadowFarM,
        bias: style.shadowBias,
        normal_bias: style.shadowNormalBias,
        intensity: style.shadowIntensity,
        auto_update: sun.shadow.autoUpdate !== false,
        update_distance_m: style.shadowAnchorUpdateDistanceM,
        update_count: shadowUpdates,
      }),
    });
  }

  updateAnchor([0, 0, 0]);
  return {
    hemisphere,
    sun,
    sunTarget,
    updateAnchor,
    snapshot,
    dispose() {
      scene.remove(hemisphere, sunTarget, sun);
      sun.dispose();
      hemisphere.dispose();
    },
  };
}
