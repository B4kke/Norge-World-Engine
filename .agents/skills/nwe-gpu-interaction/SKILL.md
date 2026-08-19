---
name: nwe-gpu-interaction
description: Separates input, picking and camera presentation from authoritative entity/world state while allowing Three.js/WebGPU-specific interaction adapters.
---

# NWE GPU Interaction

Adapt upstream Three.js raycasting/controls concepts without making renderer objects the gameplay model.

## Engine-neutral flow

```text
keyboard/touch/pointer/gamepad input
  -> input command / camera intent
  -> renderer pick query when needed
  -> stable entity/tile/feature ID
  -> world/simulation action
```

A `THREE.Object3D` hit is not authoritative identity. Resolve renderer hits back to stable NWE IDs before gameplay/state changes.

## Camera versus world movement

Orbit/fly/debug controls are presentation tools. Player movement uses the renderer-neutral character/world transform contract. Third-person camera follows derived render-local entity state and must survive render-origin shifts.

## Picking choices

Use the cheapest method that meets the current need:
- CPU ray tests against simple/bounded geometry;
- renderer/library raycasting for normal scene interaction;
- spatial acceleration for heavy static geometry when measured;
- GPU ID/depth picking only when CPU/library picking becomes a bottleneck or precision requirement demands it.

## WebGPU boundary

WebGPU may enable GPU picking/compute acceleration, but input semantics and selected entity identity remain backend-independent. Provide a WebGL2-compatible interaction path for core controls.

## Three.js adapter

Three raycasting/controls are valid adapter tools. Keep mappings from scene objects to stable NWE IDs explicit and dispose listeners/resources with renderer lifecycle.

## Mobile/browser rule

Support touch/pointer semantics practically, but do not require a physical handset for every interaction change. Use automated browser tests unless the unresolved claim is device-specific.
