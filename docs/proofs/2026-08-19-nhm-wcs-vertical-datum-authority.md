# FORGE proof — NHM WCS vertical datum authority boundary

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Role: FORGE  
Integration owner: SENTINEL

## Question

Can the official `NHM DTM 25832 WCS` be bound to NN2000 without inferring vertical semantics from an anonymous GeoTIFF Z channel?

## Provider evidence

Kartverket's current reference-level guidance states that official geographic data over land that carry height use the national height system, and identifies NN2000 as the land reference in Norway:

`https://www.kartverket.no/til-sjos/se-havniva/referanseniva/hva-er-et-referanseniva`

The WCS candidate is separately bound to Kartverket/Geonorge service metadata UUID `05821c51-2f5b-411f-9098-924d13dbea9a`, dataset id `8c62e33e-76ba-3c00-9db6-3a10e44135bc`, coverage `nhm_dtm_topo_25832` and horizontal CRS `EPSG:25832`.

The individual GetCoverage GeoTIFF still does not advertise a compound vertical CRS. The datum therefore comes from the provider's official land-height reference policy plus the exact national DTM service identity, not from raster-band guessing.

## Implementation

`engine/compiler/src/nwe_compiler/nhm_wcs_vertical_authority.py` adds `nwe.nhm-wcs-vertical-datum-authority/0.1`.

The contract:

- binds only the exact known NHM DTM 25832 WCS service/dataset/coverage/CRS identity;
- records `NN2000` and `z_semantics=normal_height_m`;
- records Kartverket's land-height reference authority locator and scope;
- fails closed if service UUID, dataset id, coverage or horizontal CRS differ;
- explicitly records `getcoverage_vertical_crs_explicit=false`;
- explicitly records `production_source_selected=false` and `task_queue_reconciled=false`.

Adversarial regressions cover the exact happy path plus four identity mismatches.

## Claim calibration

### Supported

The exact official NHM DTM 25832 WCS identity has provider-level support for interpreting land terrain heights in NN2000. This is stronger than the previous source-family-only inference and removes the need to infer datum from anonymous raster Z.

### Still open

This does **not** make WCS the selected Prototype-0 production source. Canonical `docs/06-task-queue.md` still defines WCS as diagnostic for `P0-MULTITILE-TERRAIN-01` and requires unchanged center bytes from the accepted D-007 Atom path. The direct-WCS candidate deliberately changes the center artifact identity.

Therefore the former branch-local D-008 acceptance claim has been removed from `docs/04-decisions.md`. The source-family transition is now explicitly returned to **Open decisions** pending SENTINEL reconciliation of the canonical acceptance contract.

## Result

`vertical datum authority = SUPPORTED for the exact NHM DTM 25832 WCS identity`  
`production source selection = OPEN`  
`P0-MULTITILE-TERRAIN-01 = NOT CLOSED by this proof alone`
