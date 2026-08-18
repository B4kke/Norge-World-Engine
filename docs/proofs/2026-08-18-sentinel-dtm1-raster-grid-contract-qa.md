# SENTINEL — DTM1 actual-raster grid contract QA

Date: 2026-08-18  
Role: SENTINEL — Integration & QA  
Parent evidence: FORGE PR #35 `agent/forge-hourly`  
Gate: `P0-MULTITILE-TERRAIN-01`

## Strongest claim tested

FORGE #35 reports that three stratified anomalous DTM1 GeoTIFFs can be opened directly and that their actual 1 m EPSG:25833 raster-grid bounds match the NHM ImageServer catalog extent rather than the transformed Atom GeoRSS extent.

That is useful evidence only if the diagnostic first proves that the observed raster metadata describes the axis-aligned grid shape it claims to compare.

## Adversarial finding before fix

The original classifier accepted only `pixel_size_x_m` and `pixel_size_y_m`, used absolute pixel-size checks, and did not bind the reported bounds to the full affine transform and raster dimensions.

Therefore a caller could present metadata with:

- a rotated/sheared affine (`b`/`d` non-zero),
- reversed pixel orientation,
- transform/dimension metadata inconsistent with the reported bounds,
- or non-finite affine/bounds values,

and still reach an extent classification in cases where the four bounding coordinates happened to match.

The live Rasterio objects used by FORGE are expected to be internally coherent, but the reusable evidence classifier itself did not fail closed on those cases. That made the contract weaker than the claim.

A second wording issue was identified: the workflow reduces ImageServer polygon geometry to `(minX,minY,maxX,maxY)`. The evidence can therefore establish equality of **bounding extents**, not equality of provider polygons/footprints.

## Minimal fix

The stacked SENTINEL patch now requires:

- six finite affine coefficients `(a,b,c,d,e,f)`;
- expected +X / -Y 1 m pixel orientation;
- zero rotation/shear within the existing pixel tolerance;
- agreement between affine `a/e` and reported pixel size;
- agreement between affine + width/height and reported raster bounds;
- finite bounds/tolerances;
- explicit evidence label `BOUNDING_EXTENT_OF_PROVIDER_POLYGON_NOT_POLYGON_EQUALITY`.

The production seam authority remains `false` and no source winner, clipping rule, halo/core interpretation, averaging, tolerance or lexical ordering is introduced.

## Adversarial regressions

Focused tests cover:

1. catalog-extent match without authority promotion;
2. declared+catalog match distinction;
3. foreign/unknown CRS rejection;
4. wrong X/Y pixel size or orientation rejection;
5. rotated/sheared affine rejection;
6. affine/reported-pixel-size disagreement rejection;
7. affine/dimensions/bounds inconsistency rejection;
8. non-finite affine/bounds rejection.

## Acceptance classification

Pending exact-head GitHub Actions and the live Rasterio/GDAL remote-open workflow on the stacked SENTINEL head.

Even if those checks pass, the result remains **raster-grid metadata evidence, not seam authority**. The next compiler gate remains provider-authoritative overlap/core semantics or another independently defensible deterministic transform contract before real 3×3 promotion.
