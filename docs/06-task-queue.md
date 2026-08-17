# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** HIGHEST OPEN P0 / TOOLCHAIN READY, AUTHORITATIVE SOURCE VERTICAL NOT YET PROVEN  
**Owner area:** `engine/compiler`, `tools`  
**Done now:** Rasterio 1.5.0 normalizer validates/hashes and deterministically clips a pixel-aligned EPSG:25832 DTM without hidden reprojection/resampling; synthetic repeatability regressions pass on hosted CI.  
**Next concrete result:** production service+dataset feed -> unambiguous Nannestad DTM1 entry -> full raw GeoTIFF -> SHA-256/size/raster metadata -> deterministic 1 km clip -> normalized snapshot -> compiled terrain artifact -> promotion record -> persisted raw/normalized/compiled cache.  
**Acceptance:** second identical run proves cache hit + identical artifact hash; runtime loads compiled terrain via manifest/bundle only and has zero source-service contact.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** IMPLEMENTED + REGRESSION PASS / PRODUCTION DTM1 FIELD VALIDATION OPEN  
**Owner area:** `engine/compiler`  
**Done now:** GeoRSS lat/lon is normalized to lon/lat; bbox is only a prefilter and actual Shapely `covers` is authoritative. SENTINEL adversarial triangle regression passes in hosted baseline.  
**Next:** materialize the live DTM1 dataset feed and prove which file-specific spatial field identifies the Nannestad raw file before promotion.

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** IMPLEMENTED + HOSTED BASELINE PASS + REAL VECTOR ARTIFACT PASS  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Evidence:** public hosted baseline installs Python `rfc8785` and Node `canonicalize`, executes cross-language JCS and adversarial runtime regressions, and passes. Real Nannestad road/building bundles from `vector-realdata-proof` are reconstructed against their exact artifact bytes and return `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`.  
**Open:** complete/version the remaining 02.7 schema definitions as repository schemas; provenance implementation is no longer an execution blocker.

### P0-NVDB-01 — Road adapter
**Status:** REAL-DATA VERTICAL PASS / WIDTH + SEMANTIC ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** NVDB V4 acquisition now sends the required `X-Client: NorgeWorldEngine-Compiler`; raw JSON is validated/hashed/cached outside Git, EPSG:25833 -> EPSG:25832 is explicit, valid NN2000 Z is preserved, Shapely clips the 1 km tile and compatible degree-2 chains are collapsed. Hosted real-data proof: **471 raw -> 407 normalized segments -> 246 road paths**, raw SHA `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`, artifact SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`. Cold total 2168.958 ms; warm/offline 148.363 ms with identical artifact SHA.  
**Next:** separate topology from physical surface width/lane semantics; do not infer authoritative asphalt width solely from `typeVeg`.

### P0-BUILDINGS-01 — Building volumes
**Status:** REAL FOOTPRINT ARTIFACT PASS / HEIGHT + RELATION ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** OSM API 0.6 source is hashed/cached, WGS84 -> EPSG:25832 is explicit, Shapely validates/clips polygons, and explicit `height` / `building:levels` provenance is preserved without silent authoritative fallback. Hosted real-data proof: **5,704 raw elements / 141 building candidates -> 135 validated+compiled footprints**, artifact SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`. Cold total 1145.537 ms; warm/offline 63.811 ms with identical artifact SHA.  
**Still open:** OSM multipolygon relations, DOM-DTM height enrichment as a separate provenance-bearing transform, and capability-gated FKB evaluation. Unresolved height must remain unresolved in authoritative data.

### P0-VECTOR-ARTIFACT-01 — Persisted road/building runtime artifacts
**Status:** REAL-DATA COLD/WARM + RUNTIME VERIFICATION PASS  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Done/evidence:** `nwe_compiler.acquisition` provides SHA-addressed raw cache/offline fail-closed mode; `nwe_compiler.vector_artifacts` emits normalized bytes, compiled bytes and the complete SourceSnapshot -> TransformContract -> NormalizedSnapshot -> CompilerConfig -> CompileLineage -> ArtifactRef -> PromotionRecord -> RuntimeVerificationBundle chain. `vector-realdata-proof` on hosted runner proves cold live acquisition followed by network-free warm compile with identical raw/artifact hashes. `runtime_verifier.mjs` accepts both exact artifacts.  
**Mobile corroboration:** Android capture NVDB raw bytes are byte-identical to the later runner acquisition. OSM capture and runner acquisition retain identical 5,704/141 counts but different raw SHA, correctly creating distinct SourceSnapshot identity.  
**Proof:** `docs/proofs/2026-08-17-nannestad-vector-realdata.md`.  
**Next:** visual runtime integration from compiled artifact inputs only; no raw NVDB/OSM contact.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** ARTIFACT BOUNDARY PASS / FIRST REAL ARTIFACT-ONLY MOBILE HARNESS READY FOR DEVICE TEST  
**Done now:** `apps/world-viewer/artifact_consumer.mjs` rejects raw-source transports before fetch and verifies compiled bytes. A generated one-file Forsøk 15 mobile harness embeds the two passing compiled Nannestad artifacts, SHA-verifies them in-browser, hard-blocks NVDB/OSM/Overpass network use, renders 246 road paths + 135 footprints, keeps unresolved building height visibly diagnostic, and retains World Imagery only as a visual sensor layer. Terrain is still the historical reference raster and is explicitly not promoted.  
**Next device evidence:** Android load/first-visible, artifact SHA pass, raw-source call counter = 0, draw calls/frame behavior, alignment screenshot, and source-debug inspection. Then convert the one-file experiment into a repeatable repo-side packaging/benchmark path rather than keeping generated HTML as architecture.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE BUILD PASS / SHARED TERRAIN+VECTOR RENDER ARTIFACT OPEN  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done:** pinned glTF-Transform/meshoptimizer/3D Tiles tools and CesiumJS baseline; hosted baseline successfully builds the Cesium harness.  
**Next:** once the Nannestad terrain + vector render GLB/tileset exists, validate it and compare CesiumJS vs custom viewer on the same device/data: cold/warm bytes, RAM, first-visible, frame time, draw calls and tile churn. No renderer decision before that evidence.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** RESOLVED  
The repository is now public and GitHub-hosted runners execute normally. Baseline run after the visibility change completed checkout, Python dependency installation, compiler regressions, RFC8785/JCS tests, runtime provenance regression, viewer boundary test, Cesium build and VEKTOR baseline successfully. The old `steps: [] / runner_id: 0` condition is no longer an active blocker. `baseline-self-hosted.yml` may remain as an optional controlled fallback, but is not required for current P0 work.

## Explicitly deprioritized until P0 evidence exists

- renderer polish and photorealism beyond what is necessary for QA;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks the terrain vertical;
- production imagery dependency before redistribution/cache rights are documented.
