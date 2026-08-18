function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function durationMs(startedAt, finishedAt) {
  return Math.max(0, finishedAt - startedAt);
}

function normalizeAttempt(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizePhaseTiming(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const timing = {};
  for (const [key, entry] of Object.entries(value)) {
    if (Number.isFinite(entry) || entry === null) timing[key] = entry;
  }
  return Object.freeze(timing);
}

function emitObservation(onObservation, observation) {
  try {
    onObservation(Object.freeze(observation));
  } catch {
    // Observability is deliberately non-authoritative. A broken telemetry sink
    // must not change tile lifecycle, verification, retry or cancellation.
  }
}

export function createObservedTerrainTileLoadFunction({
  loadTile,
  onObservation = () => {},
  clock = monotonicNow,
} = {}) {
  if (typeof loadTile !== 'function') throw new TypeError('loadTile is required');
  if (typeof onObservation !== 'function') throw new TypeError('onObservation must be a function');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  return async function observedTerrainTileLoad(tile, context = {}) {
    const tileId = typeof tile?.id === 'string' ? tile.id : null;
    const attempt = normalizeAttempt(context?.attempt);
    const startedAt = clock();

    try {
      const result = await loadTile(tile, context);
      const finishedAt = clock();
      emitObservation(onObservation, {
        schema: 'nwe.terrain-load-observation/0.1',
        tileId,
        attempt,
        status: 'completed',
        durationMs: durationMs(startedAt, finishedAt),
        retainedByteSize: Number.isFinite(result?.byteSize) ? result.byteSize : null,
        artifactSha256: typeof result?.payload?.artifact?.sha256 === 'string' ? result.payload.artifact.sha256 : null,
        phaseTimingMs: normalizePhaseTiming(result?.payload?.timingMs),
        errorName: null,
        errorCode: null,
        errorMessage: null,
      });
      return result;
    } catch (error) {
      const finishedAt = clock();
      emitObservation(onObservation, {
        schema: 'nwe.terrain-load-observation/0.1',
        tileId,
        attempt,
        status: error?.name === 'AbortError' ? 'aborted' : 'failed',
        durationMs: durationMs(startedAt, finishedAt),
        retainedByteSize: null,
        artifactSha256: null,
        phaseTimingMs: null,
        errorName: typeof error?.name === 'string' ? error.name : null,
        errorCode: typeof error?.code === 'string' ? error.code : null,
        errorMessage: String(error?.message ?? error),
      });
      throw error;
    }
  };
}
