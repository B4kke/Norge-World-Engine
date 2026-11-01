# 03 — Roadmap

## Goal

Build a technically credible Unreal Engine 5 game that turns real Norwegian geodata into a ground-level world, while preserving the engine-neutral compiler and world truth.

## Product orientation

The primary user experience is **near-ground movement**: walking, driving and interacting at meter scale. A globe/high-altitude map view is not the design center of the current renderer. Geographic correctness and simulation state remain engine-neutral; visual presentation is allowed to specialize for high-quality ground-level graphics.

## Validation strategy

Normal progress is automated-first: targeted converter regressions, real pinned-artifact integration tests and reproducible measurements. Windows UE Editor compile/play/render and packaged-build checks happen at explicit milestone gates rather than being replaced by source-level claims.

## Active execution plan

`docs/09-unreal-game-plan.md` is the active implementation order. The immediate milestone is a **walkable single-tile Nannestad UE 5.8 vertical slice** using the already accepted terrain, road and building artifacts.

Current order:
1. deterministic verified NWE → Unreal package conversion;
2. UE C++ runtime bootstrap, explicit georeference and third-person character;
3. one real UE 5.8 Windows compile + Open World map creation + play smoke;
4. native Landscape/World Partition bake from the generated `.r16` contract;
5. source-backed road widths and building height/roof enrichment;
6. production PBR assets, Norwegian vegetation and measured lighting pass;
7. packaged-build performance and visual acceptance;
8. only then expand to neighboring tiles, LOD and larger-area streaming.

## P0 — Walkable Nannestad

### Already-proven foundation
- real single-tile DTM1 terrain artifact and deterministic compiler lineage;
- real compiled NVDB road paths;
- real compiled OSM building footprints;
- full runtime provenance verification;
- deterministic Unreal Landscape and runtime-mesh derivatives;
- world-state vs render-local precision/origin invariants.

### Active P0 outcome
One real Nannestad tile must feel like a 3D place at human scale: terrain, roads, building volumes, materials, a controllable human asset and a ground-level camera, all consuming verified runtime artifacts with zero raw-source calls.

This P0 does **not** require whole-Norway streaming, complete building semantics or production photorealism.

## P1 — Ground-level world quality

- source-backed building heights/relations/roof enrichment;
- physical road width/lane/surface semantics;
- reusable renderer-neutral material IDs + Unreal PBR material implementations;
- deterministic instanced vegetation and representative props;
- better collision/physics boundary and character controller;
- production imagery/orthophoto only under a verified license/cache/redistribution model.

## P2 — Multi-tile world runtime

- resolve authoritative neighboring-terrain seam/source-family policy;
- movement-driven 3×3 residency and budgets;
- multi-layer terrain/road/building tile lifecycle;
- measured terrain LOD only where traversal proves the need;
- scale to 10×10 then 25×25 with bounded working-set resources.

## P3 — Simulation foundation

Entity/component model, deterministic tick/clock/events, physics/collision boundary, vehicles, NPCs and local/server split experiments. Dynamic state remains independent from Unreal Actors and Components.

## P4 — Persistence/networking

Only after local world state, character/entity state and streaming behavior are stable enough to define authoritative state boundaries.

## P5 — Engine portability / advanced presentation

- retain the web/reference adapter as a portability check over the same world contracts;
- advanced atmosphere/weather, procedural detail and photorealistic layers;
- AI/dialog/media downstream of authoritative world/simulation state.

## Architecture guardrail

Unreal Engine 5.8 is the working game runtime, not permission to put Unreal types into compiler/world/simulation contracts. The game adapter must remain replaceable without rebuilding Norwegian source ingestion and world truth.
