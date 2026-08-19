# 2026-08-19 — ATLAS Rapier contact-rich snapshot/replay epoch proof

## Scope

This proof advances `P0-COORDINATES-01` by testing replay and physics-frame epoch semantics in a contact-rich third-party physics runtime. It does **not** select Rapier, Float32 physics, a physics-island extent, rebase threshold/frequency, backend snapshot authority, whole-Norway CRS/index policy or render-origin policy.

The authoritative boundary remains unchanged: world coordinates are world truth; render-local and physics-local coordinates are derived state. Horizontal CRS (`EPSG:25832` in this Nannestad experiment) and vertical datum (`NN2000`) remain explicit and separate.

## Workload

`prototypes/atlas-rapier-physics/rapier_contact_replay_probe.mjs` uses the pinned `@dimforge/rapier3d-compat@0.19.3` WASM candidate with:

- six stacked dynamic boxes plus one moving/rotating sphere;
- a fixed floor with friction/contact;
- sleeping enabled;
- 720 settle steps at 60 Hz before checkpoint;
- a full Rapier world snapshot;
- 720 continuation steps with the same wake impulse 90 steps after the checkpoint;
- a same-checkpoint/same-schedule replay control;
- a second restore with a translation-only physics-frame rebase of `(+1000.125 m east, -750.375 m north)` and epoch `0 -> 1` before the identical continuation input.

The complete scene, including the fixed floor, is translated in backend-local space for the rebase. The frame change is non-physical and render-origin state is never consumed.

## Hosted evidence

Exact branch code head `8d7a5cb2a0b53e50f6cf8ff471709a0e97de6e9e`:

- GitHub Actions `atlas-rapier-physics` run `32201982227` / #14: **SUCCESS**;
- uploaded artifact `atlas-rapier-evidence`, artifact id `9347828173`, zip SHA-256 `1d75c77a22177a668b53dcf8995db57b238c269029c098fc3372d4806c06e3f0`;
- seven dynamic bodies were sleeping at the checkpoint.

### Same-schedule restore/replay control

- max reconstructed world-position drift: **0 m**;
- max world-axis velocity drift: **0 m/s**;
- max quaternion angular drift: **0 rad**;
- sleeping-state mismatches: **0**;
- final backend snapshot SHA-256 on the original continuation and restored replay: identical `9483200c9e62bab525471cea022ca4de8ce6e90c49bfe6d2d9223a80daf9ab26`.

This control matters: the runtime + snapshot path can reproduce the tested contact-rich continuation exactly when the frame schedule is unchanged.

### Translation-only physics epoch rebase

- physics epoch: **0 -> 1**;
- sleeping bodies before/after the rebase itself: **7 -> 7**;
- max final reconstructed world-position drift vs fixed control: **0.021881424242844096 m** (~21.88 mm);
- max final world-axis velocity drift: **0.0010730946684231885 m/s** (~1.07 mm/s);
- max final rotation drift: **0.008014583844705363 rad** (~0.459 degrees);
- sleeping-state mismatches at the end: **0**;
- final backend snapshot differs from fixed control (`c73f7da9...` vs `9483200c...`).

## Measurement correction discovered during the run

The first version of the quaternion comparison used the raw quaternion dot product without dividing by quaternion norms. That incorrectly reported a small angular difference even when the final backend snapshots were byte-identical. The metric was corrected to normalize both quaternions before `acos`; the exact same-schedule replay then measured zero rotation drift, consistent with the identical snapshot hash.

This correction is part of the evidence: claims below use the normalized metric from run #14, not the earlier failed run.

## What this proves

**FACT:** the tested Rapier snapshot/restore path is exactly repeatable for the contact-rich same-schedule control in this hosted Node/WASM environment.

**FACT:** a translation-only physics-frame epoch change can alter later integrated physics state even though it preserves sleeping state at the instant of rebase and represents no physical movement. After identical continuation input the rebase candidate diverged in position, velocity and orientation.

**FACT:** this is not renderer-origin leakage. The experiment has no dependency on `RenderOrigin`; the divergence is within physics-local frame maintenance and solver evolution.

**INFERENCE:** deterministic simulation/replay cannot treat physics-frame rebasing as invisible presentation metadata. If production physics results must be replayable, the chosen architecture must either make frame-maintenance events explicit deterministic simulation inputs, rebuild backend state from authoritative world state at defined boundaries, use an engine-supported invariant origin-shift mechanism proven for the selected backend, or provide another measured mitigation. This experiment does not select which approach is correct.

## Contract implication

- backend-local transforms remain **non-authoritative**;
- backend snapshot bytes are **not** NWE world-state authority merely because the runtime can snapshot them;
- a physics frame must retain independent `physicsFrameId` + epoch and cannot inherit renderer-origin identity;
- if replay resumes from backend-local state, the physics-frame identity/epoch and any frame-maintenance events required to interpret that state must be known;
- authoritative snapshots should remain world-frame based until a stronger, measured backend-specific persistence policy is selected.

## Still open

- physics engine and precision;
- physics rebase mechanism, threshold and frequency;
- physics-island extent and partitioning;
- backend snapshot/persistence policy;
- browser/device/Android behavior;
- multiplayer/network reconciliation interaction;
- whole-Norway horizontal coordinate/index strategy;
- render-origin threshold.

`docs/04-decisions.md` therefore remains unchanged.

## Next gate

Make physics-frame maintenance a concrete versioned replay event contract (`tick`, frame identity, from/to epoch, authoritative world-space delta) and adversarially test serialization/replay ordering, stale epochs and multiple islands. Then reproduce the most informative contact-rich case in browser/device WASM before proposing a production physics policy.
