import { drapeRoadOnTerrain } from './roadTerrainDrape.mjs';
import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { createLicensedHumanoid } from './humanoidAsset.mjs';
import { createGroundMaterialLibrary } from './groundMaterialAssets.mjs';
import { createPreviewSceneGeometry } from './preview1SceneGeometry.mjs';
import { byteLengthOf, monotonicNow } from './rendererObservability.mjs';
import { createGroundPostProcessing } from './threeGroundPostProcessing.mjs';
import { installThreePreviewCameraControls } from './threePreviewCameraControls.mjs';
import { createThreeVegetationLayer } from './threeVegetationLayer.mjs';
import { decodeNearFieldTreeResource, resolveTreeProofMode } from './threeTreeAssetLOD.mjs';
import { createThreeStreetDetailLayer } from './threeStreetDetailLayer.mjs';
import { createThreeBuildingFacadeLayer } from './threeBuildingFacadeLayer.mjs';
import {
  configureGroundRendererVisualStyle,
  configureMeshShadowRole,
  configureObjectShadowRole,
  createGroundLighting,
} from './threeGroundVisualStyle.mjs';

const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';
const TERRAIN_MATERIAL_SCHEMA = 'nwe.terrain-render-style/0.1';
const BUILDING_MATERIAL_SCHEMA = 'nwe.building-render-style/0.1';
const HUMANOID_GROUND_LIFT_M = 0.02;

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

function createTerrainVertexColors(positions, normals) {
  const vertexCount = positions.length / 3;
  const colors = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const x = positions[offset]; const y = positions[offset + 1]; const z = positions[offset + 2];
    const slope = 1 - clamp01(normals[offset + 1]);
    const macro = clamp01(0.5 + 0.25 * Math.sin(x * 0.011) + 0.25 * Math.cos(z * 0.009));
    const micro = 0.5 + 0.5 * Math.sin((x + z) * 0.047 + y * 0.031);
    colors[offset] = clamp01(0.54 + macro * 0.15 + slope * 0.09 + micro * 0.025);
    colors[offset + 1] = clamp01(0.67 + macro * 0.16 - slope * 0.07 + micro * 0.02);
    colors[offset + 2] = clamp01(0.47 + macro * 0.10 - slope * 0.035 + micro * 0.018);
  }
  return colors;
}

function installGroundColorControl(canvas, materialLibrary, onChange) {
  const doc = globalThis.document;
  const parent = canvas?.parentElement;
  if (!doc?.createElement || !parent?.append) return { dispose() {} };
  const control = doc.createElement('button');
  const satellite = materialLibrary.stats.ground_color_modes_supported.includes('satellite');
  control.type = 'button';
  control.dataset.nweGroundColorControl = 'true';
  control.setAttribute('aria-label', 'Bakketekstur: bytt mellom satellitt og PBR');
  control.title = satellite
    ? 'Ekte Sentinel-2-farger, 10 m/piksel. Lokal CC0 PBR-detalj på nært hold. Trykk for sammenligning.'
    : 'Ingen SHA-verifisert, redistribusjonsklar satellittfarge i denne scenen.';
  Object.assign(control.style, {
    position: 'absolute', bottom: '16px', left: '16px', zIndex: '14',
    color: '#eef5f4', font: '600 12px/1.2 system-ui,sans-serif',
    background: 'rgba(11,29,31,.85)', border: '1px solid rgba(213,239,237,.35)',
    borderRadius: '9px', padding: '8px 11px', cursor: satellite ? 'pointer' : 'default',
    boxShadow: '0 2px 10px rgba(0,0,0,.28)',
  });
  if (!satellite) control.disabled = true;
  function label() {
    control.textContent = materialLibrary.getGroundColorMode() === 'satellite'
      ? 'Bakke · Satellitt (10 m)' : satellite ? 'Bakke · PBR (sammenligning)' : 'Bakke · PBR (uten satellitt)';
  }
  label();
  const toggle = () => {
    if (!satellite) return;
    const next = materialLibrary.getGroundColorMode() === 'satellite' ? 'pbr' : 'satellite';
    materialLibrary.setGroundColorMode(next);
    label();
    onChange();
  };
  control.addEventListener('click', toggle);
  parent.append(control);
  return { dispose() { control.removeEventListener('click', toggle); control.remove(); } };
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

async function initializeThreeRenderer(canvas, profile, forceWebGL) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: profile.webglAntialias !== false, alpha: false, forceWebGL });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr ?? 1.5));
  renderer.setClearColor(0xa9c8da, 1);
  configureGroundRendererVisualStyle(renderer, profile);
  await renderer.init();
  return renderer;
}

export async function createThreeGroundRenderer({ canvas, terrainPayload, roadsArtifact, buildingsArtifact, vegetationPlacement = null, treeAsset = null, streetDetail = null, realismEvidence = null, groundImagery = null, graphicsProfile, backend = 'auto', onBackendFallback = () => {}, onFrame = () => {} } = {}) {
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
  return createThreeGroundRendererFromInitialized({ renderer, forceWebGL, canvas, terrainPayload, roadsArtifact, buildingsArtifact, vegetationPlacement, treeAsset, streetDetail, realismEvidence, groundImagery, profile, initStartedAt, onFrame });
}

async function createThreeGroundRendererFromInitialized({ renderer, forceWebGL, canvas, terrainPayload, roadsArtifact, buildingsArtifact, vegetationPlacement, treeAsset, streetDetail, realismEvidence, groundImagery, profile, initStartedAt, onFrame }) {
  const treeProofMode = resolveTreeProofMode(globalThis.location?.search ?? '');
  const sceneStartedAt = monotonicNow();
  const sceneGeometry = createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact });
  sceneGeometry.roads = drapeRoadOnTerrain(sceneGeometry.roads, terrainPayload.mesh);
  const sceneBuildCpuMs = monotonicNow() - sceneStartedAt;
  const expectedTerrainTileId = terrainPayload.artifact.header.tile_id;
  const expectedTerrainArtifactSha = terrainPayload.artifact.sha256;
  const activeBackend = backendName(renderer, forceWebGL);
  const rendererVisualStyle = configureGroundRendererVisualStyle(renderer, profile);

  const scene = new THREE.Scene();
  const lighting = createGroundLighting(scene, profile, { renderer });
  const [terrainExtentE, terrainExtentN] = terrainExtentMeters(terrainPayload);
  const materialLoadStartedAt = monotonicNow();
  const materialLibrary = await createGroundMaterialLibrary({ renderer, profile, terrainExtentM: [terrainExtentE, terrainExtentN], groundImagery });
  const materialLoadCpuMs = monotonicNow() - materialLoadStartedAt;
  const {
    terrain: terrainMaterial,
    roadAsphalt: roadMaterial,
    resolvedWall: resolvedWallMaterial,
    resolvedRoof: resolvedRoofMaterial,
    fallbackWall: fallbackWallMaterial,
    fallbackRoof: fallbackRoofMaterial,
  } = materialLibrary.materials;

  const vectorStartedAt = monotonicNow();
  const roadMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.roads.positions, sceneGeometry.roads.indices, sceneGeometry.roads.normals ?? null, sceneGeometry.roads.uvs), roadMaterial), { cast: false, receive: true });
  const resolvedWallMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsResolved.walls.positions, sceneGeometry.buildingsResolved.walls.indices, null, sceneGeometry.buildingsResolved.walls.uvs, sceneGeometry.buildingsResolved.walls.colors), resolvedWallMaterial), { cast: true, receive: true });
  const resolvedRoofMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsResolved.roofs.positions, sceneGeometry.buildingsResolved.roofs.indices, null, sceneGeometry.buildingsResolved.roofs.uvs, sceneGeometry.buildingsResolved.roofs.colors), resolvedRoofMaterial), { cast: true, receive: true });
  const fallbackWallMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsFallback.walls.positions, sceneGeometry.buildingsFallback.walls.indices, null, sceneGeometry.buildingsFallback.walls.uvs, sceneGeometry.buildingsFallback.walls.colors), fallbackWallMaterial), { cast: true, receive: true });
  const fallbackRoofMesh = configureMeshShadowRole(new THREE.Mesh(bufferGeometry(sceneGeometry.buildingsFallback.roofs.positions, sceneGeometry.buildingsFallback.roofs.indices, null, sceneGeometry.buildingsFallback.roofs.uvs, sceneGeometry.buildingsFallback.roofs.colors), fallbackRoofMaterial), { cast: true, receive: true });
  const staticMeshes = [roadMesh, resolvedWallMesh, resolvedRoofMesh, fallbackWallMesh, fallbackRoofMesh];
  scene.add(...staticMeshes);

  // Same SHA-verified tree transport in both modes; proxy omits the authored
  // mesh decode/GPU upload to make the comparison meaningful.
  const detailedTreeResource = treeProofMode !== 'proxy' && treeAsset && vegetationPlacement
    ? await decodeNearFieldTreeResource(treeAsset) : null;
  const vegetationLayer = vegetationPlacement ? createThreeVegetationLayer({ placement: vegetationPlacement, profile, terrainMesh: terrainPayload.mesh, detailedTreeResource }) : null;
  if (vegetationLayer) scene.add(vegetationLayer.root);

  const streetDetailLayer = streetDetail ? createThreeStreetDetailLayer({ artifact: streetDetail, terrainPayload, profile }) : null;
  if (streetDetailLayer) scene.add(streetDetailLayer.root);

  const buildingFacadeLayer = createThreeBuildingFacadeLayer({ buildingsArtifact, terrainPayload, profile });
  scene.add(buildingFacadeLayer.root);

  const terrainLifecycle = { creates: 0, destroys: 0, createTimingMs: [], destroyTimingMs: [] };
  let terrainMesh = null;
  const terrainColorBytes = (terrainPayload.mesh.positions.length / 3) * 3 * Float32Array.BYTES_PER_ELEMENT;
  const terrainPayloadBytes = byteLengthOf(terrainPayload.mesh.positions, terrainPayload.mesh.normals, terrainPayload.mesh.uvs, terrainPayload.mesh.indices) + terrainColorBytes;
  const vectorPayloadBytes = byteLengthOf(sceneGeometry.roads.positions, sceneGeometry.roads.normals, sceneGeometry.roads.indices, sceneGeometry.roads.uvs, sceneGeometry.buildingsResolved.walls.positions, sceneGeometry.buildingsResolved.walls.indices, sceneGeometry.buildingsResolved.walls.uvs, sceneGeometry.buildingsResolved.walls.colors, sceneGeometry.buildingsResolved.roofs.positions, sceneGeometry.buildingsResolved.roofs.indices, sceneGeometry.buildingsResolved.roofs.uvs, sceneGeometry.buildingsResolved.roofs.colors, sceneGeometry.buildingsFallback.walls.positions, sceneGeometry.buildingsFallback.walls.indices, sceneGeometry.buildingsFallback.walls.uvs, sceneGeometry.buildingsFallback.walls.colors, sceneGeometry.buildingsFallback.roofs.positions, sceneGeometry.buildingsFallback.roofs.indices, sceneGeometry.buildingsFallback.roofs.uvs, sceneGeometry.buildingsFallback.roofs.colors);
  const vegetationInstanceMatrixBytesEstimate = ((vegetationLayer?.stats.rendered_representative_count ?? 0) * 3 + (vegetationLayer?.stats.near_field_max_instances ?? 0)) * 16 * Float32Array.BYTES_PER_ELEMENT;
  const nearTreeGeometryBytesEstimate = detailedTreeResource ? detailedTreeResource.geometry.getAttribute('position').array.byteLength + (detailedTreeResource.geometry.getAttribute('normal')?.array.byteLength ?? 0) + (detailedTreeResource.geometry.getAttribute('color')?.array.byteLength ?? 0) + (detailedTreeResource.geometry.index?.array.byteLength ?? 0) : 0;
  const streetInstanceCountEstimate = (streetDetailLayer?.stats.sign_point_count ?? 0) * 2
    + ((streetDetailLayer?.stats.source_light_mast_count ?? 0) + (streetDetailLayer?.stats.deduplicated_additional_light_point_count ?? 0)) * 2
    + (streetDetailLayer?.stats.edge_post_count ?? 0);
  const streetInstanceMatrixBytesEstimate = streetInstanceCountEstimate * 16 * Float32Array.BYTES_PER_ELEMENT;
  const facadeInstanceCount = (buildingFacadeLayer.stats.rendered_window_count ?? 0) + (buildingFacadeLayer.stats.rendered_door_count ?? 0);
  const facadeInstanceMatrixBytesEstimate = facadeInstanceCount * 16 * Float32Array.BYTES_PER_ELEMENT;
  const texturePayloadBytesEstimate = materialLibrary.stats.texture_count * 1024 * 1024 * 4;

  function makeTerrainMesh(payload) {
    assertTerrainPayloadIdentity(payload, expectedTerrainTileId, expectedTerrainArtifactSha);
    const mesh = new THREE.Mesh(bufferGeometry(payload.mesh.positions, payload.mesh.indices, payload.mesh.normals, payload.mesh.uvs, createTerrainVertexColors(payload.mesh.positions, payload.mesh.normals)), terrainMaterial);
    return configureMeshShadowRole(mesh, { cast: true, receive: true });
  }
  const initialTerrainStartedAt = monotonicNow();
  terrainMesh = makeTerrainMesh(terrainPayload); terrainLifecycle.creates += 1; terrainLifecycle.createTimingMs.push(monotonicNow() - initialTerrainStartedAt); scene.add(terrainMesh);
  const gpuResourceApplyCpuMs = monotonicNow() - vectorStartedAt;

  const centerGround = groundHeightAtCenter(terrainPayload);
  lighting.updateAnchor([0, centerGround, 0]);
  const humanoidStartedAt = monotonicNow();
  const humanoid = await createLicensedHumanoid({ scene, position: [0, centerGround + HUMANOID_GROUND_LIFT_M, 0], targetHeightM: 1.75 });
  const humanoidShadowMeshCount = configureObjectShadowRole(humanoid.root, { cast: true, receive: true });
  humanoid.root.visible = false;
  const humanoidLoadCpuMs = monotonicNow() - humanoidStartedAt;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.15, profile.cameraFarM ?? 2400);
  const cameraTarget = [0, centerGround + 1.55, -28];
  camera.position.set(0, centerGround + 1.7, 14); camera.lookAt(...cameraTarget);
  const postProcessing = createGroundPostProcessing({ renderer, scene, camera, profile, light: lighting.sun });

  let stopped = false; let dirty = true; let lastDrawAt = 0; let lastAnimationAt = 0;
  const groundColorControl = installGroundColorControl(canvas, materialLibrary, () => { dirty = true; });
  let firstFrameResolve; let firstFrameReject; let firstFrameSettled = false;
  let characterFollowInitialized = false;
  const cameraControls = installThreePreviewCameraControls({ canvas, camera, target: cameraTarget, firstPerson: true, onChange: () => { dirty = true; } });
  const treeProofTarget = treeProofMode ? vegetationLayer?.proofTarget() ?? null : null;
  if (treeProofMode) {
    if (!treeAsset || !treeProofTarget) throw new Error('NWE_TREE_PROOF_SOURCE_TARGET_MISSING');
    const [x, y, z] = treeProofTarget.local_position;
    const height = treeProofTarget.visual_height_m;
    cameraControls.setMode('free-fly');
    cameraControls.setProofCameraPose(
      [x + 12, y + Math.max(7, height * 0.6), z + 18],
      [x, y + height * 0.52, z],
    );
    lighting.updateAnchor([x, y, z]);
  }
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
      vegetationLayer?.updateNearField([camera.position.x, camera.position.y, camera.position.z]);
      postProcessing.render();
      const cameraState = cameraControls.snapshot();
      const rendererCalls = Number(renderer.info?.render?.calls);
      const fallbackCalls = [terrainMesh, ...staticMeshes].filter((mesh) => mesh?.visible && mesh.geometry?.index?.count > 0).length
        + humanoid.snapshot().render_mesh_count
        + (vegetationLayer?.stats.draw_calls ?? 0)
        + (streetDetailLayer?.stats.draw_calls ?? 0)
        + buildingFacadeLayer.stats.draw_calls;
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
    if (stopped) return; stopped = true; renderer.setAnimationLoop(null); cameraControls.dispose(); groundColorControl.dispose(); humanoid.dispose();
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh = null; }
    for (const mesh of staticMeshes) disposeMesh(mesh);
    vegetationLayer?.dispose();
    streetDetailLayer?.dispose();
    buildingFacadeLayer.dispose();
    postProcessing.dispose(); lighting.dispose(); materialLibrary.dispose(); renderer.dispose();
  };

  const buildingDrawCalls = [resolvedWallMesh, resolvedRoofMesh, fallbackWallMesh, fallbackRoofMesh].filter((mesh) => mesh.geometry?.index?.count > 0).length;
  const vegetationDrawCalls = vegetationLayer?.stats.draw_calls ?? 0;
  const streetDetailDrawCalls = streetDetailLayer?.stats.draw_calls ?? 0;
  const facadeDrawCalls = buildingFacadeLayer.stats.draw_calls;
  const colorDrawCalls = 2 + buildingDrawCalls + vegetationDrawCalls + streetDetailDrawCalls + facadeDrawCalls + humanoid.snapshot().render_mesh_count;
  const shadowBuildingDrawCandidates = [resolvedWallMesh, resolvedRoofMesh, fallbackWallMesh, fallbackRoofMesh].filter((mesh) => mesh.castShadow && mesh.geometry?.index?.count > 0).length;
  const shadowDrawCandidates = 1 + shadowBuildingDrawCandidates + (profile.shadows === false ? 0 : vegetationDrawCalls) + (buildingFacadeLayer.stats.rendered_door_count > 0 ? 1 : 0) + humanoidShadowMeshCount;
  const characterSnapshot = humanoid.snapshot();
  const stats = {
    ...sceneGeometry.stats,
    renderer_adapter: 'three-ground/0.5', three_revision: THREE.REVISION, backend: activeBackend, graphics_profile: profile.id, max_dpr: profile.maxDpr, pixel_ratio: renderer.getPixelRatio(), msaa_samples: profile.webglAntialias === false ? 1 : 4,
    draw_calls_per_frame: colorDrawCalls,
    draw_call_semantics: 'color-pass-estimate; measured frame drawCalls includes active renderer shadow work',
    shadow_draw_candidates: shadowDrawCandidates,
    gpu_buffer_count: 25 + (vegetationLayer?.stats.mesh_count ?? 0) * 2 + (streetDetailLayer?.stats.rendered_line_mesh_count ?? 0) * 4 + (streetDetailLayer?.stats.rendered_instanced_mesh_count ?? 0) * 2 + facadeDrawCalls * 2,
    gpu_buffer_payload_bytes: terrainPayloadBytes + vectorPayloadBytes + vegetationInstanceMatrixBytesEstimate + nearTreeGeometryBytesEstimate + streetInstanceMatrixBytesEstimate + facadeInstanceMatrixBytesEstimate,
    near_field_tree_geometry_bytes_estimate: nearTreeGeometryBytesEstimate,
    vegetation_instance_matrix_bytes_estimate: vegetationInstanceMatrixBytesEstimate,
    street_detail_instance_matrix_bytes_estimate: streetInstanceMatrixBytesEstimate,
    facade_instance_matrix_bytes_estimate: facadeInstanceMatrixBytesEstimate,
    gpu_texture_payload_bytes: texturePayloadBytesEstimate,
    gpu_texture_payload_semantics: 'uncompressed-rgba-estimate', timestamp_query_supported: false, camera_eye_height_m: 1.7, camera_mode: 'first-person', render_origin: sceneGeometry.origin,
    renderer_visual_style: { ...rendererVisualStyle, ...lighting.snapshot() },
    material_library: materialLibrary.stats,
    post_processing: postProcessing.stats,
    web_realism: realismEvidence ?? { status: 'BASE_WORLD_ONLY' },
    vegetation: vegetationLayer ? { ...vegetationLayer.stats, near_field: vegetationLayer.nearFieldSnapshot() } : { status: 'NOT_LOADED' },
    street_detail: streetDetailLayer?.stats ?? { status: 'NOT_LOADED' },
    building_facades: buildingFacadeLayer.stats,
    terrain_material: {
      schema: TERRAIN_MATERIAL_SCHEMA,
      pbr: true,
      vertex_normals: 'worker-provided',
      uv_source: 'worker-provided-normalized',
      detail_period_m: 4,
      detail_repeat: materialLibrary.stats.terrain_repeat,
      licensed_surface: materialLibrary.stats.assets.terrain,
      geographic_ground_color: materialLibrary.stats.ground_color,
      vertex_color_variation: materialLibrary.stats.ground_color.mode === 'generic-pbr-diffuse-fallback',
      normal_map: profile.normalMaps !== false,
      pbr_microdetail: 'poly-haven-normal-and-roughness',
      geometry_displacement: false,
    },
    building_palette: {
      semantics: 'per-source-id-deterministic-renderer-only-colour-times-licensed-cc0-pbr',
      resolved: {
        families: sceneGeometry.buildingsResolved.metadata.presentation_building_families,
        wall_palette_count: sceneGeometry.buildingsResolved.metadata.distinct_wall_palette_keys,
        roof_palette_count: sceneGeometry.buildingsResolved.metadata.distinct_roof_palette_keys,
        roofs: sceneGeometry.buildingsResolved.metadata.presentation_roof_types,
      },
      fallback: {
        families: sceneGeometry.buildingsFallback.metadata.presentation_building_families,
        wall_palette_count: sceneGeometry.buildingsFallback.metadata.distinct_wall_palette_keys,
        roof_palette_count: sceneGeometry.buildingsFallback.metadata.distinct_roof_palette_keys,
        roofs: sceneGeometry.buildingsFallback.metadata.presentation_roof_types,
      },
      truth_guard: 'appearance and non-DOM-oriented gable profiles are presentation only, not observed roof or facade truth',
    },
    building_materials: { schema: BUILDING_MATERIAL_SCHEMA, source_backed: { wall: materialLibrary.stats.assets.building_walls, roof: materialLibrary.stats.assets.building_roofs }, unresolved: { wall: `${materialLibrary.stats.assets.building_walls}:fallback-tint`, roof: `${materialLibrary.stats.assets.building_roofs}:fallback-tint` }, uv_semantics: sceneGeometry.buildingsResolved.metadata.uv_semantics, height_semantics: { source_backed: sceneGeometry.buildingsResolved.metadata.height_semantics, unresolved: sceneGeometry.buildingsFallback.metadata.height_semantics }, roof_triangulation: sceneGeometry.buildingsResolved.metadata.roof_triangulation },
    character: characterSnapshot,
    timing_ms: { scene_build_cpu_ms: sceneBuildCpuMs, material_load_cpu_ms: materialLoadCpuMs, gpu_resource_apply_cpu_ms: gpuResourceApplyCpuMs, humanoid_load_cpu_ms: humanoidLoadCpuMs, renderer_init_cpu_ms: monotonicNow() - initStartedAt },
  };

  return { header: sceneGeometry.header, firstFrame, stats, invalidate, dispose, activateTerrainResource, deactivateTerrainResource, getTerrainResourceLifecycle: terrainResourceSnapshot,
    setCharacterAnimationState(state, options) { const snapshot = humanoid.setAnimationState(state, options); dirty = true; return snapshot; },
    setCharacterRenderPose(pose) {
      if (!(pose?.position instanceof Float32Array) || pose.position.length !== 3) throw new TypeError('THREE_GROUND_CHARACTER_POSE_REQUIRED');
      const renderPose = { ...pose, position: new Float32Array([pose.position[0], pose.position[1] + HUMANOID_GROUND_LIFT_M, pose.position[2]]) };
      const snapshot = humanoid.setRenderPose(renderPose);
      cameraControls.followTarget([...pose.position], { headingRadians: pose.headingRadians, initialize: !characterFollowInitialized });
      lighting.updateAnchor([...pose.position]);
      characterFollowInitialized = true;
      dirty = true;
      return snapshot;
    },
    getCharacterState() { return humanoid.snapshot(); },
    getCameraState() { return cameraControls.snapshot(); },
    getTreeProofEvidence() {
      if (!treeProofMode) return null;
      const near = vegetationLayer?.nearFieldSnapshot() ?? null;
      return Object.freeze({
        schema: 'nwe.tree-camera-ab/0.1',
        mode: treeProofMode,
        target: treeProofTarget,
        camera: cameraControls.snapshot(),
        near_field: near,
        source_sha256: treeAsset.source_sha256,
        runtime_sha256: treeAsset.sha256,
        source_representative_count: vegetationLayer?.stats.source_representative_count ?? 0,
        rendered_representative_count: vegetationLayer?.stats.rendered_representative_count ?? 0,
        authored_triangles_per_tree: treeAsset.triangle_count,
        authored_triangles_active: (near?.active_count ?? 0) * treeAsset.triangle_count,
        authored_resource_bytes_estimate: nearTreeGeometryBytesEstimate,
        authored_render_draws: detailedTreeResource ? 1 : 0,
        terrain_artifact_sha256: expectedTerrainArtifactSha,
        backend: activeBackend,
        graphics_profile: profile.id,
        truth_guard: 'fixed renderer-only camera and LOD; SR16 coordinates remain unchanged',
      });
    },
    getGroundColorMode() { return materialLibrary.getGroundColorMode(); },
    getVisualStyle() { return { ...rendererVisualStyle, ...lighting.snapshot() }; },
  };
}
