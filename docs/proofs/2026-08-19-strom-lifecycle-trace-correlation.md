# STRØM — lifecycle trace correlation acceptance

## Scope

Advance `P0-STREAMING-01` from lifecycle instrumentation to fail-closed evidence acceptance. The scheduler already emits renderer-neutral lifecycle events and `lifecycle_observer.mjs` can observe the injected activate/deactivate/dispose adapters. A device trace must not be accepted as renderer-resource lifecycle evidence merely because both streams happen to exist.

## Change

`validateCompletedStreamingMovementCapture` now supports `requireLifecycleObservations`. `validateRendererLifecycleMovementCapture` enables that strict mode for browser/device captures intended to prove renderer-resource lifecycle.

Strict mode requires `lifecycle-observation` entries and correlates scheduler lifecycle events against adapter observations using phase, status, tile id and lifecycle reason:

- `tile-activated` ↔ `activate/completed`;
- `activation-failed` ↔ `activate/failed`;
- `tile-deactivated` ↔ `deactivate/completed`;
- `deactivation-failed` ↔ `deactivate/failed`;
- `tile-evicted` ↔ `dispose/completed`;
- `disposal-failed` ↔ `dispose/failed`.

Counts must match for every correlation key. Lifecycle observations with invalid phase/status/tile identity or negative/non-finite duration fail closed. Existing generic movement-trace acceptance remains backward-compatible and does not claim renderer-resource evidence unless the strict validator is selected.

## Regressions

`test_streaming_trace_validator.mjs` expands from 6 to 10 cases, adding:

- strict renderer-lifecycle capture accepted when scheduler and adapter streams match;
- missing lifecycle kind rejected;
- lifecycle reason mismatch rejected;
- invalid negative duration rejected.

The test remains part of the existing `World streaming scheduler regressions` baseline step.

## Evidence state

Exact-head GitHub Actions for the publication head must complete before CI PASS is claimed. Local container execution was unavailable because the automation container had no DNS route to GitHub; no local PASS is claimed from that failed clone attempt.

## Claim boundary

This change proves an acceptance contract, not Android GPU/resource unload behavior. No hard resident/GPU budget, retry policy, worker pool, LOD policy, WebGPU/WebGL policy or DTM1 seam transform is selected. The next device capture must use the strict validator before renderer-resource lifecycle cost or unload/reactivation can be claimed.
