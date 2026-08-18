# Terrain mesh worker structural proof — 2026-08-17

Status: **HOSTED CI PASS / ANDROID DEVICE MEASUREMENT OPEN**  
Branch: `agent/terrain-mesh-worker`, stacked on `agent/world-streaming-scheduler` (PR #7), which is stacked on DTM1 PR #6.  
Passing hosted baseline: run `32070831795` on commit `548714f045acb37f0ec34d40792d1348dc4b1322`.

## Motivation

Android Forsøk 16 measured one synchronous 129×129 terrain mesh build at **19.4 ms**, exceeding one 60 Hz frame budget (16.7 ms). The DTM1 world-truth artifact itself is already verified and must not be altered to solve a renderer hitch.

This change moves the CPU render derivative behind a Dedicated Worker boundary while leaving terrain artifact identity, EPSG:25832 coordinates and NN2000 heights unchanged.

## Implemented

- deterministic `terrain_mesh_buffers.mjs` independent of Three.js/WebGPU/Cesium;
- same pixel-center bilinear height sampling contract used by Forsøk 16;
- deterministic regular-grid topology using the same triangle winding as Forsøk 16;
- position, normal, UV and index output buffers;
- fail-closed nodata/non-finite sampling;
- worker job/result schema;
- browser Dedicated Worker implementation;
- browser client with `AbortSignal` cancellation;
- elevation buffer ownership is transferred into the worker and returned with output buffers, avoiding a required structured-clone copy of the current ~4 MB float32 height grid;
- worker output is explicitly a render derivative, not new world truth/provenance.

## Hosted regression evidence

Seven cases pass:

1. pixel-center bilinear sampling contract;
2. deterministic mesh topology/output + normalized up-facing normals;
3. nodata fails closed;
4. worker protocol returns original elevation-buffer ownership plus transferable output buffers;
5. client rehydrates typed buffers correctly;
6. pre-dispatch AbortSignal fails closed;
7. real-scale structural shape: 1000×1000 height input -> 129×129 mesh.

Real-scale synthetic output on the hosted Node runner:

- vertices: **16,641**
- triangles: **32,768**
- indices: **98,304** (`uint16`)
- output mesh buffers: **729,120 B**
- hosted synthetic CPU time: **50.593 ms**

The hosted timing is not comparable to Android Forsøk 16: it is a different CPU/runtime and the new structural path also calculates normals explicitly. It is recorded only to show the job is non-trivial and measurable.

## Browser transfer model

The worker uses transferable `ArrayBuffer` ownership rather than requiring structured-clone copies of binary buffers. The input elevation buffer is detached from the sender while the job owns it and is transferred back with the result so the runtime can reconstruct the height-grid view for subsequent road/building ground sampling.

The current client creates one dedicated worker per mesh job. This gives deterministic cancellation via `worker.terminate()` but worker startup cost is still unmeasured. Pooling is deliberately not accepted until Android/device evidence exists.

## What this proves

- CPU terrain mesh generation has a renderer-independent deterministic implementation;
- it can live behind a worker protocol without mutating geographic truth;
- buffer ownership/cancellation/error boundaries are explicit;
- repository CI protects mesh topology, sampling and worker protocol.

## What remains open

- Android worker CPU/roundtrip/apply timings;
- main-thread rAF/frame-gap during the worker job;
- worker creation/startup cost on Android;
- whether a persistent worker/pool is better for real multi-tile streaming;
- GPU upload cost;
- cancellation of already-running synchronous CPU work without terminating its worker;
- real neighbouring terrain tiles.

## Device gate

Forsøk 17 should compare against the Forsøk 16 device baseline and report:

- worker CPU ms;
- dispatch-to-result roundtrip ms;
- main-thread BufferGeometry/apply ms;
- maximum main-thread `requestAnimationFrame` gap while worker computation is active;
- boot, frame time/FPS, draw calls and GPU objects;
- artifact PASS ×3 and raw-source network = 0.

Acceptance is not “worker CPU is faster.” The important question is whether the main/render thread remains responsive while a terrain tile is prepared.
