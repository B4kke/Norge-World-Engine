import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';

// Fixed local-summer afternoon for comparable geometry/material screenshots;
// it is NOT the user's live clock and is explicitly reported in evidence.
const VISUAL_PROOF_SOLAR_TIME_UTC = '2026-07-23T11:00:00Z';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
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

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForDevTools(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { cache: 'no-store' });
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {}
    await delay(100);
  }
  throw new Error(`DevTools target unavailable after ${timeoutMs} ms`);
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', rejectPromise, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolvePromise, reject: rejectPromise } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectPromise(new Error(`CDP ${message.error.code}: ${message.error.message}`));
    else resolvePromise(message.result ?? {});
  });
  return {
    async send(method, params = {}) {
      const id = nextId++;
      const result = new Promise((resolvePromise, rejectPromise) => pending.set(id, { resolve: resolvePromise, reject: rejectPromise }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() { socket.close(); },
  };
}

async function waitForReady(cdp, timeoutMs) {
  const started = Date.now();
  let lastText = '';
  while (Date.now() - started < timeoutMs) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    });
    lastText = String(result?.result?.value ?? '');
    if (lastText.includes('REAL WORLD READY')) return lastText;
    if (/ERROR|FAILED/i.test(lastText)) throw new Error(`Preview entered error state before screenshot:\n${lastText.slice(-3000)}`);
    await delay(150);
  }
  throw new Error(`Preview did not reach REAL WORLD READY within ${timeoutMs} ms. Last body text:\n${lastText.slice(-3000)}`);
}

// Native browser Image/Canvas decode is sufficient for a simple visual
// sanity gate; no custom PNG parser or extra binary library is required.
// Check only the world viewport, not the bright diagnostics sidebar.
async function measureWorldViewportLuminance(cdp, png) {
  const uri = `data:image/png;base64,${png.toString('base64')}`;
  const expression = `(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(uri)};
    await image.decode();
    const region = {
      x: 16, y: 92,
      width: Math.min(1020, image.naturalWidth - 16),
      height: Math.min(510, image.naturalHeight - 92),
    };
    const canvas = document.createElement('canvas');
    canvas.width = region.width;
    canvas.height = region.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, region.x, region.y, region.width, region.height,
      0, 0, region.width, region.height);
    const pixels = context.getImageData(0, 0, region.width, region.height).data;
    let sum = 0, bright = 0, count = 0;
    for (let y = 0; y < region.height; y += 4) {
      for (let x = 0; x < region.width; x += 4) {
        const i = (y * region.width + x) * 4;
        const luminance = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        sum += luminance;
        if (luminance > 45) bright += 1;
        count += 1;
      }
    }
    return { mean_luma: sum / count, bright_fraction: bright / count, sampled_pixels: count,
      region: [region.x, region.y, region.width, region.height] };
  })()`;
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result?.exceptionDetails || !Number.isFinite(result?.result?.value?.mean_luma)) {
    throw new Error('VISUAL_PROOF_IMAGE_LUMA_UNAVAILABLE');
  }
  return result.result.value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['runtime-root']) throw new Error('--runtime-root is required');
  if (!args['dist-root']) throw new Error('--dist-root is required');
  if (!args.output) throw new Error('--output is required');
  const runtimeRoot = resolve(args['runtime-root']);
  const distRoot = resolve(args['dist-root']);
  const output = resolve(args.output);
  const timeoutMs = Number(args['timeout-ms'] ?? '90000');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  const chrome = findChrome();

  const server = createServer((req, res) => {
    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      let filePath;
      if (requestUrl.pathname.startsWith('/runtime/')) {
        filePath = safePath(runtimeRoot, requestUrl.pathname.slice('/runtime/'.length));
      } else {
        filePath = safePath(distRoot, requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname);
      }
      if (!filePath) { res.writeHead(403).end('forbidden'); return; }
      let bytes;
      try { bytes = readFileSync(filePath); }
      catch { res.writeHead(404).end('not found'); return; }
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
  if (!port) throw new Error('screenshot server did not expose a port');
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9223;
  const profile = mkdtempSync(resolve(tmpdir(), `nwe-preview1-screenshot-${Date.now()}-`));
  const query = new URLSearchParams({
    previewManifest: `${origin}/runtime/manifest.json`,
    renderer: 'webgl2',
    graphics: 'high',
    solarTime: VISUAL_PROOF_SOLAR_TIME_UTC,
  });
  if (args['ground-imagery-manifest']) {
    const relative = args['ground-imagery-manifest'].replace(/^\/+/, '');
    if (!relative || relative.includes('..')) throw new Error('--ground-imagery-manifest must be a safe runtime-relative path');
    query.set('groundImagery', `${origin}/runtime/${relative}`);
  }
  const url = `${origin}/?${query}`;
  const child = spawn(chrome, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1440,900',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*',
    `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });

  let cdp = null;
  try {
    const page = await waitForDevTools(debugPort, Math.min(timeoutMs, 15000));
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const bodyText = await waitForReady(cdp, timeoutMs);
    await delay(250);
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!screenshot?.data) throw new Error('CDP screenshot returned no PNG data');
    const png = Buffer.from(screenshot.data, 'base64');
    if (png.length < 1000) throw new Error(`screenshot PNG unexpectedly small: ${png.length} bytes`);
    const daylightEvidence = await measureWorldViewportLuminance(cdp, png);
    if (daylightEvidence.mean_luma < 18 || daylightEvidence.bright_fraction < 0.15) {
      throw new Error(`VISUAL_PROOF_WORLD_TOO_DARK: ${JSON.stringify(daylightEvidence)}`);
    }
    writeFileSync(output, png);
    console.log(JSON.stringify({
      schema: 'nwe.preview1-visual-proof/0.1',
      status: 'PASS',
      ready_text_observed: bodyText.includes('REAL WORLD READY'),
      output,
      png_bytes: png.length,
      viewport: [1440, 900],
      renderer_request: 'webgl2',
      graphics_profile: 'high',
      solar_clock: 'fixed-utc-presentation-time',
      solar_time_utc: VISUAL_PROOF_SOLAR_TIME_UTC,
      daylight_world_viewport: daylightEvidence,
      ground_imagery_manifest: args['ground-imagery-manifest'] ?? null,
    }, null, 2));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nChrome tail:\n${chromeLog.slice(-5000)}`);
  } finally {
    cdp?.close?.();
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await new Promise((resolvePromise) => server.close(resolvePromise));
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch {}
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
