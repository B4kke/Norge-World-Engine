import './styles.css';
import './preview1.css';
import { runWorldViewerTerrainExperiment } from './terrainExperiment.mjs';
import { DEFAULT_PREVIEW1_MANIFEST, runPreview1 } from './preview1';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('WORLD_VIEWER_APP_ROOT_MISSING');

const probeCanvas = document.createElement('canvas');
const webgl2 = probeCanvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false });
const webgpuAvailable = 'gpu' in navigator;
const workerAvailable = typeof Worker === 'function';
const webcryptoAvailable = Boolean(globalThis.crypto?.subtle);
const params = new URLSearchParams(location.search);
const labMode = params.get('lab') === 'terrain';
const manifestUrl = params.get('previewManifest') || DEFAULT_PREVIEW1_MANIFEST;

function shell(modeLabel: string, introTitle: string, introCopy: string, actionLabel: string) {
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Norge World Engine</p>
          <h1>World Viewer · Nannestad</h1>
        </div>
        <span class="mode">${modeLabel}</span>
      </header>

      <section class="viewport" aria-label="World renderer viewport">
        <canvas id="world-canvas"></canvas>
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

      <aside class="panel">
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
          <p class="section-label">Runtime</p>
          <div class="row"><span>Full provenance</span><strong id="metric-provenance">WAIT</strong></div>
          <div class="row"><span>Dedicated Worker</span><strong class="${workerAvailable ? 'pass' : 'warn'}">${workerAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
          <div class="row"><span>WebCrypto</span><strong class="${webcryptoAvailable ? 'pass' : 'warn'}">${webcryptoAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
          <div class="row"><span>WebGL2 preview adapter</span><strong class="${webgl2 ? 'pass' : 'warn'}">${webgl2 ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
          <div class="row"><span>WebGPU probe</span><strong class="${webgpuAvailable ? 'pass' : 'muted'}">${webgpuAvailable ? 'AVAILABLE' : 'NOT DETECTED'}</strong></div>
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
          <p class="copy">Drag to orbit · mouse wheel/pinch-style scroll to zoom · double-click to reset. Open <code>?lab=terrain</code> to keep Forsøk 18 available as an explicit laboratory view.</p>
          <p class="copy" id="artifact-note">Manifest: ${manifestUrl}</p>
        </section>
      </aside>
    </main>
  `;
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

async function runDefaultPreview() {
  shell(
    'PREVIEW 1 · REAL COMPILED',
    'Ekte Nannestad-preview',
    'Laster kompilert DTM1-terreng, NVDB-veier og OSM-bygg gjennom samme runtime-verifikasjon som motoren bruker. Ingen rå geodatakilde kontaktes av vieweren.',
    'Last Preview 1',
  );
  const canvas = document.querySelector<HTMLCanvasElement>('#world-canvas');
  const action = document.querySelector<HTMLButtonElement>('#world-action');
  const intro = document.querySelector<HTMLDivElement>('#experiment-intro');
  const phaseChip = document.querySelector<HTMLDivElement>('#phase-chip');
  if (!canvas || !action || !intro || !phaseChip) throw new Error('WORLD_VIEWER_PREVIEW_UI_MISSING');
  resizeCanvas(canvas);
  new ResizeObserver(() => resizeCanvas(canvas)).observe(canvas);

  const canRun = Boolean(webgl2 && workerAvailable && webcryptoAvailable);
  if (!canRun) {
    action.disabled = true;
    action.textContent = 'Preview utilgjengelig på denne klienten';
    setMetric('metric-scene', 'CLIENT BLOCKED', 'warn');
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
    try {
      const { result } = await runPreview1({
        canvas,
        manifestUrl,
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
      setMetric('metric-mesh', `${result.renderer.terrain_vertices.toLocaleString()} vertices`);
      setMetric('metric-height-backed', String(result.renderer.source_backed_building_heights), 'pass');
      setMetric('metric-height-fallback', `${result.renderer.unresolved_building_heights} · DEBUG 5 m`, 'warn');
      const coordinates = document.querySelector<HTMLElement>('#coordinates');
      if (coordinates) coordinates.textContent = `${result.tile_id} · EPSG:25832 / NN2000`;
      const note = document.querySelector<HTMLElement>('#world-note');
      if (note) note.textContent = 'REAL COMPILED runtime artifacts er verifisert og rendret. Drag/zoom i viewport. Preview 2 utvider samme path til ekte 3×3 streaming.';
      phaseChip.textContent = 'REAL WORLD READY';
      phaseChip.classList.add('pass-chip');
      intro.classList.add('hidden');
    } catch (error) {
      console.error(error);
      phaseChip.textContent = 'DATA NOT READY';
      phaseChip.classList.add('fail-chip');
      setMetric('metric-scene', 'FAIL CLOSED', 'fail');
      setMetric('metric-provenance', 'NOT ACCEPTED', 'fail');
      const note = document.querySelector<HTMLElement>('#world-note');
      if (note) note.textContent = error instanceof Error ? error.message : String(error);
      intro.classList.remove('running');
      action.textContent = 'Prøv Preview 1 igjen';
      action.disabled = false;
      running = false;
    }
  };
  action.addEventListener('click', start);
  void start();
}

async function runTerrainLab() {
  shell(
    'LAB · FORSØK 18',
    'Terrain runtime-laboratorium',
    'Dette er den eksplisitte strukturtesten. Standard-URL-en er nå reservert for den ekte Preview 1-verdenen.',
    'Kjør Forsøk 18',
  );
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
      const result = await runWorldViewerTerrainExperiment({
        canvas,
        onPhase: (phase: string) => { phaseChip.textContent = phase.toUpperCase(); },
      });
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
