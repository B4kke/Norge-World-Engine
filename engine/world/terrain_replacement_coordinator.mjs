import { planStaticCollisionEpochRebind } from './static_collision_epoch_rebind_contract.mjs';

export const TERRAIN_REPLACEMENT_COORDINATOR_SCHEMA = 'nwe.terrain-replacement-coordinator/0.1-candidate';

export class TerrainReplacementCoordinatorError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'TerrainReplacementCoordinatorError';
    this.code = code;
    if (cause != null) this.cause = cause;
  }
}

function fail(code, message, cause = null) {
  throw new TerrainReplacementCoordinatorError(code, message, cause);
}

function requireFunction(value, label) {
  if (typeof value !== 'function') fail('INVALID_PARTICIPANT', `${label} must be a function`);
  return value;
}

function requirePrepared(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_PREPARED_TRANSACTION', `${label}.prepare() must return an object`);
  }
  requireFunction(value.commit, `${label}.commit`);
  requireFunction(value.rollback, `${label}.rollback`);
  return value;
}

function requirePayload(payload, transaction) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('INVALID_MATERIALIZED_PAYLOAD', 'materializeReplacement must return a terrain payload object');
  }
  if (payload.tileId !== transaction.replacement.tileId) {
    fail('MATERIALIZED_TILE_MISMATCH', `materialized ${payload.tileId ?? '<missing>'} != ${transaction.replacement.tileId}`);
  }
  if (payload.artifact?.sha256 !== transaction.replacement.artifactSha256) {
    fail('MATERIALIZED_ARTIFACT_MISMATCH', 'materialized artifact identity does not match replacement transaction');
  }
  return payload;
}

/**
 * Candidate cross-role transaction boundary for replacing an in-use terrain
 * artifact while a physics-frame epoch changes. The coordinator owns ordering,
 * not subsystem internals. Each participant must stage work in prepare() and
 * publish only in commit(); rollback() must restore its previously published
 * state when a later participant fails.
 *
 * Render-local state is intentionally absent. The authoritative inputs are the
 * world frame, exact artifact identities, simulation tick and physics/collision
 * state used by planStaticCollisionEpochRebind().
 */
export function createTerrainReplacementCoordinator({
  materializeReplacement,
  streamingPayloadParticipant,
  solverCollisionParticipant,
  lifecycleParticipant,
} = {}) {
  requireFunction(materializeReplacement, 'materializeReplacement');
  for (const [label, participant] of Object.entries({
    streamingPayloadParticipant,
    solverCollisionParticipant,
    lifecycleParticipant,
  })) {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
      fail('INVALID_PARTICIPANT', `${label} is required`);
    }
    requireFunction(participant.prepare, `${label}.prepare`);
  }

  return Object.freeze({
    async replace({ worldFrame, currentPhysicsFrame, lifecycleState, transaction, signal } = {}) {
      const nextPayload = requirePayload(
        await materializeReplacement(transaction?.replacement?.tileId, transaction, { signal }),
        transaction,
      );

      // World/physics/collision preflight happens before any participant may
      // publish state. Invalid identity/epoch/tick/occupancy fails here.
      const plan = planStaticCollisionEpochRebind({
        worldFrame,
        currentPhysicsFrame,
        lifecycleState,
        transaction,
      });

      const context = Object.freeze({
        schema: TERRAIN_REPLACEMENT_COORDINATOR_SCHEMA,
        tick: transaction.tick,
        tileId: transaction.replacement.tileId,
        previousArtifactSha256: transaction.replacement.previousArtifactSha256,
        artifactSha256: transaction.replacement.artifactSha256,
        nextPayload,
        plan,
      });

      const participants = [
        ['solverCollision', solverCollisionParticipant],
        ['streamingPayload', streamingPayloadParticipant],
        ['lifecycle', lifecycleParticipant],
      ];
      const prepared = [];
      try {
        for (const [label, participant] of participants) {
          const staged = requirePrepared(await participant.prepare(context), label);
          prepared.push({ label, staged });
        }
      } catch (error) {
        for (const { staged } of [...prepared].reverse()) {
          try { await staged.rollback(); } catch { /* preserve primary error */ }
        }
        fail('PREPARE_FAILED', 'terrain replacement prepare failed before commit', error);
      }

      const committed = [];
      try {
        for (const entry of prepared) {
          await entry.staged.commit();
          committed.push(entry);
        }
      } catch (error) {
        for (const { staged } of [...committed].reverse()) {
          try { await staged.rollback(); } catch { /* preserve primary error */ }
        }
        // Prepared-but-not-committed participants may still own staged resources.
        for (const { staged } of prepared.slice(committed.length).reverse()) {
          try { await staged.rollback(); } catch { /* preserve primary error */ }
        }
        fail('COMMIT_FAILED_ROLLED_BACK', 'terrain replacement commit failed and rollback was attempted', error);
      }

      return Object.freeze({
        schema: TERRAIN_REPLACEMENT_COORDINATOR_SCHEMA,
        tick: context.tick,
        tileId: context.tileId,
        artifactSha256: context.artifactSha256,
        nextPhysicsFrame: plan.nextPhysicsFrame,
        nextLifecycleState: plan.nextLifecycleState,
      });
    },
  });
}
