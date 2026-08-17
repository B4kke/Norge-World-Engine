# Agent Skills i Norge World Engine

## Mål

Skill-stacken skal gjøre agentarbeid mer etterprøvbart, ikke bare tilføre flere prompts. Vi holder antallet lite for å unngå trigger-/kontekststøy.

Kanonisk prosjektsti er `.agents/skills/`. Agent Skills-formatet består av en `SKILL.md` og kan ha `scripts/`, `references/` og `assets/`.

## Aktiv stack v0.1

### Prosjektspesifikke

- `nwe-project-start` — obligatorisk start/handoff og prioritering
- `nwe-geodata-contracts` — CRS, høyde, kilde, lisens og sample-gates
- `nwe-world-compiler` — raw/normalized/compiled, cache, lineage og promotion
- `nwe-quality-gates` — tester, determinisme, observability og skeptisk QA
- `nwe-github-workflow` — branch/PR/CI/prosjektminne

### Vendored upstream

- `gdal` fra `isaaccorley/geospatial-skills`, pin `a203446cb997cd1dbf054918b1021a6040b69824` (Apache-2.0)
- `source-driven-development` fra `addyosmani/agent-skills`, pin `df1edb2e05487d0aa6d93c747141e0aed1187f25` (MIT)

Se `THIRD_PARTY_NOTICES.md`.

## Hvorfor ikke flere nå?

Viewer/browser, Cesium og Unreal er relevante senere, men dagens kritiske flaskehals er autoritativ geodata → deterministisk World Compiler. Skills som ikke forbedrer den kjeden får vente til oppgaven faktisk blir prioritert.

## Agentkompatibilitet

`.agents/skills/` er prosjektsti for flere klienter i det åpne skills-økosystemet, blant annet Codex, Cursor og GitHub Copilot. Klienter som bruker en annen prosjektsti kan installere/linke samme repo-skills med skills CLI, for eksempel:

```bash
npx skills add . --list
npx skills add . -a claude-code -y
```

Ikke installer alle offentlige skills globalt. Repo-lokale, reviewede og pinnede skills er standarden her.

## Validering

Kjør:

```bash
python scripts/validate_agent_skills.py
```

GitHub Actions kjører samme validering på pushes og pull requests.

Når en skill endres skal agenten kontrollere at:
- `name` matcher mappen
- `description` forklarer både hva og når
- skillen ikke dupliserer en annen skill unødvendig
- scripts/references faktisk brukes
- eksterne kopier beholder pin + lisensnotis
