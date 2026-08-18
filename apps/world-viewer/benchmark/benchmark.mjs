import { loadCompiledJsonArtifact } from '../artifact_consumer.mjs';
import { LOCAL_ORIGIN, TILE_BOUNDS, TILE_LOCAL_BOUNDS, buildVectorBenchmarkGeometry, traceVisibleObjectAtWorld, worldFromCanvas } from './geometry.mjs';
import { parseBenchmarkFrameCount } from './params.mjs';

const RAW_SOURCE_MARKERS = ['geonorge', 'kartverket', 'vegvesen', 'nvdb', 'overpass', 'openstreetmap'];
const params = new URLSearchParams(location.search);
const autorun = params.get('autorun') === '1';
const requestedFrames = params.get('frames');
const warmupFrames = 10;
let sampleFrames = null;
let frameClockFallbacks = 0;
const network = [];
const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const rawMarker = RAW_SOURCE_MARKERS.find((marker) => url.href.toLowerCase().includes(marker));
  network.push({ url: url.href, raw_marker: rawMarker ?? null });
  if (rawMarker) throw new Error(`RAW_SOURCE_NETWORK_FORBIDDEN:${rawMarker}:${url.href}`);
  if (url.origin !== location.origin) throw new Error(`EXTERNAL_RUNTIME_NETWORK_FORBIDDEN:${url.href}`);
  return nativeFetch(input, init);
};

const els = {
  status: document.querySelector('#status'),
  metrics: document.querySelector('#metrics'),
  debug: document.querySelector('#debug'),
  canvas: document.querySelector('#gl'),
};

function now() { return performance.now(); }
function sleepFrame() {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      frameClockFallbacks += 1;
      resolve(performance.now());
    }, 100);
    requestAnimationFrame((time) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(time);
    });
  });
}
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return {
    samples: samples.length,
    avg_ms: average,
    p50_ms: percentile(sorted, 0.50),
    p95_ms: percentile(sorted, 0.95),
    max_ms: sorted.at(-1) ?? null,
    fps_from_avg: average > 0 ? 1000 / average : null,
  };
}
function heapSnapshot() {
  const memory = performance.memory;
  if (!memory) return null;
  return {
    used_js_heap_bytes: memory.usedJSHeapSize,
    total_js_heap_bytes: memory.totalJSHeapSize,
    js_heap_limit_bytes: memory.jsHeapSizeLimit,
  };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function createRenderer(canvas, geometry) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) throw new Error('WEBGL2_REQUIRED');
  const vs = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec3 aPosition;
    in vec3 aColor;
    uniform vec4 uBounds;
    out vec3 vColor;
    void main() {
      float nx = ((aPosition.x - uBounds.x) / (uBounds.z - uBounds.x)) * 2.0 - 1.0;
      float ny = ((aPosition.y - uBounds.y) / (uBounds.w - uBounds.y)) * 2.0 - 1.0;
      gl_Position = vec4(nx, ny, 0.0, 1.0);
      vColor = aColor;
    }
  `);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    in vec3 vColor;
    out vec4 outColor;
    void main() { outColor = vec4(vColor, 1.0); }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  const colorLocation = gl.getAttribLocation(program, 'aColor');
  const boundsLocation = gl.getUniformLocation(program, 'uBounds');

  function makeVao(positions, colors) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, count: positions.length / 3, bytes: positions.byteLength + colors.byteLength };
  }

  const road = makeVao(geometry.roadPositions, geometry.roadColors);
  const building = makeVao(geometry.buildingPositions, geometry.buildingColors);
  gl.useProgram(program);
  gl.uniform4f(boundsLocation, TILE_LOCAL_BOUNDS[0], TILE_LOCAL_BOUNDS[1], TILE_LOCAL_BOUNDS[2], TILE_LOCAL_BOUNDS[3]);
  gl.clearColor(0.025, 0.055, 0.075, 1.0);
  gl.lineWidth(1);

  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function draw(mode) {
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT);
    let drawCalls = 0;
    gl.useProgram(program);
    gl.bindVertexArray(road.vao);
    if (mode === 'per-object') {
      for (const range of geometry.roadRanges) {
        gl.drawArrays(gl.LINES, range.first, range.count);
        drawCalls += 1;
      }
    } else {
      gl.drawArrays(gl.LINES, 0, road.count);
      drawCalls += road.count > 0 ? 1 : 0;
    }
    gl.bindVertexArray(building.vao);
    if (mode === 'per-object') {
      for (const range of geometry.buildingRanges) {
        gl.drawArrays(gl.LINES, range.first, range.count);
        drawCalls += 1;
      }
    } else {
      gl.drawArrays(gl.LINES, 0, building.count);
      drawCalls += building.count > 0 ? 1 : 0;
    }
    gl.bindVertexArray(null);
    gl.finish();
    return drawCalls;
  }

  return {
    gl,
    draw,
    gpuBufferBytes: road.bytes + building.bytes,
    rendererInfo: {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shading_language_version: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    },
  };
}

async function loadRole(role, bundleUrl) {
  const start = now();
  const result = await loadCompiledJsonArtifact({
    bundleUrl,
    expectedRole: role,
    resolveTransport: () => role === 'road-network' ? '/runtime/roads.artifact.json' : '/runtime/buildings.artifact.json',
  });
  const end = now();
  return { ...result, verifyDecodeMs: end - start };
}

async function benchmarkMode(renderer, mode, onFirstVisible = null) {
  const firstStart = now();
  const drawCalls = renderer.draw(mode);
  await sleepFrame();
  const firstVisibleMs = now() - firstStart;
  if (onFirstVisible) onFirstVisible(now());
  for (let index = 0; index < warmupFrames; index += 1) {
    renderer.draw(mode);
    await sleepFrame();
  }

  const samples = [];
  const renderSamples = [];
  let previous = await sleepFrame();
  for (let index = 0; index < sampleFrames; index += 1) {
    const renderStart = now();
    renderer.draw(mode);
    renderSamples.push(now() - renderStart);
    const current = await sleepFrame();
    samples.push(current - previous);
    previous = current;
  }
  return {
    mode,
    draw_calls: drawCalls,
    first_visible_ms: firstVisibleMs,
    frame_time: stats(samples),
    render_sync_time: stats(renderSamples),
    js_heap: heapSnapshot(),
  };
}

function renderMetrics(result) {
  els.metrics.textContent = JSON.stringify(result, null, 2);
}

async function run() {
  sampleFrames = parseBenchmarkFrameCount(requestedFrames);
  const bootStart = now();
  els.status.textContent = 'verifying compiled artifacts…';
  const [roads, buildings] = await Promise.all([
    loadRole('road-network', '/runtime/roads.bundle.json'),
    loadRole('building-footprints', '/runtime/buildings.bundle.json'),
  ]);
  const geometryStart = now();
  const geometry = buildVectorBenchmarkGeometry(roads.artifact, buildings.artifact);
  const geometryBuildMs = now() - geometryStart;

  const uploadStart = now();
  const renderer = createRenderer(els.canvas, geometry);
  const gpuUploadMs = now() - uploadStart;

  let bootToFirstVisibleMs = null;
  const baseline = await benchmarkMode(renderer, 'per-object', (visibleAt) => { bootToFirstVisibleMs = visibleAt - bootStart; });
  const batched = await benchmarkMode(renderer, 'batched');
  const rawSourceCalls = network.filter((entry) => entry.raw_marker).length;
  if (rawSourceCalls !== 0) throw new Error(`raw source network calls: ${rawSourceCalls}`);
  if (baseline.draw_calls !== geometry.objectCounts.total_objects) {
    throw new Error(`baseline draw-call mismatch: ${baseline.draw_calls} != ${geometry.objectCounts.total_objects}`);
  }
  if (batched.draw_calls > 2) throw new Error(`batched path unexpectedly used ${batched.draw_calls} draw calls`);

  const result = {
    schema: 'nwe.viewer-batching-benchmark/0.1',
    status: 'PASS',
    tile_id: geometry.tileId,
    camera_contract: {
      mode: 'fixed-top-down-full-tile',
      bounds_epsg25832: TILE_BOUNDS,
      local_origin_epsg25832: LOCAL_ORIGIN,
      gpu_bounds_local_m: TILE_LOCAL_BOUNDS,
      z_policy: 'artifact-z-preserved-in-buffer-but-ignored-by-top-down-projection',
      building_height_policy: 'no-debug-extrusion; footprint-only batching benchmark',
    },
    artifact_inputs: {
      roads: { sha256: roads.artifactRef.sha256, byte_size: roads.artifactRef.byte_size, verify_decode_ms: roads.verifyDecodeMs },
      buildings: { sha256: buildings.artifactRef.sha256, byte_size: buildings.artifactRef.byte_size, verify_decode_ms: buildings.verifyDecodeMs },
    },
    scene: {
      geometry_build_ms: geometryBuildMs,
      gpu_upload_ms: gpuUploadMs,
      gpu_buffer_bytes: renderer.gpuBufferBytes,
      object_counts: geometry.objectCounts,
      vertex_counts: geometry.vertexCounts,
    },
    renderer: renderer.rendererInfo,
    baseline,
    batched,
    comparison: {
      draw_call_reduction: baseline.draw_calls - batched.draw_calls,
      draw_call_reduction_ratio: baseline.draw_calls > 0 ? 1 - batched.draw_calls / baseline.draw_calls : 0,
      below_100_draw_calls: batched.draw_calls < 100,
    },
    boot_to_first_visible_ms: bootToFirstVisibleMs,
    boot_to_result_ms: now() - bootStart,
    frame_clock: { request_animation_frame_timeout_ms: 100, fallback_count: frameClockFallbacks },
    runtime_network: {
      raw_source_calls: rawSourceCalls,
      total_fetches: network.length,
      requests: network,
    },
  };

  window.__NWE_BENCHMARK_RESULT__ = result;
  window.__NWE_BENCHMARK_GEOMETRY__ = geometry;
  window.__NWE_BENCHMARK_RENDERER__ = renderer;
  els.status.textContent = `PASS · ${baseline.draw_calls} → ${batched.draw_calls} draw calls`;
  renderMetrics(result);
  return result;
}

els.canvas.addEventListener('click', (event) => {
  const geometry = window.__NWE_BENCHMARK_GEOMETRY__;
  if (!geometry) return;
  const world = worldFromCanvas(event.clientX, event.clientY, els.canvas.getBoundingClientRect());
  const hit = traceVisibleObjectAtWorld(geometry, world.x, world.y);
  els.debug.textContent = hit ? JSON.stringify({ world, hit }, null, 2) : JSON.stringify({ world, hit: null }, null, 2);
});

async function report(result) {
  if (!autorun) return;
  await nativeFetch('/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });
}

run().then(report).catch(async (error) => {
  const failure = { schema: 'nwe.viewer-batching-benchmark/0.1', status: 'FAIL', error: error instanceof Error ? error.stack ?? error.message : String(error), runtime_network: network };
  els.status.textContent = `FAIL · ${failure.error}`;
  renderMetrics(failure);
  if (autorun) {
    await nativeFetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(failure) });
  }
});
