---
name: nwe-gpu-geometry
description: Guides renderer-neutral mesh/buffer geometry, batching and instancing for NWE, with WebGPU-aware realization and optional Three.js adapters.
---

# NWE GPU Geometry

Adapt the useful BufferGeometry/custom-geometry/instancing concepts from the upstream Three.js geometry skill, but make the data contract renderer-neutral first.

## Engine-neutral contract

A compiled/runtime geometry payload should describe data, not a renderer class. Prefer typed arrays plus explicit metadata such as:
- positions and index type;
- normals/tangents/UVs when present;
- primitive topology;
- bounds;
- semantic layer/material ID;
- source/fallback truth labels;
- render-origin assumptions where relevant.

Authoritative world positions remain high precision outside GPU geometry. Convert to render-local Float32 only at the renderer boundary.

## Representation order

Choose the least expensive representation that meets the visual/accuracy need:
1. shared indexed geometry;
2. merged/batched static geometry when identity does not require a draw call;
3. instancing when many objects share geometry/material;
4. per-object meshes only when interaction/material/state requires it;
5. GPU-driven culling/indirect drawing only after a measured CPU/draw-call bottleneck.

Do not use maximum source detail at every distance by default.

## Terrain, roads and buildings

- Terrain vertex heights stay tied to accepted terrain artifacts; normals/UV/detail coordinates are derived presentation data.
- Road surface width/edge geometry must preserve whether width is source-backed or renderer-only fallback.
- Building extrusion/roof geometry must preserve source-backed versus fallback height semantics.
- Geometry generation must not write renderer fallbacks back into world truth.

## WebGPU realization

WebGPU changes how buffers/pipelines are realized, not what a road or building *is*. Prefer large coherent buffer uploads, stable layouts and bounded per-frame writes. Storage buffers, compute generation and indirect draws are optional optimization paths, not default architecture.

## Three.js adapter

`BufferGeometry`, indexed attributes, `InstancedMesh`/`BatchedMesh` and related Three constructs are valid realization choices inside the adapter. Do not expose those types to `engine/geo`, compiler schemas, streaming identity or simulation.

## Measure

Track vertices, triangles, draw calls, upload bytes/time and retained GPU bytes. Optimize only when a budget or visual requirement fails.
