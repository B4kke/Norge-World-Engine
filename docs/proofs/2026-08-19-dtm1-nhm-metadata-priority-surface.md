# DTM1 NHM metadata priority surface — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains fail-closed until a deterministic, provenance-bearing seam transform is supported by provider evidence.

## Primary provider/service evidence

Kartverket's current terrain-data documentation states that machine interfaces include WCS/WFS/WMS plus REST services for automated download and metadata search from hoydedata.no.

The public Data Norge service registry entry **Høydedata - laser - Høydedata Metadata WFS** describes the WFS as project metadata from hoydedata.no and explicitly advertises these layers:

- `Bestilt punktetthet`
- `NHM prosjektalder`
- `NHM prosjektdekning`
- `prioritet 1`
- `prioritet 2`
- `prioritet 3`
- `Prosjekttype`

Registry endpoint:
`https://wfs.geonorge.no/skwms1/wfs.hoyde-hoydedata-metadata?service=wfs&request=getcapabilities`

Registry metadata:
`https://data.norge.no/nb/data-services/5e0dcef6-7a5b-3d0f-8dd4-2422263bd0fe/hoydedata-laser-hoydedata-metadata-wfs`

Høydedata's own help separately documents a REST `ProjectMetadata.ashx` surface whose filterable metadata includes `Prioritet`, project number, coverage number, year/date, coordinate system, height system, resolution and other project attributes.

## What this proves

There is a provider-owned, machine-readable metadata surface that combines NHM project coverage/age with explicit priority-class layers. This is stronger than inferring priority from filenames, timestamps or arbitrary ordering and gives FORGE a concrete next source to interrogate for exact Nannestad project lineage.

The implementation `nwe.dtm1-nhm-metadata-surface/0.1` treats those fields as **candidate provenance evidence only**.

## What this does not prove

No reviewed provider source found in this pass defines:

- what `prioritet 1/2/3` means for generation of the national 1 m DTM;
- whether lower or higher numeric class wins;
- whether the classes apply per project, per area, per epoch, or per output product;
- whether a priority class controls the separately packaged DTM1 GeoTIFF overlap;
- whether the observed 5 px border is disposable overscan;
- any exact overlap winner for `33-125-116` vs `33-125-117`.

Accordingly:

`candidate_priority_metadata_present=true`

`authorizes_overlap_winner=false`

`production_seam_authority=false`

`authority_status=UNPROVEN`

## Validation

Four adversarial regressions cover the contract:

1. the complete advertised metadata surface is accepted as evidence but not seam authority;
2. a missing priority layer fails closed;
3. even an explicit future priority-semantics flag cannot silently promote this classifier to production seam authority;
4. malformed layer input is rejected.

No raw TIFF/LAS/LAZ, generated terrain/cache data or credentials are included in this proof.

## Next

Query the machine-readable NHM project coverage/priority metadata for the exact Nannestad seam area and bind returned project IDs/priority classes to `33-125-116` / `33-125-117` only if provider metadata supports that relation. Then locate provider documentation defining the priority-class semantics. Until both the binding and semantics are established, the production multi-tile seam remains fail-closed.
