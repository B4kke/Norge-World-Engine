# SENTINEL — strict Android WebGPU ↔ WebGL2 A/B

Date: 2026-08-19  
Role: SENTINEL — Integration & QA  
Gate: `P0-VIEWER-01`  
Evidence class: operator Android Chrome browser capture; physical handset identity remains operator-attested, not cryptographically attested by the browser artifact.

## Purpose

This proof records the first device-evidence pair that satisfies the repository's strict comparison context after the earlier WebGL2 antialias/MSAA mismatch was corrected.

Both captures use:

- exact viewer commit `b8cb6b35de3847aaab4357a9d89f81029dfb6997`;
- deployment `srv-da2dg1s9v7es73c5ioqg`;
- capture session `ab-msaa1-001`;
- Android Chrome 151 browser context;
- graphics profile `balanced`;
- max DPR 1.5;
- MSAA/sample count 1;
- power preference `default`;
- render surface 360×447 CSS px / 540×642 backing px / pixel ratio 1.5;
- camera yaw `-0.78`, pitch `0.62`, distance `1180`;
- 90 requested/measured repeated draws;
- exact accepted Nannestad terrain/road/building artifact identities;
- identical streaming movement comparison contract.

`compareDeviceEvidenceContext()` was reconstructed against the two supplied JSON files and produced **zero mismatches**. Therefore the comparison context is accepted as `comparable=true`.

## World/runtime equality

Both captures report:

- terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- roads SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- buildings SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`;
- all three layers `RUNTIME_VERIFICATION_PASS`;
- 7 runtime requests / 0 raw-source runtime calls;
- terrain 16,641 vertices / 32,768 triangles;
- 246 road paths / 135 building footprints;
- 15 source-backed building heights / 120 unresolved heights;
- retained terrain 4,729,120 B;
- movement `center -> outside-active-inside-retain -> center`;
- resolver calls `1 -> 1`;
- load-start delta `0`;
- cache-hit delta `1`;
- trace 9 retained / 0 dropped;
- `renderer_resource_lifecycle_observed=false`.

The WebGPU capture reports `webgpu_feature_level="core"` and `webgpu_adapter_request_mode="core"`; the core adapter request succeeds directly when Chrome's Unsafe WebGPU diagnostic flag bypasses the observed normal-state blocklist.

## Strict renderer A/B result

### Repeated draw CPU

| Metric | WebGL2 | WebGPU | WebGPU delta vs WebGL2 |
|---|---:|---:|---:|
| p50 | 1.150 ms | 0.300 ms | -73.9% |
| p95 | 1.855 ms | 0.600 ms | -67.7% |
| p99 | 2.985 ms | 0.655 ms | -78.1% |
| max | 6.100 ms | 1.100 ms | -82.0% |

This is CPU-side renderer command/update cost. It is not a direct GPU execution-time measurement.

### Repeated-draw frame gaps

| Metric | WebGL2 | WebGPU | Observation |
|---|---:|---:|---|
| p50 | 16.700 ms | 16.700 ms | effectively equal / refresh-limited |
| p95 | 16.855 ms | 18.055 ms | WebGL2 lower by 1.20 ms |
| p99 | 35.315 ms | 18.577 ms | WebGPU lower by 47.4% |
| max | 50.000 ms | 19.200 ms | WebGPU lower by 61.6% |

One 90-frame run is not sufficient to convert tail-gap differences into a broad device/backend conclusion. The p50 is refresh-limited and the WebGPU p95 is slightly worse while its p99/max are materially lower. Repeatability is the next statistical gate if this difference becomes architecture-significant.

### Renderer construction/apply CPU

| Metric | WebGL2 | WebGPU | WebGPU delta vs WebGL2 |
|---|---:|---:|---:|
| scene build | 13.700 ms | 11.800 ms | -13.9% |
| GPU-resource apply CPU | 19.200 ms | 2.700 ms | -85.9% |
| renderer init | 53.900 ms | 31.400 ms | -41.7% |

WebGPU additionally spends 15.7 ms in adapter+device acquisition in its reported renderer timing. WebGL2 has no directly analogous field.

## Startup / terrain pipeline — do not attribute to backend

The captures are strict matches for comparison context, but their pre-render terrain/input latency differed materially:

- WebGL2 terrain pipeline total: **236.2 ms**;
- WebGPU terrain pipeline total: **496.4 ms**;
- delta: **+260.2 ms** in the WebGPU capture.

Largest differences were outside renderer work:

- `resolveInput`: 85.6 ms WebGL2 vs 245.9 ms WebGPU;
- worker roundtrip: 117.1 ms WebGL2 vs 215.8 ms WebGPU;
- worker-reported CPU stayed comparatively close: 22.4 vs 26.8 ms;
- verification: 5.2 vs 5.8 ms;
- decode: 28.0 vs 28.6 ms.

Consequently `input_to_first_frame_ready_ms` was 487.2 ms for WebGL2 and 1081.7 ms for WebGPU, but this **must not be interpreted as WebGPU renderer startup being 122% slower**. Most of the observed delta exists before renderer initialization and likely includes transport/runtime scheduling/cache variance that this pair does not isolate.

A controlled startup benchmark requires repeated alternating/cold-warm captures or an artifact-local/no-network input path before attributing first-frame differences to the renderer backend.

## Capability boundary

This A/B was obtained with Chrome's Unsafe WebGPU diagnostic flag enabled because the same handset/browser state previously exposed `navigator.gpu` but returned no normal core or compatibility adapter. `chrome://gpu` evidence showed Xclipse 960 Vulkan and OpenGL ES compatibility adapters present but Dawn-blocklisted.

Therefore:

- the A/B is valid evidence about the NWE renderer implementations on this handset/GPU when WebGPU access is diagnostically enabled;
- it is **not** production WebGPU availability evidence for normal Chrome;
- WebGL2 remains a required fallback/baseline for this observed normal browser state;
- no final renderer architecture decision is made here.

## Acceptance classification

**PASS — strict matched Android renderer comparison context.**

Accepted claim:

> On the exact current Nannestad Preview 1 scene, same Android Chrome capture context, same commit/session/profile/surface/camera/artifacts/streaming contract and one-sample raster workload, the NWE WebGPU backend shows materially lower CPU-side repeated-draw and resource-apply cost than the NWE WebGL2 backend in this single 90-frame operator capture.

Not accepted:

- WebGPU is globally faster on this or other devices;
- WebGPU GPU execution itself is 68–82% faster (GPU timestamp measurements are not yet captured);
- WebGPU has better first-frame/startup performance (pre-render terrain/input variance dominates this pair);
- normal Chrome production WebGPU availability;
- gameplay/camera-motion performance;
- renderer GPU resource unload/reload;
- multi-tile/LOD performance;
- final WebGPU/WebGL2/Cesium architecture selection.

## Next

1. Preserve WebGPU-first experimentation with WebGL2 fallback; do not promote it to a final decision yet.
2. Add actual GPU timestamp-query measurements on WebGPU and the closest feasible WebGL2 GPU timer-query equivalent, clearly capability-gated.
3. Run repeated alternating backend captures to characterize p95/p99 variance rather than relying on one 90-frame sample.
4. Separate startup into artifact/network input, provenance/decode/worker, adapter/context, scene build, GPU resource application and first submitted/completed frame before comparing first-visible startup.
5. Keep renderer-resource streaming and real neighboring-tile/LOD acceptance separate from this single-tile fixed-scene renderer benchmark.
