# DTM1 provider edge-domain evidence — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains `FAIL_CLOSED / authority_status=UNPROVEN`.

This pass does not re-test newest/project-priority semantics and does not add more raster-population measurements. It asks one narrower question: does the provider expose additional configuration that makes the nominal 15 km DTM1 domain more explicit relative to the already measured 15,010 × 15,010 source raster?

## New provider-side configuration evidence

Høydedata publishes a small public export-client configuration at:

- `https://hoydedata.no/laserservices/Config/FilesizeLimit.json`

The current file contains a `maptileArea` entry:

- key `15000`;
- area `225000000` m²;
- `225000000 = 15000 × 15000`.

This is a provider-owned configuration signal for a 15,000 m map-tile domain, independent of NWE's measured source-raster geometry.

The current Høydedata `DTM` ImageServer additionally publishes:

- `maxImageWidth = 15000`;
- `maxImageHeight = 15000`.

Provider surface:

- `https://hoydedata.no/arcgis/rest/services/DTM/ImageServer?f=pjson`

That service constraint is supporting evidence only. The repository has already proven that Høydedata ImageServer mosaic rules are endpoint-specific presentation/service behavior and are not authority for the SHA-addressed Atom GeoTIFF overlap.

The official DTM1 dataset record remains the source-family anchor:

- `https://data.norge.no/nb/datasets/1a7327eb-1fa5-3432-8dea-fc198a5ede13/hoyde-dtm1`

It binds the national 1 m DTM1 dataset to the GeoTIFF Atom service and describes the distribution as 15 km routes.

The already reviewed Høydedata StartExport documentation remains additional packaging evidence:

- `https://hoydedata.no/LaserInnsyn2/dok/webtjenester.pdf`
- reviewed SHA-256: `dd04d9513669a922e892cb3f64febefb4c19bb0e6227b6979f5b8e08aa7a0017`;
- reviewed semantic: `MapsheetSize=0` means the dataset's original partitioning.

The live gate pins that PDF digest. If the provider changes the document, CI fails and the semantic must be reviewed again instead of silently inheriting stale meaning.

## Existing measured source geometry reused

Existing accepted repository evidence remains the measurement input; this pass does not re-download the multi-gigabyte TIFFs:

- source raster: 15,010 × 15,010 pixels;
- pixel size: 1 m;
- nominal provider DTM1 tile: 15,000 m;
- excess: 10 m on each raster axis;
- centered integer core candidate: 5 source pixels inset on every side.

The new provider configuration therefore makes the 15,000 m side of the comparison stronger: nominal DTM1 distribution, export map-tile area and DTM service output limit independently converge on 15,000.

## What is proven

`nwe.dtm1-provider-edge-domain/0.1` now records and validates:

- provider nominal DTM1 domain = 15,000 m;
- public export `maptileArea[15000] = 225000000` m²;
- reviewed export original-partition control is present;
- DTM service max image dimensions = 15,000 × 15,000 as a supporting service-domain signal;
- measured Atom source = 15,010 × 15,010 at 1 m;
- one symmetric integer centered-core geometry therefore exists: 5 pixels per side.

The contract fails closed on a changed map-tile area, nominal/export-size mismatch, source raster smaller than the nominal domain, or asymmetric/fractional core inset.

## What is still not proven

None of the provider sources reviewed here says that:

- the 15 km domain is the authoritative sample-ownership domain inside each 15,010 px Atom GeoTIFF;
- the extra 5 px per side are buffer, halo or overscan;
- those samples are non-authoritative and may be discarded;
- adjacent Atom sources must be core-clipped before mosaicking.

Accordingly the current live contract emits:

- `provider_15000_domain_signals_consistent=true`;
- `centered_core_inset_px=5`;
- `explicit_excess_border_semantics_present=false`;
- `authorizes_core_clip=false`;
- `production_seam_authority=false`;
- `authority_status=UNPROVEN`.

A regression explicitly proves that even all current 15,000-domain signals together cannot authorize clipping. A separate future-facing regression shows the minimum evidence shape required for authority: an explicit provider statement must bind the DTM1 source family to an authoritative 15 km core and an exact 5 m per-side excess-buffer rule. Any different explicit buffer size fails as inconsistent with the measured source geometry.

## Why this advances the gate

The unresolved question is now narrower than "is 15 km just catalog prose?". Høydedata's own public export configuration independently encodes a 15,000 m / 225,000,000 m² map-tile domain, while a provider DTM service separately exposes a 15,000 × 15,000 image limit.

That makes the centered 5 px core a strongly provider-aligned geometry candidate, but still not provider-authorized world truth. The distinction matters: repeated agreement around 15,000 cannot substitute for the missing semantic statement about the ten excess source metres.

## Validation and data hygiene

The dedicated hosted workflow:

- runs the edge-domain and seam-matrix regressions;
- fetches only small public provider metadata/configuration surfaces;
- SHA-256-binds all fetched responses;
- checks the reviewed StartExport PDF digest;
- rejects any TIFF/TIFF/LAS/LAZ in the checkout/evidence path;
- uploads only a small JSON evidence artifact with seven-day retention.

No raw terrain, generated runtime tile, cache or credential is committed.

## Decision impact

No change to `docs/04-decisions.md` is justified. `symmetric_5px_core_clip` remains `provider_authorized=false` and cannot yet become the production seam transform.

## Next

Search only for the provider-owned meaning of the ten excess source metres: implementation/configuration/support/product material that explicitly calls the 5 m per-side region buffer/halo/overscan, or otherwise defines sample ownership outside the nominal 15 km DTM1 domain. If such a source-family-bound statement is found, hash-bind it, promote the edge-domain contract, version a provenance-bearing core-clip `TransformContract`, and immediately execute the real cold/live plus source-network-free offline Nannestad 3×3 promotion. Otherwise remain fail-closed.
