# STRØM pre-start load admission

## Purpose

Advance `P0-STREAMING-01` after the retained-admission pressure benchmark proved that resource-budget waiters inside `loadTile()` could occupy every `maxConcurrentLoads` slot and preserve stale FIFO order across camera reprioritization.

This change separates **scheduler admission** from **resource policy**. `TileStreamingScheduler` receives an optional renderer/resource-neutral `admitLoad(tile, context)` hook. The hook is synchronous and non-blocking: it returns `null`/`false` to defer or a non-null opaque token to grant. Only a granted candidate enters `loading` and increments `activeLoads`.

The retained-byte adapter owns the actual byte decision through `tryAdmitLoad`; the scheduler does not know byte sizes, GPU concepts, terrain source details, or renderer backend state.

## Contract

- Deferred candidates remain `queued` and therefore remain eligible for normal distance/tile-id reprioritization on the next scheduler update.
- A deferred candidate consumes **zero** `activeLoads` slots.
- The scheduler scans current queued candidates in deterministic priority order. A resource-deferred candidate does not prevent another candidate that the injected policy can admit from using an otherwise free concurrency slot.
- `admitLoad` must be synchronous. A Promise-returning hook is rejected fail-closed as `load-admission-failed`; async FIFO waiting is deliberately kept outside scheduler core.
- Granted opaque admission data is forwarded to `loadTile` as `context.admission`.
- The retained adapter consumes and validates its own opaque admission token before materialization. Direct adapter usage without scheduler pre-admission remains backward compatible and can still use its original abortable waiter path.
- If an underlying materializer ignores cancellation and returns a payload after the signal has been aborted, the retained adapter disposes that rejected payload and cancels the reservation instead of committing stale retained bytes.

## Negative / regression evidence

`engine/streaming/test_tile_scheduler_load_admission.mjs` covers four cases:

1. budget/policy deferral leaves the tile queued with `activeLoads=0` and never calls `loadTile`;
2. an opaque token reaches `loadTile` while actual load concurrency remains bounded;
3. retained-byte pre-admission creates neither internal FIFO waiters nor pre-admission reservations when the cap cannot admit the candidate;
4. Promise-returning admission hooks fail closed before materialization starts.

`engine/streaming/test_retained_budget_lifecycle_adapter.mjs` is extended to six cases, including an adversarial materializer that ignores an abort until after payload materialization. The adapter must reject the result, dispose the payload, and end with zero accounted/reserved bytes.

## Pressure benchmark

`engine/streaming/benchmark_retained_admission_priority.mjs` reuses the same synthetic topology that previously reproduced occupied-slot priority blocking:

`A/B resident -> C/E requested under a full retained budget -> camera moves to D`.

Acceptance for schema `nwe.streaming-retained-admission-priority-benchmark/0.2` is now:

- while A/B retain all byte capacity, C/E remain queued but `activeLoads=0`;
- the retained adapter has `waitingLoads=0` and `preAdmittedLoads=0` at pressure;
- C/E do not materialize while capacity is unavailable;
- after movement makes A/B evictable and releases retained capacity, D is selected/materialized before either stale C/E candidate;
- final scheduler work is idle;
- final retained reservations are zero;
- retained accounting reports `overcommitBytes=0`.

This directly tests the mechanism demonstrated by the previous `0.1` benchmark rather than replacing it with a different workload.

## Evidence boundary

This is synthetic scheduler/resource-accounting evidence. It proves that the specific FIFO waiter/concurrency-slot blocking mechanism is removed by pre-start admission while preserving bounded load concurrency and retained-byte accounting.

It does **not** select a production retained-memory cap, worker count, cache size, LOD policy, renderer resource policy, Android performance target, or physical RAM/VRAM guarantee. The byte cap in the benchmark remains an experimental accounting value only.

No RuntimeVerificationBundle semantics are changed. No raw source API transport is introduced. No DTM1 seam policy is introduced. No WebGPU/WebGL-specific logic is added to streaming core.

## Validation state

The persistent STRØM branch was synchronized without force to `main` `5b2f242456cc4d02aeff41ec6dbe2992c68d460d` through two-parent merge `b373a3e1e9d4fad74081d5ceeb56bf07c0718723`, preserving the incoming LUMEN #55 files unchanged.

Focused regressions and the pressure benchmark are wired into `.github/workflows/strom-retained-budget.yml`. Exact-head hosted results are recorded in PR #48 after GitHub Actions completes; until then this proof claims implementation and test design, not CI PASS.
