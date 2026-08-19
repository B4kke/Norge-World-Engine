# STRØM proof — retained-budget lifecycle adapter

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** renderer-neutral unit/contract evidence plus hosted CI gate. This is not physical RAM/VRAM evidence and does not select a production byte cap.

## Problem

The standalone `RetainedByteBudgetGate` could reserve bytes before work, but it was not yet connected to the runtime `loadTile` / `disposeTile` lifecycle. That meant callers still needed to hand-roll reservation, cancellation and release semantics correctly.

## Implementation

`engine/streaming/retained_budget_lifecycle_adapter.mjs` composes the existing renderer-neutral lifecycle callbacks:

- `estimateTileBytes(tile, context)` supplies a conservative pre-materialization estimate;
- a reservation is acquired before the wrapped `loadTile` starts materializing payload bytes;
- when budget is temporarily unavailable, callers wait in deterministic FIFO/start order instead of turning pressure into a retry failure;
- an aborted waiter is removed without materializing the tile;
- an estimate larger than the entire configured cap fails before `loadTile` is called;
- a successful load commits the actual byte count against the reservation;
- an underestimated result fails closed with `RETAINED_BUDGET_UNDERESTIMATE` and the rejected payload is sent to the wrapped cleanup/disposal callback;
- committed accounting is released only after wrapped `disposeTile` succeeds;
- disposal failure therefore retains the committed accounting instead of pretending memory/resource pressure disappeared.

The adapter exposes `nwe.retained-budget-lifecycle-adapter/0.1` snapshots with budget state, wait depth, committed tile bytes and cancellation/oversize/cleanup metrics.

## Adversarial regressions

`test_retained_budget_lifecycle_adapter.mjs` covers five cases:

1. a second 60-byte load under a 100-byte cap cannot materialize until the first committed tile is disposed;
2. cancellation removes a waiting load and proves its wrapped loader is never called;
3. a 50-byte estimate followed by a 70-byte actual result fails closed and triggers rejected-payload cleanup with zero committed/accounted leak;
4. disposal failure keeps 100 committed bytes accounted, preventing false capacity reclamation;
5. an estimate larger than the cap is rejected before materialization.

Local isolated execution before publication:

`retained budget lifecycle adapter regressions: PASS (5 cases)`

The focused `.github/workflows/strom-retained-budget.yml` now syntax-checks and executes both the primitive budget-gate regressions and lifecycle-adapter regressions.

## Important limitation

The adapter reserves immediately inside the scheduler-supplied `loadTile` callback, before the underlying materializer executes. A budget-waiting callback still occupies one scheduler `activeLoads` slot because the current scheduler has no separate pre-`#startLoad` admission hook. FIFO wait order preserves start-order priority, but dynamic reprioritization of already-waiting admissions is not possible at this layer.

Therefore this change establishes a usable hard **accounting/materialization admission boundary** without changing scheduler core, but it does not yet prove that the final scheduler-level admission architecture is optimal under sustained multi-tile pressure. A later core admission hook may be justified if automated churn/concurrency evidence shows waiting load slots are materially harmful.

## Boundaries preserved

- no raw source API calls;
- no RuntimeVerificationBundle weakening;
- no DTM1 seam policy;
- no renderer/WebGPU/WebGL-specific logic;
- no production RAM/GPU/cache value selected;
- no claim of physical allocator or driver memory reclamation.

## Next gate

Run a scheduler+adapter pressure benchmark with bounded concurrency and cancellation to measure how much budget waiters consume load slots versus refetch/eviction savings. Only if that evidence shows a material scheduling penalty should the reservation decision move into a new explicit scheduler pre-load admission hook.
