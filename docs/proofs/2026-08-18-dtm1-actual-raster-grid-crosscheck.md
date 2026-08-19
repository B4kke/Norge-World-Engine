# DTM1 actual raster-grid crosscheck — 2026-08-18

## Scope

This proof advances `P0-MULTITILE-TERRAIN-01` without selecting a production seam rule.

The prior FORGE pass established that all 263 current Atom GeoRSS extent anomalies have matching regular NHM ImageServer catalog footprints. This pass asks a narrower question: do actual downloadable GeoTIFF raster grids reproduce the Atom GeoRSS bounds or the ImageServer catalog bounds?

## Method

The live GitHub Actions probe:

1. reads the current official DTM1 Atom service/dataset feed;
2. re-identifies the 263 strict GeoRSS extent anomalies in EPSG:25833;
3. joins them to NHM_DTM_25833 ImageServer catalog items by the logical name derived from each explicit GeoTIFF href;
4. ranks matched anomalies by declared-vs-catalog metadata deviation and chooses the minimum, median and maximum cases;
5. opens those three actual remote GeoTIFFs with pinned Rasterio 1.5.0/GDAL using metadata-only remote access;
6. validates raster CRS as EPSG:25833 and pixel size as 1 m;
7. compares actual raster bounds with both metadata surfaces using `nwe.dtm1-raster-grid-crosscheck/0.1`;
8. uploads JSON evidence only and rejects TIFF/TIFF/LAS/LAZ files from the evidence workspace.

The probe deliberately does **not** substitute URL, ETag or service metadata for a full source-content SHA-256. `source_content_sha256` remains explicit `null / UNPROVEN_METADATA_ONLY_REMOTE_OPEN`.

## Exact live evidence

PR head: `0a753e2454c8283d846e5d87deedf624c749475d`.

GitHub Actions:

- `dtm1-raster-grid-crosscheck` run `32186576264` — **PASS**;
- focused regression suite — **4 passed**;
- repository `baseline` run `32186576162` — **PASS**;
- existing `dtm1-multitile-source-plan` run `32186575996` — **PASS**.

Evidence artifact:

- name: `dtm1-raster-grid-crosscheck-9e11e2e5fd9016a3e6a8f26d873cb4e430a2ce6f`;
- ZIP size: **1,785 B**;
- SHA-256: `382badd8695d36544243310d9f1a06f30c968bd6727eae1c2d0a3461f9b613a9`;
- raw-geodata exclusion step: **PASS**.

The live run re-observed **263** anomalous Atom entries and sampled three strata:

- `33-161-192`: actual raster bounds `[815425, 7805995, 830435, 7821005]`, size `15010 × 15010`, classification `RASTER_MATCHES_CATALOG_NOT_DECLARED`;
- `33-168-192`: actual raster bounds `[920425, 7805995, 935435, 7821005]`, size `15010 × 15010`, classification `RASTER_MATCHES_CATALOG_NOT_DECLARED`;
- `33-179-198`: actual raster bounds `[1085425, 7895995, 1100435, 7911005]`, size `15010 × 15010`, classification `RASTER_MATCHES_CATALOG_NOT_DECLARED`.

All three remote rasters passed the explicit EPSG:25833 / 1 m grid checks.

## What this proves

**FACT:** for this stratified three-raster sample of known Atom GeoRSS anomalies, the actual downloadable GeoTIFF raster bounds reproduce the corresponding NHM ImageServer catalog bounds within 0.25 m and do not reproduce the transformed Atom GeoRSS bounds within that tolerance.

**FACT:** each sampled raster is a 15,010 × 15,010 pixel, 1 m EPSG:25833 grid.

**INFERENCE:** Atom GeoRSS is not sufficiently precise to act as the actual raster-edge authority for these sampled anomalies. The ImageServer catalog is a better predictor of actual raster grid bounds for this sample.

## What remains unproven

This result does **not** prove:

- that all 263 anomalous GeoTIFFs match the catalog grid;
- that all 2033 current Atom GeoTIFFs use an identical 15,010 × 15,010 raster layout;
- that the extra approximately 5 m on each side is a disposable halo;
- that the intended authoritative core is exactly 15 km;
- which source must win where valid overlap values disagree;
- first/newest/mean/min/max/tolerance/lexical filename ordering;
- full source-byte identity for these three metadata-only observations.

Therefore `production_seam_authority=false`, `authority_status=UNPROVEN`, production mosaicking remains fail-closed, and `docs/04-decisions.md` is unchanged.

## Next

The highest-value next FORGE step is to expand actual-raster metadata coverage from three stratified anomalies to a deterministic wider sample (or all 263 where remote-open cost remains acceptable), while separately seeking provider documentation that describes route/core/buffer or overlap semantics. Grid geometry alone can disqualify an imprecise metadata surface; it cannot tell us which disagreeing elevation sample is authoritative.
