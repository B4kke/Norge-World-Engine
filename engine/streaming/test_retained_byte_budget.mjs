import assert from 'node:assert/strict';
import { RetainedBudgetUnderestimateError, RetainedByteBudgetGate } from './retained_byte_budget.mjs';

function gate(maxBytes = 100) {
  let now = 0;
  const events = [];
  return {
    events,
    gate: new RetainedByteBudgetGate({ maxBytes, clock: () => ++now, onEvent: (event) => events.push(event) }),
  };
}

{
  const { gate: budget } = gate();
  budget.syncCommittedBytes(40);
  const a = budget.tryReserve('a', 30);
  const b = budget.tryReserve('b', 30);
  const c = budget.tryReserve('c', 1);
  assert.ok(a && b);
  assert.equal(c, null);
  assert.equal(budget.snapshot().accountedBytes, 100);
  assert.equal(budget.snapshot().overcommitBytes, 0);
}

{
  const { gate: budget } = gate();
  const a = budget.tryReserve('a', 60);
  const b = budget.tryReserve('b', 50);
  assert.ok(a);
  assert.equal(b, null, 'concurrent reservations must not overbook the hard accounting ceiling');
  budget.cancel(a, 'stale-load');
  assert.equal(budget.snapshot().reservedBytes, 0);
  assert.ok(budget.tryReserve('b', 50));
}

{
  const { gate: budget, events } = gate();
  const reservation = budget.tryReserve('underestimated', 40);
  assert.throws(
    () => budget.commit(reservation, 41),
    (error) => error instanceof RetainedBudgetUnderestimateError
      && error.code === 'RETAINED_BUDGET_UNDERESTIMATE',
  );
  assert.equal(budget.snapshot().committedBytes, 0);
  assert.equal(budget.snapshot().reservedBytes, 0);
  assert.equal(budget.snapshot().metrics.underestimateRejects, 1);
  assert.equal(events.at(-1).type, 'retained-budget-underestimate-rejected');
}

{
  const { gate: budget } = gate();
  budget.syncCommittedBytes(70);
  const reservation = budget.tryReserve('fits', 30);
  budget.commit(reservation, 20);
  assert.equal(budget.snapshot().committedBytes, 90);
  assert.equal(budget.snapshot().availableBytes, 10);
  budget.releaseCommitted(50, { tileId: 'old', reason: 'evicted' });
  assert.equal(budget.snapshot().committedBytes, 40);
  assert.ok(budget.tryReserve('new', 60));
}

{
  const { gate: budget } = gate();
  const reservation = budget.tryReserve('inflight', 25);
  assert.throws(() => budget.syncCommittedBytes(80), /exceed retained budget/);
  budget.cancel(reservation);
  budget.syncCommittedBytes(80);
  assert.equal(budget.snapshot().accountedBytes, 80);
}

console.log('retained byte budget regressions: PASS (5 cases)');
