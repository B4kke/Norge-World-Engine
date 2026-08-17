# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** IMPLEMENTED + LOCAL ADVERSARIAL PASS / FULL DEPENDENCY-INSTALL BASELINE BLOCKED BY CI  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Done now:** standard RFC 8785/JCS implementations are pinned for Python/Node; `engine/streaming/runtime_verifier.mjs` reconstructs SourceSnapshot -> TransformContract -> NormalizedSnapshot -> CompilerConfig -> CompileLineage -> immutable ArtifactRef -> PromotionRecord, checks reference edges and promotion gates, and verifies artifact bytes before READY. Regressions cover forged self-reported lineage, 1 m clip mutation, raw-source transport and tampered bytes.  
**Evidence:** runtime/test modules pass local syntax checks. The JCS known-vector and runtime lineage harness also ran locally against the exact upstream `canonicalize` v3.0.0 source: valid bundle/transport relocation PASS; forged lineage rejected as `LINEAGE_HASH_MISMATCH`; clip mutation/raw source/wrong bytes rejected. Full workspace install plus Python `rfc8785` execution still needs a dependency-capable runner.  
**Next concrete result:** execute the complete baseline using normal package installation and then port the 02.7 object definitions into complete versioned repo schemas.  
**Acceptance:** normal dependency-installed run reproduces the adversarial PASS; do not close solely from syntax/static review or temporary-source staging.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** IMPLEMENTED + LOCAL REGRESSION PASS / PRODUCTION FIELD VALIDATION OPEN  
**Owner area:** `engine/compiler`  
**Done now:** `engine/compiler` parses GeoRSS lat/lon, normalizes to lon/lat, uses bbox only as prefilter and uses actual Shapely `covers` as authority. SENTINEL's adversarial triangle regression passes locally.  
**Still open:** materialize the live DTM1 dataset feed and confirm which file-specific spatial field is actually present in production before source promotion.

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** BLOCKED / TOOLCHAIN READY, REAL SOURCE NOT YET PROVEN  
**Owner area:** `engine/compiler`, `tools`  
**Done now:** Rasterio 1.5.0 normalizer can validate/hash and deterministically clip a pixel-aligned EPSG:25832 DTM without hidden reprojection/resampling; repeated synthetic outputs produced identical SHA-256 locally.  
**Next concrete result:** production service+dataset feed -> unambiguous Nannestad entry -> full raw GeoTIFF -> SHA-256/size/raster metadata -> deterministic 1 km clip -> normalized snapshot -> compiled terrain artifact -> promotion record -> persisted raw/normalized/compiled cache.  
**Acceptance:** second identical run proves cache hits and deterministic output; runtime loads compiled artifact via manifest/bundle only, with no source API contact.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE HARNESS READY / COMPILED RENDER ARTIFACT BLOCKED  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done now:** pinned glTF-Transform/meshoptimizer, 3D Tiles validator/tools and CesiumJS baseline with load/churn/initial-visible metrics.  
**Next:** once the same Nannestad compiled render GLB/tileset exists, validate it and compare CesiumJS against the custom viewer on the same device/data.  
**Acceptance:** compare cold/warm load, transferred bytes, RAM, first-visible latency, frame time, draw calls and tile churn before proposing a runtime-format decision.

### P0-NVDB-01 — Road adapter
**Status:** ACQUISITION + NORMALIZATION + GRAPH + ARTIFACT CODE IMPLEMENTED / LIVE SNAPSHOT EXECUTION OPEN  
**Owner area:** `engine/compiler`  
**Done now:** compiler derives the Nannestad source envelope, builds the NVDB V4 `srid=5973` request, validates/hashes/caches raw JSON outside Git, reprojects EPSG:25833 -> EPSG:25832, preserves valid NN2000 Z, clips with Shapely, reconstructs clip-boundary Z and collapses compatible degree-2 road chains. Road output is wrapped in normalized snapshot + RuntimeVerificationBundle lineage.  
**Evidence:** live endpoint/source shape revalidated; focused local vector + acquisition/artifact fixture suite passes. Historical Forsøk 14 observed 443 raw segments, but the new compiler has not yet been allowed to persist/recompile that live response in this execution environment.  
**Next:** obtain the exact raw response either from a network/dependency-capable compiler run or from the mobile source-capture bridge, then run the production compiler and record raw SHA/bytes, `raw -> normalized -> paths`, artifact SHA/bytes and timings; immediately repeat offline and prove identical artifact hash/no source call.

### P0-BUILDINGS-01 — Building volumes
**Status:** OSM ACQUISITION + FALLBACK NORMALIZER + ARTIFACT CODE IMPLEMENTED / LIVE SNAPSHOT + HEIGHT ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done now:** compiler derives the WGS84 envelope from all four tile corners, validates/hashes/caches OSM API v0.6 raw bytes, transforms building ways to EPSG:25832, validates/clips footprints with Shapely and emits lineage-bound building-footprint artifacts. `height` and `building:levels` remain provenance-distinct; unresolved height is not silently promoted.  
**Evidence:** live OSM endpoint/source shape revalidated; local building/artifact regressions pass. Historical Forsøk 14 observed 133 building footprints.  
**Still open:** actual live compiler count/hash, OSM multipolygon relations and DOM-DTM height enrichment as a separate provenance-bearing transform. FKB remains capability-gated and must not block terrain.

### P0-VECTOR-ARTIFACT-01 — Persisted road/building runtime artifacts
**Status:** PIPELINE IMPLEMENTED + LOCAL STRUCTURAL/DETERMINISM PASS + MOBILE RAW-CAPTURE BRIDGE READY / PRODUCTION LIVE COMPILE OPEN  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Done now:** `nwe_compiler.acquisition` adds SHA-addressed raw cache and offline mode; `nwe_compiler.vector_artifacts` emits normalized bytes, compiled bytes, SourceSnapshot/TransformContract/NormalizedSnapshot/CompilerConfig/CompileLineage/ArtifactRef/PromotionRecord and RuntimeVerificationBundle; `nwe-compile-vectors` reports cache/count/hash/byte/timing metrics. `prototypes/nannestad/mobile_source_capture.html` can fetch the exact compiler NVDB/OSM contracts on Android, SHA-256 the raw bytes, store them in IndexedDB, prove a zero-fetch warm/offline read and export one base64-preserving capture JSON for compiler ingestion.  
**Evidence:** combined existing vector + acquisition/artifact structural suite = `12 passed`; cold/warm fixture proves second acquisition performs zero network fetches; artifact fixtures are byte deterministic under the injected test serializer. Production defaults to RFC 8785/JCS, whose Python package execution remains a dependency-runner gate. Mobile bridge JavaScript syntax is locally checked; live mobile CORS/IndexedDB behavior is the next device gate.  
**Block:** the isolated execution container cannot perform the compiler's live HTTP acquisition and GitHub-hosted Actions has no assigned runner. Mobile capture now provides a concrete path to obtain the exact raw bytes without moving compilation back into the browser.  
**Acceptance:** exact live raw bytes -> production `--offline` compile -> road/building artifact hashes; repeated compile yields identical hashes; runtime verifier accepts bundles; viewer consumes the same artifacts with zero NVDB/OSM calls.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** COMPILED-ARTIFACT CONSUMER BOUNDARY IMPLEMENTED / VISUAL INTEGRATION WAITS ON LIVE ARTIFACTS  
**Done now:** `apps/world-viewer/artifact_consumer.mjs` fetches bundle + compiled JSON artifact only, rejects raw-source transports before the second request, verifies byte size/SHA-256 with Web Crypto and parses only verified bytes. The Cesium baseline remains separate and no renderer is selected.  
**Evidence:** local consumer regression PASS: happy path = exactly 2 requests, raw source calls = 0; malicious NVDB transport is rejected before a source request.  
**Next:** after live road/building artifacts are materialized, expose their bundles/artifacts to the Nannestad visual harness and measure fetch/hash/decode/rebase/upload/first-visible/frame-time/draw calls/memory with source networking disabled.

## Infrastructure

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** ZERO-STEP FAILURE CONFIRMED; PRIVATE-REPO BILLING/BUDGET IS LEADING HYPOTHESIS; SELF-HOSTED FALLBACK ADDED  
The repository is private and PR #3/#4 hosted jobs are created but fail before repository commands execute. Latest inspected PR #4 job has `steps: []`, `runner_id: 0`, no runner name and no downloadable job log. The GitHub integration cannot read personal billing/Actions-permission endpoints (403), so quota/budget/payment status cannot be proven from the connector. GitHub documentation states that private repositories consume the account's hosted-runner allowance and usage can be blocked when included quota/budget/payment conditions prevent additional Actions use.  
**User check:** GitHub personal `Settings -> Billing & Licensing -> Overview / Budgets and alerts`, inspect Actions usage and any `Stop usage when budget limit is reached` rule; also verify repository `Settings -> Actions -> General`.  
**Fallback implemented:** `.github/workflows/baseline-self-hosted.yml` is `workflow_dispatch` + `runs-on: self-hosted`, so a registered private-repo PC runner can execute the full baseline without GitHub-hosted minutes. Do not expose a self-hosted runner to untrusted public PR code.

## Explicitly deprioritized until P0 evidence exists

- renderer polish and photorealism;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain progress;
- production imagery dependency before redistribution/cache rights are documented.
