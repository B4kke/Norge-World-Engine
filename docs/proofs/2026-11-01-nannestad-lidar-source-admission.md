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

The exact tile query reported `numberMatched=9` / `numberReturned=9`, proving nine project boundaries intersect the tile BBOX. BBOX intersection is deliberately a weaker claim than complete tile coverage.

Observed laser candidates include:

| Project | Project no. | Year | Access | Ordered density | Publication |
| --- | --- | ---: | --- | ---: | --- |
| Ullensaker Nes Nannestad 2010 | LACHOA07 | 2010 | `TILGANG=1` open | 0.7 pkt/m² | published |
| Romerike 07pkt 2007 | LACGOA71 | 2007 | `TILGANG=1` open | 0.7 pkt/m² | published |
| Romeriksåsene 2013 | LACHOA33 | 2013 | `TILGANG=1` open | 0.7 pkt/m² | published |
| NDH Akershus 5pkt 2015 | LACH0002 | 2015 | `TILGANG=1` open | 5 pkt/m² | published |
| NDH Akershus 2pkt 2015 | LACH0002 | 2015 | `TILGANG=1` open | 2 pkt/m² | published |
| Gjerdrum Ullensaker Nannestad 5pkt 2020 | LACHVI04 | 2020 | `TILGANG=2` closed | 5 pkt/m² | published |

The 2020 project is therefore **not** an admissible anonymous/open acquisition source even though it is newer and denser than older candidates. Current Kartverket project-status evidence also describes `Romerike laser 2025` (`LACIAK53`) as ongoing rather than a delivered open replacement.

The remaining WFS entries are retained in the live probe output; source selection is performed by code from the full response rather than from this human summary.

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

**PASS:** a public, key-free project-discovery path exists and the exact tile intersects multiple laser projects; at least several are explicitly open and published.

**REJECTED:** `Gjerdrum Ullensaker Nannestad 5pkt 2020` cannot be treated as the open default because current WFS metadata says `TILGANG=2`.

**OPEN:** select the highest-value open candidate from the complete WFS response, make one explicit operator export, inspect the delivered LAZ bytes, and only then decide whether LiDAR supports roof reconstruction, canopy/tree candidates or a materially better near-field terrain representation.
