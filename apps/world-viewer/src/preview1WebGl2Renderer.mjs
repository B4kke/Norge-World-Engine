import {
  cameraViewProjection,
  createPreviewCamera,
  createPreviewSceneGeometry,
  installPreviewSceneControls,
} from './preview1SceneGeometry.mjs';
import { byteLengthOf, monotonicNow } from './rendererObservability.mjs';

const TERRAIN_RESOURCE_SCHEMA = 'nwe.preview-terrain-resource-lifecycle/0.1';

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'shader compile failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL program allocation failed');
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'program link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createTerrainProgram(gl) {
  return createProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    uniform mat4 uViewProj;
    out float vHeight;
    out float vLight;
    void main() {
      gl_Position = uViewProj * vec4(aPosition, 1.0);
      vHeight = aPosition.y;
      vec3 lightDir = normalize(vec3(-0.35, 0.82, 0.42));
      vLight = 0.42 + 0.58 * max(dot(normalize(aNormal), lightDir), 0.0);
    }`, `#version 300 es
    precision highp float;
    in float vHeight;
    in float vLight;
    out vec4 outColor;
    void main() {
      float h = clamp(vHeight / 34.0, 0.0, 1.0);
      vec3 low = vec3(0.09, 0.25, 0.13);
      vec3 high = vec3(0.46, 0.54, 0.29);
      vec3 base = mix(low, high, h);
      outColor = vec4(base * vLight, 1.0);
    }`);
}

function createFlatProgram(gl) {
  return createProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    uniform mat4 uViewProj;
    void main() { gl_Position = uViewProj * vec4(aPosition, 1.0); }
  `, `#version 300 es
    precision highp float;
    uniform vec4 uColor;
    out vec4 outColor;
    void main() { outColor = uColor; }
  `);
}

function createIndexedMesh(gl, positions, indices, normals = null) {
  const vao = gl.createVertexArray();
  const positionBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!vao || !positionBuffer || !indexBuffer) throw new Error('WebGL buffer allocation failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  let normalBuffer = null;
  if (normals) {
    normalBuffer = gl.createBuffer();
    if (!normalBuffer) throw new Error('WebGL normal buffer allocation failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    vao,
    positionBuffer,
    normalBuffer,
    indexBuffer,
    count: indices.length,
    indexType: indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
  };
}

function destroyMesh(gl, mesh) {
  if (!mesh) return;
  gl.deleteBuffer(mesh.positionBuffer);
  if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
  gl.deleteBuffer(mesh.indexBuffer);
  gl.deleteVertexArray(mesh.vao);
}

function assertTerrainPayloadIdentity(payload, expectedTileId, expectedArtifactSha) {
  if (!payload?.mesh?.positions || !payload?.mesh?.indices || !payload?.mesh?.normals) {
    throw new Error('PREVIEW_TERRAIN_RESOURCE_PAYLOAD_INVALID');
  }
  if (payload?.artifact?.header?.tile_id !== expectedTileId) {
    throw new Error(`PREVIEW_TERRAIN_RESOURCE_TILE_MISMATCH: ${payload?.artifact?.header?.tile_id ?? 'missing'} != ${expectedTileId}`);
  }
  if (payload?.artifact?.sha256 !== expectedArtifactSha) {
    throw new Error(`PREVIEW_TERRAIN_RESOURCE_ARTIFACT_MISMATCH: ${payload?.artifact?.sha256 ?? 'missing'} != ${expectedArtifactSha}`);
  }
}

export function createPreview1WebGl2Renderer({
  canvas,
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  graphicsProfile,
  onFrame = () => {},
} = {}) {
  const initStartedAt = monotonicNow();
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  const profile = graphicsProfile ?? { id: 'balanced', maxDpr: 1.5, webglAntialias: true };
  const gl = canvas.getContext('webgl2', {
    antialias: profile.webglAntialias !== false,
    alpha: false,
    depth: true,
    stencil: false,
  });
  if (!gl) throw new Error('WEBGL2_UNAVAILABLE');
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.025, 0.045, 0.055, 1);

  const sceneStartedAt = monotonicNow();
  const scene = createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact });
  const sceneBuildCpuMs = monotonicNow() - sceneStartedAt;
  const expectedTerrainTileId = terrainPayload?.artifact?.header?.tile_id;
  const expectedTerrainArtifactSha = terrainPayload?.artifact?.sha256;
  if (!expectedTerrainTileId || !expectedTerrainArtifactSha) throw new Error('PREVIEW_TERRAIN_RESOURCE_IDENTITY_MISSING');

  const terrainLifecycle = {
    creates: 0,
    destroys: 0,
    createTimingMs: [],
    destroyTimingMs: [],
  };

  const resourceStartedAt = monotonicNow();
  const terrainProgram = createTerrainProgram(gl);
  const flatProgram = createFlatProgram(gl);
  const initialTerrainStartedAt = monotonicNow();
  let terrainMesh = createIndexedMesh(gl, scene.terrain.positions, scene.terrain.indices, scene.terrain.normals);
  terrainLifecycle.creates += 1;
  terrainLifecycle.createTimingMs.push(monotonicNow() - initialTerrainStartedAt);
  const roadMesh = createIndexedMesh(gl, scene.roads.positions, scene.roads.indices);
  const resolvedMesh = createIndexedMesh(gl, scene.buildingsResolved.positions, scene.buildingsResolved.indices);
  const fallbackMesh = createIndexedMesh(gl, scene.buildingsFallback.positions, scene.buildingsFallback.indices);
  const gpuResourceApplyCpuMs = monotonicNow() - resourceStartedAt;
  const terrainGpuPayloadBytes = byteLengthOf(scene.terrain.positions, scene.terrain.normals, scene.terrain.indices);
  const vectorGpuPayloadBytes = byteLengthOf(
    scene.roads.positions,
    scene.roads.indices,
    scene.buildingsResolved.positions,
    scene.buildingsResolved.indices,
    scene.buildingsFallback.positions,
    scene.buildingsFallback.indices,
  );
  const vectorGpuBufferCount = [
    roadMesh.positionBuffer, roadMesh.indexBuffer,
    resolvedMesh.positionBuffer, resolvedMesh.indexBuffer,
    fallbackMesh.positionBuffer, fallbackMesh.indexBuffer,
  ].filter(Boolean).length;

  const camera = createPreviewCamera();
  let dirty = true;
  let stopped = false;
  let lastDrawAt = 0;
  let actualPixelRatio = 1;
  let firstFrameResolve;
  let firstFrameReject;
  let firstFrameSettled = false;
  const firstFrame = new Promise((resolve, reject) => {
    firstFrameResolve = resolve;
    firstFrameReject = reject;
  });

  function terrainResourceSnapshot() {
    return {
      schema: TERRAIN_RESOURCE_SCHEMA,
      backend: 'webgl2',
      tile_id: expectedTerrainTileId,
      artifact_sha256: expectedTerrainArtifactSha,
      active: Boolean(terrainMesh),
      creates: terrainLifecycle.creates,
      destroys: terrainLifecycle.destroys,
      create_timing_ms: [...terrainLifecycle.createTimingMs],
      destroy_timing_ms: [...terrainLifecycle.destroyTimingMs],
      current_buffer_count: terrainMesh ? 3 : 0,
      current_payload_bytes: terrainMesh ? terrainGpuPayloadBytes : 0,
      physical_vram_release_observed: false,
    };
  }

  function activateTerrainResource(payload) {
    if (stopped) throw new Error('PREVIEW_TERRAIN_RESOURCE_RENDERER_STOPPED');
    assertTerrainPayloadIdentity(payload, expectedTerrainTileId, expectedTerrainArtifactSha);
    if (terrainMesh) throw new Error('PREVIEW_TERRAIN_RESOURCE_ALREADY_ACTIVE');
    const startedAt = monotonicNow();
    terrainMesh = createIndexedMesh(gl, payload.mesh.positions, payload.mesh.indices, payload.mesh.normals);
    terrainLifecycle.creates += 1;
    terrainLifecycle.createTimingMs.push(monotonicNow() - startedAt);
    dirty = true;
    return terrainResourceSnapshot();
  }

  function deactivateTerrainResource() {
    if (stopped) throw new Error('PREVIEW_TERRAIN_RESOURCE_RENDERER_STOPPED');
    if (!terrainMesh) throw new Error('PREVIEW_TERRAIN_RESOURCE_NOT_ACTIVE');
    const startedAt = monotonicNow();
    destroyMesh(gl, terrainMesh);
    terrainMesh = null;
    terrainLifecycle.destroys += 1;
    terrainLifecycle.destroyTimingMs.push(monotonicNow() - startedAt);
    dirty = true;
    return terrainResourceSnapshot();
  }

  function resize() {
    actualPixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxDpr ?? 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * actualPixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * actualPixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      dirty = true;
    }
  }

  function drawMesh(program, mesh, viewProj, color = null) {
    if (!mesh || mesh.count === 0) return;
    gl.useProgram(program);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uViewProj'), false, viewProj);
    if (color) gl.uniform4fv(gl.getUniformLocation(program, 'uColor'), color);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    gl.bindVertexArray(null);
  }

  const roadColor = new Float32Array([0.18, 0.2, 0.21, 1]);
  const resolvedColor = new Float32Array([0.66, 0.73, 0.77, 1]);
  const fallbackColor = new Float32Array([0.48, 0.53, 0.56, 1]);

  function currentDrawCallsPerFrame() {
    return [terrainMesh, roadMesh, resolvedMesh, fallbackMesh].filter((mesh) => mesh?.count > 0).length;
  }

  function draw(now) {
    if (stopped) return;
    resize();
    if (dirty) {
      dirty = false;
      try {
        const drawStartedAt = monotonicNow();
        const viewProj = cameraViewProjection(camera, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawMesh(terrainProgram, terrainMesh, viewProj);
        drawMesh(flatProgram, roadMesh, viewProj, roadColor);
        drawMesh(flatProgram, resolvedMesh, viewProj, resolvedColor);
        drawMesh(flatProgram, fallbackMesh, viewProj, fallbackColor);
        gl.flush();
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`WEBGL2_FRAME_ERROR_${error}`);
        const frame = {
          at: now,
          drawGapMs: lastDrawAt ? now - lastDrawAt : null,
          drawCpuMs: monotonicNow() - drawStartedAt,
          drawCalls: currentDrawCallsPerFrame(),
          backend: 'webgl2',
          pixelRatio: actualPixelRatio,
          camera: { yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance },
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
    }
    requestAnimationFrame(draw);
  }

  const removeControls = installPreviewSceneControls(canvas, camera, () => { dirty = true; });
  const observer = new ResizeObserver(() => { dirty = true; });
  observer.observe(canvas);
  resize();
  const rendererInitCpuMs = monotonicNow() - initStartedAt;
  requestAnimationFrame(draw);

  return {
    header: scene.header,
    firstFrame,
    stats: {
      ...scene.stats,
      backend: 'webgl2',
      graphics_profile: profile.id ?? 'balanced',
      max_dpr: profile.maxDpr ?? 1.5,
      get pixel_ratio() { return actualPixelRatio; },
      msaa_samples: profile.webglAntialias === false ? 1 : null,
      power_preference: profile.powerPreference ?? 'default',
      get draw_calls_per_frame() { return currentDrawCallsPerFrame(); },
      get gpu_buffer_count() { return vectorGpuBufferCount + (terrainMesh ? 3 : 0); },
      get gpu_buffer_payload_bytes() { return vectorGpuPayloadBytes + (terrainMesh ? terrainGpuPayloadBytes : 0); },
      timestamp_query_supported: false,
      timing_ms: {
        scene_build_cpu_ms: sceneBuildCpuMs,
        gpu_resource_apply_cpu_ms: gpuResourceApplyCpuMs,
        renderer_init_cpu_ms: rendererInitCpuMs,
      },
    },
    getTerrainResourceLifecycle: terrainResourceSnapshot,
    activateTerrainResource,
    deactivateTerrainResource,
    invalidate() { dirty = true; },
    dispose() {
      stopped = true;
      observer.disconnect();
      removeControls();
      if (!firstFrameSettled) {
        firstFrameSettled = true;
        firstFrameReject(new Error('WEBGL2_DISPOSED_BEFORE_FIRST_FRAME'));
      }
      if (terrainMesh) {
        destroyMesh(gl, terrainMesh);
        terrainMesh = null;
      }
      destroyMesh(gl, roadMesh);
      destroyMesh(gl, resolvedMesh);
      destroyMesh(gl, fallbackMesh);
      gl.deleteProgram(terrainProgram);
      gl.deleteProgram(flatProgram);
    },
  };
}