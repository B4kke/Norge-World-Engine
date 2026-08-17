# Prototype 0 vector source contracts

This file records the source contracts used by the Nannestad 1 × 1 km compiler vertical. It does **not** select a whole-Norway acquisition strategy.

## NVDB segmented road network

- **Provider:** Statens vegvesen / Nasjonal vegdatabank (NVDB)
- **API:** NVDB API Les V4, segmented road network endpoint
- **Prototype request:** compiler derives a conservative EPSG:25833 envelope from all four EPSG:25832 tile corners and requests `srid=5973`, `antall=1000`.
- **Source horizontal CRS:** ETRS89 / UTM zone 33N (`EPSG:25833`)
- **Source compound SRID requested:** `5973`
- **Z contract:** valid NVDB road Z is treated as NN2000 normal height for this verified Prototype-0 source contract; invalid/sentinel Z becomes null.
- **License:** NLOD 1.0
- **Attribution:** `Inneholder data under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen.`
- **Runtime suitability:** source API is preprocessing input only. Raw response bytes are SHA-256-addressed and cached outside Git; the browser must not contact NVDB during normal runtime.

Official references:
- `https://nvdbapiles.atlas.vegvesen.no/`
- `https://nvdbapiles.atlas.vegvesen.no/swagger-ui/index.html?urls.primaryName=Vegnett`
- Statens vegvesen terms for data reuse / NLOD.

## OpenStreetMap building fallback

- **Provider:** OpenStreetMap contributors
- **Prototype request:** OSM API v0.6 `map.json` for the WGS84 envelope derived from **all four** EPSG:25832 tile corners.
- **Source CRS:** WGS84 / `EPSG:4326`
- **Geometry:** building ways are normalized to EPSG:25832, validated with Shapely and clipped to the exact tile. Multipolygon building relations remain an explicit open item.
- **Height:** explicit `height` is retained as explicit source information; `building:levels` is provenance-distinct. Missing height remains unresolved until a separate DOM-DTM or authoritative building transform supplies it.
- **License:** ODbL 1.0
- **Attribution:** `© OpenStreetMap contributors`
- **Runtime suitability:** the public OSM API is a small-area Prototype-0 acquisition source, not a whole-Norway runtime or bulk strategy. Raw bytes are cached outside Git; normal viewer/runtime operation must use compiled artifacts only.

Official references:
- `https://api.openstreetmap.org/api/0.6/`
- `https://wiki.openstreetmap.org/wiki/API_v0.6`
- `https://www.openstreetmap.org/copyright`

## Historical browser evidence vs compiler contract

`Forsøk 14 – Nannestad Road Graph + Conflict QA` proved that both live sources could be reached from the Android browser and used a rounded NVDB bbox plus an OSM bbox formed from two transformed tile corners. The production-direction compiler keeps the useful endpoints but derives source query envelopes from all four tile corners, then performs exact clipping after normalization. Historical browser cache/localStorage output is diagnostic evidence only and cannot promote data to `REAL_COMPILED`.
