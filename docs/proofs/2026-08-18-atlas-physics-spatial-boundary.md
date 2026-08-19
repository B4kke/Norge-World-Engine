# 2026-08-18 — ATLAS candidate physics/simulation spatial boundary

## Scope

This proof advances `P0-COORDINATES-01` from explicit world↔tile↔render and network boundaries to a physics/simulation-facing spatial contract. It does **not** select a physics engine, physics precision, integrator, island size, rebase threshold, whole-Norway CRS/index or networking policy.

The authority rule remains: authoritative world coordinates are world truth. Render-local and physics-local coordinates are disposable derived state.

## Candidate interface

`engine/world/physics_state_contract.mjs` adds:

- `PhysicsSpatialFrame`: independent `physicsFrameId`, monotonic epoch and high-precision world anchor;
- `worldEntityToPhysicsBody()` / `physicsBodyToWorldEntity()`: Float64 local positions tied to one exact physics frame/epoch;
- world-axis velocity in metres/second, so translation rebases cannot create false velocity;
- `rebasePhysicsSpatialFrame()` + `reframePhysicsBody()`: reconstruct world position through the old frame before deriving the new physics-local position;
- deterministic `nwe.simulation-spatial-snapshot/0.1-candidate` serialization of world position + velocity only;
- strict deserialization that reconstructs an explicit `WorldFrame` with horizontal CRS and vertical datum kept separate.

The simulation snapshot deliberately excludes `RenderOrigin`, `originEpoch`, `PhysicsSpatialFrame`, physics epoch and physics-local coordinates. A checkpoint/replay is therefore not coupled to whichever disposable local frame happened to be active when it was produced.

## Adversarial coverage

The 8-case regression exercises:

1. reconstruction at large projected absolute coordinates through Float64 physics-local state;
2. invariance through 1,000 unrelated render-origin shifts;
3. physics-frame rebase exactly in the middle of a tick versus fixed-frame integration;
4. fail-closed stale physics epoch handling;
5. an entity crossing the physics anchor without physical discontinuity;
6. byte-identical authoritative simulation snapshots across different physics-rebase schedules;
7. snapshot/replay resumed under a different physics anchor/epoch with the same resulting world state;
8. rejection of a foreign world frame.

## Validation state

Before publication, the new module and regression were syntax-checked with Node and the schema parsed with Python `json.tool` in an isolated workspace. Repository-integrated GitHub Actions is the authoritative execution gate because the regression imports the real `engine/world/world_contract.mjs` and runs beside the existing world/network suites.

Exact-head hosted CI result is recorded in PR #33 once the branch head completes baseline.

## What this can prove when CI is green

- Physics-local frame identity/epoch can be explicit and independent from render-origin identity/epoch.
- A translation-only physics rebase does not need to alter authoritative position or velocity.
- Local physics bodies from a stale epoch can be rejected rather than silently reinterpreted.
- Authoritative simulation checkpoint identity can be independent from both render-origin and physics-local rebase schedules.

## What this does not prove

- No actual third-party physics engine is integrated.
- No Float32-vs-Float64 physics precision policy is selected.
- No collision broadphase/island extent, rebase threshold or rebase frequency is selected.
- The constant-velocity integration used by the structural regression is only a deterministic contract probe, not a production simulation integrator.
- No Android/device performance or numerical-stability benchmark exists for an actual physics engine.
- EPSG:25832 + NN2000 remains the Nannestad prototype instantiation rather than whole-Norway policy.

## Next gate

Use this adapter boundary with one real physics candidate or a deterministic collision/rigid-body prototype and measure numerical error, rebase behavior and CPU cost at representative entity counts/ranges. Keep render-origin independent and do not select a physics threshold from the structural Node regression alone.
