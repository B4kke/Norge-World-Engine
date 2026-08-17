# 04 — Decisions

Only decisions with evidence belong here. Open questions remain explicitly open.

## D-001 — GitHub is canonical implementation surface

**Status:** Accepted — 2026-08-17  
**Decision:** New code, tests, schemas, CI, implementation history and tasks live in GitHub. Google Drive remains long-form research/history/reference.  
**Reason:** implementation needs reviewable diffs, branches, CI and reproducible repository state.  
**Consequence:** old “Drive-first” instructions are historical for implementation work; Drive code copies are migration sources only.

## D-002 — Engine-independent world compiler boundary

**Status:** Accepted for Prototype 0 direction; runtime choice remains open.  
**Decision:** preprocessing emits engine-independent runtime artifacts/contracts. Unreal, WebGPU and other render/runtime candidates consume this boundary rather than owning source ingestion.  
**Reason:** avoids premature engine lock-in and keeps data/compiler reusable.

## D-003 — Nannestad normalization hypothesis

**Status:** Verified for Prototype 0; not a whole-Norway final policy.  
**Decision:** use EPSG:25832 horizontally and explicit NN2000 vertical datum for the Nannestad prototype where supported by source contracts.  
**Evidence:** existing source-contract verifier/Drive research; round-trip proof is stored under `tests/fixtures/`.

## D-004 — Runtime-verifiable provenance

**Status:** Contract accepted; implementation pending.  
**Decision:** provenance objects use versioned schemas, RFC 8785/JCS canonicalization and SHA-256; runtime reconstructs the hash chain rather than trusting supplied lineage strings or PASS flags.  
**Source authority:** Drive `02.7 – RuntimeVerificationBundle + SpatialIndex Contract v0.1` until ported to versioned repo schemas/tests.

## D-005 — GeoRSS polygon selection

**Status:** Contract accepted; implementation pending.  
**Decision:** an actual GeoRSS polygon requires an actual geometry predicate. A bounding box may only prefilter. Prototype-0 policy is boundary-inclusive source polygon covering target tile polygon, with explicit CRS/axis-order handling and fail-closed ambiguity.

## Open decisions

- Whole-Norway coordinate/tile indexing strategy.
- Exact compiled terrain/mesh format and 3D Tiles-like vs custom/hybrid streaming format.
- Three.js/WebGPU vs other web renderer details after real artifact measurement.
- Unreal role after engine-independent import/streaming evidence.
- Client/worker/server split for simulation.
- FKB access/redistribution strategy and production imagery source/license.
