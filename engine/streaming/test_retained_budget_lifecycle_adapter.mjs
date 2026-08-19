import assert from 'node:assert/strict';
import {
  createRetainedBudgetLifecycleAdapter,
  RetainedBudgetEstimateTooLargeError,
} from './retained_budget_lifecycle_adapter.mjs';

const tile = (id) => ({ id });

async function testWaitsUntilDisposeReleasesCommittedBytes() {
  const materialized = [];
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 100,
    estimateTileBytes: () => 60,
    loadTile: async (t) => {
      materialized.push(t.id);
      return { payload: t.id, byteSize: 60 };
    },
  });

  const a = await adapter.loadTile(tile('a'));
  let bResolved = false;
  const bPromise = adapter.loadTile(tile('b')).then((value) => {
    bResolved = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(bResolved, false);
  assert.deepEqual(materialized, ['a']);
  assert.equal(adapter.snapshot().waitingLoads, 1);

  await adapter.disposeTile(tile('a'), a.payload, { reason: 'evicted' });
  const b = await bPromise;
  assert.equal(b.payload, 'b');
  assert.deepEqual(materialized, ['a', 'b']);
  assert.equal(adapter.snapshot().budget.overcommitBytes, 0);
}

async function testCancelledWaiterNeverMaterializes() {
  const materialized = [];
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 80,
    estimateTileBytes: () => 80,
    loadTile: async (t) => {
      materialized.push(t.id);
      return { payload: t.id, byteSize: 80 };
    },
  });

  const a = await adapter.loadTile(tile('a'));
  const controller = new AbortController();
  const bPromise = adapter.loadTile(tile('b'), { signal: controller.signal });
  controller.abort(new DOMException('moved away', 'AbortError'));
  await assert.rejects(bPromise, (error) => error?.name === 'AbortError');
  assert.deepEqual(materialized, ['a']);
  assert.equal(adapter.snapshot().waitingLoads, 0);

  await adapter.disposeTile(tile('a'), a.payload);
  assert.equal(adapter.snapshot().budget.accountedBytes, 0);
}

async function testAbortAfterMaterializationCleansPayloadAndReservation() {
  let markStarted;
  let releaseMaterialization;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const materialized = new Promise((resolve) => { releaseMaterialization = resolve; });
  const disposed = [];
  const controller = new AbortController();
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 100,
    estimateTileBytes: () => 100,
    loadTile: async () => {
      markStarted();
      await materialized;
      return { payload: { id: 'late' }, byteSize: 100 };
    },
    disposeTile: async (_tile, payload, context) => disposed.push({ payload, context }),
  });

  const promise = adapter.loadTile(tile('a'), { signal: controller.signal });
  await started;
  controller.abort(new DOMException('camera moved', 'AbortError'));
  releaseMaterialization();
  await assert.rejects(promise, (error) => error?.name === 'AbortError');
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.budget.accountedBytes, 0);
  assert.equal(snapshot.budget.activeReservations, 0);
  assert.equal(snapshot.committedTiles, 0);
  assert.equal(disposed.length, 1);
  assert.equal(disposed[0].context.reason, 'retained-budget-load-aborted-after-materialization');
}

async function testUnderestimateFailsClosedAndCleansPayload() {
  const disposed = [];
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 100,
    estimateTileBytes: () => 50,
    loadTile: async () => ({ payload: { bytes: 70 }, byteSize: 70 }),
    disposeTile: async (_tile, payload, context) => disposed.push({ payload, context }),
  });

  await assert.rejects(
    adapter.loadTile(tile('a')),
    (error) => error?.code === 'RETAINED_BUDGET_UNDERESTIMATE',
  );
  assert.equal(adapter.snapshot().budget.accountedBytes, 0);
  assert.equal(adapter.snapshot().committedTiles, 0);
  assert.equal(disposed.length, 1);
  assert.equal(disposed[0].context.reason, 'retained-budget-underestimate');
}

async function testDisposeFailureKeepsAccountingCommitted() {
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 100,
    estimateTileBytes: () => 100,
    loadTile: async (t) => ({ payload: t.id, byteSize: 100 }),
    disposeTile: async () => {
      throw new Error('renderer-neutral disposal failed');
    },
  });

  const a = await adapter.loadTile(tile('a'));
  await assert.rejects(adapter.disposeTile(tile('a'), a.payload), /disposal failed/);
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.budget.committedBytes, 100);
  assert.equal(snapshot.committedTiles, 1);
  assert.equal(snapshot.budget.overcommitBytes, 0);
}

async function testOversizeEstimateFailsBeforeMaterialization() {
  let calls = 0;
  const adapter = createRetainedBudgetLifecycleAdapter({
    maxRetainedBytes: 64,
    estimateTileBytes: () => 65,
    loadTile: async () => {
      calls += 1;
      return { payload: null, byteSize: 65 };
    },
  });

  await assert.rejects(
    adapter.loadTile(tile('a')),
    (error) => error instanceof RetainedBudgetEstimateTooLargeError
      && error.code === 'RETAINED_BUDGET_ESTIMATE_TOO_LARGE',
  );
  assert.equal(calls, 0);
  assert.equal(adapter.snapshot().budget.accountedBytes, 0);
}

await testWaitsUntilDisposeReleasesCommittedBytes();
await testCancelledWaiterNeverMaterializes();
await testAbortAfterMaterializationCleansPayloadAndReservation();
await testUnderestimateFailsClosedAndCleansPayload();
await testDisposeFailureKeepsAccountingCommitted();
await testOversizeEstimateFailsBeforeMaterialization();
console.log('retained budget lifecycle adapter regressions: PASS (6 cases)');
