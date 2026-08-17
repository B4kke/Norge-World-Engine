# Synthetic 3×3 world-streaming scheduler proof — 2026-08-17

Status: **PASS as scheduler/lifecycle evidence only.**  
Branch: `agent/world-streaming-scheduler`, stacked on `agent/dtm1-terrain-vertical`.  
CI baseline run: `32070004948` on commit `907671a1e5f0dda49a5565d6e4bcbf15d7b92bae`.

## Scope

This proof tests the renderer-independent tile scheduler mechanics that are required before real multi-tile streaming. It does **not** claim that eight neighbouring Nannestad tiles have been acquired/compiled, does not choose a final Norway-wide tile index, does not select an LOD metric, and does not select Three.js/WebGPU/Cesium/Unreal.

The scheduler treats the tile payload as opaque. Its injected `loadTile()` callback is expected to return only after the caller's runtime artifact verification/decode boundary. Raw Kartverket/NVDB/OSM services are outside the scheduler contract.

## Implemented lifecycle

- deterministic distance-based camera priority;
- active radius + larger retention radius;
- resident-tile cap;
- bounded concurrent loads;
- queued/loading/resident/cached/failed states;
- warm cache reactivation without refetch;
- inactive-cache byte budget and deterministic oldest-inactive eviction;
- abort requests for no-longer-relevant in-flight work outside the retain radius;
- generation/load-token guard so a late completion cannot resurrect an aborted tile;
- failed load can retry on a later interest update;
- injected activate/deactivate/dispose callbacks keep renderer ownership outside `engine/streaming`;
- lifecycle observability for queue, concurrency, cache, evictions, failures and stale completions.

## Adversarial regressions

`engine/streaming/test_tile_scheduler.mjs` passes six cases on hosted CI:

1. distance ranking is deterministic; duplicate tile identities fail closed;
2. synthetic 3×3 interest can load nine tiles while observed load concurrency never exceeds two;
3. returning to a retained tile uses cached payload and does not refetch;
4. cache pressure evicts the oldest inactive cached tile;
5. an aborted stale load cannot later activate/resurrect its tile;
6. a transport/load failure enters `failed` and then successfully retries without poisoning the tile identity.

During self-review an abort/microtask race was found before handoff. The implementation now captures each `AbortController` locally before asynchronous work instead of rereading a mutable record controller after interest can change.

## Synthetic 3×3 benchmark

The benchmark creates nine **descriptors only** around the Nannestad P0 center and models each opaque verified runtime tile as 4.25 MiB. The camera path is:

`center -> east -> north-east -> center-return`

Configuration:

- active radius: 1100 m
- retain radius: 1700 m
- max concurrent loads: 2
- max resident tiles: 5
- inactive-cache budget: 24 MiB

Final cumulative metrics from the passing CI run:

- updates: **4**
- loads started/completed: **9 / 9**
- loads failed: **0**
- cache hits/misses: **2 / 9**
- activations: **11**
- deactivations: **6**
- evictions: **4**
- peak active loads: **2**
- final resident tiles: **5**
- final cached tiles: **0**
- final queue depth / active loads: **0 / 0**
- final retained bytes: **22,282,240 B**
- configured inactive-cache budget: **25,165,824 B**
- final budget overcommit: **0 B**
- peak retained bytes: **26,738,688 B**

The center-return step reaches the original five-tile resident set with only nine total loads over the entire four-position camera path. That is positive cache-reuse evidence, not network/device performance evidence.

## Important cache-budget interpretation

`maxCacheBytes` is currently an **inactive cache eviction budget, not a hard resident-memory ceiling**. During a transition the benchmark peaks at 26,738,688 B while the 24 MiB budget is 25,165,824 B because desired/resident tiles are never evicted merely to satisfy the inactive-cache budget. After transition/eviction the scheduler returns below budget.

A later device/runtime memory policy may need a separate hard resident/GPU budget. This proof intentionally does not pretend those two concepts are the same.

## What is proven

- a deterministic engine-independent interest/load/cache lifecycle exists;
- concurrency is bounded;
- cache reuse works;
- inactive cache eviction works;
- stale/failed work is contained and recoverable;
- scheduler metrics are available for later real multi-tile experiments;
- the scheduler core does not require a renderer framework or a final tile-addressing decision.

## What remains open

- real neighbouring terrain/vector artifacts;
- real HTTP/cache latency and bytes;
- browser/Android memory and GPU residency;
- first-visible latency;
- frame-time impact while loading/unloading;
- terrain mesh generation scheduling (Forsøk 16 measured 19.4 ms synchronous mesh build for one tile);
- LOD transitions and seam handling;
- final whole-Norway spatial tile index;
- cache persistence policy across browser sessions;
- worker vs incremental main-thread mesh construction.

## Next

1. Move terrain mesh/buffer construction behind a deterministic job boundary and compare synchronous versus worker/incremental execution without changing DTM world truth.
2. Then materialize a real 2×2/3×3 neighbouring terrain test and drive it through this scheduler while measuring source-free runtime artifact bytes, load/unload latency, retained memory, first-visible and frame-time distribution.
