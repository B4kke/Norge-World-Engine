# ATLAS proof — terrain replacement coordinator

**Date:** 2026-08-19  
**Gate:** `P0-COORDINATES-01`  
**Role:** ATLAS  
**Evidence class:** structural/adversarial Node contract; not a renderer/device/backend-policy decision.

## Question

The previous epoch/artifact proof established fail-closed world/physics/collision preflight, but it did not provide one publication boundary for the three runtime participants that must agree when an in-use terrain artifact changes: solver collision, STRØM-retained payload identity and ATLAS collision lifecycle state.

Inspection of the current `TileStreamingScheduler` shows load/activate/deactivate/evict callbacks, but no explicit in-place replacement commit for an already retained/resident tile. Therefore this run does not claim that scheduler replacement is solved. Instead it introduces the narrow transaction interface STRØM can implement without making renderer/cache state world truth.

## Candidate interface

`createTerrainReplacementCoordinator()` composes the existing `planStaticCollisionEpochRebind()` preflight with three rollback-capable participants:

1. `solverCollisionParticipant`
2. `streamingPayloadParticipant`
3. `lifecycleParticipant`

The replacement artifact is materialized first and must match the exact runtime `tileId` and SHA-256 named by the authoritative replacement transaction. The existing epoch/artifact preflight then validates world frame, tick, pre-maintenance physics epoch, exact previous artifact identity and solver-derived dependency continuity before any participant may publish.

Each participant has a strict two-phase interface: `prepare(context)` returns `{ commit(), rollback() }`. All participants prepare before any commit. Commits execute in fixed order `solver -> streaming -> lifecycle`. A prepare failure rolls back previously staged participants. A mid-commit failure triggers reverse rollback and reports `COMMIT_FAILED_ROLLED_BACK` rather than silently accepting split-brain state.

Render origin, renderer transform trees and presentation state are absent from the interface. Horizontal CRS and vertical datum continue to come from the canonical world frame used by the existing preflight; the fixture uses Prototype-0 EPSG:25832 + NN2000 only as local test context.

## Adversarial regressions

`test_terrain_replacement_coordinator.mjs` covers six cases:

- successful ordered three-participant commit;
- materialized artifact SHA mismatch rejected before participant prepare;
- stale/incorrect previous authoritative artifact rejected before participant prepare;
- prepare failure rolls back earlier staged work without publishing;
- streaming commit failure after solver commit restores all participant state to the previous artifact/epoch in the test harness;
- render-origin leakage remains fail-closed through the underlying world preflight.

Exact head `0a43ab8b42278575b5ccbf02b3d3e493f40d1f9a` passed focused workflow `atlas-terrain-replacement` run #1 / `32248104649` with conclusion **SUCCESS**.

The branch was first synchronized without force to `main` `59a3d89cfcad52939bc88eaafcd7e7d8c2aea8fa` using two-parent merge commit `258f08e1b175107905eb0773dceb3c0341861dfa`; the four incoming STRØM starvation/fairness files were preserved unchanged. GitHub compare reports `behind_by: 0` after the implementation head.

## What this proves

NWE now has a concrete candidate transaction boundary that can prevent publication of a terrain replacement until exact world/physics/artifact preflight and all three runtime participants are prepared. It also demonstrates rollback semantics for an adversarial mid-commit failure in the deterministic test harness.

This strengthens, rather than weakens, the authority split:

- world/tile placement and artifact identity remain authoritative inputs;
- physics frame epoch and collision lifecycle remain explicit simulation/replay state;
- solver-local transforms and streaming payload residency remain derived/runtime state;
- renderer-local Float32 and renderer transform state remain disposable presentation state.

## Claim calibration

This does **not** yet prove:

- that the current STRØM `TileStreamingScheduler` implements the new `streamingPayloadParticipant` contract;
- rollback of a real physics backend after an irreversible partial mutation;
- continuity of real DTM terrain contacts during replacement;
- browser/device behavior;
- a production physics backend, precision, island extent or rebase threshold;
- collider representation/residency budgets;
- a whole-Norway coordinate or indexing policy.

`docs/04-decisions.md` remains unchanged.

## Next

The next cross-agent step is narrow and concrete: STRØM should expose a retained/resident payload replacement participant that stages the verified next payload and publishes the record/byte-accounting swap only in `commit()`, with `rollback()` restoring the exact previous payload and accounting. ATLAS can then bind that real participant to this coordinator and rerun the same failure cases with actual scheduler state before claiming terrain replacement atomicity.
