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
