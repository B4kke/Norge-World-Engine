---
name: nwe-quality-gates
description: Enforces evidence-first testing, determinism, observability and adversarial QA for NWE compiler, streaming, source adapters, schemas and performance-sensitive code.
---

# NWE Quality Gates

Separate FACT, ASSUMPTION and EXPERIMENT. Viewer appearance cannot upgrade an assumption to fact.

Before implementation define concrete observables: hashes, bytes, feature counts, cache hit/miss, compile/decode/upload time, frame time or memory as appropriate. Prefer negative tests at dangerous boundaries: corrupt format, unknown CRS/datum, sentinel Z, mismatched digest/size, forged lineage, bbox false positives and promotion gate failure.

Fail closed for unknown CRS, unknown vertical datum on authoritative Z, invalid file signature, missing hashes, invalid lineage or failed promotion. Fallback may render only when status/provenance remains visibly non-authoritative.

Before closing a P0 gate, try to disprove the strongest claim with a cheap adversarial regression. Optimize only after measurement.
