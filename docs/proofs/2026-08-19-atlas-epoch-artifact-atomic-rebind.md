# ATLAS proof — atomic physics-epoch + terrain-artifact rebind

Date: 2026-08-19  
Gate: `P0-COORDINATES-01`  
Role: ATLAS  
Evidence class: structural/adversarial contract + hosted Node/Rapier-WASM candidate

## Question

When a physics-frame epoch changes on the same simulation tick that an in-use static terrain collision artifact is replaced, can NWE define one fail-closed preflight boundary so that stale artifact identity, lost solver occupancy, render-origin leakage or stale frame state cannot partially mutate solver/lifecycle state?

This is a simulation/world-contract question. It does not select a physics backend, rebase threshold, collider format, residency budget or whole-Norway coordinate policy.

## Candidate boundary

`nwe.static-collision-epoch-rebind/0.1-candidate` composes the existing physics-frame maintenance event with an exact in-use static-collision replacement.

The preflight requires:

- the authoritative `worldFrameId` to match current physics and collision lifecycle state;
- one exact pre-maintenance `(physicsFrameId, epoch)`;
- maintenance and replacement to share the same simulation tick;
- an exact resident `collisionId` / runtime `tileId`;
- exact previous and replacement artifact SHA-256 identities;
- `continuity: atomic-rebind`;
- the current solver-derived `dependentEntityIds` to survive unchanged through the planned replacement;
- no renderer/presentation fields.

Only after the entire plan validates does it return a post-maintenance physics frame, post-maintenance collision lifecycle state, and the translation required to re-express solver-local state. Zero components are canonicalized to positive zero so a derived transform cannot acquire serialization-visible `-0` drift.

The contract keeps horizontal CRS and vertical datum separate through the canonical world-frame constructor. The hosted probe uses Prototype-0 `EPSG:25832` horizontally and `NN2000` vertically; that remains local evidence, not a Norway-wide choice.

## Adversarial regressions

`test_static_collision_epoch_rebind_contract.mjs` covers 8 cases. It accepts the exact atomic transition and fails closed on:

- missing atomic continuity;
- incorrect previous artifact identity;
- dropped/current occupancy mismatch;
- tick mismatch;
- foreign world frame;
- renderer-origin leakage;
- stale lifecycle/physics epoch.

The focused hosted run reports `static collision epoch rebind regressions: PASS (8 cases)`.

## Rapier/WASM probe

`rapier_epoch_artifact_rebind_probe.mjs` uses `@dimforge/rapier3d-compat@0.19.3` with a dynamic body in contact with static collision. At tick 30 the candidate transaction combines:

- physics frame epoch `0 -> 1`;
- anchor delta `+1000 m east / -750 m north / 0 m up`;
- in-use terrain artifact replacement `aaaa... -> bbbb...`;
- preserved dependency `entity:body`.

Before the accepted transaction, the probe deliberately supplies the wrong previous artifact SHA. Preflight rejects it as `PREVIOUS_ARTIFACT_MISMATCH`, and the body's solver translation before/after the rejected plan is exactly unchanged. The valid plan then produces solver-local translation `(-1000, 0, +750)`, advances collision lifecycle to epoch 1, installs the replacement artifact identity and preserves the active dependency before simulation continues.

Exact implementation head `8f77737381f828195d20e7e568b640a715b19609` passed focused `atlas-rapier-physics` run #87 / `32243553705`, including all prior ATLAS physics/collision gates and the new same-tick probe. Evidence artifact id `9361717627`, ZIP SHA-256 `6013f3c349bf7005b5b5efbb7a1d0e751948c45df2cebbd69c9ac332e4a1b8c9`.

Two earlier red runs were intentionally not promoted as evidence. The first exposed a malformed test world-frame fixture that bypassed the canonical constructor; the second exposed JavaScript signed-zero in the derived translation. Both were fixed, and the successful run above is the accepted evidence.

## What this proves

For this contract and hosted Rapier/WASM workload, NWE can preflight a same-tick physics-frame maintenance + in-use terrain-artifact replacement as one explicit operation before solver mutation. Invalid previous artifact identity leaves the observed solver state unchanged, while the accepted path advances frame epoch and collision artifact identity together without dropping the active dependency.

This further separates authority:

- world/tile placement and artifact identity are authoritative inputs;
- physics epoch/maintenance and collision lifecycle are explicit simulation/replay state;
- physics-local translations/collider poses are derived;
- render-local state and renderer transform trees have no authority here.

## Claim calibration

This does **not** yet prove:

- integration with STRØM's actual artifact-replacement/materialization path;
- rollback after a backend mutation itself fails halfway through;
- contact-manifold continuity for real DTM terrain meshes;
- browser/device behavior;
- a production Rapier choice;
- physics precision/island/rebase policy;
- collider representation or residency budget;
- a whole-Norway coordinate/index policy.

`docs/04-decisions.md` remains unchanged.

## Next

Wire this preflight into the actual STRØM terrain replacement/materialization path while a body crosses adjacent terrain tiles. The critical adversarial case is replacement failure after scheduler admission but before the next physics step: scheduler payload, lifecycle identity and solver collision must either all commit together or all remain on the previous verified artifact. Only then should this boundary be treated as a runtime transaction rather than a candidate world-model contract.
