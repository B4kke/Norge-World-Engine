# STRØM proof — update-driven streaming retry controls

Date: 2026-08-18

## Scope

This proof covers renderer-neutral load retry mechanics in `TileStreamingScheduler`. It does not select production retry timings, Android budgets, worker-pool size, LOD, or multi-tile terrain seam behavior.

## Problem

Previously, a tile in `failed` state was re-queued on the next scheduler `update()` with no explicit delay gate, attempt bound, or retry-specific observability. Frequent camera updates could therefore repeatedly trigger load attempts after a persistent runtime-input failure.

## Implementation

`TileStreamingScheduler` now supports two optional controls:

- `retryDelayMs`: minimum update-driven delay before a failed desired tile may be re-queued.
- `maxLoadAttemptsPerInterest`: optional cap on load attempts while the tile remains continuously desired.

The retry cycle resets when the tile leaves the desired interest set, after successful activation, after an abort that returns the tile to idle, or after eviction. The scheduler does not own a retry timer; retries only become eligible during a normal `update()` call. Camera/player interest therefore remains authoritative.

Existing behavior remains the default: `retryDelayMs = 0` and `maxLoadAttemptsPerInterest = null`. This introduces mechanism and observability without claiming a measured production retry policy.

The injected `loadTile` callback receives an `attempt` field alongside `signal`. Snapshots expose `loadAttempts` and `retryNotBefore`. Metrics/events add queued retry, deferred retry and retry exhaustion evidence.

## Negative regressions

`engine/streaming/test_tile_scheduler_retry.mjs` adds three deterministic cases using an injected clock:

1. A first load fails, an update before `retryNotBefore` does not start a second load, and the boundary update does.
2. A configured two-attempt cap stops further retries while interest remains unchanged, then leaving and re-entering interest resets the cycle.
3. Default configuration still permits the previous next-update retry behavior and successfully reaches resident state.

Local isolated Node execution against the exact scheduler implementation used for publication:

```text
tile scheduler retry regressions: PASS (3 cases)
```

`node --check engine/streaming/tile_scheduler.mjs` also passed in the isolated execution workspace before publication. Branch CI is the repository-wide regression gate.

## Claims

Proven by deterministic regression evidence:

- a configured retry delay prevents a failed desired tile from retrying on every scheduler update;
- load attempts can be bounded for one continuous tile-interest cycle;
- the cap resets when tile interest is lost and later reacquired;
- retry state is observable without weakening artifact verification or moving renderer logic into streaming core;
- no production delay or attempt cap has been selected.

Not proven here:

- optimal retry timing/count for Android Chrome or real networks;
- exact-real Nannestad movement performance;
- multi-tile DTM1 streaming, which remains blocked by the compiler seam contract.
