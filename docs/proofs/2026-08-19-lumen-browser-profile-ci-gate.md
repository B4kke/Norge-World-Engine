# LUMEN — automated browser provenance/decode profile gate

Date: 2026-08-19

## Scope

P0-PROVENANCE-02 / P0-VIEWER-01. This proof adds an automated Chrome execution gate for the existing deployable `browser-artifact-profile.html` surface. It does not change RuntimeVerificationBundle semantics, source authority, streaming policy, renderer architecture or physical-device claims.

## Main sync

The persistent `agent/lumen-hourly` branch was synchronized without force from `main` at `a74ba2e743785a6938ea9afbbe0fc86981360888` through maintenance merge PR #58. That sync only targets the role branch; it does not merge LUMEN work into `main`.

## Problem

The profiler was already built and its unit regressions ran in CI, but the browser page itself was not executed automatically. Therefore the queue's requested exact-head browser measurement could not be produced as a workflow artifact and failures in browser-only integration could escape the profiler's Node regressions.

## Change

- `browserArtifactProfileEntry.mjs` accepts an optional same-origin `/__profile_report` callback used only by the CI harness.
- The callback rejects cross-origin or unexpected report targets before posting evidence.
- `run_browser_artifact_profile_smoke.mjs` serves the production `dist`, launches headless Chrome, receives the report and fails closed unless:
  - report schema/status are valid;
  - build identity is exact-commit-bound and matches `GITHUB_SHA` when present;
  - tile identity matches accepted Nannestad Preview 1;
  - road/building artifact SHA-256 values match the accepted artifacts;
  - both production loads return `RUNTIME_VERIFICATION_PASS`;
  - raw-source calls remain zero;
  - first-replay and steady-state profile sections are present.
- `world-viewer-vite` now runs this exact-real browser profile after the production Vite build and uploads the resulting JSON keyed by `${{ github.sha }}`.

## Evidence boundary

This is hosted/headless Chrome browser-runtime evidence. It profiles the accepted compiled road/building artifact path and replays full RuntimeVerificationBundle verification against already-fetched bytes to separate verification, UTF-8 decode and `JSON.parse`. It is not Android/mobile evidence, does not measure raw-source acquisition and cannot select WebGPU/WebGL/Cesium architecture.

## Acceptance

The PR is acceptable only if exact-head `world-viewer-vite` executes the new browser profile successfully together with the existing artifact-only, renderer, movement/cache/resource-lifecycle and worker gates. Vercel Preview must be checked separately against the exact PR head when available.
