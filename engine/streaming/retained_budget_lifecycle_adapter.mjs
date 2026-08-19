import {
  RetainedByteBudgetGate,
  RetainedBudgetUnderestimateError,
} from './retained_byte_budget.mjs';

function nonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite value >= 0`);
  return value;
}

export class RetainedBudgetEstimateTooLargeError extends Error {
  constructor({ tileId, estimatedBytes, maxBytes }) {
    super(`retained budget estimate exceeds cap for ${tileId}: estimated=${estimatedBytes}, max=${maxBytes}`);
    this.name = 'RetainedBudgetEstimateTooLargeError';
    this.code = 'RETAINED_BUDGET_ESTIMATE_TOO_LARGE';
    this.tileId = tileId;
    this.estimatedBytes = estimatedBytes;
    this.maxBytes = maxBytes;
  }
}

export function createRetainedBudgetLifecycleAdapter({
  loadTile,
  disposeTile = async () => {},
  estimateTileBytes,
  maxRetainedBytes,
  clock = () => performance.now(),
  onEvent = () => {},
} = {}) {
  if (typeof loadTile !== 'function') throw new TypeError('loadTile is required');
  if (typeof disposeTile !== 'function') throw new TypeError('disposeTile must be a function');
  if (typeof estimateTileBytes !== 'function') throw new TypeError('estimateTileBytes is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
  nonNegativeFinite(maxRetainedBytes, 'maxRetainedBytes');

  const gate = new RetainedByteBudgetGate({ maxBytes: maxRetainedBytes, clock, onEvent });
  const committedByTile = new Map();
  const waiters = [];
  let nextWaiterId = 1;
  const metrics = {
    waitsQueued: 0,
    waitsGranted: 0,
    waitsCancelled: 0,
    oversizeRejects: 0,
    cleanupFailures: 0,
  };

  function emit(type, detail = {}) {
    onEvent({ type, at: clock(), ...detail });
  }

  function removeWaiter(waiter) {
    const index = waiters.indexOf(waiter);
    if (index >= 0) waiters.splice(index, 1);
  }

  function drainWaiters() {
    while (waiters.length > 0) {
      const waiter = waiters[0];
      if (waiter.signal?.aborted) {
        waiters.shift();
        waiter.cleanupAbort?.();
        metrics.waitsCancelled += 1;
        waiter.reject(waiter.signal.reason instanceof Error
          ? waiter.signal.reason
          : new DOMException(String(waiter.signal.reason ?? 'aborted'), 'AbortError'));
        continue;
      }
      const reservation = gate.tryReserve(waiter.tileId, waiter.estimatedBytes);
      if (!reservation) return;
      waiters.shift();
      waiter.cleanupAbort?.();
      metrics.waitsGranted += 1;
      emit('retained-budget-wait-granted', {
        waiterId: waiter.waiterId,
        tileId: waiter.tileId,
        estimatedBytes: waiter.estimatedBytes,
      });
      waiter.resolve(reservation);
    }
  }

  function abortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    return new DOMException(String(signal?.reason ?? 'aborted'), 'AbortError');
  }

  function reserveWhenAvailable(tileId, estimatedBytes, signal) {
    if (estimatedBytes > maxRetainedBytes) {
      metrics.oversizeRejects += 1;
      throw new RetainedBudgetEstimateTooLargeError({ tileId, estimatedBytes, maxBytes: maxRetainedBytes });
    }
    if (signal?.aborted) throw abortError(signal);
    const immediate = gate.tryReserve(tileId, estimatedBytes);
    if (immediate) return Promise.resolve(immediate);

    metrics.waitsQueued += 1;
    return new Promise((resolve, reject) => {
      const waiter = {
        waiterId: nextWaiterId++, tileId, estimatedBytes, signal, resolve, reject, cleanupAbort: null,
      };
      if (signal) {
        const onAbort = () => {
          if (!waiters.includes(waiter)) return;
          removeWaiter(waiter);
          metrics.waitsCancelled += 1;
          emit('retained-budget-wait-cancelled', {
            waiterId: waiter.waiterId,
            tileId,
            estimatedBytes,
          });
          reject(abortError(signal));
          drainWaiters();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      }
      waiters.push(waiter);
      emit('retained-budget-wait-queued', {
        waiterId: waiter.waiterId,
        tileId,
        estimatedBytes,
        queueDepth: waiters.length,
      });
    });
  }

  async function cleanupRejectedPayload(tile, result, reason) {
    try {
      await disposeTile(tile, result?.payload, { reason, admitted: false });
    } catch (error) {
      metrics.cleanupFailures += 1;
      emit('retained-budget-rejected-payload-cleanup-failed', {
        tileId: tile.id,
        reason,
        message: String(error?.message ?? error),
      });
    }
  }

  return Object.freeze({
    async loadTile(tile, context = {}) {
      const tileId = tile?.id;
      if (typeof tileId !== 'string' || tileId.length === 0) throw new TypeError('tile.id must be a non-empty string');
      const estimatedBytes = nonNegativeFinite(await estimateTileBytes(tile, context), `${tileId}.estimatedBytes`);
      const reservation = await reserveWhenAvailable(tileId, estimatedBytes, context.signal);
      let reservationOpen = true;
      try {
        const result = await loadTile(tile, context);
        if (!result || typeof result !== 'object') throw new TypeError(`loadTile(${tileId}) must return an object`);
        const actualBytes = nonNegativeFinite(result.byteSize, `${tileId}.byteSize`);
        try {
          gate.commit(reservation, actualBytes);
          reservationOpen = false;
        } catch (error) {
          reservationOpen = false;
          if (error instanceof RetainedBudgetUnderestimateError) {
            await cleanupRejectedPayload(tile, result, 'retained-budget-underestimate');
          }
          throw error;
        }
        if (committedByTile.has(tileId)) {
          gate.releaseCommitted(actualBytes, { tileId, reason: 'duplicate-commit-rollback' });
          await cleanupRejectedPayload(tile, result, 'duplicate-retained-commit');
          throw new Error(`tile already has committed retained bytes: ${tileId}`);
        }
        committedByTile.set(tileId, actualBytes);
        return result;
      } catch (error) {
        if (reservationOpen) gate.cancel(reservation, error?.name === 'AbortError' ? 'load-aborted' : 'load-failed');
        throw error;
      } finally {
        drainWaiters();
      }
    },

    async disposeTile(tile, payload, context = {}) {
      const tileId = tile?.id;
      await disposeTile(tile, payload, context);
      const bytes = committedByTile.get(tileId);
      if (bytes != null) {
        committedByTile.delete(tileId);
        gate.releaseCommitted(bytes, { tileId, reason: context.reason ?? 'disposed' });
        drainWaiters();
      }
    },

    snapshot() {
      return {
        schema: 'nwe.retained-budget-lifecycle-adapter/0.1',
        budget: gate.snapshot(),
        waitingLoads: waiters.length,
        committedTiles: committedByTile.size,
        committedTileBytes: Object.fromEntries([...committedByTile.entries()].sort(([a], [b]) => a.localeCompare(b))),
        metrics: { ...metrics },
      };
    },
  });
}
