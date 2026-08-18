import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalSha256, canonicalText } from '../../engine/schemas/js/src/canonical.mjs';
import { decodeTerrainHeightGridArtifact } from '../../engine/streaming/terrain_tile_loader.mjs';
import { artifactIdentityPayload, verifyRuntimeBundle } from '../../engine/streaming/runtime_verifier.mjs';

const APP_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO_ROOT = resolve(APP_ROOT, '../..');
const STREAMING_ROOT = join(REPO_ROOT, 'engine', 'streaming');
const CANONICALIZE_ENTRY = fileURLToPath(import.meta.resolve('canonicalize'));
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function promotionGates() {
  return {
    source_validated: 'PASS',
    transform_validated: 'PASS',
    normalized_bytes_verified: 'PASS',
    compiler_identity_bound: 'PASS',
    artifact_bytes_verified: 'PASS',
    lineage_reconstructed: 'PASS',
    determinism_policy_satisfied: 'PASS',
  };
}

function buildArtifact({ tileId, width = 1000, height = 1000, bounds = [611000, 6677000, 612000, 6678000] }) {
  const sampleCount = width * height;
  const elevations = new Float32Array(sampleCount);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const value = 178 + row * 0.006 + column * 0.004 + Math.sin(column / 41) * 1.5 + Math.cos(row / 57) * 1.2;
      elevations[row * width + column] = value;
      minimum = Math.min(minimum, elevations[row * width + column]);
      maximum = Math.max(maximum, elevations[row * width + column]);
    }
  }
  const header = {
    schema: 'nwe.terrain-height-grid-artifact/0.1',
    tile_id: tileId,
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
    bounds,
    width,
    height,
    pixel_size_m: 1,
    nodata: -32767,
    storage: 'float32-le-row-major-north-to-south',
    elevation_min_m: minimum,
    elevation_max_m: maximum,
  };
  const headerBytes = new TextEncoder().encode(canonicalText(header));
  const artifactBytes = new Uint8Array(12 + headerBytes.byteLength + sampleCount * 4);
  artifactBytes.set(new TextEncoder().encode('NWEHGT01'), 0);
  const view = new DataView(artifactBytes.buffer);
  view.setUint32(8, headerBytes.byteLength, true);
  artifactBytes.set(headerBytes, 12);
  const dataOffset = 12 + headerBytes.byteLength;
  for (let index = 0; index < elevations.length; index += 1) view.setFloat32(dataOffset + index * 4, elevations[index], true);
  return { artifactBytes, header };
}

function buildSyntheticBundle(artifactBytes, header) {
  const source = {
    schema: 'nwe.source-snapshot/0.3',
    source_id: 'fixture:browser-terrain-worker',
    raw_sha256: 'a'.repeat(64),
    raw_byte_size: 4_100_000,
    source_crs: 'EPSG:25832',
    source_vertical_datum: 'NN2000',
    z_semantics: 'normal_height_m',
  };
  const sourceHash = canonicalSha256(source);
  const transform = {
    schema: 'nwe.transform-contract/0.1',
    source_snapshot_hash: sourceHash,
    operation: 'fixture-pixel-aligned-window-no-resampling',
    source_crs: 'EPSG:25832',
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
    vertical_operation: 'identity-NN2000',
    resampling: 'none',
    bounds_epsg25832: header.bounds.map((value) => String(value)),
    pixel_size_m: '1',
    width: header.width,
    height: header.height,
    num_threads: 1,
  };
  const transformHash = canonicalSha256(transform);
  const normalized = {
    schema: 'nwe.normalized-snapshot/0.1',
    source_snapshot_hash: sourceHash,
    transform_contract_hash: transformHash,
    sha256: 'b'.repeat(64),
    byte_size: 4_000_000,
    media_type: 'application/vnd.nwe.fixture-height-grid',
    sample_count: header.width * header.height,
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
  };
  const normalizedHash = canonicalSha256(normalized);
  const compilerConfig = {
    schema: 'nwe.compiler-config/0.1',
    compiler_id: 'nwe-browser-terrain-worker-fixture',
    compiler_version: '0.1.0',
    terrain_format: 'nwe-height-grid/0.1',
    storage: 'float32-le-row-major-north-to-south',
    quantization: 'none',
  };
  const compilerConfigHash = canonicalSha256(compilerConfig);
  const lineage = {
    schema: 'nwe.compile-lineage/0.1',
    tile_id: header.tile_id,
    artifact_role: 'terrain-height-grid',
    source_snapshot_hashes: [sourceHash],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config_hash: compilerConfigHash,
  };
  const lineageHash = canonicalSha256(lineage);
  const artifactRef = {
    schema: 'nwe.artifact-ref/0.1',
    artifact_role: 'terrain-height-grid',
    tile_id: header.tile_id,
    sha256: sha256(artifactBytes),
    byte_size: artifactBytes.byteLength,
    media_type: 'application/vnd.nwe.terrain-height-grid',
    lineage_hash: lineageHash,
    artifact_status: 'REAL_COMPILED',
    transport: { reference: 'cache://compiled/terrain.nwehgt' },
  };
  const artifactRefHash = canonicalSha256(artifactIdentityPayload(artifactRef));
  const promotion = {
    schema: 'nwe.promotion-record/0.1',
    lineage_hash: lineageHash,
    artifact_ref_hash: artifactRefHash,
    from_state: 'NORMALIZED',
    to_state: 'REAL_COMPILED',
    gates: promotionGates(),
  };
  return {
    bundle_schema: 'nwe.runtime-verification-bundle/0.1',
    canonicalization_id: 'urn:ietf:rfc:8785',
    hash_algorithm: 'sha-256',
    source_snapshots: [source],
    source_snapshot_hashes: [sourceHash],
    transform_contracts: [transform],
    transform_contract_hashes: [transformHash],
    normalized_snapshots: [normalized],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config: compilerConfig,
    compiler_config_hash: compilerConfigHash,
    compile_lineage: lineage,
    lineage_hash: lineageHash,
    artifact_ref: artifactRef,
    artifact_ref_hash: artifactRefHash,
    promotion_record: promotion,
    promotion_record_hash: canonicalSha256(promotion),
  };
}

function loadInput(args) {
  if (args.artifact || args.bundle) {
    if (!args.artifact || !args.bundle) throw new Error('--artifact and --bundle must be supplied together');
    const artifactBytes = new Uint8Array(readFileSync(resolve(args.artifact)));
    const bundle = JSON.parse(readFileSync(resolve(args.bundle), 'utf8'));
    const verification = verifyRuntimeBundle(bundle, artifactBytes);
    if (!verification.ok || verification.decision !== 'READY_FOR_RUNTIME') {
      throw new Error(`input runtime bundle rejected: ${verification.code}: ${verification.detail}`);
    }
    const decoded = decodeTerrainHeightGridArtifact(artifactBytes);
    return { mode: 'real-input', artifactBytes, bundle, header: decoded.header };
  }
  const tileId = 'epsg25832_611000_6677000_1000m';
  const { artifactBytes, header } = buildArtifact({ tileId });
  return { mode: 'synthetic-structural', artifactBytes, bundle: buildSyntheticBundle(artifactBytes, header), header };
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

function safeStaticPath(pathname) {
  if (pathname === '/' || pathname === '/terrain-streaming' || pathname === '/terrain-streaming/') {
    return join(APP_ROOT, 'terrain-streaming', 'index.html');
  }
  if (pathname === '/terrain_runtime_input.mjs') return join(APP_ROOT, 'terrain_runtime_input.mjs');
  if (pathname === '/artifact_consumer.mjs') return join(APP_ROOT, 'artifact_consumer.mjs');
  if (pathname === '/vendor/canonicalize.mjs') return CANONICALIZE_ENTRY;
  if (pathname.startsWith('/terrain-streaming/')) {
    const relative = pathname.slice('/terrain-streaming/'.length);
    if (!relative || relative.includes('..')) return null;
    return join(APP_ROOT, 'terrain-streaming', relative);
  }
  if (pathname.startsWith('/engine/streaming/')) {
    const relative = pathname.slice('/engine/streaming/'.length);
    if (!relative || relative.includes('/') || relative.includes('..') || !relative.endsWith('.mjs')) return null;
    return join(STREAMING_ROOT, relative);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = Number(args['timeout-ms'] ?? '120000');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  const output = resolve(args.output ?? 'terrain-browser-benchmark.json');
  const input = loadInput(args);
  const expectedSha = sha256(input.artifactBytes);
  const servedBundle = structuredClone(input.bundle);
  servedBundle.artifact_ref.transport = { reference: 'cache://compiled/terrain.nwehgt' };
  const servedVerification = verifyRuntimeBundle(servedBundle, input.artifactBytes);
  if (!servedVerification.ok) throw new Error(`relocated bundle rejected before browser: ${servedVerification.code}`);

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
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            res.writeHead(204).end();
            resolveResult(value);
          } catch (error) {
            res.writeHead(400).end(String(error));
            rejectResult(error);
          }
        });
        return;
      }
      if (url.pathname === '/runtime/terrain.bundle.json') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(servedBundle));
        return;
      }
      if (url.pathname.startsWith('/runtime/compiled/')) {
        res.writeHead(200, { 'content-type': 'application/vnd.nwe.terrain-height-grid', 'cache-control': 'public, max-age=3600, immutable' });
        res.end(input.artifactBytes);
        return;
      }
      const staticPath = safeStaticPath(url.pathname);
      if (!staticPath) { res.writeHead(404).end('not found'); return; }
      const bytes = readFileSync(staticPath);
      res.writeHead(200, { 'content-type': MIME[extname(staticPath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(bytes);
    } catch (error) {
      res.writeHead(500).end(error instanceof Error ? error.stack : String(error));
    }
  });
  await new Promise((resolvePromise, rejectPromise) => { server.once('error', rejectPromise); server.listen(0, '127.0.0.1', resolvePromise); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('server did not expose a port');

  const [minE, minN, maxE, maxN] = input.header.bounds;
  const centerE = (minE + maxE) / 2;
  const centerN = (minN + maxN) / 2;
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'nwe-terrain-browser-'));
  const query = new URLSearchParams({
    autorun: '1',
    tileId: input.header.tile_id,
    centerE: String(centerE),
    centerN: String(centerN),
  });
  const url = `http://127.0.0.1:${port}/terrain-streaming/?${query}`;
  const chromeArgs = [
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,800',
    `--user-data-dir=${profile}`, url,
  ];
  const useXvfb = process.platform === 'linux' && process.env.NWE_HEADLESS_DIRECT !== '1';
  const executable = useXvfb ? 'xvfb-run' : chrome;
  const browserArgs = useXvfb ? ['-a', chrome, ...chromeArgs] : ['--headless=new', ...chromeArgs];
  const child = spawn(executable, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });
  const timeout = setTimeout(() => rejectResult(new Error(`terrain browser benchmark timed out after ${timeoutMs} ms\n${chromeLog.slice(-4000)}`)), timeoutMs);

  try {
    const result = await resultPromise;
    clearTimeout(timeout);
    if (result.status !== 'PASS') throw new Error(`browser terrain benchmark failed: ${result.error ?? JSON.stringify(result)}`);
    if (result.tile_id !== input.header.tile_id) throw new Error(`browser tile id mismatch: ${result.tile_id}`);
    if (result.artifact_sha256 !== expectedSha) throw new Error(`browser artifact SHA mismatch: ${result.artifact_sha256} != ${expectedSha}`);
    if (result.verification_code !== 'RUNTIME_VERIFICATION_PASS') throw new Error(`browser provenance did not pass: ${result.verification_code}`);
    if (result.mesh?.vertexCount !== 16641 || result.mesh?.triangleCount !== 32768 || result.mesh?.byteSize !== 729120) {
      throw new Error(`unexpected browser mesh: ${JSON.stringify(result.mesh)}`);
    }
    if (result.retained_bytes !== 4729120) throw new Error(`unexpected retained bytes ${result.retained_bytes}`);
    if (result.scheduler?.loadsStarted !== 1 || result.scheduler?.loadsCompleted !== 1 || result.scheduler?.loadsFailed !== 0 || result.scheduler?.cacheHits !== 1) {
      throw new Error(`unexpected scheduler metrics: ${JSON.stringify(result.scheduler)}`);
    }
    if (result.network?.raw_source_calls !== 0 || result.network?.runtime_bundle_artifact_requests !== 2 || result.network?.terrain_resolver_calls !== 1) {
      throw new Error(`unexpected browser network/resolver behavior: ${JSON.stringify(result.network)}`);
    }
    if (!result.capabilities?.worker || !result.capabilities?.webcrypto || !result.capabilities?.webgl2) throw new Error(`required browser capabilities missing: ${JSON.stringify(result.capabilities)}`);
    writeFileSync(output, `${JSON.stringify({ ...result, input_mode: input.mode }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: 'PASS',
      input_mode: input.mode,
      tile_id: result.tile_id,
      artifact_sha256: result.artifact_sha256,
      worker_boundary: result.worker_boundary,
      loader_timing_ms: result.loader_timing_ms,
      browser_timing_ms: result.browser_timing_ms,
      raf_gap_ms: result.raf_gap_ms,
      scheduler: {
        loads_started: result.scheduler.loadsStarted,
        loads_completed: result.scheduler.loadsCompleted,
        cache_hits: result.scheduler.cacheHits,
        resident_count: result.scheduler.residentCount,
      },
      network: result.network,
      retained_bytes: result.retained_bytes,
    }, null, 2));
  } finally {
    clearTimeout(timeout);
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    server.close();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
