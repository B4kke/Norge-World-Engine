# 06 — Task queue

Priority is evidence-driven. Do not close tasks from prose alone.

## Validation cadence

Physical Android/mobile testing follows `docs/07-testing-policy.md`: it is milestone-based, batched and infrequent. Missing fresh physical-device evidence blocks only claims that are specifically about mobile/device behavior or performance; it must not become the automatic `Next` item or block unrelated compiler, world-model, streaming, renderer or browser-runtime progress. Prefer automated CI, exact-artifact browser tests and reproducible benchmarks for ordinary development.

## P0 — Critical

### P0-COORDINATES-01 — World state vs render-local coordinates
**Status:** PRECISION + ORIGIN-SHIFT INVARIANTS PASS / WHOLE-NORWAY POLICY OPEN  
**Owner area:** `engine/world`, future simulation/runtime boundary  
**Done/evidence:** merged isolated precision and origin-shift experiments prove that absolute EPSG:25832-scale Float32 coordinates are too coarse for a high-quality renderer, while high-precision world state can remain independent of disposable render-local Float32 coordinates. The deterministic origin experiment ran **2,048 entities for 3,600 ticks with 29 render-origin shifts** and ended with exactly identical Float64 world positions and velocities versus a fixed-origin control; max local reconstruction error was **0.244141 mm**. A temporal regression proves that local-frame deltas across an origin shift are not physical motion: a 3 km origin shift can appear as ~180 km/s false velocity unless the origin epoch/delta is compensated.  
**Performance evidence:** hosted Node/V8 directional benchmark at 100k entities measured median ~0.279 ms Float64 world integration and ~0.218 ms Float32 local derivation/rederive. This is not browser/GPU/physics-engine acceptance evidence.  
**Open:** choose/measure the actual world coordinate model, render-origin anchor and shift threshold, origin epoch contract for temporal systems, and later physics/network interaction. Do not turn the prototype numbers into a whole-Norway threshold without relevant camera/physics evidence.

### P0-REALDATA-01 — Authoritative DTM1 terrain vertical
**Status:** MERGED / REAL-DATA COLD+OFFLINE + COMPILED ARTIFACT + RUNTIME + HISTORICAL ANDROID CONSUMER PASS  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** official Kartverket/Geonorge Atom service selects exactly one Nannestad DTM1 source, `33-125-117.tif`; raw source is 1,096,856,487 B, EPSG:25833 + NN2000, 1 m float32 with raw SHA `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`. Compiler streams it into content-addressed raw cache, explicitly warps it with Rasterio/GDAL to the fixed 1000 × 1000, 1 m EPSG:25832 + NN2000 Nannestad grid using bilinear resampling, and emits normalized SHA `95c8fcf6f93c8fbb0533d6a82d68416b773f9a146970e1ae85676d3ba41c2adf`.  
**Compiled artifact:** `nwe.terrain-height-grid-artifact/0.1`, 4,000,382 B / 1,000,000 float32 samples, SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`. Cold and source-network-free offline runs are byte-identical; runtime verifier returns `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`. Historical Android Forsøk 16 consumed that terrain artifact together with the proven vector artifacts and remains useful milestone evidence; it is not a recurring gate.  
**Proof:** `docs/proofs/2026-08-17-nannestad-dtm1-realdata.md` and `docs/proofs/2026-08-17-forsok16-android-runtime.md`.  
**Next:** single-tile terrain source/compiler/runtime integration is no longer the immediate blocker. Whole-Norway DTM acquisition/LOD format remains open.

### P0-MULTITILE-TERRAIN-01 — Real neighboring terrain promotion
**Status:** HIGHEST OPEN TERRAIN GATE / MULTI-TILE FOUNDATION MERGED / REAL SEAM POLICY OPEN  
**Owner area:** `engine/compiler`, `engine/streaming`  
**Done/evidence:** merged multi-tile foundation separates runtime 1 km tile identity from Kartverket source tiling, binds tile-specific cache/lineage, reuses exact SHA-addressed raw source objects, supports plural SourceSnapshot provenance and fails closed on ambiguous source coverage. Live Nannestad 3×3 source planning resolves **9 runtime tiles**, **2 unique DTM1 raw files** and **2 runtime tiles requiring both sources** because the EPSG:25833 source grid crosses the EPSG:25832 runtime grid.  
**Critical blocker:** the two authoritative raw files overlap by 10 m but their valid heights are not identical. The current production mosaic deliberately rejects the overlap instead of choosing first/newest/mean/tolerance. Dedicated diagnostics compare candidate surfaces to Kartverket's seamless 1 m WCS only as an independent QA sensor; WCS is not admitted as source authority and no official Kartverket overlap-priority rule has yet been found.  
**Acceptance:** document an evidence-backed deterministic seam transform with explicit provenance/config identity, then run one controlled cold live 3×3 compile followed by source-network-free offline repeat. Require 9 independently identified artifacts/bundles, identical cold/offline artifact hashes, 9/9 `READY_FOR_RUNTIME`, no raw TIFFs in Git/evidence uploads, and unchanged center-tile bytes from the accepted single-tile vertical.  
**Do not claim:** a real 3×3 terrain artifact pass until this gate executes successfully.

### P0-ATOM-INDEX-01 — Exact spatial source selection
**Status:** LIVE DTM1 SOURCE + MULTI-SOURCE SET PLANNING PASS  
**Owner area:** `engine/compiler`  
**Done/evidence:** production parser uses GeoRSS lat/lon -> lon/lat normalization and Shapely actual `covers`; bbox remains prefilter only. Live official DTM1 dataset feed contained 2033 polygon entries in EPSG:25833. Single-tile selection resolves the accepted Nannestad file from the explicit `rel=section`, `type=application/geotiff` link; filename/title guessing is forbidden. Multi-tile source-set planning also requires the declared geometry union to cover the runtime tile and fails closed on ambiguous minimal source sets.  
**Next:** reuse the same fail-closed pattern for later terrain/source families rather than generalizing from filenames.

### P0-PROVENANCE-02 — Runtime-verifiable lineage
**Status:** NODE + REAL CHROME FULL-GRAPH PARITY PASS / DEVICE-SPECIFIC COST CHECK DEFERRED TO MILESTONE  
**Owner area:** `engine/schemas`, `engine/streaming`, browser artifact consumer  
**Done/evidence:** strict JSON Schema 2020-12 contracts and producer compatibility are merged. Provenance semantics now live once in crypto-agnostic `runtime_verifier_core.mjs`; Node and browser adapters only calculate RFC 8785/JCS + SHA-256 hashes. Hosted parity run `32136500278` requires identical Node/WebCrypto decision, code and reconstructed hashes across all **11** existing happy/adversarial cases. Real Chrome run `32136951610` then reconstructs the complete provenance graphs for the exact Nannestad road/building artifacts before decode and still reports **0 raw-source calls**. Focused browser regressions reject forged lineage and tampered bytes and preserve the pre-fetch raw-source transport guard.  
**Performance observation:** separate hosted runs moved road/building `verify_decode_ms` from roughly **112.9 / 89.8 ms** before full browser graph verification to **201.7 / 173.4 ms** with it; boot-to-first-visible moved ~788.5 -> ~993.5 ms. The runs are not a controlled crypto-only A/B and other phases varied, so this is a measurement trigger rather than an exact causal cost. Forsøk 18 additionally measured ~20.1 ms WebCrypto/JCS verification for a synthetic 4 MB-class terrain fixture in Chrome. Security semantics remain mandatory.  
**Proof:** `docs/proofs/2026-08-18-browser-provenance-parity.md` and `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`.  
**Next:** use automated browser profiling to isolate provenance/decode cost and compare worker/caching strategies if the evidence justifies it. A physical mobile cost check may be batched into a later milestone, but it is not required to continue platform-neutral provenance/runtime work.

### P0-NVDB-01 — Road adapter
**Status:** REAL-DATA VERTICAL PASS / WIDTH + PHYSICAL SURFACE SEMANTICS OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** NVDB V4 acquisition sends required `X-Client: NorgeWorldEngine-Compiler`; raw JSON is validated/hashed/cached outside Git, EPSG:25833 -> EPSG:25832 is explicit, valid NN2000 Z is preserved, Shapely clips the 1 km tile and compatible degree-2 chains are collapsed. Hosted real-data proof: **471 raw -> 407 normalized segments -> 246 road paths**, raw SHA `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`, artifact SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`. Cold total 2168.958 ms; warm/offline 148.363 ms with identical artifact SHA. Forsøk 16 keeps valid NVDB NN2000 centerline Z and uses DTM1 only as ground/fallback.  
**Next:** separate topology from physical surface width/lane/crossfall semantics; do not infer authoritative asphalt width solely from `typeVeg`. The current visual road ribbon gives both lateral edges centerline Z and is not an authoritative road-surface model.

### P0-BUILDINGS-01 — Building volumes
**Status:** REAL FOOTPRINT + DTM GROUNDING PASS / HEIGHT + RELATION ENRICHMENT OPEN  
**Owner area:** `engine/compiler`  
**Done/evidence:** OSM API 0.6 source is hashed/cached, WGS84 -> EPSG:25832 is explicit, Shapely validates/clips polygons, and explicit `height` / `building:levels` provenance is preserved without silent authoritative fallback. Hosted real-data proof: **5,704 raw elements / 141 building candidates -> 135 validated+compiled footprints**, artifact SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`. Cold total 1145.537 ms; warm/offline 63.811 ms with identical artifact SHA. Forsøk 16 grounds footprint bases against the real DTM1 artifact.  
**Historical device evidence:** 15/135 building heights are source-backed; **120/135 remain explicit 5 m debug fallback**.  
**Still open:** OSM multipolygon relations, DOM-DTM height enrichment as a separate provenance-bearing transform, and capability-gated FKB evaluation. Unresolved height must remain unresolved in authoritative data.

### P0-VECTOR-ARTIFACT-01 — Persisted road/building runtime artifacts
**Status:** REAL-DATA + NODE/BROWSER RUNTIME VERIFICATION + HISTORICAL ANDROID VISUAL PASS  
**Owner area:** `engine/compiler`, `engine/schemas`, viewer consumer  
**Done/evidence:** raw SHA-addressed cache/offline fail-closed mode; normalized + compiled artifact chain; exact RuntimeVerificationBundle. Historical Android Forsøk 15/16 proved artifact-only visual consumption, while real Chrome now performs full WebCrypto/JCS provenance reconstruction on the accepted road/building identities before decode with 0 raw-source calls.  
**Proof:** `docs/proofs/2026-08-17-nannestad-vector-realdata.md`, `docs/proofs/2026-08-17-forsok16-android-runtime.md`, `docs/proofs/2026-08-18-browser-provenance-parity.md`.  
**Next:** keep vector geometry stable while road physical-surface semantics, building-height enrichment and larger-world runtime integration proceed independently. Do not request a fresh handset run just to refresh already-proven artifact-consumer behavior.

### P0-VIEWER-01 — Measurable compiled-artifact viewer
**Status:** EXACT-REAL HOSTED CHROME WEBGL2 MOVEMENT + RENDERER-RESOURCE LIFECYCLE PASS / LARGER-WORLD + WEBGPU EXPERIMENTS OPEN  
**Done/evidence:** Existing Forsøk 16 Android and real-vector batching/provenance evidence remains valid as historical milestone evidence. Clean restack PR #44 composes the accepted Nannestad terrain/roads/buildings through the deployable Vite viewer with full runtime verification, module DedicatedWorker terrain mesh generation, scheduler/cache movement and renderer resource lifecycle. `world-viewer-vite` run `32202573843` passed the exact-real Chrome smoke with 0 raw-source calls, `resolver_calls 1 -> 1`, `loads_started_delta=0`, `cache_hits_delta=1`, and terrain resource checkpoints active -> inactive -> active with buffer counts `3 -> 0 -> 3`. Device evidence also requires strict scheduler-event/lifecycle-observation correlation before PASS. The same run preserved the fail-closed device comparator that rejects backend fallback and same-active-backend A/B.  
**Important limitation:** hosted Chrome could not acquire a usable WebGPU adapter, so no WebGPU/WebGL2 hosted timing comparison is claimed. `physical_vram_release_observed=false`; renderer resource destruction does not prove driver/physical VRAM reclamation. These limitations constrain those specific claims without blocking ordinary viewer/runtime progress.  
**Proof:** `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`, `docs/proofs/2026-08-19-sentinel-device-lifecycle-restack.md`.  
**Next:** advance larger-world/multi-tile-capable viewer integration, WebGPU capability experiments where automation provides a genuine backend, and measurable browser performance. Keep the physical device harness ready for a later batched milestone rather than making a user-operated handset test the next gate.

### P0-STREAMING-01 — Verified terrain tile lifecycle
**Status:** SCHEDULER + EXACT-REAL HOSTED CHROME CACHE/RESOURCE ROUNDTRIP PASS / MULTI-TILE + BUDGET/LOD POLICY OPEN  
**Owner area:** `engine/streaming`  
**Done/evidence:** `TileStreamingScheduler`, deterministic terrain mesh worker boundary, `terrain_tile_loader.mjs`, renderer-neutral lifecycle observation and strict trace validation are merged foundations. Clean restack PR #44 connects those foundations to actual Preview terrain resources. Exact-real Chrome run `32202573843` used the accepted terrain SHA `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`, full `RUNTIME_VERIFICATION_PASS`, and the movement path center -> 1000 m east -> center with active radius 800 m / retain radius 1200 m. The tile became cached without refetch, then resident from cache: resolver calls remained 1, no new load started, exactly one cache hit occurred, renderer terrain resources changed present -> absent -> present, create/destroy deltas were +1/+1, and the trace retained 12 entries with 0 dropped entries. Exact lifecycle observations correlate with scheduler activation/deactivation events before evidence can PASS.  
**Resource evidence:** terrain buffer accounting changed `595,992 -> 0 -> 595,992` B and buffer count `3 -> 0 -> 3`; final state had 2 creates / 1 destroy. This proves renderer resource object lifecycle, not physical VRAM reclamation timing.  
**Proof:** `docs/proofs/2026-08-18-terrain-runtime-pipeline.md`, `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`, `docs/proofs/2026-08-19-sentinel-device-lifecycle-restack.md`.  
**Open:** real 2×2/3×3 terrain remains blocked by `P0-MULTITILE-TERRAIN-01`. Hard resident/GPU budgets, worker pooling, verification caching and LOD remain unselected. Genuine device-specific performance remains a later milestone evidence class, not a routine blocker.  
**Next:** make the runtime ready for multiple promoted terrain tiles, improve cache/resource observability and design measured budget/LOD experiments that can run automatically. Batch physical mobile validation later when enough changes have accumulated to justify one run.

### P0-ARCH-REUSE-01 — 3D Tiles/runtime reuse spike
**Status:** TOOLING + CESIUM BASELINE BUILD PASS / SHARED TERRAIN+VECTOR RENDER ARTIFACT OPEN  
**Owner area:** `tools/runtime-packaging`, `prototypes/cesium-baseline`  
**Done:** pinned glTF-Transform/meshoptimizer/3D Tiles tools and CesiumJS baseline; hosted baseline builds the Cesium harness.  
**Next:** after the custom viewer has a repeatable fixed-camera benchmark for the same real terrain+vector inputs, generate/validate an equivalent render artifact for Cesium and compare on the same automatically available browser/runtime environment first: cold/warm bytes, RAM, first-visible, frame time, draw calls and tile churn. No renderer decision before evidence.

## Infrastructure

### INFRA-AGENTS-01 — Five-agent parallel ownership
**Status:** CONFIGURED / MANUAL-DEVICE POLICY ADDED  
**Owner area:** `.agents`, cross-project workflow  
**Done:** Agent v2 defines five primary roles: LUMEN (`apps/world-viewer`, WebGPU/WebGL experiments and Vercel Preview), STRØM (`engine/streaming`), FORGE (`engine/compiler` + source pipeline), ATLAS (world/coordinate contracts) and SENTINEL (integration/schemas/QA). Repo-local skills and role charters now share the `docs/07-testing-policy.md` rule: manual device testing is scarce milestone evidence, not a routine acceptance gate.  
**Acceptance:** skill validator must pass; role/task instructions must not automatically escalate ordinary work into user-operated Android testing.  
**Next:** use the five roles against current P0 engine gates, with automated evidence as the default validation path.

### INFRA-CI-01 — GitHub Actions hosted runner
**Status:** RESOLVED  
Repository is public and GitHub-hosted runners execute normally. Baseline passes on `main` and active P0 branches. `baseline-self-hosted.yml` remains only as an optional controlled fallback.

### INFRA-CI-02 — Real-data proof trigger hygiene
**Status:** RESOLVED / MERGED  
DTM1, vector and viewer real-data workflows have reusable main/PR/manual trigger contracts rather than historical agent-branch assumptions. Heavy DTM seam diagnostics remain manual evidence gates to avoid repeated multi-GB downloads without new information.

## Explicitly deprioritized until current P0 evidence is integrated

- renderer polish and photorealism beyond QA;
- AI/dialog/media systems;
- broad Unreal integration;
- full-Norway prebuild;
- FKB work that blocks terrain/viewer measurement;
- production imagery dependency before redistribution/cache rights are documented.

## LUMEN device-evidence capability — retained, not a routine gate

### P0-VIEWER-DEVICE-COMPARABILITY-01 — Same-device renderer benchmark validity
**Status:** STRICT BACKEND/SESSION/BUILD/ARTIFACT/CAMERA/SURFACE/STREAMING CONTRACT INTEGRATED / HOSTED WEBGL2 EXACT-REAL PASS / PHYSICAL A/B HARNESS READY FOR LATER MILESTONE  
**Owner area:** `apps/world-viewer`  
**Problem found:** exposed browser/device metadata can establish context similarity but cannot prove that two captures were made on the same physical handset; two identical devices may expose identical UA/screen/DPR/memory/concurrency values. Treating metadata equality as physical-device attestation would overclaim the evidence class. Backend fallback or two captures on the same active backend must never be treated as a WebGL2/WebGPU A/B.  
**Implemented:** device evidence requires a shared capture session plus exact build SHA, accepted artifact hashes, full provenance status, graphics workload, camera, render surface, measurement window and stable streaming/resource-lifecycle comparison contract. `compareDeviceEvidenceContext()` requires one non-fallback WebGL2 and one non-fallback WebGPU active backend for a genuine A/B. `target=android-chrome` retains conservative browser-signal validation and evidence records `physical_device_attested: false`. PR #44 additionally requires exact lifecycle trace correlation for movement evidence.  
**Structural/e2e evidence:** focused Node regressions accept valid cross-backend context and reject changed/missing session, fallback, same-backend pairs, changed camera/render surface/build/window/streaming context, raw-source URLs, invalid provenance and malformed lifecycle evidence. Hosted exact-real Chrome run `32202573843` passes the WebGL2 movement/resource path; hosted WebGPU was unavailable, so a genuine cross-backend device A/B remains unproven.  
**Milestone rule:** if and when a physical Android/WebGPU comparison is worth running, use the same `session` value, require each requested backend to actually activate with no fallback, and require `compareDeviceEvidenceContext()` to return `comparable=true` before interpreting timing. This is a future device-specific evidence procedure, not an active per-PR blocker.  
**Proof:** `docs/proofs/2026-08-18-lumen-device-evidence-build-boundary.md`, `docs/proofs/2026-08-18-lumen-device-capture-session-boundary.md`, `docs/proofs/2026-08-19-sentinel-device-lifecycle-restack.md`.  
**Next:** keep this harness regression-tested while prioritizing larger-world viewer/streaming progress. Trigger a physical run only under `docs/07-testing-policy.md` when a meaningful accumulated milestone or device-only blocker justifies the user's effort.
