import assert from 'node:assert/strict';
import {
  applyPhysicsFrameMaintenanceEvent,
  createPhysicsFrameMaintenanceEvent,
  deserializePhysicsFrameMaintenanceEvent,
  serializePhysicsFrameMaintenanceEvent,
  validatePhysicsFrameMaintenanceSequence,
  PhysicsFrameEventContractError,
} from './physics_frame_event_contract.mjs';
import { createPhysicsSpatialFrame } from './physics_state_contract.mjs';
import { createWorldFrame, createWorldPosition } from './world_contract.mjs';

const worldFrame = createWorldFrame({
  id: 'nwe-test-world',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

function position(easting, northing, height) {
  return createWorldPosition(worldFrame, { easting, northing, height });
}

function frame(id, epoch, easting, northing, height) {
  return createPhysicsSpatialFrame({
    physicsFrameId: id,
    worldFrame,
    epoch,
    anchorWorld: position(easting, northing, height),
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof PhysicsFrameEventContractError && error.code === code);
}

const from = frame('island-a', 7, 618000.125, 6690000.25, 180.5);
const to = frame('island-a', 8, 618500.375, 6689750.125, 181.25);
const event = createPhysicsFrameMaintenanceEvent({ tick: 1234, worldFrame, fromFrame: from, toFrame: to });

// 1. Deterministic serialization contains authoritative frame identity, epoch and world delta.
const serialized = serializePhysicsFrameMaintenanceEvent(event);
assert.equal(serialized, serializePhysicsFrameMaintenanceEvent(deserializePhysicsFrameMaintenanceEvent(serialized)));
assert.deepEqual(JSON.parse(serialized).deltaWorld, { east: 500.25, north: -250.125, up: 0.75 });

// 2. Applying the event reconstructs the exact intended physics frame without renderer state.
const applied = applyPhysicsFrameMaintenanceEvent({ worldFrame, currentFrame: from, event: serialized });
assert.equal(applied.frame.physicsFrameId, 'island-a');
assert.equal(applied.frame.epoch, 8);
assert.equal(applied.frame.anchorWorld.easting, 618500.375);
assert.equal(applied.frame.anchorWorld.northing, 6689750.125);
assert.equal(applied.frame.anchorWorld.height, 181.25);
assert.equal('renderOrigin' in applied.event, false);

// 3. Stale epoch cannot be silently reinterpreted against a newer frame.
const newerCurrent = frame('island-a', 8, 618500.375, 6689750.125, 181.25);
expectCode(() => applyPhysicsFrameMaintenanceEvent({ worldFrame, currentFrame: newerCurrent, event }), 'STALE_PHYSICS_EPOCH');

// 4. Creation rejects skipped epochs.
const skipped = frame('island-a', 10, 619000, 6689500, 182);
expectCode(() => createPhysicsFrameMaintenanceEvent({ tick: 1235, worldFrame, fromFrame: from, toFrame: skipped }), 'NON_CONSECUTIVE_EPOCH');

// 5. Foreign physics island/frame series is rejected.
const foreignCurrent = frame('island-b', 7, 618000.125, 6690000.25, 180.5);
expectCode(() => applyPhysicsFrameMaintenanceEvent({ worldFrame, currentFrame: foreignCurrent, event }), 'PHYSICS_FRAME_MISMATCH');

// 6. Tampered world delta fails closed instead of changing event meaning.
const tampered = JSON.parse(serialized);
tampered.deltaWorld.east += 1;
expectCode(() => deserializePhysicsFrameMaintenanceEvent(JSON.stringify(tampered)), 'DELTA_MISMATCH');

// 7. Renderer/presentation leakage is rejected by strict fields.
const leaked = JSON.parse(serialized);
leaked.originEpoch = 99;
expectCode(() => deserializePhysicsFrameMaintenanceEvent(JSON.stringify(leaked)), 'UNEXPECTED_FIELD');

// 8. Sequence validator permits multiple islands at one tick but rejects ordering/epoch gaps.
const a8to9 = createPhysicsFrameMaintenanceEvent({
  tick: 1300,
  worldFrame,
  fromFrame: to,
  toFrame: frame('island-a', 9, 619000.5, 6689500, 182),
});
const b0 = frame('island-b', 0, 617000, 6691000, 175);
const b1 = frame('island-b', 1, 617100, 6690900, 176);
const bEvent = createPhysicsFrameMaintenanceEvent({ tick: 1300, worldFrame, fromFrame: b0, toFrame: b1 });
assert.equal(validatePhysicsFrameMaintenanceSequence([event, a8to9, bEvent]).length, 3);
expectCode(() => validatePhysicsFrameMaintenanceSequence([a8to9, event]), 'NON_MONOTONIC_TICK');
const gap = { ...a8to9, fromEpoch: 10, toEpoch: 11 };
expectCode(() => validatePhysicsFrameMaintenanceSequence([event, gap]), 'EPOCH_SEQUENCE_GAP');

console.log(JSON.stringify({
  status: 'PASS',
  contract: 'nwe.physics-frame-maintenance-event/0.1-candidate',
  cases: 8,
  renderOriginAuthority: false,
  physicsLocalAuthority: false,
  physicsFrameMaintenanceReplayInput: true,
  productionRebasePolicy: 'OPEN',
}));
