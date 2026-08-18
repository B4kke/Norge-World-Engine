# 2026-08-18 — World Viewer Vite shell

## Scope

Create the smallest reversible deployable web-application shell for `apps/world-viewer` without selecting the final renderer or changing world/compiler contracts.

The branch is rebuilt directly on the current `main` after the viewer batching and browser provenance-parity work merged, so those existing runtime/viewer boundaries are inherited rather than forked or replaced.

## Existing viewer boundary preserved

Before adding Vite, `apps/world-viewer` already contained:

- `artifact_consumer.mjs`: compiled-artifact browser gate with fail-before-fetch raw-source rejection and full WebCrypto/JCS RuntimeVerificationBundle reconstruction before decode;
- `benchmark/`: the merged fixed-camera real-artifact WebGL2 batching harness;
- viewer regressions for full provenance artifact consumption, benchmark geometry and benchmark parameters.

The Vite work does not duplicate or supersede these paths. Its focused CI reruns the existing viewer boundary regressions before building the static app.

## Browser provenance compatibility

The merged browser verifier shares all provenance semantics with Node through `engine/streaming/runtime_verifier_core.mjs`; the browser adapter uses pinned `canonicalize@3.0.0` plus WebCrypto SHA-256. Real Chrome evidence already proves complete road/building provenance reconstruction, forged-lineage/tampered-byte rejection and 0 raw-source runtime calls.

To keep the Vite package dependency-correct, `@nwe/world-viewer` declares the same pinned `canonicalize@3.0.0`. The focused workflow watches the shared browser verifier files and installs the viewer/schema workspaces before running existing viewer regressions. This shell does not copy or fork verifier semantics.

## Implementation

- `apps/world-viewer/package.json` defines a standalone Vite application using Vite 8.2.0 already exercised by the repository's Cesium baseline, plus pinned `canonicalize@3.0.0` required by the shared browser verifier path.
- `index.html` + `src/main.ts` + `src/styles.css` provide a responsive mobile/desktop application shell and a real browser canvas surface.
- The shell probes secure-context, WebGPU availability and WebGL2 fallback availability, but does not claim that either API is the selected renderer.
- No synthetic terrain, roads or buildings are presented as world truth. The UI explicitly distinguishes proven artifact/runtime boundaries from still-open deployment/data-distribution/renderer work.
- Root `package.json` registers `apps/world-viewer` as `@nwe/world-viewer` and adds build/dev workspace scripts.
- `.github/workflows/world-viewer-vite.yml` installs viewer/shared-verifier dependencies, runs syntax plus artifact/benchmark regressions, builds the Vite app and asserts static `dist/` output.

## Deployment contract

Vercel project settings for this app:

- Root Directory: `apps/world-viewer`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: automatic/default

The initial deployment is a viewer-shell/hosting proof only. World data remains compiled outside the browser and runtime integration must continue to consume verified compiled artifacts rather than raw Kartverket/NVDB/OSM APIs.

## Evidence boundary

A passing Vite build proves only that the app shell can be built as a static web application while preserving the existing full-provenance viewer regressions. It does not prove hosted terrain/vector artifact distribution, real terrain DedicatedWorker streaming, renderer performance, WebGPU support on a device, multi-tile seams or simulation behavior.

No decision is added to `docs/04-decisions.md`; Vite remains a replaceable web build/development tool rather than a world-renderer architecture choice.
