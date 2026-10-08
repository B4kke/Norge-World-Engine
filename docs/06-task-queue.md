# 06 — Active task queue

This file is the **current execution queue**. Historical queue states remain in Git history and archived logs; do not reintroduce stale priorities.

## Priority rule — 2026-10-08

The explicit product priority is **Nannestad 1×1 km in the normal WebUI, freely navigable and as realistic as admitted data/performance allows**. Unreal Engine remains a parallel adapter track and does not block this Web milestone.

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
- manifest-driven exact browser proof with required derived realism: PASS on implementation head `feec1cc6b5d263a29444dc8c3a3e13acda84cfd0`;
- published `preview-runtime` snapshot generated from that exact head: PASS.

---

# P0 — NANNESTAD 1×1 WEB REALISM

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

**Exact evidence:** current exact hosted screenshot renders the admitted vegetation layer; exact browser proof reports 828 source representatives and 817 visible representatives after explicit exclusions.

**Known limit:** the current trees remain renderer-authored proxy silhouettes, not observed individual trees and not photoreal near-field assets. Better licensed near-field tree/LOD assets belong to `P1-VEGETATION-ASSETS`; do not reopen source-placement work without new evidence.

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
- exact Chrome composition on implementation head `feec1cc6b5d263a29444dc8c3a3e13acda84cfd0` reports `web_realism=READY`, 252 source feature parts reaching the renderer, 9 street-detail draw calls and zero raw NVDB runtime acquisition;
- `preview1-realdata-publish` run `37850767271` and exact visual-proof run `37850767344` both PASS.

## WEB-REALISM-05 — Near-field buildings
**Priority:** IMPLEMENTED PRESENTATION / SOURCE FIDELITY OPEN  
**Owner:** FORGE + LUMEN  

**Current truth:** 135 footprints; 15 OSM source heights + 105 guarded DOM-derived presentation heights + 15 explicit fallbacks. Strong roof directions are admitted only where the fit gate passes.

**Implemented presentation:** deterministic, instanced façade detail is explicitly renderer-only. Exact browser proof renders 3,000 window instances and 127 door instances in 2 draw calls over the accepted source footprints/best-available heights. Window/door placement, count and dimensions are not source-backed and must never be presented as observed Nannestad façade truth.

**Next source-fidelity gate:** legally/source-backed roof shape/façade/use semantics when an admitted source materially improves the world. Do not invent exact windows/doors and label them source truth.

## WEB-REALISM-06 — Exact integrated browser acceptance
**Priority:** 1 — ACTIVE; TECHNICAL GATES PASS / VISUAL-PERFORMANCE CLOSURE OPEN  
**Owner:** SENTINEL + LUMEN  

**Passed on exact implementation head `feec1cc6b5d263a29444dc8c3a3e13acda84cfd0`:**
- production Vite build PASS;
- exact real-data Preview 1 browser smoke PASS;
- `?requireRealism=1` reports `READY` and SHA-matches all five staged realism layers;
- free movement/DTM grounding PASS;
- zero raw Norwegian source acquisition;
- runtime request contract is manifest-driven: 15 requests / 14 unique runtime paths / 14 manifest-declared paths;
- exact hosted screenshot is visibly beyond prototype/debug geometry;
- `preview-runtime` was republished from the exact accepted implementation head.

**Still open before calling the WebUI realism milestone complete:**
- exact screenshot still shows asphalt substantially too dark in the near field; this is a presentation issue, not proven road-geometry corruption;
- vegetation remains proxy-quality in the near field and distant building presentation remains generic;
- hosted SwiftShader/WebGL2 first-frame timing is not valid evidence of real WebGPU/mobile gameplay performance.

**Next concrete task:** perform a measured renderer-only asphalt presentation calibration against the exact screenshot, retain source geometry/material provenance unchanged, rerun exact visual proof and browser/resource gates, and keep/revert the change based on visible improvement plus bounded cost. After that, capture real WebGPU/mobile evidence before closing this milestone.

---

# P1 — NEXT WEB QUALITY

## P1-SIGN-SEMANTICS
Resolve exact sign face/type/orientation from admitted NVDB relations before rendering actual symbols.

## P1-VEGETATION-ASSETS
Map SR16V species/height classes to better permissively licensed near-field tree assets/LOD while retaining representative semantics and budgets.

## P1-BUILDING-FIDELITY
Admit better roof shape, multipolygon/relations, building use and façade semantics where legal sources permit.

## P1-LAND-COVER
Improve field/forest/grass/residential material classification beyond generic PBR + 10 m macro color under a verified license/redistribution model.

---

# P2 — LARGER WORLD

## P2-MULTITILE-TERRAIN
Resolve neighboring DTM source/seam authority before production 3×3 terrain promotion.

## P2-STREAMING
Movement-driven 3×3 residency, budgets and failure handling using the existing scheduler/cache foundation.

## P2-LOD
Select terrain/object LOD from measured traversal error and resource pressure.

---

# PARALLEL UNREAL TRACK

UE 5.8 foundation/adapter work remains valid. `UE5-RUN-01`, native Landscape/World Partition and packaged-build evidence remain open parallel gates, but they do not block the current WebUI 1×1 realism milestone.

# Task completion rule

A task closes when its stated acceptance passes. One cheap adversarial check may be added when a claim is dangerous. New testing/research cycles require a new failure, changed claim or materially different implementation. Visual quality is not proven by green unit tests alone; exact rendered evidence matters.
