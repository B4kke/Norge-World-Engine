# 2026-08-19 — Nannestad terrain mesh error/cost envelope

Role: LUMEN — Renderer & Web Platform  
Scope: measurement only; **no spatial/distance LOD policy selected**

## Why

The existing graphics profiles use terrain output sizes 65 / 129 / 257, but those sizes had not been evaluated against the exact accepted 1 m Nannestad height-grid as geometric approximations. Selecting camera-distance thresholds before knowing geometric error and resource cost would encode an arbitrary LOD policy.

This proof measures the current mesh topology first.

## Exact input

Measurement input came from the existing accepted DTM1 proof package rather than a new raw-source acquisition:

- GitHub Actions run `32134507528`;
- proof artifact ID `9323475070`;
- proof ZIP digest `sha256:3bab48111bda1e40043ed2c41adedef6ce8a211587c254b898b78e4ab93057dc`;
- exact `NWEHGT01` artifact: `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- artifact byte size: `4,000,382 B`;
- tile: `epsg25832_611000_6677000_1000m`;
- source grid: 1000 × 1000, 1 m, EPSG:25832 + NN2000;
- elevation range: 168.97113037109375–197.6241455078125 m.

The artifact SHA was recomputed before measurement and matched exactly. No Kartverket/Geonorge raw-source request was required for this probe.

## Measurement method

For each output size 65 / 129 / 257:

1. sample mesh vertices with the same pixel-center bilinear semantics as `sampleHeightGrid`;
2. use the same regular grid and triangle topology as `buildTerrainMeshBuffers`: `a,d,b` and `b,d,e`;
3. quantize renderer-local vertex Y to Float32, matching the actual position buffer;
4. evaluate the resulting piecewise-linear triangle surface at **all 1,000,000 source pixel centers**;
5. compare reconstructed height to the exact accepted source-grid height at that pixel center;
6. calculate worker mesh bytes and the canonical Preview terrain GPU payload (position + normal + index; UV remains worker-only).

This is geometric surface error, not screen-space error and not perceptual quality.

## Exact Nannestad results

| Output | Cell spacing | Vertices | Triangles | Index | Worker mesh | Renderer terrain GPU | RMSE | Abs p50 | Abs p95 | Abs p99 | Max abs |
|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 65 | 15.625 m | 4,225 | 8,192 | uint16 | 184,352 B | 150,552 B | 0.4346 m | 0.0940 m | 1.0157 m | 1.7113 m | 3.7434 m |
| 129 | 7.8125 m | 16,641 | 32,768 | uint16 | 729,120 B | 595,992 B | 0.1825 m | 0.0393 m | 0.4071 m | 0.7463 m | 2.3886 m |
| 257 | 3.90625 m | 66,049 | 131,072 | **uint32** | 3,686,432 B | 3,158,040 B | 0.0709 m | 0.0157 m | 0.1517 m | 0.2881 m | 1.5220 m |

Absolute-error fractions:

| Output | >0.10 m | >0.25 m | >0.50 m | >1.0 m | >2.0 m |
|---:|---:|---:|---:|---:|---:|
| 65 | 48.5077% | 27.7772% | 15.1048% | 5.1761% | 0.4704% |
| 129 | 28.3793% | 11.2321% | 3.1993% | 0.2901% | 0.0016% |
| 257 | 10.2983% | 1.5206% | 0.1175% | 0.0030% | 0% |

Bias is effectively zero at all three levels (~+4.7 mm for 65, +0.1 mm for 129, +0.08 mm for 257); the important loss is local shape/detail rather than a bulk vertical offset.

## Cost discontinuity at 257

129 -> 257 gives:

- 4× triangles;
- ~2.57× lower RMSE on this tile;
- ~2.68× lower p95 absolute error;
- **~5.30× renderer terrain GPU bytes**, not ~4×.

The extra cost comes from crossing the 65,535-vertex uint16 index ceiling: 257 × 257 = **66,049 vertices**, so the current single-mesh implementation switches to uint32 indices. This is a real representation cost discontinuity, not a benchmark artifact.

65 -> 129 is ~3.96× renderer terrain GPU bytes for ~2.38× lower RMSE.

No conclusion is made here that 129 or 257 is globally correct. Nannestad is one relatively low-relief tile.

## Adjacent-level edge mismatch

The three grids are nested in XY (`65 -> 129 -> 257` doubles cells per axis), so every second fine edge vertex aligns exactly with the coarser edge. Intermediate fine vertices can still depart from the coarser piecewise-linear boundary.

Potential boundary mismatch if adjacent tiles use different levels **without stitching, skirts, geomorphing or an equivalent crack-prevention rule**:

| Transition | Edge samples | RMSE | Abs p95 | Abs p99 | Max abs |
|---|---:|---:|---:|---:|---:|
| 65 -> 129 | 516 | 0.3494 m | 0.8304 m | 1.3750 m | **2.5353 m** |
| 129 -> 257 | 1,028 | 0.1475 m | 0.3124 m | 0.6719 m | **1.4746 m** |

Worst observed boundaries on this tile:

- 65 -> 129: west edge, max 2.5353 m;
- 129 -> 257: south edge, max 1.4746 m.

These numbers are **potential geometric boundary mismatch**, not an observed rendered screen crack. They prove that a spatial LOD experiment needs an explicit crack-prevention contract; nested XY coordinates alone are insufficient.

## 3×3 capacity projection — not multi-tile evidence

If all nine future 3×3 tiles had the same payload shape as this tile, simple linear arithmetic gives:

| Output | 9× retained runtime terrain* | 9× renderer terrain GPU** |
|---:|---:|---:|
| 65 | 35.91 MiB | 1.29 MiB |
| 129 | 40.59 MiB | 5.12 MiB |
| 257 | 65.97 MiB | 27.11 MiB |

\* 4,000,000 B elevation grid + worker mesh per tile.  
\** terrain position + normal + index buffers only; excludes vectors, programs/pipelines, textures, framebuffer attachments and driver overhead.

This table is a **capacity projection only**. It is not a real 3×3 runtime measurement and does not bypass the DTM1 seam/source-authority gate.

## Reproducibility tooling

Additive files on persistent branch `agent/lumen-hourly`:

- `tools/geo/terrain_lod_error_probe.py` — parses exact `NWEHGT01`, SHA-gates input, evaluates actual triangle surface and emits JSON;
- `tools/geo/test_terrain_lod_error_probe.py` — synthetic regressions for flat-surface exactness, error reduction, edge mismatch, SHA rejection and the 257 uint32 transition.

The numerical evidence above was executed in the current analysis environment directly against the downloaded exact artifact using the same formulas and Float32 quantization contract. The newly committed repo tool/test files have **not yet been promoted to a GitHub CI PASS claim** because `agent/lumen-hourly` is currently diverged from the newly advanced `main` and has no active PR. Do not conflate the executed exact-artifact measurement with unexecuted branch CI.

## What is now known

- 65/129/257 have a measured error/cost envelope on exact Nannestad terrain rather than being only graphics-profile labels.
- 257 has a material uint32 index cost discontinuity.
- mixed adjacent levels need a crack-prevention contract before runtime LOD can be accepted.
- 129 is a useful **candidate comparison point** on this tile, but no global level or distance threshold is selected.

## Next

1. Safely reconcile persistent `agent/lumen-hourly` with current `main` without force, then execute the new probe regressions in CI.
2. Repeat the same error probe on representative rough/mountain/coastal/urban terrain before generalizing Nannestad.
3. Define and test a crack-prevention candidate (stitching/skirt/geomorph or constrained neighbor-level delta) separately from the distance-selection policy.
4. After FORGE resolves real neighboring source/seam authority, run actual 2×2/3×3 mixed-level movement and measure GPU/resource churn.
5. Only then map geometric error to camera projection/screen-space error and select LOD thresholds from device evidence.
