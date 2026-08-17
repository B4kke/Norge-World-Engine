---
name: nwe-world-compiler
description: Guides deterministic Norge World Engine preprocessing from raw source snapshots through normalized data to runtime artifacts with cache, lineage and promotion gates. Use when implementing source adapters, tiling, terrain/road/building compilation, manifests, hashes or compiler caches.
---

# NWE World Compiler

World Compiler er en datakompilator, ikke en viewer-helper.

## Execution boundary

Autoritativ acquisition, hashing, normalization, clipping, compilation, cache og promotion skal kjøre i lokal/native eller server-side preprocessing. Browseren kan konsumere og måle output, men skal ikke eie source-of-truth.

## Tre lag som aldri skal blandes

1. **Raw SourceSnapshot** — originale bytes + request/retrieval identity + metadata + source hash.
2. **NormalizedSnapshot** — deterministisk transformert/klippet data i prosjektkontrakten.
3. **Compiled Artifact** — runtime-optimalisert output som viewer/runtime kan konsumere uten råkildekontakt.

Hvert lag har eget cacheområde og egne hashes.

## Identitet og determinisme

Tile/world identity skal avledes fra kanonisk world/grid-kontrakt, ikke runtime camera origin.

Samme:
- source snapshot
- transform contract
- compiler version
- compiler config

skal gi samme normaliserte/kompilerte bytes eller en eksplisitt dokumentert årsak til avvik.

## Minimum lineage

Før `REAL_COMPILED` skal manifest/promotion kunne binde:

- source snapshot identity + SHA-256
- source CRS, vertical datum og Z semantics der relevant
- transform/clip contract hash
- normalized snapshot hash + bytes/schema
- compiler version
- compiler config hash
- compiled artifact hash + bytes/media/schema identity
- promotion gate results

Bruk canonical serialization for strukturer som hashes; definer canonicalization én gang og test den.

## Promotion

`REAL_COMPILED` er en maskinell status, ikke et visuelt kvalitetsstempel.

Promotion skal feile lukket hvis:
- source bytes/hash mangler
- source format/CRS/Z gate feiler
- transform/clip ikke kan spores
- output hash/bytes mangler
- compiler version/config mangler
- determinismegate som kreves av artefakttypen feiler

## Cache

Skill mellom:
- raw cache: nedlastede source bytes
- normalized cache: reprojisert/klippet canonical data
- compiled cache: runtime artifacts

En warm run skal dokumentere hvilke steg som var cache hits og hvilke tider som faktisk ble spart.

## Prototype 0 acceptance

Nannestad-vertikalen er ikke ferdig før én ekte DTM1 source snapshot kan gå hele kjeden til persisted compiled terrain artifact, med lineage og cold/warm cache-bevis.

## Artifact hash helper

```bash
python .agents/skills/nwe-world-compiler/scripts/hash_artifact.py path/to/artifact
```

Runtime/viewer skal verifisere artifact identity/hash før den stoler på bytesene.
