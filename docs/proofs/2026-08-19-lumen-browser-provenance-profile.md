# LUMEN browser provenance + decode profile

## Purpose

Advance the automated browser/performance part of `P0-VIEWER-01` and the open profiling follow-up under `P0-PROVENANCE-02` without weakening runtime verification or requiring a physical handset run.

The accepted Nannestad road/building browser path previously showed verification/decode costs large enough to justify a more isolated measurement. The deployable profiler added here keeps the normal production load intact, then replays the same shared `verifyRuntimeBundleWeb` verifier against the already-fetched compiled bytes so verification time can be separated from strict UTF-8 decoding and `JSON.parse` time.

## Implemented

- `apps/world-viewer/browser-artifact-profile.html` is a deployable Vite measurement page.
- It loads the accepted Preview manifest and only the compiled road/building RuntimeVerificationBundle + artifact transports.
- Every production layer load still uses `loadCompiledJsonArtifact`, including pre-fetch raw-source transport guards and the full shared RuntimeVerificationBundle reconstruction before JSON use.
- After that PASS, `profileVerifiedJsonArtifact` re-runs the same shared browser verifier on the in-memory artifact bytes and separately measures strict UTF-8 byte-to-text decoding and `JSON.parse`.
- The profile schema is `nwe.browser-artifact-profile/0.2` because the decode phase is split into `utf8_decode_ms`, `json_parse_ms` and their backward-readable aggregate `decode_ms`.
- The report records exact artifact SHA-256 identities, artifact byte sizes, build/deployment identity, request URLs, production-load wall time and p50/p95/p99/max for isolated verification, UTF-8 decode, JSON parse, aggregate decode and verification+decode.
- The first replay is reported separately from later steady-state samples. This prevents one-time JIT/WebCrypto/canonicalization/parser warm-up from being silently folded into repeat-cost evidence used to motivate cache/worker experiments.
- Iteration count is bounded to 1..20 and defaults to 5. With one iteration, `steady_state` is explicitly `null` instead of manufacturing a repeat-cost claim.
- Every measured verification/UTF-8/JSON-parse duration must be finite and non-negative. A backwards or non-finite clock now fails closed with `PROFILE_INVALID_TIMING` instead of relying on the generic percentile helper, which otherwise filters invalid samples and could leave a misleading partial PASS summary.
- Focused Node regressions cover deterministic phase timing, first-vs-steady-state classification, single-iteration semantics, invalid iteration counts, verification rejection, invalid JSON, backwards timing and non-finite timing.

## Why the phase split matters

The previous profiler grouped `TextDecoder.decode()` and `JSON.parse()` into one number. That can identify a broad decode bottleneck, but it cannot tell whether repeated cost is dominated by byte-to-text conversion or object construction/parsing. Those paths have different optimization and worker-placement implications. The profiler exposes the distinction without changing production behavior.

This still does not justify a worker/cache policy. It only makes the next automated evidence more diagnostic and reduces the chance of optimizing the wrong phase.

## Timing integrity boundary

`performance.now()` is expected to be monotonic in the browser path, but evidence code should not silently normalize an impossible sample. The shared summary helper intentionally filters invalid frame-gap input for renderer telemetry; that behavior is inappropriate as the only guard for a profiler whose `status: PASS` is later used to motivate architecture experiments. The profiler therefore validates each phase duration before a sample can enter the result set.

This does not claim improved performance. It only prevents corrupted timing input from being represented as valid provenance/decode evidence.

## Evidence boundary

This profiler is measurement instrumentation, not a verification cache and not a runtime fast path. It deliberately repeats verification after the production load; it never skips or substitutes the mandatory verification performed before artifact use.

The isolated replay excludes network fetch time and does not measure terrain worker cost, GPU upload, renderer frame time, Android behavior or WebGPU performance. Hosted results are browser/runtime evidence only and must not be promoted into device-specific claims.

First-replay and steady-state numbers answer different questions. The first replay can include one-time browser/JIT/crypto/parser setup; later samples describe repeated in-page work only. Neither is, by itself, evidence that verification should be cached or moved to a worker. Any such policy remains STRØM/SENTINEL territory and needs a separate measured experiment that preserves the mandatory verification boundary.

No raw Kartverket, Geonorge, NVDB, OSM or Overpass endpoint is permitted through the profiler fetch wrapper. `raw_source_calls` can only be reported as 0 after the guarded production loads complete.

## Architecture / ownership

- No renderer architecture is selected.
- No RuntimeVerificationBundle semantics are changed.
- No STRØM scheduler/cache/worker policy is changed.
- No FORGE source/compiler behavior is changed.
- No ATLAS coordinate/origin policy is changed.
- `docs/04-decisions.md` remains unchanged.

## Validation state

The persistent LUMEN branch was synchronized without force to `main` `aeaab67e6be7d3fc41e1498f66e2f06767b61e6d` through two-parent merge `7d0789840b924c915ccc616e60f26ed0c43a6ef0`. The incoming FORGE #52 commit added only compiler/workflow/proof files, so no role-boundary conflict was resolved by LUMEN.

Exact-head CI and Vercel Preview evidence must be recorded on PR #50 before integration. Until those complete, this proof claims implementation/regression coverage only, not hosted timing numbers.
