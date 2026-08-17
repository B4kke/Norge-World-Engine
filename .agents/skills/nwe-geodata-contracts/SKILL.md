---
name: nwe-geodata-contracts
description: Enforces source, CRS, vertical datum, license, provenance and sample validation for Norge World Engine geodata. Use when adding, changing or validating terrain, imagery, roads, buildings, water, administrative or other geospatial sources.
---

# NWE Geodata Contracts

Bruk sammen med `gdal` for raster/vector-arbeid og `source-driven-development` når tilgang/API/lisens kan ha endret seg.

## Source gate

Ingen datakilde blir en core dependency før følgende er dokumentert:

- leverandør og datasett
- faktisk dekning
- romlig oppløsning/nøyaktighet
- horisontal CRS
- vertikaldatum og Z-semantikk hvis Z finnes
- oppdateringsfrekvens/timestamp eller snapshot identity
- lisens, attribution, caching og redistribusjonsvilkår
- download/API/bulk-metode
- egnethet for preprocessing vs runtime
- minst én konkret sample/request/file som er validert

Hvis et felt er ukjent, merk det ukjent. Ikke fyll det inn fra antakelse.

## Prototype 0 coordinate gate

Gjeldende arbeidshypotese for Nannestad:

- normalisert horisontal CRS: EPSG:25832
- kanonisk landhøyde når støttet: NN2000
- vertikaldatum lagres eksplisitt, separat fra horisontal EPSG
- runtime local origin er en avledet frame og skal ikke endre tile-/world-identitet

Dette er ikke en endelig landsdekkende koordinatbeslutning.

## Z gate

- Z uten kjent datum/semantikk er ugyldig som autoritativ world-height.
- Sentinel, null eller manglende Z skal bli `null`/missing, aldri en plausibel høyde.
- Ikke bland ellipsoidisk høyde, normalhøyde, terrenghøyde, overflatehøyde eller objekt-topphøyde uten eksplisitt transform/semantikk.

## Raster gate

Før normalisering:

1. hash source bytes
2. kjør `gdalinfo`/tilsvarende
3. bekreft format, CRS, bounds, pixel size, bands, nodata og datatype
4. bekreft at file/request faktisk er rasterdata, ikke XML/HTML/service error med `.tif`-navn
5. velg resampling etter semantikk; continuous terrain er ikke kategorisk data
6. behold source metadata/provenance

Hjelpescript:

```bash
.agents/skills/nwe-geodata-contracts/scripts/inspect_raster.sh path/to/source.tif
```

## Vector gate

- inspiser layer schema og geometry type
- dokumenter source CRS før reprojeksjon
- behold source identifiers der mulig
- clip/reproject deterministisk
- logg feature counts før/etter og forklar tap

## Browser boundary

Browser/WCS/Overpass kan brukes til diagnostikk og viewer-harness, men skal ikke kunne promotere output til `REAL_COMPILED` under gjeldende kontrakt. Autoritativ source acquisition og hashing skal skje i World Compiler/preprocessing.

## Output

Alle normaliserte/kompilerte data må kunne spores tilbake til source snapshot og transformkontrakt. Hvis provenance mangler, er output eksperimentelt selv om geometrien ser riktig ut.
