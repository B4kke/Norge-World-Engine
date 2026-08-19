# 2026-08-19 — ATLAS physics-frame membership/lifecycle candidate

## Scope

This proof advances `P0-COORDINATES-01` at the simulation boundary. Existing ATLAS work makes physics-frame anchors/epochs and same-tick maintenance batches explicit, but body/entity ownership of those frames was still implicit. That is unsafe for deterministic replay once an entity can attach, detach or migrate between physics frames, especially on the same tick as a frame rebase.

This change defines a candidate membership contract. It does not select a physics engine, island policy, rebase threshold, whole-Norway coordinate model or networking policy.

## Candidate contract

`nwe.physics-frame-membership-event/0.1-candidate` carries:

- simulation `tick` and authoritative `worldFrameId`;
- stable `entityId`;
- explicit source frame + source epoch, nullable only for attach;
- explicit target frame + target epoch, nullable only for detach;
- fixed phase `after-frame-maintenance`;
- explicit reason.

The phase is intentional: if a physics frame rebases on tick T and an entity migrates on tick T, frame maintenance is resolved first. The membership event must therefore name the **post-maintenance epoch** for every referenced source/target frame. Replay does not infer ordering from producer arrays or backend internals.

Same-frame epoch changes are rejected as membership events because they belong to the separate physics-frame maintenance contract. Multiple membership changes for one entity on one tick are rejected as ambiguous rather than assigning hidden array-order semantics.

## Adversarial regression set

`engine/world/test_physics_membership_contract.mjs` covers 10 cases:

1. attach binds the post-maintenance target epoch;
2. migration across two frames succeeds using explicit post-maintenance epochs;
3. detach removes local physics ownership;
4. a pre-maintenance epoch is rejected after same-tick rebase;
5. stale entity membership is rejected;
6. same-frame epoch changes cannot masquerade as membership migration;
7. serialization is stable and render-origin/presentation leakage fails closed;
8. independent entity events canonicalize independent of producer order;
9. multiple same-tick changes for one entity fail closed as ambiguous;
10. foreign authoritative world-frame identity is rejected even when frame names/epochs otherwise look valid.

Strict structural companion: `engine/world/schemas/physics-frame-membership-event-v0.1.schema.json`.

## Contract implication

Physics-frame ownership is derived simulation/replay state, not authoritative geography and not renderer state. Authoritative entity position remains in the world frame. A physics adapter may derive local coordinates only after an entity is bound to an exact `(physicsFrameId, epoch)`; stale ownership must never reinterpret local numbers under a new epoch.

This closes one hidden ordering assumption but deliberately leaves island split/merge and cross-frame constraints open. If one constraint references bodies owned by different frames, or an island split/merge changes ownership for many entities, that transition needs its own explicit deterministic lifecycle semantics rather than being inferred from backend island IDs.

## Claim calibration

Evidence class for this change is structural/synthetic until hosted CI executes the new regression. Do not call the gate PASS merely because the files exist. No production coordinate/physics decision is added to `docs/04-decisions.md`.
