# STRØM proof — synthetic budget/churn profile benchmark

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** hosted Node/CI synthetic scheduler benchmark. This is not real neighbouring terrain, Android performance, GPU/VRAM evidence or production budget selection.

## Question

Can the existing renderer-neutral scheduler expose a measurable trade-off between retained payload pressure and tile churn when caller-supplied resident/inactive-cache caps are varied over one fixed movement path?

## Method

`engine/streaming/benchmark_tile_scheduler_profiles.mjs` runs the same synthetic 3×3 Nannestad-shaped grid, 4.25 MiB payload per tile, camera path and concurrency cap (`maxConcurrentLoads=2`) for three explicitly experimental profiles:

| Profile | Resident cap | Inactive-cache cap |
| --- | ---: | ---: |
| loose-5r-4c | 22,282,240 B | 17,825,792 B |
| balanced-2r-2c | 8,912,896 B | 8,912,896 B |
| tight-1r-1c | 4,456,448 B | 4,456,448 B |

Movement: center → east → north-east → north → west → center-return. The benchmark records loads, unique loaded tiles, refetches, cache hits/misses, activations/deactivations, evictions, resident-budget deferrals/preemptions, peak active loads and retained-byte peaks. At every idle sample it requires resident/cache caps and retained-byte accounting to hold; final budget overcommit must be zero.

## Exact hosted evidence

Exact code commit containing the benchmark and baseline wiring: `5c68689e6805c220d9d435adb94d9aa9d853115e`.

GitHub Actions:
- baseline run `32211896045` / #1245 — **SUCCESS**;
- world-viewer-vite run `32211896054` / #209 — **SUCCESS**;
- preview1-realdata-publish run `32211896043` / #195 — **SUCCESS**.

Baseline also preserved the existing scheduler/retry/resident-priority/lifecycle/trace/terrain/provenance gates.

### Result summary

| Metric | loose | balanced | tight |
| --- | ---: | ---: | ---: |
| loads started | 12 | 14 | 18 |
| unique loaded tiles | 9 | 9 | 9 |
| refetches | 3 | 5 | 9 |
| cache hits | 3 | 6 | 6 |
| evictions | 5 | 10 | 16 |
| resident deferrals | 0 | 9 | 18 |
| resident preemptions | 0 | 5 | 4 |
| preemption failures | 0 | 0 | 0 |
| activations | 15 | 11 | 6 |
| deactivations | 10 | 9 | 5 |
| activation+deactivation count | 25 | 20 | 11 |
| peak active loads | 2 | 2 | 2 |
| peak retained bytes | 31,195,136 | 22,282,240 | 13,369,344 |
| final resident overcommit | 0 | 0 | 0 |
| final inactive-cache overcommit | 0 | 0 | 0 |

## What this proves

Under this synthetic fixed path, tighter caller-supplied caps trade lower retained payload pressure for more fetch churn: peak retained bytes fall from 31.2 MB to 13.37 MB, while refetches rise from 3 to 9 and evictions from 5 to 16.

It also disproves two tempting simplistic optimization rules:

1. **Cache-hit count alone is not an efficiency metric.** Balanced/tight profiles report more cache hits than loose because constrained resident capacity routes more desired payloads through cached state, while refetches still increase.
2. **Lower activation/deactivation count is not automatically better.** The tight profile has the lowest raw lifecycle count because 18 desired activations are budget-deferred. Fewer lifecycle calls here reflect suppressed residency, not a free performance win.

Therefore future budget experiments need at least retained bytes + refetch/eviction + deferral/desired-coverage signals together.

## Important transient-pressure observation

`peakBytesCached` can exceed `maxCacheBytes` during concurrent load completion before the scheduler's post-completion cache enforcement returns the system to an idle state within budget. This is consistent with the current contract: `maxCacheBytes` is an **inactive cached-payload** budget, not a hard ceiling over all in-flight/materializing runtime memory.

A future hard total retained-memory policy must explicitly cover loading/completion/activation transients. Reusing `maxCacheBytes` as if it already represented that stronger guarantee would be incorrect.

## Boundaries

- Synthetic descriptors/payloads only; no claim that neighboring Nannestad terrain is promoted.
- No DTM1 seam policy.
- No raw source API calls.
- No RuntimeVerificationBundle weakening.
- No WebGPU/WebGL logic in streaming core.
- No numeric profile is selected as production, Android, RAM or GPU policy.
- No decision-log update is justified by this benchmark alone.

## Next gate

Add an explicit renderer-neutral **total retained/materializing byte-pressure experiment/contract** that accounts for cached + activating + resident payloads and concurrent completion transients, while preserving cancellation/failure semantics. Measure its cost/trade-off automatically before considering a production hard memory budget.