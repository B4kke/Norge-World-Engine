# Nannestad DTM1 real-data terrain proof — 2026-08-17

Status: **PASS** on GitHub-hosted Ubuntu runner.  
Branch: `agent/dtm1-terrain-vertical`.  
Primary proof workflow: `dtm1-realdata-proof`, run `32066429605` on commit `f3a4476f929e5ceec82aa1b33a7feba5eb2a177f`.  
Repository baseline on the same commit: PASS.

## Source selection

The compiler queried the official Kartverket/Geonorge height-data Atom service and selected the `DTM1` dataset feed explicitly. The live dataset feed contained 2033 entries, all with declared GeoRSS polygons and `EPSG:25833` category metadata.

The canonical Nannestad Prototype-0 tile is `epsg25832_611000_6677000_1000m`. Exact polygon selection produced one source entry:

- entry id: `https://nedlasting.geonorge.no/geonorge/ATOM/hoydedata/DTM1/33-125-117.tif`
- file href: `https://nedlasting.geonorge.no/hoydedata/DTM1/33-125-117.tif`
- entry updated: `2024-11-21T16:52:54`
- source CRS: `EPSG:25833`
- source vertical datum contract: `NN2000`
- file link relation/media type: `section` / `application/geotiff`

No filename/id/title spatial inference is used for source selection; the declared GeoRSS geometry must cover the target polygon.

## Raw SourceSnapshot

The selected 15 km GeoTIFF was streamed into ignored content-addressed raw cache while SHA-256 was calculated. The full raster was not loaded into memory solely for provenance and is not uploaded to GitHub artifacts.

- raw byte size: **1,096,856,487 B**
- raw SHA-256: `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`
- CRS: `EPSG:25833`
- pixel size: **1.0 × 1.0 m**
- dimensions: **15010 × 15010**
- band count: **1**
- dtype: `float32`
- nodata: **-32767.0**
- bounds: `[275425.0, 6680995.0, 290435.0, 6696005.0]`

The acquisition cache persists service-feed and dataset-feed hashes alongside the exact retrieval identity and revalidates byte size/SHA/raster metadata before offline reuse.

## Explicit canonical transform

The raw source is not silently treated as the world CRS. `warp_dtm_to_canonical_grid` performs an explicit transform:

- source: `EPSG:25833`
- target: `EPSG:25832`
- vertical: `NN2000 -> NN2000` identity
- target bounds: `[611000, 6677000, 612000, 6678000]`
- target dimensions: **1000 × 1000**
- target pixel size: **1 m**
- resampling: **bilinear**
- Rasterio/GDAL worker threads: **1**

The existing pixel-aligned/no-resampling normalizer remains a separate strict transform and is not weakened.

Normalized GeoTIFF evidence:

- byte size: **2,026,285 B**
- SHA-256 cold/offline: `95c8fcf6f93c8fbb0533d6a82d68416b773f9a146970e1ae85676d3ba41c2adf`
- valid samples: **1,000,000**
- nodata samples: **0**
- elevation min: **168.97113037109375 m NN2000**
- elevation max: **197.6241455078125 m NN2000**
- elevation mean: **189.71221923828125 m NN2000**

## Compiled runtime terrain artifact

The normalized GeoTIFF is compiled into an engine-independent Prototype-0 height-grid artifact:

- schema: `nwe.terrain-height-grid-artifact/0.1`
- media type: `application/vnd.nwe.terrain-height-grid`
- framing: `NWEHGT01` + uint32-LE canonical-header length + RFC8785 header + samples
- samples: **1,000,000 float32 little-endian**
- order: row-major, north-to-south
- quantization: none
- artifact byte size: **4,000,382 B**
- artifact SHA-256 cold/offline: `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`

Cold and offline compilation emitted byte-identical terrain artifacts.

## Runtime verification

`engine/streaming/runtime_verifier.mjs` reconstructed the complete lineage against the exact compiled bytes and returned:

- `ok`: `true`
- decision: **`READY_FOR_RUNTIME`**
- code: **`RUNTIME_VERIFICATION_PASS`**
- SourceSnapshot hash: `25a4d3509b7c27292797c09cd96e989e455c12ef039f84842c18e82a531d191c`
- TransformContract hash: `d1c4a15b85039e9fe88f0e88a3f3ac82162be2d578941f507ae1aa0e5d4d2f29`
- NormalizedSnapshot hash: `1aec1f58535e13399a33ada731a7f7be8f643ed063d00755fee2274085eb1f5b`
- CompilerConfig hash: `52c98014b87ff78e35d13b08947b20bf7890571cf1037558e5c8096e91df4b09`
- lineage hash: `00bdea914663cefba3bbda56a293d68c141965aea947b2f23dd0385ad4f16d67`
- ArtifactRef hash: `8e32bc3ffbb71e5f4bb7b9a0f057429d0911053a1297b45a882fa0e896b134e8`
- PromotionRecord hash: `4d55846d9d2e2de8bc912111031b750d71d0574cfd41afc5b816e2876c73f617`

## Timings from the passing runtime-artifact proof

- cold live acquisition: **49,268.128 ms**
- cold 1 km warp: **174.544 ms**
- cold compile + persist: **34.457 ms**
- offline raw-cache verification: **1,510.521 ms**
- offline warp + compile: **192.150 ms**
- offline source requests: **0**

The cold acquisition is dominated by the ~1.1 GB source download. This is evidence for a future larger-area/bulk acquisition and cache strategy; it is not a reason to move raw DTM1 access into runtime.

## Proof package

Actions artifact for the passing run: `nannestad-dtm1-proof-f3a4476f929e5ceec82aa1b33a7feba5eb2a177f`, artifact id `9300104274`.

The short-retention package contains normalized 1 km GeoTIFF, compiled `.nwehgt`, RuntimeVerificationBundle, proof JSON, runtime-verification JSON and attribution. It deliberately excludes the 1.1 GB raw GeoTIFF.

## What this closes

- live DTM1 Atom source selection for the Nannestad tile;
- raw source identity/cache and real raster metadata;
- explicit EPSG:25833 -> EPSG:25832 / NN2000 transform;
- deterministic 1 m normalized terrain;
- deterministic compiled terrain runtime artifact;
- cold -> offline repeatability with zero source requests;
- exact runtime provenance/artifact verification.

## What remains open

- Android visual/runtime proof using the real terrain artifact together with the already-proven compiled road/building artifacts;
- terrain render LOD/downsampling policy and GPU upload/frame-time measurement;
- whole-Norway DTM1 acquisition/cache strategy;
- final terrain mesh/LOD/streaming format;
- DOM-DTM building-height enrichment;
- renderer choice.
