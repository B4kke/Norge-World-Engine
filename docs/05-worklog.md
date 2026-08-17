# 05 — Worklog

Append concise implementation handoffs here. Historical detailed agent logs remain in Google Drive.

## 2026-08-17 — GitHub bootstrap / Drive migration

**Gjort**
- Established a GitHub-oriented monorepo layout separating `engine/`, `apps/`, `tools/`, `prototypes/`, `tests/`, `docs/` and untracked data/caches.
- Migrated the current lightweight implementation/proof artifacts from Drive: source-contract verifier, SMIA Atom adapter v0.2, VEKTOR runtime gate v0.3, fixtures and proof JSON.
- Kept known-defective SMIA/VEKTOR implementations in `prototypes/`; they are not represented as production-ready engine code.
- Added baseline CI and explicit Git/data hygiene rules.
- Left the two large one-file Nannestad viewer HTML harnesses (Forsøk 6/7) as historical Drive artifacts during the connector bootstrap; they are not required by CI or the next P0 tasks.

**Bevist**
- Drive status through ATLAS-04 was reconciled before migration. `02.7` closes the prior SENTINEL findings at contract/test-spec level, but implementation remains incomplete.
- P0 real-data terrain remains blocked: no production DTM1 Nannestad raw -> normalized -> persisted `REAL_COMPILED` vertical is yet proven.

**Endret**
- Repository bootstrap files and migration snapshot created.
- Work policy changed from historical Drive-first implementation to GitHub-first implementation.

**Neste**
- Implement the two ATLAS-04 regressions (polygon geometry + runtime lineage reconstruction), then execute the authoritative DTM1 real-data vertical.
