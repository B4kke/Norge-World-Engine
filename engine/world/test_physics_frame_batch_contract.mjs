import assert from 'node:assert/strict';
import { createWorldFrame, createWorldPosition } from './world_contract.mjs';
import { createPhysicsSpatialFrame } from './physics_state_contract.mjs';
import { createPhysicsFrameMaintenanceEvent } from './physics_frame_event_contract.mjs';
import {
  applyPhysicsFrameMaintenanceBatch,
  createPhysicsFrameMaintenanceBatch,
  deserializePhysicsFrameMaintenanceBatch,
  serializePhysicsFrameMaintenanceBatch,
} from './physics_frame_batch_contract.mjs';

const worldFrame = createWorldFrame({
  id: 'world:test:25832+nn2000',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

function position(easting, northing, height = 100) {
  return createWorldPosition(worldFrame, { easting, northing, height });
}

function frame(id, epoch, anchor) {
  return createPhysicsSpatialFrame({
    physicsFrameId: id,
    worldFrame,
    epoch,
    anchorWorld: anchor,
  });
}

function event(tick, fromFrame, toFrame, reason = 'origin-maintenance') {
  return createPhysicsFrameMaintenanceEvent({ tick, worldFrame, fromFrame, toFrame, reason });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

const a0 = frame('physics:a', 0, position(500000, 6680000));
const a1 = frame('physics:a', 1, position(500500.25, 6680250.5));
const a2 = frame('physics:a', 2, position(501000.5, 6680501));
const a3 = frame('physics:a', 3, position(501500.75, 6680751.5));
const b0 = frame('physics:b', 0, position(502000, 6681000));
const b1 = frame('physics:b', 1, position(502250.125, 6681125.25));

const a01 = event(120, a0, a1);
const b01 = event(120, b0, b1);

// 1. A same-tick multi-island batch has one canonical byte representation,
// independent of producer input order.
const batchAB = createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a01, b01] });
const batchBA = createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [b01, a01] });
const serializedAB = serializePhysicsFrameMaintenanceBatch(batchAB);
const serializedBA = serializePhysicsFrameMaintenanceBatch(batchBA);
assert.equal(serializedAB, serializedBA);
assert.deepEqual(batchBA.events.map((item) => item.physicsFrameId), ['physics:a', 'physics:b']);

// 2. Deserialization preserves the canonical order and exact bytes.
const decoded = deserializePhysicsFrameMaintenanceBatch(serializedAB);
assert.equal(serializePhysicsFrameMaintenanceBatch(decoded), serializedAB);
assert.deepEqual(decoded.events.map((item) => [item.physicsFrameId, item.fromEpoch, item.toEpoch]), [
  ['physics:a', 0, 1],
  ['physics:b', 0, 1],
]);

// 3. Applying independent island events is deterministic even when current-frame
// input order differs; output frames are canonicalized by physicsFrameId.
const appliedAB = applyPhysicsFrameMaintenanceBatch({ worldFrame, currentFrames: [a0, b0], batch: batchAB });
const appliedBA = applyPhysicsFrameMaintenanceBatch({ worldFrame, currentFrames: [b0, a0], batch: batchBA });
assert.deepEqual(appliedAB.frames, appliedBA.frames);
assert.deepEqual(appliedAB.frames.map((item) => [item.physicsFrameId, item.epoch]), [
  ['physics:a', 1],
  ['physics:b', 1],
]);
assert.deepEqual(appliedAB.frames[0].anchorWorld, a1.anchorWorld);
assert.deepEqual(appliedAB.frames[1].anchorWorld, b1.anchorWorld);

// 4. Multiple maintenance transitions for one island within one tick are legal
// only when they form one consecutive epoch chain; shuffled input canonicalizes.
const a12 = event(120, a1, a2, 'island-recenter');
const chained = createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a12, a01] });
assert.deepEqual(chained.events.map((item) => [item.fromEpoch, item.toEpoch]), [[0, 1], [1, 2]]);
const appliedChain = applyPhysicsFrameMaintenanceBatch({ worldFrame, currentFrames: [a0], batch: chained });
assert.equal(appliedChain.frames[0].epoch, 2);
assert.deepEqual(appliedChain.frames[0].anchorWorld, a2.anchorWorld);

// 5. Duplicate transitions fail closed instead of being silently replayed twice.
expectCode(
  () => createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a01, a01] }),
  'DUPLICATE_FRAME_TRANSITION',
);

// 6. A gap in one island's same-tick epoch chain fails closed.
const a23 = event(120, a2, a3);
expectCode(
  () => createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a01, a23] }),
  'EPOCH_SEQUENCE_GAP',
);

// 7. Batch tick is authoritative replay metadata; mixed ticks are rejected.
const b01Later = event(121, b0, b1);
expectCode(
  () => createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a01, b01Later] }),
  'BATCH_TICK_MISMATCH',
);

// 8. A maintenance batch cannot mix authoritative world frames, even when the
// projected numeric coordinates happen to look compatible.
const foreignWorld = createWorldFrame({
  id: 'world:foreign:25832+nn2000',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});
const foreign0 = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:foreign',
  worldFrame: foreignWorld,
  epoch: 0,
  anchorWorld: createWorldPosition(foreignWorld, { easting: 500000, northing: 6680000, height: 100 }),
});
const foreign1 = createPhysicsSpatialFrame({
  physicsFrameId: 'physics:foreign',
  worldFrame: foreignWorld,
  epoch: 1,
  anchorWorld: createWorldPosition(foreignWorld, { easting: 500100, northing: 6680100, height: 100 }),
});
const foreignEvent = createPhysicsFrameMaintenanceEvent({
  tick: 120,
  worldFrame: foreignWorld,
  fromFrame: foreign0,
  toFrame: foreign1,
});
expectCode(
  () => createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a01, foreignEvent] }),
  'BATCH_WORLD_FRAME_MISMATCH',
);

// 9. Replay cannot apply an event without the current frame/epoch state for that island.
expectCode(
  () => applyPhysicsFrameMaintenanceBatch({ worldFrame, currentFrames: [a0], batch: batchAB }),
  'MISSING_CURRENT_FRAME',
);

// 10. Presentation/render-origin fields cannot leak through the embedded event boundary.
const leaked = JSON.parse(JSON.stringify(a01));
leaked.renderOriginEpoch = 99;
expectCode(
  () => createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [leaked] }),
  'UNEXPECTED_FIELD',
);

// 11. Duplicate current-frame identities are ambiguous and fail closed.
expectCode(
  () => applyPhysicsFrameMaintenanceBatch({ worldFrame, currentFrames: [a0, a0], batch: createPhysicsFrameMaintenanceBatch({ tick: 120, worldFrame, events: [a01] }) }),
  'DUPLICATE_CURRENT_FRAME',
);

console.log(JSON.stringify({
  status: 'PASS',
  schema: batchAB.schema,
  cases: 11,
  canonicalBytes: Buffer.byteLength(serializedAB),
  sameTickIslandOrder: batchAB.events.map((item) => item.physicsFrameId),
  chainedEpochs: chained.events.map((item) => `${item.fromEpoch}->${item.toEpoch}`),
}));
