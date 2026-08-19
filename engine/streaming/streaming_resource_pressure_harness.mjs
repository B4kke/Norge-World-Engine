function countStates(records) {
  const counts = {};
  for (const record of records) counts[record.state] = (counts[record.state] ?? 0) + 1;
  return counts;
}

export async function runStreamingResourcePressureHarness({ scheduler, tiles, path, resourceSnapshot = null }) {
  if (!scheduler || typeof scheduler.update !== 'function' || typeof scheduler.whenIdle !== 'function') {
    throw new TypeError('scheduler must expose update() and whenIdle()');
  }
  if (!Array.isArray(tiles) || tiles.length === 0) throw new TypeError('tiles must be a non-empty array');
  if (!Array.isArray(path) || path.length === 0) throw new TypeError('path must be a non-empty array');
  if (resourceSnapshot !== null && typeof resourceSnapshot !== 'function') {
    throw new TypeError('resourceSnapshot must be a function when provided');
  }

  const queuedStreaks = new Map();
  const longestQueuedStreaks = new Map();
  const samples = [];

  for (let index = 0; index < path.length; index += 1) {
    const waypoint = path[index];
    await scheduler.update({ e: waypoint.e, n: waypoint.n }, tiles);
    const snapshot = await scheduler.whenIdle();
    const byId = new Map(snapshot.records.map((record) => [record.id, record]));

    for (const tile of tiles) {
      const queued = byId.get(tile.id)?.state === 'queued';
      const next = queued ? (queuedStreaks.get(tile.id) ?? 0) + 1 : 0;
      queuedStreaks.set(tile.id, next);
      longestQueuedStreaks.set(tile.id, Math.max(longestQueuedStreaks.get(tile.id) ?? 0, next));
    }

    samples.push({
      index,
      label: waypoint.label ?? `step-${index}`,
      camera: { e: waypoint.e, n: waypoint.n },
      stateCounts: countStates(snapshot.records),
      scheduler: {
        activeLoads: snapshot.metrics.activeLoads,
        queueDepth: snapshot.metrics.queueDepth,
        bytesResident: snapshot.metrics.bytesResident,
        bytesCached: snapshot.metrics.bytesCached,
        retainedBytes: snapshot.metrics.retainedBytes,
        cacheHits: snapshot.metrics.cacheHits,
        evictions: snapshot.metrics.evictions,
        loadAdmissionDeferrals: snapshot.metrics.loadAdmissionDeferrals,
      },
      resource: resourceSnapshot ? resourceSnapshot() : null,
    });
  }

  const final = scheduler.snapshot();
  return {
    schema: 'nwe.streaming-resource-pressure-harness/0.1',
    sampleCount: samples.length,
    tileCount: tiles.length,
    samples,
    longestQueuedStreaks: Object.fromEntries([...longestQueuedStreaks.entries()].sort(([a], [b]) => a.localeCompare(b))),
    summary: {
      peakActiveLoads: final.metrics.peakActiveLoads,
      loadsStarted: final.metrics.loadsStarted,
      cacheHits: final.metrics.cacheHits,
      cacheMisses: final.metrics.cacheMisses,
      evictions: final.metrics.evictions,
      loadAdmissionDeferrals: final.metrics.loadAdmissionDeferrals,
      residentBudgetDeferrals: final.metrics.residentBudgetDeferrals,
      residentBudgetPreemptions: final.metrics.residentBudgetPreemptions,
      residentBudgetOvercommitBytes: final.metrics.residentBudgetOvercommitBytes,
      cacheBudgetOvercommitBytes: final.metrics.cacheBudgetOvercommitBytes,
      finalActiveLoads: final.metrics.activeLoads,
      finalQueueDepth: final.metrics.queueDepth,
    },
  };
}
