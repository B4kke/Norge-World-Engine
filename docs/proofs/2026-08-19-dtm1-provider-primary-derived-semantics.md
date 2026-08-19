# FORGE proof — DTM1 provider primary/derived semantics

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Role: FORGE

## Question

Does Kartverket/Geonorge documentation establish source semantics that justify choosing one valid height where neighboring downloadable DTM1 GeoTIFFs overlap?

## Official provider evidence

Primary source reviewed:

- Kartverket/Geovekst, `Produktspesifikasjon: Punktsky 1.0.3`, published at `dokument.geonorge.no/produktspesifikasjoner/punktsky/1.0.3/index.html`.

The specification explicitly states that:

- the point cloud is the primary dataset in the Høydedata management system (FvL);
- products are derived automatically from that primary dataset;
- lack of manual editing can produce artefacts in both project grids and national grids;
- DTM is generated from terrain-relevant point classes using `Triangulate with Natural Neighbor Interpolation`, with `Bin with Average Value` as a fallback when the primary method fails because triangle edges become too long;
- the specification is published under NLOD and documents the EUREF89/UTM + NN2000 reference-system family used by managed height data.

This is important provenance evidence: a distributed DTM grid is a provider-derived product, not the primary measurement dataset.

## Implementation

Added:

- `engine/compiler/src/nwe_compiler/dtm1_provider_semantics.py`;
- `engine/compiler/tests/test_dtm1_provider_semantics.py`;
- `.github/workflows/dtm1-provider-semantics.yml`.

The classifier is deliberately narrow. It recognizes only exact/strong provider statements needed for primary-versus-derived semantics. It cannot create seam authority. The live workflow fetches the official versioned product specification, SHA-256 hashes the exact response, checks the required statements, emits JSON evidence, and fails closed if the provider document no longer supports the expected claims.

`production_seam_authority=false` and `authority_status=UNPROVEN` are invariant outputs of this evidence class.

## What this proves

It is now provider-documented that Høydedata treats the point cloud as the primary managed dataset and automatically derives grid products from it. Provider documentation also explicitly warns that automatically derived project/national grids can contain artefacts.

This strengthens the existing refusal to infer authoritative source priority from downloadable DTM1 overlap values, filename order, Atom ordering, timestamps, or small numerical differences.

## What this does not prove

The reviewed provider documentation does **not** establish:

- a 15 km authoritative DTM1 core;
- that the ~5 m outer region on each raster side is disposable halo;
- which of two different valid elevation samples wins in the ~10 m overlap;
- `first`, `newest`, filename-order, mean, min/max or tolerance priority;
- that seamless WCS is source authority rather than another provider-derived presentation/service surface;
- a production seam `TransformContract`.

Therefore `P0-MULTITILE-TERRAIN-01` remains fail-closed.

## Existing DTM1 source contract remains unchanged

No new geodata source is introduced in this increment. The existing DTM1 contract remains the one already proven in project evidence: official Kartverket/Geonorge DTM1 distribution, 1 m GeoTIFF, source CRS EPSG:25833 for the Nannestad sources, NN2000 vertical semantics, NLOD/open redistribution with attribution, raw cache outside Git, exact source hashing for accepted compilation, and Atom/download access. This change adds documentation provenance only; it does not alter acquisition, reprojection, resampling, cache, attribution, or runtime behavior.

## Consequence

Do not spend further work trying to derive a seam winner from the 263 raster-grid observations alone. The next useful evidence must explain the *national-grid construction/partition rule* or provide a provider-owned authoritative core/index/sample-selection contract. If no such rule is published, the production multi-source DTM1 compiler should continue rejecting overlapping valid source samples rather than inventing a transform.
