---
name: nwe-gpu-materials
description: Defines renderer-neutral material semantics and WebGPU-first PBR/shader realization for NWE without embedding Three.js material classes in world data.
---

# NWE GPU Materials

Use the upstream Three.js materials concepts as implementation reference, while keeping NWE material meaning independent from Three.js.

## Engine-neutral contract

World/runtime data may carry stable material semantics such as:
- material ID/class (`terrain`, `asphalt`, `wall`, `roof`, vegetation, etc.);
- base color/tint parameters;
- roughness/metalness intent;
- texture artifact references and UV policy;
- transparency/cutout intent;
- source-backed versus procedural/fallback provenance.

It must not contain `MeshStandardMaterial`, `NodeMaterial`, shader objects or renderer-specific enum values.

## PBR-first rule

Prefer physically meaningful, shared PBR parameters over many bespoke materials. Reuse material instances/pipelines where possible and keep variation in textures, instance data or bounded shader parameters rather than creating a material per feature.

## WebGPU and shader customization

For custom web material logic, prefer a backend-portable graph/shader representation inside the adapter. With Three.js `WebGPURenderer`, TSL + node materials are the preferred custom path because the graph can target WebGPU/WGSL and WebGL2/GLSL.

Raw WGSL is allowed only in a backend-specific module with an explicit need. Raw GLSL is a WebGL-specific implementation. Do not maintain two handwritten shader languages unless TSL/another abstraction cannot meet a measured requirement.

## Truth boundary

Material detail can improve appearance but cannot invent geographic/world semantics. Procedural grass color, road roughness or wall variation stays presentation-only unless backed by compiled source data.

## Three.js adapter

Three's standard/physical/node materials are adapter implementations. Map NWE material IDs/descriptors to them in one place so a later Unreal adapter can map the same semantics to Unreal materials.

## Measure

Track material/pipeline count, draw-call splits, texture bindings, shader compilation stalls and frame cost. A visually richer material is not accepted if it silently explodes pipeline/material cardinality.
