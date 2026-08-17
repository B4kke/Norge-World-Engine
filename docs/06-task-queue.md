# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** FOUNDATION IMPLEMENTED / VEKTOR RECONSTRUCTION OPEN  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Done now:** standard RFC 8785/JCS implementations are pinned for Python/Node and share a known canonical/SHA-256 regression vector. Ad-hoc Python `sort_keys` canonicalization is no longer the production direction.  
**Next concrete result:** version the complete RuntimeVerificationBundle schema in-repo and reconstruct SourceSnapshot -> TransformContract -> NormalizedSnapshot -> CompilerConfig -> CompileLineage -> ArtifactRef -> PromotionRecord in runtime. Add forged-lineage and clip-mutation negative regressions.  
**Acceptance:** forged self-consistent supplied hash strings are rejected unless reconstructed object hashes/edges match.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** IMPLEMENTED + LOCAL REGRESSION PASS / PRODUCTION FIELD VALIDATION OPEN  
**Owner area:** `engine/compiler`  
**Done now:** `engine/compiler` parses GeoRSS lat/lon, normalizes to lon/lat, uses bbox only as prefilter and uses actual Shapely `covers` as authority. SENTINEL's adversarial triangle regression passes locally.  
**Still open:** materialize the live DTM1 dataset feed and confirm which file-specific spatial field is actually present in production before source promotion.

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** BLOCKED / TOOLCHAIN READY, REAL SOURCE NOT YET PROVEN  
**Owner area:** `engine/compiler`, `tools`  
**Done now:** Rasterio normalizer can validate/hash and deterministically clip a pixel-aligned EPSG:25832 DTM without hidden reprojection/resampling; repeated synthetic outputs produced identical SHA-256 locally.  
**Next concrete result:** production service+dataset feed -> unambiguous Nannestad entry -> full raw GeoTIFF -> SHA-256/size/raster metadata -> deterministic 1 km clip -> normalized snapshot -> compiled terrain artifact -> promotion record -> persisted raw/normalized/compiled cache.  
**Acceptance:** second identical run proves cache hits and deterministic output; runtime loads compiled artifact via manifest/bundle only, with no source API contact.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE HARNESS READY / COMPILED ARTIFACT BLOCKED  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done now:** pinned glTF-Transform/meshoptimizer, 3D Tiles validator/tools and CesiumJS baseline with load/churn/initial-visible metrics.  
**Next:** once the same Nannestad compiled GLB/tileset exists, validate it and compare CesiumJS against the custom viewer on the same device/data.  
**Acceptance:** compare cold/warm load, transferred bytes, RAM, first-visible latency, frame time, draw calls and tile churn before proposing a runtime-format decision.

### P0-NVDB-01 — Road adapter
**Status:** SOURCE CONTRACT VERIFIED / PRODUCTION ADAPTER OPEN  
**Next:** bbox/segment acquisition, explicit source SRID, horizontal reprojection to prototype CRS, NN2000 Z preservation/null policy, source snapshot/provenance.

### P0-BUILDINGS-01 — Building volumes
**Status:** PARTIAL / FALLBACK DEFINED  
**Next:** capability-gated FKB path; documented OSM footprint + DOM-DTM fallback only where license/provenance requirements are satisfied. Do not block terrain vertical on FKB access.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** CONTRACT/HARNESS EXISTS / REAL TERRAIN BLOCKED  
**Next:** after P0-REALDATA-01, measure manifest load, artifact fetch, SHA verify, decode, local-origin rebase, GPU upload, first visible frame, steady CPU/GPU frame time, draw calls, triangles and RAM/VRAM.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** PREVIOUSLY BLOCKED BY ACCOUNT/BILLING  
Baseline workflow now also validates repo-local skills, compiler regressions, the JS JCS vector and Cesium benchmark build. Re-check the new PR run; do not call these checks PASS if the hosted runner executes zero steps.

## Explicitly deprioritized until P0 evidence exists

- renderer polish and photorealism;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain progress;
- production imagery dependency before redistribution/cache rights are documented.
