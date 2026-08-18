# FORGE — DTM1 raster-grid spatial/deviation sample

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Branch: `agent/forge-hourly`

## Scope

This increment broadens the actual-raster metadata evidence behind the unresolved DTM1 overlap gate. It does not select a seam transform and does not promote ImageServer/Atom metadata into source authority.

The previous live proof opened three anomalous Atom GeoTIFFs selected by min/median/max metadata deviation. That was useful but geographically weak. This run adds a deterministic evidence-sample planner that forces min/max metadata deviation plus x/y spatial extremes, then fills the remaining budget using farthest-point selection over normalized provider-catalog center x/y and declared-vs-catalog deviation.

## Implementation

- `engine/compiler/src/nwe_compiler/dtm1_raster_sample_plan.py`
  - validates finite/unique sample candidates;
  - forces deviation and geographic extremes into the sample when capacity allows;
  - deterministically fills the sample by farthest-point coverage;
  - is order-independent and contains no seam/core/priority inference.
- `engine/compiler/tests/test_dtm1_raster_sample_plan.py`
  - determinism/order-independence;
  - extreme inclusion;
  - full-population behavior;
  - fail-closed invalid/non-finite/duplicate input.
- `.github/workflows/dtm1-raster-grid-crosscheck.yml`
  - raises the live metadata sample target from 3 to 24;
  - records sample names and catalog centers;
  - keeps `production_seam_authority=false`;
  - continues to open remote GeoTIFFs only through Rasterio/GDAL metadata access and uploads JSON only.

## Exact live evidence

GitHub Actions run `32191831662` completed **PASS** on PR #35 composition for branch code head `92c00809ec4cad33517d959236631f49ed8bc211` (checkout merge ref `4ce8198aef36416f8939348d72edd400d79e46eb`).

Focused raster-grid + sample-planner suite: **16 passed in 0.04 s**.

The live source/catalog pass re-observed:

- anomalous Atom entries: **263**;
- matching ImageServer catalog entries: **263/263**;
- actual remote GeoTIFF metadata opened: **24** deterministic spatial/deviation samples;
- actual-raster classification: **24/24 `RASTER_MATCHES_CATALOG_NOT_DECLARED`**;
- raster dimensions: **24/24 = 15,010 × 15,010**;
- expected raster CRS/pixel/orientation/affine consistency: **24/24 passed the hardened classifier**.

Selected logical names:

`33-161-192`, `33-179-198`, `33-180-191`, `33-166-180`, `33-169-201`, `33-176-186`, `33-175-196`, `33-170-191`, `33-163-199`, `33-165-187`, `33-178-190`, `33-177-198`, `33-174-191`, `33-166-194`, `33-172-196`, `33-173-200`, `33-168-184`, `33-163-183`, `33-169-196`, `33-177-194`, `33-167-190`, `33-161-196`, `33-176-191`, `33-166-200`.

The JSON-only evidence artifact uploaded successfully:

- artifact ID: `9344476636`;
- ZIP size: **4,986 B**;
- ZIP SHA-256: `c749e22dbd02f26a74ceca3ded6c1fcccfe0258068f2e9e7e2721bf6e4c99ae8`;
- raw TIFF/LAS/LAZ exclusion step: **PASS**.

Companion exact-head runs observed during this handoff:

- `dtm1-multitile-source-plan` run `32191831642` — **PASS**;
- `preview1-realdata-publish` run `32191831641` — **PASS**;
- repository `baseline` run `32191831650` was still running when this proof was first written and must not be claimed PASS until GitHub reports completion.

## What this proves

The earlier 3-raster observation survives a substantially broader deterministic sample. For 24 geographically/deviation-spread anomalous DTM1 entries, the actual axis-aligned GeoTIFF grid metadata is consistently 15,010 × 15,010 at the expected EPSG:25833/1 m north-up grid and its bounding extent reproduces the corresponding NHM ImageServer catalog bounding extent rather than the transformed Atom GeoRSS bounding extent within the existing 0.25 m diagnostic tolerance.

This materially weakens transformed Atom GeoRSS as precise raster-edge authority for these sampled anomalies.

## What this does not prove

- behavior for all remaining unsampled anomalies or all DTM1 rasters;
- ImageServer polygon equality rather than bounding-extent equality;
- full source-byte SHA-256 for these metadata-only opens;
- that the outer ~5 m is disposable halo;
- that the authoritative logical core is exactly 15 km;
- source priority, first/newest/mean/min/max/tolerance/lexical ordering;
- which valid height sample wins where neighboring source rasters disagree;
- any production seam transform.

`production_seam_authority=false`. Production multi-source mosaicking remains fail-closed. `docs/04-decisions.md` remains unchanged.

## Next

The metadata-open cost for 24 rasters was small enough that the next reversible falsification step is to expand coverage to all 263 anomalous Atom entries under a bounded live CI timeout, preferably with explicit per-open failure accounting. Even a 263/263 grid-geometry result would still not establish overlap value authority; provider documentation or another independently defensible provenance-bearing seam rule remains required before the real 3×3 promotion gate can run.
