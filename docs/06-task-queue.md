# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** IMPLEMENTED / DEPENDENCY-BACKED EXECUTION VALIDATION BLOCKED BY CI  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Done now:** standard RFC 8785/JCS implementations are pinned for Python/Node; `engine/streaming/runtime_verifier.mjs` reconstructs SourceSnapshot -> TransformContract -> NormalizedSnapshot -> CompilerConfig -> CompileLineage -> immutable ArtifactRef -> PromotionRecord, checks reference edges and promotion gates, and verifies artifact bytes before READY. Regressions cover forged self-reported lineage, 1 m clip mutation, raw-source transport and tampered bytes.  
**Evidence:** runtime/test modules pass local `node --check`; full test execution is wired into baseline CI but the available GitHub hosted job currently fails before step 1, and the isolated local environment cannot install the `canonicalize` dependency.  
**Next concrete result:** execute `node engine/streaming/test_runtime_verifier.mjs` in a dependency-capable runner and then port the 02.7 object definitions into complete versioned repo schemas.  
**Acceptance:** dependency-backed run proves forged self-consistent supplied hash strings are rejected unless reconstructed object hashes/edges match. Do not close solely from syntax/static review.

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
**Status:** NORMALIZATION + GRAPH CORE IMPLEMENTED ON STACKED BRANCH / REAL SOURCE SNAPSHOT + ARTIFACT OPEN  
**Owner area:** `engine/compiler`  
**Done now:** `nwe_compiler.sources.nvdb` parses line WKT, explicitly transforms EPSG:25833 -> EPSG:25832, preserves valid NN2000 Z, maps sentinel/invalid Z to null, clips with Shapely and reconstructs Z at clip-boundary vertices. `nwe_compiler.roads` removes duplicate geometry and collapses compatible degree-2 endpoint chains without treating source sequence IDs as renderer-path boundaries.  
**Evidence:** focused local vector suite passes six regressions total; road-specific cases cover cross-sequence merge, junction stop, CRS/Z semantics and boundary Z interpolation.  
**Next:** persist an actual Nannestad NVDB response outside Git, create SourceSnapshot/retrieval identity, compile the observed 443-segment sample, report `raw segments -> normalized segments -> road paths`, canonical artifact hash/bytes and cold/warm cache behavior.

### P0-BUILDINGS-01 — Building volumes
**Status:** OSM FALLBACK NORMALIZER IMPLEMENTED ON STACKED BRANCH / REAL SOURCE SNAPSHOT + HEIGHT ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done now:** `nwe_compiler.sources.osm_buildings` accepts OSM Main API node/way JSON or Overpass geometry, transforms WGS84 -> EPSG:25832, validates/clips footprints with Shapely and rejects invalid/self-crossing polygons. `height` and `building:levels` are provenance-distinct; missing height remains unresolved rather than becoming authoritative heuristic data.  
**Evidence:** local rectangle/levels normalization and invalid bow-tie rejection regressions pass. Android Forsøk 14 observed 133 building footprints from OSM Main API.  
**Still open:** OSM multipolygon relation support, persisted source snapshot/license identity, actual 133-feature deterministic compile, and DOM-DTM height enrichment as a separate provenance-bearing transform. FKB remains capability-gated and must not block P0 terrain.

### P0-VECTOR-ARTIFACT-01 — Persisted road/building runtime artifacts
**Status:** NEW / NEXT FOR THE FORSØK-14 VECTOR PATH  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Next concrete result:** persisted raw NVDB + OSM snapshots -> normalized EPSG:25832 structures -> RFC 8785 hashes -> compiled road/building artifact(s) + TransformContract/lineage/ArtifactRef. Runtime/viewer must load only those artifacts.  
**Acceptance:** two identical compiles produce byte-identical artifact hashes; Android viewer reports the same path/building counts and verified hashes with **zero NVDB/OSM source requests**.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** CONTRACT/HARNESSES EXIST / REAL TERRAIN + VECTOR ARTIFACTS PENDING  
**Done now:** one-file Android experiments exposed CRS/imagery/source errors; repo now also has an isolated CesiumJS baseline that loads only compiled 3D Tiles. No renderer is selected.  
**Next:** after persisted Nannestad artifacts exist, measure manifest load, artifact fetch, SHA verify, decode, local-origin rebase, GPU upload, first visible frame, steady CPU/GPU frame time, draw calls, triangles and RAM/VRAM in the custom viewer and Cesium baseline on the same data/device.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** CONFIRMED ZERO-STEP FAILURE ON PR #3 RUN #44  
The baseline job exists but reports no executed steps; the Actions API exposes an empty step list and no downloadable job log. Treat this as runner/account infrastructure failure before repository commands execute. Baseline is configured to validate skills, Python compiler regressions, cross-language JCS, runtime forged-lineage reconstruction and Cesium build once a runner becomes available.

## Explicitly deprioritized until P0 evidence exists

- renderer polish and photorealism;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain progress;
- production imagery dependency before redistribution/cache rights are documented.
