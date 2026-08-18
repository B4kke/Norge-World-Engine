# STRØM proof — bounded movement trace handoff

Date: 2026-08-18

## Scope

This increment advances `P0-STREAMING-01` by making browser/Android movement evidence reproducibly correlatable without adding renderer-specific logic to `engine/streaming`. It does not claim Android performance, choose worker pooling, select retry policy, set production memory budgets, or alter DTM1 seam behavior.

## Problem

The scheduler already emits lifecycle events and snapshots, while `terrain_load_observer.mjs` emits one record per terrain load attempt. Those streams were separate. A browser/device movement run therefore had no bounded renderer-neutral artifact that preserved ordering across load start/completion, activation/deactivation, cache re-entry, retries/cancellation and phase timing observations.

A naive telemetry array would also create its own unbounded memory growth during long movement captures, contaminating the very memory evidence STRØM needs to collect.

## Implementation

Added `engine/streaming/streaming_trace_recorder.mjs` with `createStreamingTraceRecorder()`.

The recorder:

- accepts existing scheduler `onEvent` callbacks;
- accepts existing `terrain_load_observer` attempt observations;
- accepts explicit scheduler snapshots at camera/movement checkpoints;
- emits `nwe.streaming-movement-trace/0.1` with monotonically increasing sequence numbers;
- deep-detaches recorded payloads from later caller mutation;
- keeps a hard caller-configured `maxEntries` bound;
- discards the oldest entry on overflow and increments `droppedEntries`, making evidence loss explicit;
- contains no renderer/WebGPU/WebGL scene logic and makes no network/source calls.

## Regression coverage

`engine/streaming/test_streaming_trace_recorder.mjs` contains three cases:

1. Real `TileStreamingScheduler` + `createObservedTerrainTileLoadFunction()` are driven through an A → B → A movement path. The trace must contain two terrain loads, three activations, two deactivations, one scheduler cache hit and three labeled snapshots; returning to A must not produce a third load.
2. A recorder configured for three entries receives five events and must retain exactly three with `droppedEntries = 2` and sequence range 3…5.
3. Recorded nested input is detached from later caller mutation before export.

The test is wired into repository baseline CI together with Node syntax validation.

## Claim calibration

If exact-head CI is green, this proves a bounded renderer-neutral evidence transport for scheduler movement + terrain load-attempt correlation. It does **not** prove device performance or the exact accepted Nannestad terrain through the real browser DedicatedWorker path.

The next acceptance step remains an exact-real browser/Android run. LUMEN can attach renderer-side upload/apply/rAF/GPU data to the same capture session while STRØM supplies the lifecycle/load trace. Any non-zero `droppedEntries` must be treated as incomplete movement evidence rather than silently accepted.
