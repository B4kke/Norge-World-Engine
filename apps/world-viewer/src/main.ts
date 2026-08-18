import './styles.css';
import { runWorldViewerTerrainExperiment } from './terrainExperiment.mjs';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('WORLD_VIEWER_APP_ROOT_MISSING');

const probeCanvas = document.createElement('canvas');
const webgl2 = probeCanvas.getContext('webgl2', {
  antialias: false,
  alpha: false,
  depth: true,
  stencil: false,
});
const webgpuAvailable = 'gpu' in navigator;
const workerAvailable = typeof Worker === 'function';
const webcryptoAvailable = Boolean(globalThis.crypto?.subtle);
const params = new URLSearchParams(location.search);
const terrainBundle = params.get('terrainBundle');
const terrainTileId = params.get('terrainTileId');
const terrainCenterE = Number(params.get('centerE'));
const terrainCenterN = Number(params.get('centerN'));
const realTerrainMode = Boolean(terrainBundle);

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Norge World Engine</p>
        <h1>World Viewer · P0</h1>
      </div>
      <span class="mode">Forsøk 18 · terrain worker</span>
    </header>

    <section class="viewport" aria-label="World renderer viewport">
      <canvas id="world-canvas"></canvas>
      <div class="viewport-message" id="experiment-intro">
        <span class="status-dot"></span>
        <div>
          <strong>Terrain runtime-forsøk er koblet inn</strong>
          <p>${realTerrainMode
            ? 'Denne sesjonen er konfigurert for en ekstern kompilert terrain-bundle. Ingen rå Kartverket-kilde skal kontaktes av vieweren.'
            : 'Standardkjøringen bruker en tydelig merket syntetisk 1000×1000 strukturfixture. Den går gjennom samme provenance → decode → DedicatedWorker → scheduler → WebGL2-lifecycle, men er ikke Nannestad world truth.'}</p>
          <button id="terrain-experiment-button" class="primary-action">Kjør Forsøk 18</button>
        </div>
      </div>
      <div class="coordinates">Prototype 0 · Nannestad contract · EPSG:25832 / NN2000</div>
      <div class="phase-chip" id="phase-chip">IDLE</div>
    </section>

    <aside class="panel">
      <section>
        <p class="section-label">Forsøk 18 · browser terrain lifecycle</p>
        <div class="row"><span>Input</span><strong class="${realTerrainMode ? 'pass' : 'warn'}" id="metric-input">${realTerrainMode ? 'REAL BUNDLE PARAM' : 'SYNTHETIC STRUCTURAL'}</strong></div>
        <div class="row"><span>Status</span><strong id="metric-status">READY</strong></div>
        <div class="row"><span>Full provenance</span><strong id="metric-provenance">—</strong></div>
        <div class="row"><span>Module DedicatedWorker</span><strong id="metric-worker">—</strong></div>
        <div class="row"><span>First visible</span><strong id="metric-first-visible">—</strong></div>
        <div class="row"><span>Largest rAF gap</span><strong id="metric-raf">—</strong></div>
        <div class="row"><span>GPU apply p95</span><strong id="metric-gpu">—</strong></div>
        <div class="row"><span>Scheduler cache hit</span><strong id="metric-cache">—</strong></div>
        <div class="row"><span>Retained bytes</span><strong id="metric-bytes">—</strong></div>
        <p class="copy" id="experiment-note">Kjøringen flytter kameraet ut av retain-radius og tilbake. Retur skal bruke scheduler-cache uten ny terrain-resolve.</p>
      </section>

      <section>
        <p class="section-label">Runtime capability</p>
        <div class="row"><span>WebCrypto</span><strong class="${webcryptoAvailable ? 'pass' : 'warn'}">${webcryptoAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
        <div class="row"><span>Dedicated Worker</span><strong class="${workerAvailable ? 'pass' : 'warn'}">${workerAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
        <div class="row"><span>WebGPU probe</span><strong class="${webgpuAvailable ? 'pass' : 'muted'}">${webgpuAvailable ? 'AVAILABLE' : 'NOT DETECTED'}</strong></div>
        <div class="row"><span>WebGL2 measurement path</span><strong class="${webgl2 ? 'pass' : 'warn'}">${webgl2 ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
        <div class="row"><span>Secure context</span><strong class="${window.isSecureContext ? 'pass' : 'warn'}">${window.isSecureContext ? 'YES' : 'NO'}</strong></div>
      </section>

      <section>
        <p class="section-label">Merged viewer boundary</p>
        <div class="row"><span>Full WebCrypto/JCS provenance</span><strong class="pass">MERGED</strong></div>
        <div class="row"><span>Real vector batching harness</span><strong class="pass">MERGED</strong></div>
        <div class="row"><span>Vite deployable shell</span><strong class="pass">MERGED</strong></div>
        <p class="copy">Normal runtime consumes compiled artifacts only. Raw Kartverket, NVDB and OSM acquisition stays outside the browser. WebGL2 here is a measurement harness, not a renderer decision.</p>
      </section>

      <section>
        <p class="section-label">Real terrain handoff</p>
        <p class="copy">Når en godkjent runtime-bundle er hostet, kan samme app kjøres med <code>?terrainBundle=…&terrainTileId=…&centerE=…&centerN=…</code>. Git skal fortsatt ikke inneholde den genererte terrain-filen.</p>
      </section>
    </aside>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#world-canvas');
const experimentButton = document.querySelector<HTMLButtonElement>('#terrain-experiment-button');
const intro = document.querySelector<HTMLDivElement>('#experiment-intro');
const phaseChip = document.querySelector<HTMLDivElement>('#phase-chip');
if (!canvas || !experimentButton || !intro || !phaseChip) throw new Error('WORLD_VIEWER_EXPERIMENT_UI_MISSING');

const gl = canvas.getContext('webgl2', {
  antialias: false,
  alpha: false,
  depth: true,
  stencil: false,
});

function resizeRendererSurface() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  if (gl) {
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.018, 0.043, 0.061, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
}

function setMetric(id: string, value: string, state: 'pass' | 'warn' | 'fail' | 'neutral' = 'neutral') {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) return;
  element.textContent = value;
  element.classList.remove('pass', 'warn', 'fail');
  if (state !== 'neutral') element.classList.add(state);
}

function formatMs(value: unknown) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} ms` : '—';
}

function formatBytes(value: unknown) {
  if (!Number.isFinite(value)) return '—';
  return `${(Number(value) / (1024 * 1024)).toFixed(2)} MiB`;
}

resizeRendererSurface();
new ResizeObserver(resizeRendererSurface).observe(canvas);

const canRun = Boolean(gl && workerAvailable && webcryptoAvailable);
if (!canRun) {
  experimentButton.disabled = true;
  experimentButton.textContent = 'Forsøk utilgjengelig på denne klienten';
  setMetric('metric-status', 'BLOCKED', 'warn');
}

experimentButton.addEventListener('click', async () => {
  experimentButton.disabled = true;
  experimentButton.textContent = 'Kjører…';
  intro.classList.add('running');
  setMetric('metric-status', 'RUNNING', 'warn');
  setMetric('metric-provenance', 'WAIT', 'neutral');
  setMetric('metric-worker', 'WAIT', 'neutral');
  setMetric('metric-cache', 'WAIT', 'neutral');

  try {
    const result = await runWorldViewerTerrainExperiment({
      canvas,
      bundleUrl: terrainBundle,
      tileId: terrainTileId,
      centerE: terrainCenterE,
      centerN: terrainCenterN,
      onPhase: (phase: string) => {
        phaseChip.textContent = phase.toUpperCase();
        if (phase === 'provenance') setMetric('metric-provenance', 'VERIFYING', 'warn');
        if (phase === 'dedicated-worker') setMetric('metric-worker', 'ACTIVE', 'warn');
        if (phase === 'cache-return') setMetric('metric-cache', 'TESTING', 'warn');
      },
    });

    setMetric('metric-input', result.input_mode === 'real-runtime-bundle' ? 'REAL RUNTIME BUNDLE' : 'SYNTHETIC STRUCTURAL', result.input_mode === 'real-runtime-bundle' ? 'pass' : 'warn');
    setMetric('metric-status', 'PASS', 'pass');
    setMetric('metric-provenance', result.verification_code, 'pass');
    setMetric('metric-worker', result.capabilities?.worker ? 'MODULE WORKER PASS' : 'FAIL', result.capabilities?.worker ? 'pass' : 'fail');
    setMetric('metric-first-visible', formatMs(result.browser_timing_ms?.initial_input_to_first_visible), 'pass');
    setMetric('metric-raf', formatMs(result.raf_gap_ms?.during_initial_load?.max_ms), 'neutral');
    setMetric('metric-gpu', formatMs(result.browser_timing_ms?.gpu_apply?.p95_ms), 'neutral');
    setMetric('metric-cache', result.scheduler?.cacheHits === 1 && result.resolver_calls === 1 ? 'PASS · NO RELOAD' : 'FAIL', result.scheduler?.cacheHits === 1 && result.resolver_calls === 1 ? 'pass' : 'fail');
    setMetric('metric-bytes', formatBytes(result.retained_bytes), 'neutral');
    phaseChip.textContent = 'PASS';
    phaseChip.classList.add('pass-chip');
    const note = document.querySelector<HTMLElement>('#experiment-note');
    if (note) {
      note.textContent = result.input_mode === 'real-runtime-bundle'
        ? `Real compiled runtime input passed. Artifact ${String(result.artifact_sha256).slice(0, 12)}…; raw-source acquisition remains outside the viewer.`
        : `PASS som strukturtest. Fixture-prep ${formatMs(result.fixture_prep_ms)} er separat fra runtime-målingen og geometrien må ikke tolkes som Nannestad-data.`;
    }
    experimentButton.textContent = 'Kjør Forsøk 18 på nytt';
  } catch (error) {
    console.error(error);
    setMetric('metric-status', 'FAIL', 'fail');
    phaseChip.textContent = 'FAIL';
    phaseChip.classList.add('fail-chip');
    const note = document.querySelector<HTMLElement>('#experiment-note');
    if (note) note.textContent = error instanceof Error ? error.message : String(error);
    experimentButton.textContent = 'Prøv Forsøk 18 igjen';
  } finally {
    experimentButton.disabled = false;
  }
});
