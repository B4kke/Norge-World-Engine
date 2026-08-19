---
name: nwe-renderer-platform
description: Guides the NWE ground-level web renderer, WebGPU/WebGL capability path, GPU instrumentation and exact-commit Vercel Preview while preserving artifact-only world truth and engine portability.
---

# NWE Renderer & Web Platform

Primary surface: `apps/world-viewer`.

## Active direction

Three.js is the **working web renderer** for the current walkable Nannestad milestone. The product design center is meter-scale walking/driving and high-quality materials/shaders, not high-altitude globe navigation.

Use a WebGPU-first capability path where the browser exposes a genuine usable adapter and retain WebGL2 as fallback/baseline. Do not fabricate a WebGPU comparison when the environment falls back.

This does not make Three.js the world engine. The renderer consumes verified renderer-neutral artifacts/world state and creates disposable renderer/GPU resources.

## Shader/backend truth

WebGPU and WebGL2 do not share a native shader language: WebGPU uses WGSL, WebGL2 uses GLSL. Do not describe raw shader source as backend-independent.

For the current Three.js adapter, prefer TSL/node materials for custom shader logic where they meet the requirement because Three can target WebGPU and WebGL2 from the same node graph. TSL remains inside the Three adapter. Raw WGSL/GLSL requires an explicit backend-specific reason.

Do not force generic loader, animation, geometry or interaction concepts into raw WebGPU just because WebGPU is preferred. Use mature renderer/library functionality until a measured mismatch justifies dropping lower.

## Skill routing

Always pair this skill with `nwe-gpu-fundamentals`. Load only the specialist skill(s) needed for the task:
- `nwe-gpu-geometry` — mesh buffers, batching, instancing;
- `nwe-gpu-materials` — PBR/material semantics and mapping;
- `nwe-gpu-lighting` — lights, shadows, environment;
- `nwe-gpu-textures` — UVs, image/texture assets and GPU formats;
- `nwe-gpu-animation` — clips, skeleton/morph playback and renderer-neutral state;
- `nwe-gpu-assets` — glTF/GLB loading, codecs, license/provenance;
- `nwe-gpu-shaders` — TSL/WGSL/GLSL and compute boundaries;
- `nwe-gpu-postprocessing` — WebGPU-first screen pipeline;
- `nwe-gpu-interaction` — input, picking and camera/world separation.

These skills are NWE-owned adaptations of useful concepts from `CloudAI-X/threejs-skills`; provenance is recorded in `.agents/skills/UPSTREAM-THREEJS-SKILLS.md`.

## Hard boundaries

- Never fetch Kartverket, NVDB, OSM/Overpass or other authoritative raw sources from normal runtime.
- Full runtime artifact/provenance verification happens before geometry/resource creation.
- No `THREE.*`, TSL node or WebGPU object in compiler output, schemas, authoritative world coordinates, tile identity, provenance or simulation state.
- High-precision world state and origin epochs come from `nwe-world-model`; render-local Float32 data is disposable.
- Lifecycle/caching decisions come from `nwe-runtime-streaming`; LUMEN owns resource realization/disposal, not tile authority.
- Prefer glTF/GLB for portable static/animated render assets where suitable; record asset license/source separately from scene objects.

## Ground-level quality priorities

Order work by the active queue rather than generic renderer polish:
1. renderer adapter + human-scale camera;
2. real terrain mesh/material;
3. road-surface meshes;
4. building meshes/materials;
5. licensed humanoid + animation;
6. locomotion/grounding/camera;
7. bounded lighting/shadows/fog/shader pass;
8. one integrated acceptance run.

Favor shared materials, batching/instancing, stable material semantics and measured near-player quality. Do not build global globe/SSE/LOD infrastructure unless a measured ground-level requirement demands it.

## Measurements

Measure only what informs the current claim: backend/capability, artifact verification/decode, worker cost, GPU upload/apply, input→first-visible, frame p50/p95/p99, largest rAF gap, draw calls, triangles/vertices, retained bytes and resource disposal as relevant.

For every renderer PR:
- production build passes;
- one targeted browser smoke covers the new behavior;
- explicit real vs synthetic labels remain intact;
- when deployment access exists, create/confirm Vercel Preview for the exact branch commit;
- do not promote production without explicit user request;
- do not require a fresh physical Android run by default.

A pretty scene with wrong coordinates/provenance is a failed renderer. A correct scene trapped inside Three.js-specific world contracts is also a failed architecture.
