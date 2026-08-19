# 2026-08-19 — DTM1 NHM update-scope evidence

## Scope

This proof advances `P0-MULTITILE-TERRAIN-01` by checking whether provider-published "latest project" semantics can legitimately select values in the downloadable DTM1 GeoTIFF overlap. It does not add raw geodata to Git and does not select a production seam transform.

## Provider evidence

Current official provider metadata for **Høydedata - laser - Digital terrengmodell WMS** states that the service is the display service for the digital terrain model in Høydedata and that the **latest project is displayed based on which projects update the national height model**.

Primary metadata surface checked 2026-08-19:

- `https://data.norge.no/nb/data-services/8cf50db2-aa33-3320-b5f9-dc47adb080b3/hoydedata-laser-digital-terrengmodell-wms`
- publisher: Statens kartverk
- endpoint advertised by that metadata: `https://wms.geonorge.no/skwms1/wms.hoyde-dtm?request=GetCapabilities&service=WMS`
- metadata published 2026-02-05 and last updated 2026-03-20 according to the provider catalog page.

Høydedata help also distinguishes **Nasjonal høydemodell** as national models where current projects are stitched together, while export/file subdivision is a separate operation. This supports treating project-update semantics and downloadable tile packaging as separate layers rather than silently equating them.

## Implementation

`nwe_compiler.dtm1_nhm_update_scope` encodes the provider statement as a scope contract:

- provider-owned latest-project/update semantics are recognized;
- the evidence is explicitly tagged as the DTM WMS / NHM display surface;
- downloadable DTM1 source binding is `false`;
- an explicit DTM1 overlap rule is `false`;
- production seam authority remains `false`.

The contract fails closed if a caller tries to claim an explicit DTM1 overlap rule without first binding the evidence to the downloadable DTM1 source family.

`engine/compiler/tools/probe_dtm1_nhm_update_scope.py` fetches the current official metadata page, records response byte size and SHA-256, requires the provider's latest-project/NHM-update markers, and emits only JSON evidence. The dedicated CI gate also checks that no TIFF/LAS/LAZ is present in the checkout/evidence path.

## Seam-matrix consequence

The `newest_project` candidate is now calibrated more precisely. Provider-owned newest/update semantics exist in more than one surface:

1. earlier evidence documents newest-project selection in the `hoydedata_orig` / original-LAZ workflow;
2. current provider metadata documents latest-project display based on projects that update NHM for the DTM WMS.

Neither source is a provider statement that the separately downloadable, SHA-addressed national DTM1 GeoTIFF overlap must use newest project as its winner rule. Therefore:

- `newest_project.provider_authorized = false` for the DTM1 seam;
- `newest_project.source_bound = false`;
- `production_seam_authority = false`;
- `authority_status = UNPROVEN`.

## What this proves

It is no longer accurate to say that provider-owned newest/update semantics are absent. They exist and are explicitly related to NHM updates. What remains absent is the critical **source-family bridge** from those semantics to the downloadable DTM1 GeoTIFF seam.

This narrows the unresolved question but does not authorize newest-project selection, 5 px border discard, ImageServer `LOWPS + First`, mean/min/max/tolerance, or filename ordering.

`docs/04-decisions.md` remains unchanged because no production transform is proven.
