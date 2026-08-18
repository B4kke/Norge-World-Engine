import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DEFAULT_DIST_ROOT = resolve(APP_ROOT, 'dist');
const DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/B4kke/Norge-World-Engine/preview-runtime/nannestad-preview-1/manifest.json';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const WEBGPU_PROBE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>NWE WebGPU capability probe</title>
<script type="module">
const reportUrl = new URLSearchParams(location.search).get('report');
const send = async (payload) => fetch(reportUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
  cache: 'no-store',
});
try {
  if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WEBGPU_ADAPTER_UNAVAILABLE');
  const device = await adapter.requestDevice();
  let lostInfo = null;
  device.lost.then((info) => { lostInfo = { reason: info?.reason ?? 'unknown', message: info?.message ?? '' }; });
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.append(canvas);
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WEBGPU_CANVAS_CONTEXT_UNAVAILABLE');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const encoder = device.createCommandEncoder({ label: 'nwe-capability-probe' });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.02, g: 0.03, b: 0.04, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (lostInfo) throw new Error('WEBGPU_DEVICE_LOST_' + lostInfo.reason + ': ' + lostInfo.message);
  const info = adapter.info ?? {};
  await send({
    schema: 'nwe.webgpu-capability-probe/0.1',
    status: 'PASS',
    adapter_info: {
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
    },
    preferred_canvas_format: format,
    timestamp_query_supported: adapter.features?.has?.('timestamp-query') ?? false,
  });
} catch (error) {
  await send({
    schema: 'nwe.webgpu-capability-probe/0.1',
    status: 'FAIL',
    error: error instanceof Error ? error.message : String(error),
  });
}
</script>`;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    result[token.slice(2)] = value;
    index += 1;
  }
  return result;
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const candidate of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('sh', ['-lc', `command -v ${candidate}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (found) return found;
    } catch {}
  }
  throw new Error('Chrome/Chromium not found; set CHROME_BIN');
}

function safePath(root, relative) {
  const normalized = decodeURIComponent(relative).replace(/^\/+/, '');
  const target = resolve(root, normalized || 'index.html');
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(prefix)) return null;
  return target;
}

function rawSourceCall(url) {
  const lower = String(url).toLowerCase();
  return ['kartverket.no', 'geonorge.no', 'vegvesen.no', 'nvdb', 'overpass', 'openstreetmap.org'].some((marker) => lower.includes(marker));
}

function summarizeReport(report, requestedBackend) {
  if (report?.status === 'FAIL') {
    const text = `${report.code ?? ''} ${report.error ?? ''}`;
    const capabilityFailure = requestedBackend === 'webgpu' && /WEBGPU_(UNAVAILABLE|ADAPTER_UNAVAILABLE|CANVAS_CONTEXT_UNAVAILABLE)|CLIENT_CAPABILITY_BLOCKED/.test(text);
    if (capabilityFailure) return { status: 'UNAVAILABLE', requested_backend: requestedBackend, detail: text.trim() };
    throw new Error(`${requestedBackend}: browser report failed: ${text}`);
  }
  if (!report || report.schema !== 'nwe.world-preview-browser-smoke/0.1' || report.status !== 'PASS') {
    throw new Error(`${requestedBackend}: invalid browser report ${JSON.stringify(report)}`);
  }
  if (report.phase !== 'REAL WORLD READY') throw new Error(`${requestedBackend}: phase ${report.phase}`);
  const result = report.result;
  if (result?.schema !== 'nwe.world-preview-runtime/0.1' || result.status !== 'PASS') throw new Error(`${requestedBackend}: invalid runtime result`);
  if (result.renderer?.backend !== requestedBackend) throw new Error(`${requestedBackend}: active backend was ${result.renderer?.backend}`);
  if (result.renderer?.fallback) throw new Error(`${requestedBackend}: forced backend unexpectedly fell back`);

  const runtimeRequests = report.runtime_requests ?? [];
  if (runtimeRequests.length !== 7) throw new Error(`${requestedBackend}: expected 7 runtime requests, got ${runtimeRequests.length}`);
  if (runtimeRequests.some(rawSourceCall)) throw new Error(`${requestedBackend}: raw-source runtime request observed`);

  const artifactSha256 = {
    terrain: result.terrain?.artifact_sha256,
    roads: result.roads?.artifact_sha256,
    buildings: result.buildings?.artifact_sha256,
  };
  for (const [layer, sha256] of Object.entries(artifactSha256)) {
    const expected = result.manifest?.[layer]?.artifact_sha256;
    if (!expected || sha256 !== expected) throw new Error(`${requestedBackend}: ${layer} artifact identity mismatch`);
    if (result[layer]?.verification_code !== 'RUNTIME_VERIFICATION_PASS') throw new Error(`${requestedBackend}: ${layer} provenance verification failed`);
  }

  return {
    status: 'PASS',
    requested_backend: requestedBackend,
    active_backend: result.renderer.backend,
    graphics_profile: result.graphics_profile,
    tile_id: result.tile_id,
    artifact_sha256: artifactSha256,
    runtime_request_count: runtimeRequests.length,
    raw_source_runtime_calls: 0,
    input_to_first_frame_ready_ms: result.timing_ms?.input_to_first_frame_ready_ms ?? null,
    startup_raf_gap: result.timing_ms?.startup_raf_gap ?? null,
    repeated_draw: result.timing_ms?.renderer_frame_benchmark ?? null,
    first_frame: result.renderer?.first_frame ?? null,
    draw_calls_per_frame: result.renderer?.draw_calls_per_frame ?? null,
    scene_build_cpu_ms: result.renderer?.timing_ms?.scene_build_cpu_ms ?? null,
    gpu_resource_apply_cpu_ms: result.renderer?.timing_ms?.gpu_resource_apply_cpu_ms ?? null,
    renderer_init_cpu_ms: result.renderer?.timing_ms?.renderer_init_cpu_ms ?? null,
    adapter_device_cpu_ms: result.renderer?.timing_ms?.adapter_device_cpu_ms ?? null,
    gpu_buffer_count: result.renderer?.gpu_buffer_count ?? null,
    gpu_buffer_payload_bytes: result.renderer?.gpu_buffer_payload_bytes ?? null,
    gpu_attachment_estimated_bytes: result.renderer?.gpu_attachment_estimated_bytes ?? null,
    timestamp_query_supported: result.renderer?.timestamp_query_supported ?? false,
    terrain_retained_bytes: result.terrain?.retained_bytes ?? null,
    terrain_vertices: result.renderer?.terrain_vertices ?? null,
    terrain_triangles: result.renderer?.terrain_triangles ?? null,
    road_paths: result.roads?.count ?? null,
    building_footprints: result.buildings?.count ?? null,
    browser_memory: result.browser_memory ?? null,
  };
}

function assertComparable(webgl2, webgpu) {
  if (webgl2.status !== 'PASS' || webgpu.status !== 'PASS') return false;
  for (const key of ['tile_id', 'graphics_profile', 'terrain_vertices', 'terrain_triangles', 'road_paths', 'building_footprints']) {
    if (webgl2[key] !== webgpu[key]) throw new Error(`comparison mismatch for ${key}: ${webgl2[key]} != ${webgpu[key]}`);
  }
  for (const layer of ['terrain', 'roads', 'buildings']) {
    if (webgl2.artifact_sha256[layer] !== webgpu.artifact_sha256[layer]) throw new Error(`comparison artifact mismatch for ${layer}`);
  }
  return true;
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolvePromise(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopChrome(child, profile) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  const exited = await waitForChildExit(child, 1500);
  if (!exited) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await waitForChildExit(child, 500);
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (error) {
    console.warn(`benchmark profile cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function chromeArgs({ profile, webgpu }) {
  const args = [
    '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
    `--user-data-dir=${profile}`,
  ];
  if (webgpu) {
    // Mirrors Chromium's webgpu-swiftshader test adapter strategy. Hosted evidence remains directional.
    args.push(
      '--enable-unsafe-webgpu',
      '--use-webgpu-adapter=swiftshader',
      '--disable-dawn-features=disallow_unsafe_apis',
      '--use-gpu-in-tests',
      '--enable-accelerated-2d-canvas',
    );
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distRoot = resolve(args['dist-root'] ?? DEFAULT_DIST_ROOT);
  const output = resolve(args.output ?? 'preview1-renderer-benchmark.json');
  const timeoutMs = Number(args['timeout-ms'] ?? '90000');
  const graphics = args.graphics ?? 'balanced';
  const frameCount = Number(args.frames ?? '90');
  const manifestUrl = args['manifest-url'] ?? DEFAULT_MANIFEST_URL;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  if (!Number.isInteger(frameCount) || frameCount < 10 || frameCount > 600) throw new Error('--frames must be within [10, 600]');

  const reportHandlers = new Map();
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const reportHandler = reportHandlers.get(url.pathname);
      if (req.method === 'POST' && reportHandler) {
        reportHandler(req, res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/__webgpu_probe.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(WEBGPU_PROBE_HTML);
        return;
      }
      const relative = url.pathname === '/' ? 'index.html' : url.pathname;
      const filePath = safePath(distRoot, relative);
      if (!filePath) {
        res.writeHead(403).end('forbidden');
        return;
      }
      let bytes;
      try {
        bytes = readFileSync(filePath);
      } catch {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(bytes);
    } catch (error) {
      res.writeHead(500).end(error instanceof Error ? error.stack : String(error));
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('benchmark server did not expose a port');
  const origin = `http://127.0.0.1:${port}`;
  const chrome = findChrome();
  let reportSequence = 0;

  async function executeBrowser({ label, webgpu = false, buildUrl }) {
    reportSequence += 1;
    const reportPath = `/__browser_report/${reportSequence}-${label}`;
    let resolveReport;
    let rejectReport;
    const reportPromise = new Promise((resolvePromise, rejectPromise) => {
      resolveReport = resolvePromise;
      rejectReport = rejectPromise;
    });
    reportHandlers.set(reportPath, (req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          resolveReport(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          res.writeHead(204).end();
        } catch (error) {
          rejectReport(error);
          res.writeHead(400).end(String(error));
        }
      });
    });

    const profile = mkdtempSync(resolve(tmpdir(), `nwe-${label}-${Date.now()}-`));
    const reportUrl = `${origin}${reportPath}`;
    const targetUrl = buildUrl(reportUrl);
    const child = spawn(chrome, [...chromeArgs({ profile, webgpu }), targetUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let chromeLog = '';
    child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
    child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });

    let timeoutHandle;
    const timeoutPromise = new Promise((_, rejectPromise) => {
      timeoutHandle = setTimeout(() => {
        rejectPromise(new Error(`${label} timed out after ${timeoutMs} ms\n${chromeLog.slice(-5000)}`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([reportPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reportHandlers.delete(reportPath);
      await stopChrome(child, profile);
    }
  }

  function previewUrl(backend, reportUrl) {
    const query = new URLSearchParams({
      renderer: backend,
      graphics,
      previewManifest: manifestUrl,
      previewReport: reportUrl,
      previewBenchmarkFrames: String(frameCount),
    });
    return `${origin}/?${query}`;
  }

  try {
    const webgl2 = summarizeReport(await executeBrowser({
      label: 'webgl2',
      buildUrl: (reportUrl) => previewUrl('webgl2', reportUrl),
    }), 'webgl2');

    const webgpuProbe = await executeBrowser({
      label: 'webgpu-probe',
      webgpu: true,
      buildUrl: (reportUrl) => `${origin}/__webgpu_probe.html?report=${encodeURIComponent(reportUrl)}`,
    });
    if (webgpuProbe?.schema !== 'nwe.webgpu-capability-probe/0.1') {
      throw new Error(`invalid WebGPU capability probe: ${JSON.stringify(webgpuProbe)}`);
    }

    let webgpu;
    if (webgpuProbe.status === 'PASS') {
      webgpu = summarizeReport(await executeBrowser({
        label: 'webgpu',
        webgpu: true,
        buildUrl: (reportUrl) => previewUrl('webgpu', reportUrl),
      }), 'webgpu');
    } else {
      webgpu = {
        status: 'UNAVAILABLE',
        requested_backend: 'webgpu',
        detail: `minimal hosted WebGPU probe failed: ${webgpuProbe.error ?? 'unknown error'}`,
      };
    }

    const sameInputs = assertComparable(webgl2, webgpu);
    const report = {
      schema: 'nwe.world-preview-renderer-benchmark/0.1',
      status: sameInputs ? 'PASS' : 'PARTIAL',
      evidence_class: 'hosted-headless-chrome',
      manifest_url: manifestUrl,
      graphics_profile: graphics,
      requested_repeated_draw_frames: frameCount,
      camera_contract: 'apps/world-viewer/src/preview1SceneGeometry.mjs#createPreviewCamera',
      same_inputs_proven: sameInputs,
      hosted_webgpu_probe: webgpuProbe,
      runs: { webgl2, webgpu },
      interpretation: sameInputs
        ? 'Same-artifact hosted comparison completed. Still do not select WebGPU/WebGL2 or claim Android GPU performance from this runner.'
        : 'Hosted WebGPU control capability was unavailable, so no WebGPU/WebGL2 performance comparison is claimed. WebGL2 evidence remains valid; use a real WebGPU-capable device next.',
    };
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
