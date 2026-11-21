# Nannestad building variation + verified Sentinel-2 ground — 2026-11-21

## Acceptance scope

Explicit user-requested continuation of draft [PR #85](https://github.com/B4kke/Norge-World-Engine/pull/85), active Nannestad 1×1 km WebUI. This is an **improvement to renderer-only presentation** of existing SHA-verified real Norwegian source geometry, **not** new authoritative roof surveys, façade observations, or high-resolution orthophotography.

**Accepted code-bearing head:** `6e126ca95500881f8541430baadcfd8690dabd13` (plus subsequent documentation-only commits).

**Vercel Preview:** [READY deployment](https://norge-world-engine-viewer-1r8az4h6q-b4kkes-projects.vercel.app/), `dpl_9vs6BZccD4eH2cRpPVoLSQEaYGUp` (existing project preview is Vercel-SSO protected; no production promotion).

## What changed

1. `apps/world-viewer/src/buildingPresentationPalette.mjs`: deterministic source-ID-keyed, type-aware Norwegian residential/agricultural/auxiliary/commercial/generic wall and roof presentation palettes. Converts sRGB palette channels to linear RGB before passing vertex colors to Three. Colors are illustrative and do not encode surveyed facade/roof appearance.
2. `buildingSurfaceGeometry.mjs` adds separate, per-building colors to the same four source-backed/resolved and fallback, wall and roof **batched geometry meshes**. The local 1k CC0 `weathered_plank_siding` and `grey_roof_01` PBR maps (diffuse/normal/roughness) remain active, multiplied by building-specific color. No per-house draw calls or new remote texture runtime requests.
3. Renderer-only pitched presentation gables are added for **eligible rectangular four-edge footprints**, even where a source-backed direction is unavailable. Strong DOM-derived candidate orientation retains priority where present. Invalid/skew/irregular quads remain flat. Unknown roof geometry is not silently recorded as source geometry.
4. `threeBuildingFacadeLayer.mjs` gains deterministic per-source-instance color on window-frame and door InstancedMeshes; draw-call count stays at 3 for facade detail. Frame, pane and door transforms remain renderer-only decoration.
5. `groundMaterialAssets.mjs` keeps **manifest-bound, SHA-verified Sentinel-2 10 m/pixel RGB macro-color** as default terrain diffuse when present. Local CC0 surface normal/roughness add close-view tactile texture but **do not create genuine submeter geographic detail**. The viewport has an accessible “Bakke · Satellitt (10 m)” button that toggles existing GPU maps to/from generic PBR; unsupported satellite options fail closed.
6. `main.ts` exposes read-only renderer acceptance evidence; `capture_preview1_screenshot.mjs` checks palette distribution, exact Sentinel SHA, actual Chrome UI toggle, restore and unchanged source/terrain identity in the **existing** exact-real-data screenshot workflow.

## Verified evidence (not inferred from code)

- **Real headless Chrome/WebGL2 screenshot + UI**: [GitHub Actions run 44875977840](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977840), job `136760635542`, **PASS**, `building_satellite_ui.status=PASS`. Browser source composition includes **135 accepted Nannestad footprint buildings**. Saved screenshot artifact: [preview1-visual-proof-6e126ca](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977840/artifacts/14695818501) (retention limited).
- **Palettes:** resolved 120 buildings: 59 residential, 32 auxiliary, 8 agricultural, 18 commercial, 3 generic; **25 resolved wall style keys** and **19 resolved roof style keys**. Fallback-height 15 buildings: 2 residential, 9 auxiliary, 2 commercial, 2 generic; **9 fallback wall keys** and **8 fallback roof keys**. Totals **34 wall keys and 27 roof keys counted across two mesh groups**; these group sums do **not** assert 34 or 27 distinct globally observed colors.
- **Roofs:** 16 rendered visual gables (10 DOM-direction-oriented plus 6 purely visual rectangular-fallback gables), with remaining buildings using the conservative flat presentation. All source footprints/heights remain unchanged.
- **Satellites:** Sentinel-2 STAC item `S2B_T32VPM_20260723T104808_L2A` (acquisition 2026-07-23 10:54:11Z) already staged in existing runtime. Native **10 m/pixel** RGB, verified material texture SHA-256 `0bbe8079f2fb2eedffaec3612f7cdb9724b12b061613b74751db388af1f2e55a`. **Default=satellite, PBR toggle PASS, restore=satellite PASS**. Exact same accepted terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96` and building SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd` across controls. Zero new raw provider runtime fetches.
- **Daylight view:** same run captured `preview1-ground-ready.png` at 1440×900, software WebGL2 headless, sampled image mean luminance 177.2/255 and bright-pixel fraction 93.86%; **solar_clock_ui PASS** and existing **tree_camera_ab PASS** remain intact. Pixel visibility is evidenced, but a visually convincing “real Norwegian architecture” remains a subjective/physical-GPU follow-up.
- **Code/build/other gates**: exact code SHA `6e126ca...`: [world-viewer-vite](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977770) **PASS** (tests + Vite bundle), [baseline](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977798) **PASS**, [viewer-benchmark](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977772) **PASS**, with other source/validation gates PASS. Older intermediate commits temporarily failed because an old test expected one gable but the new rule yielded two; corrected with explicit source-oriented vs fallback assertions. In-progress/cancelled provider/publishing runs are not substituted for exact head production evidence. Source-LiDAR admission remains a separate P0 open gate.
- **GPU budget:** this change retains the four batched wall/roof mesh draw candidates and three facade-detail InstancedMesh candidates. Vertex and instance color buffers raise GPU memory slightly (now included in estimate); **no measured FPS increase, physical GPU benchmark or photorealism claim**.

## Rights and provenance boundaries

The source color is **Copernicus Sentinel-2**, already redistribution-admitted/attributed in the local immutable runtime, not aerial imagery from *Norge i bilder*. No unlicensed high-resolution ortho assets were fetched or committed. Source acquisition and transforms remain preprocessing-only; per-building palette colors, gable guesses and frame/door details are **renderer-only**, and no new source-authored roof texture/geometry has been introduced.

Official references: [Copernicus Sentinel-2 collection](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2) (RGB 10 m), [Kartverket licence/terms](https://www.kartverket.no/en/api-and-data/terms-of-use). Existing official dataset/provenance source descriptors are SHA-verified in the `preview-runtime` manifest.

## Remaining realism limits and next task

- Sentinel-2 macro-color cannot supply parcel- or building-scale ground truth; genuine orthophotos require separate legal admission, source staging, runtime budget and coverage confirmation.
- One pinned wall siding and roof PBR material family gets different palettes; this is more varied building appearance, **not yet** unique brick/plaster/paint/roof-tile materials per surveyed building, or multiple new licensed material texture sources.
- 6 new visual gables are not surveyed shapes. Strong DOM directions remain fitted candidates, not FKB roofs. More accurate building form depends on the exact-byte LiDAR source admission gate, which is still open.
- The current scene is verified in hosted software WebGL2 and via Vercel Preview; physical-device FPS/GPU frame-time and qualitative near-building visual review remain open before increasing geometry/texture cost.

**Next:** source-backed near-field building shape/material candidates (and rights-checked orthophoto alternative where feasible), measured against same-camera screenshot and real hardware frame budgets. Do not replace existing verified 10 m imagery or make an unverifiable photorealism claim.
