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
**Evidence:** source-contract regressions plus real NVDB/OSM and DTM1 compiler verticals. The DTM1 source is EPSG:25833 and is explicitly transformed into the canonical EPSG:25832 Nannestad tile; NN2000 is preserved as the vertical datum.

## D-004 — Runtime-verifiable provenance

**Status:** Accepted and executed on hosted CI with real vector and terrain artifacts.  
**Decision:** provenance objects use versioned schemas, RFC 8785/JCS canonicalization and SHA-256; runtime reconstructs the hash chain rather than trusting supplied lineage strings or PASS flags.  
**Implementation:** Python uses pinned `rfc8785`; JS uses pinned `canonicalize`. `engine/streaming/runtime_verifier.mjs` reconstructs SourceSnapshot, TransformContract, NormalizedSnapshot, CompilerConfig, CompileLineage, immutable ArtifactRef and PromotionRecord identities, verifies reference edges/promotion gates and finally validates artifact byte size/SHA-256 before `READY_FOR_RUNTIME`. Transport relocation is excluded from immutable ArtifactRef identity.  
**Validation state:** hosted baseline executes the cross-language RFC8785/JCS and adversarial verifier regressions. Exact real Nannestad road, building and DTM1 terrain artifacts have also been verified as `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`.  
**Source authority:** Drive `02.7` remains semantic authority for portions not yet represented by complete versioned repo schemas.

## D-005 — GeoRSS polygon selection

**Status:** Accepted and live-source proven.  
**Decision:** an actual GeoRSS polygon requires an actual geometry predicate. A bounding box may only prefilter. Prototype-0 policy is boundary-inclusive source polygon covering target tile polygon, with explicit CRS/axis-order handling and fail-closed ambiguity.  
**Implementation:** `engine/compiler/src/nwe_compiler/spatial.py` + DTM1 source adapter use Shapely actual geometry and keep the legacy bbox-only adapter under `prototypes/`.  
**Evidence:** the live official DTM1 Atom feed contains 2033 polygon entries; exactly one declared polygon covers the Nannestad target tile.

## D-006 — Reuse mature geospatial and packaging libraries

**Status:** Accepted as tooling/foundation; does not select a renderer/runtime format.  
**Decision:** NWE will not maintain custom replacements for generic raster I/O/clipping, CRS transforms, topology predicates, RFC 8785 serialization, glTF optimization or 3D Tiles validation. The compiler pins Rasterio/GDAL, pyproj/PROJ, Shapely and `rfc8785`. Runtime packaging pins glTF-Transform/meshoptimizer and CesiumGS 3D Tiles validation/tools.  
**Reason:** these are mature generic problems; NWE's differentiated code is Norwegian source contracts, NN2000/CRS semantics, deterministic world compilation, provenance and simulation/runtime boundaries.  
**Consequence:** implicit reprojection/resampling remains forbidden. If a source needs either operation it must be an explicit TransformContract. 3D Tiles/CesiumJS remain an experiment under `prototypes/cesium-baseline/`, not an accepted runtime decision.

## D-007 — Prototype-0 DTM1 canonical transform and height-grid artifact

**Status:** Accepted for Nannestad Prototype 0 — 2026-08-17. Not a final whole-Norway streaming-format decision.  
**Source fact:** the current official Kartverket/Geonorge DTM1 Atom dataset feed advertises DTM1 tiles in `EPSG:25833`, GeoTIFF, with declared GeoRSS polygons. The unique source covering the Nannestad tile is `33-125-117.tif`.  
**Decision:** preserve the raw DTM1 GeoTIFF as a content-addressed SourceSnapshot in EPSG:25833 + NN2000. Normalize the Nannestad tile with an explicit Rasterio/GDAL transform to a fixed 1000 × 1000, 1 m `EPSG:25832` grid, preserving NN2000 and using explicit bilinear resampling for continuous elevation. The existing no-resampling pixel-window normalizer remains strict and separate.  
**Runtime artifact:** compile the normalized GeoTIFF into `nwe.terrain-height-grid-artifact/0.1`: canonical header plus 1000 × 1000 little-endian float32 elevations, row-major north-to-south. This is an engine-independent Prototype-0 runtime interchange artifact; it does not select the eventual whole-Norway tile/LOD/mesh format.  
**Evidence:** real hosted proof downloaded and SHA-256-bound the 1,096,856,487-byte source, produced a deterministic 1 m normalized raster and a deterministic 4,000,382-byte terrain artifact on cold and source-network-free offline runs. The exact compiled bytes pass `runtime_verifier.mjs` with `READY_FOR_RUNTIME`.  
**Consequence:** normal runtime must consume the verified height-grid artifact (or a later explicitly versioned compiled derivative) and must not contact the DTM1 Atom/GeoTIFF source. Any change in resampling, output grid, precision/quantization or vertical handling is a new transform/compiler configuration and must produce a different lineage/artifact identity.

## D-008 — Prototype-0 multi-tile terrain uses direct NHM DTM 25832 WCS acquisition

**Status:** FORGE accepted for Nannestad Prototype-0 multi-tile compiler direction — 2026-08-19. Pending SENTINEL integration to `main`; not a whole-Norway terrain-source decision.  
**Problem:** the downloadable DTM1 Atom packaging is nominally 15 km but the tested source GeoTIFFs are 15,010 × 15,010 at 1 m and overlap by 10 m. The overlapping valid heights disagree. A symmetric 5 px-per-side core clip is geometrically plausible but the controlled real experiment did not corroborate it as provider truth: it ranked 11/11 on local seam continuity and 6/11 against Kartverket's seamless WCS QA surface, while the two diagnostics preferred different ownership splits. NWE will not invent a 5/5, newest, first, mean, tolerance or file-order seam rule.  
**Source fact:** Kartverket publishes `NHM DTM 25832 WCS` as a public download service for the national digital terrain model with 1 m output in EUREF89 / UTM zone 32 for the documented coverage area. Kartverket's free/open products are licensed CC BY 4.0 with attribution `© Kartverket`. The Nannestad/FvL terrain source family is documented against NN2000, while the individual WCS GeoTIFF/GetCoverage response does not independently encode a compound vertical CRS. Therefore D-008's NN2000 binding is explicit provenance inherited from the source-family/Prototype-0 contract and remains a SENTINEL-review point rather than being inferred from anonymous raster Z.  
**Decision:** for the Nannestad Prototype-0 multi-tile compiler, acquire one exact WCS `GetCoverage` response per NWE 1 km runtime tile in `EPSG:25832`, validate exact bounds / 1000 × 1000 / 1 m / full valid coverage, preserve the raw GeoTIFF bytes as the content-addressed `SourceSnapshot`, and normalize by deterministic Float32 decode only. The TransformContract is `nhm-wcs-direct-grid-validate-decode-float32-no-resampling`: source and target CRS are both EPSG:25832, vertical operation is `identity-NN2000` under the explicit Prototype-0/source-family binding, and resampling is `none`.  
**Evidence:** the isolated 3×3 candidate fetched all nine exact runtime grids twice with identical raw/grid hashes and measured all 12 internal boundaries without artificial tile-wall behavior. The provenance-bearing hosted proof then performed one controlled cold acquisition/compile/persist followed by a source-network-free offline repeat: 9/9 source, normalized, artifact and promotion identities were identical; offline provider calls were zero; and all nine exact compiled artifacts passed `runtime_verifier.mjs` as `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`. Proof: `docs/proofs/2026-08-19-nhm-wcs-3x3-promotion.md`.  
**Center-tile consequence:** this is a deliberate source/transform change, so the center artifact is intentionally different from D-007. D-007 Atom artifact SHA remains `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`; direct-WCS center artifact SHA is `a0f6107ce9497a9e7221aa06a7b590cb9b8b2958ac316c32ef79059e604b052e`. The old artifact remains valid historical evidence for D-007 and must not be silently relabeled as WCS output.  
**Scope/consequence:** this removes the 15 km Atom overlap from the Nannestad multi-tile production path instead of guessing its border ownership. Runtime still consumes verified compiled artifacts and never contacts WCS. Whole-Norway terrain acquisition, zone transitions, provider request-rate/bulk-download policy, final terrain mesh/LOD format and whether WCS remains the best source surface outside the tested UTM32 scope remain open and evidence-driven.

## Open decisions

- Whole-Norway coordinate/tile indexing strategy.
- Whole-Norway terrain source/acquisition strategy across UTM zones and service/bulk-download limits; D-008 is Nannestad/Prototype-0 only.
- Final whole-Norway terrain mesh/LOD and 3D Tiles-like vs custom/hybrid streaming format; the Prototype-0 height grid is only an interchange/runtime proof artifact.
- Three.js/WebGPU vs other web renderer details after real artifact measurement.
- Unreal role after engine-independent import/streaming evidence.
- Client/worker/server split for simulation.
- FKB access/redistribution strategy and production imagery source/license.
