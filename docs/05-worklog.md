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
- The Node JCS known-vector and runtime lineage regression were executed locally against the exact upstream `canonicalize` v3.0.0 source from tag `v3.0.0`: PASS. The runtime harness accepted a valid bundle/transport relocation and rejected forged lineage, 1 m clip mutation, raw-source reference and wrong artifact bytes.
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

## 2026-08-17 — Mobile source bridge + self-hosted CI fallback

**Gjort**
- Confirmed the repository is private and the authenticated owner has admin permission. Hosted Actions still creates the job but never assigns a runner; the latest inspected job has no steps, no runner id/name and no downloadable log.
- GitHub integration access to personal billing and repository Actions-permission endpoints returns 403, so quota/budget/payment state cannot be proven programmatically from the connector.
- Added `.github/workflows/baseline-self-hosted.yml`, manual `workflow_dispatch` on `runs-on: self-hosted`, mirroring the full compiler/JCS/runtime/viewer/Cesium baseline. This gives a private-PC runner path that does not rely on GitHub-hosted minutes.
- Added `prototypes/nannestad/mobile_source_capture.html`: exact compiler NVDB/OSM URLs, SHA-256, JSON/source-shape validation, IndexedDB raw-byte cache, cold/warm zero-fetch gate and one-file base64-preserving capture export.
- Produced the same mobile capture HTML as a direct test artifact for Android; JavaScript passes `node --check`.
- Updated the task queue so mobile acquisition is a diagnostic bridge only: raw bytes may be captured on Android, but production normalization/compilation remains in World Compiler.

**Bevist**
- GitHub repository metadata: private repo; owner/admin access is present. Workflow YAML is parsed far enough to create the named job, but hosted execution still has `steps: []` / no runner assignment, so this is not evidence of failing compiler code.
- Current GitHub documentation confirms private repositories consume hosted Actions allowance while self-hosted runners do not consume hosted-runner minutes; exhausted budgets/allowances can block further hosted use.
- Mobile bridge syntax and exact request contracts are locally validated; actual Android CORS/IndexedDB/download behavior intentionally remains a device test.

**Neste**
- User: check personal GitHub `Settings -> Billing & Licensing -> Overview / Budgets and alerts` for Actions quota/budget/payment blocking. If not immediately resolved, register the PC at repository `Settings -> Actions -> Runners -> New self-hosted runner` and trigger `baseline-self-hosted`.
- Android: run COLD CAPTURE online; then enable airplane mode without closing the tab and run WARM/OFFLINE. Export the capture JSON and return it. Decode/verify those exact raw bytes and feed them into the production offline compiler path; do not reimplement normalization in the browser.

## 2026-08-17 — Hosted real-data vector proof + artifact-only runtime handoff

**Gjort**
- Repository visibility was changed to public by the owner; GitHub-hosted Actions immediately resumed normal runner assignment. A full baseline then completed checkout, dependency installation, Python compiler regressions, cross-language RFC8785/JCS, runtime provenance regression, artifact-consumer regression, Cesium baseline build and migrated VEKTOR checks successfully.
- Decoded the supplied Android mobile-capture JSON and verified source byte sizes and SHA-256 values before using its metadata as proof input. Raw bytes remain outside Git; only a small verified manifest is committed.
- First hosted cold compiler attempt exposed NVDB `HTTP 400`. Root cause: server-side NVDB API Les V4 requires `X-Client`; `nwe_compiler.acquisition` now sends `X-Client: NorgeWorldEngine-Compiler` only to the NVDB host, reports response body/request-id on HTTP failure, and has regression coverage for the header boundary.
- Added `vector-realdata-proof.yml`: cold live acquisition/compile, warm network-free compile, cold/warm determinism checks, mobile-capture comparison, runtime bundle verification, attribution and short-retention compiled proof artifact upload with raw cache excluded.
- Added `docs/proofs/2026-08-17-nannestad-vector-realdata.md` with exact execution evidence.
- Generated a one-file Android Forsøk 15 artifact-only viewer from the successful Actions proof package. It embeds the verified road/building artifacts, browser-SHA-verifies the exact bytes, hard-blocks NVDB/OSM/Overpass networking, renders source-debug information and keeps unresolved building heights visually distinct from source-backed heights. Terrain remains explicitly historical reference data pending DTM1.

**Bevist**
- Mobile capture: NVDB 722,013 B / 471 objects / SHA `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`; OSM 1,053,121 B / 5,704 elements / 141 candidates. Android NVDB bytes are exactly identical to later runner acquisition.
- Hosted real-data roads: `471 raw -> 407 normalized -> 246 compiled paths`; artifact 171,732 B, SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`. Cold total 2168.958 ms; warm/offline 148.363 ms.
- Hosted real-data buildings: `5,704 raw / 141 candidates -> 135 validated+compiled footprints`; artifact 80,846 B, SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`. Cold total 1145.537 ms; warm/offline 63.811 ms.
- Cold and warm runs yield identical per-source raw/artifact hashes and counts; warm reports raw-cache hits.
- `runtime_verifier.mjs` returns `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS` for both exact compiled artifact byte streams.
- OSM runner response had the same byte size and 5,704/141 counts as the earlier Android capture but a different raw SHA. The pipeline correctly represents it as a distinct SourceSnapshot instead of silently equating source revisions.

**Endret**
- PR #4 remains draft/unmerged and now contains the live proof workflow, NVDB request fix, mobile-capture manifest, proof documentation and updated P0 queue.
- `INFRA-CI-01` is resolved; hosted runners are no longer a blocker.
- `P0-VECTOR-ARTIFACT-01` has real cold/warm + runtime verification evidence rather than fixture-only evidence.

**Neste**
- Android: test Forsøk 15 and record artifact SHA PASS, raw source request counter = 0, visual alignment, draw calls and source-debug behavior.
- Engine: execute `P0-REALDATA-01` DTM1 authoritative terrain vertical; this is now the highest unresolved world-foundation gate.
- Then package the same terrain+vector inputs for custom viewer and Cesium baseline and compare measured runtime behavior before any renderer/format decision.

## 2026-08-17 — Authoritative DTM1 terrain vertical

**Gjort**
- Continued from merged `main` on `agent/dtm1-terrain-vertical`; corrected `vector-realdata-proof.yml` so future vector real-data proof follows `main` rather than the historical adapter branch.
- Probed the live official Kartverket/Geonorge DTM1 Atom service instead of relying on the old source assumptions. Updated production DTM1 parsing to model the live contract: source entries are EPSG:25833; the GeoTIFF file is exposed as `rel=section`, `type=application/geotiff`; actual GeoRSS polygon geometry is authoritative.
- Added streamed DTM1 acquisition/cache so the ~1.1 GB raw GeoTIFF is SHA-256-bound while streaming to ignored content-addressed storage rather than being loaded into RAM for provenance. Offline reuse rechecks raw size/SHA and raster metadata and performs zero source requests.
- Kept the existing pixel-aligned/no-resampling DTM normalizer strict. Added a separate explicit Rasterio/GDAL warp from EPSG:25833 to a fixed 1000 × 1000, 1 m EPSG:25832 Nannestad grid with NN2000 preserved and bilinear resampling recorded in the transform contract.
- Added deterministic `nwe.terrain-height-grid-artifact/0.1`: canonical header + 1,000,000 little-endian float32 elevations, engine-independent and persisted with RuntimeVerificationBundle.
- Added live DTM1 real-data workflow, source/warp/cache/artifact regressions, proof document, and a parallel viewer-performance Issue #5 that is intentionally isolated from compiler/terrain semantics.

**Bevist**
- Live official DTM1 dataset feed contained 2033 polygon entries; exactly one declared polygon covers the Nannestad target: `33-125-117.tif`.
- Raw source: 1,096,856,487 B, EPSG:25833, 1 m float32, 15010 × 15010, nodata -32767, SHA `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`.
- Normalized fixed-grid terrain: 1000 × 1000, 1 m EPSG:25832 + NN2000, 1,000,000 valid samples / 0 nodata, min 168.9711 m, max 197.6241 m, mean 189.7122 m, SHA `95c8fcf6f93c8fbb0533d6a82d68416b773f9a146970e1ae85676d3ba41c2adf`.
- Compiled terrain artifact: 4,000,382 B, SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`.
- Cold and offline runs produce identical raw, normalized and compiled artifact hashes; offline source requests = 0.
- Exact compiled terrain bytes pass `runtime_verifier.mjs`: `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`.
- Hosted baseline on the same terrain branch is PASS.

**Endret**
- Added `terrain_acquisition.py`, `terrain_artifacts.py`, explicit terrain warp support and focused regressions.
- Added D-007 for the proven Prototype-0 DTM1 transform/runtime artifact; final whole-Norway terrain/LOD format remains explicitly open.
- Added `docs/proofs/2026-08-17-nannestad-dtm1-realdata.md` and updated the P0 queue to close the source/index/terrain artifact gates.

**Neste**
- Feed the exact verified terrain artifact into the artifact-only Android/world-viewer together with the 246 road paths + 135 building footprints, use the DTM for ground Z, and measure terrain decode/mesh/upload/first-visible/frame-time/draw calls. In parallel, another agent can work Issue #5 on viewer batching/performance without touching compiler/geodata contracts.

## 2026-08-17 — Forsøk 16 Android terrain-integrated runtime

**Gjort**
- User executed Forsøk 16 on Android and supplied an oblique device screenshot of the exact terrain + road + building artifact harness.
- Inspected the harness implementation to separate displayed proof from inference: 1 m / 1000×1000 DTM1 remains world truth, the mobile GPU terrain is sampled to 129×129, roads preserve valid NVDB NN2000 centerline Z with DTM1 fallback, and unresolved building heights remain explicit 5 m debug geometry.
- Added `docs/proofs/2026-08-17-forsok16-android-runtime.md` and posted the measured device baseline to parallel viewer-performance Issue #5.
- Updated the P0 queue so terrain integration is no longer marked open; viewer measurement/batching and streaming behavior are now the immediate runtime gates.

**Bevist**
- Device HUD: road/building/terrain artifact PASS; 246 roads / 14.89 km; 135 footprints; 15 source-backed building heights / 120 debug heights; 1,000,000 DTM samples; DTM range 168.97–197.62 m; runtime `READY ×3`; raw source network `BLOKKERT · 0 KALL`.
- Captured performance: 1.3 ms terrain decode, 19.4 ms terrain mesh build, 220 ms boot, 224 draw calls, 16.7 ms / 60 FPS, 382 geometries / 2 textures at the captured camera.
- The screenshot rejects a gross CRS/origin/Z integration failure: terrain relief, imagery, road network and footprints occupy the same world area.
- The 224-call number is not accepted as a batching improvement because Forsøk 15's ~391 count used a different view and Forsøk 16 still creates separate geometries. The 382-geometry counter confirms per-object pressure remains.
- The 19.4 ms synchronous terrain mesh build exceeds one 60 Hz frame budget, so repeating it on the main thread during tile streaming is a concrete hitch risk.

**Endret**
- No new architecture decision was accepted; D-007 remains unchanged. This session adds device evidence and narrows the next experiments rather than selecting a renderer/format.
- Issue #5 now has the Forsøk 16 device metrics and same-camera comparison requirement.

**Neste**
- Build the repo-side fixed-camera benchmark required by Issue #5 and compare current per-object rendering against batching while preserving source-debug identity.
- Instrument first-visible separately and capture p50/p95/p99 frame time rather than one rolling average.
- Test terrain mesh generation in a worker or incrementally before moving to dynamic multi-tile load/unload/LOD.
