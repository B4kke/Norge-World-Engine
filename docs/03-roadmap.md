# 03 — Roadmap

## Goal

Build a technically credible, measurable and replaceable foundation that can stream real Norwegian 3D world data and later host simulation/game systems.

## Validation strategy

Normal progress is automated-first: contracts/regressions, hosted CI, exact-artifact browser tests and reproducible benchmarks. Physical Android/mobile tests are occasional milestone checks for genuinely device-specific questions, not a per-change gate. Missing a fresh handset run must not stall unrelated engine work. See `docs/07-testing-policy.md`.

## Revised engine execution chain

The current post-3×3 execution sequence is maintained in `docs/08-revised-engine-chain.md`. It is a dependency/prioritization plan, not an architecture decision and not a replacement for evidence gates in `docs/06-task-queue.md`.

Directionally the chain is:
1. 3×3 movement-driven residency + budgets;
2. terrain LOD/mesh policy on the same scheduler;
3. roads + buildings tile-for-tile over the full 3×3;
4. building heights/roofs + physical road surface;
5. first real material system + vegetation;
6. orthophoto/imagery as a tiled runtime layer;
7. procedural facade/road/terrain detail;
8. scale 3×3 → 10×10 → 25×25 while working-set resource use remains bounded rather than scaling linearly with total world size.

FORGE/SENTINEL continue the Atom DTM1 ↔ WCS canonical-terrain-source gate in parallel. Candidate terrain may advance isolated renderer/runtime experiments, but no source-family transition is treated as selected world truth before evidence and `docs/04-decisions.md` reconciliation.

## P0 — Nannestad vertical slice

1. **World contract** — explicit CRS, vertical datum, stable tile identity, local render origin and provenance semantics.
2. **Source contracts** — terrain/height, roads and buildings with license/access/CRS/datum metadata.
3. **World compiler contracts** — source snapshots, normalized snapshots, compile lineage, artifact refs and promotion.
4. **Compiler correctness fixes** — exact spatial selection and runtime-verifiable provenance.
5. **Real terrain vertical** — production DTM1 bulk acquisition, hash, raster validation, deterministic 1 km clip, persisted compiled artifact and warm/cold cache evidence.
6. **Roads/buildings** — NVDB normalization and capability-gated building path/fallback.
7. **Minimal viewer** — load only compiled artifacts; measure fetch/hash/decode/rebase/upload/first-frame/frame-time/draw calls/memory.
8. **Streaming** — dynamic load/unload, priority around camera/player, cache metrics and robust failure handling.

## P1 — World quality after P0 proof

Materials/facades, vegetation, road markings/objects, representative props, stronger LOD, imagery under a validated license model. The revised execution chain intentionally starts material/vegetation work before full imagery integration so visual quality can improve without prematurely locking runtime to a specific imagery provider or redistribution model.

## P2 — Simulation foundation

Entity/component model, deterministic tick/clock/events, physics/collision boundary, local/worker/server split experiments.

## P3 — Persistence/networking

Only after local world state and streaming behavior are measured and stable enough to define authoritative state boundaries.

## P4 — Advanced presentation

Atmosphere, photorealistic layers, AI/dialog/media and emergency-simulator features. AI must remain downstream of authoritative world/simulation state.
