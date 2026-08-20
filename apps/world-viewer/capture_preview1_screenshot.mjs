import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';

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

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForDevToolsProfile(profile, timeoutMs) {
  const started = Date.now();
  const activePortFile = resolve(profile, 'DevToolsActivePort');
  while (Date.now() - started < timeoutMs) {
    if (existsSync(activePortFile)) {
      try {
        const [portText, browserPath] = readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
        const port = Number(portText);
        if (Number.isInteger(port) && port > 0) return { port, browserPath: browserPath || null };
      } catch {}
    }
    await delay(100);
  }
  throw new Error(`DevToolsActivePort unavailable after ${timeoutMs} ms`);
}

async function waitForDevToolsTarget(port, timeoutMs) {
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
  throw new Error(`DevTools page target unavailable after ${timeoutMs} ms on port ${port}`);
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
  const chrome = findChrome();
  const profile = mkdtempSync(resolve(tmpdir(), `nwe-preview1-screenshot-${Date.now()}-`));
  const query = new URLSearchParams({
    previewManifest: `${origin}/runtime/manifest.json`,
    renderer: 'webgl2',
  });
  const url = `${origin}/?${query}`;
  const child = spawn(chrome, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1440,900',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let chromeLog = '';
  child.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });

  let cdp = null;
  try {
    const startupBudgetMs = Math.min(timeoutMs, 30000);
    const devTools = await waitForDevToolsProfile(profile, startupBudgetMs);
    const page = await waitForDevToolsTarget(devTools.port, startupBudgetMs);
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const bodyText = await waitForReady(cdp, timeoutMs);
    await delay(500);
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!screenshot?.data) throw new Error('CDP screenshot returned no PNG data');
    const png = Buffer.from(screenshot.data, 'base64');
    if (png.length < 1000) throw new Error(`screenshot PNG unexpectedly small: ${png.length} bytes`);
    writeFileSync(output, png);
    console.log(JSON.stringify({
      schema: 'nwe.preview1-visual-proof/0.1',
      status: 'PASS',
      ready_text_observed: bodyText.includes('REAL WORLD READY'),
      output,
      png_bytes: png.length,
      viewport: [1440, 900],
      renderer_request: 'webgl2',
      devtools_dynamic_port: true,
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
