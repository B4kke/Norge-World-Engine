# 2026-08-19 — ATLAS physics split/merge and constraint topology candidate

## Scope

This advances `P0-COORDINATES-01` at the simulation boundary. Existing ATLAS work makes physics-frame maintenance, same-tick frame batches and entity membership explicit. The remaining hidden assumption was what happens when one physics frame splits, several frames merge, or an active constraint would connect bodies owned by different frames.

This change defines a candidate fail-closed topology transition. It does not select a physics engine, island implementation, whole-Norway coordinate policy, precision, island extent or rebase threshold.

## Candidate contract

`nwe.physics-frame-topology-transition/0.1-candidate` carries one simulation tick, authoritative `worldFrameId`, stable `transitionId`, exact entity source/target `(physicsFrameId, epoch)` assignments, the active constraint graph in scope and a reason.

The transition kind is derived from the exact source/target frame sets rather than trusted from a producer: one source to many targets is `split`, many sources to one target is `merge`, otherwise `repartition`.

The candidate phase is `after-frame-maintenance`: all referenced frame epochs must match the post-maintenance current frames. The transition then validates the complete supplied membership scope. Backend island IDs are deliberately absent; backend island decomposition is not world truth.

## Constraint invariant

For this candidate, every active constraint endpoint in the transition scope must end in the same exact `(physicsFrameId, epoch)`. A split that cuts a constrained pair or connected chain across frames fails with `CROSS_FRAME_CONSTRAINT`. A constrained group may co-migrate or be merged into one frame.

This is intentionally stricter than pretending a backend can maintain arbitrary cross-origin constraints. A future architecture may support an explicit cross-frame constraint bridge, but that would need its own coordinate/solver contract and evidence. Until then, silently letting a joint span local coordinate frames is rejected.

## Adversarial regression set

`engine/world/test_physics_topology_contract.mjs` covers 12 cases:

1. one-frame to two-frame split applies;
2. two-frame to one-frame merge applies;
3. a live constraint spanning targets fails closed;
4. constrained bodies co-migrating to the same frame succeed;
5. a connected A-B-C chain cannot be split while B-C remains active;
6. stale source membership fails closed;
7. stale target epoch after maintenance fails closed;
8. duplicate entity assignments cannot inherit producer order;
9. constraint endpoints outside the exact scope fail closed;
10. backend island ID and render-origin leakage are rejected structurally;
11. entity/constraint producer order and endpoint order serialize identically;
12. forged transition kind and foreign world-frame identity are rejected.

Strict structural companion: `engine/world/schemas/physics-frame-topology-transition-v0.1.schema.json`.

## Hosted validation

Exact code head `9c4f180f49ea633d697a814d4e56262acddf3440`:

- `atlas-rapier-physics` run `32212619882` / #37: **SUCCESS**;
- syntax checks for the topology contract/test and JSON parse of the strict schema: **SUCCESS**;
- `Run physics split-merge topology regressions`: **SUCCESS**, output `PASS (12 adversarial cases)`;
- existing maintenance-event, maintenance-batch, membership and Rapier contact/rebase probes remained green in the same job;
- repository `baseline` run `32212619835` / #1253: **SUCCESS**, preserving the broader compiler/provenance/streaming/viewer/contract baseline after sync with current `main`.

## Contract implication

Physics-frame topology is simulation/replay representation state, not geographic world truth. Authoritative entity positions remain in the world frame. Frame maintenance runs first; topology/membership transitions then reference exact current epochs. A constraint graph may restrict legal frame repartitioning, so split/merge cannot be inferred later from renderer transforms or backend island IDs.

## Claim calibration

The topology contract is now hosted structural/synthetic evidence. It proves the candidate invariants execute deterministically and fail closed under the covered adversarial cases. It does **not** prove that same-frame-only constraints are the final architecture, that a specific physics backend preserves solver state through split/merge, or that any whole-Norway/physics threshold is selected. No entry is added to `docs/04-decisions.md`.

## Next

Use this topology boundary to drive a real contact/constraint runtime experiment: checkpoint a constrained multi-body system, apply a legal co-migration/merge versus a forbidden cross-frame split, and verify replay/world-state behavior without persisting backend island IDs as authority.
