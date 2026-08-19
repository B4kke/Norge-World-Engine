# DTM1 NHM packaging semantics — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` remains `FAIL_CLOSED / authority_status=UNPROVEN`.

## Provider evidence

Høydedata's public help documents four related facts about the national height model and its distribution:

1. `Nasjonal høydemodell` is described as a national height model where all current projects are stitched together.
2. The export dialog exposes `Filoppdeling`, including clipping to map-sheet divisions (`kartblad-inndelinger`).
3. The download help says DTM1/DOM1 are grouped into blocks based on nearby map sheets.
4. The same download help says NHM metadata contains the map-sheet divisions for the terrain models together with metadata for the projects used to generate NHM.

Primary provider pages inspected:
- `https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic130.htm`
- `https://test.hoydedata.no/LaserInnsyn2/help_no/topics/idh-topic210.htm`

## What this establishes

These statements provide a provider-owned semantic boundary between the generated national model and map-sheet-based distribution/packaging. They support treating downloadable DTM1 tiles as packaging units of a generated NHM rather than assuming each overlapping GeoTIFF independently carries a source-priority rule.

This is consistent with earlier measured evidence: the known DTM1 anomaly population opens as regular 15010 x 15010, 1 m rasters while Kartverket describes the nominal DTM1 division as 15 km tiles. The excess ten pixels remain geometrically compatible with a symmetric five-pixel border candidate.

## What this does not establish

The provider pages do not explicitly state that the extra five pixels on each side are disposable export overscan, nor do they define which sample wins where adjacent packaged GeoTIFFs overlap. They also do not bind the Atom GeoTIFF packaging path to a normative clipping implementation with an exact pixel-domain rule.

Therefore this proof does **not** authorize:
- five-pixel border discard;
- first/newest/mean/min/max/tolerance selection;
- WCS/ImageServer priority;
- filename or map-sheet ordering;
- a production seam transform.

`terrain_mosaic.py` must remain fail-closed on conflicting valid overlap. No change to `docs/04-decisions.md` is justified.

## Implementation

`nwe.dtm1-nhm-packaging-contract/0.1` records the provider facts and deliberately keeps `authorizes_overscan_discard=false`, `authorizes_overlap_winner=false`, `production_seam_authority=false`, and `authority_status=UNPROVEN`. Adversarial regressions ensure incomplete or malformed evidence cannot promote authority.

## Next

The remaining high-value evidence is the machine-readable NHM metadata or generation/export configuration that binds a specific DTM1 map sheet to its source projects and, ideally, exposes the exact clipping/overscan rule. If that metadata only identifies projects and map sheets but still says nothing about the ten-pixel excess, the border-discard rule remains unproven.
