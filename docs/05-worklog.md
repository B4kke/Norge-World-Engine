# Worklog

## 2026-08-17 — agent skill/bootstrap

**Gjort:** Flyttet operativt prosjektfundament inn i GitHub; etablerte repo-lokale Agent Skills, agentinstruksjoner, minimal roadmap/decisions/task queue og CI-validering for skill-formatet. Vendoret kun to eksterne skills som treffer dagens P0 direkte: GDAL og source-driven-development.

**Bevist:** Repoet har nå en struktur som kan utvikles via branches/PR/CI i stedet for enkeltstående HTML-filer. Skill-stacken er avgrenset mot World Compiler/geodata/reliability i stedet for premature renderer/AI-skills. Lokal strukturell validering av de 7 `SKILL.md`-filene passerer frontmatter/name/description-gatene.

**CI-status:** GitHub registrerer `Validate Agent Skills`-workflowen, men hosted runner startet ikke. Check-annotasjonen oppgir at Actions er blokkert av kontoens betalings-/spending-limit-status. Ingen workflow-steps ble kjørt, så dette er verken validator-PASS eller validator-FAIL. Re-run CI etter at GitHub billing/Actions-tilgang er rettet.

**Endret:** `README.md`, `AGENTS.md`, `docs/`, `.agents/skills/`, `scripts/`, `.github/workflows/` og `THIRD_PARTY_NOTICES.md`.

**Neste:** Implementer P0-REALDATA-01 som faktisk kode under `services/world-compiler/` eller `prototypes/` etter repoets modulære prinsipper: autoritativ DTM1 source snapshot → hash → normalisert 1 km clip → persisted artifact + lineage + cachebevis. GitHub Actions-billing er en separat infra-blokkering som bør rettes før CI brukes som merge-gate, men den skal ikke erstatte World Compiler-arbeidet som høyeste tekniske prioritet.
