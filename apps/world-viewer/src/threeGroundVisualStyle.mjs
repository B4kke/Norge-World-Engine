import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

export const GROUND_VISUAL_STYLE = Object.freeze({
  schema: 'nwe.ground-visual-style/0.3',
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
  // Image-based lighting is generated once from the same physical sky that is
  // visible, so ambient/reflection light matches the visible atmosphere. The
  // hemisphere fill light is scaled down as environment intensity rises so the
  // two ambient contributions never double-light the accepted geometry.
  environmentIntensity: 0.75,
  environmentHemisphereFillScale: 0.55,
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

    environmentIntensity: typeof profile.environmentIntensity === 'number' && Number.isFinite(profile.environmentIntensity)
      ? Math.max(0, profile.environmentIntensity)
      : GROUND_VISUAL_STYLE.environmentIntensity,
    environmentCaptureRadiusM: typeof profile.cameraFarM === 'number' && Number.isFinite(profile.cameraFarM)
      ? Math.max(16, profile.cameraFarM * 0.9)
      : 2160,  });
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

/**
 * Builds the presentation-only image-based lighting environment from the same
 * physical sky parameters that drive the visible sky mesh. The captured cubemap
 * feeds `scene.environment` so accepted PBR geometry receives sky ambient and
 * environment reflections instead of a flat hemisphere approximation alone.
 */
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/**
 * Reports the unmasked rasterizer name when the backend exposes one. Software
 * rasterizers (headless CI, `device-evidence` capture without a GPU) cannot pay
 * for a one-time cubemap PMREM capture without stalling the first frame.
 */
export function detectSoftwareRenderer(renderer) {
  const context = typeof renderer?.getContext === 'function' ? renderer.getContext() : null;
  if (!context || typeof context.getExtension !== 'function' || typeof context.getParameter !== 'function') {
    return { software: false, renderer_name: null };
  }
  let name = null;
  try {
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    name = debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : null;
  } catch { name = null; }
  return { software: name === null ? false : SOFTWARE_RENDERER_PATTERN.test(name), renderer_name: name };
}

export function createGroundEnvironment(renderer, scene, style) {
  const environmentIntensity = style.environmentIntensity;
  const rasterizer = detectSoftwareRenderer(renderer);
  if (!renderer || !scene?.add || !(environmentIntensity > 0) || rasterizer.software) {
    return {
      available: false,
      skip_reason: environmentIntensity > 0 && rasterizer.software ? 'software-rasterizer' : null,
      renderer_name: rasterizer.renderer_name,
      texture: null,
      hemisphereFillScale: 1,
      dispose() {},
    };
  }
  const environment = new SkyMesh();
  environment.scale.setScalar(style.environmentCaptureRadiusM);
  environment.sunPosition.value.set(...style.sunOffset).normalize();
  environment.turbidity.value = 2;
  environment.rayleigh.value = 1.5;
  environment.material.depthWrite = false;
  environment.material.fog = false;
  environment.frustumCulled = false;
  const environmentScene = new THREE.Scene();
  environmentScene.add(environment);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let texture = null;
  try {
    texture = pmrem.fromScene(environmentScene, 0, 1, style.environmentCaptureRadiusM * 2).texture;
  } catch (error) {
    environmentScene.remove(environment);
    environment.geometry.dispose();
    environment.material.dispose();
    pmrem.dispose();
    throw new Error(`GROUND_ENVIRONMENT_CAPTURE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
  environmentScene.remove(environment);
  environment.geometry.dispose();
  environment.material.dispose();
  pmrem.dispose();
  scene.environment = texture;
  scene.environmentIntensity = environmentIntensity;
  return {
    available: true,
    skip_reason: null,
    renderer_name: rasterizer.renderer_name,
    texture,
    hemisphereFillScale: 1 - style.environmentHemisphereFillScale * Math.min(1, environmentIntensity),
    dispose() {
      if (scene.environment === texture) scene.environment = null;
      texture.dispose();
    },
  };
}

export function createGroundLighting(scene, profile, options = {}) {
  if (!scene?.add) throw new TypeError('scene is required');
  const style = resolveGroundVisualStyle(profile);
  const environmentIntensity = style.environmentIntensity;
  const environment = createGroundEnvironment(options.renderer, scene, style);
  scene.background = new THREE.Color(style.skyColor);
  const sky = new SkyMesh();
  sky.scale.setScalar((profile?.cameraFarM ?? 2400) * 0.9);
  sky.sunPosition.value.set(...style.sunOffset).normalize();
  sky.turbidity.value = 2;
  sky.rayleigh.value = 1.5;
  sky.material.depthWrite = false;
  sky.material.fog = false;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_renderer, _scene, camera) => sky.position.copy(camera.position);
  scene.add(sky);
  scene.fog = new THREE.Fog(style.skyColor, style.fogNearM, style.fogFarM);

  const hemisphere = new THREE.HemisphereLight(
    style.hemisphereSkyColor,
    style.hemisphereGroundColor,
    Math.max(0, style.hemisphereIntensity * environment.hemisphereFillScale),
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
      environment: Object.freeze({
        available: environment.available,
        skip_reason: environment.skip_reason ?? null,
        renderer_name: environment.renderer_name ?? null,
        intensity: environmentIntensity,
        hemisphere_fill_scale: environment.hemisphereFillScale,
        capture_radius_m: style.environmentCaptureRadiusM,
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
      scene.remove(hemisphere, sunTarget, sun, sky);
      sky.geometry.dispose();
      sky.material.dispose();
      sun.dispose();
      hemisphere.dispose();
      environment.dispose();
    },
  };
}
