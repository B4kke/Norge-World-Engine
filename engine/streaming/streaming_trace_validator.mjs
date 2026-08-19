const TRACE_SCHEMA = 'nwe.streaming-movement-trace/0.1';

function issue(code, message, detail = {}) {
  return Object.freeze({ code, message, ...detail });
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function attemptKey(payload) {
  if (!payload || typeof payload.tileId !== 'string' || payload.tileId.length === 0) return null;
  if (!positiveInteger(payload.attempt)) return null;
  return `${payload.tileId}#${payload.attempt}`;
}

function lifecycleKey({ phase, status, tileId, reason }) {
  if (!['activate', 'deactivate', 'dispose'].includes(phase)) return null;
  if (!['completed', 'failed'].includes(status)) return null;
  if (typeof tileId !== 'string' || tileId.length === 0) return null;
  return `${phase}|${status}|${tileId}|${typeof reason === 'string' ? reason : ''}`;
}

function schedulerLifecycleKey(payload) {
  const mapping = {
    'tile-activated': ['activate', 'completed'],
    'activation-failed': ['activate', 'failed'],
    'tile-deactivated': ['deactivate', 'completed'],
    'deactivation-failed': ['deactivate', 'failed'],
    'tile-evicted': ['dispose', 'completed'],
    'disposal-failed': ['dispose', 'failed'],
  };
  const mapped = mapping[payload?.type];
  if (!mapped) return null;
  return lifecycleKey({
    phase: mapped[0],
    status: mapped[1],
    tileId: payload.tileId,
    reason: payload.reason,
  });
}

function increment(map, key, entry) {
  const current = map.get(key) ?? [];
  current.push(entry);
  map.set(key, current);
}

export function validateStreamingMovementTrace(trace, {
  requireComplete = true,
  requireKinds = [],
} = {}) {
  const issues = [];

  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    return Object.freeze({
      ok: false,
      code: 'TRACE_INVALID',
      issues: Object.freeze([issue('TRACE_NOT_OBJECT', 'trace must be an object')]),
      summary: null,
    });
  }

  if (trace.schema !== TRACE_SCHEMA) {
    issues.push(issue('TRACE_SCHEMA_MISMATCH', `expected ${TRACE_SCHEMA}`, { actual: trace.schema ?? null }));
  }
  if (!positiveInteger(trace.maxEntries)) issues.push(issue('TRACE_MAX_ENTRIES_INVALID', 'maxEntries must be a positive integer'));
  if (!nonNegativeInteger(trace.retainedEntries)) issues.push(issue('TRACE_RETAINED_ENTRIES_INVALID', 'retainedEntries must be a non-negative integer'));
  if (!nonNegativeInteger(trace.droppedEntries)) issues.push(issue('TRACE_DROPPED_ENTRIES_INVALID', 'droppedEntries must be a non-negative integer'));

  const entries = Array.isArray(trace.entries) ? trace.entries : [];
  if (!Array.isArray(trace.entries)) {
    issues.push(issue('TRACE_ENTRIES_INVALID', 'entries must be an array'));
  } else if (trace.retainedEntries !== entries.length) {
    issues.push(issue('TRACE_RETAINED_ENTRIES_MISMATCH', 'retainedEntries must equal entries.length', {
      retainedEntries: trace.retainedEntries,
      entriesLength: entries.length,
    }));
  }

  if (positiveInteger(trace.maxEntries) && entries.length > trace.maxEntries) {
    issues.push(issue('TRACE_MAX_ENTRIES_EXCEEDED', 'entries exceed maxEntries', {
      maxEntries: trace.maxEntries,
      entriesLength: entries.length,
    }));
  }

  let previousSequence = null;
  const kinds = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(issue('TRACE_ENTRY_INVALID', 'entry must be an object', { index }));
      continue;
    }
    if (!positiveInteger(entry.sequence)) {
      issues.push(issue('TRACE_SEQUENCE_INVALID', 'entry sequence must be a positive integer', { index }));
    } else if (previousSequence != null && entry.sequence !== previousSequence + 1) {
      issues.push(issue('TRACE_SEQUENCE_GAP', 'retained entry sequences must be contiguous', {
        index,
        previousSequence,
        sequence: entry.sequence,
      }));
    }
    if (positiveInteger(entry.sequence)) previousSequence = entry.sequence;

    if (typeof entry.kind !== 'string' || entry.kind.length === 0) {
      issues.push(issue('TRACE_KIND_INVALID', 'entry kind must be a non-empty string', { index }));
    } else {
      kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
    }
  }

  const expectedFirst = entries[0]?.sequence ?? null;
  const expectedLast = entries.at(-1)?.sequence ?? null;
  if (trace.firstSequence !== expectedFirst) {
    issues.push(issue('TRACE_FIRST_SEQUENCE_MISMATCH', 'firstSequence does not match retained entries', {
      expected: expectedFirst,
      actual: trace.firstSequence ?? null,
    }));
  }
  if (trace.lastSequence !== expectedLast) {
    issues.push(issue('TRACE_LAST_SEQUENCE_MISMATCH', 'lastSequence does not match retained entries', {
      expected: expectedLast,
      actual: trace.lastSequence ?? null,
    }));
  }

  if (requireComplete && trace.droppedEntries > 0) {
    issues.push(issue('TRACE_DROPPED_ENTRIES', 'movement evidence is incomplete because entries were dropped', {
      droppedEntries: trace.droppedEntries,
    }));
  }

  for (const kind of requireKinds) {
    if (!kinds.has(kind)) issues.push(issue('TRACE_REQUIRED_KIND_MISSING', `required trace kind is missing: ${kind}`, { kind }));
  }

  const ok = issues.length === 0;
  return Object.freeze({
    ok,
    code: ok ? 'TRACE_ACCEPTED' : issues[0].code,
    issues: Object.freeze(issues),
    summary: Object.freeze({
      retainedEntries: entries.length,
      droppedEntries: nonNegativeInteger(trace.droppedEntries) ? trace.droppedEntries : null,
      kinds: Object.freeze(Object.fromEntries([...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)))),
    }),
  });
}

export function validateCompletedStreamingMovementCapture(trace, {
  requireLifecycleObservations = false,
} = {}) {
  const requiredKinds = ['scheduler-event', 'terrain-load-observation', 'scheduler-snapshot'];
  if (requireLifecycleObservations) requiredKinds.push('lifecycle-observation');
  const structural = validateStreamingMovementTrace(trace, {
    requireComplete: true,
    requireKinds: requiredKinds,
  });
  if (!structural.ok) return structural;

  const issues = [];
  const starts = new Map();
  const observations = new Map();
  const snapshots = [];
  const schedulerLifecycle = new Map();
  const adapterLifecycle = new Map();

  for (const entry of trace.entries) {
    if (entry.kind === 'scheduler-event' && entry.payload?.type === 'load-started') {
      const key = attemptKey(entry.payload);
      if (!key) {
        issues.push(issue('TRACE_LOAD_START_INVALID', 'load-started must include tileId and positive attempt', { sequence: entry.sequence }));
      } else if (starts.has(key)) {
        issues.push(issue('TRACE_LOAD_START_DUPLICATE', `duplicate load-started for ${key}`, { sequence: entry.sequence, key }));
      } else starts.set(key, entry);
    } else if (entry.kind === 'scheduler-event') {
      const key = schedulerLifecycleKey(entry.payload);
      if (key) increment(schedulerLifecycle, key, entry);
    } else if (entry.kind === 'terrain-load-observation') {
      const key = attemptKey(entry.payload);
      if (!key) {
        issues.push(issue('TRACE_LOAD_OBSERVATION_INVALID', 'terrain load observation must include tileId and positive attempt', { sequence: entry.sequence }));
      } else if (observations.has(key)) {
        issues.push(issue('TRACE_LOAD_OBSERVATION_DUPLICATE', `duplicate terrain load observation for ${key}`, { sequence: entry.sequence, key }));
      } else observations.set(key, entry);
    } else if (entry.kind === 'lifecycle-observation') {
      const payload = entry.payload;
      const key = lifecycleKey(payload ?? {});
      if (!key || !Number.isFinite(payload?.durationMs) || payload.durationMs < 0) {
        issues.push(issue('TRACE_LIFECYCLE_OBSERVATION_INVALID', 'lifecycle observation must include valid phase/status/tileId and non-negative durationMs', { sequence: entry.sequence }));
      } else increment(adapterLifecycle, key, entry);
    } else if (entry.kind === 'scheduler-snapshot') snapshots.push(entry);
  }

  for (const [key, start] of starts) {
    if (!observations.has(key)) issues.push(issue('TRACE_LOAD_OBSERVATION_MISSING', `load-started has no matching terrain load observation: ${key}`, { sequence: start.sequence, key }));
  }
  for (const [key, observation] of observations) {
    if (!starts.has(key)) issues.push(issue('TRACE_LOAD_START_MISSING', `terrain load observation has no matching load-started event: ${key}`, { sequence: observation.sequence, key }));
  }

  if (requireLifecycleObservations) {
    const allKeys = new Set([...schedulerLifecycle.keys(), ...adapterLifecycle.keys()]);
    for (const key of allKeys) {
      const schedulerCount = schedulerLifecycle.get(key)?.length ?? 0;
      const adapterCount = adapterLifecycle.get(key)?.length ?? 0;
      if (schedulerCount !== adapterCount) {
        issues.push(issue('TRACE_LIFECYCLE_CORRELATION_MISMATCH', `scheduler and adapter lifecycle counts differ for ${key}`, {
          key,
          schedulerCount,
          adapterCount,
        }));
      }
    }
  }

  const finalSnapshot = snapshots.at(-1)?.payload?.snapshot;
  const activeLoads = finalSnapshot?.metrics?.activeLoads;
  const queueDepth = finalSnapshot?.metrics?.queueDepth;
  if (!Number.isInteger(activeLoads) || activeLoads !== 0 || !Number.isInteger(queueDepth) || queueDepth !== 0) {
    issues.push(issue('TRACE_FINAL_SNAPSHOT_NOT_IDLE', 'final scheduler snapshot must be idle', {
      activeLoads: activeLoads ?? null,
      queueDepth: queueDepth ?? null,
    }));
  }

  const ok = issues.length === 0;
  return Object.freeze({
    ok,
    code: ok ? 'TRACE_ACCEPTED' : issues[0].code,
    issues: Object.freeze(issues),
    summary: Object.freeze({
      ...structural.summary,
      loadStarts: starts.size,
      loadObservations: observations.size,
      snapshots: snapshots.length,
      schedulerLifecycleEvents: [...schedulerLifecycle.values()].reduce((sum, items) => sum + items.length, 0),
      lifecycleObservations: [...adapterLifecycle.values()].reduce((sum, items) => sum + items.length, 0),
    }),
  });
}

export function validateRendererLifecycleMovementCapture(trace) {
  return validateCompletedStreamingMovementCapture(trace, { requireLifecycleObservations: true });
}
