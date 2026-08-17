# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** REAL-DATA COLD/OFFLINE + COMPILED ARTIFACT + RUNTIME + ANDROID CONSUMER PASS  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** official Kartverket/Geonorge Atom service selects exactly one Nannestad DTM1 source, `33-125-117.tif`; raw source is 1,096,856,487 B, EPSG:25833 + NN2000, 1 m float32 with raw SHA `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`. Compiler streams it into content-addressed raw cache, explicitly warps it with Rasterio/GDAL to the fixed 1000 × 1000 / 1 m EPSG:25832 + NN2000 Nannestad grid using bilinear resampling, and emits normalized SHA `95c8fcf6f93c8fbb0533d6a82d68416b773f9a146970e1ae85676d3ba41c2adf`.  
**Compiled artifact:** `nwe.terrain-height-grid-artifact/0.1`, 4,000,382 B / 1,000,000 float32 samples, SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`. Cold and source-network-free offline runs are byte-identical; runtime verifier returns `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`. Android Forsøk 16 then consumes that terrain artifact together with the proven vector artifacts, reports terrain PASS / `READY ×3`, samples road/building ground Z from DTM1 and keeps raw source networking blocked at 0 calls.  
**Proof:** `docs/proofs/2026-08-17-nannestad-dtm1-realdata.md` and `docs/proofs/2026-08-17-forsok16-android-runtime.md`.  
**Next:** terrain source/compiler/runtime integration is no longer the immediate blocker. Move to measurable viewer/streaming behavior: same-camera performance baseline, terrain mesh work scheduling, then multi-tile load/unload/LOD experiments. Whole-Norway DTM acquisition/LOD format remains open.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** LIVE DTM1 SOURCE PASS  
**Owner area:** `engine/compiler`  
**Done/evidence:** production parser uses GeoRSS lat/lon -> lon/lat normalization and Shapely actual `covers`; bbox remains prefilter only. Live official DTM1 dataset feed contained 2033 polygon entries in EPSG:25833 and exactly one declared polygon covers the Nannestad target. The selected file is resolved from the explicit `rel=section`, `type=application/geotiff` link; filename/title guessing is forbidden.  
**Next:** reuse the same fail-closed pattern for later terrain/source families rather than generalizing from filenames.

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** IMPLEMENTED + HOSTED BASELINE + REAL VECTOR + REAL TERRAIN + ANDROID CONSUMER PASS  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Evidence:** public hosted baseline installs Python `rfc8785` and Node `canonicalize`, executes cross-language JCS and adversarial runtime regressions, and passes. Real Nannestad road, building and terrain bundles are reconstructed against exact artifact bytes and return `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`; Forsøk 16 exposes all three verified artifacts at the Android runtime boundary while blocking raw source networking.  
**Open:** complete/version remaining 02.7 schema definitions as repository schemas; provenance implementation is no longer an execution blocker.

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
**Status:** REAL TERRAIN + VECTOR ANDROID VISUAL PASS / PERFORMANCE BASELINE PARTIAL  
**Done now:** Forsøk 16 SHA-verifies and renders the real terrain, road and building artifacts with 0 raw-source calls. The 1 m / 1000×1000 DTM1 artifact remains world truth while the mobile GPU terrain is sampled to 129×129. Android screenshot evidence reports **1.3 ms terrain decode, 19.4 ms terrain mesh build, 220 ms boot, 224 draw calls, 16.7 ms / 60 FPS, 382 geometries and 2 textures** at the captured oblique camera. No gross CRS/origin/Z failure is visible.  
**Important limitation:** 224 vs the earlier ~391 draw-call observation is **not batching evidence** because the camera differs and the harness still creates separate geometries. `382 geo` confirms per-object pressure remains high. The 19.4 ms synchronous terrain mesh build exceeds one 60 Hz frame budget and is a likely future streaming hitch if repeated on the main thread.  
**Next highest-value work:** Issue #5 owns the fixed-camera renderer benchmark and batching comparison. In parallel, streaming work must move terrain mesh/buffer generation behind a worker/incremental job boundary before real multi-tile load/unload is accepted.  
**Parallel issue:** GitHub Issue #5 owns viewer batching/performance and now contains the Forsøk 16 device baseline.

### P0-STREAMING-01 — World tile lifecycle scheduler
**Status:** SYNTHETIC 3×3 SCHEDULER + CACHE/FAILURE REGRESSIONS PASS / REAL MULTI-TILE OPEN  
**Owner area:** `engine/streaming`  
**Done/evidence:** renderer-independent `TileStreamingScheduler` provides deterministic camera-distance priority, active/retain radii, max resident count, max concurrent loads, resident↔cached lifecycle, inactive-cache byte budget/eviction, load aborts, stale-completion rejection, failure retry and lifecycle metrics. Hosted baseline passes **6 adversarial scheduler cases**. A synthetic 3×3 Nannestad descriptor benchmark (`center -> east -> north-east -> center-return`) completes 9/9 loads with **peak concurrency 2**, **2 cache hits**, **4 evictions**, final **5 resident / 0 cached**, **22,282,240 B retained**, queue/active loads 0, and final budget overcommit 0.  
**Important limitation:** the benchmark uses opaque synthetic 4.25 MiB payloads. It proves scheduling mechanics only; it does not prove neighbouring Nannestad artifacts, real HTTP/cache latency, browser/GPU memory, frame-time stability, seams or LOD. `maxCacheBytes` currently budgets inactive cached payloads, not a hard resident/GPU memory ceiling; peak retained bytes can temporarily exceed that number when desired tiles are resident.  
**Proof:** `docs/proofs/2026-08-17-streaming-scheduler-synthetic.md`.  
**Next:** first move the measured 19.4 ms terrain mesh build behind a deterministic worker/incremental job boundary, then materialize a real 2×2/3×3 terrain artifact experiment and drive it through this scheduler with first-visible, load/unload latency, bytes, retained memory and p50/p95/p99 frame-time measurements. Final whole-Norway tile addressing/LOD remains open.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE BUILD PASS / SHARED TERRAIN+VECTOR RENDER ARTIFACT OPEN  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done:** pinned glTF-Transform/meshoptimizer/3D Tiles tools and CesiumJS baseline; hosted baseline builds the Cesium harness.  
**Next:** after the custom viewer has a repeatable fixed-camera benchmark for the same real terrain+vector inputs, generate/validate an equivalent render artifact for Cesium and compare on the same device/data: cold/warm bytes, RAM, first-visible, frame time, draw calls and tile churn. No renderer decision before evidence.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** RESOLVED  
Repository is public and GitHub-hosted runners execute normally. Baseline passes on `main` and on the DTM1/streaming branches. `baseline-self-hosted.yml` remains only as an optional controlled fallback.

### INFRA-CI-02 — Real-data proof trigger hygiene
**Status:** FIXED ON DTM1 BRANCH / PENDING MERGE  
Both `vector-realdata-proof.yml` and `dtm1-realdata-proof.yml` are corrected on the DTM1 branch to target relevant `main` pushes after merge instead of historical agent-branch pushes. PR #6 is still draft/unmerged, so `main` has not received this trigger policy yet.

## Explicitly deprioritized until current P0 evidence is integrated

- renderer polish and photorealism beyond QA;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain/viewer measurement;
- production imagery dependency before redistribution/cache rights are documented.
