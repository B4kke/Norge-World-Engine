# 2026-08-19 — DTM1 seam evidence matrix

## Scope

This proof advances `P0-MULTITILE-TERRAIN-01` by consolidating the currently tested seam candidates into one fail-closed compiler contract. It does not select a production seam transform and does not add raw geodata to Git.

## Current provider facts

Kartverket/Høydedata currently publishes a DTM ImageServer whose primary raster catalog exposes project lineage (`LAS_PROJECT_ID`, `LAS_PROJECT_NAME`, `PRIORITET`, year/flight date, CRS/vertical fields and source resolution). The service advertises default mosaic method `ByAttribute`, sort field `lowps`, mosaic operator `First`, and bilinear resampling.

Primary provider surface checked 2026-08-19:

- `https://hoydedata.no/arcgis/rest/services/DTM/ImageServer`
- `https://www.geonorge.no/kartdata/datasett-i-geonorge/hoydedata/`

Existing NWE live evidence already establishes for the concrete Nannestad seam:

- real source rasters are 15010 × 15010 at 1 m;
- the provider nominal DTM1 tile is 15 km, yielding a unique symmetric 5 px core candidate geometrically;
- actual raster bounds match the provider raster catalog for the tested anomaly population rather than transformed Atom GeoRSS bounds;
- five provider-linked projects cover the seam and all five advertise `PRIORITET=1`;
- the newest mapped project is 2025, but provider newest-project semantics previously found are scoped to the `hoydedata_orig` original-LAZ workflow;
- provider ImageServer mosaic rules are presentation/service semantics unless a provider contract binds them to the downloadable SHA-addressed DTM1 GeoTIFF source family.

## Implementation

`nwe_compiler.dtm1_seam_evidence_matrix` makes production eligibility explicit. A seam candidate can be selected only when all of these are true:

1. the transform is deterministic;
2. the provider explicitly authorizes the semantics;
3. that authorization is bound to the actual DTM1 source family used by the compiler;
4. the rule discriminates the concrete overlap when winner selection is required;
5. the rule carries provenance/config fields sufficient to version the transform;
6. there is no unresolved blocker.

Multiple simultaneously eligible rules fail as ambiguous.

The current Nannestad matrix records five candidate families:

| Candidate | Deterministic | Provider-authorized | DTM1 source-bound | Discriminating here | Result |
| --- | --- | --- | --- | --- | --- |
| symmetric 5 px core clip | yes | no | yes | yes | blocked |
| project priority | no for this seam | no | no | no (`PRIORITET=1` for all mapped projects) | blocked |
| newest project | yes | no for DTM1 | no | yes | wrong provider scope |
| ImageServer default mosaic | yes as service behavior | no for downloadable DTM1 | no | yes | presentation-only |
| mean/min/max/tolerance/file order | not an evidence-backed transform | no | no | no | rejected |

## Regression boundary

The new tests require:

- the current Nannestad matrix to remain `UNPROVEN`;
- geometry alone not to promote the 5 px core candidate;
- provider semantics from the wrong source family to fail closed;
- an explicitly provider-authorized, DTM1-bound, deterministic and provenance-bearing future rule to be representable;
- two competing eligible rules to fail as ambiguous rather than silently choosing one.

## Result

This does not close the terrain gate. It closes a compiler-safety gap: future FORGE work now has one executable promotion boundary instead of scattered prose that can be accidentally over-interpreted.

`production_seam_authority=false` for the current Nannestad evidence set. `P0-MULTITILE-TERRAIN-01` remains fail-closed. `docs/04-decisions.md` remains unchanged because no production transform is proven.
