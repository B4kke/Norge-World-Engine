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
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function assertLayer(layer, expectedSha, name) {
  if (!layer) throw new Error(`PROFILE_SMOKE_LAYER_MISSING: ${name}`);
  if (layer.artifact_sha256 !== expectedSha) throw new Error(`PROFILE_SMOKE_SHA: ${name}`);
  if (layer.production_verification_code !== 'RUNTIME_VERIFICATION_PASS') throw new Error(`PROFILE_SMOKE_VERIFICATION: ${name}`);
  if (layer.isolated_replay?.status !== 'PASS') throw new Error(`PROFILE_SMOKE_REPLAY: ${name}`);
  if (!layer.isolated_replay?.first_replay) throw new Error(`PROFILE_SMOKE_FIRST_REPLAY: ${name}`);
  if (!layer.isolated_replay?.steady_state) throw new Error(`PROFILE_SMOKE_STEADY_STATE: ${name}`);
}

function assertReport(report, expectedCommit) {
  if (report?.schema !== 'nwe.browser-provenance-profile-report/0.2') throw new Error('PROFILE_SMOKE_SCHEMA');
  if (report.status !== 'PASS') throw new Error(`PROFILE_SMOKE_STATUS: ${report?.error ?? 'unknown failure'}`);
  if (report.tile_id !== EXPECTED.tileId) throw new Error(`PROFILE_SMOKE_TILE: ${report.tile_id}`);
  if (report.raw_source_calls !== 0) throw new Error(`PROFILE_SMOKE_RAW_SOURCE_CALLS: ${report.raw_source_calls}`);
  if (report.build?.exact_commit_bound !== true) throw new Error('PROFILE_SMOKE_BUILD_UNBOUND');
  if (expectedCommit && report.build?.git_commit_sha !== expectedCommit.toLowerCase()) {
    throw new Error(`PROFILE_SMOKE_BUILD_SHA: ${report.build?.git_commit_sha}`);
  }
  assertLayer(report.layers?.roads, EXPECTED.roadsSha, 'roads');
  assertLayer(report.layers?.buildings, EXPECTED.buildingsSha, 'buildings');
  return {
    schema: 'nwe.browser-provenance-profile-ci-proof/0.1',
    status: 'PASS',
    evidence_class: 'hosted-headless-chrome-exact-real',
    tile_id: report.tile_id,
    build: report.build,
    browser: report.browser,
    iterations: report.iterations,
    raw_source_calls: report.raw_source_calls,
    timing_ms: report.timing_ms,
    layers: report.layers,
    interpretation: 'Exact-commit hosted Chrome measurement of the production verified road/building artifact path plus isolated verifier/UTF-8/JSON replay. It does not bypass RuntimeVerificationBundle, does not include raw geodata acquisition, and is not device-specific performance evidence.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distRoot = resolve(args['dist-root'] ?? DEFAULT_DIST_ROOT);
  const output = resolve(args.output ?? 'browser-artifact-profile-smoke.json');
  const timeoutMs = Number(args['timeout-ms'] ?? '90000');
  const iterations = Number(args.iterations ?? '5');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  if (!Number.isInteger(iterations) || iterations < 2 || iterations > 20) throw new Error('--iterations must be within [2, 20]');

  let resolveReport;
  let rejectReport;
  const reportPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveReport = resolvePromise;
    rejectReport = rejectPromise;
  });

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/__profile_report') {
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
      if (!filePath) return res.writeHead(403).end('forbidden');
      let bytes;
      try { bytes = readFileSync(filePath); } catch { return res.writeHead(404).end('not found'); }
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
  if (!port) throw new Error('profile smoke server did not expose a port');
  const origin = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(resolve(tmpdir(), `nwe-profile-smoke-${Date.now()}-`));
  const target = new URL('/browser-artifact-profile.html', origin);
  target.searchParams.set('iterations', String(iterations));
  target.searchParams.set('report', `${origin}/__profile_report`);

  const chrome = findChrome();
  const child = spawn(chrome, [...chromeArgs(profile), target.href], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });

  let timeout;
  const timeoutPromise = new Promise((_, rejectPromise) => {
    timeout = setTimeout(() => rejectPromise(new Error(`browser artifact profile timed out after ${timeoutMs} ms\n${chromeLog.slice(-8000)}`)), timeoutMs);
  });
  const exitPromise = new Promise((_, rejectPromise) => {
    child.once('exit', (code, signal) => rejectPromise(new Error(`Chrome exited before profile report: code=${code} signal=${signal}\n${chromeLog.slice(-8000)}`)));
  });

  try {
    const report = await Promise.race([reportPromise, timeoutPromise, exitPromise]);
    const proof = assertReport(report, process.env.GITHUB_SHA ?? null);
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
