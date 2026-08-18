function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function errorIdentity(error) {
  return Object.freeze({
    name: typeof error?.name === 'string' ? error.name : null,
    code: typeof error?.code === 'string' ? error.code : null,
    message: String(error?.message ?? error),
  });
}

export function observeStreamingLifecycleAdapters({
  activateTile = async () => {},
  deactivateTile = async () => {},
  disposeTile = async () => {},
  clock = monotonicNow,
  onObservation = () => {},
} = {}) {
  requireFunction(activateTile, 'activateTile');
  requireFunction(deactivateTile, 'deactivateTile');
  requireFunction(disposeTile, 'disposeTile');
  requireFunction(clock, 'clock');
  requireFunction(onObservation, 'onObservation');

  function emit(observation) {
    try {
      onObservation(Object.freeze(observation));
    } catch {
      // Observability must never alter tile lifecycle semantics.
    }
  }

  function wrap(phase, adapter) {
    return async (tile, payload, context = {}) => {
      const startedAt = clock();
      try {
        const result = await adapter(tile, payload, context);
        emit({
          schema: 'nwe.streaming-lifecycle-observation/0.1',
          phase,
          status: 'completed',
          tileId: typeof tile?.id === 'string' ? tile.id : null,
          reason: typeof context?.reason === 'string' ? context.reason : null,
          startedAt,
          durationMs: Math.max(0, clock() - startedAt),
        });
        return result;
      } catch (error) {
        emit({
          schema: 'nwe.streaming-lifecycle-observation/0.1',
          phase,
          status: 'failed',
          tileId: typeof tile?.id === 'string' ? tile.id : null,
          reason: typeof context?.reason === 'string' ? context.reason : null,
          startedAt,
          durationMs: Math.max(0, clock() - startedAt),
          error: errorIdentity(error),
        });
        throw error;
      }
    };
  }

  return Object.freeze({
    activateTile: wrap('activate', activateTile),
    deactivateTile: wrap('deactivate', deactivateTile),
    disposeTile: wrap('dispose', disposeTile),
  });
}
