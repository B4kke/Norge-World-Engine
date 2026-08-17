# Task queue

## P0 — nå

### P0-REALDATA-01 — ekte DTM1 raw → compiled terrain
**Status:** høyest prioritet.

Akseptanse:
- faktisk Kartverket DTM1 bulk/native source snapshot for Nannestad
- raw SHA-256 + kildeidentitet/metadata
- deterministisk 1 km clip/normalisering
- persisted normalized + compiled artifact
- artifact hash + bytes + media/schema-identitet
- compile lineage til source snapshot, transform, compiler version/config
- automatisk promotion gate
- cold/warm cache-bevis

### P0-COMPILER-ADAPTERS
**Status:** neste etter terrengvertikalen.

- NVDB V4 adapter med eksplisitt source CRS/Z-semantikk
- building adapter med capability/fallback + provenance
- DTM/DOM adapter uten browser source-of-truth

### P0-DETERMINISM-CACHE
**Status:** delvis kontrakt, mangler ekte data-bevis.

- stabil tile-ID
- raw / normalized / compiled cache
- identiske input snapshots/config gir identisk output/hash

### P0-VIEWER-ARTIFACT-CONSUMER
**Status:** venter på persisted compiled terrain.

- ingen rå API-kontakt
- hash-verifisering før decode
- lokal-origin/rebasing
- runtime metrics

## Ikke trekk inn ennå

- agent-browser skill som fast prosjektavhengighet
- Cesium skills
- Unreal skills
- NPC/AI/media-skills

Aktiver disse først når oppgaven de løser faktisk er P0/P1 og kan benchmarkes.
