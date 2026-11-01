# Norge World Engine

A geospatial world-engine project whose long-term target is to treat Norway as the world: real geographic data is normalized and compiled into deterministic, streamable runtime artifacts rather than hand-building a fictional map.

## Current proof target

**Nannestad in Unreal Engine 5.8.** The immediate goal is a Windows-PC,
third-person vertical slice: real terrain, road surfaces, building geometry,
realistic presentation and a human character at ground level.

The accepted single-tile world data is sufficient for this milestone. Whole-Norway/multi-tile source, LOD and scaling work remains important but does not block the first playable slice.

Geographic/geometric correctness and photorealism are separate goals. Raw geodata, canonical world data, runtime artifacts, rendering and dynamic simulation are separate layers.

## Renderer / engine direction

Unreal Engine 5.8 is the active game runtime. The existing Three.js viewer remains
a useful historical/reference consumer, but it is no longer the product runtime.
Unreal consumes the same verified, engine-neutral NWE artifacts through
`apps/unreal-runtime`; it does not introduce a second Norwegian data pipeline.
See D-009 and `docs/09-unreal-game-plan.md`.

## Current evidence state — 2026-09-04

The first 1 × 1 km Unreal slice is data-ready. Its pinned real DTM1 terrain,
NVDB road centerlines and OSM building footprints pass the canonical NWE
provenance verifier and derive deterministically into a UE Landscape heightmap
plus runtime mesh packets. The UE C++ project, explicit EPSG:25832/NN2000
coordinate adapter, collision bootstrap, third-person character and Open World
level setup are implemented. A shared, hash-verified local CC0 PBR surface
catalog now drives both the web reference renderer and Unreal Editor import;
the web reference also has explicit low/balanced/high/ultra profiles. An actual
Windows UE 5.8 compile/render/packaging pass remains an explicit open gate
because the editor is not available in the repository CI environment.

Important open larger-world gates remain:
- real neighboring DTM1 terrain seam/source-family authority remains fail-closed in current canonical evidence;
- larger-world streaming, cache/resource budgets and LOD remain evidence-driven;
- whole-Norway coordinate/indexing/render-origin policy remains open;
- native Landscape bake, source-backed land-cover/vegetation, UE frame acceptance and exact physics choices remain open.

Physical Android/mobile testing is not part of the active Windows UE milestone.
Normal engine progress uses automated data/converter checks plus explicit UE
Windows build, play, render and packaging gates.

`apps/unreal-runtime` is the active game surface. `apps/world-viewer` is retained
as reference evidence and remains an artifact consumer rather than a source-data compiler.

## Working model

**GitHub is the canonical work surface for code, tests, schemas, CI, issues, implementation history and tasks.** Google Drive remains long-form research/history/reference. Do not put raw Norwegian geodata, generated tiles/caches, credentials or proprietary datasets in Git.

## Repository map

```text
.agents/skills/             Repo-local NWE operating skills
.agents/roles/              Five Agent v2 ownership charters
apps/world-viewer/          Deployable playable/measurement web surface
apps/unreal-runtime/        Active UE 5.8 game, converter and setup automation
engine/compiler/            Raw -> normalized -> compiled world artifacts
engine/geo/                 CRS, coordinates, tiling and spatial rules
engine/schemas/             Versioned interchange/runtime contracts
engine/streaming/           Provenance, tile lifecycle, cache/workers/observability
engine/simulation/          Future deterministic simulation foundation
tools/                      Data verification and runtime packaging tools
prototypes/                 Isolated/historical experiments, including Cesium baseline
tests/fixtures/             Small deterministic proof fixtures
docs/                       Decisions, roadmap, worklog, proofs, queue and testing policy
data/                       README only; raw/generated data stays untracked
```

## Compiler and runtime foundation

NWE reuses mature generic libraries instead of maintaining custom replacements: Rasterio/GDAL for raster I/O/transforms, pyproj/PROJ for CRS transforms, Shapely for topology/predicates, RFC 8785 implementations for canonical provenance hashing, glTF-Transform/meshoptimizer for render-asset experiments and CesiumGS validation/tools for the 3D Tiles/interoperability spike.

`engine/streaming/runtime_verifier_core.mjs` holds shared provenance semantics; Node and browser adapters reconstruct the versioned provenance graph and verify compiled artifact bytes before runtime use. Normal runtime does not contact Kartverket/NVDB/OSM raw source endpoints.

## Agent v2

Every task starts with `AGENTS.md` and `.agents/skills/nwe-project-start/SKILL.md`. Five parallel roles divide ownership:

- **LUMEN** — UE runtime adapter, ground-level rendering, materials, character and Windows game evidence; historical web ownership remains for maintenance.
- **STRØM** — verified runtime streaming, scheduler/cache/workers.
- **FORGE** — real-data acquisition, normalization, compiler and multi-source promotion.
- **ATLAS** — world/entity coordinates, render origin and simulation-facing world contract.
- **SENTINEL** — integration, schemas, adversarial QA, CI and claim calibration.

Skills remain reusable capabilities; role charters live in `.agents/roles/`. Validate skill structure with:

```bash
python scripts/validate_agent_skills.py
```

## Baseline checks

Run the narrow checks relevant to the active task, then the repository baseline/CI before handoff. Node workspace and browser checks require installed dependencies. Physical-device testing follows `docs/07-testing-policy.md` and is not a default baseline requirement.

```bash
python scripts/validate_agent_skills.py
pytest -q engine/compiler/tests
pytest -q apps/unreal-runtime/tests
node engine/streaming/test_runtime_verifier.mjs
```

See `docs/06-task-queue.md` for the current priority. Do not use this README as a substitute for the task queue when statuses diverge.
