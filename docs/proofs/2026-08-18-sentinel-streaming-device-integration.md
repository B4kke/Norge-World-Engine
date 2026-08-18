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

`deviceEvidenceEntry.mjs` enables the movement probe for the device-evidence route. It also exposes a same-origin, opt-in `report=` hook used only by browser proof automation so CI opens the exact route a real handset uses rather than merely proving the bundle exists. `deviceEvidence.mjs` embeds the movement probe + trace in the downloaded evidence JSON and compares a stable streaming contract across backend captures. Dynamic trace timestamps and probe duration are deliberately excluded from WebGL2/WebGPU comparability.

`run_device_evidence_browser_smoke.mjs` serves the built Vite app locally, opens `/device-evidence.html` in Chrome, receives the final evidence through that same-origin report hook and fails unless the accepted exact Nannestad artifacts, provenance, request count, scheduler transition sequence and no-refetch cache return all hold.

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

The exact-real browser smoke additionally requires:

- accepted tile `epsg25832_611000_6677000_1000m`;
- accepted terrain/road/building artifact SHAs;
- all three layers `RUNTIME_VERIFICATION_PASS`;
- WebGL2 active backend;
- exactly 7 world/runtime requests and 0 raw-source calls;
- movement `center -> outside-active-inside-retain -> center`;
- resolver calls `1 -> 1`, load-start delta `0`, cache-hit delta `1`;
- no trace entry loss;
- snapshots `initial-resident`, `outside-active-inside-retain`, `returned-center`;
- scheduler event sequence containing exactly one load start and a deactivate/reactivate cache round-trip.

## Exact-head evidence

Branch head: `fe226120a0c9f0c975e9112427ccfbc1a3b28c7a`. GitHub evaluated PR merge composition `2e426fc7242a23161530ac81a3176d3596f88e79` against exact STRØM #32 base.

All three primary gates passed:

- baseline run `32189735266` — **PASS**;
- viewer-benchmark run `32189735315` — **PASS**;
- world-viewer-vite run `32189735245` — **PASS**.

The Vite job executed `device evidence regressions: PASS`, built the device route, ran exact accepted-artifact Preview 1 WebGL2, then executed the new exact-real device-evidence movement/cache smoke in Chrome 151.

Exact-real smoke result:

- schema `nwe.device-evidence-browser-smoke-proof/0.1` — **PASS**;
- accepted terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- accepted roads SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- accepted buildings SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`;
- terrain/roads/buildings all `RUNTIME_VERIFICATION_PASS`;
- runtime requests: **7**;
- raw-source runtime calls: **0**;
- movement offset: **1000 m east**;
- active/retain radii: **800 / 1200 m**;
- resolver calls: **1 -> 1**;
- load-start delta during movement: **0**;
- cache-hit delta: **1**;
- retained trace entries: **9**;
- dropped trace entries: **0**;
- snapshots: `initial-resident`, `outside-active-inside-retain`, `returned-center`;
- scheduler events: `load-started`, `load-completed`, `tile-activated`, `tile-deactivated`, `tile-activated`;
- renderer backend: WebGL2, 4 draw calls/frame;
- `renderer_resource_lifecycle_observed=false`.

The uploaded smoke evidence ZIP SHA-256 is `8cd86866f632d6f192f23ba14e20fac15d7a95c6c239745ad9e7f3ef110249b6`.

Hosted WebGPU remained unavailable in the separate A/B runner, so no WebGPU/WebGL2 performance comparison is claimed.

## Acceptance classification

**PASS — exact-real single-tile verified runtime/cache movement is now proven through the same device-evidence application route.** The previous separation between STRØM lifecycle/loader observations and LUMEN browser evidence is closed for this single-tile cache round-trip.

**Still open:** physical Android Chrome timings; renderer GPU resource unload/reload; real neighbor-tile transitions; 2×2/3×3 streaming; worker-pool/LOD/hard memory policy. Multi-tile terrain remains correctly blocked by DTM1 seam authority.
