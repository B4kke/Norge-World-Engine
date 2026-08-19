# FORGE proof — provider mosaic surface divergence

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Role: FORGE

## Question

Can Høydedata's own live mosaic-service metadata establish the missing deterministic seam rule for overlapping downloadable DTM1 GeoTIFF source snapshots?

## Fresh provider evidence

Two current provider-owned ArcGIS ImageServer surfaces expose explicit but different composition contracts:

- `DTM` (EPSG:25833) advertises `ByAttribute`, numeric `LOWPS` sort field, `First` mosaic operator and bilinear resampling. Its catalog also exposes project metadata such as `LAS_PROJECT_ID`, `PRIORITET`, `AARSTALL`, `OPPLOSNING` and source/datum metadata.
- `NHM_DTM_25833` advertises a 1 m EPSG:25833 surface with `ByAttribute`, string `NAME` sort field, `First` mosaic operator and bilinear resampling.

The contracts are therefore endpoint-specific: the provider does not expose one universal sort field/policy across these two DTM-related mosaic surfaces.

The existing official Punktsky 1.0.3 specification remains relevant context: FvL treats the point cloud as the primary dataset and automatically derives project/national grids from it, with possible artefacts in those derived grids.

## Implementation

Added:

- `engine/compiler/src/nwe_compiler/dtm1_provider_mosaic_surface.py`;
- `engine/compiler/tests/test_dtm1_provider_mosaic_surface.py`;
- `.github/workflows/dtm1-provider-mosaic-surface.yml`.

The classifier fails closed on unknown service identity, CRS, pixel size, sort field or sort-field type. It records the provider contracts but permanently emits `production_seam_authority=false` / `authority_status=UNPROVEN`.

The live workflow fetches both official service JSON documents, SHA-256-binds the exact responses, validates the expected endpoint-specific contracts and uploads only JSON evidence. TIFF/LAS/LAZ are forbidden from the evidence workspace.

## What this proves

- Høydedata owns explicit deterministic mosaic configuration at the ImageServer service level.
- The general `DTM` and `NHM_DTM_25833` services currently use different sort fields and field types (`LOWPS` numeric vs `NAME` string).
- A mosaic rule observed on one Høydedata service cannot be silently generalized as the authoritative overlap rule for another surface or for separately downloaded DTM1 GeoTIFF source snapshots.

This narrows the remaining uncertainty: the problem is no longer whether Høydedata can expose deterministic composition behavior; it clearly can. The unresolved question is whether Kartverket/Høydedata defines which service or source-level contract is authoritative for the downloadable DTM1 route overlap used by NWE.

## What this does not prove

This evidence does **not** authorize:

- `LOWPS` priority for downloadable DTM1 route rasters;
- `NAME` ordering for downloadable DTM1 route rasters;
- `First`, newest, mean, min/max, tolerance or lexical filename priority in NWE;
- a 15 km authoritative core or disposable ~5 m halo;
- equivalence between ImageServer catalog items and the exact SHA-addressed Atom GeoTIFF source bytes;
- treating a seamless ImageServer/WCS result as source authority;
- a production seam `TransformContract`.

Therefore `P0-MULTITILE-TERRAIN-01` remains fail-closed.

## Source/data contract impact

No new authoritative source is adopted. No raw geodata is committed. Existing DTM1 coverage, 1 m resolution, EPSG:25833 source CRS, NN2000 semantics, NLOD/open redistribution/attribution and SHA-addressed raw-cache rules remain unchanged.

## Next

Interrogate provider metadata/catalog relations around the exact Nannestad pair to determine whether the downloadable national-grid GeoTIFFs carry a source-generation/core/index identity that links them to one explicit provider mosaic contract. If no such linkage exists, continue fail-closed rather than converting service presentation semantics into source authority.
