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