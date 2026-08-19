import './styles.css';
import './preview1.css';
import { DEFAULT_PREVIEW3_MANIFEST, runPreview3 } from './preview3';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('PREVIEW3_APP_ROOT_MISSING');

const params = new URLSearchParams(location.search);
const manifestUrl = params.get('previewManifest') || DEFAULT_PREVIEW3_MANIFEST;
const previewReportUrl = params.get('previewReport');
const sameOriginAudit = params.get('previewAuditOrigin') === '1';
const graphicsProfile = params.get('graphics') || 'balanced';
const nativeFetch = globalThis.fetch.bind(globalThis);

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand-block">
        <p class="eyebrow">Norge World Engine</p>
        <h1>World Viewer · Nannestad 3×3</h1>
      </div>
      <div class="topbar-actions">
        <span class="mode">REAL 3×3 · WEBGL2 BASELINE</span>
      </div>
    </header>
    <section class="viewport" aria-label="Nannestad real 3x3 terrain viewport">
      <canvas id="world-canvas"></canvas>
      <div class="viewport-message running" id="experiment-intro">
        <span class="status-dot"></span>
        <div>
          <strong id="preview3-title">Laster 9 verifiserte terrengfliser…</strong>
          <p id="preview3-copy">3 km × 3 km ekte NHM DTM. Veier og bygninger er foreløpig bare center 1×1 km.</p>
        </div>
      </div>
      <div class="coordinates" id="coordinates">EPSG:25832 / NN2000 · shared render origin</div>
      <div class="phase-chip" id="phase-chip">LOADING</div>
    </section>
    <aside class="panel" id="runtime-panel">
      <section>
        <p class="section-label">World truth</p>
        <div class="row"><span>Terrain extent</span><strong id="metric-scene">3×3 KM · 9 TILES</strong></div>
        <div class="row"><span>Terrain verification</span><strong id="metric-terrain">WAIT</strong></div>
        <div class="row"><span>Roads</span><strong id="metric-roads">CENTER 1×1 · WAIT</strong></div>
        <div class="row"><span>Buildings</span><strong id="metric-buildings">CENTER 1×1 · WAIT</strong></div>
        <div class="row"><span>Raw-source runtime calls</span><strong class="pass">0 REQUIRED</strong></div>
        <p class="copy" id="world-note">Browseren skal kun konsumere kompilerte, provenance-verifiserte runtime-artifacts.</p>
      </section>
      <section>
        <p class="section-label">Runtime / GPU</p>
        <div class="row"><span>Renderer</span><strong id="metric-renderer">WEBGL2 BASELINE</strong></div>
        <div class="row"><span>Terrain resources</span><strong id="metric-resources">WAIT</strong></div>
        <div class="row"><span>Mesh</span><strong id="metric-mesh">WAIT</strong></div>
        <div class="row"><span>Retained terrain</span><strong id="metric-bytes">WAIT</strong></div>
        <div class="row"><span>First visible</span><strong id="metric-first">WAIT</strong></div>
      </section>
      <section>
        <p class="section-label">Scope</p>
        <p class="copy">Terrain er ekte 3×3. Vectorlag er fortsatt den verifiserte center-flisen. Dette er med vilje: multi-tile terrain bevises før veier/bygninger utvides.</p>
        <p class="copy">WebGPU multi-tile er ikke erklært bevist i denne siden. WebGL2 brukes som deterministisk browser-baseline.</p>
        <p class="copy" id="artifact-note">Manifest: ${manifestUrl}</p>
      </section>
    </aside>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#world-canvas');
const phaseChip = document.querySelector<HTMLDivElement>('#phase-chip');
const intro = document.querySelector<HTMLDivElement>('#experiment-intro');
if (!canvas || !phaseChip || !intro) throw new Error('PREVIEW3_UI_MISSING');

function setMetric(id: string, value: string, state: 'pass' | 'warn' | 'fail' | 'neutral' = 'neutral') {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) return;
  element.textContent = value;
  element.classList.remove('pass', 'warn', 'fail');
  if (state !== 'neutral') element.classList.add(state);
}

function formatBytes(value: number) {
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function createAuditedFetch() {
  const requests: string[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href).href;
    requests.push(url);
    if (sameOriginAudit && new URL(url).origin !== location.origin) {
      throw new Error(`PREVIEW3_BROWSER_ORIGIN_ESCAPE: ${url}`);
    }
    return nativeFetch(input, init);
  };
  return { fetchImpl, requests };
}

async function postReport(report: any) {
  if (!previewReportUrl) return;
  try {
    await nativeFetch(new URL(previewReportUrl, location.href).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('PREVIEW3_REPORT_FAILED', error);
  }
}

async function start() {
  const runtime = createAuditedFetch();
  try {
    const { result } = await runPreview3({
      canvas,
      manifestUrl,
      fetchImpl: runtime.fetchImpl,
      graphicsProfile,
      onPhase: (phase) => {
        phaseChip.textContent = phase.split(':')[0].toUpperCase();
      },
    });
    const terrainShas = result.terrain.tiles.map((tile: any) => tile.artifact_sha256);
    if (new Set(terrainShas).size !== 9) throw new Error('PREVIEW3_EXPECTED_NINE_DISTINCT_ARTIFACTS');
    setMetric('metric-terrain', 'PASS ×9', 'pass');
    setMetric('metric-roads', `CENTER · ${result.roads.count} paths`, 'pass');
    setMetric('metric-buildings', `CENTER · ${result.buildings.count} footprints`, 'pass');
    setMetric('metric-renderer', 'WEBGL2 · PASS', 'pass');
    setMetric('metric-resources', `${result.renderer.resource_lifecycle.active_tile_count} tiles · ${result.renderer.resource_lifecycle.current_buffer_count} buffers`, 'pass');
    setMetric('metric-mesh', `${result.renderer.terrain_vertices.toLocaleString()} V · ${result.renderer.terrain_triangles.toLocaleString()} tris`);
    setMetric('metric-bytes', formatBytes(result.terrain.retained_bytes));
    setMetric('metric-first', `${result.timing_ms.total_to_first_frame.toFixed(1)} ms`);
    const coordinates = document.querySelector<HTMLElement>('#coordinates');
    if (coordinates) coordinates.textContent = `${result.tile_id} · 9× 1 km · EPSG:25832 / NN2000`;
    const note = document.querySelector<HTMLElement>('#world-note');
    if (note) note.textContent = '9/9 terrain tiles er runtime-verifisert før mesh/GPU-opprettelse. Ingen rå Kartverket-kall fra browser runtime.';
    phaseChip.textContent = '3×3 WORLD READY';
    phaseChip.classList.add('pass-chip');
    intro.classList.add('hidden');
    await postReport({
      schema: 'nwe.world-preview3-browser-smoke/0.1',
      status: 'PASS',
      phase: phaseChip.textContent,
      runtime_requests: runtime.requests,
      result,
    });
  } catch (error) {
    console.error(error);
    phaseChip.textContent = '3×3 NOT READY';
    phaseChip.classList.add('fail-chip');
    setMetric('metric-scene', 'FAIL CLOSED', 'fail');
    setMetric('metric-terrain', 'NOT ACCEPTED', 'fail');
    const note = document.querySelector<HTMLElement>('#world-note');
    if (note) note.textContent = error instanceof Error ? error.message : String(error);
    await postReport({
      schema: 'nwe.world-preview3-browser-smoke/0.1',
      status: 'FAIL',
      phase: phaseChip.textContent,
      runtime_requests: runtime.requests,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

void start();
