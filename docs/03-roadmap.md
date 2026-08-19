# 03 — Roadmap

## Goal

Build a technically credible, measurable and replaceable foundation that can turn real Norwegian geodata into a ground-level 3D world with gameplay/simulation potential, while preserving a future path to other renderers including Unreal Engine.

## Product orientation

The primary user experience is **near-ground movement**: walking, driving and interacting at meter scale. A globe/high-altitude map view is not the design center of the current renderer. Geographic correctness and simulation state remain engine-neutral; visual presentation is allowed to specialize for high-quality ground-level graphics.

## Validation strategy

Normal progress is automated-first: targeted regressions, hosted CI, exact-artifact browser smoke tests and reproducible measurements. Physical Android/mobile runs are occasional milestone checks, not a per-change loop. See `docs/07-testing-policy.md`.

## Active execution plan

`docs/08-revised-engine-chain.md` is the active implementation order. The immediate milestone is a **walkable single-tile Nannestad vertical slice** using the already accepted terrain, road and building artifacts.

Current order:
1. Three.js ground-level renderer adapter and human-scale camera;
2. accepted terrain mesh with real material/shader treatment;
3. road-surface meshes from accepted NVDB paths;
4. building meshes from accepted footprints with explicit source/fallback height semantics;
5. licensed humanoid glTF/GLB asset with idle/walk locomotion;
6. terrain grounding/simple collision abstraction + third-person camera;
7. lighting, shadows, fog and first visual-quality pass;
8. one integrated browser acceptance run and Preview;
9. only then resume broader geometry enrichment, vegetation, imagery, 3×3 streaming/terrain seam work, LOD and large-area scaling.

## P0 — Walkable Nannestad

### Already-proven foundation
- real single-tile DTM1 terrain artifact and deterministic compiler lineage;
- real compiled NVDB road paths;
- real compiled OSM building footprints;
- full runtime provenance verification;
- browser terrain worker path and renderer-resource lifecycle;
- world-state vs render-local precision/origin invariants.

### Active P0 outcome
One real Nannestad tile must feel like a 3D place at human scale: terrain, roads, building volumes, materials, a controllable human asset and a ground-level camera, all consuming verified runtime artifacts with zero raw-source calls.

This P0 does **not** require whole-Norway streaming, complete building semantics or production photorealism.

## P1 — Ground-level world quality

- source-backed building heights/relations/roof enrichment;
- physical road width/lane/surface semantics;
- reusable renderer-neutral material IDs + Three.js PBR/shader implementations;
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

Entity/component model, deterministic tick/clock/events, physics/collision boundary, vehicles, NPCs and local/worker/server split experiments. Dynamic state remains independent from Three.js scene objects.

## P4 — Persistence/networking

Only after local world state, character/entity state and streaming behavior are stable enough to define authoritative state boundaries.

## P5 — Engine portability / advanced presentation

- minimal Unreal Engine importer/adapter consuming the same engine-neutral runtime/world contracts;
- advanced atmosphere/weather, procedural detail and photorealistic layers;
- AI/dialog/media downstream of authoritative world/simulation state.

## Architecture guardrail

Three.js/WebGPU-first is the working renderer direction for the ground-level slice, not permission to put Three.js types into compiler/world/simulation contracts. The web renderer must remain replaceable by an Unreal or other adapter without rebuilding Norwegian source ingestion and world truth.