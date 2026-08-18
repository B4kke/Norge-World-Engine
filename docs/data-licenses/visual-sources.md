# Visual world source audit — imagery and vegetation

Status: **candidate source audit, not an architecture decision**.  
Date checked: 2026-08-18.

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

## Open forest / vegetation candidate: NIBIO SR16

**Provider:** Norsk institutt for bioøkonomi (NIBIO).  
**Dataset:** `SR16 - Skogressurskart 16x16 meter - Vektor`, metadata UUID `27206b9e-4830-4f71-810d-d04c0dc32b59`.  
**Coverage:** heldekkende overview of Norway's forest resources. NIBIO publishes both SR16R raster and SR16V vector forms. SR16R is 16×16 m; SR16V generalizes raster cells into relatively homogeneous forest polygons.  
**Relevant semantics:** forest extent and forest attributes; NIBIO describes properties including tree species and volume, with current SR16 material also exposing properties such as mean height, canopy cover and tree count where available.  
**Access:** Geonorge download/API, Atom feed and WMS are documented.  
**License:** NLOD 1.0 on the documented download/Atom distributions.  
**Official references:**
- https://www.nibio.no/tema/skog/kart-over-skogressurser/skogressurskart-sr16
- https://data.norge.no/en/datasets/f1c44880-3b77-3db8-9c6f-7fd8eab26249/sr16-skogressurskart-16x16-meter-vektor

**Runtime suitability:** strong candidate for a compiled vegetation layer. It can constrain where forest exists and provide parameters for deterministic procedural/instanced vegetation.

**Semantic honesty rule:** SR16 does **not** make every generated tree an authoritative individual-tree observation. If NWE generates tree instances inside an SR16 forest polygon/cell, the instance positions are procedural derived detail. Provenance must distinguish source-backed forest properties from generated placement/asset variation.

**Required experiment before admission:**
1. fetch one Nannestad SR16 sample and inventory actual current fields, CRS, source size and update metadata;
2. clip it through World Compiler and preserve relevant source attributes without silently inventing missing fields;
3. derive a deterministic seeded vegetation-instance artifact using explicit density/species/height rules based only on available source properties;
4. render with GPU instancing and at least one coarse LOD/cull boundary;
5. benchmark instance count, artifact bytes, CPU generation, GPU upload, draw calls, frame time and memory on desktop + Android;
6. keep WMS/Atom/download acquisition out of normal browser runtime.

## Preview implementation order

1. Fix mobile camera/navigation usability on Preview 1.
2. Prove one real Skyfritt Norge 2025 Nannestad image clip and one real SR16 Nannestad source sample in compiler-side experiments.
3. Promote only the successful derived artifacts into the preview manifest/runtime verification model.
4. Add satellite terrain color and data-driven procedural forest to the visible viewer without changing authoritative terrain/road/building geometry.
5. Keep high-resolution Norge i bilder orthophoto and photo-derived building facades outside the public runtime until access/redistribution rights are explicitly resolved.

No renderer, texture encoding, tree asset set, tree density policy or imagery CDN/object-store architecture is selected by this audit.
