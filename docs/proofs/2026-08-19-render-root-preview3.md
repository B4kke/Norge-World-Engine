# 2026-08-19 — Render root serves Preview 3

## Problem

The 3×3 terrain candidate capability was merged to `main`, but the deployable root entrypoint still used `apps/world-viewer/index.html -> src/main.ts`. `src/main.ts` is intentionally Preview 1 and labels the scene `NANNESTAD 1×1 KM`. A static host publishing the Vite `dist/` directory therefore continued to show the accepted 1×1 Preview 1 at `/` even though `/preview3.html` existed.

## Fix

- `index.html` now loads `src/preview3Entry.ts`, making the ordinary deployed root `/` the real 3×3 candidate viewer.
- the previous Preview 1 entrypoint is preserved as `preview1.html -> src/main.ts`;
- Vite explicitly emits both `preview1.html` and `preview3.html`;
- `test_root_entrypoint.mjs` fails the normal viewer build if root silently returns to Preview 1.

## Authority boundary

This is a deployment/default-route correction only. It does not select NHM WCS as production world truth and does not close `P0-MULTITILE-TERRAIN-01`. Preview 3 remains a source candidate consuming the isolated `preview-runtime-3x3/nannestad-preview-3` compiled artifact snapshot. Preview 1 remains available for the accepted D-007 single-tile path.

## Acceptance

The clean PR must pass the existing World Viewer build/browser gates, repository baseline, Preview 1 real-data gate and Preview 3 real-data gate before merge. After merge, the next Render deployment from `main` should make `https://norge-world-engine.onrender.com/` load the 3×3 viewer while `/preview1.html` preserves the historical 1×1 viewer.
