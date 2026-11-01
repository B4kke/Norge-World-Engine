import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { resolveGraphicsProfile } from './src/graphicsProfiles.mjs';
import {
  GROUND_VISUAL_STYLE,
  configureGroundRendererVisualStyle,
  configureMeshShadowRole,
  configureObjectShadowRole,
  createGroundEnvironment,
  createGroundLighting,
  detectSoftwareRenderer,
} from './src/threeGroundVisualStyle.mjs';

const renderer = {
  shadowMap: { enabled: false, type: null },
  outputColorSpace: null,
  toneMapping: null,
  toneMappingExposure: null,
};
const rendererStyle = configureGroundRendererVisualStyle(renderer);
assert.equal(renderer.shadowMap.enabled, true);
assert.equal(renderer.shadowMap.type, THREE.BasicShadowMap);
assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
assert.equal(renderer.toneMappingExposure, 1.04);
assert.equal(rendererStyle.shadows_enabled, true);
assert.equal(rendererStyle.shadow_filter, 'BasicShadowMap');
assert.equal(rendererStyle.schema, 'nwe.ground-visual-style/0.4');

const highRenderer = { shadowMap: { enabled: false, type: null } };
const high = resolveGraphicsProfile('high');
const highRendererStyle = configureGroundRendererVisualStyle(highRenderer, high);
assert.equal(highRenderer.shadowMap.type, THREE.PCFShadowMap);
assert.equal(highRenderer.toneMappingExposure, 1.08);
assert.equal(highRendererStyle.shadow_filter, 'PCFShadowMap');

const scene = new THREE.Scene();
const lighting = createGroundLighting(scene);
assert.equal(lighting.sun.castShadow, true);
assert.equal(lighting.sun.shadow.mapSize.x, 1024);
assert.equal(lighting.sun.shadow.mapSize.y, 1024);
assert.equal(lighting.sun.shadow.camera.left, -70);
assert.equal(lighting.sun.shadow.camera.right, 70);
assert.equal(lighting.sun.shadow.camera.top, 70);
assert.equal(lighting.sun.shadow.camera.bottom, -70);
assert.equal(lighting.sun.shadow.autoUpdate, false);
assert.equal(lighting.snapshot().shadow.strategy, 'camera-or-player-following-directional-frustum');
assert.equal(lighting.snapshot().shadow.filter, 'BasicShadowMap');
assert.equal(lighting.snapshot().shadow.update_distance_m, 8);
assert.equal(lighting.snapshot().shadow.update_count, 1);
assert.equal(lighting.snapshot().weather.preset, 'partly-cloudy');
assert.equal(lighting.snapshot().weather.source_semantics, 'presentation-only preset; no live meteorological data is claimed');
assert.equal(lighting.snapshot().sky.cloud_coverage, 0.42);
assert.equal(lighting.sky.cloudCoverage.value, 0.42);
assert.equal(scene.fog.near, GROUND_VISUAL_STYLE.fogNearM);
assert.equal(scene.fog.far, GROUND_VISUAL_STYLE.fogFarM);

const highScene = new THREE.Scene();
const highLighting = createGroundLighting(highScene, high);
assert.equal(highLighting.sun.shadow.mapSize.x, 2048);
assert.equal(highLighting.sun.shadow.camera.left, -85);
assert.equal(highLighting.snapshot().shadow.update_distance_m, 5);
assert.equal(highScene.fog.far, 1800);

const smallMove = lighting.updateAnchor([4, 6, -3]);
assert.deepEqual(smallMove.sun.requested_anchor, [4, 6, -3]);
assert.deepEqual(smallMove.sun.anchor, [0, 0, 0], 'sub-threshold player movement must reuse the current shadow map');
assert.equal(smallMove.shadow.update_count, 1);
assert.deepEqual(lighting.sunTarget.position.toArray(), [0, 1, 0]);

const movedLighting = lighting.updateAnchor([25, 6, -40]);
assert.deepEqual(movedLighting.sun.anchor, [25, 6, -40]);
assert.equal(movedLighting.shadow.update_count, 2);
assert.equal(lighting.sun.shadow.needsUpdate, true);
assert.deepEqual(lighting.sunTarget.position.toArray(), [25, 7, -40]);
const sunOffset = movedLighting.sun.offset;
assert.ok(Math.abs(Math.hypot(...sunOffset) - GROUND_VISUAL_STYLE.sunDistanceM) < 2, 'directional sun anchor offset must stay bounded around the configured solar distance');

const summer = lighting.updateSolar(Date.parse('2026-06-21T11:00:00Z'), true);
assert.equal(summer, true);
const summerSnapshot = lighting.snapshot();
assert.ok(summerSnapshot.sun.altitude_deg > 45);
assert.ok(summerSnapshot.sun.intensity > 0);
assert.equal(summerSnapshot.sun.clock, 'live-browser-time');
assert.equal(lighting.sky.sunPosition.value.y > 0.7, true);

const clear = lighting.setWeatherPreset('clear');
assert.equal(clear.weather.preset, 'clear');
assert.equal(clear.sky.cloud_coverage, 0.08);
assert.ok(scene.fog.far > GROUND_VISUAL_STYLE.fogFarM);
const rain = lighting.setWeatherPreset('rain');
assert.equal(rain.weather.preset, 'rain');
assert.equal(rain.weather.rain_rate, 1);
assert.ok(rain.weather.rain_particle_budget > 0);
assert.ok(scene.fog.far < GROUND_VISUAL_STYLE.fogFarM);
assert.equal(lighting.sky.cloudCoverage.value, 0.97);

// The shadow window must follow a detached bird camera horizontally while
// retaining the latest grounded anchor height. Bring the solar clock back to
// "now" first so this assertion measures only the camera-anchor transition,
// not a simultaneous scheduled solar refresh.
lighting.updateAnchor([10, 12, 20]);
lighting.updateSolar(Date.now(), true);
const beforeCameraShadow = lighting.snapshot().shadow.update_count;
lighting.sky.onBeforeRender(null, scene, { position: new THREE.Vector3(80, 140, -90) });
const afterCameraShadow = lighting.snapshot();
assert.deepEqual(afterCameraShadow.sun.anchor, [80, 12, -90]);
assert.equal(afterCameraShadow.shadow.update_count, beforeCameraShadow + 1);

const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
configureMeshShadowRole(mesh, { cast: true, receive: true });
assert.equal(mesh.castShadow, true);
assert.equal(mesh.receiveShadow, true);
const root = new THREE.Group();
root.add(mesh, new THREE.Object3D());
assert.equal(configureObjectShadowRole(root, { cast: true, receive: true }), 1);
assert.throws(() => lighting.updateAnchor([0, Number.NaN, 0]), /visual anchor/);

function stubContext(rendererName) {
  return {
    getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null; },
    getParameter(token) { return token === 37446 ? rendererName : null; },
  };
}
const software = detectSoftwareRenderer({ getContext: () => stubContext('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)))') });
assert.equal(software.software, true);
const hardware = detectSoftwareRenderer({ getContext: () => stubContext('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)') });
assert.equal(hardware.software, false);
const unknown = detectSoftwareRenderer({ getContext: () => null });
assert.equal(unknown.software, false);
assert.equal(unknown.renderer_name, null);
const contextless = detectSoftwareRenderer({});
assert.equal(contextless.software, false);

const softwareEnvironment = createGroundEnvironment(
  { getContext: () => stubContext('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))') },
  new THREE.Scene(),
  { ...GROUND_VISUAL_STYLE, environmentIntensity: 1, environmentCaptureRadiusM: 1200 },
);
assert.equal(softwareEnvironment.available, false);
assert.equal(softwareEnvironment.skip_reason, 'software-rasterizer');
assert.equal(softwareEnvironment.hemisphereFillScale, 1);
assert.equal(softwareEnvironment.texture, null);
softwareEnvironment.dispose();

const offEnvironment = createGroundEnvironment({}, new THREE.Scene(), { ...GROUND_VISUAL_STYLE, environmentIntensity: 0 });
assert.equal(offEnvironment.available, false);
assert.equal(offEnvironment.skip_reason, null);
assert.equal(highLighting.snapshot().environment.available, false);
assert.equal(highLighting.snapshot().environment.intensity > 0, true);

mesh.geometry.dispose();
mesh.material.dispose();
lighting.dispose();
highLighting.dispose();
console.log('THREE_GROUND_VISUAL_STYLE_PASS');
