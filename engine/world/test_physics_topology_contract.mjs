import assert from 'node:assert/strict';
import {
  PhysicsTopologyContractError,
  applyPhysicsTopologyTransition,
  createPhysicsTopologyTransition,
  deserializePhysicsTopologyTransition,
  serializePhysicsTopologyTransition,
} from './physics_topology_contract.mjs';

const worldFrameId = 'world:nannestad-candidate';
const frames = [
  { physicsFrameId: 'physics:a', worldFrameId, epoch: 3 },
  { physicsFrameId: 'physics:b', worldFrameId, epoch: 7 },
  { physicsFrameId: 'physics:c', worldFrameId, epoch: 2 },
];
const memberships = [
  { entityId: 'body:a', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 3 },
  { entityId: 'body:b', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 3 },
  { entityId: 'body:c', worldFrameId, physicsFrameId: 'physics:a', physicsFrameEpoch: 3 },
];

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof PhysicsTopologyContractError && error.code === code);
}
function transition(assignments, activeConstraints = []) {
  return createPhysicsTopologyTransition({ tick: 120, worldFrameId, transitionId: 'topology:120', assignments, activeConstraints });
}

// 1. A real 1 -> 2 repartition is classified as split and applies.
{
  const event = transition([
    { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:b', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:c', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:c', toEpoch: 2 },
  ]);
  assert.equal(event.transitionKind, 'split');
  const applied = applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: memberships, event });
  assert.deepEqual(applied.memberships.map((m) => [m.entityId, m.physicsFrameId]), [
    ['body:a', 'physics:b'], ['body:b', 'physics:b'], ['body:c', 'physics:c'],
  ]);
}

// 2. Two source frames -> one target frame is a merge.
{
  const mergeMemberships = [
    { entityId: 'body:a', worldFrameId, physicsFrameId: 'physics:b', physicsFrameEpoch: 7 },
    { entityId: 'body:b', worldFrameId, physicsFrameId: 'physics:c', physicsFrameEpoch: 2 },
  ];
  const event = transition([
    { entityId: 'body:a', fromPhysicsFrameId: 'physics:b', fromEpoch: 7, toPhysicsFrameId: 'physics:a', toEpoch: 3 },
    { entityId: 'body:b', fromPhysicsFrameId: 'physics:c', fromEpoch: 2, toPhysicsFrameId: 'physics:a', toEpoch: 3 },
  ]);
  assert.equal(event.transitionKind, 'merge');
  assert.equal(applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: mergeMemberships, event }).memberships[0].physicsFrameId, 'physics:a');
}

// 3. A live constraint may not silently span frames after a split.
{
  const event = transition([
    { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:b', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:c', toEpoch: 2 },
    { entityId: 'body:c', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:c', toEpoch: 2 },
  ], [{ constraintId: 'joint:ab', entityAId: 'body:a', entityBId: 'body:b' }]);
  expectCode(() => applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: memberships, event }), 'CROSS_FRAME_CONSTRAINT');
}

// 4. Constrained bodies may co-migrate when their target frame+epoch is identical.
{
  const event = transition([
    { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:b', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:c', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:c', toEpoch: 2 },
  ], [{ constraintId: 'joint:ab', entityAId: 'body:b', entityBId: 'body:a' }]);
  const applied = applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: memberships, event });
  assert.equal(applied.memberships.find((m) => m.entityId === 'body:a').physicsFrameId, 'physics:b');
}

// 5. Connected chains cannot be cut across frames while constraints remain active.
{
  const event = transition([
    { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:b', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:c', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:c', toEpoch: 2 },
  ], [
    { constraintId: 'joint:ab', entityAId: 'body:a', entityBId: 'body:b' },
    { constraintId: 'joint:bc', entityAId: 'body:b', entityBId: 'body:c' },
  ]);
  expectCode(() => applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: memberships, event }), 'CROSS_FRAME_CONSTRAINT');
}

// 6. Stale source membership fails closed.
{
  const event = transition(memberships.map((m) => ({
    entityId: m.entityId,
    fromPhysicsFrameId: m.physicsFrameId,
    fromEpoch: m.physicsFrameEpoch,
    toPhysicsFrameId: 'physics:b',
    toEpoch: 7,
  })));
  const stale = memberships.map((m) => ({ ...m }));
  stale[0].physicsFrameEpoch = 2;
  expectCode(() => applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: stale, event }), 'STALE_MEMBERSHIP');
}

// 7. A pre-maintenance target epoch cannot be used after a rebase.
{
  const event = transition(memberships.map((m) => ({
    entityId: m.entityId,
    fromPhysicsFrameId: 'physics:a', fromEpoch: 3,
    toPhysicsFrameId: 'physics:b', toEpoch: 6,
  })));
  expectCode(() => applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: memberships, event }), 'STALE_PHYSICS_EPOCH');
}

// 8. Duplicate entity assignments are never array-order semantics.
expectCode(() => transition([
  { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
  { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:c', toEpoch: 2 },
]), 'DUPLICATE_ENTITY_ASSIGNMENT');

// 9. Constraint endpoints outside the exact transition scope fail closed.
{
  const event = transition(memberships.map((m) => ({ entityId: m.entityId, fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 })), [
    { constraintId: 'joint:external', entityAId: 'body:a', entityBId: 'body:external' },
  ]);
  expectCode(() => applyPhysicsTopologyTransition({ worldFrameId, currentFrames: frames, currentMemberships: memberships, event }), 'UNKNOWN_CONSTRAINT_ENDPOINT');
}

// 10. Backend island/render-origin leakage is rejected structurally.
{
  const event = transition(memberships.map((m) => ({ entityId: m.entityId, fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 })));
  expectCode(() => deserializePhysicsTopologyTransition(JSON.stringify({ ...event, backendIslandId: 44 })), 'UNEXPECTED_FIELD');
  const leaked = JSON.parse(JSON.stringify(event));
  leaked.assignments[0].renderOriginEpoch = 99;
  expectCode(() => deserializePhysicsTopologyTransition(JSON.stringify(leaked)), 'UNEXPECTED_FIELD');
}

// 11. Producer order of entities, constraints and endpoint order is non-semantic.
{
  const a = transition([
    { entityId: 'body:b', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:a', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
    { entityId: 'body:c', fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 },
  ], [
    { constraintId: 'joint:bc', entityAId: 'body:c', entityBId: 'body:b' },
    { constraintId: 'joint:ab', entityAId: 'body:b', entityBId: 'body:a' },
  ]);
  const b = transition([...a.assignments].reverse(), [
    { constraintId: 'joint:ab', entityAId: 'body:a', entityBId: 'body:b' },
    { constraintId: 'joint:bc', entityAId: 'body:b', entityBId: 'body:c' },
  ]);
  assert.equal(serializePhysicsTopologyTransition(a), serializePhysicsTopologyTransition(b));
}

// 12. Declared kind and authoritative world identity are checked, not trusted.
{
  const event = transition(memberships.map((m) => ({ entityId: m.entityId, fromPhysicsFrameId: 'physics:a', fromEpoch: 3, toPhysicsFrameId: 'physics:b', toEpoch: 7 })));
  const forgedKind = { ...event, transitionKind: 'split' };
  expectCode(() => deserializePhysicsTopologyTransition(JSON.stringify(forgedKind)), 'TRANSITION_KIND_MISMATCH');
  expectCode(() => applyPhysicsTopologyTransition({ worldFrameId: 'world:other', currentFrames: frames, currentMemberships: memberships, event }), 'WORLD_FRAME_MISMATCH');
}

console.log('physics topology contract regressions: PASS (12 adversarial cases)');
