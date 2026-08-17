# 05 — Worklog

Append concise implementation handoffs here. Historical detailed agent logs remain in Google Drive.

## 2026-08-17 — GitHub bootstrap / Drive migration

**Gjort**
- Established a GitHub-oriented monorepo layout separating `engine/`, `apps/`, `tools/`, `prototypes/`, `tests/`, `docs/` and untracked data/caches.
- Migrated the current lightweight implementation/proof artifacts from Drive: source-contract verifier, SMIA Atom adapter v0.2, VEKTOR runtime gate v0.3, fixtures and proof JSON.
- Kept known-defective SMIA/VEKTOR implementations in `prototypes/`; they are not represented as production-ready engine code.
- Added baseline CI and explicit Git/data hygiene rules.
- Left the two large one-file Nannestad viewer HTML harnesses (Forsøk 6/7) as historical Drive artifacts during the connector bootstrap; they are not required by CI or the next P0 tasks.

**Bevist**
- Drive status through ATLAS-04 was reconciled before migration. `02.7` closes the prior SENTINEL findings at contract/test-spec level, but implementation remains incomplete.
- P0 real-data terrain remains blocked: no production DTM1 Nannestad raw -> normalized -> persisted `REAL_COMPILED` vertical is yet proven.

**Endret**
- Repository bootstrap files and migration snapshot created.
- Work policy changed from historical Drive-first implementation to GitHub-first implementation.

**Neste**
- Implement the two ATLAS-04 regressions (polygon geometry + runtime lineage reconstruction), then execute the authoritative DTM1 real-data vertical.

## 2026-08-17 — Core geospatial/reuse tooling

**Gjort**
- Added a production-direction Python World Compiler package with pinned Rasterio 1.5.0, pyproj 3.7.2, Shapely 2.1.2 and `rfc8785` 0.1.4.
- Replaced the known polygon-as-bbox authority with Shapely actual geometry in `engine/compiler`; legacy v0.2 remains only under `prototypes/`.
- Added a pixel-aligned Rasterio DTM normalizer that refuses implicit reprojection/resampling and emits source/normalized metadata + hashes.
- Added RFC 8785 canonicalization helpers for Python and Node plus a shared expected SHA-256 vector.
- Implemented `engine/streaming/runtime_verifier.mjs` from the Drive 02.7 contract: runtime reconstructs every provenance object/edge, excludes transport relocation from immutable ArtifactRef identity, validates promotion gates and verifies compiled bytes before `READY_FOR_RUNTIME`.
- Added runtime negative regressions for forged self-reported lineage, 1 m clip mutation, raw-source locator and tampered artifact bytes.
- Added pinned glTF-Transform/meshoptimizer and CesiumGS 3D Tiles validator/tools under `tools/runtime-packaging`.
- Added an isolated CesiumJS 1.143/Vite benchmark harness for compiled 3D Tiles with tile-progress/load/unload/initial-visible metrics.
- Added seven repo-local NWE Agent Skills and routed `AGENTS.md` through them; added structural skill validation to baseline CI.
- Opened draft PR #3 as the integrated replacement for the two separate bootstrap PRs.

**Bevist**
- Final version verification corrected an initial bad Rasterio 1.5.1 pin: upstream marks 1.5.1 as TBD; 1.5.0 is the released stable version and is now pinned.
- Local runtime versions: Rasterio 1.5.0, pyproj 3.7.2 and Shapely 2.1.2.
- Local geospatial regressions PASS: 4 tests covering Shapely box/polygon containment, SENTINEL triangle rejection and byte-repeatable Rasterio clip (`4 passed`).
- The Node JCS known-vector and runtime lineage regression were executed locally against the exact `canonicalize` v3.0.0 implementation from upstream tag `v3.0.0`: PASS. The runtime harness accepted a valid bundle/transport relocation and rejected forged lineage, 1 m clip mutation, raw-source reference and wrong artifact bytes.
- Local Node syntax checks PASS for the schema helper, runtime verifier/regression and Cesium benchmark source.
- PR #3 is mergeable against `main`.
- Latest GitHub Actions run #63 for the PR still fails before repository commands execute: the hosted job exposes an empty step list. This is runner/account infrastructure failure, not evidence of a failed repository test.
- Package/API versions and documented usage were verified against current PyPI/npm/upstream sources before final pinning.

**Ikke bevist / blokkert**
- Python `rfc8785` could not be installed from PyPI in the isolated container, so its repo test remains CI/dependency-runner validation rather than a local execution proof.
- The Cesium Vite build and installed npm workspace resolution are not locally proven because package download is blocked; the JCS/runtime test used the exact upstream `canonicalize` v3.0.0 source staged only in the temporary test workspace.
- P0-REALDATA-01 remains open: this change provides the normalizer/toolchain but does not materialize the production DTM1 15 km GeoTIFF.

**Neste**
- Use a dependency-capable runner to execute the complete baseline, then materialize the authoritative DTM1 raw → normalized Nannestad artifact. Once a compiled GLB/tileset exists, run the Cesium/custom-viewer comparison instead of adding more viewer features.

## 2026-08-17 — NVDB/OSM vector compiler adapters

**Gjort**
- Continued on a stacked branch from the latest unmerged `agent/core-geospatial-tooling` state rather than rebuilding from `main` or from historical Drive HTML prototypes.
- Added `nwe_compiler.roads`: deterministic duplicate suppression, 0.25 m endpoint snapping and graph collapse through degree-2 nodes while preserving NVDB sequence IDs as provenance. This targets the Forsøk 14 observation `443 raw -> 443 paths` where browser logic failed to merge source segmentation.
- Added `nwe_compiler.sources.nvdb`: segmented road WKT ingestion, explicit EPSG:25833 -> EPSG:25832 reprojection with `always_xy=True`, NN2000 Z preservation, sentinel/invalid Z -> null and Shapely-based 1 km tile clipping. Z at new clip vertices is reconstructed from the original source segment instead of trusting GEOS Z behavior.
- Added `nwe_compiler.sources.osm_buildings`: OSM Main API/Overpass way ingestion, WGS84 -> EPSG:25832, Shapely polygon validity/area/tile gates, explicit `height` and `building:levels` provenance and unresolved height rather than an authoritative heuristic.
- Added six vector regressions covering road merge, junction boundaries, NVDB reprojection/Z policy, clip-boundary Z interpolation, OSM building normalization and invalid bow-tie rejection.
- Opened draft stacked PR #4 against `agent/core-geospatial-tooling`; no merge performed.

**Bevist**
- Android Forsøk 14 supplied 443 NVDB raw segments and 133 OSM building footprints; source acquisition is feasible, while its browser road graph did not reduce raw segmentation.
- Local focused vector suite: `6 passed in 0.15s`.
- The first custom line-clipping implementation was rejected during self-review because repo policy prefers pinned Shapely for generic geometry. It was replaced before handoff and a boundary-Z regression was added.
- PR #4 is mergeable into the stacked core branch.
- PR #4 baseline run #67 reproduced the infrastructure failure: one job, `steps: []`, `runner_id: 0`, failure before repository commands execute.

**Endret**
- Branch: `agent/nvdb-osm-compiler-adapters`, stacked on the current core geospatial tooling branch. No merge to `main`.
- Compiler now has production-direction vector normalization primitives beside the existing DTM/raster/provenance foundation.

**Neste**
- Persist real Nannestad NVDB/OSM responses outside Git as raw cache, bind SourceSnapshot/retrieval/license identity, run these adapters over the real 443/133 sample and emit deterministic normalized/compiled vector artifacts with RFC 8785 hashes. Viewer/runtime must then consume artifacts with zero raw NVDB/OSM contact.

## 2026-08-17 — Persisted vector-artifact vertical

**Gjort**
- Synced PR #4 onto the latest `agent/core-geospatial-tooling` head and preserved the corrected Rasterio 1.5.0/provenance state. Removed an unrelated README drift found during stacked-PR QA.
- Recovered the exact working NVDB/OSM source requests from Drive `Forsøk 14` and revalidated the live endpoints. The compiler now derives its own source envelopes from all four EPSG:25832 tile corners rather than copying the browser's two-corner OSM bbox.
- Added `nwe_compiler.acquisition`: source contracts, live fetch boundary, JSON validation, SHA-256 content-addressed raw cache, cache integrity checks, `--offline` fail-closed behavior and SourceSnapshot metadata/licensing.
- Added `nwe_compiler.vector_artifacts`: deterministic normalized road/building JSON, compiled runtime artifacts, CompilerConfig/CompileLineage/ArtifactRef/PromotionRecord and RuntimeVerificationBundle compatible with `engine/streaming/runtime_verifier.mjs`.
- Added `nwe-compile-vectors --refresh|--offline` CLI with raw/normalized/compiled counts, bytes, hashes, cache state and phase timings.
- Added dependency-free `apps/world-viewer/artifact_consumer.mjs`: bundle + compiled-artifact only, WebCrypto SHA-256/size verification and fail-before-fetch rejection of NVDB/OSM/raw-source transports.
- Documented Prototype-0 NVDB NLOD and OSM ODbL contracts in `docs/data-licenses/vector-sources.md`; no whole-Norway acquisition decision was made.

**Bevist**
- Exact code copied to the branch was exercised in an isolated repo mirror: existing vector tests + acquisition/cache/artifact structural regressions = `12 passed` (0.19–0.20 s across repeated run).
- Viewer artifact-boundary regression PASS: 2 cases, happy path performs exactly two requests (bundle + compiled artifact), malicious NVDB transport is rejected before a second request; reported raw source calls = 0.
- Cold/warm raw-cache fixture proves a second identical acquisition uses cached bytes and performs zero fetcher calls; offline cache miss fails closed.
- Live NVDB V4 returned segmented `LINESTRING Z` data for the Nannestad query and live OSM API v0.6 returned ODbL-attributed map elements/building ways, confirming the current source shapes remain available.

**Ikke bevist / blokkert**
- The execution container has no outbound DNS, so the actual live response bytes cannot be persisted into its ignored `data/raw` workspace. GitHub Actions is still zero-step blocked. Therefore no new production raw SHA-256, actual compiler `raw -> normalized -> compiled` count, artifact SHA or cold/warm timing from the live 443/133-class source set is claimed here.
- Python `rfc8785` remains unavailable in this isolated container. Structural artifact tests inject a deterministic test serializer; production code defaults to the pinned RFC 8785 implementation and full JCS execution remains a dependency-capable-runner gate.

**Endret**
- PR #4 now carries the acquisition/cache/artifact/viewer boundary rather than browser-local source compilation. Raw geodata remains outside Git by construction.

**Neste**
- In the first network + dependency-capable execution, run `nwe-compile-vectors --cache-root data --refresh`, record the real NVDB/OSM hashes/counts/artifact metrics, then immediately run `nwe-compile-vectors --cache-root data --offline` and prove identical artifact hashes with zero source requests. Only then wire those persisted artifacts into the visual Nannestad viewer.
