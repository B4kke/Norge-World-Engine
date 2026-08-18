# STRØM proof — terrain load-attempt observability

Date: 2026-08-18

## Scope

This increment advances `P0-STREAMING-01` observability for the exact-real browser/Android movement gate. It does not select retry timing, memory/GPU budgets, worker pooling, LOD, renderer backend, or DTM1 seam behavior.

## Problem

`terrain_tile_loader.mjs` already returns useful successful-load phase timings (`resolveInput`, verification, strict decode, worker roundtrip/CPU and total), while `TileStreamingScheduler` separately owns attempt/retry/cancellation state. Before this change there was no renderer-neutral adapter that joined those two evidence streams into one per-attempt observation, and failed/aborted attempts had no equivalent terrain-load observation record.

That gap matters for the next device test: an Android capture must be able to distinguish a slow successful verification/decode/worker path from a retry, runtime verification rejection, network/runtime-input failure, or camera-driven abort without moving renderer-specific code into `engine/streaming`.

## Implementation

Added `engine/streaming/terrain_load_observer.mjs` with `createObservedTerrainTileLoadFunction()`.

The wrapper:

- preserves the exact underlying `loadTile(tile, context)` call, including `AbortSignal` and scheduler `attempt`;
- returns the exact underlying result object unchanged;
- emits one immutable `nwe.terrain-load-observation/0.1` record per attempt;
- records `tileId`, scheduler attempt, completed/failed/aborted status and wrapper wall time;
- on success records retained byte size, immutable artifact SHA-256 and the existing loader phase timings;
- on failure records original error name/code/message and rethrows the exact same error;
- treats `AbortError` separately from failure;
- isolates the observer callback so a broken telemetry sink cannot change verification, retry, cancellation or lifecycle result.

The wrapper is deliberately renderer-neutral and does not contact source APIs or alter `RuntimeVerificationBundle` semantics.

## Regression coverage

`engine/streaming/test_terrain_load_observer.mjs` adds four deterministic cases:

1. Successful load preserves exact result/context and captures phase timings, retained bytes, artifact identity and attempt number.
2. Verification-style failure is observed with its exact code and the same error object is rethrown.
3. `AbortError` is classified as `aborted`, not a generic failure.
4. An observer callback that throws cannot turn a successful tile load into a failure.

The test is wired into the baseline terrain verified-artifact streaming step together with Node syntax validation.

## Claim calibration

**Proven by structural regression once CI passes:** scheduler load-attempt identity can be joined to terrain-loader success/failure evidence without changing underlying lifecycle semantics.

**Not proven here:** Android Chrome timing, exact accepted Nannestad browser-worker performance, GPU upload/apply cost, worker creation overhead, best retry policy, worker-pool value, or any real neighboring terrain behavior.

## Next

Use this observer around the exact accepted Nannestad terrain loader in the real browser module-DedicatedWorker path. Correlate its per-attempt records with scheduler events and LUMEN device evidence for verification/decode/worker time, rAF gaps and renderer upload/apply. Only device evidence should drive retry, worker or hard budget policy.
