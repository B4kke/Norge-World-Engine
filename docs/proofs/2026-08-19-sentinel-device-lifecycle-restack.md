# SENTINEL — clean restack of PR #37/#41 device + terrain lifecycle

Date: 2026-08-19  
Role: SENTINEL — Integration & QA  
Gate: `P0-VIEWER-01` + `P0-STREAMING-01`

## Why this restack exists

Closed PRs #37 and #41 contained valuable exact-real browser/device-evidence and renderer terrain-resource lifecycle work, but their branches had diverged heavily from current `main`. Blindly merging that stack would also replace newer device-comparison safeguards already accepted on `main`.

This branch starts from current `main` and selectively ports the useful functionality without inheriting the old PR ancestry.

## Preserved current-main safeguards

- Runtime artifacts remain provenance-verified before renderer resource creation.
- Runtime raw-source access remains forbidden.
- `compareDeviceEvidenceContext` keeps the newer fail-closed backend rules: requested backend must equal active backend and a comparison must contain one genuine WebGL2 capture plus one genuine WebGPU capture.
- Renderer/backend selection remains open; this work is measurement infrastructure, not an architecture decision.

## Restored functionality

- Preview terrain lifecycle now drives `resident -> cached -> resident` against the exact accepted Nannestad terrain path.
- WebGL2 and WebGPU expose the same terrain resource adapter contract:
  - query current terrain resource state;
  - deactivate terrain buffers while verified CPU/runtime payload remains cached;
  - recreate terrain buffers from that retained verified payload on cache hit.
- The movement probe requires no runtime-input refetch, no new terrain load, exactly one scheduler cache hit, and renderer checkpoints `present -> absent -> present` for the same tile/artifact/backend.
- Resource evidence records create/destroy counts and CPU timing but keeps `physical_vram_release_observed=false`; browser/driver reclamation timing is not claimed.
- The device evidence entry binds capture session and build identity and supports same-origin report collection for automated browser smoke evidence.

## Integration with merged STRØM lifecycle validation

The Preview scheduler adapters are wrapped by `observeStreamingLifecycleAdapters`. Their observations are written into the same streaming trace as scheduler events, load observations and snapshots.

`buildDeviceEvidence` calls `validateRendererLifecycleMovementCapture` before a movement capture can become PASS. The validator requires a complete trace with exact scheduler-event <-> lifecycle-observation count correlation for activate/deactivate/dispose outcomes. Missing, malformed or mismatched lifecycle observations fail closed.

This means the restored renderer-resource checkpoints and the merged renderer-neutral lifecycle observer are complementary evidence rather than duplicate implementations.

## Regression gates

The viewer workflow requires:

- existing device-evidence comparator regressions, including fallback/backend-pair rejection;
- new lifecycle evidence negative regressions;
- Vite production build including `device-evidence.html`;
- exact accepted Preview renderer benchmark;
- exact-real headless Chrome movement/cache/resource lifecycle smoke;
- existing synthetic DedicatedWorker structural gate.

## Exact-real hosted Chrome evidence

PR #44 `world-viewer-vite` run `32202573843` completed successfully. The pull-request workflow was associated with branch head `41b578e5adf5e1f112d342b45cc0c15dd56877ce` and executed GitHub's synthetic PR merge commit `77b33bd714b5daee81ac44204b056fc66f4bb085` against the then-current `main` base.

The exact-real device-evidence smoke reported `PASS` with evidence class `hosted-headless-chrome-exact-real` and the accepted Nannestad identities:

- tile: `epsg25832_611000_6677000_1000m`;
- terrain SHA-256: `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- roads SHA-256: `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- buildings SHA-256: `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`;
- `RUNTIME_VERIFICATION_PASS` for terrain, roads and buildings;
- 7 runtime requests and 0 raw-source runtime calls.

Movement/resource evidence:

- path `center -> outside-active-inside-retain -> center`;
- active radius 800 m, retain radius 1200 m, movement offset 1000 m east;
- resolver calls stayed `1 -> 1`;
- `loads_started_delta=0`;
- `cache_hits_delta=1`;
- renderer terrain checkpoints were active / inactive / active;
- buffer count was `3 -> 0 -> 3`;
- current terrain GPU payload accounting was `595,992 -> 0 -> 595,992` bytes;
- resource create count was `1 -> 1 -> 2` and destroy count `0 -> 1 -> 1`;
- final lifecycle state was active with 2 creates and 1 destroy;
- streaming trace retained 12 entries, dropped 0 and carried the three required scheduler snapshots;
- lifecycle observation correlation passed the strict validator before device evidence could become PASS;
- `physical_vram_release_observed=false` throughout.

The same workflow also passed the existing strict device comparator regressions, the new lifecycle/correlation negative regressions, Vite production build, the accepted-artifact WebGL2 renderer run and the synthetic module DedicatedWorker gate. `baseline` run `32202573821` and `viewer-benchmark` run `32202573844` also passed for the same PR head.

Hosted Chrome's WebGPU capability probe was unavailable in this runner, so the renderer benchmark remained `PARTIAL`: WebGL2 exact-real evidence is valid, but no hosted WebGPU/WebGL2 performance comparison is claimed. A real WebGPU-capable device remains required for that comparison.

## Evidence state

**PASS for exact-real hosted Chrome WebGL2 movement/cache/renderer-resource lifecycle integration.**

**OPEN for physical Android and genuine WebGPU/WebGL2 same-device A/B acceptance.** Historical green runs from #37/#41 are context only; the evidence above is from the clean restack.

## Non-claims

This restack does not prove:

- physical VRAM reclamation timing;
- Android physical-device acceptance;
- a WebGPU-over-WebGL2 performance winner;
- hard GPU/resident budgets, worker pool policy, LOD policy or whole-Norway streaming policy;
- multi-tile real terrain, which remains blocked by the independent DTM1 seam/source-overlap gate.
