---
name: nwe-world-compiler
description: Guides deterministic NWE acquisition, normalization, multi-source tiling and compilation into provenance-bound runtime artifacts with offline/cache and promotion gates.
---

# NWE World Compiler

The compiler is a world-data compiler, not a viewer helper. Keep separate identities for raw `SourceSnapshot`, `TransformContract`, `NormalizedSnapshot`, compiler config/lineage, compiled `ArtifactRef` and promotion record.

Authoritative acquisition, hashing, CRS/datum transforms, clipping/mosaicking, compilation and promotion run in native/local or server-side preprocessing. Browser runtime consumes compiled artifacts and never promotes data.

Use RFC 8785/JCS + SHA-256 for structured lineage. `REAL_COMPILED` requires exact source identity, explicit transform semantics, normalized identity, compiler version/config, artifact digest/size/media type and passing promotion gates. Cold and source-network-free offline runs should be byte-identical for deterministic pipelines.

The accepted Nannestad single-tile DTM1 vertical is a proven Prototype-0 contract, not a whole-Norway format choice. Multi-tile planning may bind plural source snapshots. Where valid sources overlap and disagree, remain fail-closed until an evidence-backed deterministic seam transform is versioned and tested.

Road/building compilation preserves source-backed semantics; unresolved physical road width or building height must remain unresolved in authoritative data rather than being hidden behind visual heuristics.

Use `nwe-geospatial-tooling` for generic spatial operations, `nwe-geodata-contracts` for source authority and `nwe-quality-gates` before promotion. Do not encode WebGPU/WebGL/Cesium-specific geometry assumptions into canonical source/normalized layers.
