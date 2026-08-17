# 04 — Decisions

Only decisions with evidence belong here. Open questions remain explicitly open.

## D-001 — GitHub is canonical implementation surface

**Status:** Accepted — 2026-08-17  
**Decision:** New code, tests, schemas, CI, implementation history and tasks live in GitHub. Google Drive remains long-form research/history/reference.  
**Reason:** implementation needs reviewable diffs, branches, CI and reproducible repository state.  
**Consequence:** old “Drive-first” instructions are historical for implementation work; Drive code copies are migration sources only.

## D-002 — Engine-independent world compiler boundary

**Status:** Accepted for Prototype 0 direction; runtime choice remains open.  
**Decision:** preprocessing emits engine-independent runtime artifacts/contracts. Unreal, WebGPU and other render/runtime candidates consume this boundary rather than owning source ingestion.  
**Reason:** avoids premature engine lock-in and keeps data/compiler reusable.

## D-003 — Nannestad normalization hypothesis

**Status:** Verified for Prototype 0; not a whole-Norway final policy.  
**Decision:** use EPSG:25832 horizontally and explicit NN2000 vertical datum for the Nannestad prototype where supported by source contracts.  
**Evidence:** existing source-contract verifier/Drive research; round-trip proof is stored under `tests/fixtures/`.

## D-004 — Runtime-verifiable provenance

**Status:** Contract accepted; production-direction reconstruction implemented; dependency-backed execution validation pending.  
**Decision:** provenance objects use versioned schemas, RFC 8785/JCS canonicalization and SHA-256; runtime reconstructs the hash chain rather than trusting supplied lineage strings or PASS flags.  
**Implementation:** Python uses pinned `rfc8785`; JS uses pinned `canonicalize`. `engine/streaming/runtime_verifier.mjs` reconstructs SourceSnapshot, TransformContract, NormalizedSnapshot, CompilerConfig, CompileLineage, immutable ArtifactRef and PromotionRecord identities, verifies reference edges/promotion gates and finally validates artifact byte size/SHA-256 before `READY_FOR_RUNTIME`. Transport relocation is excluded from immutable ArtifactRef identity.  
**Validation state:** syntax is locally verified and the forged-lineage/clip-mutation/raw-source/tampered-byte regressions are committed and wired into CI. The dependency-backed Node test has not executed because the available hosted runner currently fails before step 1; do not mark P0-PROVENANCE-02 closed until the regression actually runs.  
**Source authority:** Drive `02.7 – RuntimeVerificationBundle + SpatialIndex Contract v0.1` until represented by complete versioned repo schemas.

## D-005 — GeoRSS polygon selection

**Status:** Contract accepted; production-direction implementation added.  
**Decision:** an actual GeoRSS polygon requires an actual geometry predicate. A bounding box may only prefilter. Prototype-0 policy is boundary-inclusive source polygon covering target tile polygon, with explicit CRS/axis-order handling and fail-closed ambiguity.  
**Implementation:** `engine/compiler/src/nwe_compiler/spatial.py` + DTM1 source adapter use Shapely actual geometry and keep the legacy bbox-only adapter under `prototypes/`.

## D-006 — Reuse mature geospatial and packaging libraries

**Status:** Accepted as tooling/foundation; does not select a renderer/runtime format.  
**Decision:** NWE will not maintain custom replacements for generic raster I/O/clipping, CRS transforms, topology predicates, RFC 8785 serialization, glTF optimization or 3D Tiles validation. The compiler pins Rasterio/GDAL, pyproj/PROJ, Shapely and `rfc8785`. Runtime packaging pins glTF-Transform/meshoptimizer and CesiumGS 3D Tiles validation/tools.  
**Reason:** these are mature generic problems; NWE's differentiated code is Norwegian source contracts, NN2000/CRS semantics, deterministic world compilation, provenance and simulation/runtime boundaries.  
**Consequence:** implicit reprojection/resampling remains forbidden in the Prototype-0 DTM normalizer; such changes require an explicit TransformContract. 3D Tiles/CesiumJS remain an experiment under `prototypes/cesium-baseline/`, not an accepted runtime decision.

## Open decisions

- Whole-Norway coordinate/tile indexing strategy.
- Exact compiled terrain/mesh format and 3D Tiles-like vs custom/hybrid streaming format.
- Three.js/WebGPU vs other web renderer details after real artifact measurement.
- Unreal role after engine-independent import/streaming evidence.
- Client/worker/server split for simulation.
- FKB access/redistribution strategy and production imagery source/license.
