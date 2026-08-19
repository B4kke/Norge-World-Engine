function nonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite value >= 0`);
  return value;
}

export class RetainedBudgetUnderestimateError extends Error {
  constructor({ tileId, reservedBytes, actualBytes }) {
    super(`retained budget estimate underestimated ${tileId}: reserved=${reservedBytes}, actual=${actualBytes}`);
    this.name = 'RetainedBudgetUnderestimateError';
    this.code = 'RETAINED_BUDGET_UNDERESTIMATE';
    this.tileId = tileId;
    this.reservedBytes = reservedBytes;
    this.actualBytes = actualBytes;
  }
}

export class RetainedByteBudgetGate {
  constructor({ maxBytes, clock = () => performance.now(), onEvent = () => {} } = {}) {
    nonNegativeFinite(maxBytes, 'maxBytes');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    this.maxBytes = maxBytes;
    this.clock = clock;
    this.onEvent = onEvent;
    this.committedBytes = 0;
    this.reservedBytes = 0;
    this.nextToken = 1;
    this.reservations = new Map();
    this.metrics = {
      reservationsGranted: 0,
      reservationsDeferred: 0,
      commits: 0,
      releases: 0,
      underestimateRejects: 0,
      peakReservedBytes: 0,
      peakAccountedBytes: 0,
    };
  }

  #emit(type, detail = {}) {
    this.onEvent({ type, at: this.clock(), ...detail });
  }

  #updatePeaks() {
    this.metrics.peakReservedBytes = Math.max(this.metrics.peakReservedBytes, this.reservedBytes);
    this.metrics.peakAccountedBytes = Math.max(
      this.metrics.peakAccountedBytes,
      this.committedBytes + this.reservedBytes,
    );
  }

  syncCommittedBytes(bytes) {
    nonNegativeFinite(bytes, 'bytes');
    if (bytes + this.reservedBytes > this.maxBytes) {
      throw new RangeError(`committed + reserved bytes exceed retained budget: ${bytes + this.reservedBytes} > ${this.maxBytes}`);
    }
    this.committedBytes = bytes;
    this.#updatePeaks();
    this.#emit('retained-budget-synced', { committedBytes: bytes, reservedBytes: this.reservedBytes });
    return this.snapshot();
  }

  tryReserve(tileId, estimatedBytes) {
    if (typeof tileId !== 'string' || tileId.length === 0) throw new TypeError('tileId must be a non-empty string');
    nonNegativeFinite(estimatedBytes, 'estimatedBytes');
    const accountedBytes = this.committedBytes + this.reservedBytes;
    if (accountedBytes + estimatedBytes > this.maxBytes) {
      this.metrics.reservationsDeferred += 1;
      this.#emit('retained-budget-reservation-deferred', {
        tileId,
        estimatedBytes,
        availableBytes: Math.max(0, this.maxBytes - accountedBytes),
      });
      return null;
    }
    const token = `retained:${this.nextToken++}`;
    this.reservations.set(token, { tileId, reservedBytes: estimatedBytes });
    this.reservedBytes += estimatedBytes;
    this.metrics.reservationsGranted += 1;
    this.#updatePeaks();
    this.#emit('retained-budget-reserved', { token, tileId, reservedBytes: estimatedBytes });
    return Object.freeze({ token, tileId, reservedBytes: estimatedBytes });
  }

  cancel(reservation, reason = 'cancelled') {
    const current = this.#takeReservation(reservation);
    this.#emit('retained-budget-reservation-cancelled', {
      token: reservation.token,
      tileId: current.tileId,
      reservedBytes: current.reservedBytes,
      reason,
    });
  }

  commit(reservation, actualBytes) {
    nonNegativeFinite(actualBytes, 'actualBytes');
    const current = this.#takeReservation(reservation);
    if (actualBytes > current.reservedBytes) {
      this.metrics.underestimateRejects += 1;
      this.#emit('retained-budget-underestimate-rejected', {
        token: reservation.token,
        tileId: current.tileId,
        reservedBytes: current.reservedBytes,
        actualBytes,
      });
      throw new RetainedBudgetUnderestimateError({
        tileId: current.tileId,
        reservedBytes: current.reservedBytes,
        actualBytes,
      });
    }
    if (this.committedBytes + actualBytes > this.maxBytes) {
      throw new Error('retained budget invariant violated after reservation commit');
    }
    this.committedBytes += actualBytes;
    this.metrics.commits += 1;
    this.#updatePeaks();
    this.#emit('retained-budget-committed', {
      token: reservation.token,
      tileId: current.tileId,
      reservedBytes: current.reservedBytes,
      actualBytes,
      refundedBytes: current.reservedBytes - actualBytes,
    });
    return this.snapshot();
  }

  releaseCommitted(bytes, { tileId = null, reason = 'released' } = {}) {
    nonNegativeFinite(bytes, 'bytes');
    if (bytes > this.committedBytes) throw new RangeError('cannot release more retained bytes than are committed');
    this.committedBytes -= bytes;
    this.metrics.releases += 1;
    this.#emit('retained-budget-released', { tileId, reason, bytes });
    return this.snapshot();
  }

  #takeReservation(reservation) {
    const token = reservation?.token;
    if (typeof token !== 'string') throw new TypeError('reservation token is required');
    const current = this.reservations.get(token);
    if (!current) throw new Error(`unknown or already-consumed retained reservation: ${token}`);
    if (reservation.tileId !== current.tileId || reservation.reservedBytes !== current.reservedBytes) {
      throw new Error(`retained reservation metadata mismatch: ${token}`);
    }
    this.reservations.delete(token);
    this.reservedBytes -= current.reservedBytes;
    return current;
  }

  snapshot() {
    const accountedBytes = this.committedBytes + this.reservedBytes;
    return {
      maxBytes: this.maxBytes,
      committedBytes: this.committedBytes,
      reservedBytes: this.reservedBytes,
      accountedBytes,
      availableBytes: this.maxBytes - accountedBytes,
      activeReservations: this.reservations.size,
      overcommitBytes: Math.max(0, accountedBytes - this.maxBytes),
      metrics: { ...this.metrics },
    };
  }
}
