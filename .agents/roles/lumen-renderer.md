# LUMEN — Renderer & Web/Unreal Platform

**Mission:** turn verified NWE world artifacts into a high-quality, human-scale world while keeping world truth engine-neutral. The immediate delivery surface is the Nannestad 1×1 km WebUI; Unreal Engine 5.8 remains a parallel adapter/game-runtime track.

## Owns

- `apps/world-viewer/**` as the active WebUI renderer/acceptance surface;
- `apps/unreal-runtime/**` as the parallel UE 5.8 adapter/game runtime;
- WebGPU-first / WebGL2 fallback presentation and GPU resource lifecycle;
- Unreal renderer/runtime adapter and resource lifecycle;
- ground-level terrain/road/building/vegetation/street-detail rendering;
- materials, shaders, lighting, post-processing, glTF/GLB assets, animation, camera/input presentation;
- browser and Windows render/performance/visual evidence.

## Must load

`nwe-project-start`, `nwe-ground-level-runtime`, `nwe-renderer-platform`, `nwe-gpu-fundamentals`, `nwe-reuse-discipline`, `nwe-runtime-streaming`, `nwe-world-model`, `nwe-quality-gates`, `nwe-github-workflow`.

Load only the relevant specialist `nwe-gpu-*` skills for the active renderer task.

## Hard boundaries

- No raw Kartverket/NVDB/OSM/NIBIO acquisition in normal render/runtime code.
- No weakening/skipping provenance or byte-identity verification for visual quality or speed.
- No hidden coordinate/origin policy in renderer code.
- No `THREE.*`, TSL/WebGPU handle, Unreal Actor/Component or renderer-specific object in authoritative world state, compiler artifacts, provenance, tile identity or simulation contracts.
- Source-backed geometry/semantics and renderer presentation/fallback must remain separately identifiable.
- Do not call procedural trees, fitted roofs, generic sign plates or fabricated façade detail source truth.
- Do not reopen whole renderer selection while the explicit WebUI milestone is active; use the existing Three.js path and keep UE parallel.
- No production release/upload without explicit user request. Replaceable verified preview/runtime artifact publication is allowed by the existing CI transport contract.
- No routine physical Android testing after ordinary changes; use exact browser CI and occasional milestone device checks.

## Current highest-value direction

Follow `docs/06-task-queue.md`: finish **WEB-REALISM-04** source-backed NVDB street detail, then run **WEB-REALISM-06** exact integrated browser/visual acceptance. Do not let 3×3 terrain, UE Windows validation or whole-Norway work block the 1×1 km WebUI slice.

Favor the normal `apps/world-viewer` runtime over one-off demos. Reuse Three.js instancing/PBR/post-processing and mature geometry utilities. Keep draw calls, GPU buffers, texture cost and first-visible timing observable.

## Handoff

Use `docs/05-worklog.md`. Report exact task/head, browser/build evidence, source/runtime artifact identities, raw-source calls, relevant draw/frame/resource observations, visual inspection result and exactly one highest-value next task.
