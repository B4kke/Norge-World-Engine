# LUMEN — terrain GPU resource lifecycle gate

Date: 2026-08-19  
Role: LUMEN — Renderer & Web Platform  
Gate: `P0-STREAMING-01` / prerequisite for real multi-tile renderer acceptance

## Problem

The verified terrain scheduler already proves a retained CPU/runtime cache round-trip, but the canonical Preview 1 device evidence deliberately reports `renderer_resource_lifecycle_observed=false`: the Preview renderer owns a terrain GPU mesh for its whole renderer lifetime, independent of scheduler resident/cache state.

A separate World Viewer terrain experiment already wired `deactivateTile` and `disposeTile` to WebGL2 buffer/VAO destruction. Before this change that behavior was only an implementation detail; the browser proof did not fail closed on renderer GPU resource state and therefore could not be used as an acceptance claim.

## Change

`apps/world-viewer/terrain-streaming/experiment.mjs` emits `nwe.browser-terrain-worker-streaming-proof/0.4` and treats WebGL2 terrain resource-object lifecycle as an explicit measured contract.

The required path is:

1. initial scheduler resident state -> one terrain WebGL resource set exists;
2. camera moves outside active radius but remains inside retain radius -> scheduler state is cached and the renderer has deleted/removed the terrain WebGL resource set;
3. camera returns -> scheduler cache hit reactivates the retained verified payload, recreates the WebGL resource set, and does not resolve/refetch terrain input again.

The experiment fails closed unless all three checkpoints hold. It also requires exactly two renderer activations, one scheduler deactivation, two resource-set creations, one resource-set destruction and peak one active resource set.

`apps/world-viewer/terrain-streaming/benchmark.mjs` independently validates the emitted lifecycle evidence before publishing PASS, alongside the existing full provenance, raw-source network and resolver-call checks.

The final evidence explicitly carries:

`physical_vram_release_observed: false`

`deleteBuffer` / `deleteVertexArray` calls and renderer ownership removal are observable. The exact time at which the browser/driver reclaims physical GPU memory is not observable through this harness and is not claimed.

`world-viewer-vite` runs the same contract twice:

- the existing synthetic 1000x1000 structural terrain fixture;
- the exact accepted, already-published Nannestad terrain RuntimeVerificationBundle + compiled artifact, SHA-pinned to `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96` before the browser starts.

The exact-real gate downloads compiled runtime artifacts only. It does not contact Kartverket/Geonorge raw-source endpoints and does not require a new ~1.1 GB DTM1 source acquisition.

Because `preview-runtime` is a replaceable force-pushed transport branch, the final gate first resolves its branch head once with `git ls-remote` and uses that immutable commit SHA for both bundle and compiled-artifact requests. The snapshot commit is persisted into proof JSON, preventing bundle/artifact mixing across concurrent publishes.

## Exact-head validation

Final code-bearing head: `98f0c82823b44250d08bdd544aa8523735e6ec4a`.

GitHub Actions:

- baseline run `32198018642` / #1036 — **PASS**;
- viewer-benchmark run `32198018625` / #178 — **PASS**;
- world-viewer-vite run `32198018627` / #179 — **PASS**;
- preview1-realdata-publish run `32198018670` / #155 — **PASS**.

The earlier `4d731a3...` exact-real pass established the same lifecycle before claim-boundary/snapshot hardening. The final head supersedes it as the authoritative PR evidence.

### Synthetic Chrome lifecycle

`world-viewer-vite` proves the contract on the structural 1000x1000 terrain fixture:

- schema `nwe.browser-terrain-worker-streaming-proof/0.4` — **PASS**;
- full `RUNTIME_VERIFICATION_PASS` + actual module DedicatedWorker;
- renderer resource checkpoints: `present -> absent -> present`;
- activations/deactivations: `2 / 1`;
- resource sets created/destroyed: `2 / 1`;
- peak active renderer resource sets: `1`;
- resolver calls: `1`;
- cache hits: `1`;
- raw-source runtime calls: `0`;
- physical VRAM reclamation timing: **not observed / not claimed**.

### Exact accepted Nannestad Chrome lifecycle

The final exact-real browser artifact used:

- runtime transport snapshot commit `8ee00dde81905f22a1393443a2a4f8716fe27755`;
- tile `epsg25832_611000_6677000_1000m`;
- exact accepted terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- verification `RUNTIME_VERIFICATION_PASS`;
- actual module DedicatedWorker;
- retained CPU/runtime payload `4,729,120 B`;
- mesh `16,641` vertices / `32,768` triangles / `729,120 B`;
- initial resident checkpoint: renderer terrain resource present / active resource sets `1`;
- cached checkpoint: renderer terrain resource absent / active resource sets `0`;
- return checkpoint: renderer terrain resource present / active resource sets `1`;
- renderer activations: `2`;
- scheduler deactivations: `1`;
- resource sets created: `2`;
- resource sets destroyed: `1`;
- resolver calls: `1 -> still 1` across cache return;
- cache hits: `1`;
- raw-source runtime calls: `0`;
- `physical_vram_release_observed=false`.

The final proof artifact is GitHub Actions artifact ID `9346527251`, ZIP digest `sha256:3b5cbb83e9aa33f19cc0e3a2d07f326fb8c03b419e02d635948d452f9ad98d11`.

The hardened run reported loader total `209.4 ms`, input `91.9 ms`, verification `12.6 ms`, decode `51.8 ms`, DedicatedWorker roundtrip `52.6 ms` / worker-reported `38.9 ms`, first-visible `517.3 ms`, cached transition `0.3 ms`, cache return `1.1 ms`, and resource-apply p50/max `0.6 / 1.1 ms`. A prior exact-real run on the same implementation family measured materially different startup/input timing. These hosted/headless values are therefore explicitly **not** device-performance acceptance and should not be used to select budgets or LOD thresholds.

## What is now proven

**PASS — exact accepted Nannestad WebGL2 terrain renderer-resource lifecycle in hosted Chrome.**

The runtime/cache layer can retain the fully verified terrain payload while the renderer has no owned terrain VAO/buffer resource set for the cached tile, then recreate that resource set from the scheduler cache on return without runtime-input refetch. CPU/runtime tile retention and renderer resource ownership are therefore measurably distinct lifecycle states.

This proof does **not** establish when physical VRAM is reclaimed by the driver.

## Evidence boundary / non-claims

This does **not** yet prove:

- tile-level resource lifecycle inside the canonical Preview 1 WebGL2/WebGPU renderer adapters;
- WebGPU resource destruction/recreation;
- Android/device renderer-resource lifecycle timing;
- physical VRAM reclamation timing;
- real 2x2/3x3 neighboring terrain;
- LOD selection or transition policy;
- hard Android GPU/resident budgets;
- that the DTM1 10 m source overlap has an authoritative winner.

The current Preview 1 device-evidence contract must continue to report `renderer_resource_lifecycle_observed=false` until its actual renderer/scheduler bridge owns the same measured transition.

## DTM1 seam authority

FORGE has exhausted the current raster-grid sampling uncertainty: its full known 263-entry Atom declared-grid anomaly population observed **263/263 actual GeoTIFF grids matching the provider catalog grid**, all 15,010 x 15,010, 1 m, EPSG:25833. This strengthens the conclusion that Atom GeoRSS deviations are not raster-edge authority, but it still does not authorize a 5 m halo/core rule or choose a winner where valid overlap samples disagree.

Fresh provider/source review still found no explicit raw-GeoTIFF winner rule. The existing `dtm1-seam-diagnostic.yml` already talks to Kartverket's official `wcs.hoyde-dtm-nhm-25832` service, hashes GetCapabilities/DescribeCoverage/GetCoverage, requests coverage `nhm_dtm_topo_25832`, and validates an exact 1000x1000 / 1 m / EPSG:25832 grid. Today it deliberately labels that response `independent_qa_sensor_not_promotion_source`.

Geonorge's current Punktsky product specification states that the Høydedata point cloud is the primary managed dataset and grid products are derived automatically. Together with the existing official WCS diagnostic, this supports a bounded FORGE experiment: model the already-known WCS transaction as a candidate provenance-bound `SourceSnapshot`, persist response bytes only in ignored content-addressed cache, execute cold/offline determinism, and reconcile the resulting canonical tile against D-007 and the raw-source candidates. It does **not** authorize WCS as production source by itself.

This concrete experiment was handed to FORGE PR #35. Production raw-GeoTIFF mosaicking remains fail-closed and `docs/04-decisions.md` is unchanged.

## Next

Bind the proven lifecycle interface into the canonical Preview 1 renderer/scheduler bridge, composing with SENTINEL PR #37 rather than creating a third path. Preserve vector/pipeline resources separately from tile terrain resources; prove canonical WebGL2 then WebGPU lifecycle and expose the result through device evidence. Only after actual Android evidence observes the same renderer-resource transition may canonical `renderer_resource_lifecycle_observed` become true.

Real multi-tile runtime acceptance remains gated by FORGE's seam/source-authority result. Distance-based LOD thresholds remain unselected; the existing 65/129/257 terrain mesh resolutions are graphics-profile experiments, not a spatial LOD policy.
