---
name: nwe-geodata-contracts
description: Enforces source, CRS, vertical datum, license, provenance and sample validation for Norge World Engine geodata. Use for terrain, imagery, roads, buildings, water and other geospatial sources.
---

# NWE Geodata Contracts

No source becomes a core dependency until provider/dataset, coverage, resolution/accuracy, horizontal CRS, vertical datum/Z semantics, update/snapshot identity, license/attribution/cache/redistribution, download/API method and at least one real sample are documented.

Prototype 0 uses EPSG:25832 horizontally and NN2000 as explicit land-height datum when the source supports it. This is not a final whole-Norway CRS policy. Unknown/sentinel Z is missing, never a plausible height.

Before raster normalization, hash source bytes and inspect format, CRS, bounds, pixel size, bands, nodata and dtype. A HTTP-success XML/service error is not raster data. For vectors preserve source IDs, inspect geometry/schema, and record counts before/after deterministic clip/reprojection.

Browser/WCS/Overpass paths may diagnose or visualize, but cannot own authoritative acquisition/hashing or promote `REAL_COMPILED`.
