# Terrain verified-artifact → worker → scheduler proof — 2026-08-18

## Scope

This proof covers the renderer-independent runtime composition only:

`RuntimeVerificationBundle + compiled terrain bytes -> runtime verification -> NWEHGT01 semantic decode -> terrain mesh worker -> TileStreamingScheduler payload`.

It does **not** close the real neighboring DTM1 seam gate, select a renderer, select an origin-shift threshold, prove browser full-provenance parity or provide Android performance evidence.

## Implementation evidence

Implementation head: `9498afdc3a06fdba37740ba0b7b2bc4908e3c7e0`  
Hosted baseline run: `32133954937`  
Result: **PASS**

The same baseline also passed the existing compiler, RFC 8785/JCS, runtime-verifier, scheduler, terrain-worker, viewer artifact-boundary, Cesium-build and migrated VEKTOR gates.

## New regression matrix

`engine/streaming/test_terrain_tile_loader.mjs` passes 7 cases:

1. canonical NWEHGT01 header/elevation decode;
2. truncated or trailing payload bytes rejected;
3. tampered artifact SHA rejected by full RuntimeVerificationBundle verification before worker dispatch;
4. semantically invalid terrain bytes that are nevertheless hash-bound by an internally consistent fixture bundle are rejected by NWEHGT01 decoding before worker dispatch;
5. scheduler tile ID and verified artifact/bundle tile ID must match;
6. pre-aborted load performs zero input-resolution and zero worker work;
7. a verified terrain fixture becomes a resident `TileStreamingScheduler` payload after decode and mesh generation.

The integration fixture is structurally exact but deliberately small: a 4×4 float32 NWEHGT01 grid, full reconstructed provenance bundle, 3×3 renderer-neutral mesh output and scheduler lifecycle. The resident payload in that case accounts for 64 B of retained elevations + 336 B of generated mesh = **400 B**. This proves the accounting boundary, not real-world memory cost.

## Runtime boundary

`terrain_tile_loader.mjs` does not import Node crypto or a renderer. Instead it requires a verifier dependency. Hosted integration injects the existing full `verifyRuntimeBundle`; a browser implementation can later inject WebCrypto/JCS graph reconstruction without changing scheduler or worker APIs.

The loader rejects before worker dispatch when:
- runtime verification is not `READY_FOR_RUNTIME`;
- artifact role/media type does not match the terrain height-grid contract;
- scheduler tile identity differs from verified ArtifactRef identity;
- NWEHGT01 magic/schema/storage/grid/NN2000/elevation semantics are invalid.

Mesh source dimensions, bounds, pixel size and nodata are derived from the decoded verified artifact header. The caller may supply only renderer-derivative options (`outputSize`, `originE`, `originN`, `originH`), keeping origin choice explicit rather than silently selecting a new world-coordinate policy.

## Still open

- Run the accepted real Nannestad artifact (4,000,382 B, SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`) through this exact composition.
- Provide browser-side full RFC 8785/JCS provenance reconstruction parity; current browser consumer proves artifact byte size/SHA but not the whole graph.
- Measure Android worker dispatch→result, main-thread apply/upload, rAF gaps and tile motion.
- Resolve the real DTM1 10 m source-overlap transform before claiming 2×2/3×3 real neighboring terrain.
