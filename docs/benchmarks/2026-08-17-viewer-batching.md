# P0 viewer batching benchmark — 2026-08-17

Issue: #5  
Agent: VEKTOR  
Hosted proof run: GitHub Actions `viewer-benchmark` run `32070164784`  
Branch SHA exercised: `a3d1728a73c7e07bb30d4805bd823f23f8607f7c`

## Question

Can the current real Nannestad road/building artifact set be rendered with materially fewer draw calls without changing geographic geometry, artifact identity, source contracts, CRS/datum or runtime provenance rules?

## Inputs and invariants

The hosted workflow performs a fresh real-data compile, then requires `runtime_verifier.mjs` to return `READY_FOR_RUNTIME` for each exact artifact byte stream before the browser benchmark can consume it.

Exact compiled inputs used by the browser:

- roads: 246 paths, 171,732 B, SHA-256 `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- buildings: 135 footprints, 80,846 B, SHA-256 `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`;
- total rendered logical objects: 381;
- building height metadata: 15 source-backed, 120 unresolved. The benchmark does not invent debug extrusion for unresolved heights.

The browser uses a fixed top-down full-tile camera over EPSG:25832 bounds `[611000, 6677000, 612000, 6678000]`. The same line-buffer contents and camera are used before and after batching. EPSG:25832 XY is deterministically rebased to local tile origin `[611000, 6677000]` before Float32 GPU upload so large northing values do not unnecessarily consume Float32 precision; original artifact coordinates remain unchanged and are retained for debug/source tracing.

Runtime networking is restricted to the local benchmark server. Raw NVDB/OSM/Kartverket/Overpass references are rejected. Hosted result: **0 raw-source runtime calls**; the four runtime fetches were two bundles plus their two compiled artifacts.

## A/B result

| Metric | Per-object | Batched | Observation |
|---|---:|---:|---|
| Draw calls | 381 | 2 | -379 / 99.475% reduction |
| Frame-time average | 21.108 ms | 17.498 ms | hosted/headless only |
| Frame-time p95 | 50.0 ms | 16.7 ms | hosted/headless only |
| Derived FPS from average interval | 47.37 | 57.15 | hosted/headless only |
| Synchronous draw+`gl.finish()` average | 0.110 ms | 0.045 ms | relative harness evidence |
| Synchronous draw+`gl.finish()` p95 | 0.300 ms | 0.100 ms | relative harness evidence |
| JS heap used at sample end | 2,781,065 B | 2,818,917 B | no material memory reduction claimed |

Additional measurements:

- road line vertices: 4,744;
- building line vertices: 2,886;
- GPU line-buffer bytes: 183,120 B;
- artifact verify/decode: roads 27.8 ms, buildings 22.0 ms;
- geometry build: 8.1 ms;
- GPU upload/context setup: 589.4 ms;
- boot to first visible: 631.1 ms;
- hosted browser: Chrome 151 / WebGL2;
- requestAnimationFrame fallback fired 5 times, so hosted frame-interval/FPS numbers are scheduler-tainted and must **not** be treated as Android GPU performance.

The Issue #5 investigative target of fewer than roughly 100 draws is therefore met structurally on the same 381-object vector scene: **381 -> 2 draws**.

## Debug/source traceability

Normal rendering remains batched. A click is resolved CPU-side against the original artifact coordinates and returns:

- roads: `path_id`, `road_type`, `source_segment_ids`, `source_sequence_ids`, length and source points;
- buildings: `source_id`, area, source-backed/unresolved height provenance, clipping flag and source polygon.

Batching therefore does not require discarding the object-to-source QA path.

## Interpretation

**Proven:** per-object submission is unnecessary for this vector layer. The same compiled artifact geometry can be grouped into two semantic batches while keeping source-debug identity outside the draw-call boundary. No compiler, CRS, datum, source acquisition or artifact identity change is required.

**Not proven:** this hosted software/headless measurement is not a claim that the Android device will have the same frame times, GPU cost or first-visible time. The next device measurement must use the same artifact hashes, camera contract and batched path and record Android frame time, draw calls, memory and visual/source-debug correctness.

**No architecture decision:** WebGL2 is used here as a minimal measurement harness. This benchmark does not select WebGL2, WebGPU, Three.js, CesiumJS or another renderer for production.