# 06 — Active task queue

This file is the **current execution queue**. Historical queue states remain in Git history and the archived Drive logs; do not append old status prose here.

## Priority rule

The next task must advance the walkable Nannestad milestone in `docs/08-revised-engine-chain.md` unless it discovers a genuine hard dependency. Do not let an unrelated whole-Norway, multi-tile, device or source-research question displace the active vertical slice.

## Known proven foundation — do not re-prove by default

- single-tile real Nannestad DTM1 compiler/runtime artifact: PASS;
- real compiled NVDB roads: PASS;
- real compiled OSM building footprints: PASS;
- runtime-verifiable provenance in Node + real Chrome: PASS;
- artifact-only browser path with zero raw-source runtime calls: PASS;
- module DedicatedWorker terrain mesh path: PASS;
- scheduler/cache/resource lifecycle roundtrip for the accepted terrain tile: PASS;
- high-precision world state + render-local coordinate/origin invariants: PASS;
- Three.js ground renderer adapter over accepted renderer-neutral buffers: PASS in hosted Chrome/WebGL2; hosted WebGPU capability remains unavailable and is not claimed as performance evidence.

If a new change does not alter one of those claims, do not create another test loop for it.

---

# P0 — TONIGHT / PLAYABLE NANNESTAD

## P0-GROUND-01 — Three.js ground-level renderer adapter
**Priority:** COMPLETED  
**Owner:** LUMEN  
**Status:** IMPLEMENTED / HOSTED CHROME WEBGL2 PASS / WEBGPU DEVICE EVIDENCE OPEN, NON-BLOCKING  
**Goal:** make Three.js the working ground-level presentation layer without making it the world-data model.

**Implemented:**
- `three@0.185.0` pinned in the World Viewer;
- `three/webgpu` + `THREE.WebGPURenderer` behind the existing `createPreview1Renderer` boundary;
- explicit WebGL2 fallback/baseline via `forceWebGL`;
- accepted terrain/road/building typed-array buffers converted to Three `BufferGeometry` only after existing artifact verification;
- existing terrain resource lifecycle hooks preserved;
- perspective camera starts at sampled terrain + 1.7 m eye height;
- root viewer now targets the accepted single-tile ground scene while Preview 3 remains separately available;
- no raw-source knowledge or `THREE.*` identity leaked into compiler/world/provenance/streaming contracts.

**Acceptance evidence:** hosted Chrome/WebGL2 rendered the accepted tile with 16,641 terrain vertices / 32,768 triangles, 246 compiled road paths and 135 building footprints at 4 draw calls; runtime request count 7; raw-source runtime calls 0. Production Vite build and existing renderer/resource/browser regressions pass. Hosted WebGPU probe was unavailable, so no WebGPU performance comparison is claimed.

## P0-GROUND-02 — Terrain mesh + walking-distance material
**Priority:** 1 — START HERE  
**Owner:** LUMEN  
**Status:** OPEN  
**Input:** already accepted DTM1 artifact/worker mesh and the now-proven Three.js adapter.

**Implement:** normals, sane UV/detail coordinates, PBR-compatible terrain material, directional lighting response and procedural/source-safe micro/macro variation.

**Acceptance:** terrain looks like ground from approximately 1.7 m eye height and remains geometrically tied to accepted DTM heights.

## P0-GROUND-03 — Road-surface meshes
**Priority:** 2  
**Owner:** LUMEN  
**Status:** OPEN  
**Input:** accepted compiled NVDB paths.

**Implement:** batched ribbon/surface meshes, asphalt material, conservative visual width fallback and optional cheap edge/marking treatment.

**Truth guard:** current visual width is **not authoritative road width** until NVDB physical-width semantics are compiled.

**Acceptance:** the principal road network reads as connected road surfaces at ground level without re-fetching NVDB.

## P0-GROUND-04 — Building meshes + roofs
**Priority:** 3  
**Owner:** LUMEN  
**Status:** OPEN  
**Input:** 135 accepted compiled building footprints.

**Implement:** batched/extruded walls, polygon-safe simple roofs, source-backed height where present, explicit render-only fallback height where unresolved, wall/roof material classes.

**Truth guard:** unresolved building height remains unresolved in world data.

**Acceptance:** the street-level scene visibly contains the accepted building set and no roof geometry escapes its footprint due to naive bounding-box caps.

## P0-GROUND-05 — Licensed humanoid glTF/GLB + animation
**Priority:** 4  
**Owner:** LUMEN  
**Status:** OPEN  

**Implement:** select one lightweight humanoid from a primary asset source with explicit permissive/redistributable license; record license/source; load with the standard Three.js glTF path; support at least idle + walk state or equivalent locomotion animation.

**Acceptance:** a human model spawns in Nannestad and animation state changes between idle and movement. No unverified model ripped from a demo/site is admitted.

## P0-GROUND-06 — Character movement + terrain grounding + camera
**Priority:** 5  
**Owner:** LUMEN + ATLAS  
**Status:** OPEN / ATLAS WORLD-TRANSFORM SUB-BOUNDARY IMPLEMENTED IN DRAFT PR #72; LUMEN INTEGRATION PENDING  

**ATLAS boundary:** `nwe.character-world-transform/0.1-candidate` defines stable entity identity, authoritative Float64 `WorldPosition`, renderer-neutral heading, projected-world planar movement, world-height updates for grounding consumers and origin-epoch-scoped render-local derivation. It deliberately contains no `THREE.*`, asset, animation, input, terrain sampling, camera or physics-engine state.

**Implement:** renderer-neutral character world transform, keyboard movement, practical touch input, terrain height/raycast grounding, simple radius/capsule abstraction and third-person follow camera. Avoid choosing a full physics engine unless simple grounding proves insufficient.

**Acceptance:** the character can walk over normal Nannestad terrain without floating/sinking and world state remains independent from render origin shifts.

## P0-GROUND-07 — First graphics/shader pass
**Priority:** 6  
**Owner:** LUMEN  
**Status:** OPEN  

**Implement:** bounded near-player shadows, sun/directional light, sky/fog, tone mapping, material roughness/normal variation and conservative shader detail. Prefer batching/instancing and shared materials over unique draw calls/textures.

**Acceptance:** screenshot/video-level output is visibly beyond debug geometry while automated sample metrics show no obvious regression that makes navigation unusable.

## P0-GROUND-08 — Integrated acceptance + Preview
**Priority:** 7 — only after 01–07 integrate  
**Owner:** SENTINEL  
**Status:** WAITING  

**Run once for the milestone:**
- production build;
- narrow existing artifact/provenance regressions touched by the implementation;
- one automated browser smoke for terrain + roads + buildings + character spawn/movement state;
- verify zero raw-source runtime calls;
- record backend, first-visible, frame sample, draw calls/geometry counts where available;
- Vercel Preview for the exact commit when deployment tooling is available.

**Acceptance:** one concise PASS/FAIL handoff. No new Android request unless a specifically device-only question remains.

---

# P1 — NEXT VISIBLE QUALITY

## P1-BUILDINGS-01 — Better building truth
Multipolygon/relation ingestion, DOM-DTM/FKB capability-gated height enrichment, roof semantics. Keep source-backed vs procedural explicit.

## P1-ROADS-01 — Physical road semantics
Compile width/lane/surface/intersection information from fields that actually support those claims; replace visual fallback width progressively.

## P1-VEGETATION-01 — Norwegian vegetation layer
Small licensed asset set, deterministic/source-backed placement, GPU instancing and distance LOD/impostors.

## P1-MATERIALS-01 — Renderer-neutral material semantics
Stable material IDs/parameters in world/runtime data; Three.js maps them to PBR/shaders. Do not encode Three.js material classes into compiled world artifacts.

## P1-IMAGERY-01 — Production imagery/orthophoto
Only after provider coverage, CRS, resolution, update cadence, license, attribution, preprocessing/cache and redistribution rights are proven. Runtime consumes compiled texture tiles, not raw provider services.

## P1-CHARACTER-01 — Formal locomotion/physics boundary
Entity/component movement state, animation state machine, building/road collision needs and a measured physics-library choice if required.

---

# P2 — LARGER WORLD

## P2-MULTITILE-TERRAIN-01 — Neighboring terrain source/seam gate
**Status:** OPEN / DEFERRED FROM ACTIVE CRITICAL PATH  
Current canonical GitHub evidence still treats real neighboring DTM1 overlap/seam authority as unresolved. Continue only when it is the active larger-world task; do not block the single-tile playable slice.

## P2-STREAMING-01 — 3×3 movement-driven residency + budgets
Reuse the existing scheduler/cache foundation. Prove bounded working set around a moving player after the player experience exists.

## P2-LOD-01 — Terrain/object LOD
Measure actual traversal and geometry pressure first; then select the least expensive LOD representation that meets walking/driving visual error requirements. Do not build global SSE/globe infrastructure by default.

## P2-SCALE-01 — 10×10 then 25×25
Prove RAM/GPU/network/cache costs follow active/retained working set rather than total world size.

---

# P3 — SIMULATION / ENGINE PORTABILITY

## P3-SIM-01 — Entity/simulation foundation
Deterministic tick/events, renderer-neutral dynamic entities, collision/physics boundary, vehicles/NPC-ready state.

## P3-UNREAL-01 — Minimal Unreal adapter spike
Consume the same compiled Nannestad artifacts/world coordinate contract and one glTF/GLB/entity sample in Unreal without modifying source acquisition/compiler semantics. The spike succeeds if the difference is an adapter/import layer rather than a second world pipeline.

---

# Explicitly not active now

- Cesium/globe UX as the primary renderer path;
- whole-Norway terrain format/LOD selection;
- repeated 3×3 terrain-source archaeology while the single-tile slice is sufficient;
- production orthophoto before license/cache rights are clear;
- full physics engine selection before collision requirements demand it;
- networking/persistence;
- AI/NPC behavior;
- repeated manual handset validation.

# Task completion rule

A task closes when its stated acceptance passes. SENTINEL may add **one** cheap adversarial check when the claim is dangerous. Additional test/research cycles require either a new failure, a changed claim or a materially different implementation; otherwise log the issue and move to the next priority.
