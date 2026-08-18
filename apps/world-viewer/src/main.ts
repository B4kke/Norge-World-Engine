import './styles.css';

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

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Norge World Engine</p>
        <h1>World Viewer · P0</h1>
      </div>
      <span class="mode">Vite deployment shell</span>
    </header>

    <section class="viewport" aria-label="World renderer viewport">
      <canvas id="world-canvas"></canvas>
      <div class="viewport-message">
        <span class="status-dot"></span>
        <div>
          <strong>Deployment surface ready</strong>
          <p>The existing compiled-artifact consumer and real-artifact batching harness are preserved. This entrypoint does not invent terrain, roads or buildings while verified runtime distribution is still being wired into the hosted viewer.</p>
        </div>
      </div>
      <div class="coordinates">Prototype 0 · Nannestad · EPSG:25832 / NN2000</div>
    </section>

    <aside class="panel">
      <section>
        <p class="section-label">Deployment</p>
        <div class="row"><span>Vite app shell</span><strong class="pass">READY</strong></div>
        <div class="row"><span>Build mode</span><strong>${import.meta.env.MODE}</strong></div>
        <div class="row"><span>Secure context</span><strong class="${window.isSecureContext ? 'pass' : 'warn'}">${window.isSecureContext ? 'YES' : 'NO'}</strong></div>
      </section>

      <section>
        <p class="section-label">GPU capability</p>
        <div class="row"><span>WebGPU</span><strong class="${webgpuAvailable ? 'pass' : 'muted'}">${webgpuAvailable ? 'AVAILABLE' : 'NOT DETECTED'}</strong></div>
        <div class="row"><span>WebGL2 fallback</span><strong class="${webgl2 ? 'pass' : 'warn'}">${webgl2 ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
        <div class="row"><span>Device pixel ratio</span><strong>${window.devicePixelRatio.toFixed(2)}</strong></div>
      </section>

      <section>
        <p class="section-label">Existing viewer boundary</p>
        <div class="row"><span>Compiled-artifact byte/SHA gate</span><strong class="pass">MERGED</strong></div>
        <div class="row"><span>Real vector batching harness</span><strong class="pass">MERGED</strong></div>
        <p class="copy">Normal browser runtime must consume compiled artifacts only. Raw Kartverket, NVDB and OSM acquisition stays outside the viewer. Full provenance reconstruction is shared runtime work and is not duplicated in this Vite shell.</p>
      </section>

      <section>
        <p class="section-label">Next hosted integration</p>
        <ol class="steps">
          <li>Distribute the accepted Nannestad runtime artifacts to the hosted viewer</li>
          <li>Use the shared browser-compatible full provenance verifier once accepted</li>
          <li>Connect terrain loader, Dedicated Worker mesh and streaming lifecycle</li>
          <li>Apply render-local precision/origin invariants</li>
          <li>Connect batched roads/buildings and device metrics</li>
        </ol>
      </section>
    </aside>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#world-canvas');
if (!canvas) throw new Error('WORLD_VIEWER_CANVAS_MISSING');

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

resizeRendererSurface();
new ResizeObserver(resizeRendererSurface).observe(canvas);
