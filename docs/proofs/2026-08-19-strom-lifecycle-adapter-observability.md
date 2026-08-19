# STRØM — renderer-neutral lifecycle adapter observability

## Scope

Advance `P0-STREAMING-01` after exact-real Android movement evidence showed `resident -> cached -> resident` without refetch, while renderer-resource unload/reload remained explicitly unobserved.

## Change

Added `engine/streaming/lifecycle_observer.mjs`, a renderer-neutral wrapper around the existing injected `activateTile`, `deactivateTile` and `disposeTile` callbacks.

Each adapter invocation emits one immutable `nwe.streaming-lifecycle-observation/0.1` record containing phase, completed/failed status, tile id, scheduler reason, start time and duration. Failed adapter calls preserve the original thrown error identity. Observer/sink failures are isolated and cannot alter lifecycle behavior.

`streaming_trace_recorder.mjs` now accepts lifecycle observations as `lifecycle-observation` entries, so the same bounded movement trace can correlate scheduler state, terrain loading and adapter-resource lifecycle without importing WebGPU/WebGL code into streaming core.

## Evidence

Focused isolated Node execution before publication:

- syntax: PASS;
- `streaming lifecycle observer regressions: PASS (5 cases)`;
- completed activate/deactivate/dispose timings are recorded;
- adapter return identity is preserved;
- adapter failure is observed and rethrown unchanged;
- telemetry sink failure does not change successful lifecycle behavior;
- non-monotonic injected test clocks cannot produce negative duration values;
- lifecycle observations enter the existing bounded movement trace as `lifecycle-observation` entries.

The regression is wired into the normal `baseline` workflow under `World streaming scheduler regressions`.

## Claim boundary

This is structural/hosted-test instrumentation, not a renderer-resource lifecycle PASS by itself. The open SENTINEL device integration evidence proves exact-real scheduler `resident -> cached -> resident` movement with one cache hit and no refetch, but reports `renderer_resource_lifecycle_observed=false`.

The next accepted device capture should wrap the real renderer adapters with this observer and require complete lifecycle observations before claiming GPU/resource unload/reload or reactivation cost. No WebGPU/WebGL policy, worker-pool policy, retry policy, hard memory budget, LOD policy or DTM1 seam transform is selected here.
