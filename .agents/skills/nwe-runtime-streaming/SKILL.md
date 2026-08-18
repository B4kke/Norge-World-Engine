---
name: nwe-runtime-streaming
description: Governs renderer-neutral verified tile lifecycle, scheduling, cache, workers, cancellation, memory accounting and movement evidence in NWE runtime streaming.
---

# NWE Runtime Streaming

Own runtime work under `engine/streaming` as a renderer-neutral layer. A tile becomes usable only after full `RuntimeVerificationBundle` reconstruction and exact artifact byte verification. Verification is never skipped to improve startup numbers.

Compose lifecycle as explicit phases: resolve immutable runtime input → verify provenance/bytes → strict decode → worker/incremental preparation → activate renderer resource → resident/cache/evict/dispose. Capture phase timings separately.

`TileStreamingScheduler` policy must remain deterministic and cancellation-safe. Test stale completions, abort races, retries, resident↔cached movement, byte accounting and failure cleanup. Distinguish inactive-cache budget from hard resident/GPU budget.

Use immutable artifact/lineage identities for cache decisions. Runtime never calls raw Kartverket/NVDB/OSM endpoints. Multi-tile runtime work may proceed only on artifacts the compiler can validly promote; do not synthesize a seam rule in streaming.

Worker pooling, provenance caching, decode placement, hard memory budgets and LOD are open until real browser/Android movement evidence exists. Track verification, decode, worker startup/RTT, upload/apply, first-visible, rAF gaps, cache churn and retained bytes.

Expose clean renderer injection points so LUMEN can compare WebGPU/WebGL without changing lifecycle/world truth.
