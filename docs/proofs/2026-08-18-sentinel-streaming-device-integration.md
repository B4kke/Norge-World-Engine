# SENTINEL — exact-real streaming trace ↔ device evidence integration

Date: 2026-08-18  
Role: SENTINEL — Integration & QA  
Gate: `P0-STREAMING-01` / `P0-VIEWER-01`

## Dependencies

This integration branch is based on exact STRØM PR #32 head `c3d2386d836c60faa720140e8a312fda8ddce287` and imports the exact LUMEN device-evidence/capture-session implementation blobs from PR #30 head `b8af4565aa50a537bbbcde8cee701015ac2d86fb` before adding the cross-agent adapter.

It must not be merged independently of those parent changes. The branch exists to prove that their contracts compose on the same exact-real Preview 1 path.

## Problem

STRØM had a bounded renderer-neutral `nwe.streaming-movement-trace/0.1`, and LUMEN had a comparable same-session WebGL2/WebGPU device evidence format. The deployable Nannestad device-evidence route did not yet connect them.

That meant a phone capture could report renderer frame/resource metrics while scheduler lifecycle, terrain verification/decode/worker timing, cache re-entry and refetch behavior remained a separate evidence stream.

## Implementation

`apps/world-viewer/src/preview1.ts` now:

- wraps the existing exact terrain load function with STRØM `createObservedTerrainTileLoadFunction()`;
- sends scheduler events and terrain-load observations into one bounded `createStreamingTraceRecorder({ maxEntries: 256 })`;
- captures the initial resident scheduler snapshot;
- keeps normal Preview 1 startup behavior unchanged unless `streamingMovementProbe=true`;
- after the first renderer frame, an enabled probe moves the runtime camera exactly 1000 m east — outside the 800 m active radius but inside the 1200 m retain radius — and then returns to center;
- requires `resident -> cached -> resident`, exactly one cache hit, zero additional load starts and zero resolver refetches;
- exports the movement probe and full bounded trace into the Preview runtime result;
- fails closed if any trace entries were dropped.

Running the movement probe **after first-frame-ready** preserves the original input→first-frame measurement boundary.

`deviceEvidenceEntry.mjs` enables the movement probe for the device-evidence route. `deviceEvidence.mjs` embeds the movement probe + trace in the downloaded evidence JSON and compares a stable streaming contract across backend captures. Dynamic trace timestamps and probe duration are deliberately excluded from WebGL2/WebGPU comparability.

## Critical claim boundary

This is a real verified single-tile runtime/cache movement probe. It is **not** a renderer resource streaming probe yet.

The renderer is created before the movement probe and keeps its already-created terrain GPU resource. Therefore every movement record explicitly carries:

`renderer_resource_lifecycle_observed: false`

Device evidence rejects an ambiguous `true` value. A future renderer-resource lifecycle integration must be a separate measurable change.

## Fail-closed cases

The device-evidence regression now requires rejection of:

- dropped streaming trace entries;
- a movement result without its trace;
- ambiguous/incorrect renderer-resource-lifecycle attribution;
- changed streaming probe contract between renderer captures;
- all existing raw-source, provenance, device-target, capture-session, build, camera, surface and measurement-window mismatches.

## Acceptance gate

Pending exact-head GitHub Actions. Required before this integration can be considered proven:

1. repository baseline PASS;
2. world-viewer Vite build/regressions PASS;
3. real Preview 1 compile/verify/browser gate PASS;
4. device-evidence route executes against the accepted Nannestad terrain artifact with zero raw source calls;
5. movement probe reports one cache hit, zero refetch/load delta and `droppedEntries=0`.

Physical Android Chrome performance remains unproven until an operator-controlled handset runs the exact deployed commit. Whole-Norway/multi-tile terrain remains separately blocked by the DTM1 seam-authority gate.
