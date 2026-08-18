---
name: nwe-geodata-contracts
description: Enforces source, CRS, vertical datum, license, provenance, source-tiling and real-sample gates for NWE terrain, roads, buildings, imagery and other geodata.
---

# NWE Geodata Contracts

No source becomes a core dependency until provider/dataset, coverage, resolution/accuracy, horizontal CRS, vertical datum/Z semantics, update/snapshot identity, license/attribution/cache/redistribution, acquisition method and at least one real sample are documented.

Prototype 0 uses EPSG:25832 horizontally and NN2000 as explicit land-height datum when supported. This is not a selected whole-Norway coordinate policy. Unknown/sentinel Z is missing, never a plausible height.

Keep **provider source tiling** separate from **NWE runtime tile identity**. A runtime tile may depend on multiple source snapshots. Source-set selection must be geometry-based and fail closed on ambiguous or incomplete coverage.

For raster input, hash raw bytes and inspect signature/format, CRS, bounds, pixel size, bands, nodata and dtype before normalization. For vectors preserve source IDs, inspect geometry/schema and record counts before/after deterministic clip/reprojection.

A multi-source overlap is a transform-policy question, not permission to choose first/newest/mean/tolerance. Until a deterministic seam rule has evidence and explicit provenance/config identity, reject conflicting valid surfaces. Diagnostic services such as WCS may be QA sensors without silently becoming source authority.

Browser/source APIs may diagnose or visualize, but authoritative acquisition/hashing/promotion belongs in the compiler pipeline. Runtime and renderer agents consume verified compiled artifacts only.
