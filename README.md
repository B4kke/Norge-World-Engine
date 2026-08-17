# Norge World Engine

A geospatial world-engine project whose long-term target is to treat Norway as the world: real geographic data is normalized and compiled into deterministic, streamable runtime tiles rather than hand-building a fictional map.

## Current proof target

**Prototype 0: Nannestad, 1 × 1 km.** A coordinate should reproducibly produce a scene with georeferenced terrain, primary roads, building volumes, provenance, cacheable artifacts and a measurable viewer.

The project deliberately separates:

- geographic/geometric correctness from photorealism;
- source geodata from runtime artifacts;
- preprocessing/world compilation from rendering;
- static world content from dynamic simulation state;
- experimental prototypes from production-direction engine modules.

## Working model from 2026-08-17

**GitHub is the canonical work surface for code, tests, schemas, CI, issues and implementation history.** Google Drive remains the long-form project memory for research notes, source reviews and historical agent handoffs. Historical Drive instructions that say “Drive-first” are superseded for new implementation work.

Do not upload new source code to Drive as the primary copy. Do not put raw Norwegian geodata, generated tiles or caches in Git.

## Repository map

```text
apps/                    User-facing/runtime applications
  world-viewer/          Browser viewer
  control-web/           Future control/inspection UI
  unreal-runtime/        Evaluation boundary only; no engine lock-in
engine/                  Production-direction modules
  geo/                    CRS, coordinates, tiling and spatial rules
  compiler/               Raw -> normalized -> compiled world artifacts
  schemas/                Versioned interchange/runtime contracts
  streaming/              Tile loading, cache, LOD and observability
  simulation/             Future deterministic simulation foundation
tools/                    Reproducible developer/data verification tools
prototypes/nannestad/     Historical and active Nannestad experiments
  compiler/
  runtime/
  viewer/
tests/fixtures/           Small deterministic proof/fixture data
docs/                     Repo-native decisions, roadmap, worklog and queue
data/                     README only; raw/generated data stays untracked
```

## Important status

The latest Drive architecture contract (`02.7 – RuntimeVerificationBundle + SpatialIndex Contract v0.1`) defines RFC 8785/JCS + SHA-256 provenance reconstruction and requires actual polygon geometry for GeoRSS polygon selection. The migrated SMIA v0.2 and VEKTOR v0.3 files predate those fixes and are therefore kept under `prototypes/`, not `engine/`.

Three P0 gates matter next:

1. implement exact polygon selection + adversarial regression in SMIA;
2. implement runtime reconstruction of provenance hashes + forged-lineage regression in VEKTOR;
3. materialize the real DTM1 Nannestad vertical: production entry -> raw GeoTIFF hash/metadata -> deterministic 1 km clip -> persisted `REAL_COMPILED` artifact and cold/warm cache evidence.

See [`docs/06-task-queue.md`](docs/06-task-queue.md).

## Baseline checks

```bash
python -m pip install -r requirements-dev.txt
python -m py_compile tools/geo/verify_nannestad_source_contracts.py
python tools/geo/verify_nannestad_source_contracts.py --output /tmp/nwe-source-proof.json

cd prototypes/nannestad/compiler
python -m py_compile dtm1_atom_adapter_v02.py test_dtm1_atom_adapter_v02.py
python test_dtm1_atom_adapter_v02.py

cd ../runtime
node --check vektor_runtime_gate_v03.mjs
node --check test_vektor_runtime_gate_v03.mjs
node test_vektor_runtime_gate_v03.mjs
```

Passing the migrated legacy tests does **not** close the two known SENTINEL regressions above. Those need new negative tests before code is promoted from `prototypes/` to `engine/`.

## Contribution rule

Make small reversible changes on branches/PRs. A change is not “done” without a test, benchmark, source verification or other concrete evidence appropriate to the task. Update the repo worklog/task queue when project status changes.
