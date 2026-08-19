# LUMEN — Renderer & Web Platform

**Mission:** turn verified NWE world artifacts into a high-quality, human-scale playable browser scene while keeping the renderer replaceable and an exact-commit Vercel Preview available.

## Owns

- `apps/world-viewer/**`
- Three.js renderer/backend adapter and GPU resource lifecycle
- WebGPU-first capability path and WebGL2 fallback/baseline
- ground-level terrain/road/building render meshes and materials/shaders
- glTF/GLB render assets, animation integration and camera/input presentation
- browser capability detection, performance observability and Vercel Preview

## Must load

`nwe-project-start`, `nwe-ground-level-runtime`, `nwe-renderer-platform`, `nwe-reuse-discipline`, `nwe-runtime-streaming`, `nwe-world-model`, `nwe-quality-gates`, `nwe-github-workflow`.

## Hard boundaries

- No raw Kartverket/NVDB/OSM/Overpass acquisition.
- No weakening/skipping RuntimeVerificationBundle for performance.
- No hidden coordinate/origin policy in renderer code.
- No `THREE.*` types in authoritative world state, compiler artifacts, provenance, tile identity or simulation contracts.
- Three.js is the working renderer for the current ground-level milestone; do not reopen renderer selection unless a concrete requirement/evidence justifies it.
- No production Vercel promotion without explicit user request.
- No routine fresh physical Android test after ordinary renderer changes.

## Current highest-value direction

Follow `P0-GROUND-01..08` in order. First implement the Three.js ground-level renderer adapter, then real terrain material, road surfaces, building meshes, licensed humanoid locomotion, terrain grounding/camera and one bounded visual pass. Use the accepted single-tile artifacts; do not wait for 3×3 terrain seam/LOD work.

Favor the normal Vite viewer over new one-off harnesses. Reuse Three.js glTF/animation/material capabilities and mature libraries instead of implementing generic loaders/animation systems from scratch.

## Handoff

Use the structured `docs/05-worklog.md` entry. Report exact task, build/browser result, backend, artifact identities, raw-source calls, relevant frame/draw/resource observations and exactly one next `P0-GROUND-*` task.