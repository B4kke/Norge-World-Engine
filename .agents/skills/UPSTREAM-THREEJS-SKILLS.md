# Upstream renderer-skill sources

NWE's `nwe-gpu-*` skills were adapted on 2026-08-19 from concepts in the public `CloudAI-X/threejs-skills` bundle, which the upstream README/catalog declares MIT licensed.

Upstream bundle reviewed:
- `CloudAI-X/threejs-skills` main/base around commit `b1c623076c661fc9b03dac19292e825a5d106823`;
- ten original areas: fundamentals, geometry, materials, lighting, textures, animation, loaders, shaders, postprocessing and interaction.

Additional audit/reference:
- upstream draft PR #13 (`AgentEnder/threejs-skills@44caac818d84226348e5a8bfe0238cb84c7de5cb`) adds r185-oriented performance/WebGPU/TSL work and fixes several stale WebGPU/postprocessing assumptions;
- current official Three.js WebGPURenderer, TSL and WebGPU post-processing documentation was treated as primary API direction.

The NWE versions are intentionally **not verbatim copies**. They are rewritten around NWE architecture:
- renderer-neutral contracts first;
- WebGPU-first web realization;
- WebGL2 fallback/baseline;
- WGSL and GLSL are treated as different native languages;
- Three.js TSL is an adapter-level bridge, not engine/world truth;
- Three.js types stay out of compiler, provenance, tile identity, authoritative coordinates and simulation state;
- future Unreal/other renderers consume the same engine-neutral semantics.

Mapping:

| Upstream concept | NWE skill |
|---|---|
| threejs-fundamentals | `nwe-gpu-fundamentals` |
| threejs-geometry | `nwe-gpu-geometry` |
| threejs-materials | `nwe-gpu-materials` |
| threejs-lighting | `nwe-gpu-lighting` |
| threejs-textures | `nwe-gpu-textures` |
| threejs-animation | `nwe-gpu-animation` |
| threejs-loaders | `nwe-gpu-assets` |
| threejs-shaders | `nwe-gpu-shaders` |
| threejs-postprocessing | `nwe-gpu-postprocessing` |
| threejs-interaction | `nwe-gpu-interaction` |

Do not mechanically sync future upstream changes. Re-audit license, current Three APIs and NWE portability boundaries first.
