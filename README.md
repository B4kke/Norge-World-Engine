# Norge World Engine

A geospatial world-engine project whose long-term target is to treat Norway as the world: real geographic data is normalized and compiled into deterministic, streamable runtime artifacts rather than hand-building a fictional map.

## Current proof target

**Prototype 0: Nannestad.** Build a reproducible vertical slice that proves real terrain, roads and building geometry can move from authoritative source snapshots through deterministic compilation/provenance into a measurable browser runtime.

Geographic/geometric correctness and photorealism are separate goals. Raw geodata, canonical world data, runtime artifacts, rendering and dynamic simulation are separate layers.

## Current evidence state — 2026-08-18

The single-tile Nannestad vertical is no longer source/terrain-blocked: accepted real DTM1 terrain plus NVDB road and OSM building artifacts have deterministic cold/offline proof and pass runtime verification. Browser full-graph provenance, vector batching, renderer-neutral tile scheduling and an actual browser module DedicatedWorker terrain path are also proven.

Important open P0 gates remain:
- real neighboring DTM1 terrain is fail-closed until an evidence-backed overlap/seam transform exists;
- exact-real browser/Android movement and performance evidence is still needed before worker/cache/LOD/backend policy is selected;
- whole-Norway coordinate/indexing/render-origin policy remains open;
- final WebGPU/WebGL/Cesium/3D Tiles/Unreal roles remain evidence-driven.

`apps/world-viewer` is the deployable Vite/Vercel measurement shell. Its existence does not select the final renderer.

## Working model

**GitHub is the canonical work surface for code, tests, schemas, CI, issues, implementation history and tasks.** Google Drive remains long-form research/history/reference. Do not put raw Norwegian geodata, generated tiles/caches, credentials or proprietary datasets in Git.

## Repository map

```text
.agents/skills/             Repo-local NWE operating skills
.agents/roles/              Five Agent v2 ownership charters
apps/world-viewer/          Deployable browser measurement/viewer surface
engine/compiler/            Raw -> normalized -> compiled world artifacts
engine/geo/                 CRS, coordinates, tiling and spatial rules
engine/schemas/             Versioned interchange/runtime contracts
engine/streaming/           Provenance, tile lifecycle, cache/workers/observability
engine/simulation/          Future deterministic simulation foundation
tools/                      Data verification and runtime packaging tools
prototypes/                 Isolated/historical experiments, including Cesium baseline
tests/fixtures/             Small deterministic proof fixtures
docs/                       Decisions, roadmap, worklog, proofs and queue
data/                       README only; raw/generated data stays untracked
```

## Compiler and runtime foundation

NWE reuses mature generic libraries instead of maintaining custom replacements: Rasterio/GDAL for raster I/O/transforms, pyproj/PROJ for CRS transforms, Shapely for topology/predicates, RFC 8785 implementations for canonical provenance hashing, glTF-Transform/meshoptimizer for render-asset experiments and CesiumGS validation/tools for the 3D Tiles spike.

`engine/streaming/runtime_verifier_core.mjs` holds shared provenance semantics; Node and browser adapters reconstruct the versioned provenance graph and verify compiled artifact bytes before runtime use. Normal runtime does not contact Kartverket/NVDB/OSM raw source endpoints.

## Agent v2

Every task starts with `AGENTS.md` and `.agents/skills/nwe-project-start/SKILL.md`. Five parallel roles divide ownership:

- **LUMEN** — renderer/WebGPU-WebGL experiments, browser metrics and Vercel Preview.
- **STRØM** — verified runtime streaming, scheduler/cache/workers.
- **FORGE** — real-data acquisition, normalization, compiler and multi-source promotion.
- **ATLAS** — world coordinates, render origin and simulation-facing world contract.
- **SENTINEL** — integration, schemas, adversarial QA, CI and claim calibration.

Skills remain reusable capabilities; role charters live in `.agents/roles/`. Validate skill structure with:

```bash
python scripts/validate_agent_skills.py
```

## Baseline checks

Run the narrow checks relevant to the active task, then the repository baseline/CI before handoff. Node workspace and browser checks require installed dependencies.

```bash
python scripts/validate_agent_skills.py
pytest -q engine/compiler/tests
node engine/streaming/test_runtime_verifier.mjs
```

See `docs/06-task-queue.md` for the current evidence-driven priority. Do not use this README as a substitute for the task queue when statuses diverge.
