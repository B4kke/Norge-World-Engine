# 06 — Active task queue

This file is the **current execution queue**. Historical queue states remain in Git history and the archived Drive logs; do not append old status prose here.

## Priority rule

The next task must advance the walkable Nannestad milestone in `docs/08-revised-engine-chain.md` unless it discovers a genuine hard dependency. Do not let unrelated whole-Norway, multi-tile, device or source research displace the active vertical slice.

## Known proven foundation — do not re-prove by default

- single-tile real Nannestad DTM1 compiler/runtime artifact: PASS;
- real compiled NVDB roads: PASS;
- real compiled OSM building footprints: PASS;
- runtime-verifiable world-artifact provenance in Node + real Chrome: PASS;
- world-artifact browser path with zero raw Kartverket/NVDB/OSM acquisition calls: PASS;
- module DedicatedWorker terrain mesh path: PASS;
- scheduler/cache/resource lifecycle roundtrip for the accepted terrain tile: PASS;
- high-precision Float64 world state + render-local Float32/origin invariants: PASS;
- Three.js ground renderer adapter over renderer-neutral buffers: PASS in hosted Chrome/WebGL2; hosted WebGPU device evidence remains unavailable and is not claimed as performance proof;
- walking-distance renderer-only terrain PBR/detail over unchanged accepted DTM geometry: PASS / merged PR #70;
- connected renderer-side road surfaces over 246 accepted compiled NVDB paths: PASS / merged PR #73;
- polygon-safe batched building walls/roofs over 135 accepted footprints: PASS / merged PR #74;
- licensed animated KayKit Knight humanoid with fail-closed idle/walk state: PASS / merged PR #75;
- renderer-neutral character world-transform contract: PASS / merged ATLAS PR #72;
- ATLAS-backed character movement, accepted-DTM grounding, renderer pose binding, keyboard/touch controls and third-person follow camera: PASS / merged PR #77.

### Renderer-asset network boundary

`P0-GROUND-05` currently loads the CC0 KayKit Knight from an immutable commit-pinned `raw.githubusercontent.com` URL. This is an explicit renderer-asset runtime dependency, **not** raw geodata acquisition. The existing injected world-artifact `fetchImpl` audit does not enumerate GLTFLoader's separate request, so do not claim that the seven audited world-artifact requests are the browser's entire network surface. Vendoring/promotion into an NWE asset pipeline is later hardening work, not a blocker for the current single-character P0.

## Agent capability maintenance — does not change P0 order

- `AGENT-SKILLS-GPU-01` — **COMPLETED / MERGED PR #76**: ten upstream Three.js skill concept areas were adapted into renderer-neutral NWE GPU skills. WebGPU is first-class, WebGL2 remains fallback/baseline, and Three.js/TSL stays presentation-only.

---

# P0 — PLAYABLE NANNESTAD

## P0-GROUND-01 — Three.js ground-level renderer adapter
**Priority:** COMPLETED  
**Owner:** LUMEN  
**Status:** MERGED / HOSTED CHROME WEBGL2 PASS / WEBGPU DEVICE EVIDENCE OPEN, NON-BLOCKING

**Acceptance evidence:** accepted Nannestad terrain/roads/buildings rendered through the Three adapter; production build, provenance/decode, terrain-resource lifecycle and browser gates pass.

## P0-GROUND-02 — Terrain mesh + walking-distance material
**Priority:** COMPLETED  
**Owner:** LUMEN  
**Status:** MERGED PR #70

**Implemented:** worker normals/UVs, renderer-only macro variation, generated detail textures, PBR roughness/bump response and no DTM displacement.

**Truth guard:** all material/detail variation is presentation-only; accepted DTM positions remain world truth.

## P0-GROUND-03 — Road-surface meshes
**Priority:** COMPLETED  
**Owner:** LUMEN  
**Status:** MERGED PR #73 / ALL FIVE HOSTED WORKFLOWS PASS ON INTEGRATED HEAD

**Implemented:** connected path strips, shared corner pairs, duplicate-point removal, capped miter joins, meter-based UVs, 0.06 m renderer-only surface lift and 3.2 m renderer-only visual width fallback.

**Truth guard:** current visual width is **not authoritative physical road width**.

## P0-GROUND-04 — Building meshes + roofs
**Priority:** COMPLETED  
**Owner:** LUMEN  
**Status:** MERGED PR #74 / ALL FIVE HOSTED WORKFLOWS PASS ON INTEGRATED HEAD

**Implemented:** polygon-safe Earcut roof triangulation, batched wall/roof buffers, separate source-backed/fallback PBR material classes and explicit unresolved-height semantics.

**Truth guard:** unresolved building height remains unresolved in world data; 5 m height and 0.08 m ground lift are renderer-only fallbacks.

## P0-GROUND-05 — Licensed humanoid glTF/GLB + animation
**Priority:** COMPLETED  
**Owner:** LUMEN  
**Status:** MERGED PR #75 / ALL FIVE HOSTED WORKFLOWS PASS

**Implemented:** CC0 KayKit Adventurers `Knight.glb`, commit-pinned upstream provenance, `GLTFLoader`, `AnimationMixer`, fail-closed idle/walk clip resolution, 1.75 m renderer normalization and in-browser `idle -> walk -> idle` state probe.

**Truth guard:** model pose/spawn is renderer state. ATLAS/world state remains authoritative for position/heading.

## P0-GROUND-06 — Character movement + terrain grounding + camera
**Priority:** COMPLETED  
**Owner:** LUMEN + ATLAS  
**Status:** MERGED PR #77 / ALL FIVE HOSTED WORKFLOWS PASS ON EXACT HEAD

**Implemented:**
- Preview 1 EPSG:25832 / NN2000 character world frame;
- ATLAS `WorldPosition` / character-transform authority rather than Three-owned world coordinates;
- accepted-DTM height grounding after authoritative planar movement;
- explicit ATLAS `[east,north,up]` -> Three `[east,up,-north]` adapter;
- canonical positive zero in derived renderer coordinates;
- render-origin-shift regression requiring unchanged authoritative character state;
- one-way renderer pose sink into the KayKit Knight with explicit 0.02 m presentation-only ground lift;
- renderer-neutral runtime composition mapping authoritative movement to pose + walk/idle state;
- W/S + A/D and arrow keyboard controls, plus separate non-conflicting touch overlay controls;
- 3.2 m/s movement budget, 1.9 rad/s turn budget and 50 ms input-delta clamp;
- third-person follow-orbit camera with 6.5 m initial distance and +1.2 m follow target height;
- exact Chrome 1.00 m movement probe validating authoritative distance, DTM grounding, walk -> idle, renderer pose agreement and camera follow.

**Acceptance evidence:** exact implementation head `4fd753767106e3d56957ff555d7069f0c4d7e5b4` passed `baseline` run 32302005719, `world-viewer-vite` run 32302005703, `viewer-benchmark` run 32302005752, `preview1-realdata-publish` run 32302005712 and `preview3-realdata-publish` run 32302005733; merged as `8971dff662f4743be8b48302c1b4f1b286ead858`.

**Truth guard:** Three/GLTF state remains presentation-only. Authoritative position/heading stays in ATLAS Float64 world state; the 0.02 m character lift and follow-camera parameters are renderer-only.

## P0-GROUND-07 — First graphics/shader pass
**Priority:** 1 — ACTIVE  
**Owner:** LUMEN  
**Status:** OPEN / START HERE

**Implement:** bounded near-player shadows, sun/directional light, sky/fog, tone mapping, material roughness/normal variation and conservative shader detail. Prefer batching/instancing and shared materials over unique draws/textures.

**Acceptance:** screenshot/video-level output is visibly beyond debug geometry while automated sample metrics show no obvious navigation-breaking regression.

## P0-GROUND-08 — Integrated acceptance + Preview
**Priority:** 2 — only after 01–07 integrate  
**Owner:** SENTINEL  
**Status:** WAITING

**Run once for the milestone:** production build; touched provenance regressions; one browser smoke for terrain + roads + buildings + character spawn/movement; zero raw geodata acquisition; backend/first-visible/frame/draw metrics where available; exact-commit Preview when deployment tooling is available.

---

# P1 — NEXT VISIBLE QUALITY

## P1-BUILDINGS-01 — Better building truth
Multipolygon/relation ingestion, DOM-DTM/FKB capability-gated height enrichment and roof semantics. Keep source-backed vs procedural explicit.

## P1-ROADS-01 — Physical road semantics
Compile width/lane/surface/intersection fields that actually support those claims; progressively replace visual fallback width.

## P1-VEGETATION-01 — Norwegian vegetation layer
Small licensed asset set, deterministic/source-backed placement, GPU instancing and distance LOD/impostors.

## P1-MATERIALS-01 — Renderer-neutral material semantics
Stable material IDs/parameters in world/runtime data; Three.js maps them to PBR/shaders. Do not encode Three material classes into compiled world artifacts.

## P1-IMAGERY-01 — Production imagery/orthophoto
Only after coverage, CRS, resolution, update cadence, license, attribution, preprocessing/cache and redistribution rights are proven. Runtime consumes compiled texture tiles, not raw provider services.

## P1-CHARACTER-01 — Formal locomotion/physics boundary
Entity/component movement state, animation state machine, building/road collision needs and a measured physics-library choice if required.

## P1-ASSETS-01 — Promote renderer assets into NWE pipeline
Vendor or reproducibly acquire licensed assets, retain source/license/hash provenance, and remove avoidable third-party runtime dependency where redistribution rights permit.

---

# P2 — LARGER WORLD

## P2-MULTITILE-TERRAIN-01 — Neighboring terrain source/seam gate
**Status:** OPEN / DEFERRED FROM ACTIVE CRITICAL PATH  
Continue only when it becomes the active larger-world task; do not block the single-tile playable slice.

## P2-STREAMING-01 — 3×3 movement-driven residency + budgets
Reuse the existing scheduler/cache foundation. Prove bounded working set around a moving player after the player experience exists.

## P2-LOD-01 — Terrain/object LOD
Measure actual traversal and geometry pressure first; select the least expensive LOD representation meeting walking/driving error requirements.

## P2-SCALE-01 — 10×10 then 25×25
Prove RAM/GPU/network/cache costs follow active/retained working set rather than total world size.

---

# P3 — SIMULATION / ENGINE PORTABILITY

## P3-SIM-01 — Entity/simulation foundation
Deterministic tick/events, renderer-neutral dynamic entities, collision/physics boundary, vehicles/NPC-ready state.

## P3-UNREAL-01 — Minimal Unreal adapter spike
Consume the same compiled Nannestad artifacts/world coordinate contract and one glTF/GLB/entity sample without creating a second world pipeline.

---

# Explicitly not active now

- Cesium/globe UX as the primary renderer path;
- whole-Norway terrain format/LOD selection;
- repeated 3×3 terrain-source archaeology while the single-tile slice is sufficient;
- production orthophoto before license/cache rights are clear;
- full physics-engine selection before collision requirements demand it;
- networking/persistence;
- AI/NPC behavior;
- repeated manual handset validation.

# Task completion rule

A task closes when its stated acceptance passes. SENTINEL may add **one** cheap adversarial check when the claim is dangerous. Additional test/research cycles require a new failure, changed claim or materially different implementation; otherwise log the issue and move to the next priority.
