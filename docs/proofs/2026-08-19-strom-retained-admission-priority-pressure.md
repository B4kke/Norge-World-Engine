# STRØM proof — retained admission priority pressure

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** hosted Node/CI synthetic scheduler + retained-budget adapter pressure. This is not production budget selection, neighboring real-terrain evidence, Android/GPU evidence, or a renderer policy.

## Question

Does the current adapter boundary have a measurable scheduling cost because a retained-budget waiter enters through the scheduler-injected `loadTile()` callback and therefore already consumes one `activeLoads` slot before retained-byte admission is granted?

## Method

`engine/streaming/benchmark_retained_admission_priority.mjs` creates a deterministic five-tile synthetic path with:

- `maxConcurrentLoads=2`;
- `maxRetainedBytes=200`;
- 100 B per synthetic tile;
- two initially committed tiles filling the retained-byte budget;
- two subsequently desired tiles (`C`, `E`) that start scheduler loads and wait for retained-budget capacity;
- camera reprioritization to a newly desired tile (`D`) while the two older waiters retain both scheduler load slots.

When the two initial committed tiles are disposed, the lifecycle adapter's FIFO queue grants capacity to the already-waiting `C` and `E`. Their materializers are deliberately held so the benchmark can observe whether `D` starts before an occupied scheduler slot becomes available.

## Exact hosted evidence

Exact code head: `84909a5c77c031db00ffcf08a41ab50267035dff`.

GitHub Actions `strom-retained-budget` run `32227766134` / #17: **SUCCESS** on Node 22.

The same run preserves:

- `retained byte budget regressions: PASS (5 cases)`;
- `retained budget lifecycle adapter regressions: PASS (5 cases)`;
- the existing 3-/2-/1-tile retained-byte accounting benchmark with `overcommitBytes=0`.

New benchmark observations:

| Observable | Result |
| --- | ---: |
| retained-budget waiters before reprioritization | 2 |
| scheduler active load slots occupied under pressure | 2 / 2 |
| stale waiter materializations before current desired tile | 2 |
| current desired `D` started before stale release | false |
| blocked-phase active loads | 2 |
| blocked-phase scheduler queue depth | 1 |
| final active loads | 0 |
| final queue depth | 0 |
| final retained committed bytes | 0 |
| final retained reserved bytes | 0 |
| retained accounting overcommit | 0 |

Materialization start order before release is `A, B, C, E`; `D` is absent. The completed run also records one cancellation during cleanup, zero load failures, zero lifecycle failures, and peak active loads of exactly two.

## What this proves

The previously documented adapter limitation is real under a deterministic pressure case: already-started retained-budget waiters can consume all scheduler load slots and retain FIFO admission order across a later camera reprioritization. A newly desired higher-priority tile can therefore remain queued behind stale-but-retained work until at least one occupied slot completes or is cancelled.

This is a scheduler responsiveness issue, not a byte-accounting correctness failure. The retained-byte gate still finishes with zero reservation/commit leakage and zero overcommit.

## What this does not prove

This synthetic run does not establish the real-world magnitude of the delay, a production retained-byte cap, a worker-pool size, a cache/LOD policy, Android performance, GPU/VRAM behavior, or any neighboring DTM1 terrain claim.

## Architecture consequence

There is now evidence to justify testing a renderer-neutral **pre-start admission hook** at the scheduler boundary so resource admission can happen before `activeLoads` is consumed. The hook should remain injected/composable rather than embedding retained-byte or renderer policy directly into `TileStreamingScheduler`, and it must support cancellation plus current-priority re-evaluation before admission.

No production policy is selected by this proof, so `docs/04-decisions.md` remains unchanged.

## Boundaries preserved

- no raw Kartverket/NVDB/OSM runtime calls;
- no RuntimeVerificationBundle weakening;
- no DTM1 seam policy;
- no renderer/WebGPU/WebGL-specific streaming-core logic;
- no production RAM/GPU/cache/LOD budget selected.

## Next gate

Implement the smallest injected pre-`#startLoad` admission contract and adversarially test camera reprioritization, cancellation while waiting, admission rejection/failure, stale completion, and bounded concurrency. Then rerun this exact pressure scenario to require `D` to overtake no-longer-desired waiters without exceeding the retained-byte or load-concurrency ceilings.
