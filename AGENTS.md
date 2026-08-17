# Agent working contract — Norge World Engine

## Start every task here

1. Read `README.md`.
2. Read `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md` and `docs/06-task-queue.md`.
3. Use `docs/drive-index.md` only when long-form Drive research/history is needed.
4. Pick the highest-priority unresolved P0 task that advances Prototype 0.
5. Verify time-sensitive software/API/license/geodata claims against current primary sources before relying on them.
6. Produce concrete work: code, test, benchmark, pipeline, schema, decision record or verified source evidence.
7. Validate it, then update worklog/task queue and any affected decision/architecture docs in the same PR.

## Canonical work surface

GitHub/repository history is canonical for new code, tests, schemas, CI, implementation docs and tasks. Google Drive remains reference/project memory. Historical Drive text saying “Drive-first” is superseded for new work as of 2026-08-17.

Never make Drive the only copy of new implementation code. Do not commit raw geodata, generated runtime tiles/caches, credentials or proprietary datasets.

## Architecture invariants

- Separate geographic correctness from photorealism.
- Source geodata is input to reproducible preprocessing; normal runtime must consume compiled artifacts, not source APIs.
- Keep coordinate/datum/provenance explicit. Never interpret anonymous `z` as elevation.
- Design for tiles/chunks, LOD, streaming, caching and deterministic coordinate handling from the start.
- Keep renderer/runtime replaceable. WebGPU/WebGL/Unreal choices remain evidence-driven until measured.
- Static geodata and dynamic simulation state are separate layers.
- Performance is a requirement: measure CPU, GPU, RAM/VRAM, network/cache, tile latency and frame time as soon as the relevant artifact exists.
- Use the least expensive representation that satisfies the current LOD/accuracy need.

## Prototype vs engine

Experiments and historical implementations belong in `prototypes/`. Production-direction code belongs in `engine/` only when its contract and regressions are satisfied.

Known legacy defects in the migrated prototypes:

- `prototypes/nannestad/compiler/dtm1_atom_adapter_v02.py` reduces GeoRSS polygon selection to a bounding box. Do not promote it until actual polygon geometry and the SENTINEL adversarial triangle regression pass.
- `prototypes/nannestad/runtime/vektor_runtime_gate_v03.mjs` trusts supplied lineage/gates instead of reconstructing the complete RFC 8785/JCS hash chain. Do not promote it until forged-lineage regression is rejected by reconstruction.

`02.7 – RuntimeVerificationBundle + SpatialIndex Contract v0.1` in Drive is the current contract authority for those two fixes until a versioned repo schema/ADR replaces it.

## End every task with

- **Gjort:** actual implementation/investigation.
- **Bevist:** what is now known from evidence.
- **Endret:** files/decisions/tasks changed.
- **Neste:** single highest-value follow-up.
