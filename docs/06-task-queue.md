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
- chunked/NumPy-vectorized LAZ inspector records exact SHA-256, bounds/CRS, point count, exact-tile measured density and LAS class counts for ground/vegetation/buildings;
- normal PR CI validates source/export/inspection contracts without making provider availability a merge gate; manual live discovery remains `workflow_dispatch` only.

**Validation evidence:**
- diagnostic live WFS run `41308978719`: contract PASS + live-provider PASS; exact source-field artifact `13084781636`;
- current source/export/inspection contract head `ba40c08604232fbb71ce5c4885a548d9288e54fd`: `nannestad-lidar-source-probe` run `41309741805` PASS, `baseline` run `41309741814` PASS, `world-viewer-vite` run `41309741822` PASS and `viewer-benchmark` run `41309741806` PASS;
- actual LAZ bytes are **not yet acquired or admitted**. See `docs/proofs/2026-11-01-nannestad-lidar-source-admission.md`.

**Remaining acceptance sequence:**
1. resolve/document the provider's ambiguous `ProjectProduct` requirement for `Format=1` point-cloud export rather than guessing it;
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


## P1-SIGN-PAGINATION — NVDB sign inventory completeness
**Priority:** HIGH — fail-closed guard implemented in PR #85; multi-page source ingestion OPEN.

The type-95/96 street-detail compiler now rejects a declared next page or ambiguous full 1000-object response rather than publishing incomplete sign truth. Adversarial test and CI gate added; hosted CI still needs to confirm current provider behavior. Next: deterministic pagination with page-level raw hashes, stable IDs, cycle detection and bounded page count, followed by verified sign-plate/support relations. No generated sign symbols are source truth.
