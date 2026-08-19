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

The resulting 100-sample exact-head run then exposed the next evidence-backed question: road `JSON.parse`/decode tail remained materially larger than full RuntimeVerificationBundle replay, while buildings did not show the same tail. That observation justifies a scheduling experiment, not an immediate worker/cache policy.

## Change

- `browserArtifactProfileEntry.mjs` accepts an optional same-origin `/__profile_report` callback used only by the CI harness.
- The callback rejects cross-origin or unexpected report targets before posting evidence.
- `run_browser_artifact_profile_smoke.mjs` serves the production `dist`, launches headless Chrome, receives the report and fails closed unless report/build/artifact/provenance/raw-source conditions pass.
- `vite.config.mjs` accepts `NWE_BUILD_GIT_COMMIT_SHA` before platform defaults so CI can explicitly embed the actual PR head while Vercel continues to use `VERCEL_GIT_COMMIT_SHA` normally.
- `world-viewer-vite` sets `NWE_BUILD_GIT_COMMIT_SHA=${{ github.event.pull_request.head.sha || github.sha }}` for both the production build and profile assertion.
- `browserArtifactProfile.mjs` exports a single `PROFILE_MAX_ITERATIONS=101` boundary. 101 total samples yields exactly 100 steady-state samples after the separated first replay, which is the minimum already required by the profiler's p99 evidence classifier.
- browser entry and smoke harness share that upper-bound intent; the focused regression accepts 101 and rejects 102.
- CI runs the exact-real browser profile with 101 iterations and a 120 s harness timeout, then uploads the exact-head JSON report.
- `browserDecodePlacementExperiment.mjs` adds a bounded road-only browser scheduling experiment on the same already-verified artifact bytes: 20 main-thread UTF-8+`JSON.parse` iterations versus 20 module-Worker roundtrips.
- the Worker path copies/transfers input bytes, performs strict UTF-8 + `JSON.parse` in the Worker and structured-clones the parsed object back, so roundtrip timing includes the costs that a practical off-main-thread placement must pay rather than measuring parse alone.
- rAF-gap monitoring runs around both placements; the experiment remains explicitly `experiment_only=true` and `production_policy_selected=false`.
- `test_browser_decode_placement.mjs` covers iteration bounds, Worker-compatible execution, artifact identity propagation and claim-boundary fields; the ordinary viewer production build runs this regression.
- the exact-real Chrome smoke now fails closed unless the road placement experiment ran 20/20 samples and produced rAF observations for both placements.

## Calibration evidence

The first execution gate itself passed on workflow run `32236092213`: accepted road/building identities, full production `RUNTIME_VERIFICATION_PASS`, isolated replay PASS and zero raw-source calls. That run also demonstrated why the explicit head binding is necessary: the embedded identity was the synthetic merge commit, so it is retained only as integration evidence rather than exact branch-head evidence.

A subsequent run after attempting to override the reserved `GITHUB_SHA` still embedded the synthetic merge SHA. The implementation therefore moved to the dedicated `NWE_BUILD_GIT_COMMIT_SHA` input rather than relying on mutation of GitHub's default context.

The accepted 101-iteration run on branch head `65b08954a100c6a939bb837715564fba29f8402e` produced 100 steady-state samples. Roads measured verification p95/p99 `0.30 / 0.825 ms` versus combined decode p95/p99 `3.155 / 9.615 ms`, with an observed decode maximum of `40.80 ms`. Buildings measured combined decode p95/p99 only `0.20 / 0.201 ms`. The road tail therefore survived the larger controlled sample and is now the basis for the decode-placement experiment.

The placement experiment is deliberately the next hypothesis test: if Worker roundtrip reduces main-thread/rAF disruption despite copy, scheduling and structured-clone costs, a later STRØM/SENTINEL-owned runtime integration experiment may be justified. If it does not, the project avoids adopting worker complexity from a parse-only microbenchmark.

## Evidence boundary

This is hosted/headless Chrome browser-runtime evidence. It profiles the accepted compiled road/building artifact path and replays full RuntimeVerificationBundle verification against already-fetched bytes to separate verification, UTF-8 decode and `JSON.parse`. It is not Android/mobile evidence, does not measure raw-source acquisition and cannot select WebGPU/WebGL/Cesium architecture.

The decode-placement experiment receives bytes only after the ordinary production artifact consumer has returned `RUNTIME_VERIFICATION_PASS`. It intentionally does **not** re-run, cache, weaken or replace provenance verification. Its Worker result is an experiment, not world truth and not a selected `engine/streaming` policy. A Worker win must still be checked end-to-end against first-visible/frame behavior and reviewed by STRØM/SENTINEL before runtime policy changes.

A `SUPPORTED` percentile classification means only that the configured minimum sample count has been met. It does not by itself prove causal attribution, cross-device stability or that a worker/cache optimization is beneficial. Any architecture/policy change still requires a separate reversible experiment and SENTINEL/STRØM review.

## Acceptance

The PR is acceptable only if final exact-head `world-viewer-vite` proves that the embedded `git_commit_sha` equals the actual PR branch head, executes the 101-iteration browser profile successfully, retains `RUNTIME_VERIFICATION_PASS` for accepted artifacts, keeps raw-source calls at zero, and executes the bounded road main-thread-vs-Worker placement experiment together with the existing renderer, movement/cache/resource-lifecycle and worker gates. Vercel Preview must be checked separately against the exact PR head when available.
