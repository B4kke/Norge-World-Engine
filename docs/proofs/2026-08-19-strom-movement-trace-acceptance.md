# STRØM proof — movement trace acceptance gate

Date: 2026-08-19

## Scope

This increment advances `P0-STREAMING-01` by making movement evidence fail closed before exact-real browser/Android measurements are interpreted. It does not select worker pooling, retry policy, renderer backend, LOD or production memory budgets.

## Implementation

Added `engine/streaming/streaming_trace_validator.mjs` with two levels:

- `validateStreamingMovementTrace()` checks schema/retention metadata, hard `maxEntries`, contiguous retained sequence numbers, first/last sequence consistency, required entry kinds and optional completeness.
- `validateCompletedStreamingMovementCapture()` additionally requires no dropped entries, scheduler/load-observation/snapshot presence, one-to-one `(tileId, attempt)` correlation between `load-started` and terrain-load observations, and an idle final scheduler snapshot (`activeLoads = 0`, `queueDepth = 0`).

The gate is renderer-neutral and consumes only the previously merged `nwe.streaming-movement-trace/0.1` evidence artifact.

## Negative coverage

Six focused regressions cover:

1. complete capture acceptance;
2. dropped telemetry rejection;
3. missing terrain-load observation rejection;
4. non-idle final snapshot rejection;
5. retained sequence-gap rejection;
6. mismatched scheduler/load-observation attempt rejection.

The exact source/test pair was also executed in an isolated Node environment before publication and reported `streaming trace validator regressions: PASS (6 cases)`.

## Claim calibration

This proves an acceptance contract for capture completeness/correlation, not Android performance. Exact accepted Nannestad terrain still needs to run through the real browser module DedicatedWorker path and physical Android Chrome movement capture. A capture with `droppedEntries > 0`, unmatched load attempts or in-flight work at the final snapshot is evidence-incomplete and must not be used to choose worker/cache/retry/budget policy.
