# Agent working contract — Norge World Engine

## Start every task here

1. Read `.agents/skills/nwe-project-start/SKILL.md`.
2. Read `README.md`.
3. Read `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md` and `docs/06-task-queue.md`.
4. Use `docs/drive-index.md` only when long-form Drive research/history is needed.
5. Pick the highest-priority unresolved P0 task that advances Prototype 0.
6. Verify time-sensitive software/API/license/geodata claims against current primary sources before relying on them.
7. Produce concrete work: code, test, benchmark, pipeline, schema, decision record or verified source evidence.
8. Validate it, then update worklog/task queue and any affected decision/architecture docs in the same PR.

## Repo-local skills

Activate only the skills relevant to the current task:

- `nwe-geodata-contracts` — source/CRS/datum/license/provenance gates.
- `nwe-world-compiler` — raw → normalized → compiled, cache, lineage, promotion.
- `nwe-geospatial-tooling` — pinned Rasterio/GDAL, pyproj/PROJ, Shapely and RFC8785 usage.
- `nwe-quality-gates` — negative tests, determinism and evidence-first QA.
- `nwe-3d-tiles-spike` — only for measured 3D Tiles/Cesium interchange experiments.
- `nwe-github-workflow` — branch/PR/CI/project-memory publication rules.

Do not load renderer/AI/media context when the active P0 is a compiler/data task.

## Canonical work surface

GitHub/repository history is canonical for new code, tests, schemas, CI, implementation docs and tasks. Google Drive remains reference/project memory. Historical Drive text saying “Drive-first” is superseded for new implementation work as of 2026-08-17.

Never make Drive the only copy of new implementation code. Do not commit raw geodata, generated runtime tiles/caches, credentials or proprietary datasets.

## Architecture invariants

- Separate geographic correctness from photorealism.
- Source geodata is input to reproducible preprocessing; normal runtime must consume compiled artifacts, not source APIs.
- Keep coordinate/datum/provenance explicit. Never interpret anonymous `z` as elevation.
- Design for tiles/chunks, LOD, streaming, caching and deterministic coordinate handling from the start.
- Keep renderer/runtime replaceable. WebGPU/WebGL/Unreal/Cesium choices remain evidence-driven until measured.
- Static geodata and dynamic simulation state are separate layers.
- Performance is a requirement: measure CPU, GPU, RAM/VRAM, network/cache, tile latency and frame time as soon as the relevant artifact exists.
- Use the least expensive representation that satisfies the current LOD/accuracy need.

## Prototype vs engine

Experiments and historical implementations belong in `prototypes/`. Production-direction code belongs in `engine/` only when its contract and regressions are satisfied.

The corrected GeoRSS polygon predicate is implemented in `engine/compiler/src/nwe_compiler/`; the legacy v0.2 copy under `prototypes/` remains historical.

Full RuntimeVerificationBundle reconstruction is implemented in `engine/streaming/runtime_verifier.mjs` against the `02.7` semantic contract: runtime recalculates object hashes/edges, treats transport locators as mutable, requires REAL_COMPILED + promotion gates, and verifies artifact bytes before READY_FOR_RUNTIME. Keep the legacy VEKTOR v0.3 gate under `prototypes/` for historical regression only.

`02.7 – RuntimeVerificationBundle + SpatialIndex Contract v0.1` in Drive remains the semantic authority until the complete contract is represented as versioned repo schemas. Do not weaken the engine verifier to match legacy prototype envelopes.

## End every task with

- **Gjort:** actual implementation/investigation.
- **Bevist:** what is now known from evidence.
- **Endret:** files/decisions/tasks changed.
- **Neste:** single highest-value follow-up.
