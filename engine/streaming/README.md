# engine/streaming

Production-direction runtime loading, provenance verification, cache/LOD scheduling and observability live here. This module must remain renderer-independent unless a later decision explicitly changes that boundary.

## Current Prototype-0 components

- `runtime_verifier.mjs` — reconstructs provenance and verifies exact compiled artifact bytes before `READY_FOR_RUNTIME`.
- `tile_scheduler.mjs` — deterministic camera-distance tile interest, bounded concurrent loading, resident↔cache lifecycle, retention radius, byte-budget eviction and stale-load rejection.
- `test_tile_scheduler.mjs` — scheduler lifecycle/adversarial regressions.
- `benchmark_tile_scheduler.mjs` — synthetic 3×3 Nannestad scheduler simulation. It tests runtime scheduling mechanics only and does **not** claim that neighbouring Nannestad geodata/artifacts exist yet.
- `terrain_mesh_buffers.mjs` — deterministic renderer-independent height-grid → position/normal/UV/index buffer construction using the same pixel-center bilinear sampling semantics as Forsøk 16.
- `terrain_mesh_worker_protocol.mjs` + `terrain_mesh_worker.mjs` — Dedicated Worker job/result contract for mesh construction.
- `terrain_mesh_worker_client.mjs` — browser-side one-job worker client with AbortSignal cancellation and typed-buffer rehydration.

## Scheduler contract

`TileStreamingScheduler` consumes opaque tile descriptors with a stable `id`, `centerE` and `centerN`. It deliberately does not define the final whole-Norway tile-addressing scheme; that remains an open architectural decision.

The injected `loadTile(tile, {signal})` callback must return only after the tile payload has passed whatever artifact verification/decode gate the caller requires. The scheduler never contacts source geodata APIs and never promotes data. It only decides which already-runtime-eligible tile payloads should be loading, resident, cached or evicted.

Renderer-specific scene work stays behind injected `activateTile`, `deactivateTile` and `disposeTile` callbacks. This keeps Three.js/WebGPU/Cesium/Unreal choices outside the scheduling core.

## Terrain mesh job boundary

Forsøk 16 measured ~19.4 ms for synchronous construction of one 129×129 terrain mesh, which is greater than one 60 Hz frame budget. The worker path therefore treats the already-verified DTM height grid as input world truth and produces only a render derivative:

`verified Float32 height grid -> worker mesh job -> transferable position/normal/UV/index ArrayBuffers -> renderer upload`

The worker does **not** alter CRS, tile bounds, NN2000 values, provenance or artifact identity. It fails closed on nodata/non-finite samples rather than silently inventing a height.

The browser client transfers ownership of the elevation `ArrayBuffer` into the worker and the protocol transfers the same elevation buffer back with the mesh output. That avoids a required 4 MB structured-clone copy for the current 1000×1000 float32 tile while allowing the caller to recover the height grid for later road/building sampling. This follows the standard Dedicated Worker transferable-object model; a transferred buffer is temporarily unavailable to the sending context until ownership is returned.

The current client uses a dedicated worker per job because cancellation can then terminate the whole worker deterministically. Worker pooling is deliberately postponed until device evidence shows whether worker creation cost matters for multi-tile streaming.

## Current observables

Scheduler snapshots report at least:

- queue depth and active loads;
- current/peak concurrency;
- resident/cached/failed counts;
- cache hits/misses;
- cached bytes and peak bytes;
- activations/deactivations/evictions;
- abort requests and stale completions dropped.

Terrain mesh jobs report deterministic vertex/triangle/index counts, output byte size and worker CPU duration. Device-level main-thread hitch, worker startup/transfer cost and GPU upload still require Android/browser measurement.

## Current non-decisions

- no final Norway-wide tile index;
- no accepted LOD metric beyond Prototype-0 distance prioritization;
- no renderer choice;
- no worker-pool size/persistence policy;
- no claim that a synthetic 3×3 scheduling test equals real multi-tile streaming;
- no claim that hosted Node mesh timing equals Android browser worker timing.
