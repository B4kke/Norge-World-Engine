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

The viewer workflow now requires:

- existing device-evidence comparator regressions, including fallback/backend-pair rejection;
- new lifecycle evidence negative regressions;
- Vite production build including `device-evidence.html`;
- exact accepted Preview renderer benchmark;
- exact-real headless Chrome movement/cache/resource lifecycle smoke;
- existing synthetic DedicatedWorker structural gate.

## Evidence state

**PENDING exact-head CI.** Do not promote this branch to PASS until the PR-head `world-viewer-vite` workflow executes successfully. Historical green runs from #37/#41 are context only and are not evidence for this restack.

## Non-claims

This restack does not prove:

- physical VRAM reclamation timing;
- Android physical-device acceptance;
- a WebGPU-over-WebGL2 performance winner;
- hard GPU/resident budgets, worker pool policy, LOD policy or whole-Norway streaming policy;
- multi-tile real terrain, which remains blocked by the independent DTM1 seam/source-overlap gate.
