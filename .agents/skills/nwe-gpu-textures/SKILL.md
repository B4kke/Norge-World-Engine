---
name: nwe-gpu-textures
description: Defines renderer-neutral texture/image artifact semantics, GPU-friendly formats and WebGPU/WebGL2 capability handling for NWE.
---

# NWE GPU Textures

Adapt the upstream Three.js texture/UV concepts into a portable asset contract.

## Engine-neutral contract

A texture descriptor should identify an immutable/verified asset plus semantic metadata, for example:
- artifact/asset reference;
- dimensions and mip policy;
- color-space intent;
- normal/roughness/data/color semantic;
- UV set/tiling policy;
- compression/container information when relevant;
- license/provenance where the texture is externally sourced.

Do not store a `THREE.Texture`, GPU handle or backend sampler object in canonical world data.

## Data correctness

- Treat color textures and data textures differently; do not guess color space.
- Mipmaps and anisotropy are quality/performance choices, not world truth.
- Normal/detail textures are presentation unless explicitly compiled from authoritative data.
- Production orthophoto/imagery must pass source/license/cache/redistribution gates before becoming a runtime texture layer.

## GPU policy

Prefer GPU-friendly compressed/container formats when they materially reduce download/VRAM cost and the toolchain is reproducible. Capability-gate compressed formats and keep a valid fallback. Avoid per-frame texture uploads; stream immutable texture tiles/assets through STRØM lifecycle where applicable.

## Three.js adapter

Three texture loaders, KTX2 support, UV transforms and sampler settings belong in the adapter/asset pipeline. WebGPU/WebGL2 may expose different texture capabilities even when Three presents one API; inspect the actual backend before relying on an optional format/feature.

## Measure

Track download bytes, decoded bytes, estimated VRAM, upload time, texture count, cache lifetime and visible quality. Do not choose the highest-resolution source at all distances by default.
