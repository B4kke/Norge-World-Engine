# STRØM proof — retained admission fairness under mixed tile sizes

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** deterministic Node scheduler/resource-accounting regression + hosted CI when exact-head workflow completes. This is not Android, GPU/VRAM, real neighboring DTM1 terrain, or production budget evidence.

## Question

After pre-start load admission removed the concrete concurrency-slot/FIFO problem, does the scheduler still make useful progress when the highest-priority desired tile is temporarily too large for the currently available retained-byte capacity, while a slightly lower-priority tile does fit?

A correct policy-neutral scheduler must not turn one temporarily blocked large tile into head-of-line blocking for all smaller admissible work. The deferred large tile must also remain reprioritizable/cancellable and must progress once capacity is genuinely released.

## Scenario

`test_retained_admission_fairness.mjs` and `benchmark_retained_admission_fairness.mjs` compose the real `TileStreamingScheduler` pre-start admission hook with `createRetainedBudgetLifecycleAdapter()`.

Synthetic retained-byte cap: 250 B, deliberately tiny for deterministic accounting only.

Tiles:
- incumbent: 150 B;
- large: 150 B;
- small: 100 B.

Movement:
1. seed incumbent at camera E=0, committing 150 B;
2. move to E=100 where large is highest priority, but only 100 B remains available; small is slightly lower priority and exactly fits;
3. move to E=121 so incumbent crosses the retain boundary and is disposed while large remains desired, releasing enough capacity for large.

## Acceptance

At pressure:
- large remains `queued` rather than consuming a concurrency slot;
- small materializes and becomes resident despite being lower priority;
- active loads return to 0 with large still deferred;
- committed bytes equal the 250 B cap;
- reserved bytes are 0 and overcommit is 0.

After capacity release:
- incumbent is disposed;
- large materializes and becomes resident;
- queue depth and active loads return to 0;
- committed bytes remain within the cap;
- reserved bytes and overcommit remain 0.

A second regression cancels the deferred large tile by removing it from interest before capacity release and requires that it never materialize and leaves no pre-admission reservation behind.

## Claim boundary

This establishes scheduler/admission fairness and cancellation semantics for a mixed-size synthetic case. It does not select a production retained-memory cap, prove physical RAM/VRAM reclamation, choose worker/cache/LOD policy, or promote neighboring terrain.

No raw source API calls are introduced. RuntimeVerificationBundle semantics are untouched. No DTM1 seam rule or renderer-specific streaming-core logic is added.

## Next

If this gate is green on hosted CI, extend the same mixed-size admission scenario to repeated movement/churn and measure deferral duration/attempt counts so starvation can be quantified over a longer deterministic path rather than inferred from one release event.
