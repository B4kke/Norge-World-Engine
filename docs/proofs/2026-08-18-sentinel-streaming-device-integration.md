# SENTINEL — exact-real streaming trace ↔ device evidence integration

Date: 2026-08-18  
Role: SENTINEL — Integration & QA  
Gate: `P0-STREAMING-01` / `P0-VIEWER-01`

## Dependencies

This integration branch is based on exact STRØM PR #32 head `c3d2386d836c60faa720140e8a312fda8ddce287` and imports the exact LUMEN device-evidence/capture-session implementation blobs from PR #30 head `b8af4565aa50a537bbbcde8cee701015ac2d86fb` before adding the cross-agent adapter.

It must not be merged independently of those parent changes. The branch exists to prove that their contracts compose on the same exact-real Preview 1 path.

## Problem

STRØM had a bounded renderer-neutral `nwe.streaming-movement-trace/0.1`, and LUMEN had a comparable same-session WebGL2/WebGPU device evidence format. The deployable Nannestad device-evidence route did not yet connect them.

That meant a phone capture could report renderer frame/resource metrics while scheduler lifecycle, terrain verification/decode/worker timing, cache re-entry and refetch behavior remained a separate evidence stream.

## Implementation

`apps/world-viewer/src/preview1.ts` now:

- wraps the existing exact terrain load function with STRØM `createObservedTerrainTileLoadFunction()`;
- sends scheduler events and terrain-load observations into one bounded `createStreamingTraceRecorder({ maxEntries: 256 })`;
- captures the initial resident scheduler snapshot;
- keeps normal Preview 1 startup behavior unchanged unless `streamingMovementProbe=true`;
- after the first renderer frame, an enabled probe moves the runtime camera exactly 1000 m east — outside the 800 m active radius but inside the 1200 m retain radius — and then returns to center;
- requires `resident -> cached -> resident`, exactly one cache hit, zero additional load starts and zero resolver refetches;
- exports the movement probe and full bounded trace into the Preview runtime result;
- fails closed if any trace entries were dropped.

Running the movement probe **after first-frame-ready** preserves the original input→first-frame measurement boundary.

`deviceEvidenceEntry.mjs` enables the movement probe for the device-evidence route. It also exposes a same-origin, opt-in `report=` hook used only by browser proof automation so CI opens the exact route a real handset uses rather than merely proving the bundle exists. `deviceEvidence.mjs` embeds the movement probe + trace in the downloaded evidence JSON and compares a stable streaming contract across backend captures. Dynamic trace timestamps and probe duration are deliberately excluded from WebGL2/WebGPU comparability.

`run_device_evidence_browser_smoke.mjs` serves the built Vite app locally, opens `/device-evidence.html` in Chrome, receives the final evidence through that same-origin report hook and fails unless the accepted exact Nannestad artifacts, provenance, request count, scheduler transition sequence and no-refetch cache return all hold.

## Critical claim boundary

This is a real verified single-tile runtime/cache movement probe. It is **not** a renderer resource streaming probe yet.

The renderer is created before the movement probe and keeps its already-created terrain GPU resource. Therefore every movement record explicitly carries:

`renderer_resource_lifecycle_observed: false`

Device evidence rejects an ambiguous `true` value. A future renderer-resource lifecycle integration must be a separate measurable change.

## Fail-closed cases

The device-evidence regression now requires rejection of:

- dropped streaming trace entries;
- a movement result without its trace;
- ambiguous/incorrect renderer-resource-lifecycle attribution;
- changed streaming probe contract between renderer captures;
- all existing raw-source, provenance, device-target, capture-session, build, camera, surface and measurement-window mismatches.

The exact-real browser smoke additionally requires:

- accepted tile `epsg25832_611000_6677000_1000m`;
- accepted terrain/road/building artifact SHAs;
- all three layers `RUNTIME_VERIFICATION_PASS`;
- WebGL2 active backend;
- exactly 7 world/runtime requests and 0 raw-source calls;
- movement `center -> outside-active-inside-retain -> center`;
- resolver calls `1 -> 1`, load-start delta `0`, cache-hit delta `1`;
- no trace entry loss;
- snapshots `initial-resident`, `outside-active-inside-retain`, `returned-center`;
- scheduler event sequence containing exactly one load start and a deactivate/reactivate cache round-trip.

## Exact-head evidence

Branch head: `fe226120a0c9f0c975e9112427ccfbc1a3b28c7a`. GitHub evaluated PR merge composition `2e426fc7242a23161530ac81a3176d3596f88e79` against exact STRØM #32 base.

All three primary gates passed:

- baseline run `32189735266` — **PASS**;
- viewer-benchmark run `32189735315` — **PASS**;
- world-viewer-vite run `32189735245` — **PASS**.

The Vite job executed `device evidence regressions: PASS`, built the device route, ran exact accepted-artifact Preview 1 WebGL2, then executed the new exact-real device-evidence movement/cache smoke in Chrome 151.

Exact-real smoke result:

- schema `nwe.device-evidence-browser-smoke-proof/0.1` — **PASS**;
- accepted terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- accepted roads SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- accepted buildings SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`;
- terrain/roads/buildings all `RUNTIME_VERIFICATION_PASS`;
- runtime requests: **7**;
- raw-source runtime calls: **0**;
- movement offset: **1000 m east**;
- active/retain radii: **800 / 1200 m**;
- resolver calls: **1 -> 1**;
- load-start delta during movement: **0**;
- cache-hit delta: **1**;
- retained trace entries: **9**;
- dropped trace entries: **0**;
- snapshots: `initial-resident`, `outside-active-inside-retain`, `returned-center`;
- scheduler events: `load-started`, `load-completed`, `tile-activated`, `tile-deactivated`, `tile-activated`;
- renderer backend: WebGL2, 4 draw calls/frame;
- `renderer_resource_lifecycle_observed=false`.

The uploaded smoke evidence ZIP SHA-256 is `8cd86866f632d6f192f23ba14e20fac15d7a95c6c239745ad9e7f3ef110249b6`.

## Operator Android Chrome evidence

### Normal Chrome WebGPU availability

On Render build `1ca5ade04fd3b624996f21e01e78f0bdc8600700`, Chrome 151 exposed `navigator.gpu` but returned no adapter for either the normal/core request or `featureLevel: "compatibility"`. This remained true with `graphics=high` / `powerPreference="high-performance"` and with `graphics=balanced` / default power preference. The failure therefore occurred before `GPUDevice`, WGSL, pipeline, resource creation or draw submission.

A separate `chrome://gpu` operator dump showed that the handset GPU stack was present but Dawn classified both the Vulkan Xclipse 960 adapter and OpenGL ES compatibility adapter as blocklisted in that Chrome state. This is environment/capability evidence, not a production renderer failure.

### Unsafe-WebGPU diagnostic run — PASS

After the operator enabled Chrome's Unsafe WebGPU diagnostic flag, the first attempt on build `1ca5ade...` advanced past adapter/device/context/first-frame and exposed a renderer-wrapper contract bug: common benchmark code called `invalidate()` while the WebGPU adapter only exposed `drawForBenchmark()` / `stop()`. The backend contract was normalized on commit `a5f2e65dcd06dda1460cd0ccb44bb8848d9597a7` so both WebGL2 and WebGPU expose `invalidate()` / `dispose()` to Preview 1.

The operator then supplied `nwe.world-viewer-device-evidence/0.1` **PASS** from the same Render deployment on Android Chrome 151:

- build: `a5f2e65dcd06dda1460cd0ccb44bb8848d9597a7`;
- capture session: `unsafe-webgpu-002`;
- requested + active backend: **WebGPU**, no fallback;
- graphics profile: `balanced`, max DPR 1.5, MSAA 1, default power preference;
- exact accepted terrain/road/building SHAs; all three `RUNTIME_VERIFICATION_PASS`;
- runtime requests: **7** / raw-source runtime calls: **0**;
- movement/cache probe: **PASS**, resolver `1 -> 1`, load-start delta `0`, cache-hit delta `1`;
- streaming trace: **9 retained / 0 dropped**;
- retained terrain: **4,729,120 B**;
- terrain: **16,641 vertices / 32,768 triangles**;
- draw calls/frame: **4**;
- GPU buffers: **13**, payload **849,566 B**;
- estimated GPU attachments: **1,386,720 B**;
- timestamp-query capability reported: **true**;
- render surface: 360×447 CSS px / 540×642 backing px / renderer pixel ratio 1.5;
- input -> first-frame-ready: **386.3 ms**;
- startup rAF p50/p95/p99/max: **16.7 / 16.89 / 23.218 / 25.0 ms**;
- repeated 90-draw frame-gap p50/p95/p99/max: **16.7 / 18.255 / 20.548 / 35.5 ms**;
- repeated-draw CPU p50/p95/p99/max: **0.30 / 0.555 / 1.166 / 1.70 ms**;
- terrain pipeline: **271.8 ms total** = 104.5 resolve + 4.9 verify + 21.0 decode + 141.0 worker roundtrip, worker-reported 28.6 ms;
- renderer timing: 17.1 ms adapter+device, 14.3 ms scene build, 1.9 ms GPU-resource apply CPU, 33.8 ms renderer init;
- used JS heap: ~24.5 MB;
- 246 road paths / 135 building footprints / 15 source-backed building heights / 120 unresolved heights.

This proves that the NWE WebGPU implementation can obtain a device, build the exact-real Preview 1 scene, submit a real first frame and complete the 90-draw measurement loop on the operator handset when Chrome's blocklist is bypassed diagnostically.

### Strict matched A/B — PASS

A later matched capture pair on commit `b8cb6b35de3847aaab4357a9d89f81029dfb6997`, session `ab-msaa1-001`, `balanced`, DPR 1.5 and one-sample raster workload now satisfies `compareDeviceEvidenceContext()` with **0 mismatches / comparable=true**.

Accepted renderer observations from that pair:

- WebGPU core adapter request succeeds directly under Unsafe WebGPU;
- repeated-draw CPU p50/p95/p99/max: WebGPU **0.300 / 0.600 / 0.655 / 1.100 ms** vs WebGL2 **1.150 / 1.855 / 2.985 / 6.100 ms**;
- GPU-resource-apply CPU: WebGPU **2.7 ms** vs WebGL2 **19.2 ms**;
- renderer init CPU: WebGPU **31.4 ms** vs WebGL2 **53.9 ms**;
- frame-gap p50 is effectively identical; WebGPU p95 is slightly worse while p99/max are lower in this single 90-frame capture.

Startup total is explicitly **not** attributed to the renderer backend from this pair because the pre-render terrain/input pipeline differed materially: WebGPU **496.4 ms** vs WebGL2 **236.2 ms**, mostly in `resolveInput` and worker roundtrip before renderer initialization.

Full strict-A/B proof: `docs/proofs/2026-08-19-android-webgpu-webgl2-strict-ab.md`.

## Acceptance classification

**PASS — exact-real single-tile verified runtime/cache movement is proven through the same deployed device-evidence application route.** Android Chrome has now executed the exact accepted Nannestad terrain/road/building path with full provenance, real module worker, cache round-trip and measured WebGL2. A diagnostic Unsafe-WebGPU run additionally proves the WebGPU implementation through first frame and 90 repeated draws on the handset, and a later strict matched pair proves backend-comparable CPU-side renderer measurements under the diagnostic flag.

**Still open / explicit non-claims:**

- normal Chrome on this handset remains WebGPU-capability blocked in the observed default browser state; the unsafe flag is not a production requirement or acceptance path;
- the strict A/B measures CPU-side draw/update/resource application, not direct GPU execution time; actual GPU timing is still open;
- one 90-frame pair is not a repeatability/general-device conclusion;
- first-frame/startup performance is not backend-isolated because pre-render terrain/input latency varied materially between the matched captures;
- repeated identical-scene draws are not gameplay/camera-motion acceptance;
- `renderer_resource_lifecycle_observed=false`: GPU resource unload/reload is still not proven;
- real neighbor-tile transitions, 2×2/3×3 streaming, worker-pool/LOD/hard memory policy and multi-tile DTM1 seam authority remain open.
