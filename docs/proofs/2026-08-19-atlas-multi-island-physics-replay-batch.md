# 2026-08-19 — ATLAS multi-island physics replay batch contract

## Scope

This proof advances `P0-COORDINATES-01` at the simulation/replay boundary. Earlier ATLAS evidence showed that a physics-local origin/epoch maintenance schedule can affect later solver state even when the maintenance translation is not physical movement. The next hidden assumption was ordering: if multiple independent physics frames/islands advance origin epochs on the same simulation tick, an unversioned array order must not become accidental replay semantics.

This change therefore defines a **candidate replay batch contract**, not a physics-engine or whole-Norway policy.

## Candidate contract

`nwe.physics-frame-maintenance-batch/0.1-candidate` contains:

- one non-negative simulation `tick`;
- one authoritative `worldFrameId`;
- one or more embedded `nwe.physics-frame-maintenance-event/0.1-candidate` events.

All events in a batch must have the same tick and authoritative world frame. Events are canonicalized by `physicsFrameId`, then `fromEpoch`/`toEpoch`; textual comparison is explicit rather than locale-dependent. Multiple transitions for one physics frame in one tick are allowed only when they form a consecutive epoch chain. Duplicate transitions and gaps fail closed.

Applying a batch requires the caller to provide the current frame state for every referenced physics frame. Current-frame array order is not semantically meaningful; the result is canonicalized by `physicsFrameId`. Missing/duplicate current frames, stale epochs, foreign world frames, tampered event deltas and presentation/render-origin leakage fail closed through the batch/event boundary.

## Why this boundary exists

`RenderOrigin` remains disposable presentation state. A physics frame is different: prior Rapier/WASM evidence showed that changing the physics-local maintenance schedule can change later contact-rich solver results. If deterministic replay needs those maintenance events, their **identity, tick, per-frame epoch chain and canonical cross-island representation** must be explicit rather than inferred from renderer state or producer array order.

The batch does not make physics-local coordinates or backend snapshots authoritative. It only makes maintenance input replayable without hidden ordering assumptions.

## Adversarial regression set

`engine/world/test_physics_frame_batch_contract.mjs` covers 11 cases:

1. same-tick island events serialize to identical bytes regardless of input permutation;
2. deserialize/reserialize preserves canonical bytes and event order;
3. applying the same batch is independent of current-frame input order;
4. multiple same-island transitions in one tick canonicalize and apply only as a consecutive chain;
5. duplicate frame transitions fail closed;
6. epoch gaps within a same-tick island chain fail closed;
7. mixed event ticks fail closed;
8. mixed authoritative world frames fail closed even when numeric projected coordinates look compatible;
9. replay without the referenced current frame fails closed;
10. embedded presentation/render-origin fields fail closed;
11. duplicate current-frame identities fail closed.

A strict JSON Schema companion lives at `engine/world/schemas/physics-frame-maintenance-batch-v0.1.schema.json`.

## Claim calibration

This proves only a deterministic **representation/application contract** for candidate multi-island maintenance replay under synthetic Node regressions. It does not prove that independent physics islands never interact, that a particular physics engine should expose islands this way, or that same-tick rebase ordering is physically irrelevant when bodies/constraints can migrate between islands. Such migration/interaction must become a separate explicit simulation event/boundary if introduced.

Still OPEN:

- whole-Norway CRS/indexing strategy;
- render-origin anchor and shift threshold;
- physics engine/precision/island extent/rebase threshold/frequency;
- island split/merge/migration semantics;
- backend snapshot persistence policy;
- production network quantization/authority.

`docs/04-decisions.md` is intentionally unchanged.
