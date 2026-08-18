import assert from 'node:assert/strict';
import { TileStreamingScheduler } from './tile_scheduler.mjs';

async function testRetryDelayDefersUntilClockAllowsRetry() {
  const tile = { id: 'retry-delay', centerE: 0, centerN: 0 };
  let now = 1000;
  let attempts = 0;
  const events = [];
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    retryDelayMs: 250,
    clock: () => now,
    onEvent: (event) => events.push(event),
    loadTile: async (_tile, context) => {
      attempts += 1;
      assert.equal(context.attempt, attempts);
      if (attempts === 1) throw new Error('synthetic network failure');
      return { payload: { verified: true }, byteSize: 100 };
    },
  });

  await scheduler.update({ e: 0, n: 0 }, [tile]);
  let snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 1);
  assert.equal(snapshot.records[0].state, 'failed');
  assert.equal(snapshot.records[0].loadAttempts, 1);
  assert.equal(snapshot.records[0].retryNotBefore, 1250);

  now = 1249;
  await scheduler.update({ e: 0, n: 0 }, [tile]);
  snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 1, 'retry must remain deferred before retryNotBefore');
  assert.equal(snapshot.metrics.retryDeferrals, 1);
  assert.equal(snapshot.records[0].state, 'failed');

  now = 1250;
  await scheduler.update({ e: 0, n: 0 }, [tile]);
  snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 2);
  assert.equal(snapshot.metrics.retriesQueued, 1);
  assert.equal(snapshot.records[0].state, 'resident');
  assert.equal(snapshot.records[0].loadAttempts, 0, 'successful activation resets the retry cycle');
  assert.deepEqual(events.filter((event) => event.type === 'load-started').map((event) => event.attempt), [1, 2]);
}

async function testRetryAttemptCapIsPerInterestCycle() {
  const tile = { id: 'retry-cap', centerE: 0, centerN: 0 };
  let attempts = 0;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    maxLoadAttemptsPerInterest: 2,
    loadTile: async () => {
      attempts += 1;
      throw new Error(`synthetic failure ${attempts}`);
    },
  });

  await scheduler.update({ e: 0, n: 0 }, [tile]);
  await scheduler.whenIdle();
  await scheduler.update({ e: 0, n: 0 }, [tile]);
  await scheduler.whenIdle();
  let snapshot = await scheduler.update({ e: 0, n: 0 }, [tile]);
  snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 2, 'attempt cap must stop a retry storm while interest is unchanged');
  assert.equal(snapshot.metrics.retryExhaustions, 1);
  assert.equal(snapshot.records[0].state, 'failed');
  assert.equal(snapshot.records[0].loadAttempts, 2);

  await scheduler.update({ e: 1000, n: 0 }, [tile]);
  snapshot = scheduler.snapshot();
  assert.equal(snapshot.records[0].state, 'idle');
  assert.equal(snapshot.records[0].loadAttempts, 0, 'leaving interest resets the retry cycle');

  await scheduler.update({ e: 0, n: 0 }, [tile]);
  snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 3, 're-entering interest starts a new bounded retry cycle');
  assert.equal(snapshot.records[0].loadAttempts, 1);
}

async function testDefaultRetryBehaviorRemainsUpdateDrivenAndUnbounded() {
  const tile = { id: 'legacy-default', centerE: 0, centerN: 0 };
  let attempts = 0;
  const scheduler = new TileStreamingScheduler({
    activeRadiusMeters: 100,
    retainRadiusMeters: 200,
    maxResidentTiles: 1,
    maxConcurrentLoads: 1,
    maxCacheBytes: 1000,
    loadTile: async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('first failure');
      return { payload: { verified: true }, byteSize: 100 };
    },
  });

  await scheduler.update({ e: 0, n: 0 }, [tile]);
  await scheduler.whenIdle();
  await scheduler.update({ e: 0, n: 0 }, [tile]);
  const snapshot = await scheduler.whenIdle();
  assert.equal(attempts, 2);
  assert.equal(snapshot.metrics.retryDelayMs, 0);
  assert.equal(snapshot.metrics.maxLoadAttemptsPerInterest, null);
  assert.equal(snapshot.records[0].state, 'resident');
}

await testRetryDelayDefersUntilClockAllowsRetry();
await testRetryAttemptCapIsPerInterestCycle();
await testDefaultRetryBehaviorRemainsUpdateDrivenAndUnbounded();
console.log('tile scheduler retry regressions: PASS (3 cases)');
