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

## 2026-08-20 00:06 CEST — FORGE — P1-VEGETATION-01-SOURCE-AUDIT

**What**
- Recovered the existing vegetation source audit and re-verified it against current 2026 NIBIO/Geonorge/data.norge primary metadata instead of starting a new source plan.
- Refined the open baseline from a vague `AR5 + SR16` concept to `SR16R + AR50 + existing NWE road/building exclusion geometry`.
- Documented FKB-AR5 and Nasjonalt grunnkart for arealanalyse as capability-gated licensed enrichments rather than required public dependencies.
- Defined a bounded Nannestad real-sample admission gate before any vegetation source becomes canonical compiler input.

**Why**
- `P1-VEGETATION-01` is the next visible-quality data layer after the active playable P0. Establishing a legally reproducible source stack now avoids building tree placement around data the public NWE pipeline cannot lawfully acquire or redistribute, while not displacing active `P0-GROUND-07/08` renderer/integration work.

**Result / evidence**
- FACT: NIBIO's 30-Jan-2026 SR16 product sheet documents full Norwegian forest coverage, 16×16 m SR16R cells, ±1-pixel positional accuracy, dominant species, mean/overheight, tree counts per hectare, canopy cover, LAI, remote-sensing year and uncertainty estimates; SR16R also has harvesting-update semantics that are not yet implemented equivalently for SR16V segments.
- FACT: current SR16 download/Atom distributions are exposed with NLOD 1.0/open-license metadata; exact distribution metadata still belongs in each future SourceSnapshot.
- FACT: AR50 is nationwide and useful for coarse land-cover exclusion/classification, but its 1:50k generalization merges areas below 15 dekar and cannot be treated as exact vegetation-edge truth.
- FACT: NIBIO explicitly restricts FKB-AR5 download to Geovekst/Norge digitalt rights; current Nasjonalt grunnkart for arealanalyse distributions are likewise tied to a Norge digitalt license/restricted access.
- NOT YET PROVEN: no real Nannestad SR16R/AR50 source bytes were acquired in this audit, so neither source is promoted to an admitted compiler dependency yet.

**Changed**
- Branch `agent/forge-vegetation-sources`.
- `docs/data-licenses/visual-sources.md`.
- `docs/05-worklog.md` and `docs/06-task-queue.md`.

**Next**
- `P1-VEGETATION-01-SAMPLE`: when P0 milestone acceptance is complete, acquire and inventory one real Nannestad SR16R + AR50 sample through official download paths and prove cache/offline reproducibility before defining the vegetation runtime artifact.

## 2026-08-20 01:27 CEST — FORGE — P1-VEGETATION-01-SAMPLE

**What**
- Implemented a bounded real-source cache/materialization path for Nannestad vegetation, a source-network-free deterministic normalizer and an evidence verifier.
- Replaced the unproven mandatory `SR16R` assumption with the source path that actually passed license/access + real-byte validation: NIBIO `SR16V` Atom/SOSI + NIBIO `AR50` WFS.
- Added a strict decoder-only UTF-8 -> ISO8859-10 compatibility copy for hosted GDAL/FYBA while preserving the original provider SOSI bytes/hash as source truth.
- Kept the expensive real-byte materialize/decode/replay gate as explicit `workflow_dispatch`; ordinary PR source probing was restored to the lighter contract checks.

**Why**
- The source audit had reached the point where metadata claims were insufficient. The highest-value FORGE work was to prove or falsify one legally reproducible Nannestad vegetation path before any tree-placement/runtime schema is designed, without displacing active `P0-GROUND-07/08` renderer work.

**Result / evidence**
- FACT: code-bearing head `5594fe073edf0c20b03911c56f5b454a7aba4dc9` passed `baseline` run `32312909195` and heavy `visual-source-probe` run `32312909181`.
- FACT: exact 1 km EPSG:25832 sample normalized `124` SR16V polygons and `15` AR50 polygon/multipolygon features; same cached bytes replayed byte-identically.
- FACT: independent AR50 raw responses had different hashes, but normalized semantic content matched after excluding only request-time `kopidato`, which was independently proven volatile.
- FACT: provider SR16V SOSI SHA-256 is `09dc03637097c485d1b80a863eb1bd36a65ebc9b29c2505b0e95cc15a5533adf`; normalized candidate SHA-256 is `c275ddedaf06d6b509c90bf41fb54404d36cbc3457681a092eddcec77d44929c`; semantic SHA-256 is `76536346c39a5a731352ca00d86231d901e025f9a1a4b4b2097700a694534ec1`.
- FACT: SR16V provider bytes declare SOSI 5.0 / UTF-8 / EPSG:25832 source selection and NN2000 in the source header. Hosted FYBA could not open the valid UTF-8 file directly; strict ISO8859-10 compatibility transcode round-trip passed without replacing characters and does not alter source binding.
- FACT: current split SR16R metadata has unresolved license/distribution inconsistencies; it remains a higher-fidelity research candidate rather than the mandatory public baseline.
- TRUTH BOUNDARY: this proves source polygons/attributes and deterministic normalization only. No individual-tree positions, density policy, asset choice, LOD or renderer artifact has been promoted.

**Changed**
- Draft PR #79 / branch `agent/forge-vegetation-sources`.
- `tools/visual-data/materialize_vegetation_source_cache.py`.
- `tools/visual-data/normalize_vegetation_source_sample.py`.
- `tools/visual-data/verify_vegetation_source_sample.py` and supporting source probes.
- `.github/workflows/vegetation-source-sample.yml` and lightweight `.github/workflows/visual-source-probe.yml`.
- `docs/data-licenses/visual-sources.md`, `docs/05-worklog.md` and `docs/06-task-queue.md`.
- CI evidence artifact `9387116220`; raw/bulk provider geodata remains outside Git and was not uploaded as an artifact.

**Next**
- `P1-VEGETATION-01-ARTIFACT`: after P0 milestone acceptance, define and prove one tiny renderer-neutral deterministic vegetation artifact candidate from the admitted SR16V + AR50 normalized boundary, with source/config provenance and no renderer-owned semantics.

## 2026-08-20 01:51 CEST — FORGE — P1-VEGETATION-01-ARTIFACT

**What**
- Inspected LUMEN PR #80 and kept its Three.js/Poly Haven instancing, asset choice and visible-instance budget in renderer ownership while replacing the missing FORGE side of the handoff.
- Added `nwe.vegetation-representative-artifact/0.1-candidate`: a renderer-neutral deterministic compiler artifact over normalized SR16V + AR50 with source-backed segment semantics and explicitly procedural representative positions/yaw.
- Preserved SR16V tree class, modeled mean height, >=16 cm DBH tree density, uncertainty, canopy cover, remote-sensing year and update date; applied coarse AR50 non-forest exclusion only.
- Added real-sample compile/evidence/verifier tooling and extended the manual heavy source gate through artifact compilation; ordinary PR source probing was restored to lightweight mode after the materially new gate passed.

**Why**
- PR #80 already proved useful renderer infrastructure but still hard-required `nwe.synthetic-vegetation-placement/0.1`. The highest-value FORGE work was therefore the missing source-backed renderer-neutral input contract, not another renderer implementation or another vegetation-source research cycle.

**Result / evidence**
- FACT: `baseline` run `32314719926` PASS and heavy real-source `visual-source-probe` run `32314719935` PASS on code-bearing head `de91525ac45c4ca19eb5ed4b5fb470e2be1dbedd`.
- FACT: the real 1 km Nannestad sample compiled `92` usable SR16V segments into `828` deterministic representative points over `516753.05 m²`; coarse AR50 non-forest suppression removed `112923.69 m²`.
- FACT: source-backed `srtrean_ge16` semantics represented `23493.8875` modeled trees with DBH >=16 cm; representative weights sum to the same modeled aggregate within floating-point tolerance.
- FACT: same normalized A1/A2 input produced byte-identical RFC8785 artifact bytes; independent AR50 acquisition B produced the same semantic artifact hash. Artifact SHA-256 `9b20fdc38c8d672ab5d5e7c089905de477973f383caf2cc571c0e63d7ff75636`; semantic SHA-256 `320a7e8aadc00fce2ef3912e48f64e279962c5084a89210bca853f506a2f4f1f`; compiler-config ID `f3a3206a559c00196c2a8fc9c397697aae20bef98a25e5e598766fc4de5bd90e`.
- EXPERIMENT: `16` representatives/hectare is only the current bounded representation target. It is not source tree density or a selected production LOD policy; changing it changes compiler-config/artifact identity.
- TRUTH BOUNDARY: representative easting/northing/yaw are deterministic generated detail, not observed individual trees. The artifact contains no Three/WebGPU types, asset IDs, render origin or terrain Z and does not yet apply exact accepted road/building exclusion.

**Changed**
- Draft PR #79 / branch `agent/forge-vegetation-sources`.
- `engine/compiler/src/nwe_compiler/vegetation.py` and `engine/compiler/tests/test_vegetation.py`.
- `tools/visual-data/compile_vegetation_representative_sample.py` and `tools/visual-data/verify_vegetation_representative_sample.py`.
- `.github/workflows/vegetation-source-sample.yml` and temporary-then-restored `.github/workflows/visual-source-probe.yml`.
- `docs/05-worklog.md` and `docs/06-task-queue.md`.
- CI evidence artifact `9387699149`; raw/bulk provider geodata remains outside Git.

**Next**
- `P1-VEGETATION-01-RENDERER-HANDOFF`: LUMEN adapts PR #80 to consume the candidate FORGE artifact while keeping render-local conversion, accepted-DTM grounding, local road/building/spawn/slope filtering, asset mapping, visible-instance budgets and LOD as presentation/runtime concerns.

## 2026-09-03 23:26 UTC — LUMEN — UE5-FOUNDATION

**What**
- Replaced the stale web-runtime product direction with a real Unreal Engine 5.8 Windows game project for a third-person Nannestad vertical slice.
- Added a deterministic fail-closed adapter from the pinned, fully verified NWE snapshot to a 1009² Landscape `.r16`, chunked terrain, connected NVDB road strips and source/fallback-separated OSM building meshes.
- Added explicit EPSG:25832/NN2000 → UE coordinates, runtime collision/lighting bootstrap, Quinn-based human character, Open World level authoring automation and setup/CI coverage.

**Why**
- The explicit product requirement is Unreal Engine 5, real Nannestad geometry/topography and realistic human-scale presentation. Reusing the verified engine-neutral world truth avoids repeating the old prototype's renderer-bound architecture while preserving its valid data work.

**Result / evidence**
- FACT: snapshot commit `42f94b63a9172b345d4500473a0aa1aff785fa43` reconstructs terrain, roads and building provenance as `READY_FOR_RUNTIME`; normal gameplay requires zero raw Kartverket/NVDB/OSM calls.
- FACT: the real tile build emits 21 deterministic mesh packets (16 terrain, one connected road layer, four building source/fallback surface classes), 14,870,975 mesh bytes and a 2,036,162-byte Landscape heightmap.
- FACT: all 246 road paths become 2,372 connected surface segments with capped miter joins; all 135 building footprints are represented, with 15 source-backed and 120 fallback heights kept separately classified.
- FACT: independent package builds compare byte-identically. Package SHA-256 is `cda37d0c9a14daba65aa74645f989fc998c49ed84529bee6d6f0f535e3de9b37`; Landscape SHA-256 is `989b1d41d65e4f581c0ca5d5879e4b6553537e17f8d92c040a2d87d3b1db158c`; maximum declared height quantization error is 0.000218517 m.
- FACT: 22 repo skills validate, 177 combined compiler/Unreal tests pass, the 11-case runtime verifier passes, cross-language RFC 8785/JCS passes and `git diff --check` passes.
- NOT YET PROVEN: no Unreal installation exists in the current environment, so C++ Editor compilation, Python editor API execution, native Landscape import, Play-in-Editor, visual realism, performance and packaged Windows behavior remain open. Lumen/VSM settings and source checks are not substitutes for that evidence.

**Changed**
- `apps/unreal-runtime/**`: UE project/config/source, deterministic data tools, level/setup automation, tests and operator documentation.
- `.github/workflows/baseline.yml`, `.gitignore` and `.gitattributes`.
- `README.md`, `AGENTS.md`, LUMEN role, D-009, roadmap, active queue and `docs/09-unreal-game-plan.md`; the former web plan is marked historical.

**Next**
- `UE5-RUN-01`: run the clean setup on Windows with UE 5.8 + Third Person content, fix any compile/editor API failures, then retain PIE movement/collision/log/render/performance evidence before native Landscape authoring.
