# 2026-08-19 — Mixed-LOD transition candidate measurements

Role: LUMEN — Renderer & Web Platform  
Status: bounded experiment; **no crack-prevention strategy selected**

## Trigger

The exact Nannestad LOD error probe measured potential unstitched boundary mismatch up to:

- 65 ↔ 129: **2.5353 m**;
- 129 ↔ 257: **1.4746 m**.

Nested XY grids therefore do not by themselves make mixed adjacent LOD crack-safe.

This proof compares two bounded renderer candidates without changing source data, runtime tile identity or world truth:

1. edge morph/snap of the fine outer ring onto the coarse piecewise-linear boundary;
2. render-only skirts, measured only for geometry/buffer cost.

Index stitching remains an explicit unmeasured candidate.

## Exact input / method

Input is the accepted Nannestad terrain artifact SHA:

`780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`

The surface uses the same Float32 terrain Y and triangle topology as the current renderer-facing mesh probe. All 1,000,000 source pixel centers are reevaluated after edge morph.

### Edge morph candidate

Only fine-level outer-ring vertex heights are changed. Every modified fine boundary vertex is placed on the coarse level's piecewise-linear boundary at the same XY coordinate. Interior vertices remain unchanged.

This makes the geometric boundary curves identical by construction for the tested level pair.

## 65 -> 129 edge morph

Before morph:

- mixed-edge mismatch RMSE: 0.3494 m;
- p95 absolute mismatch: 0.8304 m;
- p99: 1.3750 m;
- max: **2.5353 m**.

Morph scope:

- changed fine vertices: **256 / 16,641 = 1.538%**;
- mean absolute changed-vertex displacement: 0.3107 m;
- max changed-vertex displacement: **2.5353 m**.

Fine 129 whole-tile geometric error:

- RMSE before: 0.182518 m;
- RMSE after: 0.186462 m;
- delta: **+0.003944 m** (+2.16%);
- p95 abs before: 0.407126 m;
- p95 abs after: 0.414132 m;
- max source error remains 2.388629 m.

Boundary mismatch after morph: **0 m** for the tested edge samples.

## 129 -> 257 edge morph

Before morph:

- mixed-edge mismatch RMSE: 0.1475 m;
- p95 absolute mismatch: 0.3124 m;
- p99: 0.6719 m;
- max: **1.4746 m**.

Morph scope:

- changed fine vertices: **512 / 66,049 = 0.775%**;
- mean absolute changed-vertex displacement: 0.1189 m;
- max changed-vertex displacement: **1.4746 m**.

Fine 257 whole-tile geometric error:

- RMSE before: 0.070922 m;
- RMSE after: 0.071838 m;
- delta: **+0.000916 m** (+1.29%);
- p95 abs before: 0.151709 m;
- p95 abs after: 0.152904 m;
- max source error remains 1.521957 m.

Boundary mismatch after morph: **0 m** for the tested edge samples.

## Interpretation of edge morph result

On this one low-relief tile, making the fine boundary follow the coarse boundary has very small **whole-tile** error cost because only the outer ring changes.

That does **not** make hard snapping acceptable. Individual boundary vertices can move 1.5–2.5 m here. An instantaneous transition could visibly pop. A runtime candidate would therefore need to test temporal geomorphing, stable transition hysteresis or an index-stitching topology rather than simply toggling snapped heights in one frame.

Physics/collision should not silently inherit renderer morph geometry; authoritative world height remains the verified height-grid/world contract.

## Skirt resource-cost candidate

A simple skirt projection duplicates each unique boundary vertex and adds one quad/two triangles per boundary segment. No skirt depth is selected.

| Fine level | Added boundary vertices | Added triangles | Terrain GPU before | With skirt | Delta |
|---:|---:|---:|---:|---:|---:|
| 129 | 512 | 1,024 | 595,992 B | 614,424 B | **+18,432 B (+3.09%)** |
| 257 | 1,024 | 2,048 | 3,158,040 B | 3,207,192 B | **+49,152 B (+1.56%)** |

Skirts are cheap in buffer bytes here, but they do not make neighboring terrain surfaces equal. They hide the visual gap with deliberately non-authoritative vertical render geometry. A globally safe skirt depth cannot be inferred from one Nannestad tile, and skirts are inappropriate as authoritative collision/world geometry.

## Index stitching remains open

A topology that connects a fine interior to the coarse boundary while omitting incompatible fine edge vertices may avoid both a visible gap and large instantaneous vertex morph. It likely trades additional index patterns/tooling complexity rather than large vertex memory.

This session did not implement or benchmark index stitching, so it remains a candidate rather than an implied recommendation.

## Reproducibility tooling

Additive persistent-branch files:

- `tools/geo/terrain_lod_transition_probe.py`;
- `tools/geo/test_terrain_lod_transition_probe.py`.

The probe reports both edge-morph geometric effects and skirt byte/triangle projection while keeping `selected_strategy: null`.

As with the base LOD probe, exact numerical calculations were executed in the current analysis environment against the accepted artifact. The newly committed persistent-branch test files are not yet claimed GitHub-CI PASS while `agent/lumen-hourly` remains ancestry-diverged from the latest `main`.

## What is now known

- mixed LOD requires an explicit crack-prevention contract;
- outer-ring morph can eliminate boundary mismatch with small aggregate error cost on this tile, but hard snap displacement is large enough to create a popping risk;
- skirts are buffer-cheap but render-only/non-authoritative and need an evidence-backed depth policy;
- index stitching deserves a direct benchmark before any strategy is chosen.

## Next

1. Benchmark index stitching vs temporal edge morph vs skirt on the same exact tile and camera.
2. Measure transition popping/frame cost during movement, not only static geometry.
3. Repeat on rough/mountain terrain before generalizing displacement bounds.
4. Keep collision/world-truth independent from render crack masking.
5. After real neighboring tiles are promotable, test the chosen candidate across actual tile boundaries and origin shifts.
