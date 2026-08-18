# STRØM proof — scheduler resident/cache budget accounting

Date: 2026-08-18  
Role: STRØM — Runtime Streaming  
Branch: `agent/strom-budget-accounting`  
Evidence class: local/structural Node regression + synthetic benchmark. **Not** Android/device performance evidence and **not** real neighboring terrain evidence.

## Question

Can `TileStreamingScheduler` keep resident payload memory distinct from inactive cached payload memory, enforce an optional resident byte cap across concurrent activation, and fail without corrupting lifecycle byte accounting?

## Finding before change

`maxCacheBytes` was documented as an inactive-cache budget, but the scheduler's `bytesCached` counter increased when any tile load completed and did not decrease when that tile became resident. Therefore resident payload bytes consumed the inactive-cache budget. A movement sequence with one 100 B resident tile + one 100 B cached tile and `maxCacheBytes=150` incorrectly evicted the valid cached tile even though the inactive cache itself used only 100 B.

This was a scheduler accounting defect, not evidence that the configured cache size or any production memory policy was wrong.

## Implemented contract

- `bytesResident`, `bytesActivating` and `bytesCached` are separate lifecycle buckets.
- `retainedBytes = resident + activating + cached` exposes scheduler-known retained payload bytes.
- `maxCacheBytes` applies only to `cached` payloads.
- new `maxResidentBytes` is optional and defaults to `null`; therefore this patch does not select a production resident-memory budget.
- activation reserves bytes in the `activating` bucket before awaiting the injected renderer/resource adapter, preventing concurrent activation completions from both passing the same resident cap.
- budget-deferred desired tiles remain cached and can activate later without refetch after resident space becomes available.
- activation failure retains the verified cached payload for retry and is counted separately from load failure.
- failed disposal leaves payload state and byte accounting intact and reports an explicit disposal failure/overcommit instead of pretending memory was released.
- `budgetOvercommitBytes` remains as a backward-compatible alias for inactive-cache overcommit; new explicit fields are `cacheBudgetOvercommitBytes` and `residentBudgetOvercommitBytes`.

The scheduler's `byteSize` is a renderer-neutral retained-payload estimate. It is **not** an exact WebGPU/WebGL VRAM measurement. GPU-resource budgeting remains an adapter/device evidence problem for LUMEN + STRØM.

## Negative/regression coverage

`engine/streaming/test_tile_scheduler.mjs` now covers 11 cases, including:

- one-shot candidate iterable;
- bounded concurrent load;
- resident↔cached warm-cache reentry;
- resident bytes not consuming inactive-cache budget;
- deterministic oldest inactive-cache eviction;
- failed disposal retaining accounting/state;
- resident-byte budget deferral then cache-backed activation without refetch;
- renderer/resource activation failure retry without reloading verified payload;
- abort + stale completion rejection;
- transport/load failure followed by retry.

Existing runtime verifier / terrain loader regressions remain responsible for corrupt RuntimeVerificationBundle/artifact rejection. This scheduler change does not weaken or bypass those gates.

## Local execution

Environment:

- Node `v22.16.0`
- Python `3.13.5` used only to validate benchmark JSON syntax/output.

Commands:

```text
node --check engine/streaming/tile_scheduler.mjs
node --check engine/streaming/test_tile_scheduler.mjs
node engine/streaming/test_tile_scheduler.mjs
node --check engine/streaming/benchmark_tile_scheduler.mjs
node engine/streaming/benchmark_tile_scheduler.mjs > benchmark.json
python -m json.tool benchmark.json
```

Result:

```text
tile scheduler regressions: PASS (11 cases)
```

## Synthetic 3×3 bounded-byte stress

The benchmark deliberately uses a constrained **test-only** profile:

- synthetic payload per tile: `4.25 MiB` (`4,456,448 B`);
- max concurrent loads: `2`;
- resident stress cap: `8,912,896 B` (2 synthetic payloads);
- inactive-cache stress cap: `8,912,896 B` (2 synthetic payloads);
- camera path: center → east → north-east → center return.

Observed final/cumulative metrics:

- loads started/completed: `10 / 10`;
- peak concurrent loads: `2`;
- cache hits: `4`;
- resident-budget deferrals: `9`;
- evictions: `6`;
- final resident bytes: `8,912,896 B`;
- final cached bytes: `8,912,896 B`;
- final retained bytes: `17,825,792 B`;
- final resident overcommit: `0 B`;
- final inactive-cache overcommit: `0 B`;
- peak retained bytes during load/transition: `22,282,240 B`.

The last number is important: a newly completed load is already materialized before its exact returned `byteSize` is known, so transient retained/cache bytes can exceed the post-transition inactive-cache target before eviction. This patch therefore proves a hard **activation/resident** cap and deterministic post-lifecycle cache enforcement; it does not claim a no-transient-allocation total-RAM cap.

## Interpretation

**FACT:** the old counter mixed resident and cached payloads and could cause unnecessary warm-cache eviction.

**FACT:** the new regressions keep resident/cache accounting separate, bound concurrent resident activation with an opt-in byte cap, preserve payload/accounting on adapter failure, and retain existing cancellation/stale-completion behavior.

**EXPERIMENT:** the 8.5 MiB resident/cache stress values are only synthetic pressure values chosen to exercise the mechanisms. They are not selected device/runtime budgets.

**OPEN:** Android/desktop browser movement must measure real retained JS/ArrayBuffer memory, worker/transfer cost, renderer upload/resource cost, rAF gaps and device-specific limits before a production resident/cache/GPU budget is chosen.
