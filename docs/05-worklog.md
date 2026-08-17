# Worklog

## 2026-08-17 — agent skill/bootstrap

**Gjort:** Flyttet operativt prosjektfundament inn i GitHub; etablerte repo-lokale Agent Skills, agentinstruksjoner, minimal roadmap/decisions/task queue og CI-validering for skill-formatet. Vendoret kun to eksterne skills som treffer dagens P0 direkte: GDAL og source-driven-development.

**Bevist:** Repoet har nå en struktur som kan utvikles via branches/PR/CI i stedet for enkeltstående HTML-filer. Skill-stacken kan valideres maskinelt og er avgrenset mot World Compiler/geodata/reliability i stedet for premature renderer/AI-skills.

**Endret:** `README.md`, `AGENTS.md`, `docs/`, `.agents/skills/`, `scripts/`, `.github/workflows/` og `THIRD_PARTY_NOTICES.md`.

**Neste:** Implementer P0-REALDATA-01 som faktisk kode under `services/world-compiler/` eller `prototypes/` etter repoets modulære prinsipper: autoritativ DTM1 source snapshot → hash → normalisert 1 km clip → persisted artifact + lineage + cachebevis.
