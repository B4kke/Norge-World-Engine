# Nannestad traffic-sign semantics and official artwork evidence — 2026-11-03

Status: **candidate presentation path proven on exact Nannestad source data; official artwork runtime materialization still under CI admission**.

This note separates three concerns that must not be conflated:

1. **NVDB source truth** — sign/support identity, location, relations and semantic properties.
2. **Renderer layout** — plate dimensions, equal-slot placement and unresolved front/back direction where the source evidence is insufficient.
3. **Provider artwork** — official Statens vegvesen sign images admitted separately by exact source bytes and per-asset hashes.

## Exact Nannestad source evidence

Tile: `epsg25832_611000_6677000_1000m`.

The exact hosted NVDB street-detail compiler reports:

- 367 emitted feature parts total;
- 67 `Skiltpunkt` objects (`type=95`);
- 115 `Skiltplate` objects (`type=96`);
- all 115 sign plates resolve to a type-95 parent in the preserved NVDB relation payload;
- compiler v0.3 preserves raw NVDB `lokasjon` as `source_location` for all 367 emitted parts;
- 115/115 type-96 parts, 67/67 type-95 parts and 78/78 emitted line parts carry source-location evidence;
- compiler v0.3 artifact SHA-256: `44746f39df7af3e142a6991a04de8c08abdfff89ff00e4b4b15c5f9a87e9584e`.

The exact sign inventory contains real Nannestad signs such as `202` Vikeplikt, `206` Forkjørsveg, `362.40/50/60`, `302`, `404.1`, `406`, `512`, `516`, `522`, zone signs and direction signs carrying source text including Nannestad road/place names.

## Road-sequence orientation evidence

The renderer no longer needs to choose an arbitrary nearest road-detail line at intersections when source sequence evidence exists.

A correlation over the exact v0.3 artifact shows:

- **111 / 115 sign plates (96.5%)** can bind to an admitted line geometry carrying the same NVDB `veglenkesekvensid` as the sign point/plate;
- the four unmatched plates are all `522 Gang- og sykkelveg` on sequence `2191058`;
- that sequence has no admitted line geometry in the current street-detail inventory, so those four deliberately retain nearest-admitted-linear fallback rather than fabricating a sequence axis.

`threeTrafficSignLayer.mjs` therefore uses:

1. matching `veglenkesekvensid` line evidence when available;
2. nearest admitted linear street-detail evidence as explicit fallback;
3. source `Ansiktsside, rettet mot` to select parallel/perpendicular plate-plane semantics.

The final 180-degree front/back metering direction is **not yet claimed**. Sign faces remain double-sided until that direction is separately proven.

## Physical sign composition

The renderer now uses one source-backed plate per linked type-96 object instead of one generic plate per support.

- Type 95 drives source support family/diameter where available (60.3 mm / 88.9 mm poles, 120/150 mm columns, lattice/light-mast variants).
- `Høyde over vegkant` is used where admitted.
- `Plasseringskode` drives vertical slots.
- Equal placement codes share a slot. Their exact horizontal arrangement is not present in the admitted source evidence and is therefore renderer presentation only.
- The support pole is extended to the computed source-plate stack so plates do not float above the support.
- Generic neutral plates remain only for a sign point that has no linked type-96 plate.

Exact Preview-1 renderer A/B on the immutable accepted Nannestad runtime artifacts passed on implementation head `5dd687fc7d8d3d651efe529f36509e40d89655be`, including the r187/Vite composition and device-resource smoke.

## Official Statens vegvesen artwork source

Official source page:
`https://www.vegvesen.no/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/filer-og-fargekoder-for-trafikkskilt/`

Dataset/license page:
`https://dataut.vegvesen.no/dataset/trafikkskilt`

The provider publishes ZIP archives by sign family in EPS/JPG/PNG formats. The traffic-sign dataset is exposed under **NLOD 1.0**.

First bounded source probe: `vikeplikt-jpg.zip`.

Observed exact provider archive evidence:

- byte size: `460467`;
- SHA-256: `4333750af2929d0e7e359457b837351fe8b51dc1638fe963804902dd514c1b28`;
- seven image files / seven inferred base sign codes;
- entries: `202_0.jpg`, `204_0.jpg`, `206_0.jpg`, `208_0.jpg`, `210_0.jpg`, `212_0.jpg`, `214_0.jpg`;
- live source probe workflow: `svv-sign-artwork-probe` run `41668482952` — PASS.

The source ZIP is preprocessing input only. Browser runtime must consume normalized, SHA-bound derived assets and a manifest, never fetch the raw provider ZIP.

## Current truth boundary

Source-backed today:

- sign-point and sign-plate IDs/positions;
- type-96 parent relations;
- `Skiltnummer`, source text/color/category fields;
- placement codes;
- support family and source mount height where available;
- source-location / road-sequence evidence;
- provider identity/license/archive bytes for the first official artwork family.

Still presentation/derived:

- exact physical plate dimensions from the categorical `Størrelse` field;
- exact horizontal arrangement of multiple plates sharing a placement code;
- final 180-degree front/back orientation;
- Canvas facsimile artwork for signs whose official provider bytes have not yet been runtime-admitted.

## Next acceptance

Finish the fail-closed materializer for exact `202` and `206` artwork, prove per-file SHA-256 and deterministic mapping from provider entries to NVDB base codes, then stage those normalized assets through the existing preview/runtime manifest before replacing Canvas facsimiles. Expand to additional sign families only after the same source-byte and mapping gate passes.
