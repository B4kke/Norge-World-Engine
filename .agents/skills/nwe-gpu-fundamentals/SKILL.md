---
name: nwe-gpu-fundamentals
description: Defines renderer-neutral GPU/frame architecture for NWE with a WebGPU-first web backend, WebGL2 fallback and replaceable Three.js adapter.
---

# NWE GPU Fundamentals

Use this before renderer-specific implementation. It adapts the useful scene/renderer concepts from the upstream Three.js fundamentals skill without making Three.js the engine contract.

## Engine-neutral contract

The stable direction is:

```text
verified runtime artifacts + authoritative world/entity state
  -> renderer-neutral render packets/descriptors
  -> renderer adapter
  -> WebGPU, WebGL2, Unreal or another backend
```

Keep these outside renderer libraries:
- authoritative coordinates and origin epoch;
- tile/entity/material identity;
- provenance and source truth;
- streaming/residency decisions;
- simulation state and gameplay transforms.

A renderer owns disposable cameras, pipelines, GPU buffers, textures, bind groups, materials and scene objects.

## Backend truth

WebGPU and WebGL2 do **not** use the same native shader language. WebGPU uses WGSL; WebGL2 uses GLSL. Do not create a false common-language abstraction around raw shader strings.

A renderer abstraction may expose shared *semantics* while each backend owns its implementation. In the current Three.js adapter, TSL is useful because Three's node system can generate WGSL for WebGPU and GLSL for WebGL2. TSL remains adapter code, not NWE world/runtime schema.

## WebGPU-first capability policy

- Prefer a real WebGPU device when available and usable.
- Keep a measured WebGL2 fallback/baseline.
- Never label a fallback run as WebGPU evidence.
- Capability-gate optional compute/storage/indirect features; do not assume all adapters expose the same limits.
- Initialization failure must produce an explicit fallback or explicit failure state, never silent truth changes.

## Frame and lifecycle rules

- Build renderer-local resources only after runtime verification succeeds.
- Derive local Float32 render coordinates from high-precision world state and the active render origin/epoch.
- Keep frame state immutable enough that origin shifts cannot look like physical movement.
- Dispose GPU resources when STRØM deactivates/evicts a render resource.
- Separate initialization, verification/decode, GPU upload/apply and frame-time measurements.

## Three.js adapter

For the active web milestone, Three.js may implement this contract with `WebGPURenderer` and its WebGL2 backend/fallback. Use `three/webgpu` for WebGPU/node-material classes and `three/tsl` for TSL APIs when needed. Keep Three objects behind `apps/world-viewer` renderer boundaries.

Do not rewrite working generic Three functionality merely to call raw WebGPU. The reason to drop below Three must be a measured missing capability, performance ceiling or correctness problem.

## Exit gate

A renderer change is acceptable when the same verified NWE input and world transform can be consumed without adding renderer-specific fields to compiler/world/simulation contracts, and the claimed backend is measured honestly.
