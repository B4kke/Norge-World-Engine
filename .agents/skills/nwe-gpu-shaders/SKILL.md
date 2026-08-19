---
name: nwe-gpu-shaders
description: Defines portable shader/effect semantics with Three.js TSL for the active WebGPU/WebGL2 adapter and explicit WGSL/GLSL escape hatches.
---

# NWE GPU Shaders

This is the most important rewrite of the upstream GLSL-first Three.js shader skill.

## Language truth

- Native WebGPU shaders are WGSL.
- Native WebGL2 shaders are GLSL ES.
- They are not the same language and should not be treated as source-compatible.
- In the current Three.js adapter, TSL is the preferred shared authoring layer for custom material/effect logic because Three can generate backend shader code for WebGPU and WebGL2.

TSL is a **Three.js adapter technology**, not an NWE world/runtime contract.

## Engine-neutral contract

Outside the renderer, represent effect intent and parameters: material IDs, scalar/vector parameters, feature flags, texture semantics and deterministic seeds when needed. Never put raw WGSL/GLSL/TSL nodes into authoritative geodata, tile identity or simulation state.

## Authoring order

1. Use a built-in PBR/material capability if it meets the requirement.
2. Use TSL/node-material composition inside the Three adapter for portable custom logic.
3. Use backend-specific WGSL only when WebGPU functionality cannot be represented adequately through the adapter abstraction.
4. Keep GLSL only for explicit WebGL-specific implementation/fallback needs.
5. If handwritten WGSL and GLSL must coexist, document why the common path failed and test visual/parameter parity.

## WebGPU compute

Compute, storage buffers/textures and GPU-driven culling can be valuable for large vegetation, particles, simulation-like visual systems or procedural work. They are experiments until a measured bottleneck/requirement exists. Do not move authoritative gameplay simulation into a renderer compute shader by accident.

## Coordinate/time safety

Shaders operate on render-local coordinates and frame inputs. Origin shifts need explicit epoch-consistent frame state. Procedural noise/detail must not reinterpret render-local origin changes as world motion unless intentionally world-anchored through stable inputs.

## Three.js adapter

Use `three/tsl` + node materials on the active `WebGPURenderer` path where custom shaders are needed. Verify imports/APIs against the pinned/current Three version before implementation; the WebGPU/TSL surface evolves faster than classic WebGL APIs.

## Measure

Track pipeline/shader compile stalls, GPU time, register/bandwidth pressure where observable, material/pipeline cardinality and fallback behavior. Prefer fewer reusable shader variants over feature-flag explosion.
