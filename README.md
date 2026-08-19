# Norge World Engine

A geospatial world-engine project whose long-term target is to treat Norway as the world: real geographic data is normalized and compiled into deterministic, streamable runtime artifacts rather than hand-building a fictional map.

## Current proof target

**Walkable Nannestad.** The immediate goal is a ground-level, human-scale playable vertical slice: real terrain, road surfaces, building meshes, materials/shaders and a movable humanoid asset in the normal browser runtime.

The accepted single-tile world data is sufficient for this milestone. Whole-Norway/multi-tile source, LOD and scaling work remains important but does not block the first playable slice.

Geographic/geometric correctness and photorealism are separate goals. Raw geodata, canonical world data, runtime artifacts, rendering and dynamic simulation are separate layers.

## Renderer / engine direction

Three.js is the working web renderer for the active ground-level milestone, with a WebGPU-first capability path where a genuine adapter is available and WebGL2 fallback/baseline. This is a product/architecture direction, not a claim that Three.js is benchmarked superior for every workload.

Three.js owns presentation only. Compiler output, authoritative coordinates/world state, tile/entity identity, provenance, streaming decisions and future simulation state remain renderer-neutral. Future Unreal Engine support is expected to consume the same compiled world/runtime contracts through an adapter/importer rather than introducing a second Norwegian data pipeline. See D-008 and `docs/08-revised-engine-chain.md`.

## Current evidence state — 2026-08-19

The single-tile Nannestad vertical is no longer source/terrain-blocked: accepted real DTM1 terrain plus NVDB road and OSM building artifacts have deterministic cold/offline proof and pass runtime verification. Browser full-graph provenance, vector batching, renderer-neutral tile scheduling, an actual browser module DedicatedWorker terrain path, and exact-real hosted Chrome movement/cache + terrain-resource lifecycle are proven.

Important open larger-world gates remain:
- real neighboring DTM1 terrain seam/source-family authority remains fail-closed in current canonical evidence;
- larger-world streaming, cache/resource budgets and LOD remain evidence-driven;
- whole-Norway coordinate/indexing/render-origin policy remains open;
- exact Unreal importer architecture and production imagery/physics choices remain open.

Physical Android/mobile testing is **not** a routine per-change gate. It is an occasional milestone/device-specific validation step under `docs/07-testing-policy.md`; normal engine progress should rely on automated CI, exact-artifact browser tests and reproducible benchmarks without repeatedly requiring user-operated handset tests.

`apps/world-viewer` is now the deployable playable/measurement surface for the Three.js working direction while remaining an artifact consumer rather than a source-data compiler.

## Working model

**GitHub is the canonical work surface for code, tests, schemas, CI, issues, implementation history and tasks.** Google Drive remains long-form research/history/reference. Do not put raw Norwegian geodata, generated tiles/caches, credentials or proprietary datasets in Git.

## Repository map

```text
.agents/skills/             Repo-local NWE operating skills
.agents/roles/              Five Agent v2 ownership charters
apps/world-viewer/          Deployable playable/measurement web surface
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

- **LUMEN** — Three.js renderer/WebGPU-WebGL path, ground-level graphics, browser metrics and Vercel Preview.
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
node engine/streaming/test_runtime_verifier.mjs
```

See `docs/06-task-queue.md` for the current priority. Do not use this README as a substitute for the task queue when statuses diverge.