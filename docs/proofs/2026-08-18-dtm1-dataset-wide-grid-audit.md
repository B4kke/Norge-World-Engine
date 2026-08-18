# DTM1 dataset-wide source-grid audit — 2026-08-18

## Scope

This work advances `P0-MULTITILE-TERRAIN-01` without selecting a terrain seam rule.

The accepted Nannestad evidence already proves two official EPSG:25833 DTM1 source rasters overlap by about 10 m and disagree in valid elevation samples. Earlier metadata-only work established that the two declared extents are geometrically consistent with nominal 15 km route cores plus about 5 m symmetric padding, but explicitly did **not** prove that such padding is a disposable processing halo.

This increment generalizes that diagnostic from one Nannestad pair to an arbitrary set of declared DTM1 route extents and changes the live metadata workflow to audit the complete current EPSG:25833 DTM1 Atom catalogue.

## Primary-source verification

Checked 2026-08-18 against current Kartverket/Geonorge material:

- Kartverket's terrain-data page still lists terrain models as GeoTIFF grids and exposes WCS/WFS/WMS plus REST services for machine acquisition. It does not state an overlap winner rule for downloadable DTM1 route GeoTIFFs.
- Geonorge still lists the official `DTM1 Atom feed-tjeneste` under Kartverket/Høydedata.
- The current Geonorge `Produktspesifikasjon: Punktsky 1.0.3` documents NHM terrain-grid generation from point clouds, including `Triangulate with Natural Neighbor Interpolation` as the primary terrain/bathymetry grid method and `Bin with Average Value` as fallback when triangulation fails. This describes grid generation methodology, not a rule for resolving overlapping downloadable route rasters.

No current provider statement found in this pass authorizes first/newest/mean/min/max/tolerance selection or inferred-core clipping for the DTM1 route overlap.

Primary references:

- https://www.kartverket.no/api-og-data/terrengdata
- https://kartkatalog.geonorge.no/ (DTM1 Atom feed-tjeneste)
- https://dokument.geonorge.no/produktspesifikasjoner/punktsky/1.0.3/index.html

## Implementation

`engine/compiler/src/nwe_compiler/dtm1_source_grid_audit.py` now adds `audit_declared_route_grid()`.

The function:

- requires at least two declared routes;
- applies the existing explicit 15 km symmetric-buffer hypothesis to every route;
- finds nominally adjacent route pairs on the tested 15 km grid;
- records pair count, supported-pair count, overlap min/max/mean, center-spacing min/max/mean and inferred nominal-core-gap min/max/mean;
- preserves per-route and per-pair evidence;
- always emits `production_seam_authority: false` and `authority_status: UNPROVEN`.

It is deliberately a regularity audit, not a transform implementation.

## Live evidence workflow

`.github/workflows/dtm1-source-grid-geometry-audit.yml` now keeps the accepted Nannestad 3×3 topology assertion and additionally:

1. fetches the current official service + DTM1 dataset Atom feeds;
2. hashes both feed byte streams;
3. filters current entries explicitly advertising `EPSG:25833`;
4. transforms each declared GeoRSS geometry to EPSG:25833 with pyproj/PROJ;
5. counts missing extents and route extents that do not fit the tested 15 km symmetric-buffer hypothesis;
6. runs the dataset-wide regularity audit over accepted declared extents;
7. writes only a small JSON evidence artifact — no GeoTIFF/LAS/LAZ data;
8. requires the result to remain non-authoritative.

The workflow does **not** fail merely because a route violates the hypothesis; such exceptions are evidence and are recorded in `rejected_routes`.

## Regression coverage

Focused tests now cover:

- the exact recovered Nannestad 116/117 geometry;
- a deterministic 2×2 route set with four adjacent pairs and 10 m overlaps;
- fail-closed behavior when a route set contains no nominal neighbors;
- asymmetric extents;
- non-adjacent pair rejection.

## Claim calibration

**FACT:** the compiler can now measure DTM1 route-grid regularity across the complete live metadata catalogue instead of extrapolating from one pair.

**FACT:** current official provider documentation found in this pass describes DTM/NHM products and grid generation but does not provide a downloadable-route overlap priority rule.

**UNPROVEN:** that a universal 15,010/15,000/10 m pattern exists across the current catalogue. The live workflow result is required before making that claim.

**UNPROVEN:** that any inferred ~5 m padding is a disposable halo or establishes a seam transform.

**PRODUCTION STATUS:** `terrain_mosaic.py` remains fail-closed on disagreeing valid overlap. `docs/04-decisions.md` remains unchanged.

## Acceptance for this increment

- focused compiler regression PASS;
- repository baseline PASS on exact PR head;
- live dataset-wide Atom audit completes and uploads JSON evidence;
- evidence artifact contains no raw raster/point-cloud data;
- `production_seam_authority=false` throughout.

## Next

Interpret the exact live dataset-wide statistics. If the pattern is not universal, classify the exceptions before any further seam hypothesis work. If it is universal, treat that only as stronger geometry evidence and continue seeking an explicit Kartverket/Høydedata statement that defines route-core/buffer semantics and intended overlap resolution. Only provider-authoritative evidence can unlock a versioned seam `TransformContract` and the real cold/offline 3×3 promotion gate.
