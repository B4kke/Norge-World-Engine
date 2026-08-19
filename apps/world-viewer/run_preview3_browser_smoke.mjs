import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DEFAULT_DIST_ROOT = resolve(APP_ROOT, 'dist');
const TERRAIN_TILE_COUNT = 9;
const EXPECTED_RUNTIME_REQUESTS = 1 + (TERRAIN_TILE_COUNT * 2) + 4;
const RAW_MARKERS = ['kartverket', 'geonorge', 'vegvesen', 'nvdb', 'overpass', 'openstreetmap'];
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
    throw new Error(`unexpected manifest ${manifest.schema}/${manifest.status}`);
  }
  if (!Array.isArray(manifest.terrain_tiles) || manifest.terrain_tiles.length !== TERRAIN_TILE_COUNT) {
    throw new Error(`terrain tile count ${manifest.terrain_tiles?.length ?? 'missing'} != ${TERRAIN_TILE_COUNT}`);
  }
  const ids = manifest.terrain_tiles.map((entry) => entry?.tile?.id);
  if (new Set(ids).size !== TERRAIN_TILE_COUNT || !ids.includes(manifest.tile.id)) {
    throw new Error(`invalid terrain tile ids: ${JSON.stringify(ids)}`);
  }
  return manifest;
}

function assertBrowserResult(report, manifest, serverState) {
  if (report?.schema !== 'nwe.world-preview3-browser-smoke/0.1') {
    throw new Error(`browser report schema missing: ${report?.schema ?? 'none'}`);
  }
  if (report.status !== 'PASS') throw new Error(`browser report failed: ${report.error ?? 'unknown'}`);
  if (report.phase !== '3×3 WORLD READY') throw new Error(`viewer phase was ${report.phase}`);
  const result = report.result;
  if (result?.schema !== 'nwe.world-preview-runtime/0.2' || result.status !== 'PASS') {
    throw new Error(`runtime result invalid: ${result?.schema}/${result?.status}`);
  }
  if (result.tile_id !== manifest.tile.id) throw new Error(`center tile mismatch ${result.tile_id} != ${manifest.tile.id}`);
  if (result.raw_source_runtime_calls !== 0) throw new Error(`runtime reported raw source calls: ${result.raw_source_runtime_calls}`);

  if (result.terrain?.tile_count !== TERRAIN_TILE_COUNT || result.terrain?.resolver_calls !== TERRAIN_TILE_COUNT) {
    throw new Error(`terrain runtime count mismatch: ${JSON.stringify(result.terrain)}`);
  }
  if (result.terrain?.scheduler?.loadsCompleted !== TERRAIN_TILE_COUNT || result.terrain?.scheduler?.loadsFailed !== 0) {
    throw new Error(`terrain scheduler mismatch: ${JSON.stringify(result.terrain?.scheduler)}`);
  }
  const resultTiles = result.terrain?.tiles ?? [];
  const resultById = new Map(resultTiles.map((tile) => [tile.tile_id, tile]));
  if (resultById.size !== TERRAIN_TILE_COUNT) throw new Error(`runtime tile set size ${resultById.size}`);
  for (const entry of manifest.terrain_tiles) {
    const tile = resultById.get(entry.tile.id);
    if (!tile) throw new Error(`missing runtime tile ${entry.tile.id}`);
    if (tile.artifact_sha256 !== entry.artifact_sha256) {
      throw new Error(`${entry.tile.id}: SHA mismatch ${tile.artifact_sha256} != ${entry.artifact_sha256}`);
    }
    if (tile.verification_code !== 'RUNTIME_VERIFICATION_PASS') {
      throw new Error(`${entry.tile.id}: verification ${tile.verification_code}`);
    }
    if (!(tile.vertices > 0) || !(tile.triangles > 0) || !(tile.retained_bytes > 0)) {
      throw new Error(`${entry.tile.id}: incomplete mesh/runtime evidence`);
    }
  }
  const distinctTerrainShas = new Set(resultTiles.map((tile) => tile.artifact_sha256));
  if (distinctTerrainShas.size !== TERRAIN_TILE_COUNT) throw new Error(`expected 9 distinct terrain SHAs, got ${distinctTerrainShas.size}`);

  if (result.roads?.artifact_sha256 !== manifest.roads.artifact_sha256 || result.roads?.verification_code !== 'RUNTIME_VERIFICATION_PASS') {
    throw new Error(`roads mismatch ${JSON.stringify(result.roads)}`);
  }
  if (result.buildings?.artifact_sha256 !== manifest.buildings.artifact_sha256 || result.buildings?.verification_code !== 'RUNTIME_VERIFICATION_PASS') {
    throw new Error(`buildings mismatch ${JSON.stringify(result.buildings)}`);
  }
  if (result.roads?.count !== manifest.roads.compiled_count || result.buildings?.count !== manifest.buildings.compiled_count) {
    throw new Error(`vector counts mismatch ${JSON.stringify({ roads: result.roads, buildings: result.buildings })}`);
  }

  if (result.renderer?.backend !== 'webgl2') throw new Error(`preview3 baseline backend ${result.renderer?.backend}`);
  if (result.renderer?.terrain_tile_count !== TERRAIN_TILE_COUNT) throw new Error(`renderer tile count ${result.renderer?.terrain_tile_count}`);
  if (!(result.renderer?.terrain_vertices > 0) || !(result.renderer?.terrain_triangles > 0)) {
    throw new Error(`renderer terrain geometry missing: ${JSON.stringify(result.renderer)}`);
  }
  const lifecycle = result.renderer?.resource_lifecycle;
  if (lifecycle?.active_tile_count !== TERRAIN_TILE_COUNT || lifecycle?.current_buffer_count !== TERRAIN_TILE_COUNT * 3) {
    throw new Error(`renderer resource lifecycle mismatch ${JSON.stringify(lifecycle)}`);
  }
  if (result.renderer?.first_frame?.backend !== 'webgl2') throw new Error(`first-frame proof missing ${JSON.stringify(result.renderer?.first_frame)}`);

  const runtimeRequests = report.runtime_requests ?? [];
  if (runtimeRequests.length !== EXPECTED_RUNTIME_REQUESTS) {
    throw new Error(`runtime request count ${runtimeRequests.length} != ${EXPECTED_RUNTIME_REQUESTS}: ${JSON.stringify(runtimeRequests)}`);
  }
  if (runtimeRequests.some((url) => new URL(url).origin !== serverState.origin)) {
    throw new Error(`runtime escaped same-origin snapshot: ${JSON.stringify(runtimeRequests)}`);
  }
  if (runtimeRequests.some((url) => RAW_MARKERS.some((marker) => url.toLowerCase().includes(marker)))) {
    throw new Error(`raw source marker observed in browser runtime requests: ${JSON.stringify(runtimeRequests)}`);
  }

  return {
    schema: 'nwe.world-preview3-browser-proof/0.1',
    status: 'PASS',
    center_tile_id: result.tile_id,
    phase: report.phase,
    terrain_tile_count: result.terrain.tile_count,
    terrain_artifact_sha256s: Object.fromEntries(resultTiles.map((tile) => [tile.tile_id, tile.artifact_sha256])),
    ready_for_runtime_count: resultTiles.filter((tile) => tile.verification_code === 'RUNTIME_VERIFICATION_PASS').length,
    runtime_request_count: runtimeRequests.length,
    raw_source_runtime_calls: 0,
    scheduler: result.terrain.scheduler,
    renderer: {
      backend: result.renderer.backend,
      terrain_tile_count: result.renderer.terrain_tile_count,
      terrain_vertices: result.renderer.terrain_vertices,
      terrain_triangles: result.renderer.terrain_triangles,
      draw_calls_per_frame: result.renderer.draw_calls_per_frame,
      gpu_buffer_count: result.renderer.gpu_buffer_count,
      gpu_buffer_payload_bytes: result.renderer.gpu_buffer_payload_bytes,
      first_frame: result.renderer.first_frame,
      resource_lifecycle: lifecycle,
    },
    vectors: {
      roads: { scope: result.roads.scope, count: result.roads.count, sha256: result.roads.artifact_sha256 },
      buildings: { scope: result.buildings.scope, count: result.buildings.count, sha256: result.buildings.artifact_sha256 },
    },
    retained_terrain_bytes: result.terrain.retained_bytes,
    total_to_first_frame_ms: result.timing_ms.total_to_first_frame,
    browser_requests: serverState.paths,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['runtime-root']) throw new Error('--runtime-root is required');
  const runtimeRoot = resolve(args['runtime-root']);
  const distRoot = resolve(args['dist-root'] ?? DEFAULT_DIST_ROOT);
  const output = resolve(args.output ?? 'preview3-browser-smoke.json');
  const timeoutMs = Number(args['timeout-ms'] ?? '120000');
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
      if (req.method === 'POST' && url.pathname === '/__preview3_report') {
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
        const relative = url.pathname === '/' ? 'preview3.html' : url.pathname;
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
  const query = new URLSearchParams({
    previewManifest: `${origin}/runtime/manifest.json`,
    previewReport: `${origin}/__preview3_report`,
    previewAuditOrigin: '1',
    graphics: 'balanced',
  });
  const url = `${origin}/preview3.html?${query}`;

  const chrome = findChrome();
  const profile = mkdtempSync(resolve(tmpdir(), `nwe-preview3-browser-${Date.now()}-`));
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
    rejectResult(new Error(`Preview 3 browser smoke timed out after ${timeoutMs} ms\n${chromeLog.slice(-5000)}`));
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
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      console.warn(`Preview 3 browser profile cleanup deferred: ${error.code}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
