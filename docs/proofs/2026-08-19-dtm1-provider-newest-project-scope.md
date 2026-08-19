# DTM1 provider newest-project scope — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains `FAIL_CLOSED / authority_status=UNPROVEN`.

## Provider evidence

Kartverket's current FYSAK Beta manual documents two separate height-source paths:

1. **`Høyder fra hoydedata_orig`** — the NHM project-coverage overview is used to find the **newest mapping project** inside the base area, then relevant original LAZ files are downloaded and used for height calculation.
2. **`Høyder fra WCS`** — `Nasjonal høydemodell Digital terrengmodell` WCS is used as a separate source. It delivers a 1 x 1 m raster; FYSAK states this route is faster than `hoydedata_orig` but gives lower accuracy.

Primary source checked 2026-08-19:

- Kartverket FYSAK Beta(main), chapter 4.3.2–4.3.3: `https://www.kartverket.no/programoppdatering/Fysak_main/Fysak_Hjelp_Beta/Fysak_pdf_1.html`

Kartverket's terrain-data page separately confirms that DTM products are generated from point clouds, distributed as GeoTIFF and also exposed through WCS/WFS/WMS/API surfaces:

- `https://www.kartverket.no/api-og-data/terrengdata`

## New world truth

A provider-owned **newest-project selection rule exists**, but the published scope found here is the original-LAZ `hoydedata_orig` workflow. The same document treats WCS as another source path rather than describing it as the authoritative identity of separately downloaded DTM1 GeoTIFF route tiles.

Therefore the following tempting transformations remain invalid for production:

- choose the newest project/route tile in the 10 m DTM1 GeoTIFF overlap;
- treat WCS composition as the source winner;
- transfer a `hoydedata_orig` project-selection rule into national DTM1 route-tile border semantics;
- infer 5 px border discard solely from the nominal 15 km geometry.

No provider bridge was found that says the downloaded DTM1 GeoTIFF overlap is resolved by the newest project, WCS, filename order, timestamp, min/max, mean or tolerance.

## Implementation

Added `nwe.dtm1-provider-source-scope/0.1` classifier:

- records the explicitly scoped newest-project rule;
- records WCS as a separate 1 m national DTM source when the provider text supports it;
- preserves `newest_project_authorizes_dtm1_overlap_priority=false`;
- preserves `wcs_authorizes_dtm1_overlap_priority=false`;
- preserves `production_seam_authority=false` and `authority_status=UNPROVEN`.

Adversarial regressions reject phrase-only or resolution-only evidence from becoming authority.

## Data hygiene

No raw TIFF/LAS/LAZ, generated terrain, credentials or cache data are committed by this proof.

## Claim calibration

**Proven:** Kartverket documents newest-project selection for the original LAZ workflow and documents WCS as a separate national DTM raster source.

**Not proven:** that either rule governs overlap between the SHA-addressed downloadable DTM1 GeoTIFF route files `33-125-116` and `33-125-117`, or that the 5 px candidate core border is disposable.

## Next

Search for an explicit provider bridge from national DTM1 route-tile generation/export metadata to either project-precedence or nominal-core clipping. If no bridge exists, retain fail-closed production mosaicking and use the WCS only as QA evidence, not source authority.
