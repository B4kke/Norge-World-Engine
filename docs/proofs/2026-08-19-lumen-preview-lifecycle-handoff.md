# LUMEN — Preview terrain lifecycle integration handoff

Date: 2026-08-19

## Scope

This proof records the current renderer/browser evidence boundary for PR #41 without promoting a renderer architecture or taking ownership of STRØM scheduler policy.

## Repository / PR hygiene

- PR #39 was closed unmerged as superseded by PR #41 so only one LUMEN PR remains open.
- PR #41 remains draft and unmerged; SENTINEL retains integration/merge ownership.
- The historical branch layout is not yet compliant with the requested persistent `agent/lumen-hourly` role-branch rule: PR #41 currently uses `agent/lumen-preview-terrain-resource-lifecycle` and is stacked on the SENTINEL integration branch. Do not create another LUMEN PR to work around this. Consolidate branch history only through a safe, non-force integration step when the branch ancestry allows it.

## What the active implementation proves

The canonical Preview renderer adapters expose terrain-only resource lifecycle while keeping vector/pipeline resources alive. The exact-real device/browser smoke requires:

- verified accepted Nannestad terrain identity;
- scheduler movement `resident -> cached -> resident`;
- renderer terrain resource checkpoints `present -> absent -> present`;
- no runtime-input refetch on cache return;
- explicit renderer resource create/destroy counts;
- full RuntimeVerificationBundle verification;
- zero raw Kartverket/Geonorge/NVDB/OSM/Overpass runtime access;
- `physical_vram_release_observed=false`.

This is renderer resource-object lifecycle evidence. It is not physical VRAM reclamation timing, Android acceptance, multi-tile acceptance, LOD policy, GPU-budget policy or renderer-backend selection.

## Exact-head CI observed in this run

PR #41 head observed during validation: `e62c488a5dc06cb20c9a84e3d54fb0881d993991`.

GitHub Actions on that exact SHA:

- `baseline` run `32199455456` — SUCCESS
- `world-viewer-vite` run `32199455448` — SUCCESS
- `viewer-benchmark` run `32199455446` — SUCCESS

## Vercel smoke boundary

Latest READY PR #41 deployment observed during this run:

- deployment: `dpl_7F1yR1Av1ezjyt6M5AzvStqTa5gC`
- branch: `agent/lumen-preview-terrain-resource-lifecycle`
- deployed Git SHA: `331e5487c260b2ea61fb183c3b3a7bdb4391f345`
- `/device-evidence.html?renderer=webgl2&graphics=balanced&frames=90` returned HTTP 200.

That deployment is valid deployment/smoke evidence for `331e5487...`, but it is **not** exact-head deployment evidence for later PR head `e62c488a...` or any commit created after this proof. Vercel smoke must be rebound to the exact final commit before handoff is complete.

## Cross-agent boundary

STRØM PR #40 separately exposes renderer-neutral lifecycle observation/timing around injected activate/deactivate/dispose callbacks. LUMEN should consume that contract in `apps/world-viewer` only after the STRØM surface is integrated/available; do not duplicate renderer-neutral lifecycle observer logic inside the renderer.

## Next gate

1. Obtain a READY Vercel Preview bound to the exact final PR #41 SHA and smoke `/device-evidence.html`.
2. Have SENTINEL integrate the canonical lifecycle path so LUMEN can return to the persistent `agent/lumen-hourly` branch without force or duplicated PRs.
3. On one physical Android Chrome device, capture forced WebGL2 and forced WebGPU (if genuinely supported) using identical session/build/artifacts/camera/workload/render surface/frame window.
4. Require `comparable=true`, complete movement trace, renderer `present -> absent -> present`, zero refetch and zero raw-source calls before interpreting timing.
5. Only then use first-visible, frame p50/p95/p99/max, renderer resource create/destroy timing, upload/apply, draw calls and retained memory as backend evidence.

No change to `docs/04-decisions.md` is justified by this proof.
