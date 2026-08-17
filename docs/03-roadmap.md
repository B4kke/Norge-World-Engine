# Roadmap

Statussnapshot: 2026-08-17. Dette er den operative GitHub-kopien av gjeldende prosjektretning; historiske detaljer ligger fortsatt i Google Drive-trackloggen.

## P0 — grunnmotor

1. **Repo- og agentfundament**
   - repo-lokale skills
   - arbeidslogg, beslutninger og task queue
   - CI-validering av skill-kontrakter

2. **P0-REALDATA-01 — autoritativ terrengvertikal**
   - hent faktisk Kartverket DTM1 bulk/native source snapshot for Nannestad
   - full raw SHA-256 + source metadata
   - deterministisk 1 km clip/normalisering til Prototype 0-kontrakten
   - persistér normalized snapshot og compiled terrain artifact
   - bind lineage og promotion til kilde, transform, compiler-versjon og config
   - bevis cold/warm cache

3. **Source adapters**
   - Kartverket DTM/DOM
   - NVDB V4 bbox/segment adapter
   - building adapter med eksplisitt capability/fallback og provenance

4. **Deterministisk tile/cache**
   - stabil tile-ID uavhengig av runtime-origin
   - separate raw / normalized / compiled cachelag
   - byte-/hash-determinisme for identisk snapshot/config

5. **Målbar viewer**
   - konsumer kun compiled artifacts via manifest
   - mål fetch/hash/decode/GPU upload, frame time/FPS, draw calls og minne der mulig

## P1 — etter bevist Prototype 0

- material-/fasaderegler
- vegetasjon og instancing
- vegmarkering/skilt/rekkverk/lys
- representative kjøretøy og props
- motor-/renderer-spikes mot samme runtime-artifacts

## Ikke prioriter før P0 er bevist

- NPC/LLM/TTS
- avansert trafikk og skadefysikk
- fotorealistisk generativ media
- landsdekkende prebygging
- premature Cesium/Unreal/renderer-låsinger
