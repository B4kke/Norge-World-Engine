function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function cloneJsonValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function freezeEntry(entry) {
  return Object.freeze(entry);
}

export function createStreamingTraceRecorder({
  clock = monotonicNow,
  maxEntries = 2048,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  positiveInteger(maxEntries, 'maxEntries');

  const entries = [];
  let sequence = 0;
  let droppedEntries = 0;

  function append(kind, payload) {
    const entry = freezeEntry({
      sequence: ++sequence,
      recordedAt: clock(),
      kind,
      payload: cloneJsonValue(payload),
    });
    entries.push(entry);
    if (entries.length > maxEntries) {
      entries.shift();
      droppedEntries += 1;
    }
    return entry;
  }

  function onSchedulerEvent(event) {
    if (!event || typeof event !== 'object') return null;
    return append('scheduler-event', event);
  }

  function onLoadObservation(observation) {
    if (!observation || typeof observation !== 'object') return null;
    return append('terrain-load-observation', observation);
  }

  function captureSnapshot(snapshot, label = null) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot must be an object');
    return append('scheduler-snapshot', {
      label: typeof label === 'string' && label.length > 0 ? label : null,
      snapshot,
    });
  }

  function exportTrace(metadata = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new TypeError('metadata must be an object');
    }
    return Object.freeze({
      schema: 'nwe.streaming-movement-trace/0.1',
      metadata: cloneJsonValue(metadata),
      maxEntries,
      retainedEntries: entries.length,
      droppedEntries,
      firstSequence: entries[0]?.sequence ?? null,
      lastSequence: entries.at(-1)?.sequence ?? null,
      entries: Object.freeze(entries.map((entry) => freezeEntry({
        ...entry,
        payload: cloneJsonValue(entry.payload),
      }))),
    });
  }

  return Object.freeze({
    onSchedulerEvent,
    onLoadObservation,
    captureSnapshot,
    exportTrace,
  });
}
