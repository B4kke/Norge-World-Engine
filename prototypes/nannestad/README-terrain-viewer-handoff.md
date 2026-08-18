# Nannestad terrain → viewer handoff

This file records the artifact boundary for the next viewer integration. It does not commit generated binary artifacts.

## Verified input

Terrain runtime artifact from `dtm1-realdata-proof` run `32066429605`:

- role: `terrain-height-grid`
- schema: `nwe.terrain-height-grid-artifact/0.1`
- tile: `epsg25832_611000_6677000_1000m`
- CRS: `EPSG:25832`
- vertical datum: `NN2000`
- grid: 1000 × 1000, 1 m
- storage: little-endian float32, row-major north-to-south
- artifact bytes: 4,000,382
- artifact SHA-256: `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`
- runtime verification: `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`

The short-retention Actions artifact `nannestad-dtm1-proof-f3a4476f929e5ceec82aa1b33a7feba5eb2a177f` (artifact id `9300104274`) contains the exact `.nwehgt`, bundle and 1 km normalized GeoTIFF. The 1.1 GB raw DTM1 source is deliberately excluded.

## Existing vector inputs

- roads: 246 paths, artifact SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`
- buildings: 135 footprints, artifact SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`

## Viewer contract

- Verify embedded/fetched compiled bytes before parsing.
- Normal viewer runtime must have zero requests to Kartverket DTM1 Atom/GeoTIFF, NVDB, OSM or Overpass.
- World origin remains a renderer concern; source and artifact coordinates remain canonical EPSG:25832 / NN2000.
- DTM height-grid values are authoritative terrain samples for this source snapshot.
- A render mesh may downsample the 1 m artifact for GPU cost, but that render representation must not replace the authoritative artifact identity.
- Building footprint ground Z should sample DTM. Unresolved building height remains unresolved; a visual debug height is not source truth.
- NVDB road Z is already explicit NN2000 where valid. Use it deliberately; DTM is a ground/fallback reference rather than silently flattening bridges/grade-separated roads.
- World Imagery remains a visual sensor layer, not world-truth geometry.
- Record terrain verify/decode/mesh/upload cost, first-visible, frame time/FPS, draw calls and memory where available.

## Parallel work

Issue #5 owns renderer batching/performance measurement and is intentionally separate from terrain/source/compiler semantics. Avoid editing compiler source contracts from that issue.
