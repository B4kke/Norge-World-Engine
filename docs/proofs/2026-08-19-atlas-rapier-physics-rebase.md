# 2026-08-19 — ATLAS Rapier physics-frame rebase experiment

## Scope

This experiment advances `P0-COORDINATES-01` by running the candidate world/physics boundary against one real third-party physics runtime instead of another handwritten integrator. It is an adversarial sensor, not a physics-engine selection.

The package is pinned only inside `prototypes/atlas-rapier-physics/` as `@dimforge/rapier3d-compat@0.19.3`. The engine-facing world contract remains library-independent.

## Question

Can the same authoritative world state and physical setup produce materially different reconstructed world state when the physics-local frame is translated three times during a run, even though a frame rebase is not physical motion?

## Coordinate contract under test

- authoritative world position: Float64 JavaScript numbers in an explicit `WorldFrame`;
- horizontal frame: `EPSG:25832` for this Nannestad-scale experiment only;
- vertical datum: `NN2000`, explicitly separate from horizontal CRS;
- physics frame: independent `PhysicsSpatialFrame` with its own id + epoch + Float64 world anchor;
- Rapier mapping: world `(easting, northing, height)` -> Rapier `(x, z, y)` relative to the current physics anchor, preserving Y-up physics convention without changing world axis semantics;
- render origin is not read or written by the experiment;
- physics-local state is reconstructed back through the old authoritative world frame before a new local frame is derived.

## Workload

`prototypes/atlas-rapier-physics/rapier_rebase_probe.mjs` runs two candidates:

1. fixed physics frame for 3,600 steps at 60 Hz;
2. identical initial state and physical configuration with three translation-only physics-frame rebases.

Both use one dynamic sphere, a fixed horizontal collision plane/cuboid, gravity, CCD and the same initial world velocity. Each candidate reports final reconstructed world position/velocity, maximum speed, final ground clearance, elapsed hosted runtime and rebase round-trip error. The probe also repeats the existing absolute-vs-anchor-relative Float32 representation observation.

The assertions intentionally do **not** require fixed and rebased trajectories to be identical. A difference is evidence to quantify, not a test failure. The test only fails on invalid/non-finite state, broken epoch/rebase accounting, implausible velocity, failure to finish near the collision surface, or loss of the already-established relative-coordinate precision advantage.

## Evidence state

Exact-head GitHub Actions runs are the execution authority because the current local tool container cannot fetch npm dependencies. The dedicated `atlas-rapier-physics` workflow installs the exact pinned package and emits machine-readable JSON. At publication of this initial proof revision, the exact-head run is pending; no numeric Rapier result is claimed until that run completes successfully.

## Claim calibration

Still open regardless of one hosted result:

- `physicsEnginePolicy`: **OPEN**
- `physicsPrecisionPolicy`: **OPEN**
- `physicsRebaseThresholdPolicy`: **OPEN**
- `physicsIslandExtentPolicy`: **OPEN**
- `wholeNorwayCoordinatePolicy`: **OPEN**
- `physicsLocalAuthority`: **false**
- `renderOriginAuthority`: **false**

Hosted Node/WASM is not browser, Android/device, multiplayer determinism, large-body-count, terrain-collision or whole-Norway acceptance evidence. `docs/04-decisions.md` therefore remains unchanged.

## Next acceptance step

If this probe exposes rebase-schedule drift, vary local extent/rebase schedules and reproduce in browser/device before designing mitigation. If it does not, increase adversarial workload complexity (contacts, rotations, stacked bodies, sleeping/waking) before considering the boundary robust.
