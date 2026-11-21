# 06 — Active task queue

This file is the **current execution queue**. Historical queue states remain in Git history and archived logs; do not reintroduce stale priorities.

## Priority rule — 2026-11-01

The explicit product priority is **Nannestad 1×1 km in the normal WebUI, freely navigable and as realistic as admitted data/performance allows**. Unreal Engine remains a parallel adapter track and does not block this Web milestone.

The next engineering priority is no longer another generic proxy/post-processing pass. It is a bounded **LiDAR gold-tile source-fidelity experiment** over the existing accepted 1×1 km tile. Existing visual/runtime acceptance remains valid and must not be weakened, but source-derived roof/canopy/near-field terrain fidelity is now the highest-value unknown.

Do not displace the active 1×1 km slice with whole-Norway terrain archaeology, networking, AI/NPC work or unrelated renderer comparisons.

## Proven foundation — do not re-prove by default

- accepted single-tile Kartverket DTM1 terrain: PASS;
- accepted compiled NVDB road centerlines: PASS;
- accepted compiled OSM building footprints: PASS;
- runtime provenance verification in Node + real Chrome: PASS;
- zero raw Kartverket/NVDB/OSM acquisition in normal browser runtime: PASS;
- Float64 authoritative movement + render-local Float32 invariants: PASS;
- freely navigable DTM-grounded first-person browser movement: PASS;
- local pinned CC0 PBR surfaces, lighting/shadows/tone mapping and quality profiles: IMPLEMENTED;
- guarded NHM DOM−DTM building-height enrichment: PASS candidate;
- conservative strong DOM-derived roof-direction candidate: PASS candidate;
- NIBIO SR16V + AR50 representative vegetation: PASS candidate;
- NVDB type 838/583 width + type 241 surface realism: PASS candidate;
- NVDB explicit street-detail source compiler: HOSTED PASS candidate;
- manifest-driven exact browser proof with required derived realism: PASS;
- published `preview-runtime` snapshot generated from code head `e57f574d195c474c493acd2f59ddd8dab5488493`: PASS evidence for that immutable head;
- exact-head asphalt presentation calibration with unchanged NVDB geometry/source semantics: PASS;
- milestone-grade WebGPU device-evidence assessment and deployable Vercel preview: PASS tooling; physical-device capture still open;
- shared Unreal/PBR foundation and mesh-packet SHA-256 hardening are merged to `main`; PR #85 remains the Three.js/WebGPU development surface.

---

# P0 — NANNESTAD 1×1 WEB REALISM

## P0-HYPERREAL-LIDAR-01 — Nannestad LiDAR gold-tile source gate
**Priority:** 1 — ACTIVE / SOURCE SELECTED; LAZ BYTE GATE OPEN  
**Owner:** FORGE + LUMEN + SENTINEL  

**Goal:** determine from exact source bytes whether openly obtainable Nannestad LiDAR materially improves roof geometry, canopy/tree candidates and near-field terrain enough to justify a production reconstruction layer.

**Implemented and proven:**
- public, key-free source discovery through Kartverket/Geonorge `Høydedata Metadata prosjekt WFS` using exact tile BBOX `611000,6677000,612000,6678000,EPSG:25832`;
- WFS response is restricted to source fields rather than multi-megabyte project geometry; BBOX result is explicitly classified as **intersection**, not complete tile coverage;
- deterministic GML parser/regressions and candidate policy for laser `TYPE=1`, `TILGANG`, publication, source frame, year and ordered point density;
- live legacy `projectMetadata.ashx` returned `499: Token Required`; auth/provider errors are fail-closed and can never become `NO_CANDIDATE`;
- exact WFS query reported `numberMatched=9` / `numberReturned=9`; six metadata-bearing project objects were returned, while three provider-declared features lacked requested admission metadata and are surfaced as unresolved rather than silently admitted;
- metadata-complete published/open laser overlaps include `Ullensaker Nes Nannestad 2010` (0.7 pkt/m²), `Romeriksåsene 2013` (0.7), `NDH Akershus 5pkt 2015` (5) and `NDH Akershus 2pkt 2015` (2), all in EPSG:25832 + EPSG:5941/NN2000;
- **first gold-tile acquisition source selected:** `NDH Akershus 5pkt 2015` / `LACH0002`, because it is the highest-density metadata-complete candidate proven published, explicitly open and frame-compatible;
- `Gjerdrum Ullensaker Nannestad 5pkt 2020` / `LACHVI04` is confirmed `TILGANG=2` closed and rejected as the anonymous/open default despite the same 5 pkt/m² ordered density;
- current `Romerike laser 2025` / `LACIAK53` remains a freshness cross-check while its project state is ongoing rather than a delivered open source;
- fail-closed export request builder for exact polygon/LAZ/EPSG:25832, requiring explicit project, explicit `ProjectProduct`, explicit `CopyEmail` or BAAT user, and explicit `--submit`; operator identity/credentials are redacted from evidence;
- chunked/NumPy-vectorized LAZ inspector records exact SHA-256, bounds, point count and exact-tile measured density;
- **new 2026-11-17 fail-closed source-byte inspection v0.2** separates whole-file from in-tile LAS class histograms, measures 10×10 coarse 100 m ground/vegetation/building cell occupancy, verifies decompressed/header bounds and explicitly checks horizontal EPSG:25832 plus embedded vertical EPSG:5941 rather than inferring NN2000 from XY;
- explicit `--require-candidate` exits nonzero on unknown/mismatched CRS, unproven vertical reference, missing ground coverage/classification or bad bounds, while preserving the inspection JSON for diagnosis. A `SOURCE_CANDIDATE_ONLY` result is **not** accepted terrain, roof reconstruction or observed individual trees;
- normal PR CI validates source/export/inspection contracts without making provider availability a merge gate; manual live discovery remains `workflow_dispatch` only.

**Validation evidence:**
- diagnostic live WFS run `41308978719`: contract PASS + live-provider PASS; exact source-field artifact `13084781636`;
- current source/export/inspection contract head `ba40c08604232fbb71ce5c4885a548d9288e54fd`: `nannestad-lidar-source-probe` run `41309741805` PASS, `baseline` run `41309741814` PASS, `world-viewer-vite` run `41309741822` PASS and `viewer-benchmark` run `41309741806` PASS;
- synthetic compressed-LAZ contract: exact code-bearing SHA `8b927dfc6dd5236d9af55e22d6cea8d0df843422`, `nannestad-lidar-source-probe` run [44126370072](https://github.com/B4kke/Norge-World-Engine/actions/runs/44126370072) **PASS, 21/21 tests** including in-tile-only class support, 100 m occupancy, EPSG mismatch and CLI rejection; hosted parser exercised real LAZ compression/decompression, **not** a real Norwegian source file;
- actual LAZ bytes are **not yet acquired or admitted**. See `docs/proofs/2026-11-01-nannestad-lidar-source-admission.md`.

**Remaining acceptance sequence:**
1. resolve/document the provider's ambiguous `ProjectProduct` requirement for `Format=1` point-cloud export rather than guessing it. The official currently accessible PDF still does not state a LAZ-specific value. Do not submit an export with an invented value;
2. make one explicit operator export of `NDH Akershus 5pkt 2015` with a supplied delivery identity; raw LAZ stays outside Git/runtime;
3. SHA-bind the delivered bytes and inspect LAS header, CRS/vertical frame, point count, exact-tile coverage/density and source classes;
4. fail closed if building/ground/vegetation evidence is insufficient for the intended reconstruction claim.

**Truth guard:** WFS overlap, metadata saying “5 pkt/m²”, a project name or a historical report does not prove complete exact-tile coverage, actual delivered density, LAS classes, roof reconstructability or individual-tree observations.

## P0-HYPERREAL-LIDAR-02 — Gold-tile reconstruction A/B
**Priority:** 2 — BLOCKED ON `P0-HYPERREAL-LIDAR-01`  
**Owner:** FORGE + LUMEN  

When exact LAZ bytes pass source admission, compile a separately versioned derived experiment containing:
- candidate LoD2 roof geometry for representative buildings, retaining per-building quality/fallback state;
- canopy-height/tree-candidate extraction with source epoch/confidence and SR16 used only for class/density calibration;
- higher-detail near-field terrain representation from admitted elevation evidence;
- engine-neutral render payloads suitable for the existing Three.js/WebGPU adapter and later Unreal import.

**Acceptance:** fixed-camera A/B against the current scene plus geometry error/source-quality statistics and measured browser CPU/GPU/memory/network cost. Do not promote a LiDAR-first production policy merely because the result looks better.

## WEB-BUILDING-SATELLITE-PBR-VARIATION-01 — Varied Nannestad buildings + verified satellite ground
**Priority:** USER-REQUESTED / IMPLEMENTED + REAL CHROME PASS + VERCEL READY — 2026-11-21  
**Owner:** LUMEN + SENTINEL

**Scope and implementation:**
- Uses the **same accepted 135 OSM source footprints** and guarded OSM/NHM heights. Deterministic source-ID/type-aware residential/farm/auxiliary/commercial/generic wall and roof colors are mapped into linear-RGB vertex attributes on the **same batched geometry meshes** and multiplied with the existing pinned 1k Poly Haven CC0 diffuse/normal/roughness materials.
- Instanced façade frame and door tints vary deterministically without new per-building draw calls. Conservatively bounded renderer-only rectangular gables supplement DOM-oriented gable candidates; source roof shape never asserted.
- Existing 10 m native-resolution Sentinel-2 geographic ground color remains the preferred default when manifest-verified; normal/roughness CC0 near-field layers are retained. A visible `Bakke · Satellitt (10 m)` button switches in place to/from local CC0 PBR albedo without re-fetching any Norwegian provider data. No unsafe high-resolution *Norge i bilder* orthophoto admitted.

**Exact acceptance:** code-bearing SHA `6e126ca95500881f8541430baadcfd8690dabd13`: [real Chrome visual-proof run 44875977840](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977840) **PASS**, including daylight, solar controls, existing near-tree A/B and new `building_satellite_ui.status=PASS`. Runtime shows 120 resolved + 15 fallback buildings, 25+9 wall palette keys and 19+8 roof palette keys counted *across these distinct mesh groups*, and 16 visual gables (10 DOM-oriented candidate + 6 source-unverified presentation gables). Verified satellite RGB SHA `0bbe8079f2fb2eedffaec3612f7cdb9724b12b061613b74751db388af1f2e55a`, 10 m source pixels, default mode `satellite`, PBR switch PASS, restore PASS, unchanged source terrain/building SHA. [Screenshot/evidence artifact](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977840/artifacts/14695818501).

Other same-SHA gates: [world-viewer-vite](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977770) **PASS**, [baseline](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977798) **PASS**, [viewer-benchmark](https://github.com/B4kke/Norge-World-Engine/actions/runs/44875977772) **PASS**. [Vercel Preview](https://norge-world-engine-viewer-1r8az4h6q-b4kkes-projects.vercel.app/) `dpl_9vs6BZccD4eH2cRpPVoLSQEaYGUp` **READY**; access protected and PR #85 remains draft.

**Limits:** 34/27 are *sums of per-group palette-key counts*, not globally unique surveyed materials; the local CC0 material sources are unchanged, color modulation is visual. 10 m imagery is satellite RGB, **not** 10 cm orthophoto. The 6 extra gables, window/door appearance and exact facade/tile colors are purely renderer presentation. No physical GPU/FPS performance improvement or complete photorealism claimed. P0 LiDAR exact-byte admission remains open. Full proof: `docs/proofs/2026-11-21-nannestad-buildings-and-satellite-ground.md`.

**Next acceptance:** measure moving-camera real-hardware GPU frame/texture budgets before raising PBR variety; pursue separately rights-checked higher-resolution ortho only if licensed, available, correctly aligned and tile-streamable.

## WEB-REALISM-01 — Verified realism runtime composition
**Priority:** COMPLETED / IN PR #85  
**Owner:** LUMEN + FORGE  

**Implemented:**
- SHA-verified building-surface, roof-direction and vegetation runtime layers;
- guarded DOM−DTM heights over accepted OSM footprints;
- source-backed NVDB road-width overlays where available;
- Sentinel-2 10 m macro ground color + pinned CC0 PBR surfaces;
- realism remains fail-closed under `?requireRealism=1` and degrades explicitly otherwise.

**Truth guard:** derived height/direction and renderer materials are not surveyed building/land-cover truth.

## WEB-REALISM-02 — Norwegian vegetation presentation
**Priority:** IMPLEMENTED / EXACT VISUAL INSPECTED  
**Owner:** LUMEN  

**Implemented:** deterministic SR16V representatives, DTM grounding, road/building/spawn/slope exclusion, instanced spruce/pine/deciduous categories and naturalized multi-tier/multi-lobe proxy silhouettes.

**Exact evidence:** the accepted hosted screenshot renders the admitted vegetation layer; exact browser proof reports 828 source representatives and 817 visible representatives after explicit exclusions.

**Known limit:** the current trees remain renderer-authored proxy silhouettes, not observed individual trees and not photoreal near-field assets. Freeze further proxy-shape refinement unless needed as fallback/far LOD; source-derived placement and better licensed assets are evaluated through the LiDAR gold-tile path.

## WEB-REALISM-03 — NVDB physical road semantics
**Priority:** IMPLEMENTED CANDIDATE / INTEGRATED  
**Owner:** FORGE + LUMEN  

**Implemented:** type 838 calculated road width primary, type 583 non-overlap fallback and type 241 surface semantics. Source-backed width overlays progressively replace the old 3.2 m visual fallback; fallback remains explicit where no admitted width exists.

## WEB-REALISM-04 — Source-backed street detail
**Priority:** COMPLETED / EXACT BROWSER PASS  
**Owner:** FORGE + LUMEN  

**Source evidence:** hosted compiler PASS for exact Nannestad tile with 252 explicit geometry parts: 25 longitudinal markings, 12 transverse markings, 1 crosswalk point, 67 sign points, 57 lighting points, 41 light masts, 29 open ditches, 19 kerb segments and 1 sidewalk segment; current sample has 0 edge-post, guardrail and bike-lane parts.

**Implemented and accepted:**
- deterministic NVDB V4 compiler with source type/object IDs, raw hashes, CRS transform and exact tile clipping;
- Preview runtime staging + SHA verification;
- runtime loader verification;
- batched source road markings and DTM-grounded instanced sign/light objects;
- kerb/sidewalk/ditch presentation along explicit NVDB geometry;
- generic sign face/pole dimensions remain renderer-only because exact sign-face identity is not yet admitted;
- exact Chrome composition reports `web_realism=READY`, 252 source feature parts reaching the renderer, 9 street-detail draw calls and zero raw NVDB runtime acquisition.

## WEB-REALISM-05 — Near-field buildings
**Priority:** IMPLEMENTED PRESENTATION / SOURCE FIDELITY OPEN  
**Owner:** FORGE + LUMEN  

**Current truth:** 135 footprints; 15 OSM source heights + 105 guarded DOM-derived presentation heights + 15 explicit fallbacks. Strong roof directions are admitted only where the fit gate passes.

**Implemented presentation:** deterministic, instanced façade detail is explicitly renderer-only. Exact browser proof renders 3,000 window instances and 127 door instances in 2 draw calls over the accepted source footprints/best-available heights. Window/door placement, count and dimensions are not source-backed and must never be presented as observed Nannestad façade truth.

**Current direction:** do not spend the main realism budget inventing more aperture detail. Prefer source-derived roof/building geometry and geometrically honest façades; generic windows/doors remain optional presentation fallback.

## WEB-REALISM-06 — Exact integrated browser acceptance
**Priority:** 3 — AUTOMATED/DEPLOY EVIDENCE PASS ON IMMUTABLE HEAD; PHYSICAL ANDROID CHROME WEBGPU CAPTURE OPEN  
**Owner:** SENTINEL + LUMEN  

**Passed on exact code head `e57f574d195c474c493acd2f59ddd8dab5488493`:**
- production Vite / `world-viewer-vite` run `38482495892`: PASS;
- baseline run `38482496004`: PASS;
- viewer benchmark run `38482495838`: PASS;
- NVDB road-semantics proof run `38482495981`: PASS;
- exact visual proof run `38482495969`: PASS;
- exact real-data/browser publish run `38482495877`: PASS;
- exact Vercel Preview deployment `dpl_DtzoLD1AbzEjEqbBADTe6BQ7L1xs` is `READY` and serves the normal WebUI plus `device-evidence.html` from this exact SHA;
- `preview-runtime` manifest reports `generated_from_commit=e57f574d195c474c493acd2f59ddd8dab5488493`;
- runtime remains `REAL_COMPILED_WITH_DERIVED_REALISM` with the same accepted terrain/roads/buildings, Sentinel-2 macro color and five staged realism layers;
- free movement/DTM grounding remains PASS;
- zero raw Norwegian source acquisition remains required;
- runtime request contract remains manifest-driven.

**Asphalt calibration accepted on parent implementation `91b82196ed02c604c89ff205c6da26dec8a56a2a` and inherited unchanged:**
- the pinned Poly Haven `asphalt_02` diffuse/normal/roughness assets are unchanged;
- renderer-only extra diffuse tint `0xc8c9c8` was removed so the authored diffuse albedo is no longer darkened a second time;
- same fixed near-road screenshot region improved from median luminance `16.44` to `20.87` (~27%) and mean `20.34` to `24.65` (~21%);
- exact visual-proof run `37852464305` PASS, artifact `11582397470`, screenshot SHA-256 `344b4ac02389b12ac1cf8e44b6f7fd707e5aa8eaf071937cac8501fad13b8330`;
- no road geometry, width, material source semantics, artifact SHA or provenance was changed.

**Milestone-grade device-evidence gate implemented:**
- ordinary runtime/provenance capture `PASS` is explicitly separate from WebGPU milestone readiness;
- milestone assessment is `nwe.webgpu-milestone-evidence-assessment/0.1` and reports `READY_FOR_REVIEW` only when viewer/runtime build identity is bound, capture session exists, Android Chrome is detected, the operator explicitly attests a physical device, requested+active backend are both WebGPU with no fallback, `web_realism=READY`, provenance/raw-source/strict streaming lifecycle gates pass, and the 90-frame measurement window contains first-visible, frame-gap, draw-CPU and GPU resource observations;
- timestamp-query support is recorded as a capability and is not required to be available;
- no arbitrary FPS/frame-time target is invented.

**Remaining closure gate:** physical Android Chrome WebGPU capture remains valuable milestone evidence, but it is no longer allowed to block source-fidelity engineering. Re-run exact browser/deployment acceptance after the LiDAR A/B materially changes the render payload.

## WEB-REALISM-07 — Advanced photoreal graphics pipeline
**Priority:** IMPLEMENTED / CI-SAFE ON `high`, FULL STACK ON `ultra`  
**Owner:** LUMEN

**Implemented (web-native, no world-truth change):**
- sky image-based lighting / one-time PMREM environment capture;
- ordered, fail-closed TSL post graph with profile-gated SSR, GTAO, god rays, DOF, bloom, chromatic aberration and film grain;
- `low`/`balanced` retain cheaper paths, `high` uses bounded effects and `ultra` carries the expensive stack;
- software-rasterizer detection prevents the expensive environment path from stalling headless capture.

**Measured evidence (2026-10-31):** high-profile headless SwiftShader capture completed inside the CI screenshot budget; the `ultra` stack does not, which is why the heavy effects remain ultra-gated.

**Truth guard:** IBL and every post pass are presentation-only. Freeze post-processing expansion until source geometry/asset fidelity has materially improved or measured hardware evidence identifies a specific renderer problem.

**Known infrastructure issue:** the branch has previously seen snapshot staging fail because a freshly compiled OSM building artifact no longer matched a pinned `BUILDING_ARTIFACT_SHA256`. Treat this as artifact-promotion/reproducibility work, not evidence against the renderer changes.

---

# P1 — NEXT WEB QUALITY

## P1-SIGN-SEMANTICS
Resolve exact sign face/type/orientation from admitted NVDB relations before rendering actual symbols.

## P1-VEGETATION-ASSETS
Map source-derived/SR16-calibrated species/height classes to better permissively licensed near-field tree assets/LOD while retaining source epoch, confidence and budgets. Blender may be used offline for retopology/LOD/baking, never as world truth or runtime dependency.

## P1-BUILDING-FIDELITY
Admit better roof shape, multipolygon/relations, building use and façade semantics where legal sources permit. LiDAR reconstruction is an experiment until exact-byte and A/B gates pass.

## P1-LAND-COVER
Improve field/forest/grass/residential material classification beyond generic PBR + 10 m macro color under a verified license/redistribution model.

---

# P2 — LARGER WORLD

## P2-MULTITILE-TERRAIN
Resolve neighboring DTM source/seam authority before production 3×3 terrain promotion.

## P2-STREAMING
Movement-driven 3×3 residency, budgets and failure handling using the existing scheduler/cache foundation. Stream compiled semantic/render payloads; never raw provider data.

## P2-LOD
Select terrain/object LOD from measured traversal error and resource pressure. Near-field terrain must preserve materially more source detail than distant tiles without rendering the full 1 m grid everywhere.

---

# PARALLEL UNREAL TRACK

The UE 5.8 foundation and packet-integrity hardening are merged to `main`. `UE5-RUN-01`, native Landscape/World Partition and packaged-build evidence remain open parallel gates, but they do not block the current WebUI/LiDAR gold-tile milestone. Three.js/WebGPU and Unreal must consume the same engine-neutral source/reconstruction identities rather than separate Norwegian data pipelines.

# Task completion rule

A task closes when its stated acceptance passes. One cheap adversarial check may be added when a claim is dangerous. New testing/research cycles require a new failure, changed claim or materially different implementation. Visual quality is not proven by green unit tests alone; exact rendered evidence matters.


## WEB-REALISM-CLOCK-01 — User-adjustable Nannestad daylight
**Priority:** COMPLETED / ALL 12 HOSTED WORKFLOWS + REAL CHROME UI SMOKE PASS — 2026-11-13
**Owner:** LUMEN

The ordinary browser view retains live Norwegian solar time, but now offers a
visible 24-hour Oslo-local slider, 12:00 daylight shortcut and "Nå" live reset.
Manual time is stored locally across reloads, with strict `?solarTime=` UTC
screenshot overrides retaining priority. The same astronomical sun/sky/shadow
model is reused, including CET/CEST and spring-forward gap handling; world truth
and simulation time remain untouched. Daylight updates immediately while
PMREM/IBL recaptures only on committed changes. Targeted winter-night,
summer/winter offset, DST and fixed-A/B regression tests have been added.

**Evidence:** exact code-bearing SHA `8dce4fb5dd88fb6666bcf163507840465f723e46` passed all 12 applicable hosted checks:
`world-viewer-vite` run `43424157894`, `preview1-visual-proof` `43424157864`,
`preview1-realdata-publish` `43424157923`, `baseline` `43424157879`,
`viewer-benchmark` `43424157824` and all other source/build gates PASS.
Final exact code head `0119b31cb76b0cd330be726df0f926ddcdb7c344`: all 12
hosted workflows PASS, including `preview1-visual-proof` run `43424723509`,
`world-viewer-vite` run `43424723602`, `baseline` run `43424723586`,
`preview1-realdata-publish` run `43424723449`, and `viewer-benchmark`
run `43424723429`. The actual Chrome screenshot script executed a native
DOM interaction smoke against the accepted Nannestad scene: fixed-time mode,
12:00 button and stored minutes 720, 05:15 slider input/commit and stored
minutes 315, then live `Nå` reset with storage removed. Range min=0/max=1439/
step=1. Screenshot capture occurred *before* interaction to preserve fixed
A/B geometry/material evidence. This proves UI control wiring, not gameplay
quality or visual realism. PR #85 remains draft and unmerged.

## P0-VISUAL-DAYLIGHT-SNAPSHOT — Reproducible source-pinned, inspectable Nannestad A/B
**Priority:** COMPLETED — 2026-11-11 / PR #85.

- Former screenshot blocker fixed without repinning OSM: original accepted compiled terrain/road/building bytes plus complete provenance bundles are retrieved from immutable transport commit `a47b8920fb2a72078734cd3fba56c9cafa6344d5`; exact hashes/bytes, producer, tile, path and role checked. Fresh source compilation is an opt-in `--base-source live` path and continues to reject incompatible derived height/roof identity.
- Fixed screenshot solar clock `2026-07-23T11:00:00Z`; normal browser retains live astronomical time. The screenshot gate checks **the scene pixels**, not just UI-ready text.
- Exact code head `d7e097200240de508f437186490aaae2381762f9`: `preview1-visual-proof` run `42931242230` PASS (viewport luminance 177.44/255, 94.02% scene bright pixels); `preview1-realdata-publish` run `42931242287` PASS including real Chrome composition; `world-viewer-vite`, `baseline`, `viewer-benchmark`, `nvdb-road-semantics-proof` PASS.
- Proof: `docs/proofs/2026-11-11-immutable-daylight-visual-acceptance.md`. This closes the visual *evidence* gate; it does not close photorealism.

## P1-NEAR-FIELD-TREES-CAMERA-AB — Fixed source-targeted daylight comparison
**Priority:** CHROME A/B PASS / VERCEL PREVIEW READY; QUALITATIVE & HARDWARE PERFORMANCE OPEN — 2026-11-15
**Owner:** LUMEN + SENTINEL

The WebUI supports isolated `?treeProof=proxy` and
`?treeProof=authored` variants. Both select the nearest eligible SR16 conifer
representative within 350 m of tile center and use the same fixed free-fly
camera, geodata, weather and daylight. The proxy variant omits authored GLB
GPU upload; the authored variant uses the same SHA-verified CC0 resource as
normal gameplay. The Chrome visual-proof workflow now captures an A/B pair,
requires identical source IDs/coordinates/camera/terrain identity, and checks
active authored triangle/byte and frame samples plus source-targeted pixel ROI.

**Evidence:** code-bearing head `4f4bf4da1631598af5bff3c4027052c085011b22` passed
`preview1-visual-proof` run `43724737720` with Chrome A/B status PASS,
the same source ID/position and camera in both modes, and fixed clear-weather daylight.
The near-conifer candidate was a 10.2 m presentation spruce, source-representative
ID `264886deb2d19d0474ee3630`. The authored variant activates 34 trees ×
8,792 triangles = **298,928** authored triangles, one instanced draw candidate
and 325,472 estimated geometry buffer bytes; proxy activates zero authored
triangles/buffers. The comparison ROI has 41,053 pixel samples, RGB mean absolute
difference **3.064/255** and changed-pixel share **4.70%** (>18/255 criterion).
This establishes a measurable different rendering, **not** photorealism or a
qualitative scene improvement. The headless SwiftShader/WebGL2 CPU draw p50
was 9.1 ms (proxy) versus 4.2 ms (authored), five samples each with seconds-long
p95 spikes; **no credible FPS/GPU performance improvement can be inferred**.

`world-viewer-vite` run `43724737878`, `baseline` run `43724737890`,
`preview1-realdata-publish` run `43724737742` and source/benchmark gates PASS.
Unrelated `preview3-realdata-publish` run `43724737839` failed at live
NHM WCS HTTP 504 (not a 1×1 WebUI regression). Vercel Preview
`dpl_Hf2o4txg4yMQyY2pqj51v3oGRHh8` is READY for that exact code SHA at
https://norge-world-engine-viewer-qkbhsonhx-b4kkes-projects.vercel.app/.
Vercel account SSO protection remains enabled. PR #85 remains draft.
See `docs/proofs/2026-11-15-nannestad-conifer-camera-ab.md`.

## P1-NEAR-FIELD-TREES — Source-verified CC0 conifer near-field renderer
**Priority:** CODE + REAL BROWSER GATES PASS; TARGETED NEAR-CONIFER CAMERA VISUAL A/B OPEN (2026-11-11, PR #85).

Implemented offline CC0 conifer intake from pinned Innerscene GLB (source 517,112 B, SHA-256 `812f691eb68119681038aed7f45dd80bff0a152afe1fc8160ea5cbeeae9143da`). The source contains 365 meshes and 8,792 triangles; `trimesh` and NumPy flatten transforms and explicitly bake both original PBR colors to glTF `COLOR_0`, producing one mesh (232,160 B, SHA-256 `77705f017031ac8d7f7a31d78d5b24268eecd56da93bd051cfadee16230be3ba`). An earlier 200,532-byte derivative lost vertex color and was correctly rejected by real Chrome; it was superseded. Original provider bytes are discarded from source pipeline, no runtime provider traffic, and renderer checks content-addressed GLB + source report on the same manifest origin.

One `InstancedMesh` replaces at most 36 nearby SR16 conifer representatives within 125 m (18 balanced, 0 low), hiding the old proxy instances while selected and restoring them on camera movement. Source-derived tree locations and coordinates remain immutable; broadleaf representatives are still placeholders. Max near mesh triangle cost 316,512 at full budget. Offline tests verify source SHA/licensing/colors/height and camera swaps; `world-viewer-vite` [42940360341](https://github.com/B4kke/Norge-World-Engine/actions/runs/42940360341) PASS, `preview1-visual-proof` [42940360475](https://github.com/B4kke/Norge-World-Engine/actions/runs/42940360475) PASS, `preview1-realdata-publish` [42940360220](https://github.com/B4kke/Norge-World-Engine/actions/runs/42940360220) PASS including actual Chrome composition, hash/provenance and exact request set with tree report. Initial central camera shows mainly distant deciduous proxies: the *near-field visual uplift* must still be A/B photographed from a camera close to a source-backed conifer. Next task: deterministic conifer-targeted camera framing and triangle/frame budget vs old proxy. After that, separate CC0 pine/deciduous authored models if budgets permit; LoD2 source roofs still require LiDAR admission.

Proof: `docs/proofs/2026-11-11-cc0-near-field-conifer-lod.md`.

## P1-SIGN-PAGINATION — NVDB sign inventory completeness
**Priority:** LIVE MULTI-PAGE PROVIDER ACCEPTANCE PASS (2026-11-11); source-to-render visual acceptance open.

Compiler algorithm v0.5 follows provider-issued NVDB V4 `metadata.neste.start` cursors while reconstructing requests from the exact trusted source URL/BBOX/CRS, never visiting the provider's next-page href. Every raw page has a separate SHA-256/byte count in the source snapshot, while aggregate input hash is length-prefixed. Duplicated source IDs, cursor cycles, missing/malformed cursors, invalid page counts and page overflow reject the artifact. Offline adversarial tests are wired to the NVDB CI gate. Live provider CI initially revealed that the real source is paginated and that href routing does not necessarily match the original request; source-link dependence has been removed when start is available. Hosted live source gate `nvdb-road-semantics-proof` run `42927733620` PASS: 367 geometry parts, including 67 type-95 sign points and 115 type-96 sign plates, source artifact SHA-256 `351cfcbd3a7504fa361231eb6b7363e9e6691ee12af144e8d4576af907b66dfa`. Both source relation/location snapshots present on all 367 geometry parts. This establishes a complete admission candidate for that exact live run, not surveyed sign artwork/true facing. Next gate: explicit type95/type96 relation coverage, source sign facing and official art licensing.

## P1-RENDER-SURFACE-ALIGNMENT — Roads, signs, trees and facades
**Priority:** INTEGRATED / EXPLICIT DAYLIGHT BROWSER VISUAL INSPECTED; MATERIAL/ASSET FIDELITY OPEN.

- Road centerline source-width overlays preserve their small renderer-only lift through terrain triangle subdivision.
- NVDB markings, curbs, sidewalks, ditches and rails use the same rendered terrain triangles as road asphalt; source marking thickness remains a separate per-feature presentation lift. White/yellow paint is raised above accepted 5 mm width-overlay surfaces to avoid hiding.
- Signs, lamps and tree proxies are grounded against the displayed triangulation rather than the independently sampled 1 m source grid; source coordinates/placements are unchanged. Out-of-tile positions do not extrapolate source terrain.
- Façade openings interpolate the same two DTM-grounded footprint endpoints as each wall edge and have exterior-side visual offset. Geometry/placement of openings remain deterministic renderer-only, not observed source truth.
- Narrow regressions added for triangle interpolation, road relief and sloped facades; complete world-viewer-vite test/build passed on code head `4c7e7b3920090af379751fc1bf58f3a98198528c` and newest candidate viewer CI is green on `ba3ab7af9b2157d69643c60f2c36cd59f9896537`.

**Quality limits:** this eliminates obvious floating/sinking on mismatched LOD but does not prove photorealism. Vegetation is still procedural proxy crown geometry; walls still have inferred openings; road junction/cross-sectional topology and near-field 1 m source resolution need source/geometric A/B. Exact new screenshot/hardware performance validation remains open, without mixing generated detail into world truth.

## WEB-BUILDING-MATERIAL-02 — Bounded actual PBR material variation
**Priority:** USER-REQUESTED / IMPLEMENTED; EXACT-HEAD VALIDATION PENDING

Two new generated presentation material classes (plaster, standing-seam roof) complement pinned CC0 wood/roof textures. Geometry index partition uses <=2 groups per surface, <=8 building color draw candidates over four meshes. No raw imagery or authoritative geometry changes. Existing Sentinel remains the geographic base; new high-resolution ortho requires exact dataset license, coverage and byte gate. Validate map determinism, complete index partition, low-profile normal omission, hosted Vite/browser proof and material counts. Then measure actual hardware cost.
