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

## Manual physical-device testing policy

Physical handset/device testing is a **scarce milestone check**, not a default validation step and not a routine P0 blocker.

- Prefer automated regressions, hosted CI, desktop/headless browser runs, exact-artifact smoke tests and reproducible benchmarks for normal development.
- Do **not** ask the user to manually test Android after ordinary renderer, streaming, compiler, coordinate or integration changes.
- A missing fresh Android run must not block unrelated engine progress or become the automatic `Neste:` item.
- Physical-device testing is appropriate only when a genuinely device-specific question cannot be answered credibly by automation, or at an occasional accumulated milestone where one run validates several substantial changes at once.
- Batch device questions. A requested manual run should answer multiple high-value questions rather than repeat substantially the same scenario from the previous run.
- Before requesting user action, exhaust available automated/browser evidence and state exactly which unresolved claim requires physical hardware.
- Android/mobile evidence is required only for claims specifically about Android/mobile behavior or performance. It is **not** required to accept platform-neutral compiler, world-model, provenance, scheduler or browser-runtime progress.
- Keep harnesses ready so a future milestone device run is cheap and repeatable, but do not turn harness availability into a requirement to use it continuously.
- Historical `docs/05-worklog.md` entries that say the next step is an Android/device run are historical handoffs and are superseded by the current `docs/06-task-queue.md` plus this policy.

See `docs/07-testing-policy.md` for the project-wide validation hierarchy and manual-device cadence.

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

## Current evidence boundary — 2026-08-19

The accepted single-tile Nannestad terrain plus road/building artifacts are real-data and runtime-verification proven. Full browser provenance, an actual module DedicatedWorker path, exact-real hosted Chrome movement/cache behavior and renderer terrain-resource lifecycle are proven. Real neighboring DTM1 terrain is still fail-closed on the unresolved source-overlap/seam policy; whole-Norway coordinate/LOD choices remain open. Physical Android/WebGPU checks are retained as occasional device-specific milestone evidence, not the default blocker for continued engine development. The Vite World Viewer is a deployment/measurement shell, not a selected renderer architecture.

## Prototype vs engine

Experiments and historical implementations belong in `prototypes/`. Production-direction code belongs in `engine/` only when its contract and regressions are satisfied. `apps/world-viewer` is the deployable measurement surface and must remain an artifact consumer rather than a source-data compiler.

## End every task with

- **Gjort:** actual implementation/investigation.
- **Bevist:** what is now known from evidence.
- **Endret:** files/decisions/tasks changed.
- **Neste:** single highest-value follow-up. Do not default to requesting a physical-device test unless the manual-device policy specifically justifies one.
