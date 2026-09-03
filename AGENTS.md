# Agent working contract — Norge World Engine

## Start every task here

1. Read `.agents/skills/nwe-project-start/SKILL.md`.
2. Read `README.md`.
3. Read `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md`, `docs/06-task-queue.md` and `docs/09-unreal-game-plan.md`. `docs/08-revised-engine-chain.md` is historical context.
4. Inspect current GitHub branches/PRs/issues touching the same active task before starting duplicate work.
5. Select exactly one primary Agent v2 role from `.agents/roles/`.
6. For active playable-world work, load `nwe-ground-level-runtime`; for architecture/tooling decisions with custom-code risk, load `nwe-reuse-discipline`.
7. Pick the highest-priority unresolved queue task that the selected role can advance with concrete implementation/evidence now.
8. Verify time-sensitive software/API/license/geodata claims against current primary sources before relying on them.
9. Implement a small reversible change, validate only the claim you changed, and update the structured worklog/task queue plus affected decisions/docs in the same PR.
10. End with **What / Why / Result-evidence / Changed / Next** using `docs/05-worklog.md`.

GitHub is canonical for implementation state. Current repo/task-queue evidence beats stale historical Drive prose.

## Current product direction

The active milestone is **a Windows-PC, third-person Nannestad vertical slice in Unreal Engine 5.8**: real terrain, road surfaces, building geometry, realistic materials/lighting and a human character at human scale.

Unreal is an adapter over the existing engine-neutral world/compiler/runtime
contracts. Neither Unreal objects nor historical `THREE.*`/WebGPU objects may
become authoritative world state, compiler output, tile identity, provenance or
simulation state. See D-009 and `docs/09-unreal-game-plan.md`.

## Agent v2 — five active roles

- **LUMEN — Renderer & Unreal Platform**: `.agents/roles/lumen-renderer.md`. Leads the current playable vertical: UE adapter, Landscape/runtime geometry, materials/lighting, humanoid/animation, input/camera and Windows build evidence. Maintains the historical web renderer when needed.
- **STRØM — Runtime Streaming**: `.agents/roles/strom-streaming.md`. Owns verified artifact/tile lifecycle, cache/prioritization, worker boundaries and renderer-neutral runtime metrics. During the single-tile playable slice, avoid scheduler expansion unless a concrete runtime need appears.
- **FORGE — World Compiler & Data Pipeline**: `.agents/roles/forge-compiler.md`. Owns authoritative acquisition, normalization, deterministic compilation and data enrichment. Do not reopen source archaeology that does not block the active slice.
- **ATLAS — World Model & Coordinates**: `.agents/roles/atlas-world.md`. Owns world/entity transforms, render origin and simulation-facing boundaries. For the playable slice, define only the smallest stable character/world contract needed; do not reopen whole-Norway policy without cause.
- **SENTINEL — Integration & QA**: `.agents/roles/sentinel-integration.md`. Owns adversarial integration, schemas/contracts, CI evidence and claim calibration. One milestone integration pass is preferred over repeated test cycles.

These roles are parallel, not a fixed sequence. Dependencies still matter: runtime/render work consumes accepted compiled artifacts and contracts; it does not invent missing world truth.

## Repo-local skills

Load only what the task needs:

- `nwe-project-start` — mandatory startup, role/priority selection and handoff.
- `nwe-ground-level-runtime` — shortest correct path to the walkable Nannestad vertical slice.
- `nwe-reuse-discipline` — reuse-first decisions, explicit exit gates and anti-test/research-loop rules.
- `nwe-geodata-contracts` — source/CRS/datum/license/provenance gates.
- `nwe-world-compiler` — raw → normalized → compiled, cache, lineage, promotion.
- `nwe-geospatial-tooling` — pinned Rasterio/GDAL, pyproj/PROJ, Shapely and RFC8785 usage.
- `nwe-world-model` — high-precision world state, render-local coordinates and origin epochs.
- `nwe-runtime-streaming` — verified tile lifecycle, scheduler/cache/worker boundaries.
- `nwe-renderer-platform` — renderer-boundary discipline and historical web adapter guidance; apply its engine-neutral constraints to Unreal, not its old product selection.
- `nwe-gpu-fundamentals` — renderer-neutral GPU/frame contract; mandatory for LUMEN renderer work.
- `nwe-gpu-geometry`, `nwe-gpu-materials`, `nwe-gpu-lighting`, `nwe-gpu-textures` — selective geometry/PBR/presentation skills.
- `nwe-gpu-animation`, `nwe-gpu-assets`, `nwe-gpu-interaction` — renderer-neutral character/assets/input integration with Three only as adapter.
- `nwe-gpu-shaders`, `nwe-gpu-postprocessing` — WebGPU-first TSL/WGSL/GLSL and modern screen-pipeline boundaries.
- `nwe-quality-gates` — negative tests, determinism, evidence classes and performance QA.
- `nwe-3d-tiles-spike` — measured 3D Tiles/Cesium interchange experiments only; currently deferred from the playable critical path.
- `nwe-github-workflow` — isolated agent branches, draft PRs, CI and project-memory publication.

The `nwe-gpu-*` suite is adapted from useful concepts in the MIT-licensed `CloudAI-X/threejs-skills` bundle, but rewritten around renderer-neutral NWE contracts. Source mapping/provenance is in `.agents/skills/UPSTREAM-THREEJS-SKILLS.md`.

## Parallel-work contract

- One primary role owns a branch and its core paths. Branch names should be `agent/<role>-<task>`.
- Before editing a shared contract or shared doc, inspect active PRs. Prefer additive/narrow implementation changes and avoid duplicate plans.
- Cross-agent handoff happens through versioned schemas, verified artifacts, documented metrics and explicit PR dependencies — not copied private assumptions.
- LUMEN and STRØM may not weaken `RuntimeVerificationBundle` or bypass artifact verification for convenience.
- FORGE may not encode Three.js/Unreal-specific assumptions into source acquisition or canonical normalized data.
- ATLAS may prototype coordinate/entity policies but may not mark whole-Norway values selected without evidence and `docs/04-decisions.md`.
- SENTINEL may block a claim/PR on missing evidence; it must distinguish implementation failure from infrastructure/tooling failure and must not create repeated QA loops without a changed claim/failure.
- No agent merges its own work unless the user explicitly asks for a merge.

## Anti-loop / do-not-reinvent contract

- The first open P0 queue item is the default next task. Side research must identify a hard dependency before displacing it.
- Before custom generic infrastructure, check existing repo capabilities, mature libraries and standards; document the mismatch if custom code is still required.
- One targeted acceptance test per task and one integrated UE build/play gate per milestone are the default. More cycles require a new failure, changed claim or materially changed implementation.
- Do not create another prototype harness when `apps/unreal-runtime` can carry the proof.
- Do not build a custom globe, global screen-space-error hierarchy or broad LOD framework while the active requirement is a single-tile walking scene.
- Do not select a full physics stack before terrain grounding/simple collision proves insufficient.
- Stop optimizing when the task exit gate passes unless a measured budget fails.

## Manual physical-device testing policy

Physical handset/device testing is a **scarce milestone check**, not a default validation step and not a routine P0 blocker.

- Prefer automated regressions, hosted CI, desktop/headless browser runs, exact-artifact smoke tests and reproducible benchmarks for normal development.
- Do not ask the user to manually test Android after ordinary changes.
- Batch device questions and request a physical run only for a specifically device-only unresolved claim or an accumulated milestone.
- Historical worklog entries that say Android is next are archived history; the current queue is authoritative.

See `docs/07-testing-policy.md`.

## Architecture invariants

- Separate geographic correctness from photorealism.
- Source geodata is input to reproducible preprocessing; normal runtime consumes compiled artifacts, never raw source APIs.
- Keep coordinate/datum/provenance explicit. Never interpret anonymous `z` as authoritative elevation.
- Runtime tile identity is independent from provider/source tiling.
- Authoritative world/entity state is renderer-independent and high precision; render-local resources are derived/disposable.
- Unreal may own presentation and runtime realization only. Other renderer adapters must remain feasible without replacing the Norwegian data pipeline.
- Static geodata and dynamic simulation state are separate layers.
- Performance is a requirement, but measure the current bottleneck rather than benchmarking everything every change.
- Use the least expensive representation that satisfies the current accuracy/visual need.

## Current evidence boundary — 2026-09-03

Accepted real single-tile Nannestad terrain, road and building artifacts are runtime-verification proven. Their deterministic Unreal package conversion and coordinate/quantization contracts are proven outside the editor. A real UE 5.8 Windows compile, automated map creation, play/render capture and packaged-build smoke are not yet proven. Neighboring terrain and whole-Norway coordinate/LOD choices remain open but do not block the single-tile milestone.

## Prototype vs engine

Experiments and historical implementations belong in `prototypes/`. Production-direction code belongs in `engine/`/`apps/` when its boundary and narrow regressions are satisfied. `apps/unreal-runtime` is the active game surface; `apps/world-viewer` remains a reference artifact consumer.

## End every task with

Append one structured entry to `docs/05-worklog.md` containing:
- **date + local time/timezone + agent + task ID**;
- **What**;
- **Why**;
- **Result / evidence**;
- **Changed**;
- **Next** — exactly one highest-value follow-up.
