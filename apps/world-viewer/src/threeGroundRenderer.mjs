import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { createPreviewSceneGeometry } from './preview1SceneGeometry.mjs';
import { byteLengthOf, monotonicNow } from './rendererObservability.mjs';
import { installThreePreviewCameraControls } from './threePreviewCameraControls.mjs';
import { createThreeEnvironment } from './threeEnvironment.mjs';

const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';
const TERRAIN_MATERIAL_SCHEMA = 'nwe.terrain-render-style/0.1';
const TERRAIN_DETAIL_PERIOD_M = 5;
const TERRAIN_DETAIL_TEXTURE_SIZE = 64;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function assertTerrainPayloadIdentity(payload, expectedTileId, expectedArtifactSha) {
  if (!payload?.mesh?.positions || !payload?.mesh?.indices || !payload?.mesh?.normals || !payload?.mesh?.uvs) {
    throw new Error('THREE_GROUND_TERRAIN_PAYLOAD_INVALID');
  }
  const vertexCount = payload.mesh.positions.length / 3;
  if (payload.mesh.normals.length !== payload.mesh.positions.length || payload.mesh.uvs.length !== vertexCount * 2) {
    throw new Error('THREE_GROUND_TERRAIN_ATTRIBUTE_MISMATCH');
  }
  if (payload?.artifact?.header?.tile_id !== expectedTileId) {
    throw new Error(`THREE_GROUND_TERRAIN_TILE_MISMATCH: ${payload?.artifact?.header?.tile_id ?? 'missing'} != ${expectedTileId}`);
  }
  if (payload?.artifact?.sha256 !== expectedArtifactSha) {
    throw new Error(`THREE_GROUND_TERRAIN_ARTIFACT_MISMATCH: ${payload?.artifact?.sha256 ?? 'missing'} != ${expectedArtifactSha}`);
  }
}

function bufferGeometry(positions, indices, normals = null, uvs = null, colors = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose?.());
}

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
        const shade = Math.round(166 + value * 82);
        data[offset] = shade;
        data[offset + 1] = shade;
        data[offset + 2] = shade;
      } else {
        data[offset] = Math.round(154 + value * 58);
        data[offset + 1] = Math.round(168 + value * 62);
        data[offset + 2] = Math.round(132 + value * 46);
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
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
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const slope = 1 - clamp01(normals[offset + 1]);
    const macro = clamp01(0.5 + 0.25 * Math.sin(x * 0.011) + 0.25 * Math.cos(z * 0.009));
    const micro = 0.5 + 0.5 * Math.sin((x + z) * 0.047 + y * 0.031);
    colors[offset] = clamp01(0.54 + macro * 0.15 + slope * 0.09 + micro * 0.025);
    colors[offset + 1] = clamp01(0.67 + macro * 0.16 - slope * 0.07 + micro * 0.02);
    colors[offset + 2] = clamp01(0.47 + macro * 0.10 - slope * 0.035 + micro * 0.018);
  }
  return colors;
}

function groundHeightAtCenter(payload) {
  const header = payload.artifact.header;
  const easting = (header.bounds[0] + header.bounds[2]) / 2;
  const northing = (header.bounds[1] + header.bounds[3]) / 2;
  return sampleHeightGrid(payload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  }) - payload.mesh.metadata.origin[2];
}

function backendName(renderer, forceWebGL) {
  if (forceWebGL) return 'webgl2';
  if (renderer?.backend?.isWebGPUBackend === true) return 'webgpu';
  if (renderer?.backend?.isWebGLBackend === true) return 'webgl2';
  return globalThis.navigator?.gpu ? 'webgpu' : 'webgl2';
}

export async function createThreeGroundRenderer({
  canvas,
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  environment,
  graphicsProfile,
  backend = 'auto',
  onBackendFallback = () => {},
  onFrame = () => {},
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  if (environment?.schema !== 'nwe.environment-state/0.1') throw new TypeError('normalized environment is required');
  const initStartedAt = monotonicNow();
  const profile = graphicsProfile ?? { id: 'balanced', maxDpr: 1.5, webglAntialias: true };
  const expectedTerrainTileId = terrainPayload?.artifact?.header?.tile_id;
  const expectedTerrainArtifactSha = terrainPayload?.artifact?.sha256;
  if (!expectedTerrainTileId || !expectedTerrainArtifactSha) throw new Error('THREE_GROUND_TERRAIN_IDENTITY_MISSING');

  const requestedBackend = backend === 'webgl2' ? 'webgl2' : backend === 'webgpu' ? 'webgpu' : 'auto';
  if (requestedBackend === 'webgpu' && !globalThis.navigator?.gpu) throw new Error('WEBGPU_UNAVAILABLE');
  const forceWebGL = requestedBackend === 'webgl2';

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: profile.webglAntialias !== false, alpha: false, forceWebGL });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr ?? 1.5));
  renderer.setClearColor(0x9eb4bd, 1);
  try {
    await renderer.init();
  } catch (error) {
    if (requestedBackend !== 'auto') throw error;
    onBackendFallback({ from: 'webgpu', to: 'webgl2', error });
    renderer.dispose();
    const fallback = new THREE.WebGPURenderer({ canvas, antialias: profile.webglAntialias !== false, alpha: false, forceWebGL: true });
    fallback.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr ?? 1.5));
    fallback.setClearColor(0x9eb4bd, 1);
    await fallback.init();
    return createThreeGroundRendererFromInitialized({
      renderer: fallback, forceWebGL: true, canvas, terrainPayload, roadsArtifact, buildingsArtifact, environment, profile, initStartedAt, onFrame,
    });
  }

  return createThreeGroundRendererFromInitialized({
    renderer, forceWebGL, canvas, terrainPayload, roadsArtifact, buildingsArtifact, environment, profile, initStartedAt, onFrame,
  });
}

function createThreeGroundRendererFromInitialized({
  renderer,
  forceWebGL,
  canvas,
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  environment,
  profile,
  initStartedAt,
  onFrame,
}) {
  const sceneStartedAt = monotonicNow();
  const sceneGeometry = createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact });
  const sceneBuildCpuMs = monotonicNow() - sceneStartedAt;
  const expectedTerrainTileId = terrainPayload.artifact.header.tile_id;
  const expectedTerrainArtifactSha = terrainPayload.artifact.sha256;
  const activeBackend = backendName(renderer, forceWebGL);

  const scene = new THREE.Scene();
  const environmentRenderer = createThreeEnvironment({ scene, renderer, environment });

  const terrainColorTexture = createTerrainDetailTexture();
  const terrainSurfaceTexture = createTerrainDetailTexture({ surface: true });
  const [terrainExtentE, terrainExtentN] = terrainExtentMeters(terrainPayload);
  const detailRepeatX = Math.max(1, terrainExtentE / TERRAIN_DETAIL_PERIOD_M);
  const detailRepeatY = Math.max(1, terrainExtentN / TERRAIN_DETAIL_PERIOD_M);
  terrainColorTexture.repeat.set(detailRepeatX, detailRepeatY);
  terrainSurfaceTexture.repeat.set(detailRepeatX, detailRepeatY);

  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94 - environmentRenderer.wetness * 0.1,
    metalness: 0.0,
    map: terrainColorTexture,
    roughnessMap: terrainSurfaceTexture,
    bumpMap: terrainSurfaceTexture,
    bumpScale: 0.14,
    vertexColors: true,
  });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.9 - environmentRenderer.wetness * 0.42, metalness: 0.0, side: THREE.DoubleSide });
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xb8c1c4, roughness: 0.78 - environmentRenderer.wetness * 0.12, metalness: 0.02, side: THREE.DoubleSide });
  const fallbackBuildingMaterial = new THREE.MeshStandardMaterial({ color: 0x7c878a, roughness: 0.86 - environmentRenderer.wetness * 0.08, metalness: 0.0, side: THREE.DoubleSide });

  const vectorStartedAt = monotonicNow();
  const roadMesh = new THREE.Mesh(bufferGeometry(sceneGeometry.roads.positions, sceneGeometry.roads.indices), roadMaterial);
  roadMesh.receiveShadow = true;
  const resolvedBuildingMesh = new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsResolved.positions, sceneGeometry.buildingsResolved.indices), buildingMaterial);
  resolvedBuildingMesh.castShadow = true;
  resolvedBuildingMesh.receiveShadow = true;
  const fallbackBuildingMesh = new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsFallback.positions, sceneGeometry.buildingsFallback.indices), fallbackBuildingMaterial);
  fallbackBuildingMesh.castShadow = true;
  fallbackBuildingMesh.receiveShadow = true;
  scene.add(roadMesh, resolvedBuildingMesh, fallbackBuildingMesh);

  const terrainLifecycle = { creates: 0, destroys: 0, createTimingMs: [], destroyTimingMs: [] };
  let terrainMesh = null;
  const terrainColorBytes = (terrainPayload.mesh.positions.length / 3) * 3 * Float32Array.BYTES_PER_ELEMENT;
  const terrainPayloadBytes = byteLengthOf(terrainPayload.mesh.positions, terrainPayload.mesh.normals, terrainPayload.mesh.uvs, terrainPayload.mesh.indices) + terrainColorBytes;
  const vectorPayloadBytes = byteLengthOf(
    sceneGeometry.roads.positions,
    sceneGeometry.roads.indices,
    sceneGeometry.buildingsResolved.positions,
    sceneGeometry.buildingsResolved.indices,
    sceneGeometry.buildingsFallback.positions,
    sceneGeometry.buildingsFallback.indices,
  );
  const terrainTexturePayloadBytes = TERRAIN_DETAIL_TEXTURE_SIZE * TERRAIN_DETAIL_TEXTURE_SIZE * 4 * 2;

  function makeTerrainMesh(payload) {
    assertTerrainPayloadIdentity(payload, expectedTerrainTileId, expectedTerrainArtifactSha);
    const colors = createTerrainVertexColors(payload.mesh.positions, payload.mesh.normals);
    const mesh = new THREE.Mesh(
      bufferGeometry(payload.mesh.positions, payload.mesh.indices, payload.mesh.normals, payload.mesh.uvs, colors),
      terrainMaterial,
    );
    mesh.receiveShadow = true;
    return mesh;
  }

  const initialTerrainStartedAt = monotonicNow();
  terrainMesh = makeTerrainMesh(terrainPayload);
  terrainLifecycle.creates += 1;
  terrainLifecycle.createTimingMs.push(monotonicNow() - initialTerrainStartedAt);
  scene.add(terrainMesh);
  const gpuResourceApplyCpuMs = monotonicNow() - vectorStartedAt;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.15, 2200);
  const centerGround = groundHeightAtCenter(terrainPayload);
  const cameraTarget = [0, centerGround + 1.55, -28];
  camera.position.set(0, centerGround + 1.7, 14);
  camera.lookAt(...cameraTarget);

  let stopped = false;
  let dirty = true;
  let lastDrawAt = 0;
  let firstFrameResolve;
  let firstFrameReject;
  let firstFrameSettled = false;
  const cameraControls = installThreePreviewCameraControls({ canvas, camera, target: cameraTarget, onChange: () => { dirty = true; } });
  const firstFrame = new Promise((resolve, reject) => {
    firstFrameResolve = resolve;
    firstFrameReject = reject;
  });

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function terrainResourceSnapshot() {
    return {
      schema: TERRAIN_RESOURCE_SCHEMA,
      backend: activeBackend,
      tile_id: expectedTerrainTileId,
      artifact_sha256: expectedTerrainArtifactSha,
      active: Boolean(terrainMesh),
      creates: terrainLifecycle.creates,
      destroys: terrainLifecycle.destroys,
      create_timing_ms: [...terrainLifecycle.createTimingMs],
      destroy_timing_ms: [...terrainLifecycle.destroyTimingMs],
      current_buffer_count: terrainMesh ? 5 : 0,
      current_payload_bytes: terrainMesh ? terrainPayloadBytes : 0,
      physical_vram_release_observed: false,
    };
  }

  function activateTerrainResource(payload) {
    if (stopped) throw new Error('THREE_GROUND_RENDERER_STOPPED');
    if (terrainMesh) throw new Error('THREE_GROUND_TERRAIN_ALREADY_ACTIVE');
    const startedAt = monotonicNow();
    terrainMesh = makeTerrainMesh(payload);
    scene.add(terrainMesh);
    terrainLifecycle.creates += 1;
    terrainLifecycle.createTimingMs.push(monotonicNow() - startedAt);
    dirty = true;
    return terrainResourceSnapshot();
  }

  function deactivateTerrainResource() {
    if (stopped) throw new Error('THREE_GROUND_RENDERER_STOPPED');
    if (!terrainMesh) throw new Error('THREE_GROUND_TERRAIN_NOT_ACTIVE');
    const startedAt = monotonicNow();
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh = null;
    terrainLifecycle.destroys += 1;
    terrainLifecycle.destroyTimingMs.push(monotonicNow() - startedAt);
    dirty = true;
    return terrainResourceSnapshot();
  }

  const draw = async (now = performance.now()) => {
    if (stopped || !dirty) return;
    dirty = false;
    try {
      resize();
      const startedAt = monotonicNow();
      await renderer.renderAsync(scene, camera);
      const cameraState = cameraControls.snapshot();
      const frame = {
        at: now,
        drawGapMs: lastDrawAt ? now - lastDrawAt : null,
        drawCpuMs: monotonicNow() - startedAt,
        drawCalls: 5,
        backend: activeBackend,
        pixelRatio: renderer.getPixelRatio(),
        camera: {
          yaw: cameraState.yaw,
          pitch: cameraState.pitch,
          distance: cameraState.distance,
          eye_height_m: camera.position.y - centerGround,
        },
      };
      onFrame(frame);
      lastDrawAt = now;
      if (!firstFrameSettled) {
        firstFrameSettled = true;
        firstFrameResolve(frame);
      }
    } catch (error) {
      if (!firstFrameSettled) {
        firstFrameSettled = true;
        firstFrameReject(error);
      }
      throw error;
    }
  };

  const animationLoop = (now) => {
    if (!stopped && dirty) void draw(now);
  };
  renderer.setAnimationLoop(animationLoop);
  dirty = true;

  const invalidate = () => {
    if (!stopped) dirty = true;
  };
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    renderer.setAnimationLoop(null);
    cameraControls.dispose();
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh = null;
    }
    disposeMesh(roadMesh);
    disposeMesh(resolvedBuildingMesh);
    disposeMesh(fallbackBuildingMesh);
    terrainMaterial.dispose();
    terrainColorTexture.dispose();
    terrainSurfaceTexture.dispose();
    roadMaterial.dispose();
    buildingMaterial.dispose();
    fallbackBuildingMaterial.dispose();
    environmentRenderer.dispose();
    renderer.dispose();
  };

  const stats = {
    ...sceneGeometry.stats,
    renderer_adapter: 'three-ground/0.1',
    three_revision: THREE.REVISION,
    backend: activeBackend,
    graphics_profile: profile.id,
    max_dpr: profile.maxDpr,
    pixel_ratio: renderer.getPixelRatio(),
    msaa_samples: profile.webglAntialias === false ? 1 : 4,
    draw_calls_per_frame: 5,
    gpu_buffer_count: 11,
    gpu_buffer_payload_bytes: terrainPayloadBytes + vectorPayloadBytes,
    gpu_texture_payload_bytes: terrainTexturePayloadBytes,
    timestamp_query_supported: false,
    camera_eye_height_m: 1.7,
    render_origin: sceneGeometry.origin,
    environment: environmentRenderer.stats,
    terrain_material: {
      schema: TERRAIN_MATERIAL_SCHEMA,
      pbr: true,
      vertex_normals: 'worker-provided',
      uv_source: 'worker-provided-normalized',
      detail_period_m: TERRAIN_DETAIL_PERIOD_M,
      detail_repeat: [detailRepeatX, detailRepeatY],
      procedural_detail: 'renderer-only-source-safe',
      vertex_color_variation: true,
      bump_scale: terrainMaterial.bumpScale,
      roughness: terrainMaterial.roughness,
      wetness_input: environmentRenderer.wetness,
      geometry_displacement: false,
    },
    timing_ms: {
      scene_build_cpu_ms: sceneBuildCpuMs,
      gpu_resource_apply_cpu_ms: gpuResourceApplyCpuMs,
      renderer_init_cpu_ms: monotonicNow() - initStartedAt,
    },
  };

  return {
    header: sceneGeometry.header,
    firstFrame,
    stats,
    invalidate,
    dispose,
    activateTerrainResource,
    deactivateTerrainResource,
    getTerrainResourceLifecycle: terrainResourceSnapshot,
  };
}
