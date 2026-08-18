import './styles.css';
import './preview1.css';
import { runWorldViewerTerrainExperiment } from './terrainExperiment.mjs';
import { GRAPHICS_PROFILE_IDS, RENDERER_PREFERENCES, resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { DEFAULT_PREVIEW1_MANIFEST, runPreview1 } from './preview1';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('WORLD_VIEWER_APP_ROOT_MISSING');

const probeCanvas = document.createElement('canvas');
const webgl2 = probeCanvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false });
const webgpuAvailable = Boolean((navigator as any).gpu);
const workerAvailable = typeof Worker === 'function';
const webcryptoAvailable = Boolean(globalThis.crypto?.subtle);
const params = new URLSearchParams(location.search);
const labMode = params.get('lab') === 'terrain';
const manifestUrl = params.get('previewManifest') || DEFAULT_PREVIEW1_MANIFEST;
const previewReportUrl = params.get('previewReport');
const sameOriginAudit = params.get('previewAuditOrigin') === '1';
const graphicsProfile = resolveGraphicsProfile(params.get('graphics') || 'balanced');
const rendererPreference = resolveRendererPreference(params.get('renderer') || 'auto');
const nativeFetch = globalThis.fetch.bind(globalThis);

function option(value: string, label: string, selected: string) {
  return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
}

function updateQuerySetting(key: string, value: string, defaultValue: string) {
  const url = new URL(location.href);
  if (value === defaultValue) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  location.href = url.href;
}

function shell(modeLabel: string, introTitle: string, introCopy: string, actionLabel: string) {
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand-block">
          <p class="eyebrow">Norge World Engine</p>
          <h1>World Viewer · Nannestad</h1>
        </div>
        <div class="topbar-actions">
          ${labMode ? '' : `
            <label class="graphics-select"><span>Renderer</span><select id="renderer-select" aria-label="Renderer">
              ${option('auto', 'Auto', rendererPreference)}
              ${option('webgpu', 'WebGPU', rendererPreference)}
              ${option('webgl2', 'WebGL2', rendererPreference)}
            </select></label>
            <label class="graphics-select"><span>Grafikk</span><select id="graphics-select" aria-label="Grafikkprofil">
              ${option('low', 'Lav', graphicsProfile.id)}
              ${option('balanced', 'Balansert', graphicsProfile.id)}
              ${option('high', 'Høy', graphicsProfile.id)}
            </select></label>
          `}
          <button type="button" class="panel-toggle" id="panel-toggle" aria-controls="runtime-panel" aria-expanded="false">Data</button>
          <span class="mode">${modeLabel}</span>
        </div>
      </header>

      <section class="viewport" aria-label="World renderer viewport">
        <canvas id="world-canvas"></canvas>
        <div class="mobile-control-hint">1 finger: roter · 2 fingre: zoom + flytt</div>
        <div class="viewport-message" id="experiment-intro">
          <span class="status-dot"></span>
          <div>
            <strong>${introTitle}</strong>
            <p>${introCopy}</p>
            <button id="world-action" class="primary-action">${actionLabel}</button>
          </div>
        </div>
        <div class="coordinates" id="coordinates">Prototype 0 · EPSG:25832 / NN2000</div>
        <div class="phase-chip" id="phase-chip">IDLE</div>
      </section>

      <aside class="panel" id="runtime-panel">
        <section>
          <p class="section-label">World truth</p>
          <div class="row"><span>Scene</span><strong id="metric-scene">NANNESTAD 1×1 KM</strong></div>
          <div class="row"><span>Terrain</span><strong id="metric-terrain">WAIT</strong></div>
          <div class="row"><span>Roads</span><strong id="metric-roads">WAIT</strong></div>
          <div class="row"><span>Buildings</span><strong id="metric-buildings">WAIT</strong></div>
          <div class="row"><span>Raw-source runtime calls</span><strong class="pass">0 REQUIRED</strong></div>
          <p class="copy" id="world-note">Default viewer expects immutable compiled runtime artifacts. Raw Kartverket, NVDB and OSM acquisition remains outside the browser.</p>
        </section>

        <section>
          <p class="section-label">Runtime / GPU</p>
          <div class="row"><span>Active renderer</span><strong id="metric-renderer">WAIT</strong></div>
          <div class="row"><span>Graphics profile</span><strong id="metric-graphics">${graphicsProfile.label.toUpperCase()}</strong></div>
          <div class="row"><span>Full provenance</span><strong id="metric-provenance">WAIT</strong></div>
          <div class="row"><span>Dedicated Worker</span><strong class="${workerAvailable ? 'pass' : 'warn'}">${workerAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
          <div class="row"><span>WebCrypto</span><strong class="${webcryptoAvailable ? 'pass' : 'warn'}">${webcryptoAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
          <div class="row"><span>WebGPU</span><strong class="${webgpuAvailable ? 'pass' : 'muted'}">${webgpuAvailable ? 'AVAILABLE' : 'NOT DETECTED'}</strong></div>
          <div class="row"><span>WebGL2 fallback</span><strong class="${webgl2 ? 'pass' : 'warn'}">${webgl2 ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
          <div class="row"><span>Retained terrain</span><strong id="metric-bytes">—</strong></div>
        </section>

        <section>
          <p class="section-label">Geometry semantics</p>
          <div class="row"><span>Terrain mesh</span><strong id="metric-mesh">—</strong></div>
          <div class="row"><span>Source-backed building heights</span><strong id="metric-height-backed">—</strong></div>
          <div class="row"><span>Unresolved building heights</span><strong id="metric-height-fallback">—</strong></div>
          <p class="copy">Road ribbon width and unresolved 5 m building height are preview-only visual aids, not authoritative physical semantics. Their source geometry remains unchanged.</p>
        </section>

        <section>
          <p class="section-label">Controls / provenance</p>
          <p class="copy">Touch: 1 finger orbit · 2 fingers pinch-zoom + pan. Mouse: drag orbit · Shift/middle/right drag pan · wheel zoom · double-click reset. Renderer/grafikkvalg laster samme world truth på nytt; de endrer ikke geodata.</p>
          <p class="copy" id="artifact-note">Manifest: ${manifestUrl}</p>
        </section>
      </aside>
    </main>
  `;

  document.querySelector<HTMLSelectElement>('#renderer-select')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (RENDERER_PREFERENCES.includes(value)) updateQuerySetting('renderer', value, 'auto');
  });
  document.querySelector<HTMLSelectElement>('#graphics-select')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (GRAPHICS_PROFILE_IDS.includes(value)) updateQuerySetting('graphics', value, 'balanced');
  });

  const shellElement = document.querySelector<HTMLElement>('.shell');
  const panelToggle = document.querySelector<HTMLButtonElement>('#panel-toggle');
  const viewport = document.querySelector<HTMLElement>('.viewport');
  if (!shellElement || !panelToggle || !viewport) return;
  const mobileQuery = matchMedia('(max-width: 760px)');
  const setPanelOpen = (open: boolean) => {
    shellElement.classList.toggle('mobile-panel-open', open && mobileQuery.matches);
    panelToggle.setAttribute('aria-expanded', String(open && mobileQuery.matches));
    panelToggle.textContent = open && mobileQuery.matches ? 'Lukk' : 'Data';
  };
  setPanelOpen(false);
  panelToggle.addEventListener('click', () => setPanelOpen(!shellElement.classList.contains('mobile-panel-open')));
  viewport.addEventListener('pointerdown', () => {
    if (shellElement.classList.contains('mobile-panel-open')) setPanelOpen(false);
  });
  mobileQuery.addEventListener?.('change', () => setPanelOpen(false));
}

function setMetric(id: string, value: string, state: 'pass' | 'warn' | 'fail' | 'neutral' = 'neutral') {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) return;
  element.textContent = value;
  element.classList.remove('pass', 'warn', 'fail');
  if (state !== 'neutral') element.classList.add(state);
}

function formatBytes(value: unknown) {
  if (!Number.isFinite(value)) return '—';
  return `${(Number(value) / (1024 * 1024)).toFixed(2)} MiB`;
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}

function createAuditedRuntimeFetch() {
  const requests: string[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href).href;
    requests.push(url);
    if (sameOriginAudit && new URL(url).origin !== location.origin) throw new Error(`PREVIEW_BROWSER_RAW_NETWORK_FORBIDDEN: ${url}`);
    return nativeFetch(input, init);
  };
  return { fetchImpl, requests };
}

async function postPreviewReport(report: any) {
  if (!previewReportUrl) return;
  try {
    await nativeFetch(new URL(previewReportUrl, location.href).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('PREVIEW_REPORT_FAILED', error);
  }
}

function requestedRendererAvailable() {
  if (!workerAvailable || !webcryptoAvailable) return false;
  if (rendererPreference === 'webgpu') return webgpuAvailable;
  if (rendererPreference === 'webgl2') return Boolean(webgl2);
  return webgpuAvailable || Boolean(webgl2);
}

async function runDefaultPreview() {
  shell(
    'PREVIEW 1 · REAL COMPILED',
    'Ekte Nannestad-preview',
    'Auto bruker WebGPU når klienten kan opprette en fungerende adapter/device, ellers WebGL2. Grafikkprofilen endrer GPU/mesh-budsjett, aldri world truth.',
    'Last Preview 1',
  );
  const canvas = document.querySelector<HTMLCanvasElement>('#world-canvas');
  const action = document.querySelector<HTMLButtonElement>('#world-action');
  const intro = document.querySelector<HTMLDivElement>('#experiment-intro');
  const phaseChip = document.querySelector<HTMLDivElement>('#phase-chip');
  if (!canvas || !action || !intro || !phaseChip) throw new Error('WORLD_VIEWER_PREVIEW_UI_MISSING');
  resizeCanvas(canvas);
  new ResizeObserver(() => resizeCanvas(canvas)).observe(canvas);

  if (!requestedRendererAvailable()) {
    action.disabled = true;
    action.textContent = 'Valgt renderer er utilgjengelig';
    setMetric('metric-scene', 'CLIENT BLOCKED', 'warn');
    setMetric('metric-renderer', `${rendererPreference.toUpperCase()} UNAVAILABLE`, 'warn');
    await postPreviewReport({ status: 'FAIL', code: 'CLIENT_CAPABILITY_BLOCKED', renderer_preference: rendererPreference });
    return;
  }

  let running = false;
  const start = async () => {
    if (running) return;
    running = true;
    action.disabled = true;
    action.textContent = 'Laster ekte world data…';
    intro.classList.add('running');
    phaseChip.textContent = 'LOADING';
    const runtimeFetch = createAuditedRuntimeFetch();
    try {
      const { result } = await runPreview1({
        canvas,
        manifestUrl,
        fetchImpl: runtimeFetch.fetchImpl,
        graphicsProfile: graphicsProfile.id,
        rendererPreference,
        onPhase: (phase) => {
          phaseChip.textContent = phase.toUpperCase();
          if (phase.includes('verify')) setMetric('metric-provenance', 'VERIFYING', 'warn');
        },
      });
      setMetric('metric-terrain', `PASS · ${String(result.terrain.artifact_sha256).slice(0, 10)}…`, 'pass');
      setMetric('metric-roads', `PASS · ${result.roads.count} paths`, 'pass');
      setMetric('metric-buildings', `PASS · ${result.buildings.count} footprints`, 'pass');
      setMetric('metric-provenance', 'PASS ×3', 'pass');
      setMetric('metric-bytes', formatBytes(result.terrain.retained_bytes));
      setMetric('metric-renderer', `${String(result.renderer.backend).toUpperCase()}${result.renderer.fallback ? ' · FALLBACK' : ''}`, result.renderer.fallback ? 'warn' : 'pass');
      setMetric('metric-graphics', `${graphicsProfile.label.toUpperCase()} · ${result.renderer.terrain_vertices.toLocaleString()} V`, 'pass');
      setMetric('metric-mesh', `${result.renderer.terrain_vertices.toLocaleString()} vertices · ${result.renderer.terrain_triangles.toLocaleString()} tris`);
      setMetric('metric-height-backed', String(result.renderer.source_backed_building_heights), 'pass');
      setMetric('metric-height-fallback', `${result.renderer.unresolved_building_heights} · DEBUG 5 m`, 'warn');
      const coordinates = document.querySelector<HTMLElement>('#coordinates');
      if (coordinates) coordinates.textContent = `${result.tile_id} · EPSG:25832 / NN2000`;
      const note = document.querySelector<HTMLElement>('#world-note');
      if (note) {
        const fallback = result.renderer.fallback ? ` Auto fallback: ${result.renderer.fallback.reason}.` : '';
        note.textContent = `REAL COMPILED world truth verifisert. Renderer: ${String(result.renderer.backend).toUpperCase()}, profil: ${graphicsProfile.label}.${fallback}`;
      }
      phaseChip.textContent = 'REAL WORLD READY';
      phaseChip.classList.add('pass-chip');
      intro.classList.add('hidden');
      await postPreviewReport({
        schema: 'nwe.world-preview-browser-smoke/0.1',
        status: 'PASS',
        phase: phaseChip.textContent,
        runtime_requests: runtimeFetch.requests,
        result,
      });
    } catch (error) {
      console.error(error);
      phaseChip.textContent = 'DATA NOT READY';
      phaseChip.classList.add('fail-chip');
      setMetric('metric-scene', 'FAIL CLOSED', 'fail');
      setMetric('metric-provenance', 'NOT ACCEPTED', 'fail');
      setMetric('metric-renderer', 'FAILED', 'fail');
      const note = document.querySelector<HTMLElement>('#world-note');
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
      intro.classList.remove('running');
      action.textContent = 'Prøv Preview 1 igjen';
      action.disabled = false;
      running = false;
      await postPreviewReport({
        schema: 'nwe.world-preview-browser-smoke/0.1',
        status: 'FAIL',
        phase: phaseChip.textContent,
        runtime_requests: runtimeFetch.requests,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  action.addEventListener('click', start);
  void start();
}

async function runTerrainLab() {
  shell('LAB · FORSØK 18', 'Terrain runtime-laboratorium', 'Eksplisitt strukturtest. Standard-URL-en er den ekte Preview 1-verdenen.', 'Kjør Forsøk 18');
  const canvas = document.querySelector<HTMLCanvasElement>('#world-canvas');
  const action = document.querySelector<HTMLButtonElement>('#world-action');
  const intro = document.querySelector<HTMLDivElement>('#experiment-intro');
  const phaseChip = document.querySelector<HTMLDivElement>('#phase-chip');
  if (!canvas || !action || !intro || !phaseChip) throw new Error('WORLD_VIEWER_LAB_UI_MISSING');
  resizeCanvas(canvas);
  action.addEventListener('click', async () => {
    action.disabled = true;
    intro.classList.add('running');
    try {
      const result = await runWorldViewerTerrainExperiment({ canvas, onPhase: (phase: string) => { phaseChip.textContent = phase.toUpperCase(); } });
      setMetric('metric-terrain', result.verification_code, 'pass');
      setMetric('metric-provenance', result.verification_code, 'pass');
      setMetric('metric-bytes', formatBytes(result.retained_bytes));
      phaseChip.textContent = 'LAB PASS';
      phaseChip.classList.add('pass-chip');
    } catch (error) {
      console.error(error);
      phaseChip.textContent = 'LAB FAIL';
      phaseChip.classList.add('fail-chip');
      intro.classList.remove('running');
    } finally {
      action.disabled = false;
      action.textContent = 'Kjør Forsøk 18 på nytt';
    }
  });
}

if (labMode) void runTerrainLab();
else void runDefaultPreview();
