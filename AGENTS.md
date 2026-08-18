# Agent working contract — Norge World Engine

## Start every task here

1. Read `.agents/skills/nwe-project-start/SKILL.md`.
2. Read `README.md`.
3. Read `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md` and `docs/06-task-queue.md`.
4. Inspect current GitHub branches/PRs/issues touching the same P0 gate before starting duplicate work.
5. Select exactly one primary Agent v2 role from `.agents/roles/`.
6. Use `docs/drive-index.md` only when long-form Drive research/history is needed.
7. Pick the highest-priority unresolved P0 task that the selected role can advance with concrete evidence now.
8. Verify time-sensitive software/API/license/geodata claims against current primary sources before relying on them.
9. Implement a small reversible change, validate it, and update worklog/task queue plus affected decisions/docs in the same PR.
10. End with **Gjort / Bevist / Endret / Neste**.

GitHub is canonical for implementation state. Current repo/task-queue evidence beats stale historical Drive prose.

## Agent v2 — five active roles

- **LUMEN — Renderer & Web Platform**: `.agents/roles/lumen-renderer.md`. Owns `apps/world-viewer`, renderer experiments, WebGPU/WebGL capability work, browser/GPU instrumentation and Vercel Preview.
- **STRØM — Runtime Streaming**: `.agents/roles/strom-streaming.md`. Owns `engine/streaming`, tile lifecycle, cache/prioritization, worker boundaries and renderer-neutral runtime metrics.
- **FORGE — World Compiler & Data Pipeline**: `.agents/roles/forge-compiler.md`. Owns authoritative acquisition, normalization, tiling, deterministic compilation and real-data promotion.
- **ATLAS — World Model & Coordinates**: `.agents/roles/atlas-world.md`. Owns coordinate/world-state contracts, floating/render origin, temporal origin semantics and the simulation boundary.
- **SENTINEL — Integration & QA**: `.agents/roles/sentinel-integration.md`. Owns adversarial integration, schemas/contracts, cross-agent acceptance, CI evidence and claim calibration.

These roles are parallel, not a fixed sequence. Dependencies still matter: runtime/render work consumes accepted compiled artifacts and contracts; it does not invent missing world truth.

## Repo-local skills

Load only what the task needs:

- `nwe-project-start` — mandatory startup, role/priority selection and handoff.
- `nwe-geodata-contracts` — source/CRS/datum/license/provenance gates.
- `nwe-world-compiler` — raw → normalized → compiled, cache, lineage, promotion.
- `nwe-geospatial-tooling` — pinned Rasterio/GDAL, pyproj/PROJ, Shapely and RFC8785 usage.
- `nwe-world-model` — high-precision world state, render-local coordinates and origin epochs.
- `nwe-runtime-streaming` — verified tile lifecycle, scheduler/cache/worker boundaries.
- `nwe-renderer-platform` — measurable web renderer, WebGPU/WebGL experiments and Vercel Preview.
- `nwe-quality-gates` — negative tests, determinism, evidence classes and performance QA.
- `nwe-3d-tiles-spike` — measured 3D Tiles/Cesium interchange experiments only.
- `nwe-github-workflow` — isolated agent branches, draft PRs, CI and project-memory publication.

## Parallel-work contract

- One primary role owns a branch and its core paths. Branch names should be `agent/<role>-<task>`.
- Before editing a shared contract or shared doc, inspect active PRs. Prefer additive/narrow changes and avoid rewriting unrelated sections.
- Cross-agent handoff happens through versioned schemas, verified artifacts, documented metrics and explicit PR dependencies — not copied private assumptions.
- LUMEN and STRØM may not weaken `RuntimeVerificationBundle` or bypass artifact verification for convenience.
- FORGE may not encode renderer-specific assumptions into source acquisition or canonical normalized data.
- ATLAS may prototype coordinate policies but may not mark a whole-Norway policy selected without evidence and `docs/04-decisions.md`.
- SENTINEL may block a claim/PR on missing evidence; it must distinguish implementation failure from infrastructure/tooling failure.
- No agent merges its own work unless the user explicitly asks for a merge.

## Architecture invariants

- Separate geographic correctness from photorealism.
- Source geodata is input to reproducible preprocessing; normal runtime consumes compiled artifacts, never Kartverket/NVDB/OSM source APIs.
- Keep coordinate/datum/provenance explicit. Never interpret anonymous `z` as authoritative elevation.
- Runtime tile identity is independent from provider/source tiling.
- Design for tiles/chunks, LOD, streaming, caching, origin shifting and deterministic coordinate handling from the start.
- Keep renderer/runtime replaceable. WebGPU, WebGL, Cesium/3D Tiles and Unreal remain evidence-driven until measured and recorded.
- Static geodata and dynamic simulation state are separate layers.
- Performance is a requirement: measure CPU, GPU, RAM/VRAM, network/cache, tile latency, worker cost, frame time/rAF gaps and draw calls as soon as relevant.
- Use the least expensive representation that satisfies the current LOD/accuracy need.

## Current evidence boundary — 2026-08-18

The accepted single-tile Nannestad terrain plus road/building artifacts are real-data and runtime-verification proven. Full browser provenance and an actual module DedicatedWorker path are also proven. Real neighboring DTM1 terrain is still fail-closed on the unresolved source-overlap/seam policy; Android movement/performance and whole-Norway coordinate/LOD choices remain open. The Vite World Viewer is a deployment/measurement shell, not a selected renderer architecture.

## Prototype vs engine

Experiments and historical implementations belong in `prototypes/`. Production-direction code belongs in `engine/` only when its contract and regressions are satisfied. `apps/world-viewer` is the deployable measurement surface and must remain an artifact consumer rather than a source-data compiler.

## End every task with

- **Gjort:** actual implementation/investigation.
- **Bevist:** what is now known from evidence.
- **Endret:** files/decisions/tasks changed.
- **Neste:** single highest-value follow-up.
