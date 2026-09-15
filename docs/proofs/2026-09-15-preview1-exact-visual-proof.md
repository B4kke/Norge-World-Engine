# Preview 1 exact visual proof repair — 2026-09-15

## Scope

Branch: `agent/lumen-unreal-nannestad-foundation` (PR #84).

This proof covers the web reference viewer only. It does **not** close `UE5-RUN-01`, does not claim Unreal Editor acceptance, and does not claim photorealism.

## Failure reproduced

At branch commit `3f924b150fecb729663fe6be7ea53b52a4af022b`, workflow run `33963144227` failed in **Capture REAL WORLD READY screenshot**.

The failure was concrete:

- the viewer build passed;
- the screenshot harness requested `/runtime/manifest.json`;
- the configured `apps/unreal-runtime/Saved/NWE/Snapshot` had not been materialized in CI, so the manifest returned HTTP 404;
- the job named “Checkout exact commit” actually checked out GitHub's synthetic PR merge commit `b53627f...`, not PR head;
- the runner also warned that software WebGL now needs explicit SwiftShader opt-in for trusted content.

## Repair

Implemented on the same PR branch:

1. `capture_preview1_screenshot.mjs` explicitly enables CI SwiftShader for this trusted local visual-proof harness. This is visual evidence only and is **not** GPU-performance evidence.
2. `preview1-visual-proof.yml` now checks out the pull-request head SHA (or `github.sha` outside PR events).
3. The workflow materializes the pinned immutable runtime snapshot with `nwe_unreal_pipeline.py fetch` and re-runs `verify_runtime_snapshot.mjs` before starting Chrome.
4. Artifact naming is bound to the real PR head SHA.

Run `34907062286` on head `229e9c193cd413c3e4490b65f068a9431cf9e828` passed build, snapshot/provenance verification, `REAL WORLD READY`, screenshot capture, and artifact upload.

## Visual defect found by the repaired proof

The first trustworthy PNG exposed large black triangular/saw-tooth artifacts across the draped road surface.

Root cause was the road drape triangulation contract: clipped road polygons inherited arbitrary/downward winding. The renderer then derived normals from those triangles, which made lighting/shadow behavior unstable at terrain-triangle boundaries.

The drape now:

- emits only non-degenerate triangles;
- normalizes every emitted triangle to positive-Y/upward winding;
- records `winding: upward-y`;
- has a regression that measures the projected cross-product of every generated triangle and requires positive Y.

Run `34907307063` on head `9fadcae1a2d396efd92ad9bce176e25c028a5652` passed the exact visual gate. Manual inspection confirmed that the large triangular road artifacts were removed.

A follow-up experiment disabled road shadow-map reception. Run `34907474874` showed no material visual improvement to the remaining dark asphalt. That workaround was therefore reverted instead of retaining an unproven quality tradeoff.

## Final evidence

Final validated implementation head before this documentation commit:

- commit: `7e58e6dc9a63ac861638851bde82fa2125c0a4e6`
- exact visual workflow: `34907793193` — **PASS**
- visual artifact: `10373132469`
- extracted PNG SHA-256: `709b3c444a6ab009c0dfce82b085ff0068707b43f19fc833e043f99c052dc2ea`
- `world-viewer-vite` run `34907793094` — **PASS**
- `viewer-benchmark` run `34907793188` — **PASS**

The repository-wide baseline still fails at **Cesium 3D Tiles baseline build**. This predates this session: run `33963144232` on the old `3f924b...` head failed at the same step, while steps through compiler, Unreal adapter, world contracts, provenance, streaming, terrain worker, and viewer artifact boundary passed. The final run `34907793138` has the same failure location.

## Honest visual status

Proven in the final screenshot:

- real compiled Nannestad terrain, roads and building footprints load with full provenance;
- no raw-source runtime calls are required;
- PBR terrain and atmospheric sky render;
- first-person reference view reaches `REAL WORLD READY`;
- the former large road-triangle artifacts are gone.

Still open:

- asphalt presentation is too dark in the current high-profile WebGL2 proof;
- building volumes are still visually generic where source heights/roof semantics are unresolved;
- source-backed vegetation is not yet rendered;
- WebGPU/mobile and physical-device performance are not proven by the SwiftShader screenshot;
- Unreal Engine 5.8 Editor/PIE evidence remains blocked on a Windows UE runner.

This keeps geographic/world-truth claims separate from presentation quality.
