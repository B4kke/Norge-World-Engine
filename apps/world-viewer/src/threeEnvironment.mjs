import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function createThreeEnvironment({ scene, renderer, environment } = {}) {
  if (!scene || !renderer || environment?.schema !== 'nwe.environment-state/0.1') {
    throw new TypeError('scene, renderer and normalized environment are required');
  }

  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;

  const cloud = clamp01(environment.cloud_fraction);
  const fog = clamp01(environment.fog_fraction);
  const precipitation = Math.max(0, Number(environment.precipitation_mm_per_hour) || 0);
  const humidity = clamp01(environment.humidity_fraction);
  const wetness = clamp01(environment.wetness);

  const hazeColor = new THREE.Color().setHSL(0.56, 0.18, 0.68 - cloud * 0.12);
  const fogDensity = 0.00035 + fog * 0.008 + precipitation * 0.00018 + Math.max(0, humidity - 0.86) * 0.0018;
  scene.background = hazeColor;
  scene.fog = new THREE.FogExp2(hazeColor, fogDensity);

  const sky = new SkyMesh();
  sky.scale.setScalar(10000);
  sky.turbidity.value = 3.5 + cloud * 5.5 + humidity * 1.8;
  sky.rayleigh.value = 1.5 + (1 - cloud) * 1.2;
  sky.mieCoefficient.value = 0.004 + humidity * 0.012;
  sky.mieDirectionalG.value = 0.82;
  sky.cloudCoverage.value = cloud;
  sky.cloudDensity.value = 0.12 + cloud * 0.55;
  sky.cloudElevation.value = 0.38 + cloud * 0.12;
  sky.cloudScale.value = 0.45;
  sky.cloudSpeed.value = Math.min(1.2, Math.max(0.03, environment.wind_speed_mps / 18));

  // First environment pass uses a stable daylight direction. Solar ephemeris becomes a separate input contract.
  const sunDirection = new THREE.Vector3(-0.46, 0.72, 0.52).normalize();
  sky.sunPosition.value.copy(sunDirection);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xdcecff, 0x43503b, 0.72 + (1 - cloud) * 0.42);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d3, 1.25 + (1 - cloud) * 2.1);
  sun.position.copy(sunDirection).multiplyScalar(420);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 850;
  sun.shadow.bias = -0.00012;
  scene.add(sun);

  return {
    sky,
    sun,
    hemi,
    wetness,
    stats: {
      schema: 'nwe.three-environment/0.1',
      source: environment.source,
      source_timestamp: environment.source_timestamp,
      cloud_fraction: cloud,
      fog_fraction: fog,
      precipitation_mm_per_hour: precipitation,
      wind_speed_mps: environment.wind_speed_mps,
      wetness,
      fog_density: fogDensity,
      tone_mapping: 'AgX',
      sky_model: 'Three SkyMesh / Preetham daylight',
      cloud_model: 'SkyMesh procedural cloud layer',
      shadow_map_size: 1024,
      solar_position: 'stable-preview-direction-not-ephemeris',
    },
    dispose() {
      scene.remove(sky, sun, hemi);
      sky.geometry?.dispose?.();
      sky.material?.dispose?.();
      sun.dispose?.();
      hemi.dispose?.();
    },
  };
}
