import { createFrameGapMonitor, monotonicNow, summarizeFrameGaps } from './rendererObservability.mjs';

export const DECODE_PLACEMENT_SCHEMA = 'nwe.browser-decode-placement-experiment/0.1';
export const DECODE_PLACEMENT_DEFAULT_ITERATIONS = 20;
export const DECODE_PLACEMENT_MAX_ITERATIONS = 40;

export function normalizeDecodePlacementIterations(value, { min = 1, max = DECODE_PLACEMENT_MAX_ITERATIONS } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`decode placement iterations must be an integer within [${min}, ${max}]`);
  }
  return parsed;
}

function assertArtifactObject(artifact, phase) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error(`DECODE_PLACEMENT_ARTIFACT_INVALID: ${phase}`);
  }
}

function assertDuration(value, phase) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`DECODE_PLACEMENT_INVALID_TIMING: ${phase}`);
  return value;
}

function nextFrame(requestFrame) {
  if (typeof requestFrame !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => requestFrame(resolve));
}

function decodeOnMainThread(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const artifact = JSON.parse(text);
  assertArtifactObject(artifact, 'main-thread');
  return artifact;
}

function requestWorkerDecode(worker, bytes, id, now) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = event?.data;
      if (message?.id !== id) return;
      cleanup();
      if (message.status !== 'PASS') {
        reject(new Error(`DECODE_PLACEMENT_WORKER_REJECTED: ${message?.error ?? 'unknown'}`));
        return;
      }
      try {
        assertArtifactObject(message.artifact, 'worker-roundtrip');
        resolve({
          worker_decode_ms: assertDuration(Number(message.worker_decode_ms), 'worker_decode'),
        });
      } catch (error) {
        reject(error);
      }
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(`DECODE_PLACEMENT_WORKER_ERROR: ${event?.message ?? 'unknown'}`));
    };
    const cleanup = () => {
      worker.removeEventListener?.('message', onMessage);
      worker.removeEventListener?.('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const copy = bytes.slice();
    worker.postMessage({ id, bytes: copy.buffer }, [copy.buffer]);
  });
}

async function measureMainThread({ bytes, iterations, now, requestFrame, cancelFrame }) {
  const frameMonitor = createFrameGapMonitor({ requestFrame, cancelFrame });
  const operationSamples = [];
  frameMonitor.start();
  await nextFrame(requestFrame);
  const startedAt = now();
  for (let index = 0; index < iterations; index += 1) {
    const operationStartedAt = now();
    decodeOnMainThread(bytes);
    operationSamples.push(assertDuration(now() - operationStartedAt, 'main_thread_decode'));
  }
  const totalMs = assertDuration(now() - startedAt, 'main_thread_total');
  await nextFrame(requestFrame);
  return {
    iterations,
    total_ms: totalMs,
    per_iteration_ms: summarizeFrameGaps(operationSamples),
    frame_gaps_ms: frameMonitor.stop(),
  };
}

async function measureWorker({ bytes, iterations, now, requestFrame, cancelFrame, workerFactory }) {
  const worker = workerFactory();
  if (!worker || typeof worker.postMessage !== 'function' || typeof worker.addEventListener !== 'function') {
    throw new TypeError('workerFactory must return a Worker-compatible object');
  }
  const frameMonitor = createFrameGapMonitor({ requestFrame, cancelFrame });
  const roundtripSamples = [];
  const workerDecodeSamples = [];
  try {
    frameMonitor.start();
    await nextFrame(requestFrame);
    const startedAt = now();
    for (let index = 0; index < iterations; index += 1) {
      const roundtripStartedAt = now();
      const result = await requestWorkerDecode(worker, bytes, index + 1, now);
      roundtripSamples.push(assertDuration(now() - roundtripStartedAt, 'worker_roundtrip'));
      workerDecodeSamples.push(result.worker_decode_ms);
    }
    const totalMs = assertDuration(now() - startedAt, 'worker_total');
    await nextFrame(requestFrame);
    return {
      iterations,
      total_ms: totalMs,
      roundtrip_ms: summarizeFrameGaps(roundtripSamples),
      worker_decode_ms: summarizeFrameGaps(workerDecodeSamples),
      frame_gaps_ms: frameMonitor.stop(),
    };
  } finally {
    worker.terminate?.();
  }
}

export async function runBrowserDecodePlacementExperiment({
  bytes,
  artifactSha256 = null,
  iterations = DECODE_PLACEMENT_DEFAULT_ITERATIONS,
  now = monotonicNow,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  workerFactory = () => new Worker(new URL('./jsonDecodeWorker.mjs', import.meta.url), { type: 'module' }),
} = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TypeError('non-empty Uint8Array bytes are required');
  if (typeof now !== 'function') throw new TypeError('now is required');
  const count = normalizeDecodePlacementIterations(iterations);

  const mainThread = await measureMainThread({ bytes, iterations: count, now, requestFrame, cancelFrame });
  const worker = await measureWorker({ bytes, iterations: count, now, requestFrame, cancelFrame, workerFactory });

  return {
    schema: DECODE_PLACEMENT_SCHEMA,
    status: 'PASS',
    experiment_only: true,
    production_policy_selected: false,
    provenance_reverified_in_experiment: false,
    input_precondition: 'caller must pass bytes already accepted by the normal production RuntimeVerificationBundle path',
    artifact_sha256: artifactSha256,
    artifact_bytes: bytes.byteLength,
    iterations: count,
    main_thread: mainThread,
    worker_roundtrip: worker,
    note: 'Directional browser scheduling experiment only. Main-thread decode/JSON.parse is compared with a module Worker using a copied ArrayBuffer and structured-cloned parsed object return. Worker roundtrip therefore includes byte-copy/transfer setup, worker decode+parse, message scheduling and parsed-object clone back to the main thread. The rAF monitor is primed for one baseline frame before each workload so the first post-workload callback can measure blocking rather than losing the comparison timestamp. The experiment intentionally does not re-run or cache provenance verification and cannot select runtime worker policy by itself; compare end-to-end rAF gaps and roundtrip cost before any STRØM/SENTINEL policy change.',
  };
}
