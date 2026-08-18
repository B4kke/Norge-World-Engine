import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DEFAULT_DIST_ROOT = resolve(APP_ROOT, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const EXPECTED = Object.freeze({
  tileId: 'epsg25832_611000_6677000_1000m',
  terrainSha: '780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96',
  roadsSha: '34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a',
  buildingsSha: '678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd',
});

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

function chromeArgs(profile) {
  return [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
    `--user-data-dir=${profile}`,
  ];
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
    console.warn(`device smoke profile cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function snapshotLabels(trace) {
  return (trace?.entries ?? [])
    .filter((entry) => entry?.kind === 'scheduler-snapshot')
    .map((entry) => entry?.payload?.label)
    .filter(Boolean);
}

function schedulerEventTypes(trace) {
  return (trace?.entries ?? [])
    .filter((entry) => entry?.kind === 'scheduler-event')
    .map((entry) => entry?.payload?.type)
    .filter(Boolean);
}

function assertEvidence(evidence) {
  if (!evidence || evidence.schema !== 'nwe.world-viewer-device-evidence/0.1') throw new Error('DEVICE_SMOKE_SCHEMA');
  if (evidence.status !== 'PASS') throw new Error(`DEVICE_SMOKE_STATUS: ${evidence?.error ?? 'unknown failure'}`);
  if (evidence.renderer?.active_backend !== 'webgl2') throw new Error(`DEVICE_SMOKE_BACKEND: ${evidence.renderer?.active_backend}`);
  if (!evidence.build?.git_commit_sha) throw new Error('DEVICE_SMOKE_BUILD_IDENTITY_MISSING');
  if (evidence.world?.tile_id !== EXPECTED.tileId) throw new Error(`DEVICE_SMOKE_TILE: ${evidence.world?.tile_id}`);
  if (evidence.world?.artifact_sha256?.terrain !== EXPECTED.terrainSha) throw new Error('DEVICE_SMOKE_TERRAIN_SHA');
  if (evidence.world?.artifact_sha256?.roads !== EXPECTED.roadsSha) throw new Error('DEVICE_SMOKE_ROADS_SHA');
  if (evidence.world?.artifact_sha256?.buildings !== EXPECTED.buildingsSha) throw new Error('DEVICE_SMOKE_BUILDINGS_SHA');
  if (evidence.world?.raw_source_runtime_calls !== 0) throw new Error('DEVICE_SMOKE_RAW_SOURCE_CALL');
  if (evidence.world?.runtime_request_count !== 7) throw new Error(`DEVICE_SMOKE_REQUEST_COUNT: ${evidence.world?.runtime_request_count}`);
  if (Object.values(evidence.world?.verification ?? {}).some((code) => code !== 'RUNTIME_VERIFICATION_PASS')) {
    throw new Error('DEVICE_SMOKE_PROVENANCE');
  }

  const probe = evidence.streaming?.movement_probe;
  const trace = evidence.streaming?.trace;
  if (probe?.schema !== 'nwe.single-tile-streaming-movement-probe/0.1' || probe.status !== 'PASS') throw new Error('DEVICE_SMOKE_MOVEMENT_PROBE');
  if (probe.tile_id !== EXPECTED.tileId) throw new Error('DEVICE_SMOKE_MOVEMENT_TILE');
  if (probe.resolver_calls_before !== 1 || probe.resolver_calls_after !== 1) throw new Error('DEVICE_SMOKE_REFETCH');
  if (probe.loads_started_delta !== 0) throw new Error(`DEVICE_SMOKE_LOAD_DELTA: ${probe.loads_started_delta}`);
  if (probe.cache_hits_delta !== 1) throw new Error(`DEVICE_SMOKE_CACHE_HIT_DELTA: ${probe.cache_hits_delta}`);
  if (probe.renderer_resource_lifecycle_observed !== false) throw new Error('DEVICE_SMOKE_RENDERER_BOUNDARY');

  if (trace?.schema !== 'nwe.streaming-movement-trace/0.1') throw new Error('DEVICE_SMOKE_TRACE_SCHEMA');
  if (trace.droppedEntries !== 0) throw new Error(`DEVICE_SMOKE_TRACE_DROPPED: ${trace.droppedEntries}`);
  const labels = snapshotLabels(trace);
  for (const expected of ['initial-resident', 'outside-active-inside-retain', 'returned-center']) {
    if (!labels.includes(expected)) throw new Error(`DEVICE_SMOKE_SNAPSHOT_MISSING: ${expected}`);
  }
  const events = schedulerEventTypes(trace);
  if (!events.includes('tile-deactivated')) throw new Error('DEVICE_SMOKE_DEACTIVATE_EVENT_MISSING');
  if (events.filter((type) => type === 'tile-activated').length < 2) throw new Error('DEVICE_SMOKE_REACTIVATION_EVENT_MISSING');
  if (events.filter((type) => type === 'load-started').length !== 1) throw new Error('DEVICE_SMOKE_UNEXPECTED_LOAD_COUNT');

  return {
    schema: 'nwe.device-evidence-browser-smoke-proof/0.1',
    status: 'PASS',
    evidence_class: 'hosted-headless-chrome-exact-real',
    tile_id: evidence.world.tile_id,
    artifact_sha256: evidence.world.artifact_sha256,
    verification: evidence.world.verification,
    runtime_request_count: evidence.world.runtime_request_count,
    raw_source_runtime_calls: evidence.world.raw_source_runtime_calls,
    renderer: {
      active_backend: evidence.renderer.active_backend,
      draw_calls_per_frame: evidence.renderer.draw_calls_per_frame,
    },
    movement_probe: probe,
    streaming_trace: {
      retained_entries: trace.retainedEntries,
      dropped_entries: trace.droppedEntries,
      snapshot_labels: labels,
      scheduler_event_types: events,
    },
    build: evidence.build,
    capture: evidence.capture,
    interpretation: 'Exact-real hosted Chrome proof of verified single-tile runtime/cache movement. renderer_resource_lifecycle_observed=false; no GPU unload/reload or Android performance claim.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distRoot = resolve(args['dist-root'] ?? DEFAULT_DIST_ROOT);
  const output = resolve(args.output ?? 'device-evidence-browser-smoke.json');
  const timeoutMs = Number(args['timeout-ms'] ?? '90000');
  const frameCount = Number(args.frames ?? '10');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  if (!Number.isInteger(frameCount) || frameCount < 10 || frameCount > 600) throw new Error('--frames must be within [10, 600]');

  let resolveReport;
  let rejectReport;
  const reportPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveReport = resolvePromise;
    rejectReport = rejectPromise;
  });

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/__device_report') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolveReport(payload);
            res.writeHead(204).end();
          } catch (error) {
            rejectReport(error);
            res.writeHead(400).end(String(error));
          }
        });
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
  if (!port) throw new Error('device smoke server did not expose a port');
  const origin = `http://127.0.0.1:${port}`;
  const chrome = findChrome();
  const profile = mkdtempSync(resolve(tmpdir(), `nwe-device-smoke-${Date.now()}-`));
  const session = 'ci-streaming-session-001';
  const target = new URL('/device-evidence.html', origin);
  target.searchParams.set('renderer', 'webgl2');
  target.searchParams.set('graphics', 'balanced');
  target.searchParams.set('frames', String(frameCount));
  target.searchParams.set('session', session);
  target.searchParams.set('report', `${origin}/__device_report`);

  const child = spawn(chrome, [...chromeArgs(profile), target.href], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });

  let timeout;
  const timeoutPromise = new Promise((_, rejectPromise) => {
    timeout = setTimeout(() => rejectPromise(new Error(`device evidence browser smoke timed out after ${timeoutMs} ms\n${chromeLog.slice(-8000)}`)), timeoutMs);
  });
  const exitPromise = new Promise((_, rejectPromise) => {
    child.once('exit', (code, signal) => rejectPromise(new Error(`Chrome exited before evidence report: code=${code} signal=${signal}\n${chromeLog.slice(-8000)}`)));
  });

  try {
    const evidence = await Promise.race([reportPromise, timeoutPromise, exitPromise]);
    const proof = assertEvidence(evidence);
    writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    clearTimeout(timeout);
    await stopChrome(child, profile);
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
