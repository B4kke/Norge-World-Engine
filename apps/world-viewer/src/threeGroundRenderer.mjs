import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { createPreviewSceneGeometry } from './preview1SceneGeometry.mjs';
import { byteLengthOf, monotonicNow } from './rendererObservability.mjs';

const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';

function assertTerrainPayloadIdentity(payload, expectedTileId, expectedArtifactSha) {
  if (!payload?.mesh?.positions || !payload?.mesh?.indices || !payload?.mesh?.normals) {
    throw new Error('THREE_GROUND_TERRAIN_PAYLOAD_INVALID');
  }
  if (payload?.artifact?.header?.tile_id !== expectedTileId) {
    throw new Error(`THREE_GROUND_TERRAIN_TILE_MISMATCH: ${payload?.artifact?.header?.tile_id ?? 'missing'} != ${expectedTileId}`);
  }
  if (payload?.artifact?.sha256 !== expectedArtifactSha) {
    throw new Error(`THREE_GROUND_TERRAIN_ARTIFACT_MISMATCH: ${payload?.artifact?.sha256 ?? 'missing'} != ${expectedArtifactSha}`);
  }
}

function bufferGeometry(positions, indices, normals = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose?.());
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
  graphicsProfile,
  backend = 'auto',
  onBackendFallback = () => {},
  onFrame = () => {},
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  const initStartedAt = monotonicNow();
  const profile = graphicsProfile ?? { id: 'balanced', maxDpr: 1.5, webglAntialias: true };
  const expectedTerrainTileId = terrainPayload?.artifact?.header?.tile_id;
  const expectedTerrainArtifactSha = terrainPayload?.artifact?.sha256;
  if (!expectedTerrainTileId || !expectedTerrainArtifactSha) throw new Error('THREE_GROUND_TERRAIN_IDENTITY_MISSING');

  const requestedBackend = backend === 'webgl2' ? 'webgl2' : backend === 'webgpu' ? 'webgpu' : 'auto';
  if (requestedBackend === 'webgpu' && !globalThis.navigator?.gpu) throw new Error('WEBGPU_UNAVAILABLE');
  const forceWebGL = requestedBackend === 'webgl2';

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: profile.webglAntialias !== false,
    alpha: false,
    forceWebGL,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr ?? 1.5));
  renderer.setClearColor(0x9eb4bd, 1);
  try {
    await renderer.init();
  } catch (error) {
    if (requestedBackend !== 'auto') throw error;
    onBackendFallback({ from: 'webgpu', to: 'webgl2', error });
    renderer.dispose();
    const fallback = new THREE.WebGPURenderer({
      canvas,
      antialias: profile.webglAntialias !== false,
      alpha: false,
      forceWebGL: true,
    });
    fallback.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr ?? 1.5));
    fallback.setClearColor(0x9eb4bd, 1);
    await fallback.init();
    return createThreeGroundRendererFromInitialized({
      renderer: fallback,
      forceWebGL: true,
      canvas,
      terrainPayload,
      roadsArtifact,
      buildingsArtifact,
      profile,
      initStartedAt,
      onFrame,
    });
  }

  return createThreeGroundRendererFromInitialized({
    renderer,
    forceWebGL,
    canvas,
    terrainPayload,
    roadsArtifact,
    buildingsArtifact,
    profile,
    initStartedAt,
    onFrame,
  });
}

function createThreeGroundRendererFromInitialized({
  renderer,
  forceWebGL,
  canvas,
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
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
  scene.background = new THREE.Color(0x9eb4bd);
  scene.fog = new THREE.Fog(0x9eb4bd, 220, 1150);

  const hemi = new THREE.HemisphereLight(0xe4f2ff, 0x44513a, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d2, 2.25);
  sun.position.set(-180, 320, 140);
  scene.add(sun);

  const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x587846, roughness: 0.96, metalness: 0.0 });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xb8c1c4, roughness: 0.78, metalness: 0.02, side: THREE.DoubleSide });
  const fallbackBuildingMaterial = new THREE.MeshStandardMaterial({ color: 0x7c878a, roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide });

  const vectorStartedAt = monotonicNow();
  const roadMesh = new THREE.Mesh(bufferGeometry(sceneGeometry.roads.positions, sceneGeometry.roads.indices), roadMaterial);
  const resolvedBuildingMesh = new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsResolved.positions, sceneGeometry.buildingsResolved.indices), buildingMaterial);
  const fallbackBuildingMesh = new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsFallback.positions, sceneGeometry.buildingsFallback.indices), fallbackBuildingMaterial);
  scene.add(roadMesh, resolvedBuildingMesh, fallbackBuildingMesh);

  const terrainLifecycle = { creates: 0, destroys: 0, createTimingMs: [], destroyTimingMs: [] };
  let terrainMesh = null;
  const terrainPayloadBytes = byteLengthOf(sceneGeometry.terrain.positions, sceneGeometry.terrain.normals, sceneGeometry.terrain.indices);
  const vectorPayloadBytes = byteLengthOf(
    sceneGeometry.roads.positions,
    sceneGeometry.roads.indices,
    sceneGeometry.buildingsResolved.positions,
    sceneGeometry.buildingsResolved.indices,
    sceneGeometry.buildingsFallback.positions,
    sceneGeometry.buildingsFallback.indices,
  );

  function makeTerrainMesh(payload) {
    assertTerrainPayloadIdentity(payload, expectedTerrainTileId, expectedTerrainArtifactSha);
    return new THREE.Mesh(bufferGeometry(payload.mesh.positions, payload.mesh.indices, payload.mesh.normals), terrainMaterial);
  }

  const initialTerrainStartedAt = monotonicNow();
  terrainMesh = makeTerrainMesh(terrainPayload);
  terrainLifecycle.creates += 1;
  terrainLifecycle.createTimingMs.push(monotonicNow() - initialTerrainStartedAt);
  scene.add(terrainMesh);
  const gpuResourceApplyCpuMs = monotonicNow() - vectorStartedAt;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.15, 2200);
  const centerGround = groundHeightAtCenter(terrainPayload);
  camera.position.set(0, centerGround + 1.7, 14);
  camera.lookAt(0, centerGround + 1.55, -28);

  let stopped = false;
  let dirty = true;
  let lastDrawAt = 0;
  let firstFrameResolve;
  let firstFrameReject;
  let firstFrameSettled = false;
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
      current_buffer_count: terrainMesh ? 3 : 0,
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
      const frame = {
        at: now,
        drawGapMs: lastDrawAt ? now - lastDrawAt : null,
        drawCpuMs: monotonicNow() - startedAt,
        drawCalls: [terrainMesh, roadMesh, resolvedBuildingMesh, fallbackBuildingMesh].filter((mesh) => mesh?.visible && mesh.geometry?.index?.count > 0).length,
        backend: activeBackend,
        pixelRatio: renderer.getPixelRatio(),
        camera: { yaw: 0, pitch: 0, distance: 14, eye_height_m: 1.7 },
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
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh = null;
    }
    disposeMesh(roadMesh);
    disposeMesh(resolvedBuildingMesh);
    disposeMesh(fallbackBuildingMesh);
    terrainMaterial.dispose();
    roadMaterial.dispose();
    buildingMaterial.dispose();
    fallbackBuildingMaterial.dispose();
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
    draw_calls_per_frame: 4,
    gpu_buffer_count: 9,
    gpu_buffer_payload_bytes: terrainPayloadBytes + vectorPayloadBytes,
    timestamp_query_supported: false,
    camera_eye_height_m: 1.7,
    render_origin: sceneGeometry.origin,
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
