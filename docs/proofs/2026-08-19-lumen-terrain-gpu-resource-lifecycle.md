# LUMEN — terrain GPU resource lifecycle gate

Date: 2026-08-19  
Role: LUMEN — Renderer & Web Platform  
Gate: `P0-STREAMING-01` / prerequisite for real multi-tile renderer acceptance

## Problem

The verified terrain scheduler already proves a retained CPU/runtime cache round-trip, but the canonical Preview 1 device evidence deliberately reports `renderer_resource_lifecycle_observed=false`: the Preview renderer owns a terrain GPU mesh for its whole renderer lifetime, independent of scheduler resident/cache state.

A separate World Viewer terrain experiment already wired `deactivateTile` and `disposeTile` to WebGL2 buffer/VAO destruction. Before this change that behavior was only an implementation detail; the browser proof did not fail closed on GPU resource state and therefore could not be used as an acceptance claim.

## Change

`apps/world-viewer/terrain-streaming/experiment.mjs` now emits `nwe.browser-terrain-worker-streaming-proof/0.4` and treats the WebGL2 terrain resource lifecycle as an explicit measured contract.

The required path is:

1. initial scheduler resident state -> one terrain GPU resource set exists;
2. camera moves outside active radius but remains inside retain radius -> scheduler state is cached and the terrain GPU resource set has been destroyed;
3. camera returns -> scheduler cache hit reactivates the retained verified payload, recreates the GPU resource set, and does not resolve/refetch terrain input again.

The experiment fails closed unless all three checkpoints hold. It also requires exactly two renderer activations, one scheduler deactivation, two GPU resource-set creations, one resource-set destruction and peak one active resource set.

`apps/world-viewer/terrain-streaming/benchmark.mjs` independently validates the emitted lifecycle evidence before publishing PASS, alongside the existing full provenance, raw-source network and resolver-call checks.

`world-viewer-vite` now runs the same contract twice:

- the existing synthetic 1000x1000 structural terrain fixture;
- the exact accepted, already-published Nannestad terrain RuntimeVerificationBundle + compiled artifact, with SHA-256 pinned to `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96` before the browser starts.

The exact-real gate downloads compiled runtime artifacts only. It does not contact Kartverket/Geonorge raw-source endpoints and does not require a new ~1.1 GB DTM1 source acquisition.

## Exact-head validation

Code-bearing head: `4d731a3a2f91339ffc34a965e53688a41d3c006e`.

GitHub Actions:

- baseline run `32197334851` / #1017 — **PASS**;
- viewer-benchmark run `32197334838` / #173 — **PASS**;
- world-viewer-vite run `32197334844` / #174 — **PASS**;
- preview1-realdata-publish run `32197334944` / #150 — **PASS**.

### Synthetic Chrome lifecycle

`world-viewer-vite` first proved the contract on the structural 1000x1000 terrain fixture:

- schema `nwe.browser-terrain-worker-streaming-proof/0.4` — **PASS**;
- full `RUNTIME_VERIFICATION_PASS` + actual module DedicatedWorker;
- GPU checkpoints: `present -> absent -> present`;
- activations/deactivations: `2 / 1`;
- resource sets created/destroyed: `2 / 1`;
- peak active GPU resource sets: `1`;
- resolver calls: `1`;
- cache hits: `1`;
- raw-source runtime calls: `0`.

### Exact accepted Nannestad Chrome lifecycle

The second browser gate used exact accepted terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96` and independently passed:

- tile `epsg25832_611000_6677000_1000m`;
- verification: `RUNTIME_VERIFICATION_PASS`;
- actual module DedicatedWorker;
- retained CPU/runtime payload: `4,729,120 B`;
- mesh: `16,641` vertices / `32,768` triangles / `729,120 B`;
- initial resident checkpoint: GPU resource present / active resource sets `1`;
- cached checkpoint: GPU resource absent / active resource sets `0`;
- return checkpoint: GPU resource present / active resource sets `1`;
- renderer activations: `2`;
- scheduler deactivations: `1`;
- GPU resource sets created: `2`;
- GPU resource sets destroyed: `1`;
- resolver calls: `1 -> still 1` across cache return;
- cache hits: `1`;
- raw-source runtime calls: `0`.

Hosted Chrome timing for this exact-real lifecycle execution is structural/directional only:

- terrain loader total: `149.0 ms`;
- runtime input: `28.1 ms`;
- full verification: `7.0 ms`;
- strict decode: `49.7 ms`;
- DedicatedWorker roundtrip: `63.9 ms` / worker-reported `44.1 ms`;
- initial input -> first visible: `230.1 ms`;
- cache exit -> cached idle: `0.4 ms`;
- cache return -> resident idle: `2.7 ms`;
- GPU apply over two activations: p50 `0.5 ms`, max `0.9 ms`.

The uploaded exact-real lifecycle artifact is GitHub Actions artifact ID `9346309316`, ZIP digest `sha256:919d76660d4ce77783b252515ecc40931805243a867440c3888458ecfee7f3f0`.

## What is now proven

**PASS — exact accepted Nannestad WebGL2 terrain GPU resource lifecycle in hosted Chrome.**

The runtime/cache layer can retain the fully verified terrain payload while renderer GPU resources are released when the tile leaves the active radius and recreated from the scheduler cache on return without runtime-input refetch. CPU/runtime residency and GPU residency are therefore measurably distinct lifecycle states.

## Evidence boundary / non-claims

This does **not** yet prove:

- tile-level GPU lifecycle inside the canonical Preview 1 WebGL2/WebGPU renderer adapters;
- WebGPU resource destruction/recreation;
- Android/device GPU lifecycle timing;
- real 2x2/3x3 neighboring terrain;
- LOD selection or transition policy;
- hard Android GPU/resident budgets;
- that the DTM1 10 m source overlap has an authoritative winner.

The current Preview 1 device-evidence contract must continue to report `renderer_resource_lifecycle_observed=false` until its actual renderer/scheduler bridge owns the same measured transition.

## DTM1 seam authority

FORGE has now exhausted the current raster-grid sampling uncertainty: its full known 263-entry Atom declared-grid anomaly population observed **263/263 actual GeoTIFF grids matching the provider catalog grid**, all 15,010 x 15,010, 1 m, EPSG:25833. This strengthens the conclusion that Atom GeoRSS deviations are not raster-edge authority, but it still does not authorize a 5 m halo/core rule or choose a winner where valid overlap samples disagree.

A fresh primary-source check found an important provider fact in Geonorge's `Produktspesifikasjon: Punktsky 1.0.3`, Appendix B: Høydedata's point cloud is the primary FvL dataset and grid products are derived automatically; the specification explicitly notes that missing manual editing can produce artifacts in project and national grids. Kartverket also exposes the national DTM through official WCS/API services. This supports a new FORGE hypothesis — evaluate the official seamless DTM/WCS as a separately snapshot-able source contract — but it does **not** itself select WCS or resolve raw-GeoTIFF overlap authority.

The hypothesis was handed to FORGE PR #35 for source-contract evaluation. Production raw-GeoTIFF mosaicking remains fail-closed and `docs/04-decisions.md` is unchanged.

## Next

Bind the proven lifecycle interface into the canonical Preview 1 renderer/scheduler bridge, first WebGL2 then WebGPU, and expose the result through device evidence. Only after actual Android evidence observes terrain GPU resource destruction during the cached phase and recreation on cache return may canonical `renderer_resource_lifecycle_observed` become true.

Real multi-tile runtime acceptance remains gated by FORGE's seam/source-authority result. Distance-based LOD thresholds remain unselected; the existing 65/129/257 terrain mesh resolutions are graphics-profile experiments, not a spatial LOD policy.
