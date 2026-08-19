# LUMEN browser provenance + JSON decode profile

## Purpose

Advance the automated browser/performance part of `P0-VIEWER-01` and the open profiling follow-up under `P0-PROVENANCE-02` without weakening runtime verification or requiring a physical handset run.

The accepted Nannestad road/building browser path previously showed verification/decode costs large enough to justify a more isolated measurement. The deployable profiler added here keeps the normal production load intact, then replays the same shared `verifyRuntimeBundleWeb` verifier against the already-fetched compiled bytes so verification time can be separated from strict UTF-8 JSON decode time.

## Implemented

- `apps/world-viewer/browser-artifact-profile.html` is a deployable Vite measurement page.
- It loads the accepted Preview manifest and only the compiled road/building RuntimeVerificationBundle + artifact transports.
- Every production layer load still uses `loadCompiledJsonArtifact`, including pre-fetch raw-source transport guards and the full shared RuntimeVerificationBundle reconstruction before JSON use.
- After that PASS, `profileVerifiedJsonArtifact` re-runs the same shared browser verifier on the in-memory artifact bytes and separately measures strict UTF-8 JSON decode.
- The report records exact artifact SHA-256 identities, artifact byte sizes, build/deployment identity, request URLs, production-load wall time and p50/p95/p99/max for isolated verification, decode and their sum.
- The first replay is reported separately from later steady-state samples. This prevents one-time JIT/WebCrypto/canonicalization warm-up from being silently folded into repeat-cost evidence used to motivate cache/worker experiments.
- Iteration count is bounded to 1..20 and defaults to 5. With one iteration, `steady_state` is explicitly `null` instead of manufacturing a repeat-cost claim.
- Focused Node regressions cover deterministic timing separation, first-vs-steady-state classification, single-iteration semantics, invalid iteration counts, verification rejection and invalid JSON.

## Evidence boundary

This profiler is measurement instrumentation, not a verification cache and not a runtime fast path. It deliberately repeats verification after the production load; it never skips or substitutes the mandatory verification performed before artifact use.

The isolated replay excludes network fetch time and does not measure terrain worker cost, GPU upload, renderer frame time, Android behavior or WebGPU performance. Hosted results are browser/runtime evidence only and must not be promoted into device-specific claims.

First-replay and steady-state numbers answer different questions. The first replay can include one-time browser/JIT/crypto setup; later samples describe repeated in-page work only. Neither is, by itself, evidence that verification should be cached or moved to a worker. Any such policy remains STRØM/SENTINEL territory and needs a separate measured experiment that preserves the mandatory verification boundary.

No raw Kartverket, Geonorge, NVDB, OSM or Overpass endpoint is permitted through the profiler fetch wrapper. `raw_source_calls` can only be reported as 0 after the guarded production loads complete.

## Architecture / ownership

- No renderer architecture is selected.
- No RuntimeVerificationBundle semantics are changed.
- No STRØM scheduler/cache/worker policy is changed.
- No FORGE source/compiler behavior is changed.
- No ATLAS coordinate/origin policy is changed.
- `docs/04-decisions.md` remains unchanged.

## Validation state

The persistent LUMEN branch was synchronized without force to `main` `40d38f7ee22fa7051dd156204a3e6b37265a95dc` before this hardening. Exact-head CI and Vercel Preview evidence must be recorded on the PR before integration. Until those complete, this proof claims implementation/regression coverage only, not hosted timing numbers.
