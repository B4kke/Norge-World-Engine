---
name: nwe-quality-gates
description: Enforces evidence-first testing, determinism, observability and adversarial QA for Norge World Engine. Use when implementing or reviewing compiler, streaming, rendering, source adapters, caches, schemas or performance-sensitive code.
---

# NWE Quality Gates

Målet er å gjøre feil synlige tidlig og å skille bevis fra plausibilitet.

## Klassifiser påstander

For ikke-trivielle endringer, merk mentalt eller i notater:
- **FACT** — bevist av kode/test/primær kilde/sample
- **ASSUMPTION** — nødvendig arbeidshypotese som ennå ikke er bevist
- **EXPERIMENT** — resultat gjelder bare testoppsettet

Ikke oppgrader ASSUMPTION til FACT fordi en viewer ser riktig ut.

## Før implementasjon

Definer 2–5 konkrete observables/akseptansekriterier. Eksempler:
- source fetch bytes/time
- SHA-256
- feature count
- tile/artifact bytes
- cache hit/miss
- compile time
- decode/upload time
- frame time/FPS/draw calls

Telemetry uten spørsmål er støy.

## Test gates

For compiler/data-kode prioriter:
- unit tests for canonicalization, IDs og transforms
- fixture tests for parser/schema boundaries
- round-trip/tolerance tests for CRS
- corrupt/wrong-format/sentinel-Z negative tests
- determinism tests: to runs, samme input/config, samme hash
- cold/warm cache tests

En happy-path test alene er ikke nok når grensen kan feile farlig.

## Fail closed

Følgende skal ikke silently degraderes til «ekte» data:
- ukjent CRS
- ukjent vertikaldatum for autoritativ Z
- feil MIME/file signature
- manglende source hash
- manglende artifact hash
- invalid lineage
- promotion gate failure

Fallback kan vises i viewer, men status/provenance skal gjøre den tydelig ikke-autoritativ.

## Adversarial pass

Før du erklærer en P0-gate ferdig, forsøk å motbevise egen konklusjon:
1. Hva er den sterkeste påstanden?
2. Hvilket bevis støtter den?
3. Hvilken alternativ forklaring passer samme observasjon?
4. Hvilken billig test kan skille dem?
5. Kjør testen hvis praktisk.

## Performance

Optimaliser etter måling. Ikke anta at mest detaljert data eller GPU-løsning er best. Rapporter minst relevant CPU/GPU/minne/network/disk/cache/tile-latency når oppgaven berører dem.

## Review exit

En endring er klar når:
- tester/gates er navngitt og kjørt
- relevante failures er fail-visible
- metrics finnes der drift/debug krever dem
- dokumentasjon/status er oppdatert
- gjenstående antakelser er eksplisitte
