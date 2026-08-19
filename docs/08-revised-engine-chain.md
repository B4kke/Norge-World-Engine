# 08 — Ground-level Nannestad execution plan

**Status:** ACTIVE execution plan for the next playable milestone.  
**Primary product target:** a person can stand and move at ground level in a real Nannestad scene with terrain, roads, buildings, materials and lighting.  
**Renderer direction:** Three.js/WebGPU-first as the working graphics path, with WebGL2 fallback/baseline; renderer choice remains replaceable through an explicit adapter boundary.  
**Future-engine requirement:** world/compiler/runtime data must remain usable by a later Unreal Engine adapter without rewriting source acquisition, provenance, coordinates or simulation state.

This plan intentionally changes the previous `3×3 → LOD → visual quality` sequence. The accepted single-tile Nannestad artifacts are already sufficient to prove the next thing the project actually needs: **a convincing, walkable, meter-scale world**. Multi-tile terrain/source reconciliation remains important, but it must not block the first ground-level playable vertical slice.

## Success criterion — tonight milestone

The milestone is PASS when one accepted Nannestad tile can be opened in the normal Vite viewer and all of the following are true:

1. real verified DTM terrain is rendered as a mesh;
2. real compiled NVDB roads are visible as road-surface meshes, even if physical width is still explicitly visual/fallback rather than authoritative;
3. real compiled building footprints are visible as building meshes; unresolved heights remain visibly/semantically fallback rather than being promoted to world truth;
4. terrain, roads, walls and roofs use a real material layer rather than debug flat colors; procedural/source-safe textures are acceptable for this milestone and do not require production orthophoto;
5. a humanoid glTF/GLB asset is loaded with a verified redistributable license, has at least idle + walk animation or an equivalent locomotion state, and can be moved through the scene;
6. the character follows terrain height and the camera can operate at human scale; third-person follow is the default target, with first-person optional;
7. the normal runtime still performs full artifact verification and makes zero raw Kartverket/NVDB/OSM calls;
8. a production build and one end-to-end browser smoke test pass on the exact branch commit; a Vercel Preview is produced when deployment tooling is available.

Not required for the tonight milestone: 3×3 terrain promotion, whole-Norway LOD, authoritative lane widths, complete building-height enrichment, production orthophoto, full rigid-body physics, networking, NPC AI, interiors or a final Unreal importer.

---

## Architecture direction

### 1. NWE owns the world; Three.js owns presentation

The boundary must look like this:

```text
Norwegian source data
        ↓
NWE compiler / provenance / canonical world data
        ↓
verified runtime artifacts + world state
        ↓
renderer-neutral scene/tile/entity interfaces
        ↓
┌───────────────────┬──────────────────────┐
│ Three.js renderer │ future Unreal adapter│
└───────────────────┴──────────────────────┘
```

No `THREE.*` type may become part of compiler output, authoritative coordinates, simulation state, provenance schemas or streaming identity. Three.js objects are disposable render resources created from renderer-neutral data.

### 2. Three.js is the working graphics path

For the ground-level product, LUMEN should optimize first for:
- meter-scale camera/player movement;
- PBR materials and shaders;
- lighting, shadows, fog/atmosphere and weather experiments;
- instancing and batching;
- animated glTF assets;
- a WebGPU-first path where the available browser genuinely supports it, with WebGL2 kept as a working fallback/baseline.

Cesium remains a reference/benchmark and possible geospatial component. It is **not** the primary player experience while the target is walking/driving close to the ground.

### 3. Unreal remains a first-class future exit

The web renderer must not become the data model. Preserve these engine-neutral boundaries:
- authoritative world coordinates remain high precision and renderer-independent;
- render-local coordinates are derived/disposable;
- terrain/road/building semantics remain outside material/shader code;
- static render assets prefer open interchange such as glTF/GLB where appropriate;
- dynamic entity state is represented independently from `THREE.Object3D`;
- asset metadata, provenance and IDs remain separate from renderer scene graphs;
- later Unreal work should require an importer/adapter, not a new Norwegian data compiler.

### 4. Minimum renderer adapter contract

The first implementation should converge on a small boundary rather than spreading Three.js calls through runtime code. Exact names are flexible, but responsibilities should cover:

```text
initialize(surface, capabilities)
setRenderOrigin(origin, epoch)
createTerrainTile(tileId, geometry, materials)
createRoadLayer(tileId, geometry, materials)
createBuildingLayer(tileId, geometry, materials)
createEntity(entityId, assetRef, transform)
updateEntity(entityId, transform, animationState)
destroyTile(tileId)
destroyEntity(entityId)
render(frameState)
dispose()
```

STRØM owns loading/lifecycle decisions. LUMEN owns GPU objects. ATLAS owns world/render-coordinate invariants. The character/simulation layer owns movement state.

---

## Concrete priority list

### P0-GROUND-01 — Three.js ground-level renderer shell
**Owner:** LUMEN  
**Do now:** integrate Three.js into `apps/world-viewer` behind a renderer adapter; preserve verified artifact loading; create a human-scale camera and local scene origin.  
**Exit:** accepted terrain can be drawn through the adapter and camera can be placed roughly 1.7 m above sampled ground.  
**Do not:** rewrite scheduler, provenance or compiler to fit Three.js.

### P0-GROUND-02 — Terrain mesh + material
**Owner:** LUMEN + STRØM boundary only  
**Do now:** feed the already accepted terrain artifact/worker mesh into Three.js buffers; add normals, lighting and a reusable terrain material. Use procedural/source-safe detail for the first pass.  
**Exit:** terrain reads as ground at walking distance instead of a debug heightfield.

### P0-GROUND-03 — Road surface mesh
**Owner:** LUMEN using existing compiled NVDB paths; FORGE only if a missing semantic blocks the mesh.  
**Do now:** generate a renderer-side ribbon/surface mesh from compiled centerlines with clearly marked visual width fallback; asphalt material + basic edge/marking treatment.  
**Exit:** roads are continuous walkable-looking surfaces.  
**Guardrail:** visual fallback width is not authoritative road width.

### P0-GROUND-04 — Building meshes + simple roofs
**Owner:** LUMEN consuming existing building artifacts  
**Do now:** batch/extrude 135 accepted footprints; use source-backed heights where present and explicit visual fallback for unresolved heights; polygon-safe roofs; wall/roof materials.  
**Exit:** Nannestad reads as a built environment from street level, without fabricating authoritative heights.

### P0-GROUND-05 — Humanoid asset + locomotion
**Owner:** LUMEN for asset/animation integration; ATLAS/simulation boundary for authoritative transform shape.  
**Do now:** select one lightweight humanoid glTF/GLB from a primary source with an explicit permissive/redistributable license. Prefer an asset that already has idle/walk animation; otherwise use a compatible open animation source only after license verification. Add AnimationMixer/state handling, keyboard controls and touch controls where practical.  
**Exit:** a human character can idle and walk over the Nannestad terrain while preserving world-vs-render transform separation.

### P0-GROUND-06 — Grounding, simple collision and third-person camera
**Owner:** LUMEN + ATLAS; avoid a physics-engine commitment tonight.  
**Do now:** terrain height sampling/raycast grounding, slope sanity, a simple character radius/capsule abstraction and third-person follow camera. Building collision may be coarse or deferred if it threatens the milestone.  
**Exit:** the character does not float through normal terrain movement and the camera behaves at human scale.

### P0-GROUND-07 — First visual pass
**Owner:** LUMEN  
**Do now:** directional/sun light, shadows within a bounded near-player range, sky/fog, tone mapping, material roughness/normal variation and conservative shader detail.  
**Exit:** clearly better than debug geometry while remaining within measurable frame/draw-call budgets.

### P0-GROUND-08 — One end-to-end acceptance run
**Owner:** SENTINEL  
**Do once after integration:** production build + existing targeted regressions + one browser smoke that verifies artifact loading, raw-source-call count, character spawn/movement state and a bounded performance sample.  
**Exit:** one reproducible PASS/FAIL report. Do not turn this into repeated manual-device loops.

---

## Immediately after the playable slice

1. **Building quality:** relation/multipolygon support, source-backed/enriched heights and roofs.
2. **Road quality:** source-backed width/lane/surface semantics and better intersections/markings.
3. **Vegetation:** source-backed area classification + deterministic instanced Norwegian tree assets.
4. **Material library:** reusable PBR terrain/road/building/vegetation semantics with renderer-neutral material IDs.
5. **Imagery/orthophoto:** only after source/license/cache/redistribution is proven; keep it a compiled tile layer.
6. **Character foundation:** formal entity/component movement state, collision/physics boundary and animation state machine.
7. **3×3 streaming:** resume movement-driven multi-tile residency and the open DTM1 seam/source-family gate.
8. **Terrain LOD:** only when the player can actually traverse enough world for LOD to solve a measured problem.
9. **10×10 / 25×25 scaling:** prove bounded working-set RAM/GPU/network behavior.
10. **Unreal spike:** consume the same engine-neutral compiled sample and entity/world contract in a minimal Unreal importer without changing source/compiler semantics.

---

## Anti-loop / reuse rules

These rules are mandatory for this plan:

- **Visible vertical slice beats another isolated harness.** A new prototype/test utility needs a direct path to the active playable milestone or a clearly named blocked gate.
- **One primary acceptance test per task, one end-to-end gate per integrated milestone.** Do not rerun substantially identical device/browser tests unless code or the claim changed.
- **No research recursion.** If an unresolved source/API/license question does not block the active ground-level slice, log it and defer it.
- **Reuse before custom code.** Before implementing generic rendering, mesh, physics, animation, asset, geospatial or packaging infrastructure, check the mature library/standard already in the repo or a current primary implementation. Custom code requires a documented mismatch.
- **Do not build a new Cesium.** Custom globe, global SSE/LOD or geospatial tile hierarchy work is deferred until a measured ground-level requirement proves the existing scheduler/standards insufficient.
- **No premature full physics stack.** Terrain grounding and a small locomotion abstraction are enough for the first playable slice. Select a physics library only when collision requirements are concrete.
- **Do not block graphics on unresolved 3×3 terrain provenance.** Use the already accepted single-tile artifacts for the playable milestone.
- **Do not weaken provenance for speed.** Real world layers still pass existing verification before rendering.
- **Stop when the exit gate passes.** Optimization starts only after a metric is outside budget or a visual/gameplay requirement is unmet.

## Agent allocation for this sequence

- **LUMEN:** lead tonight's vertical slice: Three.js adapter, ground renderer, materials, human asset, camera and graphics.
- **STRØM:** preserve artifact loading/lifecycle; change scheduler only when the ground slice exposes a concrete runtime need.
- **FORGE:** do not start new data archaeology unless a missing terrain/road/building semantic blocks the slice; prepare later quality enrichment.
- **ATLAS:** define the smallest entity/world transform contract needed for a walking character; do not reopen whole-Norway CRS policy.
- **SENTINEL:** one integration/claim pass at milestone end; prevent fake heights/widths/licenses from becoming world truth and prevent test-loop churn.

## Current explicit deferrals

Until `P0-GROUND-01..08` is integrated, the following are not the active critical path:
- 3×3 terrain seam/source-family resolution;
- whole-Norway terrain LOD/format choice;
- Cesium-vs-custom benchmark as a renderer-selection gate;
- full orthophoto pipeline;
- full physics engine selection;
- networking/persistence;
- large-scale simulation/AI.

They remain valid project work, but they cannot displace the playable ground-level milestone without a newly discovered hard dependency.