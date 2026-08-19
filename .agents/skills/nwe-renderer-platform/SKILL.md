---
name: nwe-renderer-platform
description: Guides the NWE deployable web renderer, WebGPU/WebGL experiments, GPU instrumentation and exact-commit Vercel Preview while preserving artifact-only world truth.
---

# NWE Renderer & Web Platform

Primary surface: `apps/world-viewer`. Vite and Vercel are delivery/measurement infrastructure, **not** a selected renderer architecture.

The renderer consumes only runtime-verified compiled artifacts through the shared browser/runtime boundaries. It must never fetch Kartverket, NVDB, OSM/Overpass or other authoritative raw-source endpoints. Full provenance verification happens before geometry/resource creation.

Treat **WebGPU as the primary candidate experiment** for the GPU-first web direction, with a WebGL2 fallback/baseline where practical. Do not declare WebGPU, Three.js, Cesium or a custom renderer selected until comparable evidence justifies it. Keep backend interfaces replaceable.

Measure backend/capability, artifact verification/decode, worker cost, GPU upload/apply, input→first-visible, frame p50/p95/p99, largest rAF gap, draw calls, triangles/vertices, retained bytes, resource disposal and movement/streaming behavior. Hosted/headless results are directional for device-specific claims, but they remain valid automated evidence for browser/runtime integration.

Preserve world/render separation: high-precision world state and origin epochs come from `nwe-world-model`; lifecycle/caching comes from `nwe-runtime-streaming`. Renderer-local Float32 buffers are disposable derivatives.

For every renderer PR:
- production build must pass;
- browser smoke/benchmark must use explicit real vs synthetic labels;
- when deployment access exists, create or confirm a Vercel Preview for the exact branch commit and smoke-check it;
- do not promote production without explicit user request;
- keep visual polish behind correctness/streaming/performance gates unless it directly improves QA;
- do **not** require a fresh physical Android run by default.

Physical Android/mobile testing follows `docs/07-testing-policy.md`: use it only for device-specific claims or occasional accumulated milestones, and batch several questions into one run. A renderer PR may progress on automated/hosted/browser evidence without forcing user-operated handset testing.

A pretty scene with wrong provenance, coordinates or source access is a failed renderer.
