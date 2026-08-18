# 2026-08-18 — Preview 1 real Nannestad world gate

## Goal

Make the normal deployable World Viewer surface a real compiled Nannestad scene instead of a synthetic laboratory fixture.

Preview 1 acceptance is deliberately narrow:

- one accepted 1 × 1 km Nannestad tile;
- real compiled DTM1 terrain;
- real compiled NVDB road geometry;
- real compiled OSM building footprints;
- full RuntimeVerificationBundle reconstruction before decode/use;
- zero raw Kartverket/NVDB/OSM runtime acquisition;
- browser DedicatedWorker terrain mesh path;
- an interactive orbit/zoom viewer with runtime/debug metrics;
- no claim that debug road width or unresolved building height is authoritative.

Forsøk 18 remains available through `?lab=terrain`; it is no longer the intended default product surface.

## Runtime distribution boundary

Generated runtime tiles remain excluded from `main`. Preview 1 introduces a temporary, replaceable transport snapshot on the orphan `preview-runtime` branch. The branch is force-replaced by CI and contains only:

- RuntimeVerificationBundles;
- exact content-addressed compiled terrain/vector artifacts;
- a small `nwe.world-preview-manifest/0.1` index;
- attribution metadata.

Raw DTM1 GeoTIFF, NVDB responses and OSM responses are never copied into that branch. `tools/preview/stage_preview1_snapshot.py` refuses non-`cache://compiled/` transports, raw-source markers and unsafe relative paths, then verifies artifact SHA-256 and byte size before staging.

This branch is a Prototype-0 delivery bridge, not a selected whole-Norway object store/CDN architecture. Replacing it later must not change artifact identity or the viewer's compiled-artifact-only boundary.

## Viewer composition

The default Vite viewer now:

1. fetches the preview manifest;
2. loads road/building artifacts through `loadCompiledJsonArtifact`, including full WebCrypto/JCS graph verification;
3. loads terrain through `loadTerrainRuntimeInput -> verifyRuntimeBundleWeb -> terrain_tile_loader -> TerrainMeshWorkerClient -> TileStreamingScheduler`;
4. uses the verified returned terrain height grid to ground road fallback Z and building bases;
5. renders the accepted terrain mesh, road ribbons and building volumes in one interactive WebGL2 preview adapter.

WebGL2 here is a replaceable Preview-1 rendering adapter. This change does not select WebGL2, Three.js, WebGPU, Cesium or Unreal as the final renderer.

## Geometry honesty

- NVDB source Z is retained where valid; terrain sampling is fallback/ground reference.
- Road ribbon width is a **3.2 m visual debug width only**. Physical road width/lane/crossfall semantics remain open.
- Source-backed building heights are used where present.
- Buildings with unresolved authoritative height use an explicit **5 m visual debug extrusion only**. The manifest and UI keep that unresolved state visible.
- Roof filling is preview visualization, not a building-topology or roof-model decision.

## Validation built into the branch

- `tools/preview/test_stage_preview1_snapshot.py`: 7 focused transport/content-identity regressions pass locally in the authoring environment.
- CI recompiles real terrain + vectors, stages only compiled runtime output, runs the Node runtime verifier against every staged artifact and builds the Vite viewer before it can force-update `preview-runtime`.
- The default viewer fails closed if the runtime manifest/snapshot is unavailable or fails verification; it does not silently substitute synthetic world truth.

## Acceptance still requiring hosted evidence

Do not call Preview 1 complete until the branch workflow proves all three real layers, publishes the snapshot, and the Vercel preview loads that snapshot successfully. Android/device frame-time remains a subsequent evidence gate rather than a condition for first visual Preview 1 availability.

## Next after Preview 1

1. Validate the deployed real Preview 1 on desktop + Android and capture verification/decode/worker/GPU/rAF evidence.
2. Promote the same compiled-artifact viewer path to real neighboring tiles.
3. Build Preview 2 as 3 × 3 dynamic world streaming; do not duplicate a separate viewer architecture.
4. Only then advance building-height enrichment, physical road semantics, materials, vegetation and representative props.
