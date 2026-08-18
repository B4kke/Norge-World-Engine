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

## Exact-head evidence

SENTINEL branch head: `da5bc8cb4a4227022722e5ea4a131eba829b8b95`.

GitHub Actions on the stacked PR composition:

- `baseline` run `32188446124` — **PASS**;
- `dtm1-multitile-source-plan` run `32188446116` — **PASS**;
- hardened `dtm1-raster-grid-crosscheck` run `32188446106` — **PASS**.

Focused adversarial suite: **8 passed in 0.02 s**.

The hardened live Rasterio/GDAL probe re-observed **263** anomalous Atom entries and the same min/median/max strata. All three remote GeoTIFFs passed the stricter affine/grid self-consistency contract and remained `RASTER_MATCHES_CATALOG_NOT_DECLARED`:

- `33-161-192`: bounds `[815425, 7805995, 830435, 7821005]`, `15010 × 15010`;
- `33-168-192`: bounds `[920425, 7805995, 935435, 7821005]`, `15010 × 15010`;
- `33-179-198`: bounds `[1085425, 7895995, 1100435, 7911005]`, `15010 × 15010`.

The proof artifact uploaded by the hardened run is 1,912 B; ZIP SHA-256 `20b11653c4c35f4d14cc5d76befff7dd563d10d54f159e26349e1d776be7db55`. The raw-geodata exclusion step passed.

## Acceptance classification

**PASS for the narrow raster-grid metadata claim after hardening.** The FORGE observation survives the adversarial affine/orientation/bounds checks and can be stated as: for the three stratified samples, the actual axis-aligned GeoTIFF raster **bounding extents** reproduce the NHM ImageServer catalog bounding extents rather than the transformed Atom GeoRSS bounding extents.

**NOT PROVEN for seam authority.** This does not establish catalog polygon equality, universal behavior across all 263 anomalies/2033 entries, a disposable ~5 m halo, an authoritative 15 km core, source priority or the valid elevation sample that wins in a 10 m overlap.

The next compiler gate remains provider-authoritative overlap/core semantics or another independently defensible deterministic transform contract before real 3×3 promotion.
