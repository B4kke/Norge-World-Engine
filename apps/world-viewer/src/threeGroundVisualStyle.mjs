import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  WEATHER_PRESET_IDS,
  daylightFactor,
  renderSunDirection,
  resolveWeatherPreset,
  resolveWeatherPresetFromSearch,
  solarPositionForDate,
} from './threeWeatherModel.mjs';

export const GROUND_VISUAL_STYLE = Object.freeze({
  schema: 'nwe.ground-visual-style/0.4',
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
  shadowFarM: 320,
  shadowBias: -0.00015,
  shadowNormalBias: 0.035,
  shadowIntensity: 0.82,
  shadowAnchorUpdateDistanceM: 8,
  hemisphereIntensity: 1.2,
  sunIntensity: 3,
  sunColor: 0xffefcf,
  hemisphereSkyColor: 0xdcefff,
  hemisphereGroundColor: 0x4b5544,
  sunDistanceM: 180,
  sunTargetHeightM: 1,
  solarUpdateIntervalMs: 30000,
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
      : 2160,
  });
}

function finitePosition(position) {
  if (!Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(value))) {
    throw new TypeError('visual anchor must be a finite [x,y,z] position');
  }
  return position.map(Number);
}

function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

function editableTarget(target) {
  const tagName = String(target?.tagName ?? '').toLowerCase();
  return Boolean(target?.isContentEditable) || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function applySkyWeather(sky, preset, sunDirection) {
  sky.sunPosition.value.set(...sunDirection);
  sky.turbidity.value = preset.turbidity;
  sky.rayleigh.value = preset.rayleigh;
  sky.mieCoefficient.value = preset.mieCoefficient;
  sky.mieDirectionalG.value = preset.mieDirectionalG;
  sky.cloudCoverage.value = preset.cloudCoverage;
  sky.cloudDensity.value = preset.cloudDensity;
  sky.cloudElevation.value = preset.cloudElevation;
  sky.cloudScale.value = preset.cloudScale;
  sky.cloudSpeed.value = preset.cloudSpeed;
  sky.showSunDisc.value = 1;
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

const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

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

export function createGroundEnvironment(renderer, scene, style, atmosphere = {}) {
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
  const preset = atmosphere.weather ?? resolveWeatherPreset('partly-cloudy');
  const sunDirection = atmosphere.sunDirection ?? [0.4, 0.75, 0.5];
  applySkyWeather(environment, preset, sunDirection);
  environment.showSunDisc.value = 0;
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

function rainBudget(profile) {
  if (profile?.id === 'ultra') return 1400;
  if (profile?.id === 'high') return 900;
  if (profile?.id === 'low') return 260;
  return 560;
}

function deterministic01(index, salt) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createRainLayer(scene, profile) {
  const count = rainBudget(profile);
  const positions = new Float32Array(count * 3);
  const fallSpeeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    positions[o] = (deterministic01(i, 1) - 0.5) * 56;
    positions[o + 1] = -8 + deterministic01(i, 2) * 54;
    positions[o + 2] = (deterministic01(i, 3) - 0.5) * 56;
    fallSpeeds[i] = 17 + deterministic01(i, 4) * 15;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xc4dceb,
    size: profile?.id === 'low' ? 0.07 : 0.085,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    sizeAttenuation: true,
    fog: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);
  let lastAt = 0;

  return {
    count,
    update(camera, now, preset) {
      if (!(preset?.rainRate > 0)) {
        points.visible = false;
        lastAt = Number(now) || 0;
        return;
      }
      points.visible = true;
      points.position.copy(camera.position);
      const current = Number(now) || 0;
      const dt = lastAt ? Math.max(0, Math.min(0.05, (current - lastAt) / 1000)) : 0;
      lastAt = current;
      if (dt === 0) return;
      const windRadians = Number(preset.windDirectionDeg) * Math.PI / 180;
      const windEast = Math.sin(windRadians) * Number(preset.windSpeedMps) * 0.16;
      const windNorth = Math.cos(windRadians) * Number(preset.windSpeedMps) * 0.16;
      for (let i = 0; i < count; i += 1) {
        const o = i * 3;
        positions[o] += windEast * dt;
        positions[o + 1] -= fallSpeeds[i] * Number(preset.rainRate) * dt;
        positions[o + 2] -= windNorth * dt;
        if (positions[o + 1] < -10) {
          positions[o] = (deterministic01(i + Math.floor(current / 1000), 5) - 0.5) * 56;
          positions[o + 1] = 38 + deterministic01(i, 6) * 18;
          positions[o + 2] = (deterministic01(i + Math.floor(current / 1000), 7) - 0.5) * 56;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}

function installWeatherOverlay(renderer, currentPreset, onPreset) {
  const documentRef = globalThis.document;
  const canvas = renderer?.domElement;
  const parent = canvas?.parentElement ?? documentRef?.body;
  if (!documentRef?.createElement || !parent) return { setPreset() {}, dispose() {} };
  const label = documentRef.createElement('label');
  label.dataset.weatherControls = 'true';
  Object.assign(label.style, {
    position: parent === documentRef.body ? 'fixed' : 'absolute',
    right: 'max(12px, env(safe-area-inset-right))',
    bottom: '66px',
    zIndex: '34',
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '7px 9px', borderRadius: '11px',
    border: '1px solid rgba(255,255,255,.24)', background: 'rgba(8,17,21,.72)', color: '#fff',
    font: '600 11px/1 system-ui, sans-serif', backdropFilter: 'blur(8px)',
  });
  const text = documentRef.createElement('span');
  text.textContent = 'Vær · V';
  const select = documentRef.createElement('select');
  select.setAttribute('aria-label', 'Vær');
  Object.assign(select.style, { color: '#fff', background: '#142229', border: '0', borderRadius: '7px', padding: '5px 6px', font: '600 12px/1 system-ui, sans-serif' });
  for (const id of WEATHER_PRESET_IDS) {
    const option = documentRef.createElement('option');
    const preset = resolveWeatherPreset(id);
    option.value = id; option.textContent = preset.label;
    select.append(option);
  }
  select.value = currentPreset.id;
  const change = () => onPreset(select.value);
  select.addEventListener('change', change);
  label.append(text, select);
  parent.append(label);
  return {
    setPreset(id) { select.value = id; },
    dispose() { select.removeEventListener('change', change); label.remove(); },
  };
}

export function createGroundLighting(scene, profile, options = {}) {
  if (!scene?.add) throw new TypeError('scene is required');
  const style = resolveGroundVisualStyle(profile);
  const initialWeather = resolveWeatherPresetFromSearch(globalThis.location?.search ?? '');
  let currentWeather = initialWeather;
  let currentSolar = solarPositionForDate(new Date());
  let currentSunDirection = renderSunDirection(currentSolar);
  let lastSolarUpdateAt = 0;
  const environmentIntensity = style.environmentIntensity;
  const environment = createGroundEnvironment(options.renderer, scene, style, { weather: currentWeather, sunDirection: currentSunDirection });

  scene.background = new THREE.Color(currentWeather.skyColor);
  const sky = new SkyMesh();
  sky.scale.setScalar((profile?.cameraFarM ?? 2400) * 0.9);
  applySkyWeather(sky, currentWeather, currentSunDirection);
  sky.material.depthWrite = false;
  sky.material.fog = false;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(currentWeather.fogColor, style.fogNearM, style.fogFarM);

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

  const rain = createRainLayer(scene, profile);
  let requestedAnchor = Object.freeze([0, 0, 0]);
  let shadowAnchor = null;
  let shadowUpdates = 0;
  let weatherChanges = 0;

  const highSunColor = new THREE.Color(style.sunColor);
  const horizonSunColor = new THREE.Color(0xffa15b);
  const baseHemisphereSky = new THREE.Color(style.hemisphereSkyColor);
  const baseHemisphereGround = new THREE.Color(style.hemisphereGroundColor);

  function updateAtmosphereLighting() {
    const daylight = daylightFactor(currentSolar.altitude_deg);
    const warmth = clamp01((currentSolar.altitude_deg + 2) / 28);
    sun.intensity = style.sunIntensity * currentWeather.sunIntensityScale * daylight;
    sun.color.copy(horizonSunColor).lerp(highSunColor, warmth);
    const ambientDaylight = 0.08 + daylight * 0.92;
    hemisphere.intensity = Math.max(0, style.hemisphereIntensity * environment.hemisphereFillScale * currentWeather.hemisphereScale * ambientDaylight);
    hemisphere.color.copy(baseHemisphereSky).multiplyScalar(0.18 + daylight * 0.82);
    hemisphere.groundColor.copy(baseHemisphereGround).multiplyScalar(0.16 + daylight * 0.84);
    const fogColor = new THREE.Color(currentWeather.fogColor).multiplyScalar(0.16 + daylight * 0.84);
    scene.background = new THREE.Color(currentWeather.skyColor).multiplyScalar(0.18 + daylight * 0.82);
    scene.fog.color.copy(fogColor);
    scene.fog.near = Math.max(2, style.fogNearM * currentWeather.fogNearScale);
    scene.fog.far = Math.max(scene.fog.near + 25, style.fogFarM * currentWeather.fogFarScale);
    scene.environmentIntensity = environmentIntensity * currentWeather.environmentScale * (0.12 + daylight * 0.88);
    applySkyWeather(sky, currentWeather, currentSunDirection);
  }

  function applyShadowAnchor(anchor, force = false) {
    const [x, y, z] = anchor;
    shadowAnchor = Object.freeze([x, y, z]);
    sunTarget.position.set(x, y + style.sunTargetHeightM, z);
    sun.position.set(
      x + currentSunDirection[0] * style.sunDistanceM,
      y + style.sunTargetHeightM + currentSunDirection[1] * style.sunDistanceM,
      z + currentSunDirection[2] * style.sunDistanceM,
    );
    sunTarget.updateMatrixWorld();
    sun.updateMatrixWorld();
    if (force || sun.intensity > 0.001) sun.shadow.needsUpdate = true;
    shadowUpdates += 1;
  }

  function updateSolar(nowMs = Date.now(), force = false) {
    const now = Number(nowMs) || Date.now();
    if (!force && lastSolarUpdateAt && now - lastSolarUpdateAt < style.solarUpdateIntervalMs) return false;
    lastSolarUpdateAt = now;
    currentSolar = solarPositionForDate(new Date(now));
    currentSunDirection = renderSunDirection(currentSolar);
    updateAtmosphereLighting();
    if (shadowAnchor) applyShadowAnchor(shadowAnchor, true);
    return true;
  }

  function setWeatherPreset(id) {
    const resolved = resolveWeatherPreset(id);
    if (currentWeather.id !== resolved.id) weatherChanges += 1;
    currentWeather = resolved;
    updateAtmosphereLighting();
    overlay.setPreset(currentWeather.id);
    if (shadowAnchor) applyShadowAnchor(shadowAnchor, true);
    return snapshot();
  }

  function cycleWeather() {
    const index = WEATHER_PRESET_IDS.indexOf(currentWeather.id);
    return setWeatherPreset(WEATHER_PRESET_IDS[(index + 1) % WEATHER_PRESET_IDS.length]);
  }

  function updateAnchor(position) {
    requestedAnchor = Object.freeze(finitePosition(position));
    if (!shadowAnchor) {
      applyShadowAnchor(requestedAnchor);
      return snapshot();
    }
    const dx = requestedAnchor[0] - shadowAnchor[0];
    const dz = requestedAnchor[2] - shadowAnchor[2];
    if (Math.hypot(dx, dz) >= style.shadowAnchorUpdateDistanceM) applyShadowAnchor(requestedAnchor);
    return snapshot();
  }

  function snapshot() {
    const offset = shadowAnchor
      ? [sun.position.x - shadowAnchor[0], sun.position.y - shadowAnchor[1], sun.position.z - shadowAnchor[2]]
      : currentSunDirection.map((value) => value * style.sunDistanceM);
    return Object.freeze({
      schema: style.schema,
      graphics_profile: style.graphicsProfile,
      sky: Object.freeze({
        color: currentWeather.skyColor,
        fog_near_m: scene.fog.near,
        fog_far_m: scene.fog.far,
        cloud_coverage: currentWeather.cloudCoverage,
        cloud_density: currentWeather.cloudDensity,
        cloud_elevation: currentWeather.cloudElevation,
        cloud_speed: currentWeather.cloudSpeed,
      }),
      weather: Object.freeze({
        schema: 'nwe.renderer-weather/0.1',
        preset: currentWeather.id,
        label: currentWeather.label,
        wind_speed_mps: currentWeather.windSpeedMps,
        wind_direction_deg: currentWeather.windDirectionDeg,
        rain_rate: currentWeather.rainRate,
        rain_particle_budget: rain.count,
        changes: weatherChanges,
        source_semantics: 'presentation-only preset; no live meteorological data is claimed',
      }),
      sun: Object.freeze({
        type: 'astronomical-directional',
        intensity: sun.intensity,
        cast_shadow: sun.castShadow === true,
        requested_anchor: requestedAnchor,
        anchor: shadowAnchor ?? requestedAnchor,
        offset: Object.freeze(offset),
        direction: currentSunDirection,
        altitude_deg: currentSolar.altitude_deg,
        azimuth_deg: currentSolar.azimuth_deg,
        clock: 'live-browser-time',
      }),
      shadow: Object.freeze({
        strategy: 'camera-or-player-following-directional-frustum',
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
        intensity: scene.environmentIntensity ?? environmentIntensity,
        hemisphere_fill_scale: environment.hemisphereFillScale,
        capture_radius_m: style.environmentCaptureRadiusM,
        refresh: 'initial-capture; dynamic weather scales intensity without per-frame PMREM recapture',
      }),
    });
  }

  let overlay = { setPreset() {}, dispose() {} };
  overlay = installWeatherOverlay(options.renderer, currentWeather, setWeatherPreset);
  const weatherKey = (event) => {
    if (editableTarget(event.target) || event.code !== 'KeyV' || event.repeat) return;
    event.preventDefault();
    cycleWeather();
  };
  globalThis.window?.addEventListener?.('keydown', weatherKey);

  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.copy(camera.position);
    // Keep the bounded shadow frustum useful when the user detaches into free-fly.
    // Horizontal camera motion may move the shadow anchor, while requestedAnchor[1]
    // remains tied to the latest grounded world pose so a high bird camera does not
    // lift the shadow target away from the terrain.
    if (shadowAnchor && camera?.position) {
      const dx = camera.position.x - shadowAnchor[0];
      const dz = camera.position.z - shadowAnchor[2];
      if (Math.hypot(dx, dz) >= style.shadowAnchorUpdateDistanceM) {
        applyShadowAnchor([camera.position.x, requestedAnchor[1], camera.position.z]);
      }
    }
    const now = globalThis.performance?.now?.() ?? Date.now();
    rain.update(camera, now, currentWeather);
    updateSolar(Date.now(), false);
  };

  updateAtmosphereLighting();
  updateAnchor([0, 0, 0]);
  return {
    hemisphere,
    sun,
    sunTarget,
    sky,
    updateAnchor,
    updateSolar,
    setWeatherPreset,
    cycleWeather,
    snapshot,
    dispose() {
      globalThis.window?.removeEventListener?.('keydown', weatherKey);
      overlay.dispose();
      rain.dispose();
      scene.remove(hemisphere, sunTarget, sun, sky);
      sky.onBeforeRender = null;
      sky.geometry.dispose();
      sky.material.dispose();
      sun.dispose();
      hemisphere.dispose();
      environment.dispose();
    },
  };
}
