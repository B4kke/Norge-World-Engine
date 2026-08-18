# engine/streaming

Production-direction runtime loading, provenance verification, cache/LOD scheduling and observability live here. This module must remain renderer-independent unless a later decision explicitly changes that boundary.

## Current Prototype-0 components

- `runtime_verifier.mjs` — reconstructs provenance and verifies exact compiled artifact bytes before `READY_FOR_RUNTIME`.
- `tile_scheduler.mjs` — deterministic camera-distance tile interest, bounded concurrent loading, resident↔cache lifecycle, retention radius, byte-budget eviction and stale-load rejection.
- `test_tile_scheduler.mjs` — scheduler lifecycle/adversarial regressions.
- `benchmark_tile_scheduler.mjs` — synthetic 3×3 Nannestad scheduler simulation. It tests runtime scheduling mechanics only and does **not** claim that neighbouring Nannestad geodata/artifacts exist yet.

## Scheduler contract

`TileStreamingScheduler` consumes opaque tile descriptors with a stable `id`, `centerE` and `centerN`. It deliberately does not define the final whole-Norway tile-addressing scheme; that remains an open architectural decision.

The injected `loadTile(tile, {signal})` callback must return only after the tile payload has passed whatever artifact verification/decode gate the caller requires. The scheduler never contacts source geodata APIs and never promotes data. It only decides which already-runtime-eligible tile payloads should be loading, resident, cached or evicted.

Renderer-specific scene work stays behind injected `activateTile`, `deactivateTile` and `disposeTile` callbacks. This keeps Three.js/WebGPU/Cesium/Unreal choices outside the scheduling core.

## Current observables

Snapshots report at least:

- queue depth and active loads;
- current/peak concurrency;
- resident/cached/failed counts;
- cache hits/misses;
- cached bytes and peak bytes;
- activations/deactivations/evictions;
- abort requests and stale completions dropped.

These metrics are lifecycle evidence, not a substitute for device frame-time/GPU/network measurements.

## Current non-decisions

- no final Norway-wide tile index;
- no accepted LOD metric beyond Prototype-0 distance prioritization;
- no renderer choice;
- no claim that a synthetic 3×3 scheduling test equals real multi-tile streaming.
