# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## P0 — Critical

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** CONTRACT DEFINED / IMPLEMENTATION OPEN  
**Owner area:** `engine/schemas`, `engine/streaming`  
**Next concrete result:** version the RuntimeVerificationBundle schema in-repo and implement JCS/SHA-256 reconstruction for SourceSnapshot -> TransformContract -> NormalizedSnapshot -> CompilerConfig -> CompileLineage -> ArtifactRef -> PromotionRecord. Add forged-lineage and clip-mutation negative regressions.  
**Acceptance:** forged self-consistent supplied hash strings are rejected unless reconstructed object hashes/edges match.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** CONTRACT DEFINED / IMPLEMENTATION OPEN  
**Owner area:** `engine/compiler`  
**Next concrete result:** replace bbox-authoritative polygon matching with actual polygon geometry and add SENTINEL's adversarial triangle test.  
**Acceptance:** bbox false positive is rejected; valid boundary-inclusive covering polygon passes; invalid/ambiguous CRS/axis/order fails closed.

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** BLOCKED / NOT YET PROVEN  
**Owner area:** `engine/compiler`, `tools`  
**Next concrete result:** production service+dataset feed -> unambiguous Nannestad entry -> full raw GeoTIFF -> SHA-256/size/raster metadata -> deterministic 1 km clip -> normalized snapshot -> compiled terrain artifact -> promotion record -> persisted raw/normalized/compiled cache.  
**Acceptance:** second identical run proves cache hits and deterministic output; runtime can load the compiled artifact using manifest/bundle only, with no source API contact.

### P0-NVDB-01 — Road adapter
**Status:** SOURCE CONTRACT VERIFIED / PRODUCTION ADAPTER OPEN  
**Next:** bbox/segment acquisition, explicit source SRID, horizontal reprojection to prototype CRS, NN2000 Z preservation/null policy, source snapshot/provenance.

### P0-BUILDINGS-01 — Building volumes
**Status:** PARTIAL / FALLBACK DEFINED  
**Next:** capability-gated FKB path; documented OSM footprint + DOM-DTM fallback only where license/provenance requirements are satisfied. Do not block terrain vertical on FKB access.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** CONTRACT/HARNESS EXISTS / REAL TERRAIN BLOCKED  
**Next:** after P0-REALDATA-01, measure manifest load, artifact fetch, SHA verify, decode, local-origin rebase, GPU upload, first visible frame, steady CPU/GPU frame time, draw calls, triangles and RAM/VRAM.

## Explicitly deprioritized until P0 evidence exists

- renderer polish and photorealism;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain progress;
- production imagery dependency before redistribution/cache rights are documented.
