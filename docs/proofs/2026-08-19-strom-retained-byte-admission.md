# STRØM proof — retained byte admission contract

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** renderer-neutral unit/synthetic contract + automated CI harness. No physical RAM/VRAM claim and no production budget selected.

## Problem

`maxCacheBytes` is an inactive-cache target, not a hard ceiling over resident + activating + cached + concurrently materializing loads. A stronger contract needs pre-load reservation so concurrent admissions cannot all assume the same remaining capacity.

## Implementation

`engine/streaming/retained_byte_budget.mjs` adds `RetainedByteBudgetGate`. Callers synchronize currently committed scheduler-retained bytes, reserve an estimated upper bound before a load is admitted, then commit the exact returned byte count or cancel the reservation on cancellation/stale work. Concurrent reservations participate in the same accounting ceiling.

If the actual payload exceeds its reservation, commit fails closed with `RETAINED_BUDGET_UNDERESTIMATE` and the reservation is released rather than silently increasing committed accounting. This detects a broken estimate contract; it does **not** claim the loader prevented a temporary physical allocation before the actual size became known.

## Negative regressions

`test_retained_byte_budget.mjs` covers five cases:
- committed + two concurrent reservations exactly reach the ceiling and a third is deferred;
- concurrent reservations cannot overbook; cancellation releases the reservation;
- underestimated payload is rejected with a typed/code-bearing error and zero committed leak;
- releasing committed bytes permits later admission;
- synchronizing committed state that conflicts with active reservations fails closed.

Local execution before publication: `retained byte budget regressions: PASS (5 cases)`.

## Synthetic benchmark

`benchmark_retained_byte_budget.mjs` uses the existing 4,456,448 B synthetic tile payload size under 3-tile, 2-tile and 1-tile accounting ceilings. All profiles keep `overcommitBytes=0`; tighter ceilings cause more reservation deferrals before an old committed tile is released. These numeric caps are experiments only.

## CI

`.github/workflows/strom-retained-budget.yml` syntax-checks the module/tests/benchmark, runs the regressions and runs the benchmark on pull requests touching this contract. Hosted exact-head result must be checked before claiming CI PASS.

## Boundaries

- no raw source API calls;
- no RuntimeVerificationBundle changes;
- no DTM1 seam policy;
- no renderer/WebGPU/WebGL logic;
- no production RAM/GPU/cache value selected;
- pre-load accounting reservations are not equivalent to measured physical memory unless the loader honors the estimate as a true upper bound.

## Next integration gate

Wire this admission primitive into `TileStreamingScheduler` load admission using a conservative artifact/loader byte estimate and explicit cancellation/stale-completion release. Then adversarially prove that scheduler state, load reservations and disposal failure cannot leak or overbook accounted retained bytes before enabling any hard budget in production configuration.
