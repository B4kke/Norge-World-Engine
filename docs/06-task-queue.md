# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** REAL-DATA COLD/OFFLINE + COMPILED ARTIFACT + RUNTIME VERIFICATION PASS  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** official Kartverket/Geonorge Atom service selects exactly one Nannestad DTM1 source, `33-125-117.tif`; raw source is 1,096,856,487 B, EPSG:25833 + NN2000, 1 m float32 with raw SHA `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`. Compiler streams it into content-addressed raw cache, explicitly warps it with Rasterio/GDAL to the fixed 1000 × 1000 / 1 m EPSG:25832 + NN2000 Nannestad grid using bilinear resampling, and emits normalized SHA `95c8fcf6f93c8fbb0533d6a82d68416b773f9a146970e1ae85676d3ba41c2adf`.  
**Compiled artifact:** `nwe.terrain-height-grid-artifact/0.1`, 4,000,382 B / 1,000,000 float32 samples, SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`. Cold and source-network-free offline runs are byte-identical; runtime verifier returns `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`.  
**Proof:** `docs/proofs/2026-08-17-nannestad-dtm1-realdata.md`.  
**Next:** consume this exact terrain artifact in the Android/world-viewer harness together with the proven vector artifacts; sample road/building ground Z from terrain artifact and measure terrain decode/mesh/GPU cost. Whole-Norway DTM acquisition/LOD format remains open.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** LIVE DTM1 SOURCE PASS  
**Owner area:** `engine/compiler`  
**Done/evidence:** production parser uses GeoRSS lat/lon -> lon/lat normalization and Shapely actual `covers`; bbox remains prefilter only. Live official DTM1 dataset feed contained 2033 polygon entries in EPSG:25833 and exactly one declared polygon covers the Nannestad target. The selected file is resolved from the explicit `rel=section`, `type=application/geotiff` link; filename/title guessing is forbidden.  
**Next:** reuse the same fail-closed pattern for later terrain/source families rather than generalizing from filenames.

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** IMPLEMENTED + HOSTED BASELINE + REAL VECTOR + REAL TERRAIN ARTIFACT PASS  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Evidence:** public hosted baseline installs Python `rfc8785` and Node `canonicalize`, executes cross-language JCS and adversarial runtime regressions, and passes. Real Nannestad road, building and terrain bundles are reconstructed against exact artifact bytes and return `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`.  
**Open:** complete/version remaining 02.7 schema definitions as repository schemas; provenance implementation is no longer an execution blocker.

### P0-NVDB-01 — Road adapter
**Status:** REAL-DATA VERTICAL PASS / WIDTH + SEMANTIC ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** NVDB V4 acquisition sends required `X-Client: NorgeWorldEngine-Compiler`; raw JSON is validated/hashed/cached outside Git, EPSG:25833 -> EPSG:25832 is explicit, valid NN2000 Z is preserved, Shapely clips the 1 km tile and compatible degree-2 chains are collapsed. Hosted real-data proof: **471 raw -> 407 normalized segments -> 246 road paths**, raw SHA `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`, artifact SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`. Cold total 2168.958 ms; warm/offline 148.363 ms with identical artifact SHA.  
**Next:** separate topology from physical surface width/lane semantics; do not infer authoritative asphalt width solely from `typeVeg`.

### P0-BUILDINGS-01 — Building volumes
**Status:** REAL FOOTPRINT ARTIFACT PASS / HEIGHT + RELATION ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** OSM API 0.6 source is hashed/cached, WGS84 -> EPSG:25832 is explicit, Shapely validates/clips polygons, and explicit `height` / `building:levels` provenance is preserved without silent authoritative fallback. Hosted real-data proof: **5,704 raw elements / 141 building candidates -> 135 validated+compiled footprints**, artifact SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`. Cold total 1145.537 ms; warm/offline 63.811 ms with identical artifact SHA.  
**Still open:** OSM multipolygon relations, DOM-DTM height enrichment as a separate provenance-bearing transform, and capability-gated FKB evaluation. Unresolved height must remain unresolved in authoritative data.

### P0-VECTOR-ARTIFACT-01 — Persisted road/building runtime artifacts
**Status:** REAL-DATA COLD/WARM + RUNTIME VERIFICATION + ANDROID VISUAL PASS  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Done/evidence:** raw SHA-addressed cache/offline fail-closed mode; normalized + compiled artifact chain; exact RuntimeVerificationBundle; Android Forsøk 15 consumes 246 road paths + 135 footprints from verified artifacts with raw NVDB/OSM/Overpass networking hard-blocked at **0 calls**. Top-down and oblique Android screenshots show stable XY alignment.  
**Proof:** `docs/proofs/2026-08-17-nannestad-vector-realdata.md`.  
**Next:** keep vector geometry stable while terrain integration and renderer measurement proceed.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** VECTOR ARTIFACT-ONLY ANDROID VISUAL PASS / REAL TERRAIN INTEGRATION + PERFORMANCE MEASUREMENT OPEN  
**Done now:** Forsøk 15 SHA-verifies and renders the two real vector artifacts with 0 raw-source calls; source-debug remains traceable. Android top-down and oblique QA pass. Observed scene is about **391 draw calls**, so scaling performance is not yet accepted. Terrain artifact is now separately `READY_FOR_RUNTIME` and can replace the historical reference raster.  
**Next highest-value integration:** build a repeatable artifact-only viewer path with the exact terrain height-grid + road/building artifacts. Ground road/building geometry from the compiled DTM; retain World Imagery only as sensor/visual layer; measure artifact verify/decode, terrain mesh build/upload, first-visible, frame-time/FPS, draw calls and memory.  
**Parallel issue:** GitHub Issue #5 isolates viewer batching/performance work from terrain/compiler semantics and may be worked by another agent concurrently.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE BUILD PASS / SHARED TERRAIN+VECTOR RENDER ARTIFACT OPEN  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done:** pinned glTF-Transform/meshoptimizer/3D Tiles tools and CesiumJS baseline; hosted baseline builds the Cesium harness.  
**Next:** after the custom viewer consumes the same real terrain+vector inputs, generate/validate an equivalent render artifact for Cesium and compare on the same device/data: cold/warm bytes, RAM, first-visible, frame time, draw calls and tile churn. No renderer decision before evidence.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** RESOLVED  
Repository is public and GitHub-hosted runners execute normally. Baseline passes on `main` and on the DTM1 branch. `baseline-self-hosted.yml` remains only as an optional controlled fallback.

### INFRA-CI-02 — Real-data proof trigger hygiene
**Status:** FIXED ON DTM1 BRANCH / PENDING MERGE  
`vector-realdata-proof.yml` now targets relevant `main` pushes instead of the historical `agent/nvdb-osm-compiler-adapters` branch. The DTM1 proof remains branch-scoped until its PR is reviewed/merged; then it should be retargeted to `main` or a deliberate scheduled/manual proof policy.

## Explicitly deprioritized until current P0 evidence is integrated

- renderer polish and photorealism beyond QA;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain/viewer measurement;
- production imagery dependency before redistribution/cache rights are documented.
