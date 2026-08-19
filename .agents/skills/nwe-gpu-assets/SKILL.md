---
name: nwe-gpu-assets
description: Guides licensed portable 3D asset loading/decoding from verified asset references to renderer resources without coupling NWE world state to Three.js loaders.
---

# NWE GPU Assets & Loaders

This adapts the upstream Three.js loaders skill into an engine-neutral asset pipeline.

## Engine-neutral contract

Separate:
1. asset identity/license/provenance;
2. transport/cache;
3. decode/interchange representation;
4. renderer/GPU realization;
5. entity binding and animation state.

Prefer glTF/GLB for portable static/animated render assets where it fits. Semantic world metadata remains separate from the scene graph.

## Runtime rule

Normal runtime should consume approved hosted/compiled asset artifacts, not scrape or hotlink arbitrary source sites. Record source URL/license/version for third-party assets and ensure redistribution terms are compatible before committing or deploying them.

## Decode/compression

Use mature codecs/tooling instead of custom decoders. Draco, Meshopt, KTX2/Basis or other compression choices are asset-pipeline decisions with explicit decoder/version/fallback handling. Do not enable every compression scheme by default.

## WebGPU boundary

Asset loading itself is mostly backend-neutral. WebGPU matters at GPU upload/material realization, not at the semantic identity of a GLB. Avoid creating a separate WebGPU-only asset format unless a measured requirement proves glTF/portable artifacts insufficient.

## Three.js adapter

`GLTFLoader`, texture loaders, animation extraction and decoder wiring are valid adapter implementations. Return renderer-local resources from the adapter; return renderer-neutral IDs/state to the rest of NWE.

## Measure

Track transfer size, decode time, GPU upload time, first-visible latency, retained CPU/GPU bytes and disposal. Progressive/lazy loading is preferred when it reduces user-visible latency without weakening verification/license rules.
