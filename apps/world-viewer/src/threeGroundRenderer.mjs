import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { buildForgeVegetationPlacement } from './forgeVegetationPlacement.mjs';
import { createLicensedHumanoid } from './humanoidAsset.mjs';
import { loadPolyHavenSurfaceTextures, POLY_HAVEN_SURFACE_ASSETS } from './polyHavenSurfaceMaterials.mjs';
import { createPreviewSceneGeometry } from './preview1SceneGeometry.mjs';
import { byteLengthOf, monotonicNow } from './rendererObservability.mjs';
import { installThreePreviewCameraControls } from './threePreviewCameraControls.mjs';
import { createThreeVegetationLayer } from './threeVegetationLayer.mjs';
import {
  configureGroundRendererVisualStyle,
  configureMeshShadowRole,
  configureObjectShadowRole,
  createGroundLighting,
} from './threeGroundVisualStyle.mjs';

const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';
const TERRAIN_MATERIAL_SCHEMA = 'nwe.terrain-render-style/0.1';
const ROAD_MATERIAL_SCHEMA = 'nwe.road-render-style/0.2';
const BUILDING_MATERIAL_SCHEMA = 'nwe.building-render-style/0.2';
const TERRAIN_DETAIL_PERIOD_M = 5;
const TERRAIN_DETAIL_TEXTURE_SIZE = 64;
const HUMANOID_GROUND_LIFT_M = 0.02;
const POLY_HAVEN_TEXTURE_EDGE_PX = 1024;
const TERRAIN_NORMAL_STRENGTH = 0.18;
const WALL_NORMAL_STRENGTH = 0.18;
const ROOF_NORMAL_STRENGTH = 0.22;

function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function assertTerrainPayloadIdentity(payload, expectedTileId, expectedArtifactSha) {
  if (!payload?.mesh?.positions || !payload?.mesh?.indices || !payload?.mesh?.normals || !payload?.mesh?.uvs) throw new Error('THREE_GROUND_TERRAIN_PAYLOAD_INVALID');
  const vertexCount = payload.mesh.positions.length / 3;
  if (payload.mesh.normals.length !== payload.mesh.positions.length || payload.mesh.uvs.length !== vertexCount * 2) throw new Error('THREE_GROUND_TERRAIN_ATTRIBUTE_MISMATCH');
  if (payload?.artifact?.header?.tile_id !== expectedTileId) throw new Error(`THREE_GROUND_TERRAIN_TILE_MISMATCH: ${payload?.artifact?.header?.tile_id ?? 'missing'} != ${expectedTileId}`);
  if (payload?.artifact?.sha256 !== expectedArtifactSha) throw new Error(`THREE_GROUND_TERRAIN_ARTIFACT_MISMATCH: ${payload?.artifact?.sha256 ?? 'missing'} != ${expectedArtifactSha}`);
}

function bufferGeometry(positions, indices, normals = null, uvs = null, colors = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); else geometry.computeVertexNormals();
  if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeMesh(mesh) { if (mesh) mesh.geometry?.dispose?.(); }

function terrainExtentMeters(payload) {
  const bounds = payload?.mesh?.metadata?.bounds ?? payload?.artifact?.header?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4) return [1000, 1000];
  return [Math.abs(bounds[2] - bounds[0]), Math.abs(bounds[3] - bounds[1])];
}

function hash01(x, y, seed) {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function createTerrainDetailTexture({ surface = false } = {}) {
  const size = TERRAIN_DETAIL_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fine = hash01(x, y, surface ? 29 : 11);
      const broad = 0.5 + 0.25 * Math.sin(x * 0.31) + 0.25 * Math.cos(y * 0.27);
      const value = clamp01(0.68 * fine + 0.32 * broad);
      const offset = (y * size + x) * 4;
      if (surface) {
        const shade = Math.round(150 + value * 72);
        data[offset] = shade; data[offset + 1] = shade; data[offset + 2] = shade;
      } else {
        data[offset] = Math.round(93 + value * 42);
        data[offset + 1] = Math.round(116 + value * 52);
        data[offset + 2] = Math.round(72 + value * 34);
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = surface ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createTerrainVertexColors(positions, normals) {
  const vertexCount = positions.length / 3;
  const colors = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const x = positions[offset]; const y = positions[offset + 1]; const z = positions[offset + 2];
    const slope = 1 - clamp01(normals[offset + 1]);
    const macro = clamp01(0.5 + 0.25 * Math.sin(x * 0.011) + 0.25 * Math.cos(z * 0.009));
    const micro = 0.5 + 0.5 * Math.sin((x + z) * 0.047 + y * 0.031);
    colors[offset] = clamp01(0.72 + macro * 0.10 + slope * 0.035 + micro * 0.012);
    colors[offset + 1] = clamp01(0.84 + macro * 0.10 - slope * 0.025 + micro * 0.012);
    colors[offset + 2] = clamp01(0.67 + macro * 0.08 - slope * 0.018 + micro * 0.01);
  }
  return colors;
}

function groundHeightAtCenter(payload) {
  const header = payload.artifact.header;
  return sampleHeightGrid(payload.elevations, {
    width: header.width, height: header.height, bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m, nodata: header.nodata,
    easting: (header.bounds[0] + header.bounds[2]) / 2,
    northing: (header.bounds[1] + header.bounds[3]) / 2,
  }) - payload.mesh.metadata.origin[2];
}

function backendName(renderer, forceWebGL) {
  if (forceWebGL) return 'webgl2';
  if (renderer?.backend?.isWebGPUBackend === true) return 'webgpu';
  if (renderer?.backend?.isWebGLBackend === true) return 'webgl2';
  return globalThis.navigator?.gpu ? 'webgpu' : 'webgl2';
}

function applyTextureMaps(materials, maps, normalStrength, { normal = true, diffuse = true } = {}) {
  for (const material of materials) {
    if (diffuse && maps?.diffuse) material.map = maps.diffuse;
    else if (!diffuse) material.map = null;
    if (normal && maps?.normal && normalStrength > 0) {
      material.normalMap = maps.normal;
      material.normalScale.set(normalStrength, normalStrength);
    } else {
      material.normalMap = null;
    }
    material.needsUpdate = true;
  }
}

async function initializeThreeRenderer(canvas, profile, forceWebGL) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: profile.webglAntialias !== false, alpha: false, forceWebGL });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr ?? 1.5));
  renderer.setClearColor(0xaec5d3, 1);
  configureGroundRendererVisualStyle(renderer);
  await renderer.init();
  return renderer;
}

export async function createThreeGroundRenderer({ canvas, terrainPayload, roadsArtifact, buildingsArtifact, graphicsProfile, backend = 'auto', onBackendFallback = () => {}, onFrame = () => {} } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  const initStartedAt = monotonicNow();
  const profile = graphicsProfile ?? { id: 'balanced', maxDpr: 1.5, webglAntialias: true };
  const expectedTerrainTileId = terrainPayload?.artifact?.header?.tile_id;
  const expectedTerrainArtifactSha = terrainPayload?.artifact?.sha256;
  if (!expectedTerrainTileId || !expectedTerrainArtifactSha) throw new Error('THREE_GROUND_TERRAIN_IDENTITY_MISSING');
  const requestedBackend = backend === 'webgl2' ? 'webgl2' : backend === 'webgpu' ? 'webgpu' : 'auto';
  if (requestedBackend === 'webgpu' && !globalThis.navigator?.gpu) throw new Error('WEBGPU_UNAVAILABLE');
  let forceWebGL = requestedBackend === 'webgl2';
  let renderer;
  try { renderer = await initializeThreeRenderer(canvas, profile, forceWebGL); }
  catch (error) {
    if (requestedBackend !== 'auto') throw error;
    onBackendFallback({ from: 'webgpu', to: 'webgl2', error });
    forceWebGL = true;
    renderer = await initializeThreeRenderer(canvas, profile, true);
  }
  return createThreeGroundRendererFromInitialized({ renderer, forceWebGL, canvas, terrainPayload, roadsArtifact, buildingsArtifact, profile, initStartedAt, onFrame });
}

async function createThreeGroundRendererFromInitialized({ renderer, forceWebGL, canvas, terrainPayload, roadsArtifact, buildingsArtifact, profile, initStartedAt, onFrame }) {
  const sceneStartedAt = monotonicNow();
  const sceneGeometry = createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact });
  const sceneBuildCpuMs = monotonicNow() - sceneStartedAt;
  const expectedTerrainTileId = terrainPayload.artifact.header.tile_id;
  const expectedTerrainArtifactSha = terrainPayload.artifact.sha256;
  const activeBackend = backendName(renderer, forceWebGL);
  const rendererVisualStyle = configureGroundRendererVisualStyle(renderer);

  const scene = new THREE.Scene();
  const lighting = createGroundLighting(scene);

  const terrainColorTexture = createTerrainDetailTexture();
  const terrainSurfaceTexture = createTerrainDetailTexture({ surface: true });
  const [terrainExtentE, terrainExtentN] = terrainExtentMeters(terrainPayload);
  const detailRepeatX = Math.max(1, terrainExtentE / TERRAIN_DETAIL_PERIOD_M);
  const detailRepeatY = Math.max(1, terrainExtentN / TERRAIN_DETAIL_PERIOD_M);
  terrainColorTexture.repeat.set(detailRepeatX, detailRepeatY); terrainSurfaceTexture.repeat.set(detailRepeatX, detailRepeatY);

  const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, map: terrainColorTexture, roughnessMap: terrainSurfaceTexture, bumpMap: terrainSurfaceTexture, bumpScale: 0.07, vertexColors: true });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x555755, roughness: 0.96, metalness: 0, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const resolvedWallMaterial = new THREE.MeshStandardMaterial({ color: 0xe0d8cd, roughness: 0.84, metalness: 0, side: THREE.DoubleSide });
  const resolvedRoofMaterial = new THREE.MeshStandardMaterial({ color: 0x747779, roughness: 0.90, metalness: 0, side: THREE.DoubleSide });
  const fallbackWallMaterial = new THREE.MeshStandardMaterial({ color: 0xc5c0b7, roughness: 0.89, metalness: 0, side: THREE.DoubleSide });
  const fallbackRoofMaterial = new THREE.MeshStandardMaterial({ color: 0x65696b, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x26323a, roughness: 0.34, metalness: 0.04, side: THREE.DoubleSide });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x49382f, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });

  const roadWidthMeters = Number(sceneGeometry.roads.metadata?.width_m ?? 3.2);
  const roadUvPeriodMeters = Number(sceneGeometry.roads.metadata?.uv_period_m ?? 4);
  const surfaceTextureStartedAt = monotonicNow();
  const surfaceTexturePromise = loadPolyHavenSurfaceTextures({
    maxAnisotropy: Number(renderer.capabilities?.getMaxAnisotropy?.() ?? 4),
    repeats: {
      terrain: [terrainExtentE / POLY_HAVEN_SURFACE_ASSETS.terrain.physical_width_m, terrainExtentN / POLY_HAVEN_SURFACE_ASSETS.terrain.physical_width_m],
      road: [roadWidthMeters / POLY_HAVEN_SURFACE_ASSETS.road.physical_width_m, roadUvPeriodMeters / POLY_HAVEN_SURFACE_ASSETS.road.physical_width_m],
      wall: [1, 1],
      roof: [1, 1],
    },
  });

  const vectorStartedAt = monotonicNow();
  // Roads are deliberately receiveShadow=false until their source-backed width pass is closed.
  // Earlier exact screenshots proved the black road fields were not caused by vegetation shadows,
  // but keeping road lighting simple makes width/contour acceptance visually unambiguous.
  const roadMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.roads.positions, sceneGeometry.roads.indices, null, sceneGeometry.roads.uvs), roadMaterial), { cast: false, receive: false });
  const resolvedWallMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsResolved.walls.positions, sceneGeometry.buildingsResolved.walls.indices, null, sceneGeometry.buildingsResolved.walls.uvs), resolvedWallMaterial), { cast: true, receive: true });
  const resolvedRoofMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsResolved.roofs.positions, sceneGeometry.buildingsResolved.roofs.indices, null, sceneGeometry.buildingsResolved.roofs.uvs), resolvedRoofMaterial), { cast: true, receive: true });
  const fallbackWallMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsFallback.walls.positions, sceneGeometry.buildingsFallback.walls.indices, null, sceneGeometry.buildingsFallback.walls.uvs), fallbackWallMaterial), { cast: true, receive: true });
  const fallbackRoofMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsFallback.roofs.positions, sceneGeometry.buildingsFallback.roofs.indices, null, sceneGeometry.buildingsFallback.roofs.uvs), fallbackRoofMaterial), { cast: true, receive: true });
  const windowMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingFacades.windows.positions, sceneGeometry.buildingFacades.windows.indices, null, sceneGeometry.buildingFacades.windows.uvs), windowMaterial), { cast: false, receive: false });
  const doorMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingFacades.doors.positions, sceneGeometry.buildingFacades.doors.indices, null, sceneGeometry.buildingFacades.doors.uvs), doorMaterial), { cast: false, receive: false });
  const staticMeshes = [roadMesh, resolvedWallMesh, resolvedRoofMesh, fallbackWallMesh, fallbackRoofMesh, windowMesh, doorMesh];
  scene.add(...staticMeshes);

  const vegetationStartedAt = monotonicNow();
  const vegetationPlacement = buildForgeVegetationPlacement({ terrainPayload, roadsArtifact, buildingsArtifact, origin: sceneGeometry.origin });
  const vegetationLayer = createThreeVegetationLayer({ scene, placement: vegetationPlacement });
  const vegetationBuildCpuMs = monotonicNow() - vegetationStartedAt;

  const terrainLifecycle = { creates: 0, destroys: 0, createTimingMs: [], destroyTimingMs: [] };
  let terrainMesh = null;
  const terrainColorBytes = (terrainPayload.mesh.positions.length / 3) * 3 * Float32Array.BYTES_PER_ELEMENT;
  const terrainPayloadBytes = byteLengthOf(terrainPayload.mesh.positions, terrainPayload.mesh.normals, terrainPayload.mesh.uvs, terrainPayload.mesh.indices) + terrainColorBytes;
  const vectorPayloadBytes = byteLengthOf(
    sceneGeometry.roads.positions, sceneGeometry.roads.uvs, sceneGeometry.roads.indices,
    sceneGeometry.buildingsResolved.walls.positions, sceneGeometry.buildingsResolved.walls.uvs, sceneGeometry.buildingsResolved.walls.indices,
    sceneGeometry.buildingsResolved.roofs.positions, sceneGeometry.buildingsResolved.roofs.uvs, sceneGeometry.buildingsResolved.roofs.indices,
    sceneGeometry.buildingsFallback.walls.positions, sceneGeometry.buildingsFallback.walls.uvs, sceneGeometry.buildingsFallback.walls.indices,
    sceneGeometry.buildingsFallback.roofs.positions, sceneGeometry.buildingsFallback.roofs.uvs, sceneGeometry.buildingsFallback.roofs.indices,
    sceneGeometry.buildingFacades.windows.positions, sceneGeometry.buildingFacades.windows.uvs, sceneGeometry.buildingFacades.windows.indices,
    sceneGeometry.buildingFacades.doors.positions, sceneGeometry.buildingFacades.doors.uvs, sceneGeometry.buildingFacades.doors.indices,
  );
  const terrainTexturePayloadBytes = TERRAIN_DETAIL_TEXTURE_SIZE * TERRAIN_DETAIL_TEXTURE_SIZE * 4 * 2;

  function makeTerrainMesh(payload) {
    assertTerrainPayloadIdentity(payload, expectedTerrainTileId, expectedTerrainArtifactSha);
    const mesh = new THREE.Mesh(bufferGeometry(payload.mesh.positions, payload.mesh.indices, payload.mesh.normals, payload.mesh.uvs, createTerrainVertexColors(payload.mesh.positions, payload.mesh.normals)), terrainMaterial);
    return configureMeshShadowRole(mesh, { cast: false, receive: true });
  }
  const initialTerrainStartedAt = monotonicNow();
  terrainMesh = makeTerrainMesh(terrainPayload); terrainLifecycle.creates += 1; terrainLifecycle.createTimingMs.push(monotonicNow() - initialTerrainStartedAt); scene.add(terrainMesh);
  const gpuResourceApplyCpuMs = monotonicNow() - vectorStartedAt;

  const centerGround = groundHeightAtCenter(terrainPayload);
  lighting.updateAnchor([0, centerGround, 0]);
  const humanoidStartedAt = monotonicNow();
  const humanoidPromise = createLicensedHumanoid({ scene, position: [0, centerGround + HUMANOID_GROUND_LIFT_M, 0], targetHeightM: 1.75 });
  const [humanoid, surfaceTextures] = await Promise.all([humanoidPromise, surfaceTexturePromise, vegetationLayer.detailReady]);
  const humanoidLoadCpuMs = monotonicNow() - humanoidStartedAt;
  const surfaceTextureLoadCpuMs = monotonicNow() - surfaceTextureStartedAt;

  applyTextureMaps([terrainMaterial], surfaceTextures.textures.terrain, TERRAIN_NORMAL_STRENGTH);
  if (surfaceTextures.textures.terrain.normal) { terrainMaterial.bumpMap = null; terrainMaterial.bumpScale = 0; }
  // Keep Poly Haven asphalt downloaded/provenance-visible, but do not bind its diffuse/normal
  // until the road UV/material path is independently proven. The current accepted visual road
  // uses a stable neutral PBR asphalt color instead of the black-field failure mode.
  applyTextureMaps([roadMaterial], surfaceTextures.textures.road, 0, { normal: false, diffuse: false });
  applyTextureMaps([resolvedWallMaterial, fallbackWallMaterial], surfaceTextures.textures.wall, WALL_NORMAL_STRENGTH);
  applyTextureMaps([resolvedRoofMaterial, fallbackRoofMaterial], surfaceTextures.textures.roof, ROOF_NORMAL_STRENGTH);

  const humanoidShadowMeshCount = configureObjectShadowRole(humanoid.root, { cast: true, receive: true });

  const camera = new THREE.PerspectiveCamera(58, 1, 0.15, 2200);
  const cameraTarget = [0, centerGround + 1.55, -28];
  camera.position.set(0, centerGround + 1.7, 14); camera.lookAt(...cameraTarget);

  let stopped = false; let dirty = true; let lastDrawAt = 0; let lastAnimationAt = 0;
  let firstFrameResolve; let firstFrameReject; let firstFrameSettled = false;
  let characterFollowInitialized = false;
  const cameraControls = installThreePreviewCameraControls({ canvas, camera, target: cameraTarget, onChange: () => { dirty = true; } });
  const firstFrame = new Promise((resolve, reject) => { firstFrameResolve = resolve; firstFrameReject = reject; });

  function resize() {
    const width = Math.max(1, canvas.clientWidth); const height = Math.max(1, canvas.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  }
  function terrainResourceSnapshot() {
    return { schema: TERRAIN_RESOURCE_SCHEMA, backend: activeBackend, tile_id: expectedTerrainTileId, artifact_sha256: expectedTerrainArtifactSha, active: Boolean(terrainMesh), creates: terrainLifecycle.creates, destroys: terrainLifecycle.destroys, create_timing_ms: [...terrainLifecycle.createTimingMs], destroy_timing_ms: [...terrainLifecycle.destroyTimingMs], current_buffer_count: terrainMesh ? 5 : 0, current_payload_bytes: terrainMesh ? terrainPayloadBytes : 0, physical_vram_release_observed: false };
  }
  function activateTerrainResource(payload) {
    if (stopped) throw new Error('THREE_GROUND_RENDERER_STOPPED'); if (terrainMesh) throw new Error('THREE_GROUND_TERRAIN_ALREADY_ACTIVE');
    const startedAt = monotonicNow(); terrainMesh = makeTerrainMesh(payload); scene.add(terrainMesh); terrainLifecycle.creates += 1; terrainLifecycle.createTimingMs.push(monotonicNow() - startedAt); dirty = true; return terrainResourceSnapshot();
  }
  function deactivateTerrainResource() {
    if (stopped) throw new Error('THREE_GROUND_RENDERER_STOPPED'); if (!terrainMesh) throw new Error('THREE_GROUND_TERRAIN_NOT_ACTIVE');
    const startedAt = monotonicNow(); scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh = null; terrainLifecycle.destroys += 1; terrainLifecycle.destroyTimingMs.push(monotonicNow() - startedAt); dirty = true; return terrainResourceSnapshot();
  }

  const draw = async (now = performance.now()) => {
    if (stopped || !dirty) return;
    dirty = false;
    try {
      resize();
      const startedAt = monotonicNow();
      await renderer.renderAsync(scene, camera);
      const cameraState = cameraControls.snapshot();
      const rendererCalls = Number(renderer.info?.render?.calls);
      const vegetationVisibleMeshes = vegetationLayer.meshes.filter((mesh) => mesh?.visible && mesh.geometry?.index?.count > 0).length;
      const fallbackCalls = [terrainMesh, ...staticMeshes].filter((mesh) => mesh?.visible && mesh.geometry?.index?.count > 0).length + vegetationVisibleMeshes + humanoid.snapshot().render_mesh_count;
      const frame = { at: now, drawGapMs: lastDrawAt ? now - lastDrawAt : null, drawCpuMs: monotonicNow() - startedAt, drawCalls: Number.isFinite(rendererCalls) && rendererCalls > 0 ? rendererCalls : fallbackCalls, backend: activeBackend, pixelRatio: renderer.getPixelRatio(), camera: { yaw: cameraState.yaw, pitch: cameraState.pitch, distance: cameraState.distance, target: cameraState.target, eye_height_m: camera.position.y - centerGround }, character: humanoid.snapshot() };
      onFrame(frame); lastDrawAt = now;
      if (!firstFrameSettled) { firstFrameSettled = true; firstFrameResolve(frame); }
    } catch (error) {
      if (!firstFrameSettled) { firstFrameSettled = true; firstFrameReject(error); }
      throw error;
    }
  };

  const animationLoop = (now) => {
    if (stopped) return;
    const deltaSeconds = lastAnimationAt ? Math.max(0, (now - lastAnimationAt) / 1000) : 0;
    lastAnimationAt = now; humanoid.update(deltaSeconds); dirty = true; void draw(now);
  };
  renderer.setAnimationLoop(animationLoop);

  const invalidate = () => { if (!stopped) dirty = true; };
  const dispose = () => {
    if (stopped) return; stopped = true; renderer.setAnimationLoop(null); cameraControls.dispose(); humanoid.dispose(); vegetationLayer.dispose();
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh = null; }
    for (const mesh of staticMeshes) disposeMesh(mesh);
    surfaceTextures.dispose(); terrainMaterial.dispose(); terrainColorTexture.dispose(); terrainSurfaceTexture.dispose(); roadMaterial.dispose(); resolvedWallMaterial.dispose(); resolvedRoofMaterial.dispose(); fallbackWallMaterial.dispose(); fallbackRoofMaterial.dispose(); windowMaterial.dispose(); doorMaterial.dispose(); renderer.dispose();
  };

  const vegetationSnapshot = vegetationLayer.snapshot();
  const buildingMeshes = [resolvedWallMesh, resolvedRoofMesh, fallbackWallMesh, fallbackRoofMesh, windowMesh, doorMesh];
  const buildingDrawCalls = buildingMeshes.filter((mesh) => mesh.geometry?.index?.count > 0).length;
  const colorDrawCalls = 2 + buildingDrawCalls + vegetationSnapshot.asset_draw_calls + humanoid.snapshot().render_mesh_count;
  const vegetationShadowCandidates = vegetationLayer.meshes.filter((mesh) => mesh.castShadow && mesh.geometry?.index?.count > 0).length;
  const shadowBuildingDrawCandidates = [resolvedWallMesh, resolvedRoofMesh, fallbackWallMesh, fallbackRoofMesh].filter((mesh) => mesh.castShadow && mesh.geometry?.index?.count > 0).length + vegetationShadowCandidates;
  const shadowDrawCandidates = shadowBuildingDrawCandidates + humanoidShadowMeshCount;
  const characterSnapshot = humanoid.snapshot();
  const externalTextureGpuBytesEstimate = Math.round(surfaceTextures.snapshot.loaded_texture_count * POLY_HAVEN_TEXTURE_EDGE_PX * POLY_HAVEN_TEXTURE_EDGE_PX * 4 * (4 / 3));
  const terrainDiffuseSource = surfaceTextures.snapshot.assets.terrain.maps.diffuse === 'loaded' ? 'polyhaven-leafy-grass-1k' : 'procedural-fallback';
  const stats = {
    ...sceneGeometry.stats,
    renderer_adapter: 'three-ground/0.1', three_revision: THREE.REVISION, backend: activeBackend, graphics_profile: profile.id, max_dpr: profile.maxDpr, pixel_ratio: renderer.getPixelRatio(), msaa_samples: profile.webglAntialias === false ? 1 : 4,
    draw_calls_per_frame: colorDrawCalls,
    draw_call_semantics: 'color-pass-estimate including instanced real vegetation assets and batched facade cues; measured frame drawCalls includes active renderer shadow work',
    shadow_draw_candidates: shadowDrawCandidates,
    gpu_buffer_count: 24 + vegetationSnapshot.asset_mesh_count * 2,
    gpu_buffer_payload_bytes: terrainPayloadBytes + vectorPayloadBytes + vegetationSnapshot.asset_geometry_payload_bytes + vegetationSnapshot.asset_instance_matrix_payload_bytes,
    gpu_texture_payload_bytes: terrainTexturePayloadBytes + externalTextureGpuBytesEstimate,
    gpu_texture_payload_bytes_semantics: 'procedural bytes exact + loaded 1k external surface textures estimated RGBA8 with mip chain; compact GLB tree materials accounted in asset geometry state, not this texture estimate',
    timestamp_query_supported: false, camera_eye_height_m: 1.7, camera_mode: 'third-person-follow-orbit', render_origin: sceneGeometry.origin,
    renderer_visual_style: { ...rendererVisualStyle, ...lighting.snapshot() },
    surface_material_assets: surfaceTextures.snapshot,
    terrain_material: { schema: TERRAIN_MATERIAL_SCHEMA, pbr: true, vertex_normals: 'worker-provided', uv_source: 'worker-provided-normalized', detail_period_m: TERRAIN_DETAIL_PERIOD_M, detail_repeat: [detailRepeatX, detailRepeatY], diffuse_detail: terrainDiffuseSource, normal_detail: surfaceTextures.snapshot.assets.terrain.maps.normal === 'loaded' ? 'polyhaven-leafy-grass-1k' : 'procedural-bump-fallback', normal_strength: TERRAIN_NORMAL_STRENGTH, vertex_color_variation: true, shadow_role: 'receive-only', shadow_reason: 'coarse-dtm-self-shadow-suppressed', geometry_displacement: false },
    road_material: { schema: ROAD_MATERIAL_SCHEMA, pbr: true, source: 'stable-neutral-pbr-asphalt-color', external_asphalt_asset_status: surfaceTextures.snapshot.assets.road.maps.diffuse, external_asphalt_binding: 'disabled-after-exact-black-field-failure', uv_source: 'renderer-road-meter-distance-retained-for-future-proven-material', normal_map_policy: 'disabled', shadow_role: 'none-during-width-contour-acceptance', width_semantics: sceneGeometry.roads.metadata?.width_semantics, vertical_semantics: sceneGeometry.roads.metadata?.edge_height_semantics },
    building_materials: { schema: BUILDING_MATERIAL_SCHEMA, source_backed: { wall: 'polyhaven-painted-plaster-or-pbr-fallback', roof: 'polyhaven-grey-roof-tiles-or-pbr-fallback' }, unresolved: { wall: 'same-render-asset-with-type-height-and-morphology-fallback', roof: 'same-render-asset-with-type-height-and-morphology-fallback' }, facade_cues: { authority: sceneGeometry.buildingFacades.metadata.authority, windows: 'batched-dark-glass-like-pbr', doors: 'batched-matte-door-pbr', observed_features: false }, normal_strength: { wall: WALL_NORMAL_STRENGTH, roof: ROOF_NORMAL_STRENGTH }, uv_semantics: sceneGeometry.buildingsResolved.metadata.uv_semantics, height_semantics: { source_backed: sceneGeometry.buildingsResolved.metadata.height_semantics, unresolved: sceneGeometry.buildingsFallback.metadata.height_semantics }, foundation_semantics: sceneGeometry.buildingsFallback.metadata.foundation_semantics, roof_morphology_semantics: sceneGeometry.buildingsFallback.metadata.roof_morphology_semantics, roof_triangulation: sceneGeometry.buildingsResolved.metadata.roof_triangulation },
    vegetation: vegetationSnapshot,
    character: characterSnapshot,
    timing_ms: { scene_build_cpu_ms: sceneBuildCpuMs, gpu_resource_apply_cpu_ms: gpuResourceApplyCpuMs, surface_texture_load_cpu_ms: surfaceTextureLoadCpuMs, vegetation_build_cpu_ms: vegetationBuildCpuMs, humanoid_load_cpu_ms: humanoidLoadCpuMs, renderer_init_cpu_ms: monotonicNow() - initStartedAt },
  };

  return { header: sceneGeometry.header, firstFrame, stats, invalidate, dispose, activateTerrainResource, deactivateTerrainResource, getTerrainResourceLifecycle: terrainResourceSnapshot,
    setCharacterAnimationState(state, options) { const snapshot = humanoid.setAnimationState(state, options); dirty = true; return snapshot; },
    setCharacterRenderPose(pose) {
      if (!(pose?.position instanceof Float32Array) || pose.position.length !== 3) throw new TypeError('THREE_GROUND_CHARACTER_POSE_REQUIRED');
      const renderPose = {
        ...pose,
        position: new Float32Array([pose.position[0], pose.position[1] + HUMANOID_GROUND_LIFT_M, pose.position[2]]),
      };
      const snapshot = humanoid.setRenderPose(renderPose);
      cameraControls.followTarget([...pose.position], { headingRadians: pose.headingRadians, initialize: !characterFollowInitialized });
      lighting.updateAnchor([...pose.position]);
      characterFollowInitialized = true;
      dirty = true;
      return snapshot;
    },
    getCharacterState() { return humanoid.snapshot(); },
    getCameraState() { return cameraControls.snapshot(); },
    getVegetationState() { return vegetationLayer.snapshot(); },
    getVisualStyle() { return { ...rendererVisualStyle, ...lighting.snapshot() }; },
  };
}
