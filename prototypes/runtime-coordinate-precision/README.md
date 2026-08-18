# Runtime coordinate precision experiment

VEKTOR experiment for one open P0 world-contract question: how much precision is lost if large world coordinates are quantized directly to GPU-style Float32 values, and how much precision is recovered by rebasing around a local origin before Float32 conversion?

This experiment is deliberately isolated from terrain acquisition, tile identity, streaming, renderer choice and compiled artifact identity. It uses only synthetic coordinates at the same numeric magnitude as Prototype 0 (`EPSG:25832`, around E=611000 / N=6677000). It does **not** select EPSG:25832 as the whole-Norway runtime CRS.

## Run

```bash
node prototypes/runtime-coordinate-precision/test_precision.mjs
node prototypes/runtime-coordinate-precision/benchmark.mjs
```

The test is deterministic and fail-closed. The benchmark reports deterministic precision data plus host-dependent CPU timings for rebasing 1k, 10k and 100k xyz entities from `Float64Array` world positions into `Float32Array` local positions.

## What is being tested

- Float32 ULP at Prototype-0 easting/northing magnitude.
- Whether mm/cm/sub-meter offsets survive absolute Float32 storage.
- reconstruction error after `Float64 world - Float64 origin -> Float32 local -> Float64 reconstruction` over local radii from 1 m to 1000 km.
- Z precision independently at representative height magnitudes.
- adversarial repeated origin shifts comparing:
  - recomputation from authoritative Float64 world positions; and
  - repeated mutation of already-quantized Float32 local positions.
- CPU rebasing cost on the executing Node/V8 host.

## Interpretation boundary

Precision results are IEEE-754/Float32 evidence and deterministic for the probed values. CPU timings are Node/V8 host evidence only and must not be presented as Android/browser/GPU performance.

The experiment may justify a later runtime coordinate contract, but it does not itself accept one. In particular, it does not decide:

- whole-Norway coordinate/index strategy;
- tile size or tile identity;
- origin-shift trigger radius;
- WebGL2 vs WebGPU vs Cesium/custom renderer;
- terrain/mesh format.

Any production decision must be recorded separately in `docs/04-decisions.md` after integration/device evidence exists.
