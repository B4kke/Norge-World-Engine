# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-COORDINATES-01 — World state vs render-local coordinates
**Status:** PRECISION + ORIGIN-SHIFT INVARIANTS PASS / WHOLE-NORWAY POLICY OPEN  
**Owner area:** `engine/world`, future simulation/runtime boundary  
**Done/evidence:** merged isolated precision and origin-shift experiments prove that absolute EPSG:25832-scale Float32 coordinates are too coarse for a high-quality renderer, while high-precision world state can remain independent of disposable render-local Float32 coordinates. The deterministic origin experiment ran **2,048 entities for 3,600 ticks with 29 render-origin shifts** and ended with exactly identical Float64 world positions and velocities versus a fixed-origin control; max local reconstruction error was **0.244141 mm**. A temporal regression proves that local-frame deltas across an origin shift are not physical motion: a 3 km origin shift can appear as ~180 km/s false velocity unless the origin epoch/delta is compensated.  
**Performance evidence:** hosted Node/V8 directional benchmark at 100k entities measured median ~0.279 ms Float64 world integration and ~0.218 ms Float32 local derivation/rederive. This is not Android/browser/GPU/physics-engine acceptance evidence.  
**Open:** choose/measure the actual world coordinate model, render-origin anchor and shift threshold, origin epoch contract for temporal systems, and later physics/network interaction. Do not turn the prototype numbers into a whole-Norway threshold without camera/device/physics evidence.

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** MERGED / REAL-DATA COLD+OFFLINE + COMPILED ARTIFACT + RUNTIME + ANDROID CONSUMER PASS  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** official Kartverket/Geonorge Atom service selects exactly one Nannestad DTM1 source, `33-125-117.tif`; raw source is 1,096,856,487 B, EPSG:25833 + NN2000, 1 m float32 with raw SHA `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`. Compiler streams it into content-addressed raw cache, explicitly warps it with Rasterio/GDAL to the fixed 1000 × 1000, 1 m EPSG:25832 + NN2000 Nannestad grid using bilinear resampling, and emits normalized SHA `95c8fcf6f93c8fbb0533d6a82d68416b773f9a146970e1ae85676d3ba41c2adf`.  
**Compiled artifact:** `nwe.terrain-height-grid-artifact/0.1`, 4,000,382 B / 1,000,000 float32 samples, SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`. Cold and source-network-free offline runs are byte-identical; runtime verifier returns `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`. Android Forsøk 16 consumes that terrain artifact together with the proven vector artifacts, reports terrain PASS / `READY ×3`, samples road/building ground Z from DTM1 and keeps raw source networking blocked at 0 calls.  
**Proof:** `docs/proofs/2026-08-17-nannestad-dtm1-realdata.md` and `docs/proofs/2026-08-17-forsok16-android-runtime.md`.  
**Next:** single-tile terrain source/compiler/runtime integration is no longer the immediate blocker. Whole-Norway DTM acquisition/LOD format remains open.

### P0-MULTITILE-TERRAIN-01 — Real neighboring terrain promotion
**Status:** HIGHEST OPEN TERRAIN GATE / MULTI-TILE FOUNDATION MERGED / REAL SEAM POLICY OPEN  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** merged multi-tile foundation separates runtime 1 km tile identity from Kartverket source tiling, binds tile-specific cache/lineage, reuses exact SHA-addressed raw source objects, supports plural SourceSnapshot provenance and fails closed on ambiguous source coverage. Live Nannestad 3×3 source planning resolves **9 runtime tiles**, **2 unique DTM1 raw files** and **2 runtime tiles requiring both sources** because the EPSG:25833 source grid crosses the EPSG:25832 runtime grid.  
**Critical blocker:** the two authoritative raw files overlap by 10 m but their valid heights are not identical. The current production mosaic deliberately rejects the overlap instead of choosing first/newest/mean/tolerance. Dedicated diagnostics compare candidate surfaces to Kartverket's seamless 1 m WCS only as an independent QA sensor; WCS is not admitted as source authority and no official Kartverket overlap-priority rule has yet been found.  
**Acceptance:** document an evidence-backed deterministic seam transform with explicit provenance/config identity, then run one controlled cold live 3×3 compile followed by source-network-free offline repeat. Require 9 independently identified artifacts/bundles, identical cold/offline artifact hashes, 9/9 `READY_FOR_RUNTIME`, no raw TIFFs in Git/evidence uploads, and unchanged center-tile bytes from the accepted single-tile vertical.  
**Do not claim:** a real 3×3 terrain artifact pass until this gate executes successfully.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** LIVE DTM1 SOURCE + MULTI-SOURCE SET PLANNING PASS  
**Owner area:** `engine/compiler`  
**Done/evidence:** production parser uses GeoRSS lat/lon -> lon/lat normalization and Shapely actual `covers`; bbox remains prefilter only. Live official DTM1 dataset feed contained 2033 polygon entries in EPSG:25833. Single-tile selection resolves the accepted Nannestad file from the explicit `rel=section`, `type=application/geotiff` link; filename/title guessing is forbidden. Multi-tile source-set planning also requires the declared geometry union to cover the runtime tile and fails closed on ambiguous minimal source sets.  
**Next:** reuse the same fail-closed pattern for later terrain/source families rather than generalizing from filenames.

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** IMPLEMENTED + STRICT SCHEMA CONTRACT MERGED + REAL VECTOR/TERRAIN + MULTI-SOURCE GRAPH SUPPORT  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Evidence:** public hosted baseline installs Python `rfc8785` and Node `canonicalize`, executes cross-language JCS and adversarial runtime regressions, and passes. Real Nannestad road, building and single-source terrain bundles are reconstructed against exact artifact bytes and return `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`. Runtime verifier enforces graph closure and plural source-snapshot references for multi-source terrain contracts. Strict JSON Schema 2020-12 contracts are merged and producer-compatibility tests cover vector, accepted single-source terrain and the current fail-closed multi-source shape.  
**Open:** the full graph-reconstructing verifier currently depends on Node `crypto`; the browser viewer has WebCrypto byte/size verification but not the same full JCS graph reconstruction. A browser-compatible full verifier is required before the web client can claim parity with the Node runtime gate.

### P0-NVDB-01 — Road adapter
**Status:** REAL-DATA VERTICAL PASS / WIDTH + PHYSICAL SURFACE SEMANTICS OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** NVDB V4 acquisition sends required `X-Client: NorgeWorldEngine-Compiler`; raw JSON is validated/hashed/cached outside Git, EPSG:25833 -> EPSG:25832 is explicit, valid NN2000 Z is preserved, Shapely clips the 1 km tile and compatible degree-2 chains are collapsed. Hosted real-data proof: **471 raw -> 407 normalized segments -> 246 road paths**, raw SHA `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`, artifact SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`. Cold total 2168.958 ms; warm/offline 148.363 ms with identical artifact SHA. Forsøk 16 keeps valid NVDB NN2000 centerline Z and uses DTM1 only as ground/fallback.  
**Next:** separate topology from physical surface width/lane/crossfall semantics; do not infer authoritative asphalt width solely from `typeVeg`. The current visual road ribbon gives both lateral edges centerline Z and is not an authoritative road-surface model.

### P0-BUILDINGS-01 — Building volumes
**Status:** REAL FOOTPRINT + DTM GROUNDING PASS / HEIGHT + RELATION ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** OSM API 0.6 source is hashed/cached, WGS84 -> EPSG:25832 is explicit, Shapely validates/clips polygons, and explicit `height` / `building:levels` provenance is preserved without silent authoritative fallback. Hosted real-data proof: **5,704 raw elements / 141 building candidates -> 135 validated+compiled footprints**, artifact SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`. Cold total 1145.537 ms; warm/offline 63.811 ms with identical artifact SHA. Forsøk 16 grounds footprint bases against the real DTM1 artifact.  
**Android evidence:** 15/135 building heights are source-backed; **120/135 remain explicit 5 m debug fallback**.  
**Still open:** OSM multipolygon relations, DOM-DTM height enrichment as a separate provenance-bearing transform, and capability-gated FKB evaluation. Unresolved height must remain unresolved in authoritative data.

### P0-VECTOR-ARTIFACT-01 — Persisted road/building runtime artifacts
**Status:** REAL-DATA COLD/WARM + RUNTIME VERIFICATION + ANDROID TERRAIN-INTEGRATED VISUAL PASS  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Done/evidence:** raw SHA-addressed cache/offline fail-closed mode; normalized + compiled artifact chain; exact RuntimeVerificationBundle; Android Forsøk 15 consumes 246 road paths + 135 footprints from verified artifacts with raw NVDB/OSM/Overpass networking hard-blocked at **0 calls**. Forsøk 16 adds the verified DTM1 artifact and grounds the same vectors in the real terrain coordinate/Z frame without changing vector artifact identity.  
**Proof:** `docs/proofs/2026-08-17-nannestad-vector-realdata.md` and `docs/proofs/2026-08-17-forsok16-android-runtime.md`.  
**Next:** keep vector geometry stable while renderer batching, road physical-surface semantics and later building-height enrichment proceed independently.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** HOSTED REAL-ARTIFACT BATCHING MERGED + ANDROID TERRAIN/VECTOR PASS / ANDROID BATCHING GATE OPEN  
**Done/evidence:** Forsøk 16 SHA-verifies and renders the real terrain, road and building artifacts with 0 raw-source calls. The 1 m / 1000×1000 DTM1 artifact remains world truth while the mobile GPU terrain is sampled to 129×129. Android screenshot evidence reports **1.3 ms terrain decode, 19.4 ms terrain mesh build, 220 ms boot, 224 draw calls, 16.7 ms / 60 FPS, 382 geometries and 2 textures** at the captured oblique camera. The merged fixed-camera real-artifact batching harness uses 246 road paths + 135 building footprints (381 logical vector objects) and reduces submissions **381 -> 2 draw calls** while keeping raw-source runtime calls at 0. Final pre-merge run `32135092313` reported frame p95 **50.0 -> 16.7 ms** and render-sync p95 **0.4 -> 0.2 ms** on hosted headless Chrome; the earlier QA run reported the same 381→2 draw reduction with different hosted timing.  
**Important limitation:** hosted/headless timing is comparative harness evidence, not Android GPU acceptance. Building benchmark remains footprint-only; 120/135 building heights are still unresolved rather than silently promoted.  
**Next:** run the same fixed-camera before/after batching comparison on Android and measure GPU/main-thread behavior. Do not select WebGL/WebGPU/Cesium from hosted timing alone.  
**Parallel issue:** GitHub Issue #5 owns viewer batching/performance and contains the Forsøk 16 device baseline.

### P0-STREAMING-01 — Verified terrain tile lifecycle
**Status:** SCHEDULER + WORKER + EXACT REAL ARTIFACT PIPELINE PASS / BROWSER + ANDROID MOVEMENT GATES OPEN  
**Owner area:** `engine/streaming`  
**Done/evidence:** renderer-independent `TileStreamingScheduler` provides deterministic camera-distance priority, active/retain radii, max resident count, max concurrent loads, resident↔cached lifecycle, inactive-cache byte budget/eviction, load aborts, stale-completion rejection, failure retry and lifecycle metrics. The Dedicated Worker boundary generates deterministic renderer-neutral terrain mesh buffers and returns elevation ownership. `terrain_tile_loader.mjs` composes `RuntimeVerificationBundle + artifact bytes -> full verification -> strict NWEHGT01 semantic decode -> worker -> scheduler payload` without importing a renderer or choosing an origin policy. Hosted baseline passes 7 adversarial integration cases.  
**Exact real-data proof:** main run `32134507528` on merge commit `909cf5d0cdf7489feff7f44ba12983a051e5affe` drove the accepted Nannestad artifact through cold/offline compile, full runtime verification, strict loader decode, `TerrainMeshWorkerClient` protocol path and scheduler resident lifecycle. Artifact stayed **4,000,382 B / SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`**, retained elevations were **1,000,000 samples / 4,000,000 B**, 129×129 mesh was **16,641 vertices / 32,768 triangles / 729,120 B**, scheduler retained bytes were **4,729,120 B**, and load completed 1/1 with zero failures or budget overcommit. Offline source requests remained 0.  
**Hosted timing:** full verification ~4.0 ms, strict decode/validation ~29.8 ms, worker-client/protocol path ~44.7 ms, total loader ~82.3 ms. This uses a protocol-compatible in-process Worker shim and is not Android/browser real-thread performance evidence.  
**Proof:** `docs/proofs/2026-08-18-terrain-runtime-pipeline.md`.  
**Open:** browser full-provenance parity, actual Dedicated Worker transfer/startup, GPU upload/apply, rAF gaps and camera movement. Real 2×2/3×3 terrain remains blocked by `P0-MULTITILE-TERRAIN-01`. Hard resident/GPU budgets, worker pooling and LOD remain unselected until device movement evidence exists.  
**Next:** implement browser-compatible full provenance reconstruction without Node `crypto`, then run the accepted artifact through real browser worker + movement instrumentation. In parallel, resolve the DTM1 seam contract before claiming real neighboring terrain.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE BUILD PASS / SHARED TERRAIN+VECTOR RENDER ARTIFACT OPEN  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done:** pinned glTF-Transform/meshoptimizer/3D Tiles tools and CesiumJS baseline; hosted baseline builds the Cesium harness.  
**Next:** after the custom viewer has a repeatable fixed-camera benchmark for the same real terrain+vector inputs, generate/validate an equivalent render artifact for Cesium and compare on the same device/data: cold/warm bytes, RAM, first-visible, frame time, draw calls and tile churn. No renderer decision before evidence.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** RESOLVED  
Repository is public and GitHub-hosted runners execute normally. Baseline passes on `main` and active P0 branches. `baseline-self-hosted.yml` remains only as an optional controlled fallback.

### INFRA-CI-02 — Real-data proof trigger hygiene
**Status:** RESOLVED / MERGED  
DTM1, vector and viewer real-data workflows have reusable main/PR/manual trigger contracts rather than historical agent-branch assumptions. Heavy DTM seam diagnostics remain manual evidence gates to avoid repeated multi-GB downloads without new information.

## Explicitly deprioritized until current P0 evidence is integrated

- renderer polish and photorealism beyond QA;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain/viewer measurement;
- production imagery dependency before redistribution/cache rights are documented.
