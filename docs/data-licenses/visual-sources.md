# Visual world source audit — imagery and vegetation

Status: **candidate source audit + source-admission evidence, not a runtime architecture decision**.  
Date checked: 2026-08-20.

The goal is to add visible world quality without weakening the compiler/runtime boundary. Browser runtime must consume derived, provenance-bound world artifacts rather than treating external map services as authoritative runtime dependencies.

## High-resolution orthophoto: Norge i bilder

**Provider:** Kartverket / Norge i bilder / Geovekst ecosystem.  
**Coverage:** public Norge i bilder viewer exposes orthophoto across Norway, including historical and current projects.  
**Current access fact:** Kartverket states that everybody can view orthophoto in the public Norge i bilder service, while downloading orthophoto and using WMS/WMTS in external systems are extended rights for Norge digitalt participants.  
**Official references:**
- https://kartverket.no/om-kartverket/nyheter/geodataarbeid/2026/juli/norge-i-bilder-er-oppgradert
- https://www.kartverket.no/til-lands/flyfoto

**NWE decision state:** **NOT ADMITTED as a public Vercel runtime source.** Do not embed, scrape or proxy the public viewer to obtain a high-resolution terrain texture. A future authenticated/licensed integration can be evaluated separately if the project obtains the required rights.

## Open terrain imagery candidate: Sentinel-2 Skyfritt Norge 2025

**Provider:** Kartverket.  
**Dataset:** `Satellittdata - Sentinel-2 - Skyfritt Norge 2025 lnt-16`.  
**Metadata UUID:** `60ecee84-bd74-430c-92dc-a1a01a05df9e`.  
**Coverage:** Norway cloud-free Sentinel-2 mosaic assembled from observations in 1 June–31 August 2025; target pixel date is around 1 August.  
**Access:** public/open data; Geonorge download distribution in TIFF.  
**License:** Creative Commons Attribution 4.0 International.  
**Update cadence:** annual in current catalog metadata.  
**Official reference:** https://data.norge.no/nb/datasets/5e3bfe7d-eada-3b58-9839-ff1472cd1cb5/satellittdata-sentinel-2-skyfritt-norge-2025-lnt-16

**Runtime suitability:** useful as a legal, scalable first real terrain-color layer after preprocessing. It is satellite imagery, not high-resolution orthophoto and must not be presented as facade/street-level truth.

**Required experiment before admission:**
1. acquire one reproducible Nannestad sample through the documented Geonorge download path;
2. record source CRS, bands, pixel size, nodata, byte size, source identity and exact license metadata;
3. clip/reproject to the same EPSG:25832 runtime tile contract through an explicit transform;
4. benchmark candidate derived texture formats/sizes rather than selecting WebP/KTX2/other format from preference;
5. verify alignment against the accepted DTM1/road/building tile and measure browser upload/memory/first-visible cost;
6. keep source TIFF outside Git and publish only a provenance-bound derived preview artifact if redistribution remains compliant.

## Vegetation source stack — current FORGE evidence

This section records the **best currently proven public preprocessing path**, not a selected vegetation runtime schema, density policy or renderer implementation.

### Tier A — proven public forest source path: NIBIO SR16V

**Provider:** Norsk institutt for bioøkonomi (NIBIO).  
**Dataset:** `SR16 - Skogressurskart 16x16 meter - Vektor`.  
**Metadata UUID:** `27206b9e-4830-4f71-810d-d04c0dc32b59`.  
**Coverage:** all forest areas in Norway. SR16V contains generalized homogeneous forest polygons derived from the SR16 model family; it must not be interpreted as surveyed individual-tree geometry.  
**Current access/license evidence:** live Geonorge metadata on 2026-08-20 reports `Åpne data`, no public-access limitation and an NLOD link (`http://data.norge.no/nlod/no/1.0`). The tested NIBIO Atom distribution is publicly reachable without credentials. Attribution remains `Kilde: NIBIO`.  
**Advertised formats:** FGDB/GML/SOSI through download metadata and GDB/RASTER/GML/SOSI through Atom metadata. The actual Nannestad Atom entry tested today is SOSI, not GML.  
**Official references:**
- https://www.nibio.no/tema/skog/kart-over-skogressurser/skogressurskart-sr16
- https://data.norge.no/en/datasets/0bbd8017-f34b-4fd1-a82e-4493b0eb5bd6/sr16-skogressurskart-16x16-meter-vektor
- https://www.nibio.no/tjenester/nedlasting-av-kartdata

#### Real Nannestad source evidence — PASS

The bounded source-admission gate used the official Atom entry `Skogressurskart SR16-kommune-Nannestad-EUREF89 UTM sone 32, 2d-sosi`, municipality `3238`, updated `2026-08-17T17:05:15Z`.

- acquisition: NIBIO Atom -> direct ZIP, no provider order and no credentials;
- source CRS: EUREF89 / UTM zone 32 (`EPSG:25832`);
- SOSI header: `SOSI-VERSJON 5.0`, `TEGNSETT UTF-8`, `VERT-DATUM NN2000`, `ENHET 0.010000`;
- ZIP bytes: `15,017,777`;
- ZIP SHA-256: `536d3e436dd4af7200788f353cc72b29954f35449d67e5ca6acf077726080001`;
- extracted provider SOSI bytes: `125,418,971`;
- provider SOSI SHA-256: `09dc03637097c485d1b80a863eb1bd36a65ebc9b29c2505b0e95cc15a5533adf`;
- exact 1 km NWE test tile: `611000,6677000 -> 612000,6678000` in EPSG:25832;
- normalized/clipped SR16V polygons in that tile: `124`;
- source IDs resolve from `prod_lokalid`;
- normalized source geometry is polygonal; no individual-tree coordinates are created by this gate.

The real sample exposes the forest semantics required for later deterministic derivation, including spruce/pine/deciduous percentages, mean/overheight, canopy cover, LAI, tree-count fields and diameter thresholds, volume, biomass, basal area, diameter, site/forest attributes, acquisition/update fields and uncertainty variants.

#### SOSI decoder compatibility boundary

The provider source remains immutable UTF-8 world-source truth. Ubuntu 24.04's hosted GDAL 3.8.4 / FYBA 4.1.1 could not open the valid UTF-8 SOSI before GDAL had a chance to process the declared encoding. FORGE therefore added a **decoder-only compatibility copy**:

- strict UTF-8 decode of the original provider bytes;
- exactly one `..TEGNSETT UTF-8` declaration must be present;
- preserve the provider CRLF line ending;
- strict transcode to ISO8859-10 with declaration changed only in the temporary copy;
- strict reverse decode must reproduce the compatibility text exactly;
- any unrepresentable character fails the compiler gate rather than being replaced;
- original provider bytes/hash remain the source binding in the normalized artifact.

Hosted evidence reports compatibility-copy SHA-256 `951a41bd139adef103f5b1fdf7d46808bc7eb1d54117bb04ff3759907cd286b4` and `strict_roundtrip: true`. This is a tooling adapter, **not a mutation of source truth**.

**FORGE assessment:** **SR16V is the currently proven public/reproducible SR16 preprocessing path for NWE.** It is admitted as a source candidate for later vegetation compilation, not yet as a runtime vegetation artifact.

**Semantic honesty rule:** SR16 does **not** provide authoritative individual-tree positions. Generated NWE tree positions, species variation inside a source polygon/cell, height variation around source statistics, rotation/scale and asset choice remain deterministic procedural detail. Provenance must distinguish generated values from source-backed attributes.

### Tier A — proven public coarse mask: NIBIO AR50

**Provider:** NIBIO.  
**Dataset:** `AR50`.  
**Metadata UUID:** `a7949917-033c-4e78-8c0f-e30323ce353a`.  
**Coverage:** nationwide overview land-resource map.  
**Scale / geometry limits:** 1:50 000 product intended roughly for 1:20 000–1:100 000 use. Areas smaller than 15 dekar are not retained as separate figures and are merged into neighboring classes.  
**Acquisition:** official public NIBIO WFS `AR50`, WFS 2.0.0, bounded in EPSG:25832 for the real sample.  
**License:** NIBIO public-download/NLOD terms; no credential gate was encountered in the tested WFS path. Exact source identity and attribution remain part of each SourceSnapshot.  
**Official references:**
- https://www.nibio.no/tema/jord/arealressurser/ar50
- https://www.nibio.no/tjenester/nedlasting-av-kartdata/dokumentasjon/ar50
- https://register.geonorge.no/register/versjoner/produktark/norsk-institutt-for-bio%C3%B8konomi/ar50
- https://www.nibio.no/tjenester/nedlasting-av-kartdata

#### Real Nannestad source evidence — PASS

The same 1 km tile returned `15` valid polygon/multipolygon features with attributes including area type, agriculture, forest site index, coarse tree-species class and vegetation cover. Two independent WFS acquisitions had different raw SHA-256 hashes because request-time `kopidato` changes. After excluding **only that proven volatile field**, both normalize to the same semantic content. The heavy source gate therefore proves both raw-source binding and stable semantic normalization rather than pretending request envelopes are immutable.

**FORGE assessment:** **AR50 is suitable as a national coarse exclusion/classification layer, not precise vegetation-edge truth.** Existing accepted NWE roads/buildings and later higher-detail water/area sources must override/suppress generated vegetation locally. The 15-dekar generalization means AR50 must not be used to claim exact yard, roadside or field-edge boundaries.

### Tier A research candidate — SR16R raster, not yet admitted

SR16R remains technically attractive because the documented 16 × 16 m raster representation is closer to the native model grid and the January 2026 product sheet documents stronger harvesting-update semantics than SR16V. It is **not** the currently admitted public baseline for NWE because current distribution evidence is inconsistent:

- split-raster metadata UUID `5de45872-f534-4e97-840e-3cfd8db04398` is reachable through NIBIO capabilities but mixes `Åpne data` with `Norge digitalt-lisens` wording;
- its current Nannestad area codelist reports `sosi` despite GeoTIFF being advertised elsewhere in metadata;
- legacy/open raster candidate UUID `7df9ef08-faf2-4ad3-9ae2-49905f5ea808` currently exposes NLOD 2.0/GeoTIFF metadata, but all tested NIBIO capabilities paths for that UUID return HTTP 404;
- no immutable Nannestad raster bytes have yet passed the same cache/offline normalization gate.

**FORGE assessment:** keep SR16R as a higher-fidelity **research/enrichment candidate**. Do not make it a mandatory public compiler dependency until one exact distributable raster lineage has unambiguous license/access plus real-byte reproducibility evidence.

### Tier B — licensed high-detail enrichment: FKB-AR5

**Provider / rights ecosystem:** Geovekst / NIBIO.  
**Semantics:** detailed area-resource classes including area type, tree-species class, forest site index and ground conditions; materially more useful than AR50 for precise local masking where available.  
**Access constraint:** NIBIO explicitly states that downloading FKB-AR5 through Geonorge is reserved for users with rights through Geovekst and/or Norge digitalt.  
**Official references:**
- https://www.nibio.no/tjenester/nedlasting-av-kartdata
- https://register.geonorge.no/register/versjoner/produktspesifikasjoner/geovekst/fkb-ar5

**FORGE assessment:** **do not make FKB-AR5 a required dependency for the open/reproducible baseline.** It can later be a capability-gated enrichment source if NWE obtains rights that permit the intended preprocessing, hosting and derived-data redistribution model.

### Tier B — Nasjonalt grunnkart for arealanalyse

**Providers:** collaboration between NIBIO, SSB, Kartverket and Miljødirektoratet.  
**Coverage / semantics:** nationwide harmonized land-cover/use/ecosystem dataset; 2025 annual version includes classes such as built land, transport, agriculture, open land, wetlands and multiple forest/tree classes. It combines existing public-sector source layers rather than being new field mapping.  
**Access constraint:** current data.norge distributions/API are associated with the Norge digitalt license and the WMS catalog marks access as restricted.  
**Official references:**
- https://www.nibio.no/tema/jord/arealressurser/andre-kart/grunnkart-for-arealregnskap
- https://data.norge.no/nb/datasets/ad38290e-2c12-3b77-96a8-fa07e02eefa7/nasjonalt-grunnkart-for-arealanalyse

**FORGE assessment:** technically attractive but **not admitted as the public baseline while the current rights model is restricted**. Re-evaluate only if license/access terms change or the project obtains appropriate rights.

### Tier C — regional thematic enrichment: NIBIO vegetation maps

**Provider:** NIBIO.  
**Coverage:** not national. NIBIO documents approximately 23,000 km² available digitally at 1:20 000–1:50 000 overview mapping scale, and warns that quality/detail varies, particularly for older mapping.  
**Value:** richer natural vegetation-type semantics than AR50 where coverage exists.  
**Official reference:** https://www.nibio.no/tema/landskap/utmarksbeite/karttema/dekning-av-vegetasjonskart

**FORGE assessment:** useful optional enrichment for biome/ground-cover appearance, never a whole-Norway dependency.

## Candidate compiler semantics

The minimal source-backed vegetation contract should preserve the difference between **observed/modelled source attributes** and **procedurally generated render instances**:

1. Acquire and hash immutable SR16V + AR50 source snapshots outside browser runtime.
2. Normalize/clip them to the NWE world tile with explicit CRS transforms; provider municipality/WFS tiling is never runtime tile identity.
3. Preserve relevant SR16 source values, temporal fields and uncertainty separately from future generated instance properties.
4. Build a deterministic exclusion/classification layer from AR50 plus already accepted NWE road/building geometry; later water/high-detail area layers may refine it.
5. Derive tree instances only from a versioned vegetation compiler configuration. A stable seed should include tile identity, source snapshot identities and vegetation-config identity so identical inputs reproduce identical placements.
6. Tree count can later be driven by documented SR16 tree-count fields and source geometry area with deterministic rounding/sampling. Species percentages and height statistics may constrain generation, but distributions/positions not encoded in the source remain explicitly procedural configuration.
7. Compile renderer-neutral instance/cluster data. LUMEN chooses Three.js/WebGPU instancing, asset meshes, impostors and visual LOD without writing presentation choices back into source truth.
8. Runtime verifies and streams the compiled vegetation artifact; it never calls NIBIO/Geonorge/WMS/Atom directly.

No exact instance schema, tree-density cap, species-mix heuristic, asset set, LOD distance or GPU representation is selected by this audit.

## `P1-VEGETATION-01-SAMPLE` — PASS

The bounded real-source gate is proven on code-bearing head `5594fe073edf0c20b03911c56f5b454a7aba4dc9`:

- `baseline` run `32312909195`: PASS;
- heavy source-admission execution in `visual-source-probe` run `32312909181`: PASS;
- evidence artifact ID `9387116220` (14-day CI retention);
- same-cache normalization A1/A2: byte-identical;
- independent AR50 acquisition B: semantically identical after excluding only proven volatile `kopidato`;
- normalized candidate sample size: `378,569` bytes;
- normalized SHA-256: `c275ddedaf06d6b509c90bf41fb54404d36cbc3457681a092eddcec77d44929c`;
- semantic SHA-256: `76536346c39a5a731352ca00d86231d901e025f9a1a4b4b2097700a694534ec1`;
- normalizer requires no provider network access after cache materialization;
- raw/bulk provider files were neither committed nor uploaded as CI artifacts;
- truth boundary remains source polygons/attributes only — **no tree placement or runtime vegetation artifact was promoted**.

The proof above was intentionally executed through the ordinary source workflow while the gate was being developed so every stage was visible on the PR. After PASS, the heavyweight materialize/decode/replay path was removed from ordinary PR execution. The reusable heavy gate now lives only in `.github/workflows/vegetation-source-sample.yml` as explicit `workflow_dispatch`; normal `visual-source-probe` runs retain source-contract/metadata/sample probes without the 125 MB decode/replay cycle.

## Implementation order relative to the active queue

Vegetation remains `P1-VEGETATION-01` and must not displace active `P0-GROUND-07` / milestone acceptance work. The source-admission uncertainty is now substantially reduced: when vegetation becomes active, FORGE can start from the proven SR16V + AR50 normalized source boundary rather than repeating source archaeology.

The next vegetation implementation gate should define a tiny **renderer-neutral deterministic vegetation artifact candidate** over this accepted source boundary, still without claiming individual-tree truth. LUMEN asset/instancing/LOD work comes only after that compiler contract exists.

No renderer, texture encoding, tree asset set, tree density policy or imagery CDN/object-store architecture is selected by this audit.