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

## 2026-08-19 21:30 CEST — ATLAS — P0-GROUND-06A

**What**
- Added the minimal renderer-neutral `nwe.character-world-transform/0.1-candidate` contract on top of the existing `WorldPosition` / `RenderOrigin` foundation.
- Defined stable character entity identity, authoritative Float64 world position, a renderer-neutral heading convention, heading-relative planar movement, explicit world-height updates for grounding consumers and render-local derivation scoped to render-origin series/epoch.
- Kept GLB/assets, animation, keyboard/touch input, Three.js object binding, terrain sampling/raycast implementation, third-person camera and physics-engine selection out of ATLAS ownership.
- Added six focused regressions and wired them into the existing repository baseline rather than creating another harness.

**Why**
- `P0-GROUND-05/06` needs a character transform that LUMEN can render without allowing `THREE.Object3D` or render-origin-local Float32 state to become world truth. This is the smallest ATLAS contribution that unblocks the playable character boundary without overlapping renderer work.

**Result / evidence**
- FACT: isolated local Node syntax/regression execution of the new contract logic passes.
- FACT: the exit-gate regression replays the same character commands with and without a render-origin shift and requires exactly equal authoritative transform values while allowing derived local coordinates to change.
- FACT: the contract rejects foreign world frames and non-finite movement/heading/height inputs.
- FACT: code-bearing head `f6b8ed3f480844e07e20cfd5a94d5cc64fba5e8d` passed GitHub `baseline` run `32292789347` and `atlas-rapier-physics` run `32292789343`.

**Changed**
- Branch `agent/atlas-ground-06a`, draft PR #72.
- `engine/world/character_transform_contract.mjs`.
- `engine/world/test_character_transform_contract.mjs`.
- `.github/workflows/baseline.yml`.
- `docs/05-worklog.md` and `docs/06-task-queue.md`.

**Next**
- `P0-GROUND-06`: LUMEN consumes the ATLAS transform boundary when character integration reaches movement/grounding; ATLAS should only adjust the contract if that integration exposes a concrete world-state mismatch.

## 2026-08-19 22:15 CEST — ATLAS — P0-GROUND-06A-OPT

**What**
- Optimized the character-transform hot path without expanding ATLAS ownership.
- Replaced validation-by-cloning with allocation-free validation for existing authoritative positions.
- Added no-op identity fast paths for zero movement, equivalent heading updates and unchanged grounding height.
- Reused the immutable authoritative `WorldPosition` for heading-only changes and kept physical movement/height changes as the only operations that create a new position.
- Canonicalized heading to `[0, 2π)` including a single positive zero representation, and fail-closed forged non-canonical character transforms.

**Why**
- Character movement will execute at simulation/frame cadence. Avoiding redundant immutable-object churn now makes the LUMEN integration cheaper while preserving the existing world/render-origin invariants and renderer-neutral boundary.

**Result / evidence**
- FACT: regression coverage increased from 6 to 7 cases, including strict object-identity checks for no-op updates and immutable-position reuse for heading-only updates.
- FACT: compared with the initial implementation, a changed heading update eliminates two redundant `WorldPosition` creations; a planar move/height update eliminates two redundant position creations; no-op updates return the existing transform.
- FACT: optimized code head `cce1b2367d33ef9a51a909cab0a61c95413c4d45` passed GitHub `baseline` run `32297774095` and `atlas-rapier-physics` run `32297774068`.
- No wall-clock speedup is claimed; this optimization is structurally proven allocation reduction plus unchanged correctness gates.

**Changed**
- Draft PR #72, branch `agent/atlas-ground-06a`.
- `engine/world/character_transform_contract.mjs`.
- `engine/world/test_character_transform_contract.mjs`.
- `docs/05-worklog.md` and `docs/06-task-queue.md`.

**Next**
- `P0-GROUND-06`: LUMEN consumes the optimized ATLAS transform boundary; ATLAS changes it again only if integration exposes a concrete world-state mismatch.

## 2026-08-19 22:24 CEST — LUMEN — AGENT-SKILLS-GPU-01

**What**
- Adapted all ten conceptual areas from `CloudAI-X/threejs-skills` into NWE-owned `nwe-gpu-*` skills instead of importing a Three.js-only bundle verbatim.
- Rewrote shader/material/post-processing guidance for WebGPU-first operation while preserving WebGL2 fallback and explicit WGSL-vs-GLSL truth.
- Made geometry, textures, animation, asset loading and interaction renderer-neutral first, with Three.js documented only as the current web adapter.
- Added source/license mapping and routed LUMEN/renderer instructions through the new skills without changing runtime code or the active P0 order.
- Rebased the skill-only branch onto current `main` after ATLAS PR #72 merged, preserving the newer character world-transform worklog/queue state.

**Why**
- The requested Three.js skill knowledge is useful, but a verbatim import would teach WebGL/Three implementation details as if they were NWE engine architecture and would undermine D-008 renderer replaceability.

**Result / evidence**
- FACT: the upstream bundle exposes ten source skill areas and declares MIT licensing; its draft WebGPU/TSL update targets Three r185 and corrects stale WebGPU/post-processing assumptions.
- FACT: native WebGPU and WebGL2 shader languages remain different; TSL is treated only as a Three-adapter bridge that can target both backends.
- ARCHITECTURE: no compiler/world/provenance/streaming/simulation contract or executable viewer path changed; Three/TSL/WebGPU objects remain presentation-only.
- FACT: GitHub Actions baseline run `32298564154` completed `Validate repo-local Agent Skills` successfully on skill-bearing head `be52402d4193a574574244c10513488f7c78d1d1`; the broader baseline was still running at handoff and is not claimed PASS here.

**Changed**
- Branch `agent/lumen-gpu-skills`, draft PR #76.
- Ten new `.agents/skills/nwe-gpu-*/SKILL.md` files plus `.agents/skills/UPSTREAM-THREEJS-SKILLS.md`.
- `.agents/skills/nwe-renderer-platform/SKILL.md`.
- `.agents/roles/lumen-renderer.md`.
- `AGENTS.md`.
- `docs/05-worklog.md` and `docs/06-task-queue.md`.

**Next**
- Continue the active playable slice; when `P0-GROUND-05` is the next integrated LUMEN task, use `nwe-gpu-assets` + `nwe-gpu-animation` for the licensed humanoid integration.

## 2026-08-19 23:09 CEST — LUMEN — P0-GROUND-06

**What**
- Integrated the merged ATLAS character-transform contract into the normal Preview 1 runtime instead of letting Three own character world position.
- Added accepted-DTM grounding, explicit `[east,north,up] -> [east,up,-north]` render adaptation, signed-zero canonicalization and origin-shift invariance coverage.
- Bound the CC0 KayKit Knight as a one-way render-pose sink with walk/idle animation state, keyboard + touch movement controls and a third-person follow-orbit camera.
- Added a CI-only 1.00 m movement probe that checks authoritative world delta, DTM grounding, walk -> idle, renderer-pose agreement and camera follow in exact Chrome.
- Recovered the completed GROUND-02/03/04/05 status into canonical task memory; detailed GROUND-02/03/04 entries also remain in the Drive active log from the prior LUMEN recovery session.

**Why**
- `P0-GROUND-06` was the last gameplay/runtime blocker before the first bounded graphics pass. The milestone needed a character that can actually move over verified Nannestad terrain while preserving the world/render ownership boundary.

**Result / evidence**
- FACT: exact head `4fd753767106e3d56957ff555d7069f0c4d7e5b4` passed all five standard hosted workflows: `baseline` run 32302005719, `world-viewer-vite` run 32302005703, `viewer-benchmark` run 32302005752, `preview1-realdata-publish` run 32302005712 and `preview3-realdata-publish` run 32302005733.
- FACT: exact Preview 1 Chrome acceptance requires a 1.00 m authoritative movement, accepted-DTM/NN2000 grounding, walk -> idle animation transition, derived/render pose agreement and third-person camera target following the character.
- FACT: PR #77 merged to `main` as `8971dff662f4743be8b48302c1b4f1b286ead858`.
- TRUTH BOUNDARY: authoritative position/heading remains ATLAS Float64 world state; Three receives derived Float32 pose only. The 0.02 m character ground lift, 6.5 m follow distance and +1.2 m follow target height are renderer-only presentation parameters.

**Changed**
- Merged PR #77 / branch `agent/lumen-ground-06`.
- Character world controller, runtime compositor, input/touch controls, movement acceptance probe, humanoid render-pose sink and third-person camera integration under `apps/world-viewer`.
- Exact Preview 1 browser smoke and viewer build regressions.
- `docs/05-worklog.md` and `docs/06-task-queue.md`; Drive active log is synchronized in the same LUMEN session.

**Next**
- `P0-GROUND-07`: implement the first bounded lighting/shadow/atmosphere/tone-mapping pass without changing world truth or destroying the proven navigation budget.
