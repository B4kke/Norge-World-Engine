import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBenchmarkFrameCount, parsePositiveInteger } from './benchmark/params.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function loadFromCompileReport(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.status !== 'PASS') throw new Error(`compile report status is ${report.status}`);
  const bySource = Object.fromEntries(report.results.map((item) => [item.source, item]));
  for (const source of ['roads', 'buildings']) {
    if (!bySource[source]?.artifact_path || !bySource[source]?.bundle_path) throw new Error(`compile report missing ${source} artifact/bundle path`);
  }
  return {
    roadsArtifact: resolve(bySource.roads.artifact_path),
    roadsBundle: resolve(bySource.roads.bundle_path),
    buildingsArtifact: resolve(bySource.buildings.artifact_path),
    buildingsBundle: resolve(bySource.buildings.bundle_path),
  };
}

function validateArtifactPair(artifactPath, bundlePath, expectedRole) {
  const bytes = readFileSync(artifactPath);
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  const ref = bundle?.artifact_ref;
  if (ref?.artifact_status !== 'REAL_COMPILED') throw new Error(`${expectedRole}: artifact is not REAL_COMPILED`);
  if (ref?.artifact_role !== expectedRole) throw new Error(`${expectedRole}: role mismatch ${ref?.artifact_role}`);
  if (ref?.byte_size !== bytes.byteLength) throw new Error(`${expectedRole}: byte size mismatch`);
  const digest = sha256(bytes);
  if (ref?.sha256 !== digest) throw new Error(`${expectedRole}: SHA mismatch ${digest} != ${ref?.sha256}`);
  return { bytes, bundle, sha256: digest };
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const candidate of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (found) return found;
    } catch {}
  }
  throw new Error('Chrome/Chromium not found; set CHROME_BIN');
}

function safeStaticPath(urlPath) {
  if (urlPath === '/' || urlPath === '/benchmark' || urlPath === '/benchmark/') return join(ROOT, 'benchmark', 'index.html');
  if (urlPath === '/artifact_consumer.mjs') return join(ROOT, 'artifact_consumer.mjs');
  if (urlPath.startsWith('/benchmark/')) {
    const relative = urlPath.slice('/benchmark/'.length);
    if (!relative || relative.includes('..')) return null;
    return join(ROOT, 'benchmark', relative);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const frames = parseBenchmarkFrameCount(args.frames);
  const timeoutMs = parsePositiveInteger(args['timeout-ms'], 'timeout-ms', 120000);
  const output = resolve(args.output ?? 'viewer-benchmark-results.json');
  const paths = args['compile-report'] ? loadFromCompileReport(resolve(args['compile-report'])) : {
    roadsArtifact: resolve(args['roads-artifact'] ?? ''), roadsBundle: resolve(args['roads-bundle'] ?? ''),
    buildingsArtifact: resolve(args['buildings-artifact'] ?? ''), buildingsBundle: resolve(args['buildings-bundle'] ?? ''),
  };
  const roads = validateArtifactPair(paths.roadsArtifact, paths.roadsBundle, 'road-network');
  const buildings = validateArtifactPair(paths.buildingsArtifact, paths.buildingsBundle, 'building-footprints');
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolvePromise, rejectPromise) => { resolveResult = resolvePromise; rejectResult = rejectPromise; });

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/result') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); res.writeHead(204).end(); resolveResult(result); }
          catch (error) { res.writeHead(400).end(String(error)); rejectResult(error); }
        });
        return;
      }
      const runtime = {
        '/runtime/roads.bundle.json': Buffer.from(JSON.stringify(roads.bundle)), '/runtime/roads.artifact.json': roads.bytes,
        '/runtime/buildings.bundle.json': Buffer.from(JSON.stringify(buildings.bundle)), '/runtime/buildings.artifact.json': buildings.bytes,
      };
      if (runtime[url.pathname]) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(runtime[url.pathname]); return; }
      const staticPath = safeStaticPath(url.pathname);
      if (!staticPath) { res.writeHead(404).end('not found'); return; }
      const bytes = readFileSync(staticPath);
      res.writeHead(200, { 'content-type': MIME[extname(staticPath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(bytes);
    } catch (error) { res.writeHead(500).end(error instanceof Error ? error.stack : String(error)); }
  });
  await new Promise((resolvePromise, rejectPromise) => { server.once('error', rejectPromise); server.listen(0, '127.0.0.1', resolvePromise); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('server did not expose a TCP port');

  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'nwe-viewer-benchmark-'));
  const url = `http://127.0.0.1:${port}/benchmark/?autorun=1&frames=${frames}`;
  const chromeArgs = [
    '--no-first-run','--no-default-browser-check','--no-sandbox','--disable-dev-shm-usage',
    '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist','--enable-webgl','--enable-precise-memory-info','--use-gl=angle','--use-angle=swiftshader',
    '--window-size=1280,800',`--user-data-dir=${profile}`,url,
  ];
  const useXvfb = process.platform === 'linux' && process.env.NWE_HEADLESS_DIRECT !== '1';
  const executable = useXvfb ? 'xvfb-run' : chrome;
  const browserArgs = useXvfb ? ['-a', chrome, ...chromeArgs] : ['--headless=new', ...chromeArgs];
  const child = spawn(executable, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });
  const timeout = setTimeout(() => rejectResult(new Error(`benchmark timed out after ${timeoutMs} ms\n${chromeLog.slice(-4000)}`)), timeoutMs);

  try {
    const result = await resultPromise;
    clearTimeout(timeout);
    if (result.status !== 'PASS') throw new Error(`browser benchmark failed: ${result.error ?? JSON.stringify(result)}`);
    if (result.artifact_inputs?.roads?.sha256 !== roads.sha256) throw new Error('browser road SHA does not match staged artifact');
    if (result.artifact_inputs?.buildings?.sha256 !== buildings.sha256) throw new Error('browser building SHA does not match staged artifact');
    if (result.runtime_network?.raw_source_calls !== 0) throw new Error('browser reported raw source network calls');
    if (!result.comparison?.below_100_draw_calls) throw new Error(`batched draw calls did not meet investigative <100 target: ${result.batched?.draw_calls}`);
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status:'PASS', output, artifact_sha256:{roads:roads.sha256,buildings:buildings.sha256}, objects:result.scene.object_counts, draw_calls:{per_object:result.baseline.draw_calls,batched:result.batched.draw_calls}, frame_p95_ms:{per_object:result.baseline.frame_time.p95_ms,batched:result.batched.frame_time.p95_ms}, render_sync_p95_ms:{per_object:result.baseline.render_sync_time?.p95_ms,batched:result.batched.render_sync_time?.p95_ms}, first_visible_ms:result.boot_to_first_visible_ms, raw_source_calls:result.runtime_network.raw_source_calls, renderer:result.renderer }, null, 2));
  } finally {
    clearTimeout(timeout);
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    server.close();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
