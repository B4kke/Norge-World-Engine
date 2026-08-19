import assert from 'node:assert/strict';
import {
  PhysicsMembershipContractError,
  applyPhysicsMembershipEvent,
  canonicalizePhysicsMembershipBatch,
  createPhysicsMembershipEvent,
  deserializePhysicsMembershipEvent,
  serializePhysicsMembershipEvent,
} from './physics_membership_contract.mjs';

const worldFrameId = 'world:nannestad:epsg25832+nn2000';
const frameA0 = { physicsFrameId: 'physics:a', worldFrameId, epoch: 0 };
const frameA1 = { physicsFrameId: 'physics:a', worldFrameId, epoch: 1 };
const frameB3 = { physicsFrameId: 'physics:b', worldFrameId, epoch: 3 };
const frameB4 = { physicsFrameId: 'physics:b', worldFrameId, epoch: 4 };

function expectCode(code, fn) {
  assert.throws(fn, (error) => error instanceof PhysicsMembershipContractError && error.code === code);
}

let cases = 0;

// 1. attach is explicit and binds the post-maintenance target epoch.
{
  const event = createPhysicsMembershipEvent({ tick: 10, worldFrameId, entityId: 'entity:1', toPhysicsFrameId: 'physics:a', toEpoch: 1, reason: 'spawn' });
  const result = applyPhysicsMembershipEvent({ worldFrameId, currentFrames: [frameA1], event });
  assert.deepEqual(result.membership, { entityId: 'entity:1', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 1 });
  cases += 1;
}

// 2. migration after same-tick frame maintenance uses post-maintenance epochs on both sides.
{
  const currentMembership = { entityId: 'entity:2', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 1 };
  const event = createPhysicsMembershipEvent({ tick: 20, worldFrameId, entityId: 'entity:2', fromPhysicsFrameId: 'physics:a', fromEpoch: 1, toPhysicsFrameId: 'physics:b', toEpoch: 4, reason: 'island-migration' });
  const result = applyPhysicsMembershipEvent({ worldFrameId, currentFrames: [frameB4, frameA1], currentMembership, event });
  assert.equal(result.membership.physicsFrameId, 'physics:b');
  assert.equal(result.membership.physicsFrameEpoch, 4);
  cases += 1;
}

// 3. detach is explicit and produces no local physics ownership.
{
  const currentMembership = { entityId: 'entity:3', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 0 };
  const event = createPhysicsMembershipEvent({ tick: 30, worldFrameId, entityId: 'entity:3', fromPhysicsFrameId: 'physics:a', fromEpoch: 0, reason: 'despawn' });
  const result = applyPhysicsMembershipEvent({ worldFrameId, currentFrames: [frameA0], currentMembership, event });
  assert.equal(result.membership, null);
  cases += 1;
}

// 4. pre-maintenance epoch is rejected when the frame has already rebased this tick.
{
  const currentMembership = { entityId: 'entity:4', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 0 };
  const event = createPhysicsMembershipEvent({ tick: 40, worldFrameId, entityId: 'entity:4', fromPhysicsFrameId: 'physics:a', fromEpoch: 0, toPhysicsFrameId: 'physics:b', toEpoch: 3 });
  expectCode('STALE_PHYSICS_EPOCH', () => applyPhysicsMembershipEvent({ worldFrameId, currentFrames: [frameA1, frameB3], currentMembership, event }));
  cases += 1;
}

// 5. stale entity membership is rejected even if the target frame is valid.
{
  const currentMembership = { entityId: 'entity:5', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 1 };
  const event = createPhysicsMembershipEvent({ tick: 50, worldFrameId, entityId: 'entity:5', fromPhysicsFrameId: 'physics:a', fromEpoch: 0, toPhysicsFrameId: 'physics:b', toEpoch: 4 });
  expectCode('STALE_MEMBERSHIP', () => applyPhysicsMembershipEvent({ worldFrameId, currentFrames: [frameA1, frameB4], currentMembership, event }));
  cases += 1;
}

// 6. same-frame epoch transitions cannot masquerade as membership changes.
{
  expectCode('SAME_FRAME_MEMBERSHIP_CHANGE', () => createPhysicsMembershipEvent({ tick: 60, worldFrameId, entityId: 'entity:6', fromPhysicsFrameId: 'physics:a', fromEpoch: 0, toPhysicsFrameId: 'physics:a', toEpoch: 1 }));
  cases += 1;
}

// 7. serialization is canonical and rejects presentation leakage.
{
  const event = createPhysicsMembershipEvent({ tick: 70, worldFrameId, entityId: 'entity:7', toPhysicsFrameId: 'physics:b', toEpoch: 4 });
  const bytes = serializePhysicsMembershipEvent(event);
  assert.equal(serializePhysicsMembershipEvent(deserializePhysicsMembershipEvent(bytes)), bytes);
  const leaked = { ...event, renderOriginEpoch: 9 };
  expectCode('UNEXPECTED_FIELD', () => deserializePhysicsMembershipEvent(JSON.stringify(leaked)));
  cases += 1;
}

// 8. producer order is not replay semantics for independent entities.
{
  const a = createPhysicsMembershipEvent({ tick: 80, worldFrameId, entityId: 'entity:a', toPhysicsFrameId: 'physics:a', toEpoch: 1 });
  const b = createPhysicsMembershipEvent({ tick: 80, worldFrameId, entityId: 'entity:b', toPhysicsFrameId: 'physics:b', toEpoch: 4 });
  assert.equal(JSON.stringify(canonicalizePhysicsMembershipBatch([b, a])), JSON.stringify(canonicalizePhysicsMembershipBatch([a, b])));
  cases += 1;
}

// 9. multiple same-tick changes for one entity fail closed instead of depending on array order.
{
  const attach = createPhysicsMembershipEvent({ tick: 90, worldFrameId, entityId: 'entity:9', toPhysicsFrameId: 'physics:a', toEpoch: 1 });
  const migrate = createPhysicsMembershipEvent({ tick: 90, worldFrameId, entityId: 'entity:9', fromPhysicsFrameId: 'physics:a', fromEpoch: 1, toPhysicsFrameId: 'physics:b', toEpoch: 4 });
  expectCode('AMBIGUOUS_ENTITY_ORDER', () => canonicalizePhysicsMembershipBatch([attach, migrate]));
  cases += 1;
}

// 10. foreign authoritative world frame is rejected even for identical frame names/epochs.
{
  const event = createPhysicsMembershipEvent({ tick: 100, worldFrameId: 'world:foreign', entityId: 'entity:10', toPhysicsFrameId: 'physics:a', toEpoch: 1 });
  expectCode('WORLD_FRAME_MISMATCH', () => applyPhysicsMembershipEvent({ worldFrameId, currentFrames: [frameA1], event }));
  cases += 1;
}

console.log(JSON.stringify({ status: 'PASS', schema: 'nwe.physics-frame-membership-event/0.1-candidate', cases, phase: 'after-frame-maintenance' }));
