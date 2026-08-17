---
name: nwe-world-compiler
description: Guides deterministic NWE preprocessing from raw source snapshots through normalized data to runtime artifacts with cache, lineage and promotion gates.
---

# NWE World Compiler

The compiler is a data compiler, not a viewer helper. Keep three separate layers: raw SourceSnapshot, NormalizedSnapshot, and Compiled Artifact. Each has separate content identity/cache.

Authoritative acquisition, hashing, CRS/datum transforms, clipping, compilation and promotion run in native/local or server-side preprocessing. Runtime consumes compiled artifacts and never promotes them.

Use RFC 8785/JCS + SHA-256 for structured lineage. `REAL_COMPILED` requires source hash, explicit transform contract, normalized hash, compiler version/config, compiled artifact digest/size/media type and passing promotion gates. Same source snapshot + transform + compiler config must yield deterministic output or a documented reason why not.

For geospatial operations prefer `nwe-geospatial-tooling`. Do not reimplement generic raster/CRS/geometry/mesh tooling already pinned in the repo.
