# Norge World Engine

A geospatial world-engine project whose long-term target is to treat Norway as the world: real geographic data is normalized and compiled into deterministic, streamable runtime artifacts rather than hand-building a fictional map.

## Current proof target

**Nannestad 1×1 km in the WebUI.** The immediate product target is a freely navigable, ground-level browser slice that is geographically correct first and as visually realistic as the admitted data and web performance budget allow.

The accepted single-tile world data is sufficient for this milestone. Whole-Norway/multi-tile source, LOD and scaling work remains important but does not block the active 1×1 km realism slice.

Geographic/geometric correctness and photorealism remain separate goals. Raw geodata, canonical world data, runtime artifacts, rendering and dynamic simulation remain separate layers.

## Renderer / engine direction

`apps/world-viewer` is again an **active product and acceptance surface** for the Nannestad 1×1 km milestone. Three.js remains the web presentation adapter with WebGPU-first capability where available and WebGL2 fallback/baseline. Unreal Engine 5.8 continues in parallel under `apps/unreal-runtime`; it consumes the same engine-neutral NWE artifacts and is not a second Norwegian data pipeline.

The explicit 2026-10-08 product priority is WebUI realism now. This does not discard the Unreal work or change world truth. Renderer-specific objects, materials, proxies and shaders stay presentation-only.

## Current evidence state — 2026-10-08

The 1×1 km Nannestad world already has a proven real-data foundation:

- Kartverket DTM1 terrain normalized to EPSG:25832 / NN2000;
- accepted NVDB road centerlines plus source-backed NVDB road-width/surface enrichment where available;
- accepted OSM building footprints plus guarded NHM DOM−DTM height enrichment and conservative strong roof-direction candidates;
- NIBIO SR16V + AR50 representative vegetation semantics;
- pinned local CC0 PBR surfaces and a redistribution-admitted Sentinel-2 10 m macro ground-color layer;
- source-backed NVDB street-detail candidate covering road markings, signs, lighting, ditches, kerbs and related roadside objects where explicit provider geometry exists;
- Float64 authoritative movement, DTM grounding and freely navigable first-person web controls;
- runtime provenance verification and zero raw Norwegian source acquisition in the normal browser runtime.

Presentation fallbacks remain explicit. DOM-derived height is not surveyed building geometry; fitted roof direction is not FKB roof truth; SR16V representative points are not observed individual trees; generic sign plates, missing widths and proxy vegetation are renderer presentation, not source truth.

Important open gates remain:

- exact hosted visual acceptance of the latest WebUI head;
- higher-fidelity near-field vegetation/facades without inventing geographic truth;
- richer admitted sign/roadside semantics where NVDB relations expose them;
- real neighboring DTM1 terrain seam/source-family authority for larger-than-1×1 km worlds;
- larger-world streaming/LOD/budgets and whole-Norway coordinate/indexing policy;
- UE 5.8 Windows compile/play/package evidence remains a parallel engine-portability gate.

## Working model

**GitHub is the canonical work surface for code, tests, schemas, CI, issues, implementation history and tasks.** Google Drive remains long-form research/history/reference. Do not put raw Norwegian geodata, generated source caches, credentials or proprietary datasets in Git. Replaceable compiled preview/runtime snapshots may live on dedicated transport branches with explicit provenance and licensing.

## Repository map

```text
.agents/skills/             Repo-local NWE operating skills
.agents/roles/              Five Agent v2 ownership charters
apps/world-viewer/          Active Nannestad WebUI / browser acceptance surface
apps/unreal-runtime/        Parallel UE 5.8 adapter/game runtime
engine/compiler/            Raw -> normalized -> compiled world artifacts
engine/geo/                 CRS, coordinates, tiling and spatial rules
engine/schemas/             Versioned interchange/runtime contracts
engine/streaming/           Provenance, tile lifecycle, cache/workers/observability
engine/simulation/          Future deterministic simulation foundation
tools/                      Data verification and runtime packaging tools
prototypes/                 Isolated/historical experiments
tests/fixtures/             Small deterministic proof fixtures
docs/                       Decisions, roadmap, worklog, proofs, queue and testing policy
data/                       README only; raw/generated source data stays untracked
```

## Compiler and runtime foundation

NWE reuses mature generic libraries instead of maintaining custom replacements: Rasterio/GDAL for raster I/O/transforms, pyproj/PROJ for CRS transforms, Shapely for topology/predicates, RFC 8785 implementations for canonical provenance hashing and Three.js/Unreal only at presentation/runtime adapter boundaries.

`engine/streaming/runtime_verifier_core.mjs` holds shared provenance semantics. Normal runtime consumes verified compiled artifacts and derived runtime layers; it does not contact Kartverket/NVDB/OSM/NIBIO raw source endpoints.

## Agent v2

Every task starts with `AGENTS.md` and `.agents/skills/nwe-project-start/SKILL.md`.

- **LUMEN** — active WebUI renderer/visual quality plus parallel Unreal presentation adapter work.
- **STRØM** — verified runtime streaming, scheduler/cache/workers.
- **FORGE** — real-data acquisition, normalization, compiler and multi-source promotion.
- **ATLAS** — world/entity coordinates, render origin and simulation-facing world contract.
- **SENTINEL** — integration, schemas, adversarial QA, CI and claim calibration.

Validate repo-local skills with:

```bash
python scripts/validate_agent_skills.py
```

## Baseline checks

Run the narrow checks relevant to the active task, then repository CI before handoff.

```bash
python scripts/validate_agent_skills.py
pytest -q engine/compiler/tests
node engine/streaming/test_runtime_verifier.mjs
npm run build --workspace @nwe/world-viewer
```

See `docs/06-task-queue.md` for the current priority. Do not use this README as a substitute for the task queue when statuses diverge.
