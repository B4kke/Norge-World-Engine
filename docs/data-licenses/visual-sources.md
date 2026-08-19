# Visual world source audit — imagery and vegetation

Status: **candidate source audit, not an architecture decision**.  
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

## Vegetation source stack — FORGE recommendation

This section records a **source candidate stack**, not a selected runtime schema, density policy or renderer implementation.

### Tier A — primary open forest driver: NIBIO SR16R

**Provider:** Norsk institutt for bioøkonomi (NIBIO).  
**Dataset family:** `SR16 - Skogressurskart 16x16 meter`; NIBIO publishes raster `SR16R` and vector `SR16V`. The vector metadata UUID currently used by the Geonorge/data.norge catalog is `27206b9e-4830-4f71-810d-d04c0dc32b59`.  
**Coverage:** all forest areas in Norway.  
**Raster resolution / positional accuracy:** 16 × 16 m cells; NIBIO's 30 January 2026 product sheet states approximate positional accuracy of ±1 pixel (16 m) and explicitly warns that automatically generated forest-resource values are estimates rather than field observations.  
**CRS / delivery:** SR16R GeoTIFF; SR16V SHAPE/GML/SOSI; UTM 32/33/35 EUREF89 and geographic EUREF89 are documented. WMS 1.3.0 exists for visualization/QA.  
**Relevant source-backed attributes:** dominant species (`SRTRESLAG`: spruce/pine/deciduous in SR16R), site index, volume, biomass, mean height (`SRMHOYDE`), overheight, mean diameter, basal area, tree count per hectare at >=5/8/10/16 cm breast-height diameter (`SRTREANTALL*`), LAI, canopy cover (`SRKRONEDEK`), 3D remote-sensing acquisition year (`SR3DFAAR`) and quantitative uncertainty intervals.  
**Freshness semantics:** the raster is updated with satellite-detected harvesting by zeroing affected resource values and updating the remote-sensing timestamp. The January 2026 product sheet states that equivalent harvesting updates for SR16V segments are not yet implemented.  
**Access / license:** current Geonorge/data.norge distributions expose download/API and Atom paths under NLOD 1.0/open-license metadata. NIBIO's generic download terms also state that datasets downloadable without a password are NLOD 1.0 with attribution `Kilde: NIBIO`. Exact distribution/license metadata must still be captured in each SourceSnapshot.  
**Official references:**
- https://www.nibio.no/tema/skog/kart-over-skogressurser/skogressurskart-sr16
- https://www.nibio.no/tema/skog/kart-over-skogressurser/skogressurskart-sr16/_/attachment/inline/b1351797-d448-4a67-b099-961efaa6bf80%3A639c0369780bbb68533c91302042cca246ed9081/SR16_produktark_v30jan2026.pdf
- https://data.norge.no/en/datasets/0bbd8017-f34b-4fd1-a82e-4493b0eb5bd6/sr16-skogressurskart-16x16-meter-vektor
- https://www.nibio.no/tjenester/nedlasting-av-kartdata

**FORGE assessment:** **SR16R is the preferred source candidate for forest structure.** The raster is closer to the measured/modelled source resolution than generalized SR16V, exposes the attributes needed for deterministic vegetation derivation, and currently has the stronger harvesting-update semantics.

**Semantic honesty rule:** SR16 does **not** provide authoritative individual-tree positions. Generated NWE tree positions, species variation inside a dominant-species cell, height variation around a mean, rotation/scale and asset choice remain deterministic procedural detail. Provenance must distinguish those generated values from source-backed cell attributes.

### Tier A — primary open non-forest mask: NIBIO AR50

**Provider:** NIBIO.  
**Dataset:** `AR50`. The current Geonorge product register marks version `20260619` valid; the narrative NIBIO overview page still contains older prose referring to a March 2025 production, so acquisition must bind the actual downloadable snapshot/metadata rather than trusting that prose date.  
**Coverage:** nationwide overview land-resource map.  
**Scale / geometry limits:** 1:50 000 product intended roughly for 1:20 000–1:100 000 use. Areas smaller than 15 dekar are not retained as separate figures and are merged into neighboring classes.  
**Relevant classes:** built-up/transport, agriculture, forest, open natural land, bog, glacier, freshwater, sea and unmapped; additional themes include forest site index, coarse tree-species class, agriculture and open-land vegetation classes.  
**Acquisition / license evidence:** AR50 is documented in NIBIO's public download documentation. NIBIO states that datasets downloadable without password are NLOD 1.0; unlike FKB-AR5, AR50 is not listed among the Geovekst/Norge digitalt restricted exceptions. The real sample gate must still capture exact distribution license, CRS, format and snapshot identity.  
**Official references:**
- https://www.nibio.no/tema/jord/arealressurser/ar50
- https://www.nibio.no/tjenester/nedlasting-av-kartdata/dokumentasjon/ar50
- https://register.geonorge.no/register/versjoner/produktark/norsk-institutt-for-bio%C3%B8konomi/ar50
- https://www.nibio.no/tjenester/nedlasting-av-kartdata

**FORGE assessment:** **AR50 is suitable as a national coarse exclusion/classification layer, not as precise vegetation-edge truth.** It can tell the compiler that a cell/area is agriculture, bog, open land, water or built-up at overview scale. Existing higher-quality NWE roads/buildings and future water/parcel layers should override/suppress generated vegetation locally. The 15-dekar generalization means AR50 must not be used to claim exact yard, roadside or field-edge boundaries.

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
**Coverage / semantics:** nationwide harmonized land-cover/use/ ecosystem dataset; 2025 annual version includes classes such as built land, transport, agriculture, open land, wetlands and multiple forest/tree classes. It combines existing public-sector source layers rather than being new field mapping.  
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

1. Acquire and hash immutable SR16R + AR50 source snapshots outside browser runtime.
2. Normalize/clip them to the NWE world tile with explicit CRS transforms; do not make provider tiling the runtime tile identity.
3. Preserve SR16 source values, acquisition/prediction time and available uncertainty as source-backed normalized attributes.
4. Build a deterministic exclusion mask from AR50 plus already accepted NWE road/building geometry; later water/high-detail area layers may refine it.
5. Derive tree instances from a versioned vegetation compiler configuration. A stable seed should include tile identity, source snapshot identities and vegetation-config identity so identical inputs reproduce identical placements.
6. Tree count can be driven by a documented SR16 tree-count-per-hectare field and 16×16 m cell area with deterministic rounding/sampling. Dominant species and mean height may constrain generation, but any within-cell species mixture or height distribution not present in the source is explicitly procedural configuration.
7. Compile renderer-neutral instance/cluster data. LUMEN chooses Three.js/WebGPU instancing, asset meshes, impostors and visual LOD without writing presentation choices back into source truth.
8. Runtime verifies and streams the compiled vegetation artifact; it never calls NIBIO/Geonorge/WMS/Atom directly.

No exact instance schema, tree-density cap, species-mix heuristic, asset set, LOD distance or GPU representation is selected by this audit.

## Required real-sample gate before source admission

`P1-VEGETATION-01` source work is not complete until FORGE performs one bounded Nannestad acquisition experiment:

1. acquire one current SR16R sample through an official download/API/Atom path and one AR50 sample through the documented public download path;
2. record exact source URL/metadata identity, license/attribution, byte size/hash, CRS, bounds, pixel/feature structure, nodata and update/prediction/acquisition timestamps where present;
3. verify that the Nannestad tile is actually covered and inventory the real SR16 fields/rasters delivered today rather than relying only on documentation;
4. compile a tiny deterministic normalized sample or source-inventory proof, with raw/bulk files excluded from Git;
5. run the same acquisition from cache/source-network-free input to prove the next pipeline can be made reproducible before designing the runtime vegetation artifact.

WMS is a visualization/QA sensor, not the normal authoritative acquisition path when downloadable source data is available.

## Implementation order relative to the active queue

Vegetation remains `P1-VEGETATION-01`. This source audit must not displace active `P0-GROUND-07` / milestone acceptance work. When P1 vegetation becomes active, the next FORGE action is the bounded Nannestad SR16R + AR50 real-sample gate above; only after that proof should LUMEN receive a vegetation artifact for GPU-instancing/LOD experiments.

No renderer, texture encoding, tree asset set, tree density policy or imagery CDN/object-store architecture is selected by this audit.
