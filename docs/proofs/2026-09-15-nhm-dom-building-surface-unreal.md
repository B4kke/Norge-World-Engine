# Nannestad NHM DOM building-surface → Unreal proof — 2026-09-15

## Scope

This proof improves the active 1 × 1 km Unreal Nannestad slice without promoting
renderer geometry into world truth.

The accepted OSM building artifact remains the footprint/type identity:
`678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`.

Kartverket NHM DTM and NHM DOM are sampled on the exact same 1000 × 1000,
1 m, EPSG:25832 grid. The compiler-side candidate stores only per-footprint
DOM−DTM distributions and source hashes; raw DOM/DTM raster bytes are not
published on the runtime transport branch.

## Source/transport evidence

- Official DOM WCS coverage admitted by live service probe:
  `nhm_dom_topo_25832`.
- DTM/DOM alignment: exact 1 m grid match.
- Candidate schema: `nwe.building-surface-artifact/0.1-candidate`.
- Compiler config:
  `d80cb89ff57170f0bfd6b341c5c6072654919dc29f81954b7eb52753e6477f15`.
- Candidate artifact SHA-256:
  `7b07c587cbbf3e42685cc53d9751fa04471d247e2ab9601daa26e75a2e13721a`.
- Semantic SHA-256:
  `c3297f444d8227ca09897a712d5e34b780fc3999df6f4d4674e529a7b6384488`.
- Current immutable publish commit resolved from `building-surface-runtime`:
  `1d2aaada9ccead75e22c4fd1ed2f85a79ad16207`.
- Candidate contains 132 usable footprint measurements for 135 buildings.

The Unreal fetch step resolves the replaceable transport branch to one immutable
Git commit before downloading artifact + verification, then requires the exact
building-artifact SHA, compiler-config identity, artifact SHA and calibration
quality before accepting it.

## Calibration

The 15 existing OSM source-height buildings currently use
`building:levels × 3 m`, so they are a coarse calibration reference rather
than surveyed truth.

Measured against that reference:

| estimator | MAE | p90 absolute error | within 2 m |
|---|---:|---:|---:|
| p50 | 0.778 m | 1.434 m | 93.3% |
| p75 | 0.884 m | 1.599 m | 93.3% |
| p90 | 1.048 m | 1.816 m | 93.3% |
| p95 | 1.131 m | 1.886 m | 93.3% |

Unreal uses p90 only as a **presentation height derivative**, because p90 is
closer to the upper building surface than p50 while remaining inside the tested
error band.

## Runtime policy

Height priority:

1. admitted OSM source height always wins;
2. otherwise DOM−DTM p90 may be used only with at least 8 valid 1 m samples,
   p90 >= 2.2 m and a conservative building-type plausibility ceiling;
3. otherwise the existing explicit presentation fallback remains.

For pitched presentation roofs, accepted DOM−DTM p95−p25 relief may set the
roof-rise magnitude, clamped to 0.6–4.0 m and the total-height safety bound.
It does **not** claim a surveyed ridge, eave, roof direction or roof shape.

Current exact Nannestad result:

- 135 OSM building footprints;
- 15 OSM source-height buildings;
- 105 previously unresolved buildings now use guarded DOM-derived height;
- 15 remain explicit height fallbacks;
- source roof-shape tags in this OSM snapshot: 0.

## Hosted evidence

Exact PR head: `d4dcfb77850e13eff0d276498657c65988795ece`.

- `nhm-dom-building-height-proof` run `34971239381`: PASS.
- `sentinel-ground-source-probe` run `34971239281`: PASS.
- `baseline` run `34971239525`:
  - Unreal deterministic unit regressions: PASS;
  - Unreal real Nannestad package integration: PASS;
  - `all` result: 105 DOM heights, 15 fallback heights, 819 vegetation instances;
  - subsequent `build`: same 105 / 15 / 819;
  - byte comparison between the two generated package trees: PASS;
  - later historical Cesium 3D Tiles prototype build still fails from the
    already-known dependency drift and is not evidence against this adapter gate.

## Truth boundary

This closes a large **presentation fidelity** gap, not the roof-truth problem.

The per-footprint height distributions are source-derived measurements. The p90
height selection, plausibility thresholds, roof-rise proxy and fallback roof
shape are explicitly renderer policies. Exact roof shape/ridge direction and
façade identity remain open and require richer admitted source evidence or a
separately validated geometric inference artifact.

## Roof-direction follow-up

The same exact DOM-DTM source grids were also evaluated spatially for ridge
direction. A centered tent-surface model was compared against a simple plane
across 2-degree direction steps. The broad experiment analyzed 118 buildings,
accepted 53 gable-like directional fits, and the stricter deterministic compiler
admitted 30 high-confidence direction candidates.

The strong candidate is separately versioned:

- schema: `nwe.building-roof-orientation-artifact/0.1-candidate`;
- compiler config:
  `325cd39feca447c9b1a8995d805525ee9abf37359d5089e9df81069c916b8682`;
- artifact SHA-256:
  `0f6eedb225821da4e0760b96cb843ec01707f99478691c85c8304d847c7270d3`;
- semantic SHA-256:
  `87b54808e77a62e52b4f8dce2d3c584679922daccdf5df89dc505bbeb384dce6`;
- 30/135 source buildings have a strong direction candidate.

A repeat hosted acquisition/compile produced the **same artifact and semantic
hashes**. The compiler rounds fit evidence to 9 decimal places before both
admission and canonical hashing; this removes irrelevant ~1e-16 LAPACK/BLAS
floating-point drift while leaving the 2-degree direction and strong-fit gate
unchanged.

Unreal uses this direction only when the roof is already a presentation-profile
pitched roof. It may orient a presentation gable; it cannot alter a source
roof-shape tag, create a pitched roof from a flat profile, or claim a surveyed
ridge.

Current real-package result on exact head
`88fba398a08b632d253fd5c53030d2ca1ce7dfe6`:

- 105 guarded DOM-derived building heights;
- 15 explicit height fallbacks;
- 10 strong DOM directions applied to existing presentation gables;
- 0 derived hipped ridge segments;
- 819 vegetation representatives;
- 25 mesh packets;
- repeated `all -> build` trees compare byte-identically.

The zero hipped-ridge count is deliberate. All 11 strong candidates that are
currently classified as presentation hipped roofs have concave/complex OSM
footprints. The adapter refuses to replace those with a convex-hull roof because
that would span real footprint recesses with invented geometry.

Hosted evidence:

- `nhm-dom-building-height-proof` run `34981973095`: PASS;
- `baseline` run `34981973005`: Unreal unit regressions and real Nannestad
  package integration PASS; the workflow is red only at the already-known
  historical Cesium prototype dependency build;
- exact Web reference screenshot run `34981972867`: PASS, artifact
  `10401029189`, PNG SHA-256
  `c3d36f082d7cd448e0f29a0b92f8dcaad59c9e423745b0e9ce79f003cef77f1c`.

### Roof truth boundary

The 30 directions are high-confidence interpretations of 1 m DOM-DTM samples,
not FKB `Mønelinje`, surveyed ridge segments, roof-shape truth or eave
geometry. Complex/concave roofs remain explicitly unresolved for richer source
data rather than being visually forced into simple convex roofs.

