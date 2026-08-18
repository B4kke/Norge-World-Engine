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
  '.txt': 'text/plain; charset=utf-8',
  '.nwehgt': 'application/vnd.nwe.terrain-height-grid',
};

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

function readManifest(runtimeRoot) {
  const manifest = JSON.parse(readFileSync(resolve(runtimeRoot, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 'nwe.world-preview-manifest/0.1' || manifest.status !== 'REAL_COMPILED') {
    throw new Error(`unexpected Preview 1 manifest ${manifest.schema}/${manifest.status}`);
  }
  return manifest;
}

function assertBrowserResult(report, manifest, serverRequests) {
  if (!report || report.schema !== 'nwe.world-preview-browser-smoke/0.1') {
    throw new Error(`browser report schema missing: ${report?.schema ?? 'none'}`);
  }
  if (report.status !== 'PASS') throw new Error(`browser report failed: ${report.error ?? 'unknown'}`);
  if (report.phase !== 'REAL WORLD READY') throw new Error(`viewer phase was ${report.phase}`);
  const result = report.result;
  if (result?.schema !== 'nwe.world-preview-runtime/0.1' || result.status !== 'PASS') {
    throw new Error(`runtime result invalid: ${result?.schema}/${result?.status}`);
  }
  if (result.tile_id !== manifest.tile.id) throw new Error(`tile mismatch ${result.tile_id} != ${manifest.tile.id}`);

  const expected = {
    terrain: manifest.terrain.artifact_sha256,
    roads: manifest.roads.artifact_sha256,
    buildings: manifest.buildings.artifact_sha256,
  };
  for (const [layer, sha256] of Object.entries(expected)) {
    if (result[layer]?.artifact_sha256 !== sha256) {
      throw new Error(`${layer} SHA mismatch ${result[layer]?.artifact_sha256} != ${sha256}`);
    }
    if (result[layer]?.verification_code !== 'RUNTIME_VERIFICATION_PASS') {
      throw new Error(`${layer} browser verification failed: ${result[layer]?.verification_code}`);
    }
  }
  if (result.roads.count !== manifest.roads.compiled_count) {
    throw new Error(`road count mismatch ${result.roads.count} != ${manifest.roads.compiled_count}`);
  }
  if (result.buildings.count !== manifest.buildings.compiled_count) {
    throw new Error(`building count mismatch ${result.buildings.count} != ${manifest.buildings.compiled_count}`);
  }
  if (result.renderer?.terrain_vertices !== 16641 || result.renderer?.terrain_triangles !== 32768) {
    throw new Error(`unexpected terrain mesh ${JSON.stringify(result.renderer)}`);
  }
  if (result.renderer?.road_paths !== manifest.roads.compiled_count) {
    throw new Error(`rendered road count mismatch ${result.renderer?.road_paths}`);
  }
  if (result.renderer?.building_footprints !== manifest.buildings.compiled_count) {
    throw new Error(`rendered building count mismatch ${result.renderer?.building_footprints}`);
  }
  if ((result.renderer?.source_backed_building_heights ?? 0) + (result.renderer?.unresolved_building_heights ?? 0) !== manifest.buildings.compiled_count) {
    throw new Error('building height provenance counts do not close over rendered footprints');
  }
  if (result.terrain?.resolver_calls !== 1 || result.terrain?.scheduler?.loadsCompleted !== 1 || result.terrain?.scheduler?.loadsFailed !== 0) {
    throw new Error(`terrain scheduler mismatch ${JSON.stringify(result.terrain?.scheduler)}`);
  }

  const firstFrame = result.renderer?.first_frame;
  if (!firstFrame || !['webgpu', 'webgl2'].includes(firstFrame.backend)) {
    throw new Error(`renderer first-frame proof missing: ${JSON.stringify(firstFrame)}`);
  }
  if (firstFrame.backend !== result.renderer?.backend) {
    throw new Error(`renderer backend/first-frame mismatch: ${result.renderer?.backend}/${firstFrame.backend}`);
  }

  const runtimeRequests = report.runtime_requests ?? [];
  const expectedRuntimeRequests = 7;
  if (runtimeRequests.length !== expectedRuntimeRequests) {
    throw new Error(`runtime request count ${runtimeRequests.length} != ${expectedRuntimeRequests}: ${JSON.stringify(runtimeRequests)}`);
  }
  if (runtimeRequests.some((url) => new URL(url).origin !== serverRequests.origin)) {
    throw new Error(`runtime escaped same-origin snapshot: ${JSON.stringify(runtimeRequests)}`);
  }
  const rawMarkers = ['kartverket', 'geonorge', 'vegvesen', 'nvdb', 'overpass', 'openstreetmap'];
  if (runtimeRequests.some((url) => rawMarkers.some((marker) => url.toLowerCase().includes(marker)))) {
    throw new Error(`raw source marker observed in browser runtime requests: ${JSON.stringify(runtimeRequests)}`);
  }

  return {
    schema: 'nwe.world-preview-browser-proof/0.1',
    status: 'PASS',
    tile_id: result.tile_id,
    phase: report.phase,
    runtime_request_count: runtimeRequests.length,
    raw_source_runtime_calls: 0,
    renderer: {
      backend: result.renderer.backend,
      preference: result.renderer_preference,
      graphics_profile: result.graphics_profile,
      fallback: result.renderer.fallback ?? null,
      first_frame: firstFrame,
    },
    terrain: {
      sha256: result.terrain.artifact_sha256,
      retained_bytes: result.terrain.retained_bytes,
      vertices: result.renderer.terrain_vertices,
      triangles: result.renderer.terrain_triangles,
      timing_ms: result.terrain.timing_ms,
    },
    roads: { sha256: result.roads.artifact_sha256, count: result.roads.count },
    buildings: {
      sha256: result.buildings.artifact_sha256,
      count: result.buildings.count,
      source_backed_heights: result.renderer.source_backed_building_heights,
      unresolved_heights: result.renderer.unresolved_building_heights,
    },
    browser_requests: serverRequests.paths,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtimeRoot = resolve(args['runtime-root'] ?? '');
  const distRoot = resolve(args['dist-root'] ?? DEFAULT_DIST_ROOT);
  const output = resolve(args.output ?? 'preview1-browser-smoke.json');
  const timeoutMs = Number(args['timeout-ms'] ?? '90000');
  if (!args['runtime-root']) throw new Error('--runtime-root is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  const manifest = readManifest(runtimeRoot);

  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });
  const requestPaths = [];
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      requestPaths.push(`${req.method} ${url.pathname}`);
      if (req.method === 'POST' && url.pathname === '/__preview_report') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            res.writeHead(204).end();
            resolveResult(report);
          } catch (error) {
            res.writeHead(400).end(String(error));
            rejectResult(error);
          }
        });
        return;
      }

      let filePath;
      if (url.pathname.startsWith('/runtime/')) {
        filePath = safePath(runtimeRoot, url.pathname.slice('/runtime/'.length));
      } else {
        const relative = url.pathname === '/' ? 'index.html' : url.pathname;
        filePath = safePath(distRoot, relative);
      }
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
      const extension = extname(filePath);
      res.writeHead(200, {
        'content-type': MIME[extension] ?? 'application/octet-stream',
        'cache-control': extension === '.nwehgt' ? 'public, max-age=3600, immutable' : 'no-store',
      });
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
  if (!port) throw new Error('browser smoke server did not expose a port');
  const origin = `http://127.0.0.1:${port}`;

  const chrome = findChrome();
  const profile = mkdtempSync(resolve(tmpdir(), `nwe-preview1-browser-${Date.now()}-`));
  const query = new URLSearchParams({
    previewManifest: `${origin}/runtime/manifest.json`,
    previewReport: `${origin}/__preview_report`,
    previewAuditOrigin: '1',
  });
  const url = `${origin}/?${query}`;
  const chromeArgs = [
    '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,800',
    `--user-data-dir=${profile}`, url,
  ];
  const child = spawn(chrome, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });
  const timeout = setTimeout(() => {
    rejectResult(new Error(`Preview 1 browser smoke timed out after ${timeoutMs} ms\n${chromeLog.slice(-5000)}`));
  }, timeoutMs);

  try {
    const report = await resultPromise;
    const proof = assertBrowserResult(report, manifest, { origin, paths: requestPaths });
    writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    clearTimeout(timeout);
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await new Promise((resolvePromise) => server.close(resolvePromise));
    // Chrome can briefly keep profile files open after the process group receives
    // SIGTERM. Cleanup is non-authoritative on an ephemeral runner, so a known
    // transient profile-lock race must not turn an already validated browser proof
    // into a false CI failure.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      console.warn(`Preview 1 browser profile cleanup deferred: ${error.code}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
