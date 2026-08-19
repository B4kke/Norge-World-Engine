# 2026-08-19 — ATLAS Rapier physics-frame rebase experiment

## Scope

This experiment advances `P0-COORDINATES-01` by running the candidate world/physics boundary against one real third-party physics runtime instead of another handwritten integrator. It is an adversarial sensor, not a physics-engine selection.

The package is pinned only inside `prototypes/atlas-rapier-physics/` as `@dimforge/rapier3d-compat@0.19.3`. The engine-facing world contract remains library-independent.

## Question

Can the same authoritative world state and physical setup produce materially different reconstructed world state when the physics-local frame is translated during a run, even though a frame rebase is not physical motion? If so, does keeping the local anchor nearer the moving body reduce that divergence?

## Coordinate contract under test

- authoritative world position: Float64 JavaScript numbers in an explicit `WorldFrame`;
- horizontal frame: `EPSG:25832` for this Nannestad-scale experiment only;
- vertical datum: `NN2000`, explicitly separate from horizontal CRS;
- physics frame: independent `PhysicsSpatialFrame` with its own id + epoch + Float64 world anchor;
- Rapier mapping: world `(easting, northing, height)` -> Rapier `(x, z, y)` relative to the current physics anchor, preserving Y-up physics convention without changing world axis semantics;
- render origin is not read or written by the experiment;
- physics-local state is reconstructed back through the old authoritative world frame before a new local frame is derived.

## Workload

`prototypes/atlas-rapier-physics/rapier_rebase_probe.mjs` runs three candidates for 3,600 steps at 60 Hz:

1. fixed physics frame;
2. three near-body translation-only rebases, with anchors chosen close to the expected moving-body position;
3. three deliberately far-anchor rebases, producing a larger local horizontal extent as an adversarial control.

All candidates use one dynamic sphere, a fixed horizontal collision plane/cuboid, gravity, CCD and the same initial world velocity. Each reports final reconstructed world position/velocity, maximum horizontal local extent, maximum speed, final ground clearance, elapsed hosted runtime and rebase round-trip error. The probe also repeats the existing absolute-vs-anchor-relative Float32 representation observation.

The assertions intentionally do **not** require trajectories to be identical. A difference is evidence to quantify, not a test failure. The test fails only on invalid/non-finite state, broken epoch/rebase accounting, implausible velocity, failure to finish near the collision surface, a near-body plan that fails to reduce local extent, or loss of the already-established relative-coordinate precision advantage.

## Hosted evidence

GitHub Actions `atlas-rapier-physics` run `32193295016` executed the code-bearing head `9d9dad4a8602f20ffcf930094a7f68048019ea40` on Node 22.23.2 / Ubuntu 24.04 and completed the probe step successfully with the exact pinned Rapier package.

Measured results:

- absolute projected Float32 representation error at the initial Nannestad-scale point: **0.012441756 m** (~12.44 mm);
- initial anchor-relative Float32 reconstruction error: **0.0000132512 m** (~0.0133 mm);
- fixed-frame maximum horizontal local extent: **867.57 m**;
- near-body-rebase maximum horizontal local extent: **547.76 m**;
- far-anchor adversarial maximum horizontal local extent: **2699.21 m**;
- near-body maximum immediate rebase round-trip error: **1.33e-7 m** (~0.000133 mm);
- far-anchor maximum immediate rebase round-trip error: **0.000123020 m** (~0.123 mm);
- fixed vs near-body final reconstructed world-position difference: **0.057343475 m** (~57.34 mm);
- fixed vs far-anchor final reconstructed world-position difference: **0.156211901 m** (~156.21 mm);
- both comparisons ended with **0 m/s** measured final velocity difference;
- all candidates ended near the same collision-plane height and stayed below **15.59 m/s** maximum speed.

Hosted elapsed times differed substantially between candidates, but a single shared GitHub runner invocation is not a valid performance benchmark; those values are intentionally not used as a policy input.

## What this proves

**FACT:** the real Rapier/WASM candidate is not automatically invariant to translation-only physics-frame maintenance in this workload. Reconstructed final world position differed despite identical authoritative initial state, physical constants and final velocity.

**FACT:** reducing local horizontal extent from the far-anchor case to the near-body case reduced the observed final divergence from ~156 mm to ~57 mm in this one run, while the immediate rebase round-trip itself remained sub-millimetric. The accumulated result therefore cannot be explained only by one large conversion error at the instant of rebase.

**INFERENCE, not policy:** Float32 physics integration error can accumulate differently under different local coordinate magnitudes/rebase schedules. A future adapter may need bounded physics-island extent, more frequent/body-following rebases, mixed/high-precision state reconstruction, engine-specific origin-shift support, or a different backend if replay/world-state invariance requirements demand tighter bounds. This experiment does not identify the correct mitigation.

The result also reinforces the authority boundary: Rapier-local transforms cannot become world truth, and render-origin state must remain unrelated to physics authority.

## Claim calibration

Still open:

- `physicsEnginePolicy`: **OPEN**
- `physicsPrecisionPolicy`: **OPEN**
- `physicsRebaseThresholdPolicy`: **OPEN**
- `physicsIslandExtentPolicy`: **OPEN**
- `wholeNorwayCoordinatePolicy`: **OPEN**
- `physicsLocalAuthority`: **false**
- `renderOriginAuthority`: **false**

Hosted Node/WASM is not browser, Android/device, multiplayer determinism, large-body-count, terrain-collision or whole-Norway acceptance evidence. `docs/04-decisions.md` therefore remains unchanged.

## Next acceptance step

Run a controlled extent matrix with the same backend rather than choosing a threshold from these three samples. Add rotations, sleeping/waking, stacked/contact-rich bodies and snapshot/replay around a rebase. Then reproduce the most informative cases in browser/device/WASM before proposing any physics precision, island extent or rebase threshold policy.
