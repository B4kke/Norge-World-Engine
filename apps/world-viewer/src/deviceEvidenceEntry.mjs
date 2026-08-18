import { DEFAULT_PREVIEW1_MANIFEST, runPreview1 } from './preview1.ts';
import { buildDeviceEvidence, evidenceFilename } from './deviceEvidence.mjs';

const params = new URLSearchParams(location.search);
const manifestUrl = params.get('previewManifest') || DEFAULT_PREVIEW1_MANIFEST;
const rendererPreference = params.get('renderer') || 'webgl2';
const graphicsProfile = params.get('graphics') || 'balanced';
const frameCount = Number(params.get('frames') || '90');
if (!Number.isInteger(frameCount) || frameCount < 10 || frameCount > 600) throw new Error('DEVICE_EVIDENCE_FRAMES_OUT_OF_RANGE');

const canvas = document.querySelector('#device-canvas');
const status = document.querySelector('#device-status');
const output = document.querySelector('#device-output');
const download = document.querySelector('#device-download');
if (!(canvas instanceof HTMLCanvasElement) || !status || !output || !(download instanceof HTMLButtonElement)) {
  throw new Error('DEVICE_EVIDENCE_UI_MISSING');
}

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
}
resize();
new ResizeObserver(resize).observe(canvas);

const runtimeRequests = [];
const nativeFetch = fetch.bind(globalThis);
const auditedFetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  runtimeRequests.push(new URL(raw, location.href).href);
  return nativeFetch(input, init);
};

function setStatus(text, state = '') {
  status.textContent = text;
  status.dataset.state = state;
}

async function run() {
  setStatus('LOADING VERIFIED ARTIFACTS');
  try {
    const { result } = await runPreview1({
      canvas,
      manifestUrl,
      fetchImpl: auditedFetch,
      graphicsProfile,
      rendererPreference,
      benchmarkFrameCount: frameCount,
      onPhase: (phase) => setStatus(String(phase).toUpperCase()),
    });
    const evidence = buildDeviceEvidence({
      result,
      runtimeRequests,
      locationHref: location.href,
      navigatorLike: navigator,
      screenLike: screen,
    });
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    output.textContent = json;
    setStatus('DEVICE EVIDENCE PASS', 'pass');
    download.disabled = false;
    download.addEventListener('click', () => {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = evidenceFilename(evidence);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { once: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`FAIL CLOSED · ${message}`, 'fail');
    output.textContent = JSON.stringify({ schema: 'nwe.world-viewer-device-evidence/0.1', status: 'FAIL', error: message, runtime_requests: runtimeRequests }, null, 2);
  }
}

void run();
