# DTM1 source-grid geometry audit — 2026-08-18

## Scope

This proof narrows `P0-MULTITILE-TERRAIN-01`. It does **not** select or promote a production seam rule.

The accepted Nannestad 3×3 planning proof requires two official DTM1 GeoTIFF source objects. The raw rasters overlap by about 10 m and valid elevations disagree by up to 0.241989136 m, so the compiler correctly remains fail-closed.

## Provider facts checked

- Kartverket/Data.norge describes the DTM1 Atom API as DTM1 data split into **15 km routes**, distributed as GeoTIFF through the official Atom feed.
- DTM1 is a 1 m terrain model and the project keeps EPSG:25833 + NN2000 explicit for these raw source objects.
- Kartverket's point-cloud product specification describes point clouds as the primary data and project/national grids as automatically derived products where grid-generation artifacts may occur.
- No provider documentation found in this investigation specifies that an overlap cell must be resolved by first source, newest timestamp, mean/min/max, tolerance, or by discarding an inferred edge halo.

Therefore the following geometry result is a diagnostic hypothesis only.

## Recovered exact planning evidence

The still-retained GitHub Actions artifact from the merged multi-tile foundation source-plan run records:

- service feed SHA-256: `3b5cf902d36843a92fff19a6b0637c872b8e969c2705880072b88d1491e7ab19`
- dataset feed SHA-256: `47442bf9804a79436f2ebc9b0bc1fd110facd17af5a84b56f32249ddb8134633`
- dataset entries: `2033`
- Nannestad 3×3 unique DTM1 sources: `2`

Declared source geometry transformed to EPSG:25833 in that proof:

| Source | Declared EPSG:25833 bounds | Width | Height |
| --- | --- | ---: | ---: |
| `33-125-116.tif` | `[275425.00010278344, 6665994.99998838, 290435.000100316, 6681005.000012783]` | 15009.999998 m | 15010.000024 m |
| `33-125-117.tif` | `[275425.00010301, 6680994.999986657, 290435.0001004398, 6696005.000011843]` | 15009.999997 m | 15010.000025 m |

The adjacent extents overlap by about `10.000026 m`. Their centers are separated by about `15000 m` on Y.

## Tested hypothesis

Given the provider's documented nominal route size of 15,000 m, each declared extent is geometrically consistent with a symmetric buffer of about 5 m on every side:

- inferred buffer source 116: ~5 m X / ~5 m Y;
- inferred buffer source 117: ~5 m X / ~5 m Y;
- raw declared overlap: ~10 m;
- sum of inferred adjacent buffers: ~10 m;
- inferred 15 km nominal cores meet at approximately the same boundary, with ~0 m gap/overlap within the audit tolerance.

`engine/compiler/src/nwe_compiler/dtm1_source_grid_audit.py` makes this calculation explicit. Its output deliberately contains:

- `authority_status: UNPROVEN`
- `production_seam_authority: false`
- assumption text identifying the inferred buffer as a **non-authoritative** processing-halo hypothesis.

Focused local regression result before publication: `3 passed`.

A lightweight workflow, `dtm1-source-grid-geometry-audit.yml`, repeats the geometry audit against the current official Atom metadata without downloading either multi-gigabyte raw GeoTIFF. It uploads only the small JSON audit result and must report `HYPOTHESIS_SUPPORTED_NOT_AUTHORITY`; it cannot promote terrain.

## Claim calibration

**FACT:** provider documentation says the DTM1 API is divided into nominal 15 km routes. The exact Nannestad source metadata used by the existing planning proof exposes ~15010 m declared extents, adjacent center spacing of ~15000 m and ~10 m overlap.

**SUPPORTED GEOMETRY HYPOTHESIS:** those extents are mathematically consistent with a nominal 15 km core plus ~5 m symmetric buffer.

**UNPROVEN ASSUMPTION:** the ~5 m outside each inferred nominal core is merely a disposable processing halo whose samples may be excluded when two official files overlap.

**PRODUCTION STATUS:** unchanged and fail-closed. `terrain_mosaic.py` must continue rejecting disagreeing overlap. No change to `docs/04-decisions.md` is justified by this evidence.

## Next evidence needed

The highest-value next step is provider-authoritative confirmation of tile/grid edge semantics: Kartverket metadata/specification/support material that explicitly defines the 15 km route core, any extra edge pixels/buffer, and how adjacent raster values are intended to be combined. If that cannot be established, expand this same metadata-only audit across many adjacent DTM1 source pairs to determine whether the 15010/15000/10 m pattern is universal or only local. Statistical regularity would reduce uncertainty but still would not by itself become source authority.
