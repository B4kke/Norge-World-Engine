# LUMEN — automated browser provenance/decode profile gate

Date: 2026-08-19

## Scope

P0-PROVENANCE-02 / P0-VIEWER-01. This proof adds an automated Chrome execution gate for the existing deployable `browser-artifact-profile.html` surface. It does not change RuntimeVerificationBundle semantics, source authority, streaming policy, renderer architecture or physical-device claims.

## Main sync

The persistent `agent/lumen-hourly` branch was synchronized without force from `main` at `a74ba2e743785a6938ea9afbbe0fc86981360888` through maintenance merge PR #58. That sync only targets the role branch; it does not merge LUMEN work into `main`.

## Problem

The profiler was already built and its unit regressions ran in CI, but the browser page itself was not executed automatically. Therefore the queue's requested exact-head browser measurement could not be produced as a workflow artifact and failures in browser-only integration could escape the profiler's Node regressions.

A first automated run also exposed an evidence-identity trap: on `pull_request` workflows GitHub's default `GITHUB_SHA` names the synthetic PR merge ref, not the source branch head. A green profile bound only to that merge SHA is valid integration evidence, but must not be described as exact branch-head evidence.

## Change

- `browserArtifactProfileEntry.mjs` accepts an optional same-origin `/__profile_report` callback used only by the CI harness.
- The callback rejects cross-origin or unexpected report targets before posting evidence.
- `run_browser_artifact_profile_smoke.mjs` serves the production `dist`, launches headless Chrome, receives the report and fails closed unless:
  - report schema/status are valid;
  - build identity is exact-commit-bound and matches the explicit expected build SHA when present;
  - tile identity matches accepted Nannestad Preview 1;
  - road/building artifact SHA-256 values match the accepted artifacts;
  - both production loads return `RUNTIME_VERIFICATION_PASS`;
  - raw-source calls remain zero;
  - first-replay and steady-state profile sections are present.
- `vite.config.mjs` accepts `NWE_BUILD_GIT_COMMIT_SHA` before platform defaults so CI can explicitly embed the actual PR head while Vercel continues to use `VERCEL_GIT_COMMIT_SHA` normally.
- `world-viewer-vite` sets `NWE_BUILD_GIT_COMMIT_SHA=${{ github.event.pull_request.head.sha || github.sha }}` for both the production build and profile assertion.
- `world-viewer-vite` runs this exact-real browser profile after the production Vite build and uploads the resulting JSON keyed by the PR head SHA (or normal workflow SHA outside a PR).

## Calibration evidence

The first execution gate itself passed on workflow run `32236092213`: accepted road/building identities, full production `RUNTIME_VERIFICATION_PASS`, isolated replay PASS and zero raw-source calls. That run also demonstrated why the explicit head binding is necessary: the embedded identity was the synthetic merge commit, so it is retained only as integration evidence rather than exact branch-head evidence.

A subsequent run after attempting to override the reserved `GITHUB_SHA` still embedded the synthetic merge SHA. The implementation therefore moved to the dedicated `NWE_BUILD_GIT_COMMIT_SHA` input rather than relying on mutation of GitHub's default context.

## Evidence boundary

This is hosted/headless Chrome browser-runtime evidence. It profiles the accepted compiled road/building artifact path and replays full RuntimeVerificationBundle verification against already-fetched bytes to separate verification, UTF-8 decode and `JSON.parse`. It is not Android/mobile evidence, does not measure raw-source acquisition and cannot select WebGPU/WebGL/Cesium architecture.

The bounded five-iteration CI profile is diagnostic rather than tail-latency acceptance evidence. p95/p99 remain explicitly unsupported at that sample count. Any isolated parse/GC/scheduler outlier must be reproduced with a larger controlled sample before it drives worker/cache policy.

## Acceptance

The PR is acceptable only if final exact-head `world-viewer-vite` proves that the embedded `git_commit_sha` equals the actual PR branch head and executes the new browser profile successfully together with the existing artifact-only, renderer, movement/cache/resource-lifecycle and worker gates. Vercel Preview must be checked separately against the exact PR head when available.
