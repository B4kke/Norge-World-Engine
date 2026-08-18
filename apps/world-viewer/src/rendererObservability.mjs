export function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function finiteSamples(values) {
  return (values ?? []).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
}

export function percentile(values, quantile) {
  if (!(quantile >= 0 && quantile <= 1)) throw new RangeError('quantile must be within [0, 1]');
  const samples = finiteSamples(values).sort((a, b) => a - b);
  if (!samples.length) return null;
  if (samples.length === 1) return samples[0];
  const index = (samples.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return samples[lower];
  const weight = index - lower;
  return samples[lower] * (1 - weight) + samples[upper] * weight;
}

export function summarizeFrameGaps(values) {
  const samples = finiteSamples(values);
  return {
    samples: samples.length,
    p50_ms: percentile(samples, 0.50),
    p95_ms: percentile(samples, 0.95),
    p99_ms: percentile(samples, 0.99),
    largest_ms: samples.length ? Math.max(...samples) : null,
  };
}

export function createFrameGapMonitor({
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  if (typeof requestFrame !== 'function') {
    return { start() {}, stop() { return summarizeFrameGaps([]); } };
  }
  let running = false;
  let frameId = null;
  let previous = null;
  const gaps = [];
  const tick = (timestamp) => {
    if (!running) return;
    if (previous !== null && Number.isFinite(timestamp)) gaps.push(timestamp - previous);
    previous = timestamp;
    frameId = requestFrame(tick);
  };
  return {
    start() {
      if (running) return;
      running = true;
      frameId = requestFrame(tick);
    },
    stop() {
      running = false;
      if (frameId !== null && typeof cancelFrame === 'function') cancelFrame(frameId);
      frameId = null;
      return summarizeFrameGaps(gaps);
    },
  };
}

export function byteLengthOf(...values) {
  return values.reduce((total, value) => total + (Number(value?.byteLength) || 0), 0);
}

export function browserMemorySnapshot() {
  const memory = globalThis.performance?.memory;
  if (!memory) return null;
  const snapshot = {
    used_js_heap_bytes: Number(memory.usedJSHeapSize),
    total_js_heap_bytes: Number(memory.totalJSHeapSize),
    js_heap_limit_bytes: Number(memory.jsHeapSizeLimit),
  };
  return Object.values(snapshot).every(Number.isFinite) ? snapshot : null;
}
