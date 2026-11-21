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

// Exercise the real DOM wiring in Chrome after capturing the immutable A/B
// frame. This intentionally checks button/input events and local persistence,
 // not just the pure solar math already covered by Node tests.
async function assertSolarClockUi(cdp) {
  const expression = `(() => {
    const panel = document.querySelector('[data-solar-clock-controls="true"]');
    if (!panel) return { status: 'CLOCK_PANEL_MISSING' };
    const slider = panel.querySelector('input[type="range"]');
    const output = panel.querySelector('output');
    const mode = panel.querySelector('div:last-child > span');
    const noon = panel.querySelector('button[aria-label="Sett klokken til 12"]');
    const live = panel.querySelector('button[aria-label="Bruk faktisk klokkeslett igjen"]');
    if (!slider || !output || !mode || !noon || !live) {
      return { status: 'CLOCK_ELEMENTS_MISSING' };
    }
    const initial = { label: output.textContent, mode: mode.textContent };
    noon.click();
    const afterNoon = {
      label: output.textContent, mode: mode.textContent,
      stored: JSON.parse(localStorage.getItem('nwe:solar-time-of-day:v1') || 'null'),
    };
    slider.value = '315';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    const duringDrag = { label: output.textContent, mode: mode.textContent };
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const afterDrag = {
      label: output.textContent,
      stored: JSON.parse(localStorage.getItem('nwe:solar-time-of-day:v1') || 'null'),
    };
    live.click();
    const afterLive = {
      mode: mode.textContent, reset_disabled: live.disabled,
      stored: localStorage.getItem('nwe:solar-time-of-day:v1'),
    };
    return { status: 'PASS', range: { min: slider.min, max: slider.max, step: slider.step },
      initial, afterNoon, duringDrag, afterDrag, afterLive };
  })()`;
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  const proof = result?.result?.value;
  if (result?.exceptionDetails || proof?.status !== 'PASS'
      || proof.range?.min !== '0' || proof.range?.max !== '1439' || proof.range?.step !== '1'
      || proof.initial?.mode !== 'Fast visning'
      || proof.afterNoon?.label !== '12:00' || proof.afterNoon?.mode !== 'Manuell'
      || proof.afterNoon?.stored?.minutes !== 720
      || proof.duringDrag?.label !== '05:15' || proof.duringDrag?.mode !== 'Manuell'
      || proof.afterDrag?.label !== '05:15' || proof.afterDrag?.stored?.minutes !== 315
      || proof.afterLive?.mode !== 'Faktisk tid' || proof.afterLive?.reset_disabled !== true
      || proof.afterLive?.stored !== null) {
    throw new Error(`VISUAL_PROOF_SOLAR_CLOCK_UI_FAILED: ${JSON.stringify(proof)}`);
  }
  return proof;
}


async function assertSurfaceProofUi(cdp) {
  const expression = `(() => {
    const source = window.__nweSurfaceProof?.snapshot?.();
    const button = document.querySelector('[data-nwe-ground-color-control]');
    if (!source || !button) return { status: 'PRESENTATION_EVIDENCE_MISSING', source, button: Boolean(button) };
    const before = button.textContent;
    button.click();
    const pbr = window.__nweSurfaceProof.snapshot();
    button.click();
    const restored = window.__nweSurfaceProof.snapshot();
    return { status: 'PASS', before, pbr, restored };
  })()`;
  const output = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  const proof = output?.result?.value;
  const sample = proof?.restored;
  const palettes = sample?.building_palette;
  const resolved = palettes?.resolved ?? {};
  const fallback = palettes?.fallback ?? {};
  const wallStyles = (resolved.wall_palette_count ?? 0) + (fallback.wall_palette_count ?? 0);
  const roofStyles = (resolved.roof_palette_count ?? 0) + (fallback.roof_palette_count ?? 0);
  const materials = sample?.building_materials;
  const counts = [materials?.resolved_material_counts, materials?.fallback_material_counts];
  const sumSlots = (surface) => [0,1].map(slot => counts.reduce((n,group) => n+(group?.[surface]?.[slot] ?? 0),0));
  const wallSlots = sumSlots('wall'), roofSlots = sumSlots('roof');
  const materialEvidenceOk = wallSlots.every(n=>n>0) && roofSlots.every(n=>n>0)
    && wallSlots.reduce((a,b)=>a+b,0) === sample?.building_source_count
    && roofSlots.reduce((a,b)=>a+b,0) === sample?.building_source_count
    && materials?.presentation_draw_candidates >= 4 && materials.presentation_draw_candidates <= 8
    && materials?.procedural_alternatives?.texture_count === 6
    && materials?.procedural_alternatives?.network_bytes === 0;
  const roofs = [resolved.roofs, fallback.roofs];
  const gableCount = roofs.reduce((total, item) => total
    + (item?.dom_oriented_gable ?? 0) + (item?.fallback_visual_gable ?? 0), 0);
  if (output?.exceptionDetails || proof?.status !== 'PASS'
      || sample?.building_source_count < 100
      || wallStyles < 4 || roofStyles < 3 || gableCount < 1 || !materialEvidenceOk
      || sample.ground_color?.mode !== 'source-derived-geographic-albedo'
      || !/^[0-9a-f]{64}$/.test(sample.ground_color?.texture_sha256 ?? '')
      || sample.ground_color?.native_ground_sample_distance_m !== 10
      || !String(proof.before).includes('Satellitt')
      || proof.pbr?.ground_color_mode !== 'pbr'
      || !String(proof.pbr?.control_label).includes('PBR')
      || sample.ground_color_mode !== 'satellite'
      || !String(sample.control_label).includes('Satellitt')
      || proof.pbr?.building_sha256 !== sample.building_sha256
      || proof.pbr?.terrain_sha256 !== sample.terrain_sha256) {
    throw new Error('VISUAL_PROOF_BUILDING_PALETTE_SATELLITE_UI_FAILED: ' + JSON.stringify(proof));
  }
  return {
    status: 'PASS',
    building_source_count: sample.building_source_count,
    palette: palettes,
    building_materials: {wall_slots:wallSlots,roof_slots:roofSlots,draw_candidates:materials.presentation_draw_candidates,procedural:materials.procedural_alternatives},
    wall_style_count_sum: wallStyles,
    roof_style_count_sum: roofStyles,
    presentation_gable_count: gableCount,
    satellite: { texture_sha256: sample.ground_color.texture_sha256,
      native_ground_sample_distance_m: sample.ground_color.native_ground_sample_distance_m,
      default_mode: 'satellite', pbr_toggle: 'PASS', satellite_restore: 'PASS' },
    truth_guard: sample.truth_guard,
  };
}

/** Reuse the accepted runtime snapshot for both camera-locked vegetation modes. */
async function waitForTreeProof(cdp, mode, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await cdp.send('Runtime.evaluate', {
        expression: 'window.__nweTreeProof?.snapshot?.() ?? null',
        returnByValue: true,
      });
      last = response?.result?.value ?? null;
      if (last?.schema === 'nwe.tree-camera-ab/0.1' && last.mode === mode
          && last.camera?.mode === 'free-fly'
          && last.frame_sample_count >= 2
          && (mode === 'proxy' || last.near_field?.selected_ids?.includes(last.target?.id))) {
        return last;
      }
      const errorState = await cdp.send('Runtime.evaluate', {
        expression: 'document.querySelector("#phase-chip")?.textContent ?? ""',
        returnByValue: true,
      });
      if (errorState?.result?.value === 'DATA NOT READY') throw new Error('TREE_PROOF_SCENE_FAILED');
    } catch (error) {
      if (String(error).includes('TREE_PROOF_SCENE_FAILED')) throw error;
      // Navigation can temporarily destroy the previous execution context.
    }
    await delay(200);
  }
  throw new Error('TREE_PROOF_TIMEOUT_' + mode + ': ' + JSON.stringify(last));
}

async function measureTreePixelDifference(cdp, baselinePng, authoredPng) {
  const sourceA = 'data:image/png;base64,' + baselinePng.toString('base64');
  const sourceB = 'data:image/png;base64,' + authoredPng.toString('base64');
  const expression = '(async () => {'
    + 'const load = async(src) => { const i = new Image(); i.src = src; await i.decode(); return i; };'
    + 'const [a,b] = await Promise.all([load(' + JSON.stringify(sourceA) + '),load(' + JSON.stringify(sourceB) + ')]);'
    + 'if(a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) throw new Error("A/B viewport mismatch");'
    + 'const rect = document.querySelector("#world-canvas")?.getBoundingClientRect();'
    + 'if(!rect || rect.width < 100 || rect.height < 100) throw new Error("missing world ROI");'
    + 'const region = {x:Math.max(0,Math.floor(rect.x + rect.width*0.32)), y:Math.max(0,Math.floor(rect.y + rect.height*0.19)),'
    + 'w:Math.floor(rect.width*0.36), h:Math.floor(rect.height*0.63)};'
    + 'region.w=Math.min(region.w,a.naturalWidth-region.x);region.h=Math.min(region.h,a.naturalHeight-region.y);'
    + 'if(region.w<40||region.h<40)throw new Error("invalid tree comparison ROI");'
    + 'const pixels = (image) => { const c=document.createElement("canvas"); c.width=region.w;c.height=region.h;'
    + 'const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(image,region.x,region.y,region.w,region.h,0,0,region.w,region.h);'
    + 'return ctx.getImageData(0,0,region.w,region.h).data; };'
    + 'const pa=pixels(a),pb=pixels(b);let total=0,changed=0,count=0;'
    + 'for(let k=0;k<pa.length;k+=16){const d=(Math.abs(pa[k]-pb[k])+Math.abs(pa[k+1]-pb[k+1])+Math.abs(pa[k+2]-pb[k+2]))/3;'
    + 'total+=d;if(d>18)changed++;count++;}'
    + 'return {region:[region.x,region.y,region.w,region.h],sampled_pixels:count,mean_abs_rgb_delta:total/count,changed_pixel_share:changed/count};'
    + '})()';
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result?.exceptionDetails || !(result?.result?.value?.sampled_pixels > 100)) {
    throw new Error('TREE_PROOF_PIXEL_DIFFERENCE_UNAVAILABLE: ' + JSON.stringify(result?.exceptionDetails ?? null));
  }
  return result.result.value;
}

async function captureTreeAb(cdp, origin, originalQuery, timeoutMs, output) {
  const measurements = {};
  const images = {};
  for (const mode of ['proxy', 'authored']) {
    const query = new URLSearchParams(originalQuery);
    query.set('treeProof', mode);
    query.set('weather', 'clear');
    query.set('solarTime', VISUAL_PROOF_SOLAR_TIME_UTC);
    query.set('renderer', 'webgl2');
    query.set('graphics', 'high');
    await cdp.send('Page.navigate', { url: origin + '/?' + query.toString() });
    const proof = await waitForTreeProof(cdp, mode, timeoutMs);
    await delay(550);
    measurements[mode] = await waitForTreeProof(cdp, mode, timeoutMs);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    if (!shot?.data) throw new Error('TREE_PROOF_SCREENSHOT_MISSING_' + mode);
    const png = Buffer.from(shot.data, 'base64');
    if (png.length < 1000) throw new Error('TREE_PROOF_SCREENSHOT_TOO_SMALL_' + mode);
    images[mode] = png;
    writeFileSync(output.replace(/\.png$/, '-tree-' + mode + '.png'), png);
  }
  const a = measurements.proxy;
  const b = measurements.authored;
  const same = (field) => JSON.stringify(a[field]) === JSON.stringify(b[field]);
  if (!same('target') || !same('camera') || !same('source_sha256')
      || !same('runtime_sha256') || !same('terrain_artifact_sha256')
      || !same('source_representative_count') || !same('rendered_representative_count')
      || !same('backend') || !same('graphics_profile')) {
    throw new Error('TREE_PROOF_COMPARISON_NOT_IDENTICAL_SCENE');
  }
  if (a.authored_triangles_active !== 0 || a.authored_render_draws !== 0
      || a.near_field?.active_count !== 0 || a.authored_resource_bytes_estimate !== 0
      || !(b.authored_triangles_active >= b.authored_triangles_per_tree)
      || b.authored_render_draws !== 1
      || !b.near_field?.selected_ids?.includes(b.target?.id)
      || !(b.authored_resource_bytes_estimate > 0)
      || !(a.frame_sample_count >= 2 && b.frame_sample_count >= 2)) {
    throw new Error('TREE_PROOF_MODE_BUDGET_INVALID: ' + JSON.stringify({proxy:a,authored:b}));
  }
  const pixelDelta = await measureTreePixelDifference(cdp, images.proxy, images.authored);
  if (!(pixelDelta.changed_pixel_share > 0.01 && pixelDelta.mean_abs_rgb_delta > 1)) {
    throw new Error('TREE_PROOF_VISUAL_DIFFERENCE_NOT_OBSERVED: ' + JSON.stringify(pixelDelta));
  }
  const report = {
    schema: 'nwe.tree-camera-ab-proof/0.1', status: 'PASS',
    solar_time_utc: VISUAL_PROOF_SOLAR_TIME_UTC,
    weather: 'clear', camera_pose_equal: true, source_identity_equal: true,
    proxy: a, authored: b, pixel_difference: pixelDelta,
    frame_timing_semantics: 'software WebGL2 browser CPU draw sample, not hardware GPU performance',
    source_semantics: 'same source tree representative, authored tree is CC0 visual model not observed tree',
  };
  writeFileSync(output.replace(/\.png$/, '-tree-ab.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
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
    const solarClockUi = await assertSolarClockUi(cdp);
    const surfaceProof = await assertSurfaceProofUi(cdp);
    const treeAb = args['tree-ab'] === '1'
      ? await captureTreeAb(cdp, origin, query, timeoutMs, output)
      : null;
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
      solar_clock_ui: solarClockUi,
      building_satellite_ui: surfaceProof,
      tree_camera_ab: treeAb,
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
