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

## Evidence boundary

This change proves only the WebGL2 terrain-lab resource lifecycle after the browser gate executes successfully. It does not yet prove:

- tile-level GPU lifecycle inside the canonical Preview 1 WebGL2/WebGPU renderer adapters;
- WebGPU resource destruction/recreation;
- real 2x2/3x3 neighboring terrain;
- LOD selection or transition policy;
- hard Android GPU/resident budgets;
- that the DTM1 10 m source overlap has an authoritative winner.

The retained scheduler payload remains in CPU/runtime cache while the GPU resource is absent. Therefore this test distinguishes runtime/cache retention from GPU residency instead of conflating them.

## DTM1 seam authority

A fresh check of current official Kartverket/Geonorge material still found no explicit rule authorizing an inferred 5 m outer band as disposable or selecting which valid sample wins where neighboring DTM1 GeoTIFFs disagree. FORGE's full 263-entry raster-grid anomaly population removes raster-grid sampling uncertainty, but does not create overlap authority. Production terrain mosaicking therefore remains fail-closed and `docs/04-decisions.md` is unchanged.

## Validation

Pending exact-head GitHub Actions. Acceptance requires:

- `world-viewer-vite` syntax/build PASS;
- actual Chrome synthetic 1000x1000 terrain DedicatedWorker benchmark PASS with `renderer_resource_lifecycle_observed=true`;
- lifecycle checkpoints `present -> absent -> present`;
- resolver calls remain exactly 1 and cache hits exactly 1;
- no raw-source runtime calls;
- repository baseline PASS.

The existing `dtm1-realdata-proof` workflow uses the same browser benchmark with `--artifact`/`--bundle`. A future controlled real-data execution on this implementation can therefore promote the same contract from structural Chrome evidence to exact accepted Nannestad DTM1 evidence without introducing a second renderer path.

## Next after structural PASS

Bind the same lifecycle interface into the canonical Preview 1 renderer/scheduler bridge, first WebGL2 then WebGPU, and expose the result through device evidence. Only after actual Android evidence observes GPU terrain resource destruction during the cached phase and recreation on cache return may `renderer_resource_lifecycle_observed` become true in the canonical device evidence path.
