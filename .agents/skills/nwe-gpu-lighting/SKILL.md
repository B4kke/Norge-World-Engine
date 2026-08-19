---
name: nwe-gpu-lighting
description: Guides bounded ground-level lighting, shadows and environment presentation for NWE across WebGPU/WebGL2 while keeping lighting out of authoritative world truth.
---

# NWE GPU Lighting

Lighting is presentation. Adapt the upstream Three.js lighting/shadow concepts without turning Three light classes into engine state.

## Engine-neutral contract

If NWE needs persistent lighting semantics, represent intent and world facts separately: time/sun inputs, environment/weather state, material response parameters and quality budgets. Renderer objects, shadow maps and cascade implementations remain backend-owned.

## Ground-level priorities

For the current slice:
- one coherent directional/sun solution before many dynamic lights;
- bounded near-player shadows rather than world-scale shadow coverage;
- environment/sky/fog contribution consistent with the active material model;
- stable exposure/tone response;
- shared lighting configuration across terrain, roads, buildings and character.

## WebGPU/WebGL2 policy

Use the same visual intent across backends, but capability-gate implementation details. Shadow formats, filtering, limits and performance can differ. A WebGPU-specific shadow/compute technique must have a fallback or be explicitly optional.

## Three.js adapter

Three lights, environment maps and node-based lighting features are valid adapter implementations. Prefer the current `WebGPURenderer`/node-material path where custom lighting logic is needed. Do not copy Three light types into world schemas.

## Performance discipline

Dynamic shadow-casting lights are expensive. Measure shadow passes, draw calls, GPU/frame time and update frequency. Freeze/reuse shadow data when the scene allows it. Add more lights only for a visible requirement.

## Truth boundary

Lighting may communicate time/weather visually, but it must not become the authoritative clock, weather state or solar/geographic model.
