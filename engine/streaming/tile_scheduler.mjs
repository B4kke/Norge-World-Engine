const DEFAULTS = Object.freeze({
  activeRadiusMeters: 1600,
  retainRadiusMeters: 2400,
  maxConcurrentLoads: 2,
  maxResidentTiles: 9,
  maxCacheBytes: 64 * 1024 * 1024,
});

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be >= 0`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
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
    activateTile = async () => {},
    deactivateTile = async () => {},
    disposeTile = async () => {},
    activeRadiusMeters = DEFAULTS.activeRadiusMeters,
    retainRadiusMeters = DEFAULTS.retainRadiusMeters,
    maxConcurrentLoads = DEFAULTS.maxConcurrentLoads,
    maxResidentTiles = DEFAULTS.maxResidentTiles,
    maxCacheBytes = DEFAULTS.maxCacheBytes,
    clock = () => performance.now(),
    onEvent = () => {},
  } = {}) {
    if (typeof loadTile !== 'function') throw new TypeError('loadTile is required');
    for (const [name, fn] of Object.entries({ activateTile, deactivateTile, disposeTile, clock, onEvent })) {
      if (typeof fn !== 'function') throw new TypeError(`${name} must be a function`);
    }
    nonNegative(activeRadiusMeters, 'activeRadiusMeters');
    nonNegative(retainRadiusMeters, 'retainRadiusMeters');
    if (retainRadiusMeters < activeRadiusMeters) throw new Error('retainRadiusMeters must be >= activeRadiusMeters');
    positiveInteger(maxConcurrentLoads, 'maxConcurrentLoads');
    positiveInteger(maxResidentTiles, 'maxResidentTiles');
    nonNegative(maxCacheBytes, 'maxCacheBytes');

    Object.assign(this, {
      loadTile,
      activateTile,
      deactivateTile,
      disposeTile,
      activeRadiusMeters,
      retainRadiusMeters,
      maxConcurrentLoads,
      maxResidentTiles,
      maxCacheBytes,
      clock,
      onEvent,
    });

    this.records = new Map();
    this.pendingPromises = new Set();
    this.camera = { e: 0, n: 0 };
    this.generation = 0;
    this.activeLoads = 0;
    this.bytesCached = 0;
    this.metrics = {
      updates: 0,
      loadsStarted: 0,
      loadsCompleted: 0,
      loadsFailed: 0,
      abortRequests: 0,
      staleCompletionsDropped: 0,
      cacheHits: 0,
      cacheMisses: 0,
      activations: 0,
      deactivations: 0,
      evictions: 0,
      peakActiveLoads: 0,
      peakBytesCached: 0,
      maxCacheBytes,
    };
  }

  #emit(type, detail = {}) {
    this.onEvent({ type, at: this.clock(), generation: this.generation, ...detail });
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
      } else if (record.state === 'idle' || record.state === 'failed') {
        record.state = 'queued';
        record.error = null;
        this.metrics.cacheMisses += 1;
      }
    }

    await this.#evictOutsideRetain();
    await this.#enforceBudget();
    this.#drainQueue();
    return this.snapshot();
  }

  #abort(record, reason) {
    if (record.state !== 'loading') return;
    const controller = record.controller;
    record.loadToken += 1;
    record.controller = null;
    record.state = 'idle';
    controller?.abort(reason);
    this.metrics.abortRequests += 1;
    this.#emit('load-abort-requested', { tileId: record.tile.id, reason });
  }

  async #activate(record, reason) {
    if (record.state === 'resident') return;
    if (record.payload == null) throw new Error(`cannot activate unloaded tile ${record.tile.id}`);
    await this.activateTile(record.tile, record.payload, { reason });
    record.state = 'resident';
    record.lastTouched = this.generation;
    this.metrics.activations += 1;
    this.#emit('tile-activated', { tileId: record.tile.id, reason });
  }

  async #deactivate(record, reason) {
    if (record.state !== 'resident') return;
    await this.deactivateTile(record.tile, record.payload, { reason });
    record.state = 'cached';
    record.lastTouched = this.generation;
    this.metrics.deactivations += 1;
    this.#emit('tile-deactivated', { tileId: record.tile.id, reason });
  }

  #drainQueue() {
    while (this.activeLoads < this.maxConcurrentLoads) {
      const next = [...this.records.values()]
        .filter((record) => record.desired && record.state === 'queued')
        .sort((a, b) => a.priority - b.priority || a.tile.id.localeCompare(b.tile.id))[0];
      if (!next) return;
      this.#startLoad(next);
    }
  }

  #startLoad(record) {
    record.state = 'loading';
    const controller = new AbortController();
    record.controller = controller;
    record.loadToken += 1;
    const token = record.loadToken;
    const startedAt = this.clock();
    this.activeLoads += 1;
    this.metrics.loadsStarted += 1;
    this.metrics.peakActiveLoads = Math.max(this.metrics.peakActiveLoads, this.activeLoads);
    this.#emit('load-started', { tileId: record.tile.id, priority: record.priority });

    const promise = Promise.resolve()
      .then(() => this.loadTile(record.tile, { signal: controller.signal }))
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
        this.bytesCached += byteSize;
        this.metrics.peakBytesCached = Math.max(this.metrics.peakBytesCached, this.bytesCached);
        this.metrics.loadsCompleted += 1;
        this.#emit('load-completed', {
          tileId: record.tile.id,
          byteSize,
          durationMs: this.clock() - startedAt,
        });

        record.state = 'cached';
        if (record.desired) await this.#activate(record, 'load-complete');
        else if (record.distance > this.retainRadiusMeters) await this.#evict(record, 'completed-outside-retain');
        await this.#enforceBudget();
      })
      .catch((error) => {
        if (record.loadToken !== token || record.state !== 'loading') return;
        record.controller = null;
        if (error?.name === 'AbortError') {
          record.state = 'idle';
          return;
        }
        record.state = 'failed';
        record.error = error;
        this.metrics.loadsFailed += 1;
        this.#emit('load-failed', { tileId: record.tile.id, message: String(error?.message ?? error) });
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

  async #enforceBudget() {
    if (this.bytesCached <= this.maxCacheBytes) return;
    const candidates = [...this.records.values()]
      .filter((record) => !record.desired && record.state === 'cached')
      .sort((a, b) => a.lastTouched - b.lastTouched || a.tile.id.localeCompare(b.tile.id));
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
    await this.disposeTile(record.tile, payload, { reason });
    record.payload = null;
    record.byteSize = 0;
    record.state = 'idle';
    record.lastTouched = this.generation;
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
        error: record.error ? String(record.error?.message ?? record.error) : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const counts = Object.fromEntries(['resident', 'cached', 'failed'].map((state) => [
      `${state}Count`,
      records.filter((record) => record.state === state).length,
    ]));
    return {
      generation: this.generation,
      camera: { ...this.camera },
      metrics: {
        ...this.metrics,
        ...counts,
        queueDepth: records.filter((record) => record.state === 'queued').length,
        activeLoads: this.activeLoads,
        bytesCached: this.bytesCached,
        budgetOvercommitBytes: Math.max(0, this.bytesCached - this.maxCacheBytes),
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
