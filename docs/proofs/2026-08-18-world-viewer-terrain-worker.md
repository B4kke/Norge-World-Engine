# 2026-08-18 — World Viewer Forsøk 18 terrain DedicatedWorker

## Scope

Prove that the deployable World Viewer can run one terrain tile through the browser runtime boundaries that were previously proven only with Node/protocol shims:

`RuntimeVerificationBundle -> WebCrypto/JCS verification -> NWEHGT01 decode -> module DedicatedWorker -> TileStreamingScheduler -> WebGL2 measurement upload/draw`.

This proof deliberately uses a **synthetic structural 1000 × 1000 terrain fixture**. It proves the browser/runtime lifecycle and measurement boundary, not Norwegian geodata correctness. The accepted Nannestad DTM1 artifact remains a separate real-data identity and must be exercised through this browser path before real-terrain browser performance is claimed.

## Implementation

- `apps/world-viewer/terrain_runtime_input.mjs` loads only a compiled terrain bundle + artifact and keeps the raw-source transport guard before artifact fetch.
- `apps/world-viewer/terrain-streaming/experiment.mjs` is shared by CI and the Vite application. It uses the default `TerrainMeshWorkerClient`, which creates a module `DedicatedWorker`.
- `apps/world-viewer/src/terrainExperiment.mjs` exposes the same lifecycle from the main World Viewer canvas.
- Default in-app mode is visibly marked `SYNTHETIC STRUCTURAL`.
- A real hosted bundle can use the same path with `terrainBundle`, `terrainTileId`, `centerE` and `centerN` query parameters; raw source acquisition remains outside the viewer.
- WebGL2 is only the current measurement harness. This proof does not select WebGL2, WebGPU, Three.js or Cesium as the production renderer.

## Exact hosted proof

GitHub Actions `world-viewer-vite` run **32144204222** on PR head **`7a371c0359511b111e5d1933d75c3dc4fb22a8fc`** passed in Google Chrome **151.0.7922.108**.

The Vite build emitted the terrain worker as its own browser asset (`terrain_mesh_worker-*.js`), then the browser experiment returned:

- verification: `RUNTIME_VERIFICATION_PASS`;
- worker boundary: module `DedicatedWorker` through the default `TerrainMeshWorkerClient` factory;
- source grid: **1000 × 1000** float32 samples;
- render mesh: **129 × 129**, **16,641 vertices**, **32,768 triangles**, **729,120 B**;
- retained scheduler payload: **4,729,120 B**;
- scheduler: **1 load started / 1 completed / 0 failed**, **1 cache hit**, **0 evictions**, final resident count 1;
- cache probe: camera moved **35 m** from tile center — outside the 20 m active radius but inside the 50 m retain radius — then returned;
- resolver calls: **1**, proving the cache return did not re-resolve/reload terrain;
- benchmark runtime requests: **2** (bundle + compiled artifact);
- raw Norwegian source calls: **0**.

The synthetic fixture artifact SHA for this run was `078f1bcfd27a6248c1205cb795404bd89fddedadba881013cbb12b941e0d7587`. It is a fixture identity only and must not be confused with the accepted real Nannestad terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`.

## Hosted timing observation

The same run measured:

| Phase | Hosted Chrome |
| --- | ---: |
| runtime input resolve | ~44.2 ms |
| full WebCrypto/JCS verification | ~20.1 ms |
| strict NWEHGT01 decode/validation | ~137.5 ms |
| worker roundtrip | ~72.2 ms |
| worker-reported mesh CPU | ~49.0 ms |
| loader total | ~274.3 ms |
| input -> first visible | ~290.6 ms |
| cache-band exit -> cached idle | ~0.3 ms |
| cache return -> idle | ~0.7 ms |
| GPU apply p95 (2 activations) | ~4.8 ms |
| GPU finish p95 | ~0.1 ms |
| largest rAF gap during initial load | **116.7 ms** |

These values are **hosted synthetic structural measurements**, not Android/device acceptance and not a controlled real-data A/B. In particular, the 116.7 ms rAF gap shows that moving mesh generation to a DedicatedWorker does not by itself guarantee a hitch-free main thread: decode/verification/runtime setup and browser scheduling still need device-level investigation.

## Failed iterations that improved the gate

Two failures were useful and were fixed without weakening the runtime contract:

1. A relative bundle URL was passed into the compiled transport resolver. The shared terrain input boundary now normalizes the bundle URL before resolving the compiled artifact URL.
2. The first camera probe moved 10 km away, correctly causing scheduler eviction because it was outside the retain radius. The final test now probes the actual cache band: outside active radius but inside retain radius.

## What is proven

- The Vite World Viewer bundles and can execute the real module terrain DedicatedWorker.
- Full browser provenance, strict terrain decode, worker transfer/result handling, scheduler lifecycle and WebGL2 upload/draw compose successfully in actual Chrome.
- The resident -> cached -> resident lifecycle returns through scheduler cache without another terrain resolver call.
- The same experiment core is now callable from the visible World Viewer app rather than existing only as a detached benchmark page.

## Not proven

- The exact accepted Nannestad terrain artifact has **not yet** been run through this real browser-worker path.
- Android Chrome/device timings are still open.
- The hosted rAF/GPU timings are not production GPU acceptance.
- No worker-pool policy, provenance cache, hard GPU/resident budget, LOD strategy or renderer is selected.
- Neighboring real terrain remains blocked by the unresolved DTM1 multi-source seam contract.

## Next

1. Serve/stage the accepted Nannestad terrain bundle + artifact and drive those exact bytes through this same World Viewer experiment.
2. Run the same app experiment on Android Chrome and capture verification, decode, worker RTT/CPU, GPU apply, first-visible and rAF gaps.
3. Use that evidence to decide whether decode and/or provenance reconstruction should move off the main thread or be cached; do not weaken verification semantics.
