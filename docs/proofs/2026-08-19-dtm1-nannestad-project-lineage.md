# 2026-08-19 — Nannestad DTM project-lineage probe

## Scope

This proof advances `P0-MULTITILE-TERRAIN-01` by interrogating provider-owned project metadata at exact points inside the already measured 10 m overlap between logical DTM1 tiles `33-125-116` and `33-125-117`.

No raw TIFF/LAS/LAZ is committed or uploaded. No production seam transform is selected.

## Provider surface

The live Høydedata `DTM/ImageServer` exposes primary raster catalog items with project lineage fields including `LAS_PROJECT_ID`, `LAS_PROJECT_NAME`, `PRIORITET`, year/flight date, horizontal/vertical reference fields and source resolution. The provider service itself advertises a `ByAttribute(lowps) + First` default mosaic, but that presentation rule remains separate from authority for the downloadable SHA-addressed DTM1 GeoTIFFs.

The probe queried three EPSG:25833 points within the provider/catalog overlap previously established as y=`6680995..6681005`:

- south: `(282930, 6680996)`
- center: `(282930, 6681000)`
- north: `(282930, 6681004)`

All three returned the same catalog/project membership.

## Live result

Exact head `cd3c66458f0af9169da5e8fe62081a491e29ae4e`, workflow run `32233310171`, passed focused regressions, live provider query, raw-geodata exclusion and evidence upload.

The provider returned 11 primary catalog entries at each sample point. Five entries carry explicit project IDs; six catalog entries do not carry `LAS_PROJECT_ID` and remain unmapped rather than being assigned invented lineage.

The five mapped projects are:

| LAS_PROJECT_ID | Project | Year | PRIORITET | Source resolution | Horizontal | Vertical |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 209 | Ullensaker Nes Nannestad 2010 | 2010 | 1 | 1.0 m | 25832 | 5941 |
| 277 | Romeriksåsene 2013 | 2013 | 1 | 1.0 m | 25832 | 5941 |
| 416 | NDH Akershus 2pkt 2015 | 2015 | 1 | 0.5 m | 25832 | 5941 |
| 4241 | Gjerdrum Ullensaker Nannestad 5pkt 2020 | 2020 | 1 | 0.25 m | 25832 | 5941 |
| 6513 | Romerike 5pkt 2025 | 2025 | 1 | 0.25 m | 25832 | 5941 |

The project-ID set is identical at south/center/north: `[209, 277, 416, 4241, 6513]`.

Each of the three raw JSON metadata responses was 742,450 bytes with SHA-256 `449c058d93a10f6d2c85265bf9267480b93f7514a0f3986686ed12bd7b3b2715`. The uploaded JSON-only evidence artifact is `9358031923`, 1,730 bytes, digest `sha256:cb34934c130af7fdc181d79b204f93ca86f9db4ebeda0869432249d7bc12e8ff`.

## What this proves

Provider-owned DTM project metadata can be spatially bound to the exact Nannestad DTM1 overlap. Multiple historical/current source projects cover the same seam area, and the membership is stable across the tested 8 m north/south span inside the 10 m source-tile overlap.

Critically, all five mapped project candidates advertise `PRIORITET=1`. Therefore the published priority field is non-discriminating for this seam even before considering the still-missing documentation that would be required to interpret it as national-DTM generation authority.

The newest mapped project is `Romerike 5pkt 2025` (`LAS_PROJECT_ID=6513`), but existing provider documentation that selects the newest project is scoped to the `hoydedata_orig` original-LAZ workflow. This proof does not transfer that rule to national DTM1 GeoTIFF overlap resolution.

## Authority boundary

The result deliberately remains:

- `authorizes_overlap_winner=false`
- `production_seam_authority=false`
- `authority_status=UNPROVEN`

It does not prove that `PRIORITET`, newest project, source resolution, ImageServer `lowps`, `First`, filename order, mean/min/max/tolerance, or the observed five-pixel border is the authoritative DTM1 seam transform.

## Result

This closes one candidate path negatively: `PRIORITET` cannot resolve the concrete Nannestad seam because all five provider-linked project sources have the same value. The next useful evidence must come from explicit NHM/DTM generation semantics (for example documented source selection/composition or map-sheet/core clipping), not from more interpretation of the priority field.

`P0-MULTITILE-TERRAIN-01` remains fail-closed. `docs/04-decisions.md` remains unchanged.
