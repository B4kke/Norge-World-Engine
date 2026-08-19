# DTM1 embedded metadata audit — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains `FAIL_CLOSED / authority_status=UNPROVEN`.

## Scope

This proof checks metadata embedded in the exact two DTM1 GeoTIFF sources at the Nannestad source seam: `33-125-116.tif` and `33-125-117.tif`. Rasterio/GDAL opened the remote files for metadata only; raw GeoTIFFs were not persisted or uploaded.

## Result

GitHub Actions run `32218599218`, job `95964692333`, completed successfully. Focused regressions: `4 passed in 0.01s`.

Both files exposed default metadata plus `IMAGE_STRUCTURE` and `DERIVED_SUBDATASETS`. Both reported `AREA_OR_POINT=Area`, `COMPRESSION=LZW`, and `INTERLEAVE=BAND`. The derived-subdataset entries were GDAL log-amplitude descriptors referencing the source URL. Source 116 reported TIFF min/max sample values `104 / 419`; source 117 reported `130 / 688`.

No exposed metadata tag contained an explicit provider statement defining a core, border buffer, overlap rule, or an instruction for resolving the overlapping samples. The audit therefore reports `explicit_border_discard_semantics=false`, `production_seam_authority=false`, and `authority_status=UNPROVEN` for both sources.

## Evidence package

Only JSON evidence was uploaded. Raw TIFF/LAS/LAZ exclusion passed.

- artifact ID: `9353170576`
- ZIP size: `1394 B`
- ZIP SHA-256: `154d6a2d0c004529580601f53d17b8445a56122da4e3b49a63506f819ca30f40`

## Claim calibration

**Proven:** the GeoTIFF/GDAL metadata exposed by the exact Nannestad seam pair does not provide the missing provider-owned seam semantics.

**Not proven:** that no other provider metadata exists outside the exposed TIFF tag surface; that the five-pixel candidate border is non-authoritative; source priority; overlap winner; or a production seam transform.

`terrain_mosaic.py` must therefore remain fail-closed on conflicting valid overlap. No change to `docs/04-decisions.md` is justified.

## Next

Do not spend more sampling effort on embedded TIFF tags for this seam pair. The highest-value remaining evidence is provider-owned DTM1 generation/export configuration or technical documentation that explicitly connects the nominal 15 km route to the observed 15010-pixel raster extent and defines how adjacent source samples are intended to compose.
