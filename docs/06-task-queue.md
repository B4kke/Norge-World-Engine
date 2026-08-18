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
**Status:** HIGHEST OPEN TERRAIN GATE / MULTI-TILE FOUNDATION MERGED / BUFFERED-ROUTE GEOMETRY HYPOTHESIS SUPPORTED / REAL SEAM AUTHORITY OPEN  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** merged multi-tile foundation separates runtime 1 km tile identity from Kartverket source tiling, binds tile-specific cache/lineage, reuses exact SHA-addressed raw source objects, supports plural SourceSnapshot provenance and fails closed on ambiguous source coverage. Live Nannestad 3×3 source planning resolves **9 runtime tiles**, **2 unique DTM1 raw files** and **2 runtime tiles requiring both sources** because the EPSG:25833 source grid crosses the EPSG:25832 runtime grid.  
**New geometry evidence:** Kartverket/Data.norge documents the DTM1 Atom distribution as data split into nominal **15 km routes**. The retained exact source-plan metadata for `33-125-116.tif` / `33-125-117.tif` exposes declared EPSG:25833 extents of about **15,010 m**, adjacent center spacing of about **15,000 m** and about **10 m** declared overlap. A dedicated diagnostic therefore proves only that the pair is geometrically consistent with ~5 m symmetric padding around nominal 15 km cores; its contract hard-codes `production_seam_authority=false` / `authority_status=UNPROVEN`. This is not proof that those edge samples are disposable halo. See `docs/proofs/2026-08-18-dtm1-source-grid-geometry-audit.md`.  
**Critical blocker:** the two authoritative raw files overlap by 10 m but their valid heights are not identical. The current production mosaic deliberately rejects the overlap instead of choosing first/newest/mean/tolerance or inferred-core clipping. Dedicated diagnostics compare candidate surfaces to Kartverket's seamless 1 m WCS only as an independent QA sensor; WCS is not admitted as source authority and no official Kartverket overlap-priority/buffer-discard rule has yet been found.  
**Acceptance:** document an evidence-backed deterministic seam transform with explicit provenance/config identity, then run one controlled cold live 3×3 compile followed by source-network-free offline repeat. Require 9 independently identified artifacts/bundles, identical cold/offline artifact hashes, 9/9 `READY_FOR_RUNTIME`, no raw TIFFs in Git/evidence uploads, and unchanged center-tile bytes from the accepted single-tile vertical.  
**Next:** seek provider-authoritative route-edge/buffer semantics. If unavailable, expand the metadata-only source-grid audit over many adjacent DTM1 pairs to determine whether the 15010/15000/10 m geometry is universal; statistical regularity reduces uncertainty but does not itself authorize a production seam transform.  
**Do not claim:** a real 3×3 terrain artifact pass until this gate executes successfully.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** LIVE DTM1 SOURCE + MULTI-SOURCE SET PLANNING PASS  
**Owner area:** `engine/compiler`  
**Done/evidence:** production parser uses GeoRSS lat/lon -> lon/lat normalization and Shapely actual `covers`; bbox remains prefilter only. Live official DTM1 dataset feed contained 2033 polygon entries in EPSG:25833. Single-tile selection resolves the accepted Nannestad file from the explicit `rel=section`, `type=application/geotiff` link; filename/title guessing is forbidden. Multi-tile source-set planning also requires the declared geometry union to cover the runtime tile and fails closed on ambiguous minimal source sets.  
**Next:** reuse the same fail-closed pattern for later terrain/source families rather than generalizing from filenames.

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** NODE + REAL CHROME FULL-GRAPH PARITY PASS / ANDROID COST GATE OPEN  
**Owner area:** `engine/schemas`, `engine/streaming`, browser artifact consumer  
**Done/evidence:** strict JSON Schema 2020-12 contracts and producer compatibility are merged. Provenance semantics now live once in crypto-agnostic `runtime_verifier_core.mjs`; Node and browser adapters only calculate RFC 8785/JCS + SHA-256 hashes. Hosted parity run `32136500278` requires identical Node/WebCrypto decision, code and reconstructed hashes across all **11** existing happy/adversarial cases. Real Chrome run `32136951610` then reconstructs the complete provenance graphs for the exact Nannestad road/building artifacts before decode and still reports **0 raw-source calls**. Focused browser regressions reject forged lineage and tampered bytes and preserve the pre-fetch raw-source transport guard.  
**Performance observation:** separate hosted runs moved road/building `verify_decode_ms` from roughly **112.9 / 89.8 ms** before full browser graph verification to **201.7 / 173.4 ms** with it; boot-to-first-visible moved ~788.5 -> ~993.5 ms. The runs are not a controlled crypto-only A/B and other phases varied, so this is a measurement trigger rather than an exact causal cost. Forsøk 18 additionally measured ~20.1 ms WebCrypto/JCS verification for a synthetic 4 MB-class terrain fixture in Chrome. Security semantics remain mandatory.  
**Proof:** `docs/proofs/2026-08-18-browser-provenance-parity.md` and `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`.  
**Next:** measure full provenance verification on Android Chrome and on the exact accepted terrain artifact. If device evidence shows main-thread responsiveness/first-visible pressure, compare provenance verification in a worker and/or caching of already-verified immutable identities; do not weaken graph reconstruction.

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
**Status:** REAL-DATA + NODE/BROWSER RUNTIME VERIFICATION + ANDROID TERRAIN-INTEGRATED VISUAL PASS  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Done/evidence:** raw SHA-addressed cache/offline fail-closed mode; normalized + compiled artifact chain; exact RuntimeVerificationBundle. Android Forsøk 15 consumes 246 road paths + 135 footprints with raw NVDB/OSM/Overpass networking hard-blocked at 0 calls; Forsøk 16 grounds them against the real terrain artifact. Real Chrome now also performs full WebCrypto/JCS provenance reconstruction on the same accepted road/building identities before decode, with 0 raw-source calls.  
**Proof:** `docs/proofs/2026-08-17-nannestad-vector-realdata.md`, `docs/proofs/2026-08-17-forsok16-android-runtime.md`, `docs/proofs/2026-08-18-browser-provenance-parity.md`.  
**Next:** keep vector geometry stable while Android batching measurement, road physical-surface semantics and later building-height enrichment proceed independently.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** IN-APP TERRAIN WORKER EXPERIMENT + HOSTED REAL-VECTOR BATCHING/FULL PROVENANCE PASS / REAL TERRAIN BROWSER + ANDROID GATES OPEN  
**Done/evidence:** Forsøk 16 renders the verified terrain/road/building artifacts on Android with 0 raw-source calls. The merged fixed-camera real-artifact batching harness uses 246 road paths + 135 building footprints (381 logical vector objects) and reduces submissions **381 -> 2 draw calls**. Browser-provenance run `32136951610` kept the same **381 -> 2** with 0 raw-source calls while requiring full browser provenance before geometry creation. Forsøk 18 now places a terrain lifecycle experiment directly in the deployable Vite World Viewer: the visible app and CI use the same `verifyRuntimeBundleWeb -> terrain_tile_loader -> module DedicatedWorker -> TileStreamingScheduler -> WebGL2 measurement` core. Exact-head run `32144204222` passes a synthetic 1000×1000 / ~4 MB structural fixture with **1 load completed / 0 failed**, **1 scheduler cache hit**, **0 evictions**, **4,729,120 B** retained and a 129×129 / 16,641-vertex mesh.  
**Important limitation:** Forsøk 18's default terrain is explicitly synthetic and is not Nannestad world truth. Hosted timing measured ~290.6 ms input→first-visible and a **116.7 ms** largest rAF gap during initial load; this is a warning that worker offload alone has not eliminated main-thread/browser hitch risk. Hosted/headless GPU timing is not Android acceptance.  
**Proof:** `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`.  
**Next:** stage the exact accepted Nannestad terrain bundle/artifact through the same in-app path, then run Forsøk 18 on Android Chrome with verification/decode/worker/GPU/rAF capture. Do not select WebGL/WebGPU/Cesium from hosted timing alone.  
**Parallel issue:** GitHub Issue #5 owns viewer batching/performance.

### P0-STREAMING-01 — Verified terrain tile lifecycle
**Status:** SCHEDULER + EXACT REAL ARTIFACT PIPELINE + ACTUAL BROWSER MODULE-WORKER STRUCTURAL PASS / EXACT REAL BROWSER + ANDROID MOVEMENT OPEN  
**Owner area:** `engine/streaming`  
**Done/evidence:** `TileStreamingScheduler`, deterministic terrain mesh worker boundary and `terrain_tile_loader.mjs` are merged. Main run `32134507528` drove the exact accepted 4,000,382 B Nannestad terrain artifact through full runtime verification, strict NWEHGT01 decode, `TerrainMeshWorkerClient` protocol path and scheduler resident lifecycle. It retained 1,000,000 elevation samples + a 129×129 mesh for exactly **4,729,120 B**, with one completed load, zero failures and zero offline raw-source requests; that run used an in-process protocol worker shim. Forsøk 18 exact-head run `32144204222` separately proves the actual browser module `DedicatedWorker` path in Chrome using a synthetic 1000×1000 terrain fixture: full `RUNTIME_VERIFICATION_PASS`, **1 load started/completed, 0 failed, 1 cache hit, 0 evictions**, one terrain resolver call, 16,641 vertices / 32,768 triangles / 729,120 B mesh and the same **4,729,120 B** retained payload shape. The camera cache probe is outside active radius but inside retain radius, so resident→cached→resident is proven without reload.  
**Hosted timing observation:** Forsøk 18 measured ~44.2 ms runtime-input resolve, ~20.1 ms verification, ~137.5 ms strict decode, ~72.2 ms worker roundtrip / ~49 ms worker CPU, ~290.6 ms input→first-visible and a **116.7 ms** largest rAF gap during initial load. These are synthetic hosted Chrome measurements, not Android acceptance and not exact-real-terrain performance.  
**Proof:** `docs/proofs/2026-08-18-terrain-runtime-pipeline.md`, `docs/proofs/2026-08-18-browser-provenance-parity.md` and `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`.  
**Open:** drive the exact accepted Nannestad terrain bytes through this real browser-worker path; then measure Android transfer/startup, verification/decode, GPU upload/apply, rAF gaps and movement. Real 2×2/3×3 terrain remains blocked by `P0-MULTITILE-TERRAIN-01`. Hard resident/GPU budgets, worker pooling, verification caching and LOD remain unselected until device evidence exists.  
**Next:** reuse Forsøk 18 with the accepted terrain RuntimeVerificationBundle/artifact, then capture the same experiment on Android Chrome. If main-thread jank remains, isolate decode and provenance work before choosing a worker/cache policy.

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
