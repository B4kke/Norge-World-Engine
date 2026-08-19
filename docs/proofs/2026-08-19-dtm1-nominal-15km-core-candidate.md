# FORGE proof — DTM1 nominal 15 km core candidate

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Role: FORGE

## Question

Does current provider documentation plus measured real-raster geometry establish a deterministic spatial core candidate without inventing a first/newest/mean/tolerance winner?

## Provider evidence

Kartverket's current DTM1 API catalog describes DTM1 as the **national 1 m height model** managed in Høydedata and states that the data are **divided into 15 km tiles**.

- `https://data.norge.no/en/data-services/df1adc4b-7575-351a-b9d4-4891decc8b16/dtm1-atom-feed-tjeneste`
- observed 2026-08-19; publisher: Statens kartverk; catalog page reports last update 2026-03-20 and CC BY 4.0.

Høydedata's provider help separately describes `Nasjonal høydemodell` as national height models where all current/relevant projects are **stitched together** before distribution/export.

- `https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic130.htm`
- observed 2026-08-19.

The download help says DTM1 is grouped from nearby map-sheet tiles and that NHM metadata contains the map-sheet subdivisions plus metadata for projects used to generate NHM:

- `https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic210.htm`

These statements narrow the product semantics: the Atom DTM1 service distributes a national model in nominal 15 km tile units; it is not documented as a collection of independent project grids.

## Existing measured raster evidence reused

Prior FORGE live probes established that the actual DTM1 GeoTIFF raster grid is 1 m, EPSG:25833 and 15010 × 15010 pixels for the accepted Nannestad source and for the full tested anomaly population. Dataset-wide adjacency measurements also showed nominal neighbor spacing at approximately 15000 m and approximately 10 m physical overlap. Those measurements remain evidence of geometry, not permission to discard values.

## New derivation

`nwe_compiler.dtm1_nominal_tile_contract` now expresses the narrow derivation only:

- provider nominal tile span = 15000 m;
- measured raster span = 15010 m at 1 m/pixel;
- excess = 10 m per axis;
- the unique **symmetric integer-pixel** core compatible with both facts is therefore an inset of 5 pixels on each side;
- derived core = 15000 × 15000 pixels / 15000 × 15000 m.

The implementation fails closed if the excess would require a half-pixel/asymmetric integer core, if the raster is smaller than the provider nominal tile, or if the provider stitched-national-model premise is absent.

## Claim calibration

### Proven / deterministic from current inputs

- The provider describes the DTM1 distribution as nominal 15 km tiles of the national 1 m model.
- The measured real files are physically larger than that nominal tile footprint.
- For a 15010 × 15010 raster at exactly 1 m/pixel, a centered 15000 m core has exactly a 5-pixel inset on every side.
- This spatial core candidate requires no file order, timestamp, averaging, tolerance winner, min/max or ImageServer mosaic-order guess.

### Still not proven

Provider documentation found so far does **not** explicitly say that the 5-pixel border is a disposable halo/buffer, nor that clipping it is the source-authoritative seam rule for the Atom GeoTIFF bytes. The derivation therefore remains a candidate transform geometry, not production seam authority.

`production_seam_authority=false`  
`authorizes_border_discard=false`  
`authority_status=UNPROVEN`

## Why this advances the gate

The remaining ambiguity is no longer "where would a 15 km core be if the 15010 raster contains a symmetric border?" That geometry is now deterministic and regression-tested. The unresolved question is strictly semantic: whether Kartverket authorizes the 10 m excess as non-authoritative overlap/buffer or provides an equivalent ownership rule.

## Data hygiene

No TIFF/LAS/LAZ, generated runtime tiles or credentials are committed. This proof contains provider URLs, measured dimensions already represented in repository evidence, and the derived contract only.

## Next

Use the exact Nannestad pair and provider NHM metadata/download surfaces to seek one final semantic link: an explicit buffer/core statement, tile-index ownership rule, or export-generation metadata that identifies the 15 km nominal tile as the authoritative sample domain. If that link is found, version a real seam `TransformContract` and run the cold/offline 3×3 acceptance gate. If not, keep the candidate non-authoritative and remain fail-closed.
