# DTM1 dataset-wide source-grid audit — 2026-08-18

## Scope

This work advances `P0-MULTITILE-TERRAIN-01` without selecting a terrain seam rule.

The accepted Nannestad evidence already proves two official EPSG:25833 DTM1 source rasters overlap by about 10 m and disagree in valid elevation samples. Earlier metadata-only work established that the two declared extents are geometrically consistent with nominal 15 km route cores plus about 5 m symmetric padding, but explicitly did **not** prove that such padding is a disposable processing halo.

This increment generalizes that diagnostic from one Nannestad pair to an arbitrary set of declared DTM1 route extents and audits the complete current EPSG:25833 DTM1 Atom catalogue.

## Primary-source verification

Checked 2026-08-18 against current Kartverket/Geonorge material:

- Kartverket's terrain-data material describes terrain models as GeoTIFF grids and exposes machine-access services, but no overlap winner rule for downloadable DTM1 route GeoTIFFs was found in this pass.
- Geonorge still exposes the official DTM1 Atom feed under Kartverket/Høydedata.
- Geonorge `Produktspesifikasjon: Punktsky 1.0.3` describes NHM terrain-grid generation from point clouds, including Natural Neighbor interpolation and an average-value fallback. That is grid-generation methodology, not a rule for resolving overlapping downloadable route rasters.

No provider statement found in this pass authorizes first/newest/mean/min/max/tolerance selection or inferred-core clipping for the DTM1 route overlap.

## Implementation

`engine/compiler/src/nwe_compiler/dtm1_source_grid_audit.py` adds `audit_declared_route_grid()`.

The function:

- requires at least two declared routes;
- applies the existing explicit 15 km symmetric-buffer hypothesis to every route;
- finds nominally adjacent route pairs on the tested 15 km grid;
- records pair count, supported-pair count, overlap min/max/mean, center-spacing min/max/mean and inferred nominal-core-gap min/max/mean;
- preserves per-route and per-pair evidence;
- always emits `production_seam_authority: false` and `authority_status: UNPROVEN`.

It is deliberately a regularity audit, not a transform implementation.

## Exact live evidence

GitHub Actions run `32175823952` completed successfully on PR head `cef579d9822b3973863554c8d7c360dd3d4a61d1`. The evidence artifact is JSON metadata only; no GeoTIFF/LAS/LAZ data is present.

Current official Atom snapshot:

- service feed SHA-256: `3b5cf902d36843a92fff19a6b0637c872b8e969c2705880072b88d1491e7ab19`
- dataset feed SHA-256: `47442bf9804a79436f2ebc9b0bc1fd110facd17af5a84b56f32249ddb8134633`
- dataset entries: **2033**
- entries advertising EPSG:25833: **2033**
- entries missing declared extent: **0**
- Nannestad 3×3 unique source count remains: **2**

Applying the deliberately strict symmetric 15 km + buffer hypothesis to transformed declared GeoRSS extents:

- accepted route extents: **1770**
- rejected route extents: **263**
- accepted-route nominal neighbor pairs: **3328**
- neighbor pairs supporting the tested geometry hypothesis: **3328 / 3328**

For those 3328 accepted-route neighbor pairs:

- center spacing: min **14999.870105 m**, mean **14999.996690 m**, max **15000.000005 m**
- raw declared overlap: min **10.000000 m**, mean **10.008678 m**, max **10.359398 m**
- inferred nominal-core gap: min **-0.129895 m**, mean **-0.003310 m**, max **0.000005 m**

The 263 rejected extents are important counter-evidence to a universal symmetric-buffer claim. Examples include transformed declared extents with inferred X/Y half-padding such as ~4.88/5.21 m, ~3.91/6.69 m and ~3.25/7.64 m. These exceptions must not be silently coerced into a 5 m rule.

The most conservative interpretation is that declared GeoRSS footprint geometry is sufficiently regular to strongly support the 15 km route-grid model for a large subset of entries, but is **not** itself precise enough to establish a universal raster-edge/buffer contract across the catalogue. Possible causes such as geographic-footprint precision, transformed polygon geometry or true source-bound variation remain unproven and must be distinguished before using the exceptions diagnostically.

Artifact archive digest: `sha256:2b5bbc5aaf08fb00e175e43190b68819258f4232bb873e8c89ffd80b84ecbb66`.

## Regression coverage

Focused tests cover:

- the exact recovered Nannestad 116/117 geometry;
- a deterministic 2×2 route set with four adjacent pairs and 10 m overlaps;
- fail-closed behavior when a route set contains no nominal neighbors;
- asymmetric extents;
- non-adjacent pair rejection.

The live workflow completed the focused test step and the dataset-wide official Atom audit successfully on the exact PR head above.

## Claim calibration

**FACT:** all 2033 current DTM1 Atom entries in this snapshot advertise EPSG:25833 and expose declared extents.

**FACT:** 1770 declared extents fit the strict tested symmetric-route hypothesis; all 3328 nominal neighboring pairs among that accepted subset are geometrically consistent with it.

**FACT:** 263 declared extents do not fit the strict symmetric-buffer hypothesis within the 0.25 m audit tolerance. Therefore a universal 15,010/15,000/10 m claim from declared GeoRSS metadata is false under this test.

**FACT:** current provider material found in this pass does not provide a downloadable-route overlap priority rule.

**UNPROVEN:** why the 263 declared footprints deviate and whether raw raster bounds for those source objects follow a more exact regular grid than the GeoRSS footprint suggests.

**UNPROVEN:** that any inferred ~5 m padding is a disposable halo or establishes a seam transform.

**PRODUCTION STATUS:** `terrain_mosaic.py` remains fail-closed on disagreeing valid overlap. `production_seam_authority=false`. `docs/04-decisions.md` remains unchanged.

## Next

The highest-value reversible follow-up is to classify the 263 exceptions without downloading the whole dataset: compare declared GeoRSS geometry with provider raster/catalog metadata for a representative stratified sample, especially entries far from the Nannestad area and entries with the largest X/Y padding asymmetry. This can determine whether the deviation is a footprint/projection metadata artifact or reflects genuine raster-bound variation. In parallel, continue seeking an explicit Kartverket/Høydedata statement defining route-core/buffer semantics and intended overlap resolution. Only provider-authoritative evidence can unlock a versioned seam `TransformContract` and the real cold/offline 3×3 promotion gate.
