# DTM1 Atom ↔ NHM ImageServer extent crosscheck — 2026-08-18

## Scope

This proof advances `P0-MULTITILE-TERRAIN-01` without selecting or weakening the production terrain seam policy.

The previous dataset-wide audit found **263 / 2033** current DTM1 Atom entries whose transformed GeoRSS extents do not fit the deliberately strict symmetric `15 km route + tested 10 m overlap` geometry within 0.25 m. The unresolved question was whether those exceptions reflect genuine provider raster-bound variation or imprecision/differences in the declared GeoRSS footprint representation.

This increment compares those 263 exceptions with a second provider-published geometry surface: primary raster footprints in Høydedata's `NHM_DTM_25833` ImageServer catalog. It does not download any GeoTIFF, LAS or LAZ data and does not treat the ImageServer as automatic source authority.

## Method

The live workflow:

1. downloads the current official Kartverket/Geonorge DTM1 Atom service + dataset metadata;
2. transforms every declared GeoRSS extent to EPSG:25833 with `pyproj` and applies the existing strict route-geometry diagnostic;
3. resolves each rejected Atom entry's logical source name from its **explicit GeoTIFF link** (`geotiff_href`) for cross-system linkage only;
4. queries Høydedata `NHM_DTM_25833/ImageServer` primary catalog items (`CATEGORY=1`) in EPSG:25833 using paginated provider queries;
5. compares provider catalog polygon bounds against the corresponding rejected Atom extent using `nwe.dtm1-declared-catalog-extent-crosscheck/0.1`;
6. emits JSON evidence with `production_seam_authority=false` / `authority_status=UNPROVEN`;
7. rejects TIFF/TIFF/LAS/LAZ files from the evidence workspace before upload.

The tested 15,010 m catalog geometry remains a diagnostic hypothesis derived from the documented 15 km route size plus the independently observed 10 m provider overlap. It is not encoded as a production transform.

## Exact live result

GitHub Actions run `32181190855` (`dtm1-extent-crosscheck`, run 1) passed against FORGE code head `b95e924a57188626a903ca34a1b01417ea83f875` through PR merge ref `9a9360e4c3791bcbe825eb76e19f5e932ac85c66`.

Focused regression result:

- `4 passed in 0.01s`.

Live provider crosscheck summary:

- current Atom dataset entries: **2033**;
- Atom extents rejected by the strict prior geometry diagnostic: **263**;
- primary ImageServer catalog items returned: **2363**;
- rejected Atom entries matched to an ImageServer primary item: **263 / 263**;
- rejected Atom entries missing a catalog match: **0**;
- classification `CATALOG_REGULAR_DECLARED_DEVIATES`: **263 / 263**;
- `production_seam_authority`: **false**;
- status: `EXTENTS_CLASSIFIED_NOT_AUTHORITY`.

The evidence ZIP contains only the JSON proof, is **44,109 bytes**, and has digest:

`sha256:bac85fba20e57e6698916179615e6794fc2e371cd38a328635161a33a6416de1`

The raw-geodata exclusion step passed.

Repository integration on the same FORGE code head also passed:

- baseline run `32181190793` — PASS;
- `dtm1-multitile-source-plan` run `32181190814` — PASS;
- `dtm1-extent-crosscheck` run `32181190855` — PASS.

## What this proves

**FACT:** every one of the 263 transformed Atom GeoRSS extents that failed the strict symmetric route test has a provider ImageServer primary catalog item with the same logical source name derived from the Atom entry's explicit GeoTIFF href.

**FACT:** all 263 corresponding ImageServer catalog footprints fit the tested 15,010 × 15,010 m geometry within the same 0.25 m diagnostic tolerance, while their transformed Atom GeoRSS extents do not.

**FACT:** the ImageServer primary catalog currently contains more objects (**2363**) than the current Atom dataset (**2033**). The two surfaces therefore must not be treated as identical dataset snapshots or equivalent source inventories.

**INFERENCE:** the 263 earlier exceptions are not evidence that the provider's ImageServer catalog itself has the same irregular footprint geometry. This substantially weakens the hypothesis that the observed Atom deviations alone demonstrate genuine source-raster boundary variation.

## What remains unproven

This does **not** prove any of the following:

- that the ImageServer catalog polygon is byte/pixel-identical to the downloadable Atom GeoTIFF's actual raster bounds;
- that the ImageServer and Atom inventories have identical snapshot/update semantics;
- that the approximately 5 m padding implied by a 15,010 m footprint is a disposable processing halo;
- that clipping at an inferred 15 km core is provider-authoritative;
- that `First`, lexical filename ordering, newest, mean, min/max or tolerance is an authorized overlap winner;
- that Høydedata's ImageServer default mosaic configuration defines the intended seam semantics of the downloadable Atom GeoTIFF files.

Therefore `terrain_mosaic.py` remains deliberately fail-closed on disagreeing valid overlap, no seam `TransformContract` is promoted, and `docs/04-decisions.md` remains unchanged.

## Next

The highest-value reversible experiment is now narrower: bind a representative stratified subset of the 263 logical names to **actual downloadable GeoTIFF raster metadata** (bounds, transform, width/height, pixel size, CRS, nodata and exact SHA-addressed source identity) and compare those byte-source raster bounds with both Atom GeoRSS and ImageServer catalog footprints.

If the actual GeoTIFF bounds also follow the exact catalog grid while GeoRSS deviates, GeoRSS can be rejected as a seam-boundary authority. If actual GeoTIFF bounds vary, the catalog is only a normalized provider footprint. In either case, production remains fail-closed until Kartverket/Høydedata documentation or equally authoritative source semantics establish what overlap samples are intended to survive in a deterministic provenance-bearing transform.
