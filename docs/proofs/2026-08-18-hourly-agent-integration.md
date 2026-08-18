# 2026-08-18 — Hourly agent integration and bounded PR policy

## Session scope

SENTINEL-style integration pass over the parallel LUMEN, FORGE, STRØM, ATLAS and Preview 1 branches created during the 2026-08-18 hourly-agent rollout.

## Merged result

PR #20 was synchronized with current `main`, consolidated, exact-head validated and squash-merged as `54e16a60d552b14916ca66b0554d6a342e2b1ba0`.

The merged composition includes:

- **LUMEN:** same-artifact renderer observability, repeat-draw measurement, WebGPU upload-alignment correction and device-evidence surface. Hosted exact-real WebGL2 remained 4 draw calls/frame on the accepted Preview 1 composition; hosted WebGPU availability is still not Android/WebGPU acceptance evidence.
- **STRØM:** separate resident / activating / inactive-cache accounting, optional resident-byte cap with activation reservation, lifecycle/failure accounting, 12 adversarial scheduler cases and a constrained synthetic 3x3 pressure benchmark. No production device budget is selected.
- **FORGE:** DTM1 source-grid geometry audit plus NHM/ImageServer seam-authority probe. The observed 15010 m / 15000 m / 10 m pattern and ImageServer mosaic metadata are evidence, but they do not authorize a production overlap-selection transform. Seam promotion remains fail-closed.
- **ATLAS:** explicit candidate world-coordinate contract with Float64 authoritative positions, high-precision tile frames, render-local Float32 derivation, `(originSeriesId, epoch)` identity, temporal origin-shift invariants and deterministic authoritative snapshot schema. Whole-Norway coordinate policy remains open.
- **SENTINEL:** repaired the Preview 1 synchronize-range proof gate and extended proof-sensitive admission to compiler/streaming/schema/package dependencies. The gate now fails closed when a proof-sensitive change appears anywhere in the synchronize range.
- **Preview 1:** real compiled Nannestad DTM1 + 246 NVDB road paths + 135 OSM building footprints remain artifact-only in browser runtime with RuntimeVerificationBundle verification and zero raw Kartverket/NVDB/OSM acquisition calls.

## Exact-head acceptance before merge

Head `20ff829b0d9158e2981c8b76b4bf8e8ded896566` passed all triggered PR workflows before squash merge:

- `baseline` #750 — PASS;
- `world-viewer-vite` #108 — PASS;
- `viewer-benchmark` #120 — PASS;
- `preview1-realdata-publish` #69 — PASS, including compile/stage, exact-byte runtime verification, Vite build, real Chrome `REAL WORLD READY` browser composition gate, proof upload and replaceable compiled snapshot publish;
- `dtm1-source-grid-geometry-audit` #4 — PASS;
- `dtm1-seam-authority-probe` #3 — PASS;
- `dtm1-multitile-source-plan` #41 — PASS;
- `visual-source-probe` #23 — PASS.

A prior Preview 1 run had produced a valid browser proof but failed while deleting a still-busy Chrome temp profile (`ENOTEMPTY`). The harness was corrected so known ephemeral-profile cleanup races do not invalidate an already accepted browser proof; unknown cleanup errors remain failures.

## PR cleanup

After merge, superseded open PRs #23, #24, #25, #26, #28 and #29 were closed. PR #27 had already been squash-merged into the Preview 1 integration branch; PR #21 (Agent v2) had already merged to `main`. At the end of this pass there were **0 open pull requests**.

The repository still contained 27 historical `agent/*` branch names when counted during the pass. The current GitHub connector does not expose branch deletion, so historical branch deletion was not performed here.

## Hourly-agent policy changed

The previous recurrence model could create a fresh branch/PR every hour while forbidding role agents from merging, and the SENTINEL integration task was disabled. That model is rejected because it produces unbounded branch/PR growth and shared-document conflicts.

Current recurring schedule/policy:

- LUMEN at minute 00 — reuse `agent/lumen-hourly`, maximum one open LUMEN PR;
- FORGE at minute 10 — reuse `agent/forge-hourly`, maximum one open FORGE PR;
- STRØM at minute 20 — reuse `agent/strom-hourly`, maximum one open STRØM PR;
- ATLAS at minute 30 — reuse `agent/atlas-hourly`, maximum one open ATLAS PR;
- SENTINEL at minute 50 — enabled as integration/QA owner; review exact-head evidence and squash-merge green compatible role PRs to `main` under the user's standing authorization, otherwise document the blocker.

Role agents must start from current `main`, synchronize without force, continue an existing role PR instead of creating a new one, and must not merge their own work. SENTINEL owns cross-agent integration and should reconcile shared project-memory files once after integration rather than allowing parallel role branches to overwrite them.

## What is proved vs still open

**Proved in this pass:** the consolidated composition is internally compatible under the triggered hosted gates; the exact-real Preview 1 browser path still reaches `REAL WORLD READY`; the FORGE evidence remains explicitly non-authoritative; the new ATLAS/STRØM contracts/regressions coexist with Preview 1; and the proof-gate admits compiler/streaming dependency changes.

**Still open:** authoritative DTM1 multi-source seam transform, real multi-tile 2x2/3x3 promotion, Android provenance/runtime budget, Android movement/origin-shift acceptance, production renderer/WebGPU selection, actual physics/network coordinate adapters, building height enrichment, and production road-surface semantics.

## Next highest-value work

1. Keep `P0-MULTITILE-TERRAIN-01` fail-closed until provider-authoritative seam semantics or an otherwise defensible versioned transform contract is established.
2. Use the merged STRØM + ATLAS contracts in exact-real browser/device movement tests rather than adding new presentation features.
3. Let the hourly agents reuse bounded role branches; SENTINEL integrates or blocks them at minute 50 so branch/PR count cannot grow by five every hour.
