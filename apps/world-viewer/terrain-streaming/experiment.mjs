import { verifyRuntimeBundleWeb } from '../../../engine/streaming/runtime_verifier_web.mjs';
import { TerrainMeshWorkerClient } from '../../../engine/streaming/terrain_mesh_worker_client.mjs';
import { createTerrainTileLoadFunction } from '../../../engine/streaming/terrain_tile_loader.mjs';
import { TileStreamingScheduler } from '../../../engine/streaming/tile_scheduler.mjs';

function finiteMs(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  if (!values.length) return { count: 0, p50_ms: null, p95_ms: null, p99_ms: null, max_ms: null };
  return {
    count: values.length,
    p50_ms: finiteMs(percentile(values, 0.50)),
    p95_ms: finiteMs(percentile(values, 0.95)),
    p99_ms: finiteMs(percentile(values, 0.99)),
    max_ms: finiteMs(Math.max(...values)),
  };
}

function waitFrames(count = 1) {
  return new Promise((resolve) => {
    let remaining = Math.max(1, count);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function createProgram(gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL shader allocation failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL program allocation failed');
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    out float vHeight;
    void main() {
      float x = aPosition.x / 620.0;
      float z = aPosition.z / 620.0;
      float y = aPosition.y / 120.0;
      gl_Position = vec4(x, z * 0.78 + y * 0.22 - 0.08, 0.18 + y * 0.05, 1.0);
      vHeight = aPosition.y;
    }`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in float vHeight;
    out vec4 outColor;
    void main() {
      float shade = clamp(vHeight / 55.0, 0.0, 1.0);
      vec3 low = vec3(0.08, 0.30, 0.20);
      vec3 high = vec3(0.53, 0.68, 0.43);
      outColor = vec4(mix(low, high, shade), 1.0);
    }`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  return program;
}

function setupRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: true, alpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  if (canvas.width < 2 || canvas.height < 2) {
    canvas.width = 960;
    canvas.height = 720;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.018, 0.043, 0.061, 1);
  gl.enable(gl.DEPTH_TEST);
  const program = createProgram(gl);
  gl.useProgram(program);
  return { gl, program };
}

function createRafMonitor() {
  const samples = [];
  let previous = null;
  let running = true;
  const tick = (time) => {
    if (!running) return;
    if (previous != null) samples.push({ time, gap: time - previous });
    previous = time;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop() { running = false; },
    gapsBetween(start, end) {
      return samples.filter((item) => item.time >= start && item.time <= end).map((item) => item.gap);
    },
    allGaps() { return samples.map((item) => item.gap); },
  };
}

export async function runTerrainStreamingExperiment({
  canvas,
  tile,
  resolveRuntimeInput,
  onPhase = () => {},
  outputSize = 129,
  activeRadiusMeters = 20,
  retainRadiusMeters = 50,
  maxCacheBytes = 16 * 1024 * 1024,
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas must be an HTMLCanvasElement');
  if (!tile || typeof tile.id !== 'string' || !Number.isFinite(tile.centerE) || !Number.isFinite(tile.centerN)) {
    throw new TypeError('tile must provide id, centerE and centerN');
  }
  if (typeof resolveRuntimeInput !== 'function') throw new TypeError('resolveRuntimeInput is required');
  if (typeof Worker !== 'function') throw new Error('Dedicated Worker API unavailable');
  if (!(retainRadiusMeters > activeRadiusMeters)) {
    throw new Error('terrain cache experiment requires retainRadiusMeters > activeRadiusMeters');
  }
  const cacheProbeDistance = activeRadiusMeters + (retainRadiusMeters - activeRadiusMeters) / 2;

  onPhase('renderer');
  const rendererSetupStart = performance.now();
  const { gl, program } = setupRenderer(canvas);
  const rendererSetupMs = performance.now() - rendererSetupStart;
  const raf = createRafMonitor();
  await waitFrames(2);

  const workerClient = new TerrainMeshWorkerClient();
  const gpuResources = new Map();
  const gpuApplyMs = [];
  const gpuSyncMs = [];
  let firstPayload = null;
  let firstVisibleAt = null;
  let resolverCalls = 0;

  const disposeGpu = (descriptor) => {
    const resource = gpuResources.get(descriptor.id);
    if (!resource) return;
    gl.deleteBuffer(resource.positionBuffer);
    gl.deleteBuffer(resource.indexBuffer);
    gl.deleteVertexArray(resource.vao);
    gpuResources.delete(descriptor.id);
  };

  const activateTile = async (descriptor, payload) => {
    if (!firstPayload) firstPayload = payload;
    onPhase(firstVisibleAt == null ? 'gpu-upload' : 'cache-reactivate');
    const applyStart = performance.now();
    disposeGpu(descriptor);
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!vao || !positionBuffer || !indexBuffer) throw new Error('WebGL buffer allocation failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, payload.mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, payload.mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gpuApplyMs.push(performance.now() - applyStart);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    const indexType = payload.mesh.indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
    gl.drawElements(gl.TRIANGLES, payload.mesh.indices.length, indexType, 0);
    const syncStart = performance.now();
    gl.finish();
    gpuSyncMs.push(performance.now() - syncStart);
    gl.bindVertexArray(null);
    gpuResources.set(descriptor.id, { vao, positionBuffer, indexBuffer });
    if (firstVisibleAt == null) {
      await waitFrames(1);
      firstVisibleAt = performance.now();
    }
  };

  const loadTile = createTerrainTileLoadFunction({
    resolveRuntimeInput: async (descriptor, { signal }) => {
      resolverCalls += 1;
      onPhase('runtime-input');
      return resolveRuntimeInput(descriptor, { signal });
    },
    verifyBundle: async (bundle, artifactBytes) => {
      onPhase('provenance');
      return verifyRuntimeBundleWeb(bundle, artifactBytes);
    },
    meshWorkerClient: {
      build: async (input) => {
        onPhase('dedicated-worker');
        return workerClient.build(input);
      },
    },
    meshOptionsForTile: ({ header }) => ({
      outputSize,
      originE: (header.bounds[0] + header.bounds[2]) / 2,
      originN: (header.bounds[1] + header.bounds[3]) / 2,
      originH: header.elevation_min_m,
    }),
  });

  const scheduler = new TileStreamingScheduler({
    loadTile,
    activateTile,
    deactivateTile: async (descriptor) => disposeGpu(descriptor),
    disposeTile: async (descriptor) => disposeGpu(descriptor),
    activeRadiusMeters,
    retainRadiusMeters,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxCacheBytes,
  });

  try {
    onPhase('initial-load');
    const loadStart = performance.now();
    await scheduler.update({ e: tile.centerE, n: tile.centerN }, [tile]);
    let snapshot = await scheduler.whenIdle();
    const loadEnd = performance.now();
    await waitFrames(2);

    if (snapshot.metrics.loadsCompleted !== 1 || snapshot.metrics.loadsFailed !== 0 || snapshot.metrics.residentCount !== 1) {
      throw new Error(`unexpected initial scheduler state: ${JSON.stringify({ metrics: snapshot.metrics, records: snapshot.records })}`);
    }
    if (!firstPayload || firstPayload.verification.code !== 'RUNTIME_VERIFICATION_PASS') {
      throw new Error('terrain payload was not fully verified');
    }
    if (firstPayload.mesh.metadata.vertexCount !== outputSize * outputSize) {
      throw new Error(`unexpected vertex count ${firstPayload.mesh.metadata.vertexCount}`);
    }
    if (resolverCalls !== 1) throw new Error(`initial load resolved terrain input ${resolverCalls} times`);

    onPhase('camera-exit');
    const outsideStart = performance.now();
    await scheduler.update({ e: tile.centerE + cacheProbeDistance, n: tile.centerN }, [tile]);
    snapshot = await scheduler.whenIdle();
    const outsideEnd = performance.now();
    await waitFrames(2);
    if (snapshot.metrics.cachedCount !== 1 || snapshot.metrics.residentCount !== 0) {
      throw new Error(`tile did not enter cache band: ${JSON.stringify({ metrics: snapshot.metrics, records: snapshot.records, cacheProbeDistance })}`);
    }

    onPhase('cache-return');
    const returnStart = performance.now();
    await scheduler.update({ e: tile.centerE, n: tile.centerN }, [tile]);
    snapshot = await scheduler.whenIdle();
    const returnEnd = performance.now();
    await waitFrames(2);
    const finish = performance.now();

    if (snapshot.metrics.loadsStarted !== 1 || snapshot.metrics.cacheHits !== 1 || snapshot.metrics.residentCount !== 1) {
      throw new Error(`cache return caused unexpected reload/state: ${JSON.stringify({ metrics: snapshot.metrics, records: snapshot.records })}`);
    }
    if (resolverCalls !== 1) throw new Error(`cache return unexpectedly resolved terrain input again; calls=${resolverCalls}`);

    onPhase('pass');
    return {
      schema: 'nwe.browser-terrain-worker-streaming-proof/0.3',
      status: 'PASS',
      tile_id: tile.id,
      artifact_sha256: firstPayload.artifact.sha256,
      verification_code: firstPayload.verification.code,
      worker_boundary: 'module DedicatedWorker via TerrainMeshWorkerClient default workerFactory',
      renderer_boundary: 'WebGL2 measurement harness only; no renderer decision',
      mesh: firstPayload.mesh.metadata,
      scheduler: snapshot.metrics,
      retained_bytes: snapshot.records.find((record) => record.id === tile.id)?.byteSize ?? null,
      loader_timing_ms: firstPayload.timingMs,
      browser_timing_ms: {
        renderer_setup: finiteMs(rendererSetupMs),
        initial_input_to_idle: finiteMs(loadEnd - loadStart),
        initial_input_to_first_visible: firstVisibleAt == null ? null : finiteMs(firstVisibleAt - loadStart),
        camera_exit_to_cached_idle: finiteMs(outsideEnd - outsideStart),
        cache_return_to_idle: finiteMs(returnEnd - returnStart),
        total_experiment: finiteMs(finish - loadStart),
        gpu_apply: summarize(gpuApplyMs),
        gpu_finish: summarize(gpuSyncMs),
      },
      raf_gap_ms: {
        during_initial_load: summarize(raf.gapsBetween(loadStart, loadEnd)),
        whole_experiment: summarize(raf.allGaps()),
      },
      resolver_calls: resolverCalls,
      cache_probe_distance_m: cacheProbeDistance,
      capabilities: {
        worker: typeof Worker === 'function',
        webcrypto: Boolean(globalThis.crypto?.subtle),
        webgl2: true,
        cross_origin_isolated: globalThis.crossOriginIsolated === true,
      },
    };
  } finally {
    raf.stop();
  }
}
