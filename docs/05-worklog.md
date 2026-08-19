# 05 — Active agent worklog

This is the **current handoff log** from the ground-level plan reset onward. The previous long-form worklog is preserved in Git history and archived in Google Drive; do not copy historical status back into this file.

The goal is to let the next agent understand what changed in under a minute.

## Required entry format

Every completed work session appends exactly one entry using this structure:

```markdown
## YYYY-MM-DD HH:MM TZ — AGENT — TASK-ID

**What**
- What was actually implemented, changed or investigated.

**Why**
- Why this was the highest-value work for the active milestone.

**Result / evidence**
- Concrete result: build/test/browser output, artifact, metric or decision boundary.
- State FACT vs ASSUMPTION vs EXPERIMENT when relevant.

**Changed**
- Files, PR/branch, schemas, artifacts or Drive docs changed.

**Next**
- Exactly one highest-value follow-up task, with task ID when available.
```

## Logging rules

- Always record **date, local time/timezone, agent and task ID** in the heading.
- `What` says what changed, not what the agent intended to do.
- `Why` ties the work to the active queue in `docs/06-task-queue.md`.
- `Result / evidence` is concise. Link proof files rather than pasting full logs.
- `Next` is one concrete action, not a new backlog.
- Do not append repeated test attempts that produced no new information; summarize the final relevant evidence once.
- Do not mark a visual fallback as authoritative world truth.
- Historical Android/manual-device next steps are not automatically current; follow `docs/07-testing-policy.md`.

---

## 2026-08-19 18:28 CEST — SENTINEL — PLAN-RESET-GROUND-01

**What**
- Replaced the prior `3×3 residency → LOD → visual quality` execution order with a ground-level playable Nannestad milestone.
- Made Three.js/WebGPU-first the working graphics direction while preserving renderer-neutral world/compiler/runtime boundaries and a future Unreal adapter path.
- Rebuilt the active task queue around terrain, road meshes, building meshes, materials/shaders, a licensed humanoid asset, locomotion and one integrated browser acceptance gate.
- Added explicit anti-loop rules so multi-tile/source research and repeated test harnesses do not displace the playable slice.

**Why**
- The accepted single-tile Nannestad terrain/road/building foundation is already sufficient to build the first user-visible world. The project now needs proof that it works as a human-scale 3D place, not another round of broad infrastructure before gameplay exists.

**Result / evidence**
- FACT: canonical `main` already proves real single-tile terrain, roads/buildings, provenance verification, browser worker path and basic runtime resource lifecycle.
- PRODUCT DIRECTION: near-ground walking/driving and high graphics quality are the current renderer design center.
- ARCHITECTURE GUARDRAIL: Three.js is presentation; compiler/world/simulation contracts remain engine-neutral for later Unreal use.

**Changed**
- Draft PR #68 branch `agent/sentinel-revised-engine-chain`.
- `docs/03-roadmap.md`.
- `docs/05-worklog.md`.
- `docs/06-task-queue.md`.
- `docs/08-revised-engine-chain.md`.
- Drive active plan/log and archive migration are part of the same planning reset.

**Next**
- `P0-GROUND-01`: LUMEN implements the Three.js ground-level renderer adapter in `apps/world-viewer` without changing compiler/provenance semantics.

## 2026-08-19 19:34 CEST — LUMEN — P0-GROUND-01

**What**
- Added a thin Three.js ground renderer adapter over the accepted Preview 1 typed-array scene buffers instead of rebuilding loader/compiler/runtime logic.
- Pinned `three@0.185.0`; routed `createPreview1Renderer` through `three/webgpu` / `THREE.WebGPURenderer` with explicit WebGL2 fallback/baseline.
- Converted accepted terrain, road and building buffers to Three `BufferGeometry` after existing runtime verification and preserved terrain resource activate/deactivate lifecycle hooks.
- Added human-scale perspective startup at sampled terrain + 1.7 m eye height, basic lit materials/fog/light and made the root viewer target the accepted single-tile ground scene. Preview 3 remains separate.
- Added structural regressions and aligned the stale viewer CI root-entry assertion with the new ground-level root.

**Why**
- This was the shortest path from the already proven real-data/runtime foundation to a renderer suitable for walking-distance graphics while keeping world/compiler/provenance reusable by a future Unreal adapter.

**Result / evidence**
- FACT: `baseline`, `world-viewer-vite` and `viewer-benchmark` pass on the Three.js implementation head.
- FACT: hosted Chrome/WebGL2 rendered the accepted Nannestad tile with 16,641 terrain vertices / 32,768 triangles, 246 compiled road paths and 135 building footprints, 4 draw calls, 7 runtime requests and 0 raw-source runtime calls.
- FACT: production Vite build, browser provenance/decode profile, terrain resource lifecycle smoke and DedicatedWorker gate pass.
- LIMITATION: hosted WebGPU probe is unavailable (`A valid external Instance reference no longer exists.`), so no WebGPU performance comparison is claimed. This does not invalidate the proven Three renderer boundary or WebGL2 fallback.
- A cold source/compiler revalidation was automatically started because the viewer path changed, then cancelled when newer branch commits superseded it before the browser step. It is not counted as evidence and is deliberately not restarted solely to re-prove already accepted source/compiler facts for this renderer-only task.

**Changed**
- Branch `agent/lumen-ground-01`, draft PR #69.
- `apps/world-viewer/src/threeGroundRenderer.mjs`.
- `apps/world-viewer/src/preview1Renderer.mjs`.
- `apps/world-viewer/package.json`.
- `apps/world-viewer/index.html`.
- `apps/world-viewer/test_three_ground_renderer.mjs`.
- `apps/world-viewer/test_root_entrypoint.mjs`.
- `.github/workflows/world-viewer-vite.yml`.
- `docs/05-worklog.md` and `docs/06-task-queue.md`.

**Next**
- `P0-GROUND-02`: upgrade the proven Three terrain mesh from a basic lit material to walking-distance terrain materials/detail coordinates without changing accepted DTM geometry.

## 2026-08-19 20:55 CEST — LUMEN — P0-GROUND-02

**What**
- Upgraded the accepted Nannestad terrain from a flat ground color to a walking-distance PBR material while preserving the accepted DTM positions.
- Passed worker-provided normals and UVs into Three `BufferGeometry`, added deterministic renderer-only macro vertex-color variation, and generated two tiny source-safe `DataTexture` detail maps with an explicit 5 m repeat period for color, roughness and bump response.
- Kept terrain geometry displacement disabled and preserved the existing terrain resource lifecycle and single terrain draw.

**Why**
- This was the first open renderer P0 after the Three adapter. The active milestone needed the verified DTM to read as ground at approximately human eye height without introducing imagery/source dependencies or changing world truth.

**Result / evidence**
- FACT: PR #70 was merged as `b08d57461fecc93cc8d349d8dc79c5998321ba9a`; implementation head `980cac3f3f531733aca699a425dd0b8efe1bb588` passed `baseline`, `world-viewer-vite`, `viewer-benchmark`, `preview1-realdata-publish` and `preview3-realdata-publish`.
- FACT: terrain styling is explicitly renderer-only, `geometry_displacement=false`, and the scene retained one terrain mesh / four total draw calls.
- LIMITATION: the Vercel status failed on build-rate-limit/plan rather than viewer code; it is not counted as renderer failure or exact Preview evidence.

**Changed**
- Merged PR #70 / branch `agent/lumen-ground-02`.
- `apps/world-viewer/src/threeGroundRenderer.mjs`.
- Terrain-material structural regressions and buffer-count-agnostic renderer lifecycle checks.
- Google Drive active agent log was recovered in the following LUMEN session because the previous chat completed the code but failed before persisting the handoff.

**Next**
- `P0-GROUND-03`: build connected road-surface meshes from the accepted compiled NVDB paths with an explicit renderer-only width fallback.

## 2026-08-19 21:49 CEST — LUMEN — P0-GROUND-03

**What**
- Replaced independent per-segment road quads with one connected surface strip per accepted compiled NVDB road path.
- Added shared left/right vertex pairs at centerline points, duplicate-point removal, capped miter joins, meter-based UVs and explicit road-surface observability.
- Reduced the renderer-only anti-z-fighting lift from 0.35 m to 0.06 m and kept the existing 3.2 m visual width explicitly labeled `renderer-only-fallback` rather than authoritative physical road width.
- Added focused geometry and scene-contract regressions and wired them into the normal World Viewer build.

**Why**
- `P0-GROUND-03` was the next visible P0 after terrain material. Ground-level roads must read as continuous surfaces without reopening NVDB acquisition or fabricating width semantics.

**Result / evidence**
- FACT: draft PR #73 implementation head `f91000d78a11113267dfcd83d5974a9658c87d28` passes all five hosted workflows: `baseline` #1891, `world-viewer-vite` #313, `viewer-benchmark` #261, `preview1-realdata-publish` #397 and `preview3-realdata-publish` #23.
- FACT: the browser path still consumes the accepted real road artifact (`34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`) with 246 compiled road paths and zero raw-source runtime calls.
- FACT: road width and the 0.06 m surface lift remain presentation-only; no compiler, provenance or authoritative world-data contract changed.

**Changed**
- Branch `agent/lumen-ground-03`, draft PR #73.
- `apps/world-viewer/src/roadSurfaceGeometry.mjs`.
- `apps/world-viewer/src/preview1SceneGeometry.mjs`.
- `apps/world-viewer/src/preview1Renderer.d.ts`.
- `apps/world-viewer/test_road_surface_geometry.mjs`.
- `apps/world-viewer/test_road_surface_scene_contract.mjs`.
- `apps/world-viewer/package.json`.
- `docs/05-worklog.md`, `docs/06-task-queue.md` and Drive active agent log.

**Next**
- `P0-GROUND-04`: replace the current naive building roof fan with polygon-safe roofs and explicit wall/roof material classes while preserving source-backed versus fallback height semantics.

## 2026-08-19 22:07 CEST — LUMEN — P0-GROUND-04

**What**
- Replaced the naive first-vertex roof fan with polygon-safe 2D footprint triangulation using Three.js' bundled Earcut implementation.
- Split building render geometry into batched wall and roof typed-array layers while retaining a combined compatibility buffer for existing renderer consumers.
- Added four bounded Three PBR presentation layers: source-backed walls/roofs and unresolved-height walls/roofs.
- Preserved source-backed building heights and kept the unresolved 5 m height plus 0.08 m terrain lift explicitly renderer-only.
- Added a concave L-footprint regression that verifies roof triangles remain inside the footprint and face upward.

**Why**
- `P0-GROUND-04` was the highest-priority open renderer task. The previous fan triangulation could escape concave footprints, which would make accepted building geometry visibly wrong at street level.

**Result / evidence**
- FACT: draft PR #74 exact head `73747d7ec6df66ef7c22b14c1a9ba781fbd7c252` passes hosted `baseline` run 32296147674, `world-viewer-vite` run 32296147784 and `viewer-benchmark` run 32296147709.
- FACT: the normal World Viewer gate passes production build, the concave-roof regression, exact accepted-artifact provenance/decode, DedicatedWorker terrain path, Preview 1 browser rendering and movement/cache/resource lifecycle smoke.
- FACT: the browser path rendered the accepted 135-building artifact `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd` through the new roof/material path without raw OSM/source acquisition.
- FACT: the Three renderer remains batched by semantic layer rather than per building; splitting walls/roofs is a bounded draw-call tradeoff, not a 135-building fanout.

**Changed**
- Branch `agent/lumen-ground-04`, draft PR #74.
- `apps/world-viewer/src/buildingSurfaceGeometry.mjs`.
- `apps/world-viewer/src/preview1SceneGeometry.mjs`.
- `apps/world-viewer/src/threeGroundRenderer.mjs`.
- `apps/world-viewer/src/preview1Renderer.d.ts`.
- `apps/world-viewer/test_building_surface_geometry.mjs`.
- `apps/world-viewer/test_three_ground_renderer.mjs`.
- `apps/world-viewer/package.json`.
- `docs/05-worklog.md`, `docs/06-task-queue.md` and Drive active agent log.

**Next**
- `P0-GROUND-05`: integrate one lightweight humanoid glTF/GLB from a primary source with verified permissive redistribution, and prove idle/walk animation state in the normal viewer without taking ownership of ATLAS' authoritative character transform contract.
