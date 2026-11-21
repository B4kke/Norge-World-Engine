# 2026-11-01 — Hyperreal Nannestad LiDAR source gate

**Time:** 12:45 CET  
**Branch / PR:** `agent/lumen-web-nannestad-1to1` / PR #85  
**Task:** `P0-HYPERREAL-LIDAR-01`  
**Evidence class:** integration + deterministic source-contract regression. Live provider metadata and LAZ source bytes are still open.

## What changed

- Merged PR #84 (shared Unreal/PBR foundation) to `main`.
- Retargeted and merged PR #86 (UE mesh-packet SHA-256 integrity + level/setup hardening) to `main`.
- Kept PR #85 open as the Three.js/WebGPU Nannestad 1:1 development PR, retargeted it to `main`, and synchronized the newly merged foundation into it with a real two-parent merge commit.
- Merged the fresh-eye audit PR #87 into the development branch rather than accepting it as a production architecture decision.
- Reprioritized the Web queue from further proxy/post-processing polish to an exact-tile LiDAR gold-tile experiment.
- Added an exact Kartverket Høydedata metadata probe for the accepted 1×1 km tile.
- Added a separate exact-byte LAS/LAZ inspection gate for SHA-256, point count, bounds, measured in-tile density and LAS classification distribution.
- Pinned the LiDAR inspection dependencies and vectorized million-point inspection chunks so the gate is viable on realistic point-cloud sizes.

## Why

The existing renderer/provenance/streaming foundation is strong enough that the largest remaining realism uncertainty is source-derived geometry quality, not another generic shader or proxy pass. The experiment must prove from exact source bytes whether LiDAR can materially improve roofs, canopy/tree candidates and near-field terrain before NWE selects a production reconstruction policy.

## Result / evidence

- **FACT:** PR #85 remains `OPEN`, `DRAFT`, and `mergeable=true` against `main`.
- **FACT:** shared foundation/hardening PRs #84 and #86 are merged to `main`; #85 remains a separate development surface.
- **FACT:** `nannestad-lidar-source-probe` run `41303219436` passed its `contract` job on exact head `ec1c64b2c03e350439214a8740fc48b0ff16beb9`.
- **FACT:** that run's `live-provider` job was skipped because it is intentionally `workflow_dispatch` only. No live Høydedata metadata response is claimed by this proof.
- **FACT:** the same exact head has `baseline` run `41303219418` PASS, `viewer-benchmark` run `41303219399` PASS and `nvdb-road-semantics-proof` run `41303219393` PASS at this handoff. Other browser/source/publish jobs were still running and are not claimed PASS here.
- **FACT:** the probe uses the exact accepted tile bounds `611000,6677000` to `612000,6678000`, EPSG:25832 and NN2000; provider/network failure is distinct from `NO_CANDIDATE`.
- **FACT:** access metadata with `TILGANG=2` is treated as closed. The historical `Gjerdrum Ullensaker Nannestad 5pkt 2020` / `LACHVI04` record is a cross-check only, not live acquisition authority.
- **FACT:** the LAZ inspector hashes the exact local source file and measures decoded point facts in chunks; it does not infer quality from a project label.
- **EXPERIMENT:** LiDAR-first roof/tree/terrain reconstruction remains unselected until exact LAZ bytes are acquired and the A/B quality/performance gate passes.

## Changed

- `tools/geo/probe_nannestad_lidar.py`
- `tools/geo/test_probe_nannestad_lidar.py`
- `tools/geo/inspect_nannestad_laz.py`
- `tools/geo/test_inspect_nannestad_laz.py`
- `tools/geo/requirements-lidar.txt`
- `.github/workflows/nannestad-lidar-source-probe.yml`
- `docs/06-task-queue.md`
- PR #85 description / integration history

No renderer/world/provenance schema was promoted and no raw LiDAR was committed.

## Next

Run the manual live Høydedata metadata gate for the exact tile, acquire the selected open LAZ through the official provider path, SHA-bind the bytes, and run `inspect_nannestad_laz.py`. Only after class/density/coverage evidence exists should `P0-HYPERREAL-LIDAR-02` begin roof reconstruction, CHM/tree-candidate extraction and higher-detail terrain A/B work.
