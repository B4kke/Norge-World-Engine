# LUMEN browser provenance + decode profile

## Purpose

Advance the automated browser/performance part of `P0-VIEWER-01` and the open profiling follow-up under `P0-PROVENANCE-02` without weakening runtime verification or requiring a physical handset run.

The accepted Nannestad road/building browser path previously showed verification/decode costs large enough to justify a more isolated measurement. The deployable profiler added here keeps the normal production load intact, then replays the same shared `verifyRuntimeBundleWeb` verifier against the already-fetched compiled bytes so verification time can be separated from strict UTF-8 decoding and `JSON.parse` time.

## Implemented

- `apps/world-viewer/browser-artifact-profile.html` is a deployable Vite measurement page.
- It loads the accepted Preview manifest and only the compiled road/building RuntimeVerificationBundle + artifact transports.
- Every production layer load still uses `loadCompiledJsonArtifact`, including pre-fetch raw-source transport guards and the full shared RuntimeVerificationBundle reconstruction before JSON use.
- After that PASS, `profileVerifiedJsonArtifact` re-runs the same shared browser verifier on the in-memory artifact bytes and separately measures strict UTF-8 byte-to-text decoding and `JSON.parse`.
- The profile schema is `nwe.browser-artifact-profile/0.3`. The decode phase remains split into `utf8_decode_ms`, `json_parse_ms` and their aggregate `decode_ms`, and every summary carries explicit percentile-evidence calibration.
- The outer browser report is `nwe.browser-provenance-profile-report/0.2` and records a calibrated build binding: `EXACT_COMMIT_AND_DEPLOYMENT`, `EXACT_COMMIT_ONLY`, or `UNBOUND`.
- The report records exact artifact SHA-256 identities, artifact byte sizes, build/deployment identity, request URLs, production-load wall time and numeric p50/p95/p99/max for isolated verification, UTF-8 decode, JSON parse, aggregate decode and verification+decode.
- Numeric percentiles remain descriptive measurements. `percentile_evidence` separately states whether p50/p95/p99 have enough observations to be used as percentile claims: p50 requires at least 3 samples, p95 at least 20 and p99 at least 100; max is only classified as an observed sample maximum.
- The profiler remains bounded to 1..20 iterations and defaults to 5. Because the first replay is split from steady state, the current bounded profiler can never produce acceptance-grade steady-state p95 or p99 evidence. That is intentional: the page is diagnostic instrumentation, not a tail-latency acceptance benchmark.
- The first replay is reported separately from later steady-state samples. This prevents one-time JIT/WebCrypto/canonicalization/parser warm-up from being silently folded into repeat-cost evidence used to motivate cache/worker experiments.
- With one iteration, `steady_state` is explicitly `null` instead of manufacturing a repeat-cost claim.
- Every measured verification/UTF-8/JSON-parse duration must be finite and non-negative. A backwards or non-finite clock fails closed with `PROFILE_INVALID_TIMING` instead of relying on the generic percentile helper, which otherwise filters invalid samples and could leave a misleading partial PASS summary.
- Focused Node regressions cover deterministic phase timing, first-vs-steady-state classification, percentile evidence thresholds, build/deployment identity classification, single-iteration semantics, invalid iteration counts, verification rejection, invalid JSON, backwards timing and non-finite timing.

## Why the phase split matters

The previous profiler grouped `TextDecoder.decode()` and `JSON.parse()` into one number. That can identify a broad decode bottleneck, but it cannot tell whether repeated cost is dominated by byte-to-text conversion or object construction/parsing. Those paths have different optimization and worker-placement implications. The profiler exposes the distinction without changing production behavior.

This still does not justify a worker/cache policy. It only makes the next automated evidence more diagnostic and reduces the chance of optimizing the wrong phase.

## Percentile evidence boundary

The earlier profiler emitted p95/p99 for every non-empty sample set. With the default five iterations, steady state contains only four observations; presenting a p99 from four samples is a numerical interpolation/result, not strong tail-latency evidence. The same problem applies to p95 at very small N.

Schema `0.3` keeps the measured percentile values for transparency but adds an explicit evidence classification based on sample count. This prevents a small diagnostic run from being silently upgraded into a tail-performance claim. The thresholds are deliberately simple minimum-observation gates rather than a statistical confidence model: they calibrate claims, they do not claim confidence intervals or population-level guarantees.

The current 20-iteration cap means steady-state p95/p99 remain `INSUFFICIENT_SAMPLES`. If tail latency becomes a real acceptance gate, it should get a separate benchmark design with a larger controlled sample population, fixed browser/artifact/build context and its own regression/CI budget rather than stretching this diagnostic page into a different tool.

## Timing integrity boundary

`performance.now()` is expected to be monotonic in the browser path, but evidence code should not silently normalize an impossible sample. The shared summary helper intentionally filters invalid frame-gap input for renderer telemetry; that behavior is inappropriate as the only guard for a profiler whose `status: PASS` is later used to motivate architecture experiments. The profiler therefore validates each phase duration before a sample can enter the result set.

This does not claim improved performance. It only prevents corrupted timing input from being represented as valid provenance/decode evidence.

## Exact-build evidence boundary

A profiler page can execute successfully from a local build, an unbound static host, a CI artifact or an exact branch deployment. Those contexts are not interchangeable. The outer report therefore classifies build identity separately from timing status.

A valid 40-hex Git commit produces `exact_commit_bound=true`; a non-empty deployment identity is tracked independently. `EXACT_COMMIT_AND_DEPLOYMENT` means both are present, `EXACT_COMMIT_ONLY` means the build is commit-bound but not deployment-bound, and `UNBOUND` means there is no valid exact commit identity even if a deployment-like string exists.

This does not make an `UNBOUND` profile invalid as a local diagnostic. It prevents that measurement from being presented as exact-commit hosted evidence. Vercel/Render deployment metadata remains delivery evidence only and does not upgrade browser timing into Android/device evidence.

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

The persistent LUMEN branch was synchronized without force to `main` `6329d908be2298c6413247c5a743953542e46b6b` through two-parent merge `d16c9b513bee5d311429f82757f4f224b6e10b75`. Incoming FORGE #54 changes are confined to compiler/proof territory and were preserved unchanged.

The build-binding hardening is implemented on code head `064d33abd213243fb13e4264b04749c2f1128907`. Exact-head CI and Vercel Preview evidence must be checked after the documentation update before integration. Until those complete, this proof claims implementation/regression coverage only, not hosted timing numbers or tail-latency acceptance.
