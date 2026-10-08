# 04 — Decisions

Only decisions with evidence or an explicit product requirement belong here. Open questions remain explicitly open.

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
**Consequence:** implicit reprojection/resampling remains forbidden. If a source needs either operation it must be an explicit TransformContract. 3D Tiles/CesiumJS remain available as interoperability/reference experiments rather than the default ground-level player renderer.

## D-007 — Prototype-0 DTM1 canonical transform and height-grid artifact

**Status:** Accepted for Nannestad Prototype 0 — 2026-08-17. Not a final whole-Norway streaming-format decision.
**Source fact:** the current official Kartverket/Geonorge DTM1 Atom dataset feed advertises DTM1 tiles in `EPSG:25833`, GeoTIFF, with declared GeoRSS polygons. The unique source covering the Nannestad tile is `33-125-117.tif`.
**Decision:** preserve the raw DTM1 GeoTIFF as a content-addressed SourceSnapshot in EPSG:25833 + NN2000. Normalize the Nannestad tile with an explicit Rasterio/GDAL transform to a fixed 1000 × 1000, 1 m `EPSG:25832` grid, preserving NN2000 and using explicit bilinear resampling for continuous elevation. The existing no-resampling pixel-window normalizer remains strict and separate.
**Runtime artifact:** compile the normalized GeoTIFF into `nwe.terrain-height-grid-artifact/0.1`: canonical header plus 1000 × 1000 little-endian float32 elevations, row-major north-to-south. This is an engine-independent Prototype-0 runtime interchange artifact; it does not select the eventual whole-Norway tile/LOD/mesh format.
**Evidence:** real hosted proof downloaded and SHA-256-bound the 1,096,856,487-byte source, produced a deterministic 1 m normalized raster and a deterministic 4,000,382-byte terrain artifact on cold and source-network-free offline runs. The exact compiled bytes pass `runtime_verifier.mjs` with `READY_FOR_RUNTIME`.
**Consequence:** normal runtime must consume the verified height-grid artifact (or a later explicitly versioned compiled derivative) and must not contact the DTM1 Atom/GeoTIFF source. Any change in resampling, output grid, precision/quantization or vertical handling is a new transform/compiler configuration and must produce a different lineage/artifact identity.

## D-008 — Ground-level product target + Three.js working renderer

**Status:** Superseded as sole product-runtime selection by D-009 on 2026-09-03; reactivated as an active product surface by D-010 on 2026-10-08.
**Product requirement:** the primary experience is free movement near the ground — initially walking, later driving/interacting — with strong materials, shaders, lighting and game-like presentation. High-altitude globe navigation is not the current design center.
**Decision:** Three.js is the primary working web renderer for the Nannestad playable vertical slice, with a WebGPU-first capability path where genuinely available and WebGL2 fallback/baseline. Cesium/3D Tiles remain useful standards/reference/interop tools, not the primary player renderer.
**Engine-portability requirement:** Three.js may own GPU objects, materials, shaders, animation mixers and render-local scene resources only. `THREE.*` types must not enter authoritative world state, compiler artifacts, provenance schemas, tile identity or simulation contracts.
**Unreal consequence:** Unreal Engine support is an importer/runtime adapter over the same engine-neutral compiled data, coordinates, IDs and entity state rather than a second Norwegian data pipeline.

## D-009 — Unreal Engine 5.8 is an active game runtime

**Status:** Accepted from explicit product requirement — 2026-09-03; remains valid in parallel under D-010.
**Product requirement:** build the game in Unreal Engine 5, in real Nannestad, with realistic graphics and human characters.
**Decision:** Unreal Engine 5.8 on Windows PC is an active runtime for a third-person vertical slice. `apps/unreal-runtime` consumes the existing engine-neutral DTM1/NVDB/OSM artifacts and full provenance contract through a deterministic adapter.
**World boundary:** Unreal Actors, Components, Landscapes, materials and animation are derived presentation/runtime state. EPSG:25832, NN2000, source lineage, artifact identity and fallback-vs-source semantics remain outside UE objects and continue to obey D-002/D-004/D-007.
**Evidence state:** deterministic external conversion and real-snapshot verification pass. A UE 5.8 Windows compile/play/render/package is still open and must not be inferred from Python/C++ source checks.
**Plan:** `docs/09-unreal-game-plan.md`.

## D-010 — Nannestad 1×1 WebUI is the immediate delivery surface

**Status:** Accepted from explicit product requirement — 2026-10-08.

**Product requirement:** the user wants the real 1×1 km Nannestad slice in the WebUI now, with free movement and the highest practical realism, rather than treating the browser viewer as historical-only.

**Decision:** `apps/world-viewer` is again an active product and acceptance surface. The immediate critical path is the verified Nannestad 1×1 km browser world. Unreal remains a parallel runtime adapter and D-009 is not revoked; neither renderer may own or redefine Norwegian world truth.

**World-truth policy:**
- accepted DTM1 geometry, NVDB/OSM source geometry and authoritative coordinate state remain unchanged unless a separately admitted compiler/source decision replaces them;
- NHM DOM−DTM building height and fitted roof direction remain guarded derived presentation semantics, not surveyed geometry;
- NIBIO SR16V representatives preserve source class/height/density semantics, while individual point placement/tree mesh is representative presentation, not observed individual-tree truth;
- NVDB road width/surface and explicit street-detail geometry may progressively replace renderer fallbacks only where source-backed values/geometry exist;
- missing sign face identity, exact pole dimensions, missing road-marking widths, façade windows/doors and similar details must remain renderer fallbacks until an admitted source supports a stronger claim.

**Runtime policy:** normal WebUI consumes compiled/SHA-verified runtime artifacts and derived layers. It must not contact Kartverket, NVDB, OSM/NIBIO or other raw Norwegian provider endpoints during ordinary play.

**Visual policy:** local licensed PBR assets, lighting, fog, post-processing, procedural microdetail and renderer proxies are allowed to improve realism so long as they remain explicitly presentation-only and do not displace source geometry.

**Evidence required:** green unit/build/provenance tests are necessary but insufficient for a visual claim. The integrated milestone requires exact hosted browser evidence, free movement/grounding, zero raw-source acquisition and screenshot-level inspection of the current head.

**Consequence:** `docs/03-roadmap.md` and `docs/06-task-queue.md` prioritize Web Nannestad realism until this 1×1 milestone is accepted. UE Windows evidence continues independently.

## Open decisions

- Whether direct `NHM DTM 25832 WCS` should supersede the accepted D-007 Atom source path for Nannestad multi-tile terrain. Canonical multi-tile terrain authority remains fail-closed until source-family/seam authority is reconciled.
- Whole-Norway coordinate/tile indexing strategy.
- Whole-Norway terrain source/acquisition strategy across UTM zones and service/bulk-download limits.
- Final whole-Norway terrain mesh/LOD and 3D Tiles-like vs custom/hybrid streaming format; the Prototype-0 height grid is only an interchange/runtime proof artifact.
- Exact WebGPU/WebGL high/ultra material, vegetation, street-detail, frame-time and memory budgets after integrated real-data measurements.
- Exact source strategy for stronger building façade/roof geometry and production imagery/land-cover under verified access and redistribution rights.
- Exact sign-face/type/orientation enrichment path from NVDB relations before rendering real traffic symbols.
- UE native Landscape/World Partition cell sizing and Nanite choice after measured Windows evidence.
- Physics/collision library and client/worker/server split for simulation.
- FKB access/redistribution strategy.
