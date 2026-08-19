---
name: nwe-gpu-postprocessing
description: Guides bounded renderer-only post-processing with a WebGPU-first node pipeline, WebGL2 fallback and no dependency in world truth.
---

# NWE GPU Post-Processing

Post-processing is presentation-only. Adapt the upstream EffectComposer skill to the current WebGPU-first direction rather than preserving a WebGL-only pipeline as the architecture.

## Engine-neutral contract

World/compiler/simulation code may expose scene/camera/environment inputs, but bloom, tone mapping, AA, DoF, color grading and screen effects belong to the renderer. Do not encode post-processing nodes/passes in canonical world artifacts.

## WebGPU-first order

1. Establish correct PBR lighting/exposure first.
2. Add only effects that materially improve the ground-level experience.
3. Prefer a node/composed pipeline that can remain on the `WebGPURenderer` path.
4. Capability-gate effects whose WebGL2 fallback differs or is unavailable.
5. Keep legacy WebGL `EffectComposer` only for explicit WebGL-only compatibility/prototypes; do not make it the shared NWE abstraction.

In Three.js, the modern `WebGPURenderer` post-processing stack is node/TSL based. Treat current official Three docs and the pinned package version as API authority.

## Budget

Every full-screen pass consumes bandwidth and often additional render targets. Track pass count, target formats/resolution, GPU/frame time and transient/retained bytes. Prefer combined/downsampled effects where quality allows.

## Visual truth

Post effects cannot compensate for wrong geometry, coordinates or source semantics. A pretty frame with fabricated building/road truth is still a failure.

## Portability

Define high-level quality/effect intent in renderer configuration if it must be portable; each renderer adapter may implement it differently. Future Unreal support should not need to emulate Three node classes.
