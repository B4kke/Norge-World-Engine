# Norge World Engine

A geospatial world-engine project whose long-term target is to treat Norway as the world: real geographic data is normalized and compiled into deterministic, streamable runtime tiles rather than hand-building a fictional map.

## Current proof target

**Prototype 0: Nannestad, 1 × 1 km.** A coordinate should reproducibly produce a scene with georeferenced terrain, primary roads, building volumes, provenance, cacheable artifacts and a measurable viewer.

The project deliberately separates geographic correctness from photorealism, source geodata from runtime artifacts, preprocessing from rendering, static world content from dynamic simulation state, and experiments from production-direction modules.

## Working model from 2026-08-17

**GitHub is the canonical work surface for code, tests, schemas, CI, issues and implementation history.** Google Drive remains long-form research/history/reference. Do not put raw Norwegian geodata, generated tiles/caches, credentials or proprietary datasets in Git.

## Repository map

```text
.agents/skills/          Repo-local AI-agent operating skills
apps/                    User-facing/runtime applications
engine/                  Production-direction modules
  compiler/              Raw -> normalized -> compiled world artifacts
  geo/                    CRS, coordinates, tiling and spatial rules
  schemas/                Versioned interchange/runtime contracts
  streaming/              Tile loading, cache, LOD and observability
  simulation/             Future deterministic simulation foundation
tools/                    Data verification and runtime packaging tools
prototypes/nannestad/     Historical Nannestad experiments
prototypes/cesium-baseline/  3D Tiles/Cesium benchmark only
tests/fixtures/           Small deterministic proof fixtures
docs/                     Decisions, roadmap, worklog and queue
data/                     README only; raw/generated data stays untracked
```

## Compiler foundation

NWE reuses mature generic libraries instead of maintaining custom replacements:

- Rasterio/GDAL for raster I/O and deterministic windows;
- pyproj/PROJ for CRS transforms;
- Shapely for topology/predicates;
- RFC 8785 implementations for canonical provenance hashing;
- glTF-Transform/meshoptimizer for render-asset optimization;
- CesiumGS 3D Tiles validator/tools for the runtime-format spike.

Exact versions are pinned in `engine/compiler/pyproject.toml` and Node workspace `package.json` files. 3D Tiles/CesiumJS remains an experiment, not a selected runtime architecture.

## Repo-local Agent Skills

Start agent work via `.agents/skills/nwe-project-start/SKILL.md`. `AGENTS.md` routes geodata/compiler/tooling/QA/3D-Tiles/GitHub tasks to focused NWE skills. Validate them with:

```bash
python scripts/validate_agent_skills.py
```

## Baseline checks

```bash
python -m pip install -r requirements-dev.txt
python scripts/validate_agent_skills.py
python tools/geo/verify_nannestad_source_contracts.py --output /tmp/nwe-source-proof.json
pytest -q engine/compiler/tests

# Node workspaces require package install/network access.
npm install --workspace @nwe/schemas-js --workspace @nwe/cesium-baseline --include-workspace-root=false
npm run test:schemas
npm run build:cesium-baseline
```

Legacy SMIA/VEKTOR files remain under `prototypes/` where their known historical defects can be reproduced. Corrected production-direction GeoRSS geometry is under `engine/compiler`; full runtime lineage reconstruction remains open.

## Highest-value next work

1. Complete VEKTOR RFC 8785/SHA-256 lineage reconstruction and forged-lineage rejection.
2. Materialize the production DTM1 Nannestad source: raw 15 km GeoTIFF -> hash/metadata -> deterministic 1 km normalized clip -> persisted lineage-bound compiled artifact/cache.
3. Only after the same compiled render artifact exists, validate/package it and compare the CesiumJS 3D Tiles baseline against the custom viewer on the same device/data.

See [`docs/06-task-queue.md`](docs/06-task-queue.md).
