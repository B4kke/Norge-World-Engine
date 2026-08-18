import { verifyRuntimeBundleWeb } from '/engine/streaming/runtime_verifier_web.mjs';
import { TerrainMeshWorkerClient } from '/engine/streaming/terrain_mesh_worker_client.mjs';
import { createTerrainTileLoadFunction } from '/engine/streaming/terrain_tile_loader.mjs';
import { TileStreamingScheduler } from '/engine/streaming/tile_scheduler.mjs';
import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';

const statusEl = document.querySelector('#status');
const metricsEl = document.querySelector('#metrics');
const canvas = document.querySelector('#gl');
const params = new URLSearchParams(location.search);
const autorun = params.get('autorun') === '1';
const bundleUrl = params.get('bundle') || '/runtime/terrain.bundle.json';

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

function waitFrames(count = 2) {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function createProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    return shader;
  };
  const program = gl.createProgram();
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  return program;
}

function setupRenderer() {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: true, alpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  canvas.width = 960;
  canvas.height = 720;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.025, 0.055, 0.075, 1);
  gl.enable(gl.DEPTH_TEST);
  const program = createProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    out float vHeight;
    void main() {
      float x = aPosition.x / 570.0;
      float z = aPosition.z / 570.0;
      float y = aPosition.y / 180.0 - 0.62;
      gl_Position = vec4(x, z * 0.82 + y * 0.18, 0.15 + y * 0.05, 1.0);
      vHeight = aPosition.y;
    }`, `#version 300 es
    precision highp float;
    in float vHeight;
    out vec4 outColor;
    void main() {
      float shade = clamp(vHeight / 80.0, 0.0, 1.0);
      outColor = vec4(0.18 + shade * 0.35, 0.42 + shade * 0.28, 0.30 + shade * 0.18, 1.0);
    }`);
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
    gapsBetween(start, end) { return samples.filter((item) => item.time >= start && item.time <= end).map((item) => item.gap); },
    allGaps() { return samples.map((item) => item.gap); },
  };
}

async function run() {
  if (typeof Worker !== 'function') throw new Error('Dedicated Worker API unavailable');
  const tileId = params.get('tileId');
  const centerE = Number(params.get('centerE'));
  const centerN = Number(params.get('centerN'));
  if (!tileId) throw new Error('tileId query parameter is required');
  if (!Number.isFinite(centerE) || !Number.isFinite(centerN)) throw new Error('centerE/centerN query parameters are required');

  const rendererSetupStart = performance.now();
  const { gl, program } = setupRenderer();
  const rendererSetupMs = performance.now() - rendererSetupStart;
  const raf = createRafMonitor();
  await waitFrames(3);

  const workerClient = new TerrainMeshWorkerClient();
  const gpuResources = new Map();
  const gpuApplyMs = [];
  const gpuSyncMs = [];
  let firstPayload = null;
  let firstVisibleMs = null;
  let resolverCalls = 0;

  const disposeGpu = (tile) => {
    const resource = gpuResources.get(tile.id);
    if (!resource) return;
    gl.deleteBuffer(resource.positionBuffer);
    gl.deleteBuffer(resource.indexBuffer);
    gl.deleteVertexArray(resource.vao);
    gpuResources.delete(tile.id);
  };

  const activateTile = async (tile, payload) => {
    if (!firstPayload) firstPayload = payload;
    const applyStart = performance.now();
    disposeGpu(tile);
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, payload.mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, payload.mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const applyEnd = performance.now();
    gpuApplyMs.push(applyEnd - applyStart);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    const type = payload.mesh.indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
    gl.drawElements(gl.TRIANGLES, payload.mesh.indices.length, type, 0);
    const syncStart = performance.now();
    gl.finish();
    const syncEnd = performance.now();
    gpuSyncMs.push(syncEnd - syncStart);
    gl.bindVertexArray(null);
    gpuResources.set(tile.id, { vao, positionBuffer, indexBuffer });
    if (firstVisibleMs == null) firstVisibleMs = syncEnd;
  };

  const loadTile = createTerrainTileLoadFunction({
    resolveRuntimeInput: async (tile, { signal }) => {
      resolverCalls += 1;
      return loadTerrainRuntimeInput({
        bundleUrl,
        expectedTileId: tile.id,
        fetchImpl: (url, options) => fetch(url, { ...options, signal }),
      });
    },
    verifyBundle: (bundle, artifactBytes) => verifyRuntimeBundleWeb(bundle, artifactBytes),
    meshWorkerClient: workerClient,
    meshOptionsForTile: ({ header }) => ({
      outputSize: 129,
      originE: (header.bounds[0] + header.bounds[2]) / 2,
      originN: (header.bounds[1] + header.bounds[3]) / 2,
      originH: header.elevation_min_m,
    }),
  });

  const scheduler = new TileStreamingScheduler({
    loadTile,
    activateTile,
    deactivateTile: async (tile) => disposeGpu(tile),
    disposeTile: async (tile) => disposeGpu(tile),
    activeRadiusMeters: 20,
    retainRadiusMeters: 50,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxCacheBytes: 16 * 1024 * 1024,
  });
  const tile = { id: tileId, centerE, centerN };

  const loadStart = performance.now();
  await scheduler.update({ e: centerE, n: centerN }, [tile]);
  let snapshot = await scheduler.whenIdle();
  const loadEnd = performance.now();
  await waitFrames(3);

  if (snapshot.metrics.loadsCompleted !== 1 || snapshot.metrics.loadsFailed !== 0 || snapshot.metrics.residentCount !== 1) {
    throw new Error(`unexpected initial scheduler state: ${JSON.stringify(snapshot.metrics)}`);
  }
  if (!firstPayload || firstPayload.verification.code !== 'RUNTIME_VERIFICATION_PASS') throw new Error('terrain payload was not fully verified');
  if (firstPayload.mesh.metadata.vertexCount !== 16641 || firstPayload.mesh.metadata.triangleCount !== 32768) {
    throw new Error(`unexpected mesh shape: ${JSON.stringify(firstPayload.mesh.metadata)}`);
  }
  if (resolverCalls !== 1) throw new Error(`initial scheduler load resolved terrain input ${resolverCalls} times`);

  const outsideStart = performance.now();
  await scheduler.update({ e: centerE + 10000, n: centerN + 10000 }, [tile]);
  snapshot = await scheduler.whenIdle();
  const outsideIdle = performance.now();
  await waitFrames(2);
  if (snapshot.metrics.cachedCount !== 1 || snapshot.metrics.residentCount !== 0) {
    throw new Error(`tile did not enter cache after camera exit: ${JSON.stringify(snapshot.metrics)}`);
  }

  const returnStart = performance.now();
  await scheduler.update({ e: centerE, n: centerN }, [tile]);
  snapshot = await scheduler.whenIdle();
  const returnEnd = performance.now();
  await waitFrames(3);
  const finish = performance.now();

  if (snapshot.metrics.loadsStarted !== 1 || snapshot.metrics.cacheHits !== 1 || snapshot.metrics.residentCount !== 1) {
    throw new Error(`cache return caused unexpected reload/state: ${JSON.stringify(snapshot.metrics)}`);
  }
  if (resolverCalls !== 1) throw new Error(`cache return unexpectedly resolved terrain input again; calls=${resolverCalls}`);

  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  const rawSourceCalls = resources.filter((url) => /(geonorge|kartverket|vegvesen|nvdb|overpass|openstreetmap)/i.test(url)).length;
  const runtimeRequests = resources.filter((url) => url.includes('/runtime/')).length;
  if (rawSourceCalls !== 0) throw new Error(`raw source network calls detected: ${rawSourceCalls}`);
  if (runtimeRequests !== 2) throw new Error(`expected exactly bundle + compiled artifact runtime requests, got ${runtimeRequests}`);

  raf.stop();
  const result = {
    schema: 'nwe.browser-terrain-worker-streaming-proof/0.2',
    status: 'PASS',
    tile_id: tileId,
    artifact_sha256: firstPayload.artifact.sha256,
    verification_code: firstPayload.verification.code,
    worker_boundary: 'module DedicatedWorker via TerrainMeshWorkerClient default workerFactory',
    renderer_boundary: 'WebGL2 measurement harness only; no renderer decision',
    mesh: firstPayload.mesh.metadata,
    scheduler: snapshot.metrics,
    retained_bytes: snapshot.records.find((record) => record.id === tileId)?.byteSize ?? null,
    loader_timing_ms: firstPayload.timingMs,
    browser_timing_ms: {
      renderer_setup: finiteMs(rendererSetupMs),
      initial_bundle_to_idle: finiteMs(loadEnd - loadStart),
      initial_bundle_to_first_visible: firstVisibleMs == null ? null : finiteMs(firstVisibleMs - loadStart),
      camera_exit_to_cached_idle: finiteMs(outsideIdle - outsideStart),
      cache_return_to_idle: finiteMs(returnEnd - returnStart),
      total_experiment: finiteMs(finish - loadStart),
      gpu_apply: summarize(gpuApplyMs),
      gpu_finish: summarize(gpuSyncMs),
    },
    raf_gap_ms: {
      during_initial_load: summarize(raf.gapsBetween(loadStart, loadEnd)),
      whole_experiment: summarize(raf.allGaps()),
    },
    network: {
      resource_requests: resources.length,
      raw_source_calls: rawSourceCalls,
      runtime_bundle_artifact_requests: runtimeRequests,
      terrain_resolver_calls: resolverCalls,
    },
    capabilities: {
      worker: typeof Worker === 'function',
      webcrypto: Boolean(globalThis.crypto?.subtle),
      webgl2: true,
      cross_origin_isolated: globalThis.crossOriginIsolated === true,
    },
  };
  statusEl.textContent = 'PASS';
  metricsEl.textContent = JSON.stringify(result, null, 2);
  if (autorun) {
    await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
  }
  return result;
}

run().catch(async (error) => {
  const result = { schema: 'nwe.browser-terrain-worker-streaming-proof/0.2', status: 'FAIL', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  statusEl.textContent = 'FAIL';
  metricsEl.textContent = JSON.stringify(result, null, 2);
  if (autorun) {
    try { await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) }); } catch {}
  }
  console.error(error);
});
