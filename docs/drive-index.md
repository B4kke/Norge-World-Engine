# Google Drive project-memory index

Drive remains long-form project memory. New implementation work should be committed to this repository.

Project root: **Norge World Engine – Emergency Simulator**

## Active Drive documents

Inside the `06 – Beslutninger, risiko og backlog` area there are now only two active top-level documents plus an archive folder:

- **`06.0 – AKTIV AGENTLOGG – Norge World Engine`**  
  Drive ID: `10i2kWmY0hXf95M2c2o-FBSi7sqJz6EChb0Z3UrUCYE4`  
  Purpose: structured active handoff log. Every entry records date, local time/timezone, agent, task ID, What, Why, Result/evidence, Changed and exactly one Next task.

- **`06.1 – AKTIV PLAN – Walkable Nannestad / Three.js / Unreal-ready`**  
  Drive ID: `1oOEjbkNoLp_q1f1uzgC1zNDv9E6de_QWMTANW1zkv0M`  
  Purpose: readable Drive mirror of the active ground-level execution direction and concrete P0-GROUND sequence.

- **`99 – Arkiv – tidligere agentlogger og planer`**  
  Drive folder ID: `1ePcDDl69maoudV_aktHyZBvtC20hID_x`  
  Contains the previous `06.0–06.6` tracklog/backlog/SENTINEL QA/revised-chain documents. They are preserved for history but are not current task authority.

## Key historical/reference documents

- `00 – Prosjektbrief, arkitektur og realiseringsplan`
- `01.1 – Prototype 0 kildekontrakter v0.1`
- `01.2 – KARTOGRAF bulk DTM retrieval contract v0.1`
- `01.3 – KARTOGRAF Atom feed structure + retrieval identity v0.1`
- `01.4 – Asset- og street-level imagery-strategi v0.1`
- `02.1 – World coordinate contract v0.1`
- `02.3 – SourceSnapshot + ArtifactRef contract v0.1`
- `02.5 – CompileProvenance + Promotion Contract v0.1`
- `02.6 – SMIA two-stage Atom adapter v0.2`
- `02.7 – RuntimeVerificationBundle + SpatialIndex Contract v0.1` — historical architecture authority for semantics not yet represented by newer repo schemas/docs.
- `03.3 – VEKTOR compiler-status runtime boundary v0.3`

## Authority rule

GitHub is canonical for current implementation, decisions and task priority. Use `docs/06-task-queue.md` first, then `docs/04-decisions.md` and `docs/08-revised-engine-chain.md`.

Drive copies of old `.py`, `.mjs`, `.json`, prototype HTML, tracklogs and QA cycles are historical reference. If Drive prose and current repository state disagree, the current repo task queue/decision/code plus reviewable commit/PR evidence wins.