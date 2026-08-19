import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  GROUND_VISUAL_STYLE,
  configureGroundRendererVisualStyle,
  configureMeshShadowRole,
  configureObjectShadowRole,
  createGroundLighting,
} from './src/threeGroundVisualStyle.mjs';

const renderer = {
  shadowMap: { enabled: false },
  outputColorSpace: null,
  toneMapping: null,
  toneMappingExposure: null,
};
const rendererStyle = configureGroundRendererVisualStyle(renderer);
assert.equal(renderer.shadowMap.enabled, true);
assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
assert.equal(renderer.toneMappingExposure, 1.05);
assert.equal(rendererStyle.shadows_enabled, true);

const scene = new THREE.Scene();
const lighting = createGroundLighting(scene);
assert.equal(lighting.sun.castShadow, true);
assert.equal(lighting.sun.shadow.mapSize.x, 1024);
assert.equal(lighting.sun.shadow.mapSize.y, 1024);
assert.equal(lighting.sun.shadow.camera.left, -70);
assert.equal(lighting.sun.shadow.camera.right, 70);
assert.equal(lighting.sun.shadow.camera.top, 70);
assert.equal(lighting.sun.shadow.camera.bottom, -70);
assert.equal(lighting.sun.shadow.autoUpdate, false, 'shadow map must not regenerate on every render');
assert.equal(lighting.snapshot().shadow.strategy, 'single-player-following-directional-frustum');
assert.equal(lighting.snapshot().shadow.update_distance_m, 8);
assert.equal(lighting.snapshot().shadow.update_count, 1, 'initial shadow anchor must request one shadow render');
assert.equal(scene.fog.near, GROUND_VISUAL_STYLE.fogNearM);
assert.equal(scene.fog.far, GROUND_VISUAL_STYLE.fogFarM);

const smallMove = lighting.updateAnchor([4, 6, -3]);
assert.deepEqual(smallMove.sun.requested_anchor, [4, 6, -3]);
assert.deepEqual(smallMove.sun.anchor, [0, 0, 0], 'sub-threshold movement must reuse the current shadow map');
assert.equal(smallMove.shadow.update_count, 1);
assert.deepEqual(lighting.sunTarget.position.toArray(), [0, 1, 0]);

const movedLighting = lighting.updateAnchor([25, 6, -40]);
assert.deepEqual(movedLighting.sun.anchor, [25, 6, -40]);
assert.equal(movedLighting.shadow.update_count, 2);
assert.equal(lighting.sun.shadow.needsUpdate, true);
assert.deepEqual(lighting.sunTarget.position.toArray(), [25, 7, -40]);
assert.deepEqual(lighting.sun.position.toArray(), [-40, 126, 10]);

const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
configureMeshShadowRole(mesh, { cast: true, receive: true });
assert.equal(mesh.castShadow, true);
assert.equal(mesh.receiveShadow, true);

const root = new THREE.Group();
root.add(mesh, new THREE.Object3D());
assert.equal(configureObjectShadowRole(root, { cast: true, receive: true }), 1);
assert.equal(mesh.castShadow, true);
assert.equal(mesh.receiveShadow, true);

assert.throws(() => lighting.updateAnchor([0, Number.NaN, 0]), /visual anchor/);

mesh.geometry.dispose();
mesh.material.dispose();
console.log('THREE_GROUND_VISUAL_STYLE_PASS');
