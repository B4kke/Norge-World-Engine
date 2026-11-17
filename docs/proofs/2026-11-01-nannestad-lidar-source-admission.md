# Nannestad LiDAR source-admission evidence — 2026-11-01

## Scope

This proof is limited to the accepted NWE tile `epsg25832_611000_6677000_1000m`:

- horizontal CRS: EPSG:25832;
- target vertical datum: NN2000;
- bounds: E 611000–612000, N 6677000–6678000;
- purpose: identify an openly obtainable source candidate for a bounded LiDAR gold-tile experiment.

It does not promote LiDAR to whole-Norway world truth and does not claim roof/tree fidelity from metadata alone.

## Provider paths checked

### Legacy `projectMetadata.ashx`

A live 2026-11-01 call to Kartverket Høydedata returned a successful HTTP response containing:

```json
{"Error":"Error getting metadata: 499: Token Required"}
```

The first implementation incorrectly let that error-shaped JSON fall through to `NO_CANDIDATE`. The probe now fails closed on provider/auth payloads, and this legacy endpoint is no longer the public discovery authority.

### Public Geonorge Høydedata Metadata prosjekt WFS

Public discovery now uses:

`https://wfs.geonorge.no/skwms1/wfs.hoyde-hoydedata-metadata-prosjekt`

with WFS 2.0.0 `GetFeature`, feature type `metadata_prosjekt:Prosjektavgrensning`, exact EPSG:25832 BBOX, and only the small source fields needed for admission. Geometry is deliberately omitted from the response because the full project geometries made the provider response multi-megabyte and one observed response was truncated during XML transfer.

The exact tile query reported `numberMatched=9` / `numberReturned=9`, proving nine project-boundary features intersect the tile BBOX. The reduced source-field response contained six metadata-bearing project objects; the three provider-declared features without those requested metadata fields are now reported explicitly as unresolved and are never silently admitted. BBOX intersection is deliberately a weaker claim than complete tile coverage.

Metadata-complete laser candidates are:

| Project | Project no. | Year | Access | Ordered density | Frame | Publication |
| --- | --- | ---: | --- | ---: | --- | --- |
| Ullensaker Nes Nannestad 2010 | LACHOA07 | 2010 | `TILGANG=1` open | 0.7 pkt/m² | EPSG:25832 + EPSG:5941 | published |
| Romerike 07pkt 2007 | LACGOA71 | 2007 | `TILGANG=1` open | 0.7 pkt/m² | EPSG:25832 + EPSG:5941 | published |
| Romeriksåsene 2013 | LACHOA33 | 2013 | `TILGANG=1` open | 0.7 pkt/m² | EPSG:25832 + EPSG:5941 | published |
| **NDH Akershus 5pkt 2015** | **LACH0002** | **2015** | **`TILGANG=1` open** | **5 pkt/m²** | **EPSG:25832 + EPSG:5941** | **published** |
| NDH Akershus 2pkt 2015 | LACH0002 | 2015 | `TILGANG=1` open | 2 pkt/m² | EPSG:25832 + EPSG:5941 | published |
| Gjerdrum Ullensaker Nannestad 5pkt 2020 | LACHVI04 | 2020 | `TILGANG=2` closed | 5 pkt/m² | EPSG:25832 + EPSG:5941 | published |

`NDH Akershus 5pkt 2015` is selected as the **first gold-tile acquisition candidate** because it is the highest-density metadata-complete candidate that is simultaneously published, explicitly open and already in the Nannestad source frame. This is an experiment/source-selection decision, not a claim that it completely covers the tile or is the final whole-Norway LiDAR authority.

The 2020 project is **not** an admissible anonymous/open acquisition source even though it is newer and has the same ordered density. Current Kartverket project-status evidence also describes `Romerike laser 2025` (`LACIAK53`) as ongoing rather than a delivered open replacement.

## Export boundary

Kartverket's documented `startExport.ashx` contract defines:

- `Format=1`: LAZ;
- `CoordInput`: GeoJSON/WKT/coordinate-list clipping geometry;
- `InputWkid` / `OutputWkid`;
- `Projects`;
- `NHM=0`: project export;
- `ProjectMerge=1`: no file subdivision;
- `ClipToPolygon=1`: clip projects to input polygon;
- `CopyEmail`: mandatory when no BAAT username is supplied.

The same document marks `ProjectProduct` mandatory for project export but describes its values only as DTM / DOM / both. Because that definition is ambiguous for a point-cloud LAZ export, NWE does not invent a default.

`tools/geo/prepare_nannestad_laz_export.py` therefore:

- requires an explicit project;
- requires an explicit `ProjectProduct` value rather than guessing one;
- requires explicit `CopyEmail` or BAAT username before submission;
- requires `--submit` to cause the external export side effect;
- redacts email/username and password from public evidence;
- never commits or transports delivered raw LAZ bytes into runtime.

## Exact-byte gate

`tools/geo/inspect_nannestad_laz.py` is the admission gate after delivery. It SHA-256 binds the file and measures decoded facts from the exact bytes:

- LAS version and point format;
- header and measured bounds;
- parsed CRS;
- total point count;
- points inside/on the exact 1 km² tile and measured density;
- classification histogram;
- ground class 2 count;
- vegetation classes 3/4/5 count;
- building class 6 count.

The reader is chunked and NumPy-vectorized so a multi-million-point source does not require one Python iteration per point.

## Current conclusion

**PASS:** a public, key-free project-discovery path exists and the exact tile intersects multiple laser projects. `NDH Akershus 5pkt 2015` / `LACH0002` is the first openly obtainable gold-tile candidate based on explicit access, publication, source frame and ordered density.

**REJECTED:** `Gjerdrum Ullensaker Nannestad 5pkt 2020` cannot be treated as the open default because current WFS metadata says `TILGANG=2`.

**OPEN:** resolve the export API's `ProjectProduct` ambiguity and provide an explicit delivery identity for one operator export. Then inspect the delivered LAZ bytes before deciding whether LiDAR supports roof reconstruction, canopy/tree candidates or a materially better near-field terrain representation.

## 2026-11-17 source-byte admission hardening (revision v0.2)

**Status:** IMPLEMENTED + SYNTHETIC COMPRESSED-LAZ TEST PASS. **No real Nannestad LAZ delivered or accepted.**

The earlier inspector incorrectly built its `tile_measurement.classification` from **every** class in the delivered file. A project export that merely intersects the requested tile could therefore show building/ground/vegetation support that existed entirely outside Nannestad. That is now fixed with independent `las.global_classification` and exact in-tile `tile_measurement.classification` (a deliberate schema bump from 0.1 to 0.2). The point classifier is NumPy-vectorized over chunks and reuses the same exact project-bounds mask for density and in-tile classes.

The inspection additionally records a 10 × 10 grid of 100 m cells and the number containing at least one ground-class point, plus vegetation/building cell occupancy. **Cell occupancy does not prove continuous area coverage or measured accuracy.** No LAZ file may pass the new `--require-candidate` gate without a matching embedded projected CRS EPSG:25832, explicit vertical EPSG:5941, coherent header/decoded bounds, nonzero in-tile ground points and ground observations in every coarse 100 m cell. Unknown/mismatched CRS is a blocker, not a silently projected fallback. The CLI retains machine-readable evidence JSON before returning a failure code.

**CRS caveat important in 2026:** Kartverket introduced NN2000:2025 and updated reference codes on 14 October 2026. The NWE accepted older Nannestad source frame is *not automatically equivalent* to that new realization. EPSG:5941 is the older NN2000:2018 height CRS; EPSG:11394 is NN2000:2025. A new datum requires a separate explicit transform/source-identity decision. Do not relabel an unknown LAS Z datum. Official reference: https://kartverket.no/om-kartverket/nyheter/alle/2026/oktober/ny-href-modell-og-nye-epsg-koder-gir-mer-presise-hoyder-og-bedre-datakvalitet .

**Official export documentation rechecked (2026-11-17):** https://hoydedata.no/LaserInnsyn2/dok/webtjenester.pdf still states `Format=1` LAZ, and `ProjectProduct=1/2/3` means DTM/DOM/both for project exports, without establishing which value if any is correct for LAZ point-cloud export. That operator/contract question remains **OPEN**; no remote export was submitted.

**Hosted evidence:** `nannestad-lidar-source-probe` run [44126370072](https://github.com/B4kke/Norge-World-Engine/actions/runs/44126370072), contract job `134191159228`, **21/21 Python tests PASS** on exact code-bearing SHA `8b927dfc6dd5236d9af55e22d6cea8d0df843422`. It uses pinned `laspy==2.7.0`, `lazrs==0.8.2`, `numpy==2.3.5`, `pyproj==3.7.2` and actual synthetic LAZ round trips for cross-boundary classes, missing/wrong CRS and complete coarse grid, including negative CLI exit with preserved JSON. This is a **code/contract** pass only. Normal PR runs now execute the deterministic contract, while live Høydedata discovery and legacy export-value diagnostic run only by explicit `workflow_dispatch`.

Example *after* actual operator delivery (not a command to fetch data):
```bash
python tools/geo/inspect_nannestad_laz.py /path/outside-git/Nannestad.laz \
  --source-project "NDH Akershus 5pkt 2015" \
  --expected-sha256 ACTUAL_DELIVERED_FILE_SHA256 \
  --output /tmp/nwe-nannestad-laz-inspection.json --require-candidate
```

**Remaining:** operator-side export semantics/identity, genuine SHA-bound Nannestad LAZ delivery, actual in-tile density/class/coverage measurement, and roof/canopy/terrain reconstruction quality experiments. A synthetic `SOURCE_CANDIDATE_ONLY` result never authorizes production geometry.
