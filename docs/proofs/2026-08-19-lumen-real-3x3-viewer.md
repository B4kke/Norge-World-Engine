# LUMEN real 3x3 viewer proof — 2026-08-19

## Gate

`P0-MULTITILE-TERRAIN-01` / `P0-VIEWER-01` browser integration using FORGE's direct `NHM DTM 25832 WCS` **candidate** path.

**Browser/runtime result:** `PASS / READY FOR SENTINEL REVIEW` for the Nannestad Prototype-0 real 3x3 terrain composition.

**Production-source result:** unchanged. This proof does **not** select WCS as the production terrain source and does not close the canonical `P0-MULTITILE-TERRAIN-01` source-authority gate. FORGE/SENTINEL must still reconcile the current Atom-based acceptance contract with any source-family transition.

This proof also does not select a whole-Norway source/LOD policy and does not claim multi-tile WebGPU performance.

## Exact code evidence

LUMEN code head that established the browser result: `ac58bb1df9f601e2672cd61e9ffa423618953074`.

PR-to-main merge ref tested by GitHub Actions: `319f83ac46849091d676f447c1b7c74d83568e21`.

Workflow: `preview1-realdata-publish` run `32253585673`.

Job: `compile-verify-publish` / `96070137556` — `SUCCESS`.

Evidence artifact:
- ID `9365484367`;
- name `preview-browser-proofs-319f83ac46849091d676f447c1b7c74d83568e21`;
- ZIP SHA-256 `e77b3e1508b7a5c8ec59a039bd423a36aeec8aaa2b19c7c4594bec4fc5f3affc`;
- 3 JSON proof/staging files only; no raw provider data.

Repository baseline run `32253585695` passed on the same LUMEN code head, including terrain-loader, streaming, worker, provenance and viewer-boundary regressions. `world-viewer-vite` run `32253585834` also passed.

## Real 3x3 runtime snapshot

The staging pipeline compiled FORGE's direct `NHM DTM 25832 WCS` candidate into nine independently identified NWE 1 km terrain artifacts.

Snapshot staging:
- terrain tile count: **9**;
- extent: **3 km x 3 km / 9 km²**;
- total terrain artifact bytes: **36,003,413 B**;
- complete staged snapshot: **36,336,336 B**;
- center terrain artifact: `a0f6107ce9497a9e7221aa06a7b590cb9b8b2958ac316c32ef79059e604b052e`;
- center roads artifact: `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- center buildings artifact: `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`.

All nine terrain artifacts plus roads/buildings were reconstructed by `runtime_verifier.mjs` before the snapshot was admitted for browser testing. All returned `RUNTIME_VERIFICATION_PASS`.

The publish step force-replaced orphan branch `preview-runtime` only after the Node verification and both browser gates passed. The branch contains compiled artifacts, bundles, manifest and attribution only; raw Kartverket/NVDB/OSM source material is not published.

The published snapshot is prototype evidence for the WCS candidate. It must not be interpreted as production-source selection while the canonical source acceptance contract remains unresolved.

## Backward-compatible center viewer

The existing Preview 1 browser gate was deliberately retained against the WCS-candidate center artifact.

Result:
- `status=PASS`;
- phase `REAL WORLD READY`;
- center WCS-candidate artifact accepted by the existing browser pipeline;
- `raw_source_runtime_calls=0`;
- WebGL2 fallback remained valid in hosted Chrome when no WebGPU adapter was available;
- center balanced terrain mesh: 16,641 vertices / 32,768 triangles.

This proves compatibility of the candidate artifact with the existing runtime consumer. It does not replace the canonical D-007 center identity without an explicit source-selection decision.

## Real Preview 3 browser gate

Hosted Chrome loaded `/preview3.html` from the built Vite output with the complete staged runtime snapshot served from the same origin.

Hard acceptance results:
- phase: **`3×3 WORLD READY`**;
- terrain tiles: **9/9**;
- runtime verification: **9/9 `RUNTIME_VERIFICATION_PASS`**;
- scheduler loads started/completed/failed: **9 / 9 / 0**;
- scheduler activations: **9**, activation failures **0**;
- peak concurrent terrain loads: **2**;
- resident terrain tiles after idle: **9**;
- raw-source browser calls: **0**;
- audited runtime manifest/bundle/artifact requests: **23**, all same-origin and compiled-only;
- retained terrain runtime bytes: **42,562,080 B**;
- cache/resident budget overcommit: **0 B**.

Renderer baseline:
- backend: **WebGL2**;
- terrain tiles on GPU: **9**;
- terrain vertices: **149,769**;
- terrain triangles: **294,912**;
- total draw calls per frame: **12** (9 terrain + center vector layers);
- GPU buffer objects: **33**;
- GPU payload bytes tracked by renderer: **5,617,182 B**;
- active terrain GPU buffers: **27**;
- terrain resource creates/destroys at first visible: **9 / 0**;
- first-frame draw CPU observation: **~1.4 ms** on hosted headless Chrome/SwiftShader;
- boot-to-first-visible observation: **~1,685 ms**.

The hosted timing is directional evidence only. SwiftShader/headless Chrome is not a physical Android/GPU performance acceptance environment.

## Shared render-local frame

All nine terrain meshes are derived from EPSG:25832/NN2000 WCS-candidate tile artifacts, but GPU positions use one shared local render origin anchored at the center tile. Absolute EPSG-scale coordinates are therefore not written directly into Float32 GPU vertex positions.

This is a renderer-local realization of the existing world-model rule: authoritative world coordinates remain high precision; GPU geometry is disposable render-local Float32.

## Runtime contract bug found and fixed

The first browser integration attempt exposed a real cross-module contract bug rather than a data/provenance failure.

FORGE WCS candidate artifacts correctly encode `nodata: null` when the response has 1,000,000 valid samples and no nodata sentinel. The old terrain decoder unconditionally required `nodata` to be a finite number, so Node provenance verification passed while browser artifact decode failed.

The runtime loader now accepts either:
- `nodata: null`, meaning there is no nodata sentinel; or
- a finite numeric nodata sentinel.

Non-finite elevation values remain rejected, and numeric nodata samples remain rejected. `test_terrain_tile_loader.mjs` now has an explicit no-nodata regression; baseline passed with 8 terrain runtime pipeline cases.

This is a narrow STRØM-owned runtime contract correction encountered during LUMEN integration and should receive SENTINEL review with the rest of the stack.

## Current visual/world scope

The browser now demonstrates real multi-tile terrain capability, but it is not yet a visually complete 3x3 world:
- terrain: **real WCS-candidate 3x3 / 9 km²**;
- roads: current verified **center 1x1 km only**;
- buildings: current verified **center 1x1 km only**;
- road physical width/crossfall: unresolved authoritative semantics;
- 120/135 center building heights remain explicit visual debug fallback;
- imagery/orthophoto textures: not yet selected as a production source;
- vegetation/procedural surface detail: not authoritative and not yet part of this proof;
- multi-tile WebGPU: not claimed.

## What this proves

NWE has crossed the **single-tile browser capability** boundary for the WCS candidate: the browser can consume nine independent, provenance-verifiable real terrain artifacts, schedule and mesh them through the runtime worker path, place them in one stable render-local frame and keep nine terrain GPU resources resident simultaneously without contacting provider/raw sources.

It does **not** prove that WCS has been accepted as production world truth. The canonical source decision remains with FORGE/SENTINEL and the task-queue acceptance contract.

A 5x5 request-count test is therefore not the highest-value next renderer action merely to prove that more tiles can load. The higher-value prototype work is to make the larger-world representation efficient and visually useful while source selection is reviewed independently.

## Recommended next gate

1. **Terrain mesh/LOD + movement-driven residency.** The current balanced profile is one 129x129 mesh per 1 km tile. Add explicit distance-aware LOD/edge policy and drive scheduler interest from actual camera/player movement, then measure frame time, worker time, resident memory, GPU bytes and tile latency.
2. **Multi-tile vectors.** Compile/publish roads and buildings for the same 3x3 so the visible world outside the center tile is not terrain-only.
3. **Imagery/texture source contract.** Evaluate an official/open orthophoto or other surface source for coverage, CRS, resolution, update cadence, license, access method and practical tiling. Only after that should a texture tile pipeline be bound to terrain LOD/mips.
4. **Materials/vegetation/procedural detail** after terrain/vector/imagery streaming boundaries are measurable.

These prototype/runtime investigations can proceed without pretending the source-authority question is already settled. The final whole-Norway terrain mesh/LOD format remains an open decision; the current runtime height-grid remains an engine-independent interchange artifact, not a commitment to render 1 m meshes everywhere.
