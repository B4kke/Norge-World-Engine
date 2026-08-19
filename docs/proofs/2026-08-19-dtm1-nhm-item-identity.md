# DTM1 NHM ImageServer item identity probe — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains fail-closed until the two overlapping Nannestad DTM1 Atom GeoTIFFs can be governed by an evidence-backed, provenance-bearing seam transform.

This probe asks a narrower question: can Høydedata's `NHM_DTM_25833` ImageServer expose enough item-level source identity to bind raster objects 854/855 cryptographically to the SHA-addressed Atom GeoTIFFs `33-125-116.tif` / `33-125-117.tif`?

## Provider surfaces checked

Official Høydedata ImageServer:

- `https://hoydedata.no/arcgis/rest/services/NHM_DTM_25833/ImageServer`
- raster item 854: `33-125-116`
- raster item 855: `33-125-117`
- child `info`
- child `info/keyProperties`
- child `info/metadata`
- `download?rasterIds=854,855`

The probe uses only small JSON metadata responses. It does not request or persist raw TIFF bytes.

Esri's official REST contract documents `Download Rasters` as the operation that returns raw raster file IDs for later use by the `Raster File` resource. That operation requires the image service capability `Catalog, Download`.

## Live observations

The current Høydedata service advertises capabilities:

`Catalog,Image,Metadata`

It does **not** advertise `Download`. Calling `Download Rasters` for exact item IDs 854 and 855 returns provider error code 400 with `Requested operation is not supported by this service.`

The item-level `info` surfaces confirm 1 m F32 raster geometry for the exact logical items. `keyProperties` expose generic raster/band statistics and `AREA_OR_POINT=Area`, but no source URI, file path or file name. The item `metadata` child currently returns provider error 500 `Error retrieving metadata` for both items.

Therefore the ImageServer item surface proves a logical catalog link, not raw-byte identity.

## Implementation

- `nwe_compiler.nhm_item_identity` classifies this source-identity surface without authorizing a seam.
- The classifier keeps `raw_byte_identity_confirmed=false` even in an adversarial future fixture where Download Rasters exposes file IDs/sizes: a file descriptor is still not a cryptographic comparison against the Atom SourceSnapshot SHA-256.
- A visible source URI/path is treated as useful evidence but still does not become byte identity.
- Missing/mismatched 854/855 identities fail closed.
- `tools/geo/dtm1_nhm_item_identity_probe.py` queries the exact provider surfaces and deliberately fails if Høydedata later starts exposing Download or source identity, forcing review of the changed authority surface.
- `.github/workflows/dtm1-nhm-item-identity.yml` runs focused regressions and the live metadata-only probe and rejects TIFF/LAS/LAZ evidence uploads.

## Result

`logical_atom_tile_name_link_confirmed=true`

`raw_byte_identity_confirmed=false`

`production_transform_authorized=false`

`authority_status=FAIL_CLOSED_UNPROVEN`

Current blockers include:

- logical catalog name/geometry is not Atom GeoTIFF byte identity;
- no cryptographic byte comparison exists between the ImageServer item and the Atom SourceSnapshot;
- the service does not advertise Download capability;
- Download Rasters is unavailable;
- item info/key-properties/metadata expose no source URI/path in the current provider response.

## Consequence

The ImageServer raw-file identity path is currently exhausted without downloading from an unsupported operation or inventing provider semantics. Do not spend another agent cycle assuming the service can reveal the source TIFF behind items 854/855 unless the live gate reports that the provider surface changed.

The highest-value seam work remains provider-owned NHM generation/export semantics: an explicit core/buffer/ownership rule for the nominal 15 km DTM1 distribution, or another provider bridge that defines which samples are authoritative in the 10 m overlap. The deterministic 5-pixel-per-side 15 km core remains a candidate geometry only; border discard is still unauthorized.

No entry is added to `docs/04-decisions.md`.
