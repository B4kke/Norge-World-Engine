# engine/streaming

Production-direction runtime loading, provenance verification, cache/LOD scheduling and observability live here. This module must remain renderer-independent unless a later decision explicitly changes that boundary.

## Current Prototype-0 components

- `runtime_verifier.mjs` — reconstructs provenance and verifies exact compiled artifact bytes before `READY_FOR_RUNTIME`.
- `tile_scheduler.mjs` — deterministic camera-distance tile interest, bounded concurrent loading, resident↔cache lifecycle, retention radius, separate inactive-cache/resident payload accounting, priority-preserving resident-byte preemption, update-driven retry controls and stale-load rejection.
- `test_tile_scheduler.mjs` — scheduler lifecycle/adversarial regressions.
- `test_tile_scheduler_retry.mjs` — deterministic retry-delay, retry-cap and interest-cycle regressions.
- `test_tile_scheduler_resident_priority.mjs` — resident-byte priority inversion, oversized-candidate and deterministic tie-break regressions.
- `benchmark_tile_scheduler.mjs` — synthetic 3×3 Nannestad scheduler simulation with constrained resident/cache byte stress. It tests runtime scheduling mechanics only and does **not** claim that neighbouring Nannestad geodata/artifacts exist yet or select production budgets.
- `benchmark_tile_scheduler_profiles.mjs` — deterministic synthetic 3×3 comparison across loose/balanced/tight resident+inactive-cache caps using one fixed movement path. It reports refetches, cache reuse, resident preemption/deferral, eviction, activation/deactivation churn and retained-byte peaks. The profiles are experiment inputs only, not production/device policy.
- `terrain_mesh_buffers.mjs` — deterministic renderer-independent height-grid → position/normal/UV/index buffer construction using the same pixel-center bilinear sampling semantics as Forsøk 16.
- `terrain_mesh_worker_protocol.mjs` + `terrain_mesh_worker.mjs` — Dedicated Worker job/result contract for mesh construction.
- `terrain_mesh_worker_client.mjs` — browser-side one-job worker client with AbortSignal cancellation and typed-buffer rehydration.
- `terrain_tile_loader.mjs` — full verified terrain runtime path: runtime-input resolve → provenance/byte verification → strict NWEHGT01 decode → mesh worker → renderer-neutral payload with phase timings.
- `terrain_load_observer.mjs` — non-authoritative wrapper that correlates scheduler load-attempt identity with completed phase timings or failed/aborted attempts without allowing telemetry-sink failure to change tile lifecycle.
- `streaming_trace_recorder.mjs` — bounded renderer-neutral movement trace that joins scheduler events, scheduler snapshots and terrain load observations for browser/device evidence capture.

## Scheduler contract

`TileStreamingScheduler` consumes opaque tile descriptors with a stable `id`, `centerE` and `centerN`. It deliberately does not define the final whole-Norway tile-addressing scheme; that remains an open architectural decision.

The injected `loadTile(tile, {signal, attempt})` callback must return only after the tile payload has passed whatever artifact verification/decode gate the caller requires. The scheduler never contacts source geodata APIs and never promotes data. It only decides which already-runtime-eligible tile payloads should be loading, resident, cached or evicted.

Renderer-specific scene work stays behind injected `activateTile`, `deactivateTile` and `disposeTile` callbacks. This keeps Three.js/WebGPU/Cesium/Unreal choices outside the scheduling core. Activation failure keeps the verified payload cached for a later activation retry instead of forcing a source/runtime-input refetch; disposal failure keeps the payload and byte accounting intact rather than pretending memory was released.

`maxCacheBytes` is specifically an **inactive cached-payload** budget. Resident payload bytes do not consume it. `maxResidentBytes` is an optional hard cap over scheduler-known payload bytes in `resident + activating`; it defaults to `null`, so no production resident-byte budget is selected by the core. This is a CPU/runtime-payload accounting boundary, not a claim about exact GPU/VRAM allocation. LUMEN may enforce renderer-resource budgets through the adapter layer once browser/device measurements justify a policy.

When a configured resident-byte cap is full, activation must not preserve a priority inversion merely because a lower-priority tile happened to finish loading first. A desired cached tile may therefore deactivate strictly lower-priority resident tiles until the configured cap has room. Priority uses the same deterministic distance + tile-id ordering as candidate ranking. A tile that cannot fit even in an otherwise empty resident budget is deferred without evicting useful resident state. This defines behavior **under a caller-supplied hard cap**; it does not select the cap itself.

During an asynchronous activation, bytes move through an explicit `activating` bucket. This reserves resident capacity before the adapter awaits GPU/scene work, so concurrent load completions cannot both pass the same resident budget and overcommit it.

Load retry is deliberately **update-driven** rather than timer-owned by the streaming core. `retryDelayMs` gates when a failed desired tile may be re-queued, and optional `maxLoadAttemptsPerInterest` bounds repeated failures while the same tile remains desired. Leaving the interest set resets that failure cycle. Defaults remain `retryDelayMs = 0` and `maxLoadAttemptsPerInterest = null`, preserving the previous behavior and avoiding an unmeasured production retry policy. Runtime snapshots/events expose attempts, retry-not-before, queued retries, deferrals and exhaustion.

## Budget-profile benchmark interpretation

The multi-profile scheduler benchmark intentionally stresses the same synthetic 3×3 tile set and movement path under three different caps. Its purpose is to expose trade-offs, not nominate a winner.

On the current hosted run, progressively tighter profiles reduced peak retained payload bytes but increased refetches and evictions. Raw cache-hit count did **not** decline monotonically because constrained resident capacity sends more desired payloads through the cached state before later reuse. Activation/deactivation count also declined under the tightest profile because more desired activations were budget-deferred. Therefore neither cache hits nor lifecycle-churn count is a sufficient optimization target alone; interpret them together with refetches, evictions, deferrals, desired coverage and retained bytes.

`peakBytesCached` may exceed the configured inactive-cache target transiently while concurrent load completions materialize payloads before post-completion cache enforcement. Idle snapshots in the benchmark still require `cacheBudgetOvercommitBytes === 0`. This distinction matters: `maxCacheBytes` is currently an inactive-cache policy, **not** a hard total-runtime-memory ceiling. Any future hard retained-memory cap must explicitly account for loading/completion/activation transients rather than silently reusing the inactive-cache setting.

## Terrain mesh job boundary

Forsøk 16 measured ~19.4 ms for synchronous construction of one 129×129 terrain mesh, which is greater than one 60 Hz frame budget. The worker path therefore treats the already-verified DTM height grid as input world truth and produces only a render derivative:

`verified Float32 height grid -> worker mesh job -> transferable position/normal/UV/index ArrayBuffers -> renderer upload`

The worker does **not** alter CRS, tile bounds, NN2000 values, provenance or artifact identity. It fails closed on nodata/non-finite samples rather than silently inventing a height.

The browser client transfers ownership of the elevation `ArrayBuffer` into the worker and the protocol transfers the same elevation buffer back with the mesh output. That avoids a required 4 MB structured-clone copy for the current 1000×1000 float32 tile while allowing the caller to recover the height grid for later road/building sampling. This follows the standard Dedicated Worker transferable-object model; a transferred buffer is temporarily unavailable to the sending context until ownership is returned.

The current client uses a dedicated worker per job because cancellation can then terminate the whole worker deterministically. Worker pooling is deliberately postponed until device evidence shows whether worker creation cost matters for multi-tile streaming.

## Movement evidence trace

`createStreamingTraceRecorder()` accepts the scheduler `onEvent` stream, `terrain_load_observer` observations and explicit scheduler snapshots without learning anything about WebGL/WebGPU scene objects. The exported `nwe.streaming-movement-trace/0.1` trace preserves ordering with a monotonically increasing sequence, carries caller-supplied capture metadata, and has a hard `maxEntries` retention bound. When the trace fills, oldest entries are discarded and `droppedEntries` records the evidence loss instead of allowing telemetry memory to grow without bound.

The trace is an observability artifact, not world truth. LUMEN may add renderer/device measurements beside it in the browser harness, but renderer-specific upload/GPU/rAF data remains outside streaming core.

## Current observables

Scheduler snapshots report at least:

- queue depth and active loads;
- current/peak concurrency;
- resident/activating/cached/failed counts;
- cache hits/misses;
- current resident, activating, inactive-cache and total retained payload bytes;
- peak resident, activating, inactive-cache and retained payload bytes;
- cache/resident budget overcommit bytes, resident-budget deferrals and resident-budget priority preemptions;
- load attempts, retry-not-before, retries queued, retry deferrals and retry exhaustion;
- activations/deactivations/evictions plus activation/deactivation/disposal/lifecycle failures;
- abort requests and stale completions dropped.

Successful terrain payloads report runtime-input resolve, verification, strict decode, worker roundtrip, worker-reported CPU and total load timing. `createObservedTerrainTileLoadFunction()` can wrap the loader before it is injected into the scheduler and emits one immutable observation per attempt with `tileId`, scheduler `attempt`, completed/failed/aborted status, wrapper wall time, retained bytes/artifact hash on success, phase timings on success, and original error identity on failure. The observer callback is isolated so telemetry collection cannot convert a successful load into a runtime failure.

Device-level main-thread hitch, worker startup/transfer cost and GPU upload still require Android/browser measurement. The trace recorder provides a stable bounded handoff for correlating those device traces with scheduler movement/retry/cancellation events; it does not itself prove device performance.

## Current non-decisions

- no final Norway-wide tile index;
- no accepted LOD metric beyond Prototype-0 distance prioritization;
- no renderer choice;
- no production `maxResidentBytes`, inactive-cache size or GPU/VRAM budget selected from the synthetic stress benchmark;
- no production retry delay or retry-attempt cap selected without real failure/device evidence;
- no worker-pool size/persistence policy;
- no production telemetry-retention size selected; recorder limits are caller configuration;
- no claim that a synthetic 3×3 scheduling test equals real multi-tile streaming;
- no claim that hosted Node mesh timing equals Android browser worker timing.