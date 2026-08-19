const SCHEMA = 'nwe.static-collision-occupancy-snapshot/0.1-candidate';
const PHASE = 'after-physics-step';

export class StaticCollisionOccupancyError extends Error {
  constructor(code, message) { super(message); this.name = 'StaticCollisionOccupancyError'; this.code = code; }
}
const fail = (code, message) => { throw new StaticCollisionOccupancyError(code, message); };
const nonEmpty = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_IDENTITY', `${label} must be non-empty`);
  return value;
};
const sha = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail('INVALID_ARTIFACT_SHA256', 'artifactSha256 must be lowercase SHA-256');
  return value;
};
const epoch = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_EPOCH', 'physics epoch must be a non-negative safe integer');
  return value;
};
function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNEXPECTED_FIELD', `${label} contains unsupported field(s): ${extras.join(', ')}`);
}

function canonicalContacts(contacts) {
  if (!Array.isArray(contacts)) fail('INVALID_CONTACTS', 'contacts must be an array');
  const seen = new Set();
  const normalized = contacts.map((contact, index) => {
    exactKeys(contact, ['entityId', 'collisionId', 'tileId', 'artifactSha256'], `contacts[${index}]`);
    const normalizedContact = Object.freeze({
      entityId: nonEmpty(contact.entityId, `contacts[${index}].entityId`),
      collisionId: nonEmpty(contact.collisionId, `contacts[${index}].collisionId`),
      tileId: nonEmpty(contact.tileId, `contacts[${index}].tileId`),
      artifactSha256: sha(contact.artifactSha256),
    });
    const key = `${normalizedContact.entityId}\u0000${normalizedContact.collisionId}`;
    if (seen.has(key)) fail('DUPLICATE_CONTACT', 'entity/collision contact pairs must be unique per snapshot');
    seen.add(key);
    return normalizedContact;
  });
  normalized.sort((a, b) => a.collisionId.localeCompare(b.collisionId) || a.entityId.localeCompare(b.entityId));
  return Object.freeze(normalized);
}

export function createStaticCollisionOccupancySnapshot(input) {
  exactKeys(input, ['schema', 'phase', 'tick', 'worldFrameId', 'physicsFrame', 'contacts'], 'occupancy snapshot');
  if (input.schema !== SCHEMA) fail('UNSUPPORTED_SCHEMA', `schema must be ${SCHEMA}`);
  if (input.phase !== PHASE) fail('INVALID_PHASE', `phase must be ${PHASE}`);
  if (!Number.isSafeInteger(input.tick) || input.tick < 0) fail('INVALID_TICK', 'tick must be a non-negative safe integer');
  exactKeys(input.physicsFrame, ['physicsFrameId', 'epoch'], 'physicsFrame');
  return Object.freeze({
    schema: SCHEMA,
    phase: PHASE,
    tick: input.tick,
    worldFrameId: nonEmpty(input.worldFrameId, 'worldFrameId'),
    physicsFrame: Object.freeze({
      physicsFrameId: nonEmpty(input.physicsFrame.physicsFrameId, 'physicsFrame.physicsFrameId'),
      epoch: epoch(input.physicsFrame.epoch),
    }),
    contacts: canonicalContacts(input.contacts),
  });
}

export function deriveStaticCollisionDependencies({ snapshot, collisionState, expectedTick, currentPhysicsFrame }) {
  const normalized = createStaticCollisionOccupancySnapshot(snapshot);
  if (!collisionState || typeof collisionState !== 'object') fail('INVALID_STATE', 'collisionState is required');
  if (!Number.isSafeInteger(expectedTick) || expectedTick < 0) fail('INVALID_EXPECTED_TICK', 'expectedTick must be a non-negative safe integer');
  if (normalized.tick !== expectedTick) fail('TICK_MISMATCH', 'occupancy snapshot must be from the expected completed physics tick');
  if (normalized.worldFrameId !== collisionState.worldFrameId) fail('WORLD_FRAME_MISMATCH', 'occupancy belongs to another world frame');
  if (normalized.physicsFrame.physicsFrameId !== collisionState.physicsFrameId || currentPhysicsFrame?.physicsFrameId !== collisionState.physicsFrameId) {
    fail('PHYSICS_FRAME_MISMATCH', 'occupancy belongs to another physics frame');
  }
  if (normalized.physicsFrame.epoch !== collisionState.physicsEpoch || currentPhysicsFrame?.epoch !== collisionState.physicsEpoch) {
    fail('PHYSICS_EPOCH_MISMATCH', 'occupancy must target the current physics epoch');
  }

  const resident = new Map(collisionState.collisions.map((collision) => [collision.collisionId, collision]));
  const dependencies = new Map(collisionState.collisions.map((collision) => [collision.collisionId, []]));
  for (const contact of normalized.contacts) {
    const collision = resident.get(contact.collisionId);
    if (!collision) fail('UNKNOWN_COLLISION', `contact references non-resident collision ${contact.collisionId}`);
    if (collision.tileId !== contact.tileId) fail('TILE_ID_MISMATCH', `contact tile does not match ${contact.collisionId}`);
    if (collision.artifactSha256 !== contact.artifactSha256) fail('ARTIFACT_MISMATCH', `contact artifact does not match ${contact.collisionId}`);
    dependencies.get(contact.collisionId).push(contact.entityId);
  }

  return Object.freeze([...dependencies.entries()]
    .map(([collisionId, entityIds]) => Object.freeze({ collisionId, dependentEntityIds: Object.freeze([...entityIds].sort()) }))
    .sort((a, b) => a.collisionId.localeCompare(b.collisionId)));
}

export const STATIC_COLLISION_OCCUPANCY_SCHEMA = SCHEMA;
export const STATIC_COLLISION_OCCUPANCY_PHASE = PHASE;
