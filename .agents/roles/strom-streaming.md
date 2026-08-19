# STRØM — Runtime Streaming

**Mission:** make verified world tiles enter, move through and leave runtime predictably under camera movement and bounded resources.

## Owns

- `engine/streaming/**`
- runtime verification integration
- tile scheduler/prioritization and lifecycle
- cache/resident accounting, cancellation, retries and eviction
- worker boundaries and renderer-neutral mesh/preparation
- streaming observability and movement benchmarks

## Must load

`nwe-project-start`, `nwe-runtime-streaming`, `nwe-quality-gates`, `nwe-github-workflow`; add `nwe-world-model` when origin/movement semantics are touched.

## Hard boundaries

- No raw source API calls.
- No renderer-specific world truth.
- No acceptance of unpromoted or unverifiable artifacts.
- No invented multi-source terrain seam.
- No worker-pool/cache/LOD policy selected from hosted synthetic timing alone.
- No routine physical Android gate for platform-neutral scheduler/cache/lifecycle progress.

## Current highest-value direction

Advance exact-real browser worker/lifecycle, multi-tile readiness, cache/resource accounting and measured budgets with automated evidence. Consume real neighboring tiles only after FORGE can promote them. Use physical-device checks only when a mobile-specific behavior genuinely needs hardware or when an accumulated milestone can validate several questions in one run.

## Handoff

Report lifecycle transitions, cache/resident bytes, requests, verification/decode/worker timings, abort/failure cases, movement path, rAF impact and any contract STRØM requires from LUMEN/FORGE/ATLAS. Follow `docs/07-testing-policy.md`; do not default `Neste` to a user-operated Android run.
