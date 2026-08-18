# STRØM proof — scheduler resident/cache budget accounting

Date: 2026-08-18  
Role: STRØM — Runtime Streaming  
Branch: `agent/strom-budget-accounting`  
Evidence class: hosted Node regression + synthetic benchmark, with initial local structural validation. **Not** Android/device performance evidence and **not** real neighboring terrain evidence.

## Question

Can `TileStreamingScheduler` keep resident payload memory distinct from inactive cached payload memory, enforce an optional resident byte cap across concurrent activation, and fail without corrupting lifecycle byte accounting?

## Findings before final change

`maxCacheBytes` was documented as an inactive-cache budget, but the scheduler's `bytesCached` counter increased when any tile load completed and did not decrease when that tile became resident. Therefore resident payload bytes consumed the inactive-cache budget. A movement sequence with one 100 B resident tile + one 100 B cached tile and `maxCacheBytes=150` incorrectly evicted the valid cached tile even though the inactive cache itself used only 100 B.

A second failure-path defect was found during self-review before accepting the PR: `#activate()` originally wrapped both adapter activation and the post-activation stale cleanup in one `try/catch`. If camera interest was lost while activation was in flight and the subsequent `deactivateTile` failed, the scheduler could misclassify that cleanup error as an activation failure and move byte accounting toward cached even though the renderer/resource adapter had already activated the tile. The final implementation restricts the activation catch to the activation call itself; stale cleanup failures keep the tile resident and retain resident byte accounting.

These were scheduler accounting/lifecycle defects, not evidence that the configured cache size or any production memory policy was wrong.

## Implemented contract

- `bytesResident`, `bytesActivating` and `bytesCached` are separate lifecycle buckets.
- `retainedBytes = resident + activating + cached` exposes scheduler-known retained payload bytes.
- `maxCacheBytes` applies only to `cached` payloads.
- new `maxResidentBytes` is optional and defaults to `null`; therefore this patch does not select a production resident-memory budget.
- activation reserves bytes in the `activating` bucket before awaiting the injected renderer/resource adapter, preventing concurrent activation completions from both passing the same resident cap.
- budget-deferred desired tiles remain cached and can activate later without refetch after resident space becomes available.
- activation failure retains the verified cached payload for retry and is counted separately from load failure.
- a deactivation failure after successful activation leaves the tile resident and retains resident byte accounting; it is reported as deactivation/lifecycle failure rather than activation failure.
- failed disposal leaves payload state and byte accounting intact and reports an explicit disposal failure/overcommit instead of pretending memory was released.
- `budgetOvercommitBytes` remains as a backward-compatible alias for inactive-cache overcommit; new explicit fields are `cacheBudgetOvercommitBytes` and `residentBudgetOvercommitBytes`.

The scheduler's `byteSize` is a renderer-neutral retained-payload estimate. It is **not** an exact WebGPU/WebGL VRAM measurement. GPU-resource budgeting remains an adapter/device evidence problem for LUMEN + STRØM.

## Negative/regression coverage

`engine/streaming/test_tile_scheduler.mjs` now covers 12 cases, including:

- candidate ranking and duplicate-id rejection;
- one-shot candidate iterable;
- bounded concurrent load;
- resident↔cached warm-cache reentry;
- resident bytes not consuming inactive-cache budget;
- deterministic oldest inactive-cache eviction;
- failed disposal retaining accounting/state;
- resident-byte budget deferral then cache-backed activation without refetch;
- renderer/resource activation failure retry without reloading verified payload;
- interest lost during in-flight activation + failed stale deactivation retaining resident state/accounting;
- abort + stale completion rejection;
- transport/load failure followed by retry.

Existing runtime verifier / terrain loader regressions remain responsible for corrupt RuntimeVerificationBundle/artifact rejection. This scheduler change does not weaken or bypass those gates.

## Initial local execution

Environment:

- Node `v22.16.0`
- Python `3.13.5` used only to validate benchmark JSON syntax/output.

The initial 11-case implementation and unchanged pressure benchmark passed locally before PR upload. Self-review then found the stale activation-cleanup failure-path defect described above; the 12th case was added and final acceptance moved to exact-head GitHub Actions rather than relying on the pre-fix local result.

## Hosted exact-head execution

Final code head before this documentation-only proof update: `634410e7be8156fad197196ffe9572733b778952`.

GitHub Actions:

- baseline run `#703` / run id `32166688860`: **SUCCESS**;
- world-viewer-vite run `#87` / run id `32166688864`: **SUCCESS**;
- Node on baseline: `v22.23.2`;
- scheduler syntax + regression + benchmark/JSON validation step: **SUCCESS**;
- exact scheduler output: `tile scheduler regressions: PASS (12 cases)`;
- terrain runtime pipeline regressions: `PASS (7 cases)`;
- runtime provenance reconstruction: `PASS`, 11 cases / 11 browser-parity cases;
- compiled-artifact consumer: `PASS`, `raw_source_calls: 0`.

The GitHub PR workflow checks out the PR merge ref, so this additionally validates integration against the then-current `agent/preview1-real-nannestad` base rather than only the isolated head files.

## Synthetic 3×3 bounded-byte stress

The benchmark deliberately uses a constrained **test-only** profile:

- synthetic payload per tile: `4.25 MiB` (`4,456,448 B`);
- max concurrent loads: `2`;
- resident stress cap: `8,912,896 B` (2 synthetic payloads);
- inactive-cache stress cap: `8,912,896 B` (2 synthetic payloads);
- camera path: center → east → north-east → center return.

Observed final/cumulative metrics in baseline #703:

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

**FACT:** self-review also found a stale post-activation cleanup failure path that could corrupt state/byte classification; the 12th hosted regression proves failed deactivation now remains resident and is not counted as activation failure.

**FACT:** the final hosted regressions keep resident/cache accounting separate, bound concurrent resident activation with an opt-in byte cap, preserve payload/accounting on adapter failure, and retain existing cancellation/stale-completion behavior.

**EXPERIMENT:** the 8.5 MiB resident/cache stress values are only synthetic pressure values chosen to exercise the mechanisms. They are not selected device/runtime budgets.

**OPEN:** Android/desktop browser movement must measure real retained JS/ArrayBuffer memory, worker/transfer cost, renderer upload/resource cost, rAF gaps and device-specific limits before a production resident/cache/GPU budget is chosen.
