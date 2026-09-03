# 06 — Active task queue

This file is the **current execution queue**. Historical queue states remain in Git history and the archived Drive logs; do not append old status prose here.

## Priority rule

The next task must advance the Unreal Nannestad milestone in `docs/09-unreal-game-plan.md` unless it discovers a genuine hard dependency. Do not let unrelated whole-Norway, multi-tile, device or source research displace the active vertical slice.

## Known proven foundation — do not re-prove by default

- single-tile real Nannestad DTM1 compiler/runtime artifact: PASS;
- real compiled NVDB roads: PASS;
- real compiled OSM building footprints: PASS;
- runtime-verifiable world-artifact provenance in Node + real Chrome: PASS;
- world-artifact browser path with zero raw Kartverket/NVDB/OSM acquisition calls: PASS;
- module DedicatedWorker terrain mesh path: PASS;
- scheduler/cache/resource lifecycle roundtrip for the accepted terrain tile: PASS;
- high-precision Float64 world state + render-local Float32/origin invariants: PASS;
- deterministic verified NWE → UE Landscape/runtime package: PASS outside UE;
- UE 5.8 C++ project, explicit georeference, bootstrap and third-person character: IMPLEMENTED / WINDOWS EDITOR COMPILE OPEN;
- Three.js ground renderer adapter over renderer-neutral buffers: PASS in hosted Chrome/WebGL2; hosted WebGPU device evidence remains unavailable and is not claimed as performance proof;
- walking-distance renderer-only terrain PBR/detail over unchanged accepted DTM geometry: PASS / merged PR #70;
- connected renderer-side road surfaces over 246 accepted compiled NVDB paths: PASS / merged PR #73;
- polygon-safe batched building walls/roofs over 135 accepted footprints: PASS / merged PR #74;
- licensed animated KayKit Knight humanoid with fail-closed idle/walk state: PASS / merged PR #75;
- renderer-neutral character world-transform contract: PASS / merged ATLAS PR #72;
- ATLAS-backed character movement, accepted-DTM grounding, renderer pose binding, keyboard/touch controls and third-person follow camera: PASS / merged PR #77.

### Historical web renderer-asset network boundary

`P0-GROUND-05` currently loads the CC0 KayKit Knight from an immutable commit-pinned `raw.githubusercontent.com` URL. This is an explicit renderer-asset runtime dependency, **not** raw geodata acquisition. The existing injected world-artifact `fetchImpl` audit does not enumerate GLTFLoader's separate request, so do not claim that the seven audited world-artifact requests are the browser's entire network surface. Vendoring/promotion into an NWE asset pipeline is later hardening work, not a blocker for the current single-character P0.

## Historical agent capability maintenance

- `AGENT-SKILLS-GPU-01` — **COMPLETED / MERGED PR #76**: ten upstream Three.js skill concept areas were adapted into renderer-neutral NWE GPU skills. WebGPU is first-class, WebGL2 remains fallback/baseline, and Three.js/TSL stays presentation-only.

---

# P0 — UNREAL NANNESTAD

## UE5-FOUNDATION — Deterministic adapter and game scaffold
**Priority:** IMPLEMENTED / VALIDATION PARTIAL
**Owner:** LUMEN
**Status:** Python unit PASS + real pinned-snapshot package PASS; UE Editor unavailable in the current environment

**Implemented:** UE 5.8 C++ project; immutable Nannestad snapshot verification;
1009² Landscape derivative; 21 chunked runtime mesh packets; explicit
EPSG:25832/NN2000 mapping; third-person Quinn character; collision bootstrap;
Lumen/VSM atmosphere; Open World level and Windows setup automation.

**Truth guard:** road widths and most building heights/roofs remain visibly
classified presentation fallbacks. No photorealism or UE compile claim yet.

## UE5-RUN-01 — Windows compile, map creation and PIE evidence
**Priority:** 1 — ACTIVE / START HERE
**Owner:** LUMEN + SENTINEL
**Status:** WAITING FOR UE 5.8 WINDOWS RUNNER

**Acceptance:** clean setup script run; Editor target compiles; Open World map is
created; Quinn spawns/animates/moves/jumps; real terrain/building collision
works; 21 packets load; no raw geodata request occurs; frame/log/performance
evidence is retained.

## UE5-LANDSCAPE-01 — Native Landscape/World Partition bake
**Priority:** 2 — after UE5-RUN-01
**Owner:** LUMEN + ATLAS
**Status:** DERIVATIVE READY / EDITOR IMPORT OPEN

**Acceptance:** generated `.r16` imports with the recorded scale/location and
north/south orientation; representative height samples match DTM1 within the
recorded quantization bound; native collision replaces bootstrap terrain only
after parity.

## UE5-VISUAL-01 — Production realism pass
**Priority:** 3 — after native terrain parity
**Owner:** LUMEN
**Status:** OPEN

**Acceptance:** licensed authored PBR surfaces, source-backed Norwegian
vegetation and measured daylight lighting produce a street-level frame that is
clearly beyond baseline materials without changing geometry truth.

## UE5-GEO-01 — Road/building fidelity
**Priority:** 4
**Owner:** FORGE + LUMEN
**Status:** OPEN

**Acceptance:** admitted road widths/lanes/surfaces and building heights/roofs
replace fallbacks where sources support them; missing values remain explicit.

## UE5-PACKAGE-01 — Windows packaged-build gate
**Priority:** 5
**Owner:** SENTINEL
**Status:** WAITING

**Acceptance:** Development package repeats data identity, movement, collision,
visual and performance checks outside PIE.

---

# HISTORICAL P0 — THREE.JS PLAYABLE NANNESTAD

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
**Priority:** SUPERSEDED BY UE5-VISUAL-01
**Owner:** LUMEN
**Status:** HISTORICAL / NOT ACTIVE

**Implement:** bounded near-player shadows, sun/directional light, sky/fog, tone mapping, material roughness/normal variation and conservative shader detail. Prefer batching/instancing and shared materials over unique draws/textures.

**Acceptance:** screenshot/video-level output is visibly beyond debug geometry while automated sample metrics show no obvious navigation-breaking regression.

## P0-GROUND-08 — Integrated acceptance + Preview
**Priority:** SUPERSEDED BY UE5-PACKAGE-01
**Owner:** SENTINEL
**Status:** HISTORICAL / NOT ACTIVE

**Run once for the milestone:** production build; touched provenance regressions; one browser smoke for terrain + roads + buildings + character spawn/movement; zero raw geodata acquisition; backend/first-visible/frame/draw metrics where available; exact-commit Preview when deployment tooling is available.

---

# P1 — NEXT VISIBLE QUALITY

## P1-BUILDINGS-01 — Better building truth
Multipolygon/relation ingestion, DOM-DTM/FKB capability-gated height enrichment and roof semantics. Keep source-backed vs procedural explicit.

## P1-ROADS-01 — Physical road semantics
Compile width/lane/surface/intersection fields that actually support those claims; progressively replace visual fallback width.

## P1-VEGETATION-01 — Norwegian vegetation layer
**Status:** REAL-SOURCE REPRESENTATIVE ARTIFACT PASS / RENDERER HANDOFF OPEN / CANDIDATE NOT PROMOTED
**Owner:** FORGE source/compiler + LUMEN presentation

**Proven public preprocessing baseline candidate:** NIBIO `SR16V` forest polygons + NIBIO `AR50` coarse nationwide area classification/exclusion. Existing accepted NWE terrain/road/building artifacts remain separate downstream inputs; do not pretend this first representative artifact already applies precise road/building suppression or authoritative ground height.

**Source admission evidence:** `P1-VEGETATION-01-SAMPLE` passed on code-bearing head `5594fe073edf0c20b03911c56f5b454a7aba4dc9`: `baseline` run `32312909195` PASS and heavy `visual-source-probe` run `32312909181` PASS. The 1 km EPSG:25832 tile normalized 124 SR16V polygons + 15 AR50 polygons, same-cache A1/A2 was byte-identical, independent AR50 acquisitions were semantically identical after excluding only proven volatile `kopidato`, and no provider network was required during normalization.

**Representative artifact evidence:** `P1-VEGETATION-01-ARTIFACT` passed on code-bearing head `de91525ac45c4ca19eb5ed4b5fb470e2be1dbedd`: `baseline` run `32314719926` PASS and heavy `visual-source-probe` run `32314719935` PASS. The real Nannestad sample compiled 92 usable SR16V segments into 828 deterministic representative points over 516,753.05 m² after 112,923.69 m² of coarse AR50 non-forest suppression. The compiled source semantics represent 23,493.8875 modeled trees/ha-derived trees with DBH >=16 cm through weighted representatives; the representative-weight sum matches that modeled aggregate. Same normalized cache input was byte-identical, and an independent AR50 acquisition produced the same artifact semantic hash. Artifact SHA-256 is `9b20fdc38c8d672ab5d5e7c089905de477973f383caf2cc571c0e63d7ff75636`; semantic SHA-256 is `320a7e8aadc00fce2ef3912e48f64e279962c5084a89210bca853f506a2f4f1f`; compiler-config identity is `f3a3206a559c00196c2a8fc9c397697aae20bef98a25e5e598766fc4de5bd90e`.

**Candidate representation policy, not world truth:** the current config targets 16 representatives/hectare to produce a bounded proof artifact. It is a versioned representation/LOD experiment, **not** a claim that Norway has 16 trees/hectare. Each representative carries a modeled-tree weight derived from source-backed `srtrean_ge16`; changing this target changes compiler-config identity and artifact identity.

**SR16V semantics preserved:** `srtreslagsam` source classes remain 1 spruce-dominated, 2 pine-dominated, 3 conifer-mixed, 4 mixed, 5 deciduous-dominated; `srhoydem` is converted from source decimetres to metres; `srtrean_ge16` remains modeled trees/hectare for DBH >=16 cm; available lower/upper uncertainty and standard-error percentage, canopy cover, remote-sensing year and source update date remain attached to the source segment. Representative easting/northing and yaw are explicitly deterministic procedural values, not observed individual-tree positions.

**SR16V source binding:** official Nannestad municipality `3238` Atom/SOSI snapshot, source SHA-256 `09dc03637097c485d1b80a863eb1bd36a65ebc9b29c2505b0e95cc15a5533adf`. Provider UTF-8 bytes remain authoritative; a strict round-trip ISO8859-10 compatibility copy exists only because hosted GDAL/FYBA cannot open the valid UTF-8 SOSI directly.

**SR16R status:** technically attractive higher-fidelity candidate, but **not admitted as the required public baseline**. Current split-raster metadata mixes open-data and Norge digitalt license signals, while the tested legacy/open raster UUID exposes NLOD metadata but no working NIBIO capabilities endpoint. Re-evaluate only with a concrete unambiguous raster lineage + real-byte gate.

**Licensed enrichments, not baseline:** FKB-AR5 and Nasjonalt grunnkart for arealanalyse currently require Geovekst/Norge digitalt rights under the verified access model. NIBIO regional vegetation maps may enrich covered areas but are not nationwide.

**Truth guard:** SR16 does not provide authoritative individual-tree positions. The candidate artifact contains no Three.js/WebGPU object types, asset IDs, render origin or terrain Z. It also does not yet apply exact accepted road/building exclusion. Tree placement/yaw and representation density are deterministic procedural data; source class/height/density/uncertainty remain separately identifiable.

**Next integration gate — `P1-VEGETATION-01-RENDERER-HANDOFF`:** LUMEN may adapt PR #80's renderer to consume `nwe.vegetation-representative-artifact/0.1-candidate` instead of treating `nwe.synthetic-vegetation-placement/0.1` as the only accepted input. Render-local conversion, accepted-DTM grounding, road/building/spawn/slope presentation filtering, Poly Haven/other asset mapping, visible-instance budgets and LOD remain renderer/runtime concerns. PR #80's 48-visible-instance limit may remain a presentation budget; it must not overwrite source-modeled density or representative weights.

**Later compiler gate:** if vegetation positions themselves become authoritative simulation/collision state rather than visual representatives, integrate accepted road/building/water exclusion geometry into a separately versioned compiler transform and re-run provenance/determinism gates before promotion.

## P1-MATERIALS-01 — Renderer-neutral material semantics
Stable material IDs/parameters in world/runtime data; Unreal and reference adapters map them to PBR/shaders. Do not encode renderer material classes into compiled world artifacts.

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
**Status:** SUPERSEDED BY UE5-FOUNDATION. The adapter is now the active runtime rather than a future spike.

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
