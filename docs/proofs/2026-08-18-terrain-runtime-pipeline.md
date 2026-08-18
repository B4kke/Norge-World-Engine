# Terrain verified-artifact → worker → scheduler proof — 2026-08-18

## Scope

This proof covers the renderer-independent runtime composition:

`RuntimeVerificationBundle + compiled terrain bytes -> runtime verification -> NWEHGT01 semantic decode -> terrain mesh worker -> TileStreamingScheduler payload`.

It does **not** close the real neighboring DTM1 seam gate, select a renderer, select an origin-shift threshold, prove browser full-provenance parity or provide Android Dedicated Worker performance evidence.

## Implementation evidence

Initial implementation head: `9498afdc3a06fdba37740ba0b7b2bc4908e3c7e0`  
Initial hosted baseline run: `32133954937`  
Final PR head: `0ff16676d0106f53fdee4960cf53b1bcf521028e`  
Final hosted baseline run: `32134415366`  
Result: **PASS**

The baseline passes the existing compiler, RFC 8785/JCS, runtime-verifier, scheduler, terrain-worker, viewer artifact-boundary, Cesium-build and migrated VEKTOR gates together with the new loader integration.

## Regression matrix

`engine/streaming/test_terrain_tile_loader.mjs` passes 7 cases:

1. canonical NWEHGT01 header/elevation decode;
2. truncated or trailing payload bytes rejected;
3. tampered artifact SHA rejected by full RuntimeVerificationBundle verification before worker dispatch;
4. semantically invalid terrain bytes that are nevertheless hash-bound by an internally consistent fixture bundle are rejected by NWEHGT01 decoding before worker dispatch;
5. scheduler tile ID and verified artifact/bundle tile ID must match;
6. pre-aborted load performs zero input-resolution and zero worker work;
7. a verified terrain fixture becomes a resident `TileStreamingScheduler` payload after decode and mesh generation.

The structural integration fixture is deliberately small: a 4×4 float32 NWEHGT01 grid, full reconstructed provenance bundle, 3×3 renderer-neutral mesh output and scheduler lifecycle. The resident payload accounts for 64 B of retained elevations + 336 B of generated mesh = **400 B**. This proves the accounting boundary, not real-world memory cost.

## Exact accepted Nannestad real-data proof

After merge, the existing DTM1 main proof workflow exercised the exact accepted terrain artifact through the same runtime composition rather than starting a second heavy acquisition job.

Main merge commit: `909cf5d0cdf7489feff7f44ba12983a051e5affe`  
GitHub Actions run: `32134507528`  
Actions proof artifact: `nannestad-dtm1-proof-909cf5d0cdf7489feff7f44ba12983a051e5affe` / artifact ID `9323475070`  
Workflow result: **PASS**

The job passed all of the following stages:

- cold live DTM1 acquisition, explicit warp, compile and source-network-free offline repeat;
- full `runtime_verifier.mjs` reconstruction of the exact compiled bytes;
- `terrain_tile_loader.mjs` strict NWEHGT01 decode;
- `TerrainMeshWorkerClient` + worker protocol execution;
- `TileStreamingScheduler` load/resident lifecycle;
- proof-artifact persistence with the 15 km raw GeoTIFF excluded.

Exact real runtime evidence:

- tile: `epsg25832_611000_6677000_1000m`;
- compiled artifact: **4,000,382 B**;
- artifact SHA-256: `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- cold/offline artifact SHA: identical;
- runtime decision: `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`;
- retained elevations: **1,000,000 float32 samples / 4,000,000 B**;
- terrain mesh: **129×129**, **16,641 vertices**, **32,768 triangles**, uint16 indices, **729,120 B**;
- scheduler retained bytes: **4,729,120 B**;
- one scheduler load started/completed, zero failures, resident count 1, cache miss 1, budget overcommit 0;
- raw-source requests during offline repeat: **0**.

Hosted pipeline timing from that real run:

- input resolution: **0.076 ms**;
- full provenance verification: **4.010 ms**;
- NWEHGT01 decode + full elevation validation: **29.829 ms**;
- worker-client/protocol roundtrip: **44.692 ms**;
- worker-reported mesh work: **43.931 ms**;
- total loader path: **82.260 ms**.

These timings are Linux/Node hosted-runner measurements. The worker step used `TerrainMeshWorkerClient` with an in-process protocol-compatible Worker shim so the client/protocol/ownership path is exercised deterministically. They are **not** evidence of browser thread startup, real postMessage transfer latency, Android GPU upload cost or visible frame stability.

## Runtime boundary

`terrain_tile_loader.mjs` does not import Node crypto or a renderer. Instead it requires a verifier dependency. Hosted integration injects the existing full `verifyRuntimeBundle`; a browser implementation can later inject WebCrypto/JCS graph reconstruction without changing scheduler or worker APIs.

The loader rejects before worker dispatch when:
- runtime verification is not `READY_FOR_RUNTIME`;
- artifact role/media type does not match the terrain height-grid contract;
- scheduler tile identity differs from verified ArtifactRef identity;
- NWEHGT01 magic/schema/storage/grid/NN2000/elevation semantics are invalid.

Mesh source dimensions, bounds, pixel size and nodata are derived from the decoded verified artifact header. The caller may supply only renderer-derivative options (`outputSize`, `originE`, `originN`, `originH`), keeping origin choice explicit rather than silently selecting a new world-coordinate policy.

## Still open

- Provide browser-side full RFC 8785/JCS provenance reconstruction parity; current browser consumer proves artifact byte size/SHA but not the whole graph.
- Measure Android Dedicated Worker dispatch→result, main-thread apply/upload, rAF gaps and tile motion.
- Resolve the real DTM1 10 m source-overlap transform before claiming 2×2/3×3 real neighboring terrain.
- Select hard resident/GPU memory budgets and LOD only after real device movement evidence rather than from the single-tile hosted timing above.
