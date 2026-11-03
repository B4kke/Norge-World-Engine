# 03 — Roadmap

## Goal

Build a technically credible, measurable and replaceable world engine that turns real Norwegian geodata into a ground-level 3D world with gameplay/simulation potential. The active product proof is **Nannestad 1×1 km in the WebUI**, while Unreal Engine remains a parallel consumer of the same engine-neutral world truth.

## Product orientation

The primary user experience is near-ground movement: walking, later driving and interacting at meter scale. Geographic/geometric correctness and visual realism are separate axes. Presentation may use PBR materials, procedural detail and renderer proxies, but those must never overwrite or masquerade as source truth.

## Validation strategy

Normal progress is automated-first: deterministic compiler/source gates, exact-artifact browser tests, screenshot-level visual proof and measured resource/frame evidence. Provider/raw-source acquisition is preprocessing only; normal WebUI consumes verified runtime artifacts.

## Active execution plan — Web Nannestad 1×1

Current order:
1. keep accepted DTM1 / NVDB / OSM world geometry and Float64 movement contract unchanged;
2. consume guarded NHM DOM−DTM building height plus strong roof-direction candidates;
3. consume source-backed NVDB width/surface semantics and preserve explicit fallback elsewhere;
4. consume NIBIO SR16V/AR50 vegetation representatives with deterministic grounding/exclusions and bounded instancing;
5. consume redistribution-admitted macro ground color plus pinned CC0 PBR materials;
6. compile/stage/render explicit NVDB street detail: road markings, signs, lighting, ditches, kerbs, sidewalks and other admitted object types;
7. improve near-field vegetation/building presentation without inventing exact individual trees, windows, sign faces or surveyed roof geometry;
8. run one exact hosted browser acceptance on the integrated head, then expose the Preview/WebUI;
9. only after the 1×1 slice reads as a real place, return to 3×3 terrain authority, LOD and larger-world streaming.

## P0 — Realistic freely navigable Nannestad WebUI

### Proven foundation
- real 1 m DTM1 terrain in EPSG:25832 / NN2000;
- accepted NVDB road centerlines and OSM building footprints;
- runtime provenance verification and zero raw Norwegian source acquisition in the normal browser path;
- Float64 authoritative movement, DTM grounding and first-person controls;
- local CC0 PBR assets, lighting/shadows/tone mapping and high/ultra post-processing path;
- guarded NHM DOM−DTM building-height candidate and conservative roof-direction candidate;
- NIBIO SR16V + AR50 representative vegetation candidate;
- source-backed NVDB width/surface candidate;
- source-backed NVDB street-detail compiler candidate.

### Active P0 outcome
One real Nannestad tile must feel like an actual Norwegian place at human scale: correct terrain and placement, materially plausible roads/buildings/ground, Norwegian forest structure, visible road markings and roadside objects, and free movement through the normal browser UI.

`1:1` means meter-scale world coordinates and source-backed placement/geometry where admitted. It does **not** mean that every façade, tree, sign face or roof edge has surveyed centimetre-level truth.

## P1 — Near-field fidelity

- legal/source-backed façade, roof-shape and building-use enrichment where available;
- richer NVDB relations for sign face/type/orientation and lane/intersection semantics;
- better authored/CC0 near-field tree assets mapped from SR16V classes while retaining deterministic source semantics;
- land-cover/material classification better than 10 m macro color without violating redistribution rights;
- collision/interaction boundary for buildings, roads and roadside objects;
- vehicle-ready road topology and physical road profile.

## P2 — Larger world runtime

- resolve authoritative neighboring DTM1 terrain seam/source-family policy;
- movement-driven 3×3 residency and measured budgets;
- terrain/object LOD selected from traversal error/performance evidence;
- scale to 10×10 then 25×25 while memory/network cost follows the active working set.

## P3 — Simulation foundation

Renderer-neutral entities, deterministic tick/events, physics/collision boundary, vehicles/NPC-ready state and client/worker/server experiments.

## P4 — Persistence/networking

Only after local world state, movement and streaming behavior are stable enough to define authoritative state boundaries.

## Parallel Unreal track

`apps/unreal-runtime` remains a supported parallel adapter. UE 5.8 Windows compile/play/package evidence, native Landscape/World Partition and UE visual acceptance remain valuable portability/game-runtime gates, but they do not block the explicit WebUI 1×1 km realism milestone.

## Architecture guardrail

Three.js/WebGPU-WebGL and Unreal are presentation/runtime adapters. Compiler output, provenance, coordinates, tile/entity identity and future simulation state remain renderer-neutral. Do not solve Web realism by putting Three.js-only semantics into world truth, and do not solve Unreal by creating a second Norwegian data pipeline.
