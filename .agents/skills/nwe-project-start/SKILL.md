---
name: nwe-project-start
description: Enforces Norge World Engine task startup, priority selection, validation and handoff. Use for every implementation, research, architecture, benchmark or repository task in this project.
---

# NWE Project Start

Bruk denne først i hver arbeidsøkt.

## 1. Last prosjektstatus

Les i denne rekkefølgen:

1. `README.md`
2. `docs/03-roadmap.md`
3. `docs/04-decisions.md`
4. `docs/05-worklog.md`
5. `docs/06-task-queue.md`
6. relevante kilde-/schema-/arkitekturfiler for oppgaven

Ikke start fra modellhukommelse hvis repoet har nyere status.

## 2. Velg arbeid som flytter grunnmotoren

Prioriter høyest uløste P0 som kan bevises i denne økten. Unngå rendererpynt, sidefeatures og AI/media hvis compiler/streaming/world-kontrakter fortsatt er blokkert.

Hvis oppgaven er bred, velg selv den mest verdifulle reversible delen. Ikke stopp for små avklaringer.

## 3. Verifiser bevegelige fakta

Aktiver `source-driven-development` når utfallet avhenger av versjoner, API-er, standarder, lisenser, norske geodatakilder eller andre forhold som kan ha endret seg.

For geodata aktiver også `nwe-geodata-contracts` og `gdal`.

## 4. Definer leveransen før du bygger

Leveransen skal være konkret, for eksempel:
- implementert adapter/pipeline
- test eller benchmark
- persisted artifact + manifest
- beslutningsnotat med bevis
- kildekontrakt med faktisk sample

Ren idémyldring er ikke et ferdig resultat når noe kan implementeres eller måles.

## 5. Gjennomfør små og reversible endringer

- produksjonsretning i modulær repo-struktur
- eksperimenter i `prototypes/`
- ingen store rådata i git
- ingen credentials
- ikke slett fungerende arbeid uten bevis for at erstatningen er bedre

## 6. Valider

Kjør relevante tester/build/lint/benchmark. For data/arkitektur, valider minst én faktisk kilde/sample/artefakt.

En plausibel visualisering er ikke bevis.

## 7. Oppdater prosjektminnet

Oppdater minst `docs/05-worklog.md` og `docs/06-task-queue.md`. Oppdater `docs/04-decisions.md` bare når en beslutning faktisk er tatt eller en arbeidskontrakt er formelt endret.

Avslutt med:
- **Gjort**
- **Bevist**
- **Endret**
- **Neste**
