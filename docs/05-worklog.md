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
