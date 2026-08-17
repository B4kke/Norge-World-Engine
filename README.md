# Norge World Engine

Norge World Engine er et langsiktig prosjekt for å bygge en skalerbar digital verden der Norge i størst mulig grad er selve simuleringsverdenen, basert på reelle geodata og en reproducerbar World Compiler-pipeline.

## Status

Repoet er under migrering fra tidlige Google Drive-prototyper til en reell, modulær kodebase. Google Drive inneholder fortsatt historikk og tidligere eksperimenter, mens nye implementasjoner og operative prosjektkontrakter skal leve i GitHub.

Første tekniske mål er Prototype 0: én koordinat i Nannestad skal kunne bli til en deterministisk, motoruavhengig runtime-tile med terreng, veger, bygninger og sporbar provenance uten manuell GIS-redigering.

## Kjerneprinsipper

- rå geodata, normaliserte data og runtime-artefakter holdes adskilt
- World Compiler eier autoritativ innhenting, normalisering, hashing, clipping og promotion
- runtime/viewer konsumerer kompilerte artefakter, ikke rå API-er
- koordinater, høydegrunnlag, dataproveniens og determinisme er eksplisitte kontrakter
- rendering, streaming, simulering, persistence og data pipeline utvikles som separate moduler
- ytelse, cache og observability måles tidlig
- motorvalg holdes åpent til alternativer er testet mot samme data og målekrav
- store rå geodata og hemmeligheter skal ikke committes

## Planlagt modulretning

```text
apps/
  control-web/
  world-viewer/
services/
  world-compiler/
  geodata-gateway/
  simulation-state/
packages/
  geo-schema/
  world-schema/
  cache-manifest/
prototypes/
docs/
.agents/skills/
```

Dette er en retning, ikke en låst motor- eller biblioteksbeslutning.

## Agent Skills

Prosjektets repo-lokale Agent Skills ligger i `.agents/skills/`. De er versjonert sammen med kodebasen og fungerer som operative kvalitetskontrakter for agenter som arbeider i repoet.

Start med `AGENTS.md` og `docs/agent-skills.md`.
