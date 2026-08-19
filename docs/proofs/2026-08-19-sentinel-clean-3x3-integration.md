# SENTINEL clean 3×3 terrain candidate integration — 2026-08-19

## Scope

This proof records the integration boundary after FORGE PR #56 was accepted as candidate infrastructure without selecting `NHM DTM 25832 WCS` as production terrain authority.

`P0-MULTITILE-TERRAIN-01` remains OPEN / FAIL-CLOSED for canonical source-family selection and the current D-007 Atom acceptance contract remains authoritative until explicitly reconciled.

## Why a clean integration branch

The original LUMEN PR #63 was stacked on the long-lived FORGE branch. After PR #56 was squash-merged to `main`, Git ancestry made the retargeted PR appear to contain the historical FORGE stack again. Merging that noisy branch could reintroduce superseded source-selection prose.

SENTINEL therefore rebuilds the browser integration as a narrow branch directly from merged `main`, carrying only the verified LUMEN/runtime delta.

## Isolation rule

The accepted Preview 1 path is intentionally untouched.

Preview 3 uses a separate candidate transport lane:

- artifact branch: `preview-runtime-3x3`;
- snapshot folder: `nannestad-preview-3`;
- viewer entry: `/preview3.html`.

The candidate publish workflow runs the same provenance-bearing WCS compiler path already merged by #56, but publication occurs only after a push to `main`. Pull requests compile and browser-test locally in CI without replacing the accepted Preview 1 artifact snapshot.

## Previously established browser evidence

The exact LUMEN browser proof on run `32253585673` / job `96070137556` demonstrated:

- 9/9 independently verified 1 km terrain artifacts;
- 9 scheduler loads completed, 0 failed;
- 9 terrain GPU resources resident simultaneously;
- 149,769 terrain vertices;
- 294,912 terrain triangles;
- 12 draw calls per frame in the WebGL2 baseline;
- 33 GPU buffers, 27 of them terrain buffers;
- 5,617,182 tracked GPU payload bytes;
- 42,562,080 retained terrain runtime bytes;
- 23 audited runtime requests, all compiled/same-origin in the smoke harness;
- 0 raw-source runtime calls;
- one shared render-local origin for all nine meshes.

Hosted Headless Chrome/SwiftShader timing is directional only and is not physical GPU/mobile acceptance evidence.

## Runtime contract correction

The integration exposed that WCS candidate artifacts legitimately use `nodata: null` when all 1,000,000 samples are valid. The runtime decoder now accepts either explicit `null` (no sentinel) or a finite numeric sentinel. Non-finite elevations and numeric nodata samples still fail closed. A dedicated regression accompanies the change.

## Non-decisions

This integration does not:

- select WCS as production world truth;
- close the Atom overlap/seam/source transition question;
- select a final whole-Norway terrain mesh/LOD format;
- extend roads/buildings beyond the center 1 km tile;
- select imagery/textures;
- claim multi-tile WebGPU or physical-device performance.

## Acceptance for this clean PR

Before merge, require the clean branch to pass at minimum:

- repository baseline;
- World Viewer Vite/browser checks;
- isolated `preview3-realdata-publish` 9-tile compile, provenance verification and Chrome composition gate.

Only after those clean-head checks pass may the candidate browser capability be integrated into `main`.
