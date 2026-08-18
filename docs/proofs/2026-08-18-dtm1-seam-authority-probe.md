# 2026-08-18 — DTM1 seam authority probe

## Scope

`P0-MULTITILE-TERRAIN-01` remains fail-closed. This proof investigates whether Kartverket / Høydedata publishes enough metadata to derive a deterministic overlap transform for the two Nannestad DTM1 source objects `33-125-116.tif` and `33-125-117.tif`.

No raw GeoTIFF is committed or uploaded by this work. No production seam transform is selected.

## New provider evidence

Live Høydedata ArcGIS ImageServer metadata exposes a national 1 m float32 DTM service in EPSG:25833:

- service: `https://hoydedata.no/arcgis/rest/services/NHM_DTM_25833/ImageServer`
- default mosaic method: `ByAttribute`
- mosaic operator: `First`
- sort field: `NAME`
- sort value: `0`
- ascending: `true`
- default resampling: `Bilinear`

The same service catalog exposes the two logical Nannestad DTM1 tiles:

- raster object 854: `NAME=33-125-116`, `CATEGORY=1`, `ZORDER=-300`, 1 m primary range (`LOWPS=1`, `HIGHPS=8`), polygon bounds approximately `(275425, 6665995, 290435, 6681005)` in EPSG:25833;
- raster object 855: `NAME=33-125-117`, `CATEGORY=1`, `ZORDER=-300`, 1 m primary range (`LOWPS=1`, `HIGHPS=8`), polygon bounds approximately `(275425, 6680995, 290435, 6696005)` in EPSG:25833.

Their advertised catalog geometries therefore overlap by exactly 10 m north/south. This independently corroborates the overlap already measured from the acquired raw GeoTIFFs and ties the ImageServer catalog to the same logical source-tile names.

## Why this does not yet authorize a TransformContract

The evidence is stronger than WCS-only comparison, but two blockers remain material:

1. ArcGIS REST documentation for `esriMosaicAttribute` / `ByAttribute` says the sort field is numeric or date-valued. Høydedata advertises `sortField=NAME`, while `NAME` is declared as `esriFieldTypeString`. We therefore do not have documented semantics that justify translating the server configuration into a raw-file rule such as lexical filename ordering.
2. Matching `NAME` + footprint proves a logical catalog link, not byte identity between an ImageServer catalog raster and the SHA-addressed Atom GeoTIFF. Nor has a provider statement been found that explicitly says the ImageServer default mosaic rule is the authoritative overlap rule for the downloadable DTM1 Atom objects.

Accordingly, the production compiler must continue rejecting the disagreeing overlap. `first`, lexical filename order, newest, mean, min/max and tolerance remain unauthorized.

## Implementation

Added `nwe_compiler.nhm_mosaic_authority` to classify provider-published service/catalog evidence without converting it into a seam rule. It:

- requires the expected 1 m EPSG:25833/F32 NHM service contract;
- resolves the published default mosaic fields and their ArcGIS field type;
- requires exactly the expected logical source names;
- computes catalog overlap from provider geometry;
- records logical source linkage separately from byte identity;
- returns `FAIL_CLOSED_UNPROVEN` with explicit blockers and `production_transform_authorized=false`.

Added `tools/geo/dtm1_nhm_mosaic_authority_probe.py` and `dtm1-seam-authority-probe.yml`. The workflow is both manually dispatchable and PR-triggered for the probe/classifier paths. It hashes the exact small JSON metadata/catalog responses, asserts the known 10 m overlap and current provider configuration, requires the result to remain fail-closed, and rejects TIFF/LAS/LAZ evidence artifacts.

## Exact live validation

GitHub Actions run `32166309683` (`dtm1-seam-authority-probe`, run 1) passed on the PR merge ref containing FORGE head `f89bc1362577134b524b1a483511641dc03b0cdc`.

The live provider responses captured in that run were:

- ImageServer metadata: **4,447 B**, SHA-256 `83cead22f921236c76405e02f4251953387a71bb52cfb861b97dc3bcff793994`;
- exact catalog query for `33-125-116` + `33-125-117`: **2,947 B**, SHA-256 `f49f9c70a76f069e0d617c3689a93b7dc2864994266d24bba4a4f1e6e10ebe76`.

The workflow re-observed object IDs 854/855, EPSG:25833, the exact 10 m overlap, `ByAttribute` / `NAME` / `First` / bilinear configuration, and returned `FAIL_CLOSED_UNPROVEN`. The evidence directory contained only the JSON proof; TIFF/LAS/LAZ exclusion passed. Uploaded proof ZIP SHA-256 was `b40009b6da4460cc7113c23eb8bbb5cedc81f5d7c5426d0a476c4bd49643d03a`.

The full repository baseline and the live Atom multi-tile source-plan also passed on the immediately preceding FORGE code/docs head before the PR-trigger addition. This validates that the new diagnostic boundary does not weaken the existing compiler/source-selection contracts.

## Primary sources checked

- Høydedata NHM DTM EPSG:25833 ImageServer root and catalog item resources.
- ArcGIS REST Image Service and Mosaic Rule documentation for default mosaic metadata and `ByAttribute` semantics.
- Existing NWE raw-overlap/WCS diagnostics remain comparison evidence only.

## Result

**New world truth:** Høydedata's NHM_DTM_25833 service catalog explicitly contains the two logical Nannestad DTM1 tiles and advertises a deterministic-looking default mosaic configuration, but the advertised `ByAttribute(NAME)` combination is outside the field types documented by ArcGIS REST for that method. The evidence therefore reduces uncertainty but does not close the seam authority gate.

`P0-MULTITILE-TERRAIN-01` remains open and fail-closed. No entry is added to `docs/04-decisions.md`.
