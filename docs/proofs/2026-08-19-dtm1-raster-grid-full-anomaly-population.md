# FORGE proof — full DTM1 declared-grid anomaly population

Date: 2026-08-19
Gate: `P0-MULTITILE-TERRAIN-01`
Role: FORGE

## Question

Do the 263 current DTM1 Atom entries whose transformed GeoRSS footprints fail the strict tested 15 km + overlap geometry also have irregular *actual GeoTIFF grids*, or is the discrepancy confined to the declared GeoRSS footprint surface?

This proof is diagnostic only. It must not create production seam authority.

## Implementation

Added `.github/workflows/dtm1-raster-grid-population-crosscheck.yml` on `agent/forge-hourly`.

The workflow:

- reads the current official DTM1 Atom service/dataset feeds;
- deterministically identifies every entry rejected by the existing strict source-grid diagnostic;
- matches each logical raster name to the Høydedata `NHM_DTM_25833` primary ImageServer catalog;
- opens every corresponding remote GeoTIFF with Rasterio/GDAL for metadata only;
- applies the existing hardened `classify_raster_grid` contract;
- records every open/classification failure instead of silently dropping it;
- fails closed unless every anomaly is observed and every classification is the expected diagnostic class;
- uploads JSON evidence only and checks `/tmp` for TIFF/TIFF/LAS/LAZ leakage.

No raw raster is committed or uploaded.

## Exact live evidence

Code head that introduced the population workflow: `b186523c1ece952386cf5afb6b5fa20537530b7e`.

GitHub Actions:

- `dtm1-raster-grid-population-crosscheck` run `32196163774` — PASS;
- `baseline` run `32196163616` — PASS;
- `dtm1-multitile-source-plan` run `32196163643` — PASS;
- `dtm1-raster-grid-crosscheck` run `32196163669` — PASS;
- `preview1-realdata-publish` run `32196163675` — PASS.

Live source snapshot identities observed by the population proof:

- service feed SHA-256: `3b5cf902d36843a92fff19a6b0637c872b8e969c2705880072b88d1491e7ab19`;
- DTM1 dataset feed SHA-256: `47442bf9804a79436f2ebc9b0bc1fd110facd17af5a84b56f32249ddb8134633`;
- ImageServer catalog page SHA-256 values:
  - `ca31d2cfbe4766a08afdf8768e42ee96ddfd654caed15fe4e3fef74ed60623e7`;
  - `4f381e22fdef99ffcc20cb408555159fef3bb7b6a288bbc888e55433b0c340a0`;
  - `76876f743cb29a26c6427b88dfb68e1d4f6c1d266ea8f0b716e6842d477fffbd`.

Population result:

- anomaly count: **263**;
- attempted remote GeoTIFF metadata opens: **263**;
- successful observations: **263**;
- failures: **0**;
- classification counts: **263 × `RASTER_MATCHES_CATALOG_NOT_DECLARED`**;
- raster dimensions: **263/263 = 15,010 × 15,010**;
- raster CRS: **263/263 = EPSG:25833**;
- raster resolution: **263/263 = 1.0 × 1.0 m**.

Evidence artifact:

- artifact ID: `9345949738`;
- archive size: **26,547 B**;
- archive digest: `sha256:389743d04824de1e912f3febb073c7cfa92e4a3eda3fa4c04ec435ed6e98b44c`;
- uncompressed JSON size: **632,301 B**;
- status: `FULL_POPULATION_MATCH`.

## What this proves

For the complete set of 263 current Atom entries rejected by the strict transformed-GeoRSS geometry diagnostic, the actual remote GeoTIFF grid metadata is regular and matches the provider ImageServer catalog bounding extent under the existing 0.25 m diagnostic tolerance. None of the 263 observations supports the hypothesis that those GeoRSS footprint deviations represent irregular raster dimensions/resolution/CRS.

This is substantially stronger than the previous 24-raster sample because it removes sampling uncertainty for the known anomaly population in this exact Atom snapshot.

## What this does not prove

It does **not** prove:

- that the ImageServer catalog polygon is byte/pixel authority rather than only an accurate bounding description;
- full source-byte SHA identity for these metadata-only opens;
- that every DTM1 raster outside the 263 anomaly population has identical semantics;
- that the approximately 5 m outer region is a disposable halo;
- that 15 km is an authoritative source core;
- any `first`, `newest`, filename-order, mean, min/max or tolerance winner rule;
- which valid elevation sample should survive where overlapping source rasters disagree;
- any production seam `TransformContract`.

`production_seam_authority=false` remains the only defensible state. Production terrain mosaicking must remain fail-closed.

## Consequence

The transformed Atom GeoRSS footprint can now be rejected as precise raster-edge authority for the entire currently known 263-entry anomaly population. This removes one uncertainty but does not resolve the actual overlap-value authority question.

The next highest-value FORGE work is therefore no longer more raster-grid sampling. It is to find provider-authoritative documentation/metadata that explains the 15,010 m raster extent / approximately 10 m neighbor overlap semantics, or a machine-readable source contract that identifies an authoritative core/winner rule. Until that exists, do not run the real 3×3 promotion as a production pass.
