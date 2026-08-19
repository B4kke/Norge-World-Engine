---
name: nwe-quality-gates
description: Enforces evidence classes, determinism, observability and adversarial QA across NWE compiler, provenance, streaming, browser renderer, Vercel preview and device performance.
---

# NWE Quality Gates

Separate **FACT**, **ASSUMPTION** and **EXPERIMENT**. Viewer appearance cannot upgrade an assumption to fact.

Classify evidence before claiming PASS:
1. unit/structural or synthetic regression;
2. hosted Node/CI runtime;
3. real desktop Chrome/browser path;
4. real Android/device path when the claim is specifically about Android/mobile behavior or performance.
Do not promote one class into another. A Vercel Preview proves deployability/smoke behavior, not Android GPU performance or world-data correctness. Conversely, absence of a fresh Android run does not invalidate platform-neutral compiler, world-model, provenance, scheduler or browser-runtime evidence.

Before implementation define observables: hashes, bytes, source/feature counts, cache hit/miss, verification/decode/worker/upload timings, first-visible, frame p50/p95/p99, largest rAF gap, draw calls, retained RAM/VRAM estimate and raw-source request count as relevant.

Prefer negative tests at dangerous boundaries: corrupt format, unknown CRS/datum, sentinel Z, conflicting multi-source overlap, mismatched digest/size, forged lineage, raw-source transport, bbox false positive, stale worker completion, cancellation race and failed promotion.

Fail closed for unknown authority or invalid lineage. Visual/debug fallback may render only if it remains explicitly non-authoritative.

For renderer comparisons use the same accepted artifact, camera path, backend/browser context and measurement window. Before closing a P0 gate, try to disprove the strongest claim with a cheap adversarial regression.

Follow `docs/07-testing-policy.md`: physical-device tests are scarce milestone evidence. Do not escalate every successful automated/browser change into a manual Android request. Ask for physical hardware only when the unresolved claim is device-specific, automation is insufficient, or a sufficiently large milestone can batch several questions into one run.
