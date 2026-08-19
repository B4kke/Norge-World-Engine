import assert from 'node:assert/strict';

import { createWorldFrame } from './world_contract.mjs';
import { createPhysicsSpatialFrame } from './physics_state_contract.mjs';
import { createPhysicsFrameMaintenanceEvent } from './physics_frame_event_contract.mjs';
import { createStaticCollisionLifecycleState } from './static_collision_lifecycle_contract.mjs';
import {
  createTerrainReplacementCoordinator,
  TERRAIN_REPLACEMENT_COORDINATOR_SCHEMA,
} from './terrain_replacement_coordinator.mjs';

const WORLD = createWorldFrame({ id: 'world:test', horizontalCrs: 'EPSG:25832', verticalDatum: 'NN2000' });
const frame0 = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:test', worldFrame: WORLD, epoch: 0,
  anchorWorld: { worldFrameId: WORLD.id, easting: 500000, northing: 6650000, height: 100 },
});
const frame1 = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:test', worldFrame: WORLD, epoch: 1,
  anchorWorld: { worldFrameId: WORLD.id, easting: 501000, northing: 6649250, height: 100 },
});
const maintenance = createPhysicsFrameMaintenanceEvent({ tick: 42, worldFrame: WORLD, fromFrame: frame0, toFrame: frame1 });
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const state0 = createStaticCollisionLifecycleState({
  worldFrameId: WORLD.id,
  physicsFrameId: frame0.physicsFrameId,
  physicsEpoch: frame0.epoch,
  collisions: [{
    collisionId: 'collision:a', tileId: 'tile:a', artifactSha256: OLD, dependentEntityIds: ['entity:1'],
  }],
});
const tx = () => ({
  schema: 'nwe.static-collision-epoch-rebind/0.1-candidate',
  tick: 42,
  worldFrameId: WORLD.id,
  maintenanceEvent: maintenance,
  replacement: {
    collisionId: 'collision:a', tileId: 'tile:a', previousArtifactSha256: OLD,
    artifactSha256: NEW, dependentEntityIds: ['entity:1'], continuity: 'atomic-rebind',
  },
});

function createParticipant(label, log, published, { failPrepare = false, failCommit = false } = {}) {
  return {
    async prepare(context) {
      log.push(`${label}:prepare`);
      if (failPrepare) throw new Error(`${label} prepare failed`);
      const previous = published.value;
      const next = `${context.tileId}:${context.artifactSha256}:${context.plan.nextPhysicsFrame.epoch}`;
      let committed = false;
      return {
        async commit() {
          log.push(`${label}:commit`);
          if (failCommit) throw new Error(`${label} commit failed`);
          published.value = next;
          committed = true;
        },
        async rollback() {
          log.push(`${label}:rollback`);
          if (committed) published.value = previous;
        },
      };
    },
  };
}

function createHarness(options = {}) {
  const log = [];
  const solver = { value: `tile:a:${OLD}:0` };
  const streaming = { value: `tile:a:${OLD}:0` };
  const lifecycle = { value: `tile:a:${OLD}:0` };
  let materializeCalls = 0;
  const coordinator = createTerrainReplacementCoordinator({
    async materializeReplacement(tileId) {
      materializeCalls += 1;
      return {
        schema: 'nwe.terrain-tile-runtime-payload/0.1',
        tileId,
        artifact: { sha256: options.materializedSha ?? NEW },
      };
    },
    solverCollisionParticipant: createParticipant('solver', log, solver, options.solver),
    streamingPayloadParticipant: createParticipant('streaming', log, streaming, options.streaming),
    lifecycleParticipant: createParticipant('lifecycle', log, lifecycle, options.lifecycle),
  });
  return { coordinator, log, solver, streaming, lifecycle, get materializeCalls() { return materializeCalls; } };
}

async function successfulCommitIsOrderedAndAtomic() {
  const harness = createHarness();
  const result = await harness.coordinator.replace({
    worldFrame: WORLD, currentPhysicsFrame: frame0, lifecycleState: state0, transaction: tx(),
  });
  assert.equal(result.schema, TERRAIN_REPLACEMENT_COORDINATOR_SCHEMA);
  assert.equal(result.nextPhysicsFrame.epoch, 1);
  assert.equal(result.nextLifecycleState.collisions[0].artifactSha256, NEW);
  assert.deepEqual(harness.log, [
    'solver:prepare', 'streaming:prepare', 'lifecycle:prepare',
    'solver:commit', 'streaming:commit', 'lifecycle:commit',
  ]);
  assert.equal(harness.solver.value, `tile:a:${NEW}:1`);
  assert.equal(harness.streaming.value, `tile:a:${NEW}:1`);
  assert.equal(harness.lifecycle.value, `tile:a:${NEW}:1`);
}

async function materializedIdentityMismatchFailsBeforePrepare() {
  const harness = createHarness({ materializedSha: 'c'.repeat(64) });
  await assert.rejects(
    harness.coordinator.replace({ worldFrame: WORLD, currentPhysicsFrame: frame0, lifecycleState: state0, transaction: tx() }),
    (error) => error?.code === 'MATERIALIZED_ARTIFACT_MISMATCH',
  );
  assert.deepEqual(harness.log, []);
}

async function invalidWorldPreflightFailsBeforePrepare() {
  const harness = createHarness();
  const invalid = tx();
  invalid.replacement.previousArtifactSha256 = 'c'.repeat(64);
  await assert.rejects(
    harness.coordinator.replace({ worldFrame: WORLD, currentPhysicsFrame: frame0, lifecycleState: state0, transaction: invalid }),
    (error) => error?.code === 'PREVIOUS_ARTIFACT_MISMATCH',
  );
  assert.deepEqual(harness.log, []);
}

async function prepareFailureRollsBackEarlierStagesWithoutPublishing() {
  const harness = createHarness({ streaming: { failPrepare: true } });
  await assert.rejects(
    harness.coordinator.replace({ worldFrame: WORLD, currentPhysicsFrame: frame0, lifecycleState: state0, transaction: tx() }),
    (error) => error?.code === 'PREPARE_FAILED',
  );
  assert.deepEqual(harness.log, ['solver:prepare', 'streaming:prepare', 'solver:rollback']);
  assert.equal(harness.solver.value, `tile:a:${OLD}:0`);
  assert.equal(harness.streaming.value, `tile:a:${OLD}:0`);
  assert.equal(harness.lifecycle.value, `tile:a:${OLD}:0`);
}

async function midCommitFailureRestoresAllPublishedParticipants() {
  const harness = createHarness({ streaming: { failCommit: true } });
  await assert.rejects(
    harness.coordinator.replace({ worldFrame: WORLD, currentPhysicsFrame: frame0, lifecycleState: state0, transaction: tx() }),
    (error) => error?.code === 'COMMIT_FAILED_ROLLED_BACK',
  );
  assert.deepEqual(harness.log, [
    'solver:prepare', 'streaming:prepare', 'lifecycle:prepare',
    'solver:commit', 'streaming:commit',
    'solver:rollback', 'lifecycle:rollback', 'streaming:rollback',
  ]);
  assert.equal(harness.solver.value, `tile:a:${OLD}:0`);
  assert.equal(harness.streaming.value, `tile:a:${OLD}:0`);
  assert.equal(harness.lifecycle.value, `tile:a:${OLD}:0`);
}

async function presentationLeakStillFailsClosed() {
  const harness = createHarness();
  const invalid = tx();
  invalid.renderOrigin = { e: 1, n: 2 };
  await assert.rejects(
    harness.coordinator.replace({ worldFrame: WORLD, currentPhysicsFrame: frame0, lifecycleState: state0, transaction: invalid }),
    (error) => error?.code === 'UNEXPECTED_FIELD',
  );
  assert.deepEqual(harness.log, []);
}

await successfulCommitIsOrderedAndAtomic();
await materializedIdentityMismatchFailsBeforePrepare();
await invalidWorldPreflightFailsBeforePrepare();
await prepareFailureRollsBackEarlierStagesWithoutPublishing();
await midCommitFailureRestoresAllPublishedParticipants();
await presentationLeakStillFailsClosed();

console.log('terrain replacement coordinator regressions: PASS (6 cases)');
