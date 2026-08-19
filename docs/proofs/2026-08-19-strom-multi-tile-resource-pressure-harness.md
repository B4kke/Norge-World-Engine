# STRØM proof — multi-tile resource pressure harness

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** deterministic Node scheduler/resource-accounting harness + hosted CI when exact-head workflow completes. Not neighboring DTM1, Android/GPU, or production budget evidence.

## Question

After mixed-size fairness and long-run recovery passed, the next need is reusable automated evidence over a larger tile set without inventing a DTM1 seam rule. Can the existing scheduler + retained-budget adapter be exercised as one measurable 3×3 pressure system with bounded concurrency, resident/cache accounting, admission deferrals, evictions and per-tile queued-duration observability?

## Implementation

`streaming_resource_pressure_harness.mjs` runs a deterministic movement path over an injected `TileStreamingScheduler`, captures an idle snapshot at every waypoint, optionally joins an external renderer/resource-neutral budget snapshot, and reports per-tile longest queued streak plus cache/admission/concurrency/accounting summaries.

The regression and benchmark compose the real scheduler with `createRetainedBudgetLifecycleAdapter()`. The benchmark uses a synthetic 3×3 grid and the same 4.25 MiB tile-size class used by earlier pressure experiments. Caps are experiment inputs only: 3 tiles retained, 2 tiles resident and 1 tile inactive cache, with max load concurrency 2.

## Acceptance

- 9 tiles are exercised over a multi-waypoint path.
- peak active loads never exceed 2;
- resident and cache byte overcommit remain 0;
- retained committed + reserved accounting never exceeds its experiment cap;
- the scenario produces actual admission deferral and cache eviction pressure;
- per-waypoint state/accounting samples and per-tile queued streaks are emitted for later comparison.

## Claim boundary

This harness proves only that the existing renderer-neutral lifecycle can be measured automatically as a multi-tile resource-pressure system using synthetic tiles. It does not promote neighboring terrain, choose RAM/VRAM/cache values, prove physical memory reclamation, select worker pooling/LOD, or weaken RuntimeVerificationBundle semantics. No raw source API calls or DTM1 seam policy are introduced.

## Next

Use the same harness contract with compiler-promoted neighboring artifacts only after FORGE clears the seam gate. Until then, use it to falsify scheduler/cache/resource-policy changes with synthetic or otherwise already-promoted fixtures rather than inventing world truth.
