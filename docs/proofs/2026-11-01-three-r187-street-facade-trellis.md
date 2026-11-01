# Three r187 + street/facade realism + NVIDIA TRELLIS intake — 2026-11-01

## Scope

This proof records a renderer/presentation realism slice on draft PR #85. It does **not** replace the active LiDAR/source-fidelity priority and does not promote generated geometry to geographic truth.

## Three.js

- `apps/world-viewer` is pinned to `three@0.187.0` (r187), verified as the current stable npm/release line on 2026-11-01.
- r187 changes PMREM/environment-light internals relative to the previous r185 baseline, so the dependency bump is treated as a visual revalidation rather than a no-op package update.
- Existing WebGPU-first/WebGL2 fallback boundaries remain unchanged.

## Roads / road markings

The accepted NVDB geometry and width/surface provenance are unchanged. Presentation now consumes more admitted NVDB properties where present:

- road-marking width remains source-driven when present;
- `Materialtype` distinguishes paint from extruded plastic with separate PBR response;
- source `Tykkelse` is interpreted as millimetres only inside a conservative 0.5–20 mm gate;
- renderer fallback is 1.5 mm paint / 3 mm plastic when source thickness is absent;
- the previous centimetre-scale visual lift is removed in favor of a bounded millimetre-scale anti-z-fighting lift.

No road centreline, source width or accepted terrain geometry was changed.

## Signs and roadside objects

Current admitted NVDB type 95 `Skiltpunkt` properties are used to improve the physical support geometry:

- 60.3 mm and 88.9 mm poles;
- 120/150 mm octagonal columns;
- lattice-mast and light-mast support classes;
- source `Høyde over vegkant` when present and plausible;
- steel vs wood light-mast presentation from the source type property.

The sign face remains a neutral presentation plate. The renderer explicitly refuses to invent a speed-limit/warning symbol because type 95 does not establish the actual sign-face identity.

Current official Statens vegvesen documentation identifies **NVDB type 96 `Skiltplate`** as the public traffic-sign dataset. NVDB API V4 also keeps relations as a first-class response field, and the Datakatalog is the authority for type properties/relations. `P1-SIGN-SEMANTICS` therefore remains open: type 96 must be admitted and its relationship/orientation/dimensions proven before actual traffic symbols are rendered.

## Buildings

The source footprint/height/roof-direction hierarchy is unchanged. Renderer-only facade presentation was upgraded from flat dark boxes to:

- separate reflective physical glass panes;
- separately instanced extruded frames;
- physically-based door presentation;
- explicit facade material stats and unchanged truth guard.

Window/door position, count, dimensions and material are still procedural presentation. They are **not observed Nannestad facade truth**.

## NVIDIA 3D generation

The current relevant NVIDIA Build/NIM object generator is Microsoft TRELLIS (text/image to 3D, GLB output). The older NVIDIA 3D Object Generation Blueprint that combined TRELLIS + SANA is deprecated, so NWE does not make that blueprint a core dependency.

Added `tools/visual-data/generate_trellis_asset.py` as an optional **offline authoring intake**:

- accepts only an operator-started loopback NIM endpoint;
- stores no NVIDIA/NGC credentials;
- validates GLB magic/version/declared byte length;
- emits SHA-256 + provenance sidecar `nwe.ai-generated-presentation-asset/0.1`;
- classifies every generated asset as `GENERATED_UNREVIEWED`;
- sets `geographic_source_truth=false` and `runtime_ready=false`;
- requires visual, scale, triangle/material/texture, LOD/retopology and license review before promotion.

Generated assets may later be used as generic reusable visual props. They must never be represented as surveyed/source-observed Norwegian geometry.

## Validation

Implementation head `412adf0f62ab859b54b547b8c2b0320cbcef8e0d`:

- `baseline` run `41315408801`: PASS;
- `world-viewer-vite` run `41315408798`: PASS, including full viewer regressions, Vite production build, browser provenance/decode, exact Preview-1 renderer A/B, device-evidence movement/cache smoke and 1000×1000 DedicatedWorker gate;
- `viewer-benchmark` run `41315408722`: PASS;
- `nvdb-road-semantics-proof` run `41315408706`: PASS.

`preview1-visual-proof` run `41315408676` built the exact r187 viewer and all renderer tests successfully, but failed **before screenshot rendering** while staging terrain because the upstream Kartverket acquisition returned HTTP 504. Therefore no new screenshot-quality claim is made from that run.

The TRELLIS intake has four deterministic local contract tests (valid GLB/manifest truth guard, base64 decode, malformed GLB rejection, loopback-only endpoint). CI now executes these tests in `visual-source-probe` before external source probes.

## Next

1. Admit NVDB type 96 `Skiltplate` as a separately identifiable source layer and preserve its relation/type/dimension/orientation evidence before rendering actual sign symbols.
2. Re-run the exact screenshot gate when terrain snapshot staging is available and visually inspect r187 PMREM/PBR changes plus the new markings, supports and facade frames.
3. Keep LiDAR exact-byte acquisition/reconstruction as the highest-value source-fidelity path for roofs/canopy/near-field terrain.
