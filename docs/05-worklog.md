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
- Added a production-direction Python World Compiler package with pinned Rasterio 1.5.1, pyproj 3.7.2, Shapely 2.1.2 and `rfc8785` 0.1.4.
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
- Local Python syntax checks PASS for the new compiler code.
- Local geospatial regressions PASS: 4 tests covering Shapely box/polygon containment, SENTINEL triangle rejection and byte-repeatable Rasterio clip (`4 passed`).
- Local Node syntax checks PASS for the schema helper, runtime verifier/regression and Cesium benchmark source.
- PR #3 is mergeable against `main`.
- GitHub Actions run #44 created for PR #3 but the sole hosted job failed with zero executed steps; the Actions API returns an empty step list and no downloadable job log. This is an infrastructure/runner failure before repository commands execute, not evidence of a failed code test.
- Package/API versions and documented usage were verified against PyPI/npm/official Cesium/glTF sources before pinning.

**Ikke bevist / blokkert**
- The isolated container could not download `rfc8785`/npm packages, so the actual cross-language JCS test, full runtime verifier execution and Cesium Vite build were not executed locally. They are wired into CI and must not be reported PASS until a dependency-capable runner executes them.
- P0-REALDATA-01 remains open: this change provides the normalizer/toolchain but does not materialize the production DTM1 15 km GeoTIFF.

**Neste**
- Run the dependency-backed provenance regressions once CI/runner access works, then use a network-capable compiler execution to materialize the authoritative DTM1 raw → normalized Nannestad artifact. Once a compiled GLB/tileset exists, run the Cesium/custom-viewer comparison instead of adding more viewer features.

## 2026-08-17 — NVDB/OSM vector compiler adapters

**Gjort**
- Continued on a stacked branch from the latest unmerged `agent/core-geospatial-tooling` state rather than rebuilding from `main` or from the historical Drive HTML prototypes.
- Added `nwe_compiler.roads`: deterministic duplicate suppression, 0.25 m endpoint snapping and graph collapse through degree-2 nodes while preserving NVDB sequence IDs as provenance. This targets the Forsøk 14 observation `443 raw -> 443 paths` where browser logic failed to merge source segmentation.
- Added `nwe_compiler.sources.nvdb`: segmented road WKT ingestion, explicit EPSG:25833 -> EPSG:25832 reprojection with `always_xy=True`, NN2000 Z preservation, sentinel/invalid Z -> null and Shapely-based 1 km tile clipping. Z at new clip vertices is reconstructed from the original source segment instead of trusting GEOS Z behavior.
- Added `nwe_compiler.sources.osm_buildings`: OSM Main API/Overpass way ingestion, WGS84 -> EPSG:25832, Shapely polygon validity/area/tile gates, explicit `height` and `building:levels` provenance and unresolved height rather than an authoritative heuristic.
- Added six vector regressions covering road merge, junction boundaries, NVDB reprojection/Z policy, clip-boundary Z interpolation, OSM building normalization and invalid bow-tie rejection.

**Bevist**
- Android Forsøk 14 supplied 443 NVDB raw segments and 133 OSM building footprints; source acquisition is feasible, while its browser road graph did not reduce raw segmentation.
- Local focused vector suite: `6 passed in 0.15s`.
- The first custom line-clipping implementation was rejected during self-review because repo policy prefers pinned Shapely for generic geometry. It was replaced before handoff and a boundary-Z regression was added.

**Endret**
- Branch: `agent/nvdb-osm-compiler-adapters`, stacked on the current core geospatial tooling branch. No merge to `main`.
- Compiler now has production-direction vector normalization primitives beside the existing DTM/raster/provenance foundation.

**Neste**
- Persist real Nannestad NVDB/OSM responses outside Git as raw cache, bind SourceSnapshot/retrieval/license identity, run these adapters over the real 443/133 sample and emit deterministic normalized/compiled vector artifacts with RFC 8785 hashes. Viewer/runtime must then consume artifacts with zero raw NVDB/OSM contact.
