# 03 — Roadmap

## Goal

Build a technically credible, measurable and replaceable foundation that can stream real Norwegian 3D world data and later host simulation/game systems.

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

Materials/facades, vegetation, road markings/objects, representative props, stronger LOD, imagery under a validated license model.

## P2 — Simulation foundation

Entity/component model, deterministic tick/clock/events, physics/collision boundary, local/worker/server split experiments.

## P3 — Persistence/networking

Only after local world state and streaming behavior are measured and stable enough to define authoritative state boundaries.

## P4 — Advanced presentation

Atmosphere, photorealistic layers, AI/dialog/media and emergency-simulator features. AI must remain downstream of authoritative world/simulation state.
