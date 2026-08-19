# DTM1 NHM generation/distribution bridge — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains `FAIL_CLOSED / authority_status=UNPROVEN`.

This pass deliberately does not re-test whether a provider-owned newest/update rule exists. That scope is already documented. The question here is narrower: can current Kartverket/Geonorge/Høydedata material bridge NHM project/update semantics to the downloadable national DTM1 source family and its nominal 15 km distribution, without inventing semantics for the observed 15,010 px rasters?

## Provider-owned generation chain

Kartverket's formally approved `Punktsky 1.0.3` product specification documents two relevant FvL semantics:

- `NHM Oppdateres` states whether høydedata.no automatically updates the national detailed height model;
- the point cloud is the primary FvL dataset and all products are derived from it automatically, with possible artifacts in project grids and national grids.

Primary source:
- `https://dokument.geonorge.no/produktspesifikasjoner/punktsky/1.0.3/index.html`

The current official `Høyde DTM1` dataset record then makes the missing product-family connection explicit:

- project grids are generalized to the 1 m NHM grid, identified as `DTM1 / DOM1`;
- the same DTM1 dataset record exposes `DTM1 Atom feed-tjeneste` as a GeoTIFF API/distribution;
- that Atom distribution is described as the national 1 m DTM1 model and as divided into 15 km tiles.

Primary source:
- `https://data.norge.no/nb/datasets/1a7327eb-1fa5-3432-8dea-fc198a5ede13/hoyde-dtm1`

This is stronger than the earlier WMS/newest evidence because generation semantics and the downloadable Atom source family now meet in the same official DTM1 dataset identity.

## Provider-owned export/packaging support

Høydedata's public export help describes the national height model as current projects stitched together and exposes file splitting by map-sheet divisions. Its download help says DTM1/DOM1 are grouped from nearby map sheets and that NHM metadata contains both terrain-model map-sheet divisions and metadata about projects used to generate NHM.

Primary sources:
- `https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic130.htm`
- `https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic210.htm`

The provider's `StartExport` service documentation adds a machine-facing configuration surface:

- `Format=5` is GeoTIFF;
- split NHM export requires EPSG:25833;
- with `NHM=1`, `Projects` accepts `DTM1` among the national height-model datasets;
- `MapsheetSize=0` means the dataset's original partitioning;
- `ProjectMerge=0` means map-sheet file splitting using `MapsheetSize`.

Primary source:
- `https://hoydedata.no/LaserInnsyn2/dok/webtjenester.pdf`

The export configuration is supporting source-family evidence only. No reviewed provider statement proves that a `StartExport` result is byte-identical to a static Atom GeoTIFF, and this pass does not promote such an identity.

## What is now proven

The provider-owned semantic chain is now materially narrower and stronger:

`NHM-update-eligible project -> automatic FvL derivation -> project grid -> NHM 1 m DTM1 -> downloadable DTM1 Atom source family -> nominal 15 km tiles`

The Høydedata export surface independently confirms that national DTM1 exists as an exportable NHM dataset with an original-dataset partition control and map-sheet splitting.

`nwe.dtm1-nhm-generation-distribution-bridge/0.1` records this as:

- `generation_distribution_bridge_supported=true` when all required provider facts are supplied;
- `export_byte_identity_proven=false`;
- `authorizes_excess_border_discard=false`;
- `production_seam_authority=false`;
- `authority_status=UNPROVEN`.

A hosted live probe SHA-256-binds the current provider HTML/PDF surfaces and requires the generation/source-family markers that can be checked safely without downloading raw terrain. The PDF is signature/hash checked in CI; its table semantics above are a reviewed-document claim, not a fragile raw-PDF string search.

## The one remaining semantic break

Existing real-raster evidence already establishes that the relevant source family does not arrive as a 15,000 × 15,000 raster. The tested files are 15,010 × 15,010 at 1 m, adjacent source centers are approximately 15,000 m apart, and the raw extents overlap by approximately 10 m. That geometry yields one centered integer-pixel candidate: a 15,000 × 15,000 core after a 5 px inset on every side.

The provider sources reviewed in this pass still do **not** say any of the following:

- that the 15 km map-sheet domain is the authoritative sample ownership domain inside each 15,010 px GeoTIFF;
- that the extra five pixels on each side are a disposable buffer, halo or overscan;
- that adjacent Atom GeoTIFFs must be core-clipped before mosaicking;
- which samples are authoritative if the excess border is not disposable.

Therefore the new bridge must not be misread as a seam rule. `symmetric_5px_core_clip` remains deterministic and DTM1-source-bound, but `provider_authorized=false`.

## Validation boundary

The focused regression suite is designed to prove the negative boundary as well as the positive bridge:

- a complete provider generation/distribution bridge still cannot authorize border discard;
- an incomplete DTM1 source-family link remains fail-closed;
- malformed/non-boolean evidence is rejected;
- a 15,010 m nominal-tile claim is rejected because the provider contract says the distribution unit is 15,000 m, not because the raw raster happens to span 15,010 m.

No TIFF/LAS/LAZ, generated terrain/cache data or credentials are committed by this proof.

## Decision impact

No change to `docs/04-decisions.md` is justified. The production seam transform remains unselected.

## Next

Search only for the final provider-owned edge-domain contract: NHM/DTM generation/export code, configuration, product documentation or support material that explicitly defines the 15 km DTM1 map-sheet sample domain and explains the 15,010 px / 10 m excess. If Kartverket states that the excess five pixels per side are buffer/overscan outside the authoritative 15 km core, version that rule as a provenance-bearing seam `TransformContract` and immediately execute the real cold/live plus source-network-free offline 3×3 promotion. Otherwise remain fail-closed.
