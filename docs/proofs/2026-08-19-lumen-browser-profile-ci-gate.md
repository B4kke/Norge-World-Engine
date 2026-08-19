# LUMEN — automated browser provenance/decode profile gate

Date: 2026-08-19

## Scope

P0-PROVENANCE-02 / P0-VIEWER-01. This proof adds an automated Chrome execution gate for the existing deployable `browser-artifact-profile.html` surface. It does not change RuntimeVerificationBundle semantics, source authority, streaming policy, renderer architecture or physical-device claims.

## Main sync

The persistent `agent/lumen-hourly` branch was synchronized without force from current `main` `59a3d89cfcad52939bc88eaafcd7e7d8c2aea8fa` through two-parent merge commit `ef8e103192900e4f82a4f0de19101f38051edb53`. Incoming STRØM retained-admission-starvation files are disjoint from the LUMEN paths and were preserved unchanged.

## Problem

The profiler was already built and its unit regressions ran in CI, but the browser page itself was not executed automatically. Therefore the queue's requested exact-head browser measurement could not be produced as a workflow artifact and failures in browser-only integration could escape the profiler's Node regressions.

A first automated run also exposed an evidence-identity trap: on `pull_request` workflows GitHub's default `GITHUB_SHA` names the synthetic PR merge ref, not the source branch head. A green profile bound only to that merge SHA is valid integration evidence, but must not be described as exact branch-head evidence.

A later calibration exposed a second measurement-design contradiction: percentile evidence requires 100 steady-state samples for p99, while the profiler previously allowed at most 20 total iterations. Because the first replay is separated from steady state, the old harness could never produce a steady-state p99 classification of `SUPPORTED` regardless of how many CI runs were repeated.

## Change

- `browserArtifactProfileEntry.mjs` accepts an optional same-origin `/__profile_report` callback used only by the CI harness.
- The callback rejects cross-origin or unexpected report targets before posting evidence.
- `run_browser_artifact_profile_smoke.mjs` serves the production `dist`, launches headless Chrome, receives the report and fails closed unless report/build/artifact/provenance/raw-source conditions pass.
- `vite.config.mjs` accepts `NWE_BUILD_GIT_COMMIT_SHA` before platform defaults so CI can explicitly embed the actual PR head while Vercel continues to use `VERCEL_GIT_COMMIT_SHA` normally.
- `world-viewer-vite` sets `NWE_BUILD_GIT_COMMIT_SHA=${{ github.event.pull_request.head.sha || github.sha }}` for both the production build and profile assertion.
- `browserArtifactProfile.mjs` now exports a single `PROFILE_MAX_ITERATIONS=101` boundary. 101 total samples yields exactly 100 steady-state samples after the separated first replay, which is the minimum already required by the profiler's p99 evidence classifier.
- browser entry and smoke harness share that upper-bound intent; the focused regression accepts 101 and rejects 102.
- CI now runs the exact-real browser profile with 101 iterations and a 120 s harness timeout, then uploads the exact-head JSON report.

## Calibration evidence

The first execution gate itself passed on workflow run `32236092213`: accepted road/building identities, full production `RUNTIME_VERIFICATION_PASS`, isolated replay PASS and zero raw-source calls. That run also demonstrated why the explicit head binding is necessary: the embedded identity was the synthetic merge commit, so it is retained only as integration evidence rather than exact branch-head evidence.

A subsequent run after attempting to override the reserved `GITHUB_SHA` still embedded the synthetic merge SHA. The implementation therefore moved to the dedicated `NWE_BUILD_GIT_COMMIT_SHA` input rather than relying on mutation of GitHub's default context.

The earlier five-iteration exact-head CI result remains diagnostic: verification was sub-millisecond while road decode/`JSON.parse` showed greater variance, but four steady-state samples could not support p95/p99. The new 101-iteration gate is specifically designed to test whether that signal survives enough steady-state samples to satisfy the existing p99 sample-count rule. It does not pre-judge the result.

## Evidence boundary

This is hosted/headless Chrome browser-runtime evidence. It profiles the accepted compiled road/building artifact path and replays full RuntimeVerificationBundle verification against already-fetched bytes to separate verification, UTF-8 decode and `JSON.parse`. It is not Android/mobile evidence, does not measure raw-source acquisition and cannot select WebGPU/WebGL/Cesium architecture.

A `SUPPORTED` percentile classification means only that the configured minimum sample count has been met. It does not by itself prove causal attribution, cross-device stability or that a worker/cache optimization is beneficial. Any architecture/policy change still requires a separate reversible experiment and SENTINEL/STRØM review.

## Acceptance

The PR is acceptable only if final exact-head `world-viewer-vite` proves that the embedded `git_commit_sha` equals the actual PR branch head, executes the 101-iteration browser profile successfully, retains `RUNTIME_VERIFICATION_PASS` for accepted artifacts and keeps raw-source calls at zero together with the existing renderer, movement/cache/resource-lifecycle and worker gates. Vercel Preview must be checked separately against the exact PR head when available.
