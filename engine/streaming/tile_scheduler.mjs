const DEFAULTS = Object.freeze({
  activeRadiusMeters: 1600,
  retainRadiusMeters: 2400,
  maxConcurrentLoads: 2,
  maxResidentTiles: 9,
  maxCacheBytes: 64 * 1024 * 1024,
  maxResidentBytes: null,
  retryDelayMs: 0,
  maxLoadAttemptsPerInterest: null,
});

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be >= 0`);
  return value;
}

function optionalNonNegative(value, label) {
  if (value == null) return null;
  return nonNegative(value, label);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function optionalPositiveInteger(value, label) {
  if (value == null) return null;
  return positiveInteger(value, label);
}

function validateTile(tile) {
  if (!tile || typeof tile !== 'object') throw new TypeError('tile must be an object');
  if (typeof tile.id !== 'string' || tile.id.length === 0) throw new TypeError('tile.id must be a non-empty string');
  finite(tile.centerE, `${tile.id}.centerE`);
  finite(tile.centerN, `${tile.id}.centerN`);
  return tile;
}

function distanceMeters(camera, tile) {
  return Math.hypot(tile.centerE - camera.e, tile.centerN - camera.n);
}

export function rankTileCandidates(camera, tiles, {
  activeRadiusMeters = DEFAULTS.activeRadiusMeters,
  maxResidentTiles = DEFAULTS.maxResidentTiles,
} = {}) {
  finite(camera?.e, 'camera.e');
  finite(camera?.n, 'camera.n');
  nonNegative(activeRadiusMeters, 'activeRadiusMeters');
  positiveInteger(maxResidentTiles, 'maxResidentTiles');

  const seen = new Set();
  const ranked = [];
  for (const tile of tiles) {
    validateTile(tile);
    if (seen.has(tile.id)) throw new Error(`duplicate tile id: ${tile.id}`);
    seen.add(tile.id);
    const distance = distanceMeters(camera, tile);
    if (distance <= activeRadiusMeters) ranked.push({ tile, distance });
  }
  ranked.sort((a, b) => a.distance - b.distance || a.tile.id.localeCompare(b.tile.id));
  return ranked.slice(0, maxResidentTiles);
}

export class TileStreamingScheduler {
  constructor({
    loadTile,
    admitLoad = null,
    activateTile = async () => {},
    deactivateTile = async () => {},
    disposeTile = async () => {},
    activeRadiusMeters = DEFAULTS.activeRadiusMeters,
    retainRadiusMeters = DEFAULTS.retainRadiusMeters,
    maxConcurrentLoads = DEFAULTS.maxConcurrentLoads,
    maxResidentTiles = DEFAULTS.maxResidentTiles,
    maxCacheBytes = DEFAULTS.maxCacheBytes,
    maxResidentBytes = DEFAULTS.maxResidentBytes,
    retryDelayMs = DEFAULTS.retryDelayMs,
    maxLoadAttemptsPerInterest = DEFAULTS.maxLoadAttemptsPerInterest,
    clock = () => performance.now(),
    onEvent = () => {},
  } = {}) {
    if (typeof loadTile !== 'function') throw new TypeError('loadTile is required');
    if (admitLoad != null && typeof admitLoad !== 'function') throw new TypeError('admitLoad must be a function when provided');
    for (const [name, fn] of Object.entries({ activateTile, deactivateTile, disposeTile, clock, onEvent })) {
      if (typeof fn !== 'function') throw new TypeError(`${name} must be a function`);
    }
    nonNegative(activeRadiusMeters, 'activeRadiusMeters');
    nonNegative(retainRadiusMeters, 'retainRadiusMeters');
    if (retainRadiusMeters < activeRadiusMeters) throw new Error('retainRadiusMeters must be >= activeRadiusMeters');
    positiveInteger(maxConcurrentLoads, 'maxConcurrentLoads');
    positiveInteger(maxResidentTiles, 'maxResidentTiles');
    nonNegative(maxCacheBytes, 'maxCacheBytes');
    optionalNonNegative(maxResidentBytes, 'maxResidentBytes');
    nonNegative(retryDelayMs, 'retryDelayMs');
    optionalPositiveInteger(maxLoadAttemptsPerInterest, 'maxLoadAttemptsPerInterest');

    Object.assign(this, {
      loadTile,
      admitLoad,
      activateTile,
      deactivateTile,
      disposeTile,
      activeRadiusMeters,
      retainRadiusMeters,
      maxConcurrentLoads,
      maxResidentTiles,
      maxCacheBytes,
      maxResidentBytes,
      retryDelayMs,
      maxLoadAttemptsPerInterest,
      clock,
      onEvent,
    });

    this.records = new Map();
    this.pendingPromises = new Set();
    this.camera = { e: 0, n: 0 };
    this.generation = 0;
    this.activeLoads = 0;
    this.bytesResident = 0;
    this.bytesActivating = 0;
    this.bytesCached = 0;
    this.metrics = {
      updates: 0,
      loadsStarted: 0,
      loadsCompleted: 0,
      loadsFailed: 0,
      loadAdmissionDeferrals: 0,
      loadAdmissionFailures: 0,
      retriesQueued: 0,
      retryDeferrals: 0,
      retryExhaustions: 0,
      abortRequests: 0,
      staleCompletionsDropped: 0,
      cacheHits: 0,
      cacheMisses: 0,
      activations: 0,
      activationFailures: 0,
      residentBudgetDeferrals: 0,
      residentBudgetPreemptions: 0,
      residentBudgetPreemptionFailures: 0,
      deactivations: 0,
      deactivationFailures: 0,
      evictions: 0,
      disposalFailures: 0,
      lifecycleFailures: 0,
      peakActiveLoads: 0,
      peakBytesResident: 0,
      peakBytesActivating: 0,
      peakBytesCached: 0,
      peakRetainedBytes: 0,
      maxCacheBytes,
      maxResidentBytes,
      retryDelayMs,
      maxLoadAttemptsPerInterest,
    };
  }

  #emit(type, detail = {}) {
    this.onEvent({ type, at: this.clock(), generation: this.generation, ...detail });
  }

  #updateBytePeaks() {
    const retainedBytes = this.bytesResident + this.bytesActivating + this.bytesCached;
    this.metrics.peakBytesResident = Math.max(this.metrics.peakBytesResident, this.bytesResident);
    this.metrics.peakBytesActivating = Math.max(this.metrics.peakBytesActivating, this.bytesActivating);
    this.metrics.peakBytesCached = Math.max(this.metrics.peakBytesCached, this.bytesCached);
    this.metrics.peakRetainedBytes = Math.max(this.metrics.peakRetainedBytes, retainedBytes);
  }

  #resetRetryCycle(record) {
    record.loadAttempts = 0;
    record.retryNotBefore = 0;
    record.retryExhaustedReported = false;
  }

  #recordFor(tile) {
    let record = this.records.get(tile.id);
    if (!record) {
      record = {
        tile,
        state: 'idle',
        desired: false,
        distance: Infinity,
        priority: Infinity,
        payload: null,
        byteSize: 0,
        lastTouched: 0,
        loadToken: 0,
        loadAttempts: 0,
        retryNotBefore: 0,
        retryExhaustedReported: false,
        controller: null,
        error: null,
      };
      this.records.set(tile.id, record);
    } else {
      record.tile = tile;
    }
    return record;
  }

  async update(camera, tiles) {
    finite(camera?.e, 'camera.e');
    finite(camera?.n, 'camera.n');
    const tileList = Array.isArray(tiles) ? tiles : [...tiles];
    const ranked = rankTileCandidates(camera, tileList, {
      activeRadiusMeters: this.activeRadiusMeters,
      maxResidentTiles: this.maxResidentTiles,
    });
    const desiredIds = new Set(ranked.map(({ tile }) => tile.id));
    const knownIds = new Set();

    this.camera = { e: camera.e, n: camera.n };
    this.generation += 1;
    this.metrics.updates += 1;

    for (const tile of tileList) {
      const record = this.#recordFor(tile);
      knownIds.add(tile.id);
      record.distance = distanceMeters(camera, tile);
      record.priority = record.distance;
      record.desired = desiredIds.has(tile.id);
      if (record.desired) record.lastTouched = this.generation;
    }
    for (const record of this.records.values()) {
      if (!knownIds.has(record.tile.id)) {
        record.desired = false;
        record.distance = Infinity;
        record.priority = Infinity;
      }
    }

    for (const record of this.records.values()) {
      if (!record.desired && record.state === 'resident') await this.#deactivate(record, 'interest-lost');
      if (!record.desired && record.state === 'queued') record.state = 'idle';
      if (!record.desired && record.state === 'failed') {
        record.state = 'idle';
        record.error = null;
        this.#resetRetryCycle(record);
      }
      if (!record.desired && record.state === 'loading' && record.distance > this.retainRadiusMeters) {
        this.#abort(record, 'outside-retain-radius');
      }
    }

    for (const { tile, distance } of ranked) {
      const record = this.records.get(tile.id);
      record.distance = distance;
      record.priority = distance;
      if (record.state === 'cached') {
        this.metrics.cacheHits += 1;
        await this.#activate(record, 'cache-hit');
      } else if (record.state === 'idle') {
        record.state = 'queued';
        record.error = null;
        this.metrics.cacheMisses += 1;
      } else if (record.state === 'failed') {
        const now = this.clock();
        const attemptsExhausted = this.maxLoadAttemptsPerInterest != null
          && record.loadAttempts >= this.maxLoadAttemptsPerInterest;
        if (attemptsExhausted) {
          if (!record.retryExhaustedReported) {
            record.retryExhaustedReported = true;
            this.metrics.retryExhaustions += 1;
            this.#emit('load-retry-exhausted', {
              tileId: record.tile.id,
              loadAttempts: record.loadAttempts,
              maxLoadAttemptsPerInterest: this.maxLoadAttemptsPerInterest,
            });
          }
        } else if (now < record.retryNotBefore) {
          this.metrics.retryDeferrals += 1;
          this.#emit('load-retry-deferred', {
            tileId: record.tile.id,
            loadAttempts: record.loadAttempts,
            retryNotBefore: record.retryNotBefore,
            remainingMs: record.retryNotBefore - now,
          });
        } else {
          record.state = 'queued';
          record.error = null;
          record.retryExhaustedReported = false;
          this.metrics.cacheMisses += 1;
          this.metrics.retriesQueued += 1;
          this.#emit('load-retry-queued', {
            tileId: record.tile.id,
            nextAttempt: record.loadAttempts + 1,
          });
        }
      }
    }

    await this.#evictOutsideRetain();
    await this.#enforceCacheBudget();
    this.#drainQueue();
    return this.snapshot();
  }

  #abort(record, reason) {
    if (record.state !== 'loading') return;
    const controller = record.controller;
    record.loadToken += 1;
    record.controller = null;
    record.state = 'idle';
    this.#resetRetryCycle(record);
    controller?.abort(reason);
    this.metrics.abortRequests += 1;
    this.#emit('load-abort-requested', { tileId: record.tile.id, reason });
  }

  #higherPriority(candidate, incumbent) {
    return candidate.priority < incumbent.priority
      || (candidate.priority === incumbent.priority && candidate.tile.id.localeCompare(incumbent.tile.id) < 0);
  }

  async #makeResidentBudgetRoom(record) {
    if (this.maxResidentBytes == null) return true;
    if (record.byteSize > this.maxResidentBytes) return false;

    let projectedResidentBytes = this.bytesResident + this.bytesActivating + record.byteSize;
    if (projectedResidentBytes <= this.maxResidentBytes) return true;

    const lowerPriorityResidents = [...this.records.values()]
      .filter((candidate) => candidate.state === 'resident' && this.#higherPriority(record, candidate))
      .sort((a, b) => b.priority - a.priority || b.tile.id.localeCompare(a.tile.id));

    for (const incumbent of lowerPriorityResidents) {
      try {
        await this.#deactivate(incumbent, 'resident-budget-preempted');
      } catch (error) {
        this.metrics.residentBudgetPreemptionFailures += 1;
        this.#emit('resident-budget-preemption-failed', {
          tileId: record.tile.id,
          incumbentTileId: incumbent.tile.id,
          message: String(error?.message ?? error),
        });
        continue;
      }
      this.metrics.residentBudgetPreemptions += 1;
      projectedResidentBytes = this.bytesResident + this.bytesActivating + record.byteSize;
      if (projectedResidentBytes <= this.maxResidentBytes) return true;
    }
    return false;
  }

  async #activate(record, reason) {
    if (record.state === 'resident' || record.state === 'activating') return record.state === 'resident';
    if (record.state !== 'cached' || record.payload == null) {
      throw new Error(`cannot activate unloaded tile ${record.tile.id}`);
    }
    const residentBudgetAvailable = await this.#makeResidentBudgetRoom(record);
    const projectedResidentBytes = this.bytesResident + this.bytesActivating + record.byteSize;
    if (!residentBudgetAvailable) {
      this.metrics.residentBudgetDeferrals += 1;
      this.#emit('activation-deferred-budget', {
        tileId: record.tile.id,
        byteSize: record.byteSize,
        projectedResidentBytes,
        maxResidentBytes: this.maxResidentBytes,
      });
      return false;
    }

    record.state = 'activating';
    this.bytesCached = Math.max(0, this.bytesCached - record.byteSize);
    this.bytesActivating += record.byteSize;
    this.#updateBytePeaks();

    try {
      await this.activateTile(record.tile, record.payload, { reason });
    } catch (error) {
      this.bytesActivating = Math.max(0, this.bytesActivating - record.byteSize);
      this.bytesCached += record.byteSize;
      record.state = 'cached';
      record.error = error;
      this.metrics.activationFailures += 1;
      this.#updateBytePeaks();
      this.#emit('activation-failed', {
        tileId: record.tile.id,
        reason,
        message: String(error?.message ?? error),
      });
      if (!record.desired && record.distance > this.retainRadiusMeters) {
        await this.#evict(record, 'activation-failed-outside-retain');
      }
      return false;
    }

    this.bytesActivating = Math.max(0, this.bytesActivating - record.byteSize);
    this.bytesResident += record.byteSize;
    record.state = 'resident';
    record.error = null;
    record.lastTouched = this.generation;
    this.#resetRetryCycle(record);
    this.metrics.activations += 1;
    this.#updateBytePeaks();
    this.#emit('tile-activated', { tileId: record.tile.id, reason, byteSize: record.byteSize });

    if (!record.desired) {
      await this.#deactivate(record, 'interest-lost-during-activation');
      if (record.distance > this.retainRadiusMeters) await this.#evict(record, 'activated-outside-retain');
    }
    return record.state === 'resident';
  }

  async #deactivate(record, reason) {
    if (record.state !== 'resident') return;
    record.state = 'deactivating';
    try {
      await this.deactivateTile(record.tile, record.payload, { reason });
    } catch (error) {
      record.state = 'resident';
      record.error = error;
      this.metrics.deactivationFailures += 1;
      this.#emit('deactivation-failed', {
        tileId: record.tile.id,
        reason,
        message: String(error?.message ?? error),
      });
      throw error;
    }
    this.bytesResident = Math.max(0, this.bytesResident - record.byteSize);
    this.bytesCached += record.byteSize;
    record.state = 'cached';
    record.lastTouched = this.generation;
    this.metrics.deactivations += 1;
    this.#updateBytePeaks();
    this.#emit('tile-deactivated', { tileId: record.tile.id, reason, byteSize: record.byteSize });
  }

  #drainQueue() {
    while (this.activeLoads < this.maxConcurrentLoads) {
      const candidates = [...this.records.values()]
        .filter((record) => record.desired && record.state === 'queued')
        .sort((a, b) => a.priority - b.priority || a.tile.id.localeCompare(b.tile.id));
      if (candidates.length === 0) return;

      let started = false;
      for (const next of candidates) {
        let admission = null;
        if (this.admitLoad) {
          try {
            admission = this.admitLoad(next.tile, {
              priority: next.priority,
              attempt: next.loadAttempts + 1,
            });
            if (admission && typeof admission.then === 'function') {
              throw new TypeError('admitLoad must be synchronous and non-blocking');
            }
            if (admission === undefined) {
              throw new TypeError('admitLoad must return null/false to defer or a non-null admission token to grant');
            }
          } catch (error) {
            next.state = 'failed';
            next.error = error;
            next.loadAttempts += 1;
            next.retryNotBefore = this.clock() + this.retryDelayMs;
            next.retryExhaustedReported = false;
            this.metrics.loadAdmissionFailures += 1;
            this.#emit('load-admission-failed', {
              tileId: next.tile.id,
              attempt: next.loadAttempts,
              retryNotBefore: next.retryNotBefore,
              message: String(error?.message ?? error),
            });
            continue;
          }
          if (admission === null || admission === false) {
            this.metrics.loadAdmissionDeferrals += 1;
            this.#emit('load-admission-deferred', {
              tileId: next.tile.id,
              priority: next.priority,
              attempt: next.loadAttempts + 1,
            });
            continue;
          }
          if (admission === true) admission = null;
        }

        this.#startLoad(next, admission);
        started = true;
        break;
      }
      if (!started) return;
    }
  }

  #startLoad(record, admission = null) {
    record.state = 'loading';
    const controller = new AbortController();
    record.controller = controller;
    record.loadToken += 1;
    record.loadAttempts += 1;
    const token = record.loadToken;
    const attempt = record.loadAttempts;
    const startedAt = this.clock();
    this.activeLoads += 1;
    this.metrics.loadsStarted += 1;
    this.metrics.peakActiveLoads = Math.max(this.metrics.peakActiveLoads, this.activeLoads);
    this.#emit('load-started', { tileId: record.tile.id, priority: record.priority, attempt });

    const promise = Promise.resolve()
      .then(() => this.loadTile(record.tile, { signal: controller.signal, attempt, admission }))
      .then(async (result) => {
        if (record.loadToken !== token || record.state !== 'loading') {
          this.metrics.staleCompletionsDropped += 1;
          this.#emit('stale-load-dropped', { tileId: record.tile.id });
          return;
        }
        if (!result || typeof result !== 'object') throw new TypeError(`loadTile(${record.tile.id}) must return an object`);
        const byteSize = nonNegative(result.byteSize, `${record.tile.id}.byteSize`);
        record.payload = result.payload;
        record.byteSize = byteSize;
        record.controller = null;
        record.error = null;
        record.lastTouched = this.generation;
        record.state = 'cached';
        record.retryNotBefore = 0;
        record.retryExhaustedReported = false;
        this.bytesCached += byteSize;
        this.metrics.loadsCompleted += 1;
        this.#updateBytePeaks();
        this.#emit('load-completed', {
          tileId: record.tile.id,
          byteSize,
          attempt,
          durationMs: this.clock() - startedAt,
        });

        if (record.desired) await this.#activate(record, 'load-complete');
        else if (record.distance > this.retainRadiusMeters) await this.#evict(record, 'completed-outside-retain');
        await this.#enforceCacheBudget();
      })
      .catch((error) => {
        if (record.loadToken !== token) return;
        if (record.state !== 'loading') {
          record.error = error;
          this.metrics.lifecycleFailures += 1;
          this.#emit('lifecycle-failed', {
            tileId: record.tile.id,
            state: record.state,
            message: String(error?.message ?? error),
          });
          return;
        }
        record.controller = null;
        if (error?.name === 'AbortError') {
          record.state = 'idle';
          this.#resetRetryCycle(record);
          return;
        }
        record.state = 'failed';
        record.error = error;
        record.retryNotBefore = this.clock() + this.retryDelayMs;
        record.retryExhaustedReported = false;
        this.metrics.loadsFailed += 1;
        this.#emit('load-failed', {
          tileId: record.tile.id,
          attempt,
          retryNotBefore: record.retryNotBefore,
          message: String(error?.message ?? error),
        });
      })
      .finally(() => {
        this.activeLoads -= 1;
        this.pendingPromises.delete(promise);
        this.#drainQueue();
      });

    this.pendingPromises.add(promise);
  }

  async #evictOutsideRetain() {
    const candidates = [...this.records.values()]
      .filter((record) => !record.desired && record.state === 'cached' && record.distance > this.retainRadiusMeters)
      .sort((a, b) => a.lastTouched - b.lastTouched || a.tile.id.localeCompare(b.tile.id));
    for (const record of candidates) await this.#evict(record, 'outside-retain-radius');
  }

  async #enforceCacheBudget() {
    if (this.bytesCached <= this.maxCacheBytes) return;
    const candidates = [...this.records.values()]
      .filter((record) => record.state === 'cached')
      .sort((a, b) => Number(a.desired) - Number(b.desired)
        || a.lastTouched - b.lastTouched
        || a.tile.id.localeCompare(b.tile.id));
    for (const record of candidates) {
      if (this.bytesCached <= this.maxCacheBytes) break;
      await this.#evict(record, 'cache-budget');
    }
  }

  async #evict(record, reason) {
    if (record.state === 'resident') await this.#deactivate(record, reason);
    if (record.state !== 'cached') return;
    const payload = record.payload;
    const byteSize = record.byteSize;
    try {
      await this.disposeTile(record.tile, payload, { reason });
    } catch (error) {
      record.error = error;
      this.metrics.disposalFailures += 1;
      this.#emit('disposal-failed', {
        tileId: record.tile.id,
        reason,
        message: String(error?.message ?? error),
      });
      throw error;
    }
    record.payload = null;
    record.byteSize = 0;
    record.state = 'idle';
    record.lastTouched = this.generation;
    this.#resetRetryCycle(record);
    this.bytesCached = Math.max(0, this.bytesCached - byteSize);
    this.metrics.evictions += 1;
    this.#emit('tile-evicted', { tileId: record.tile.id, byteSize, reason });
  }

  async whenIdle() {
    for (;;) {
      this.#drainQueue();
      const queued = [...this.records.values()].some((record) => record.state === 'queued');
      if (this.activeLoads === 0 && !queued) return this.snapshot();
      if (this.pendingPromises.size === 0) return this.snapshot();
      await Promise.allSettled([...this.pendingPromises]);
    }
  }

  snapshot() {
    const records = [...this.records.values()]
      .map((record) => ({
        id: record.tile.id,
        state: record.state,
        desired: record.desired,
        distance: record.distance,
        byteSize: record.byteSize,
        lastTouched: record.lastTouched,
        loadAttempts: record.loadAttempts,
        retryNotBefore: record.retryNotBefore,
        error: record.error ? String(record.error?.message ?? record.error) : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const counts = Object.fromEntries(['resident', 'deactivating', 'activating', 'cached', 'failed'].map((state) => [
      `${state}Count`,
      records.filter((record) => record.state === state).length,
    ]));
    const retainedBytes = this.bytesResident + this.bytesActivating + this.bytesCached;
    const cacheBudgetOvercommitBytes = Math.max(0, this.bytesCached - this.maxCacheBytes);
    const residentBudgetOvercommitBytes = this.maxResidentBytes == null
      ? 0
      : Math.max(0, this.bytesResident + this.bytesActivating - this.maxResidentBytes);
    return {
      generation: this.generation,
      camera: { ...this.camera },
      metrics: {
        ...this.metrics,
        ...counts,
        queueDepth: records.filter((record) => record.state === 'queued').length,
        activeLoads: this.activeLoads,
        bytesResident: this.bytesResident,
        bytesActivating: this.bytesActivating,
        bytesCached: this.bytesCached,
        retainedBytes,
        cacheBudgetOvercommitBytes,
        residentBudgetOvercommitBytes,
        // Backward-compatible alias. maxCacheBytes is specifically the inactive-cache budget.
        budgetOvercommitBytes: cacheBudgetOvercommitBytes,
      },
      records,
    };
  }
}

export function createSquareTileGrid({
  originE,
  originN,
  tileSizeMeters = 1000,
  radius = 1,
  idPrefix = 'tile',
} = {}) {
  finite(originE, 'originE');
  finite(originN, 'originN');
  if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) throw new TypeError('tileSizeMeters must be > 0');
  if (!Number.isInteger(radius) || radius < 0) throw new TypeError('radius must be a non-negative integer');

  const tiles = [];
  for (let north = radius; north >= -radius; north -= 1) {
    for (let east = -radius; east <= radius; east += 1) {
      tiles.push({
        id: `${idPrefix}:${east}:${north}`,
        centerE: originE + east * tileSizeMeters,
        centerN: originN + north * tileSizeMeters,
        offsetE: east,
        offsetN: north,
      });
    }
  }
  return tiles;
}