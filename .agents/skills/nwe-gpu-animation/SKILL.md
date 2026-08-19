---
name: nwe-gpu-animation
description: Keeps animation clips/state renderer-neutral while using Three.js or another renderer for skeletal/morph playback and GPU skinning realization.
---

# NWE GPU Animation

Animation is not inherently a WebGPU problem. Preserve the useful upstream Three.js animation concepts, but do not force them into raw GPU code when the renderer already solves them.

## Engine-neutral contract

Keep persistent character/entity state outside Three.js:
- entity ID and authoritative transform;
- locomotion/action state (`idle`, `walk`, etc.);
- animation clip/asset references;
- normalized parameters/speed when simulation needs them;
- deterministic gameplay events that must survive renderer replacement.

Do not make `AnimationMixer`, skeleton objects, clips or scene nodes authoritative state.

## Root-motion rule

For the current NWE character path, authoritative movement comes from the world/simulation transform. Animation follows that state. Do not let renderer root motion silently move the authoritative entity unless a future explicit simulation contract adopts root motion.

## WebGPU/WebGL2 policy

Skeletal/morph animation can remain at the renderer abstraction level. GPU skinning implementation details belong to the backend. Move animation/simulation work to compute only when a measured population or CPU budget justifies it.

## Three.js adapter

Use glTF/GLB animation clips and Three's animation system for the active web renderer when suitable. Map renderer-neutral animation state to mixer/action transitions inside the adapter. Dispose clips/resources with the asset lifecycle.

## Quality/performance

Prefer a small state machine and shared animation assets first. Measure CPU animation cost, skinned draw calls, bone/instance limits and memory before designing GPU-driven crowds.
