# 2026-08-19 — Canonical Preview terrain renderer-resource lifecycle

Role: LUMEN — Renderer & Web Platform  
Primary gate: `P0-STREAMING-01` renderer-resource lifecycle prerequisite  
Stacked integration: SENTINEL #37 exact-real Preview/device-evidence path  
Prior structural evidence: LUMEN #39 terrain-lab lifecycle

## Scope

This experiment binds the canonical Preview 1 single-tile scheduler movement path to renderer-owned terrain resources. It does not change source acquisition, provenance semantics, tile identity, seam authority, spatial LOD policy or simulation state.

The renderer-resource contract is terrain-only. Road/building buffers and renderer programs/pipelines remain resident across the terrain tile cache round-trip. WebGPU uniforms and depth/MSAA attachments also remain resident.

## Contract

Both Preview renderer adapters expose:

- `getTerrainResourceLifecycle()`;
- `deactivateTerrainResource()`;
- `activateTerrainResource(payload)`.

Reactivation fails closed unless the retained payload has the exact expected tile id and terrain artifact SHA.

The movement probe requires:

1. initial scheduler `resident` -> terrain renderer resource active;
2. camera `+1000 m E`, outside active 800 m but inside retain 1200 m -> scheduler `cached`, terrain renderer resource inactive;
3. return to center -> scheduler cache hit, terrain renderer resource active again;
4. resolver remains `1 -> 1`, `loads_started_delta=0`, `cache_hits_delta=1`;
5. renderer terrain resource deltas are exactly `+1 destroy / +1 create`;
6. renderer backend and tile/artifact identity do not change;
7. `physical_vram_release_observed=false`.

Device evidence rejects movement evidence that lacks this renderer lifecycle or attempts to claim physical VRAM reclamation. The stable WebGL2/WebGPU comparison contract includes lifecycle state/count structure but intentionally excludes renderer backend and lifecycle timings so matched cross-backend A/B remains possible.

## Exact hosted Chrome evidence

Code head: `254680e9e994b638509736a16086723a0cc6a9e3`  
Stack base: SENTINEL #37 head `9614730fa188e4039ba60edebc8de189f9470c74`

GitHub Actions:

- `world-viewer-vite` run `32199290166` / #181 — **PASS**;
- `baseline` run `32199290131` / #1049 — **PASS**;
- `viewer-benchmark` run `32199290255` / #180 — **PASS**.

The pull-request test build embeds GitHub's PR test merge identity `9e03298161ce30a1565723bbe02210574892df10`; the Actions workflow itself is associated with LUMEN head `254680e9...`. The distinction is recorded rather than treating the test merge SHA as the branch head.

Exact accepted runtime artifacts:

- terrain `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- roads `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- buildings `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`.

All three return `RUNTIME_VERIFICATION_PASS`; runtime requests = `7`; raw-source runtime calls = `0`.

### Renderer-resource checkpoints

WebGL2 canonical Preview reports `nwe.preview-terrain-resource-lifecycle/0.1`:

| Checkpoint | Active | Terrain GPU buffers | Terrain GPU payload | Creates | Destroys |
|---|---:|---:|---:|---:|---:|
| initial resident | true | 3 | 595,992 B | 1 | 0 |
| cached | false | 0 | 0 B | 1 | 1 |
| returned resident | true | 3 | 595,992 B | 2 | 1 |

The 595,992 B is the canonical renderer's terrain buffer payload (position + normal + index). It is intentionally lower than the 729,120 B renderer-neutral worker mesh because the worker payload also contains UV data that this Preview renderer does not upload.

Movement evidence:

- path `center -> outside-active-inside-retain -> center`;
- resolver calls `1 -> 1`;
- load-start delta `0`;
- cache-hit delta `1`;
- renderer resource lifecycle observed `true`;
- resource create delta `1`;
- resource destroy delta `1`;
- physical VRAM release observed `false`.

Hosted timer observations for this run were ~0 ms destroy and ~0.9 ms cache reactivation. These values are coarse hosted/headless measurements and are not Android acceptance or GPU-budget evidence.

Actions proof artifact:

- artifact ID `9346923795`;
- ZIP digest `sha256:0b347f684da8e08c1ab6bfb60de26ba597ed862e150c57ac56eb7ea2c4396460`;
- proof schema `nwe.device-evidence-browser-smoke-proof/0.2`;
- status `PASS`.

## WebGPU boundary

The WebGPU renderer implements the same terrain-only resource adapter and passes syntax/Vite build gates. It preserves pipelines, uniforms, vector buffers and framebuffer attachments while destroying/recreating the three terrain buffers.

Hosted renderer benchmark evidence does **not** execute this lifecycle successfully because hosted WebGPU remained unavailable. The benchmark returned `PARTIAL`, with WebGL2 `PASS` and WebGPU `UNAVAILABLE` (`A valid external Instance reference no longer exists.`).

Therefore:

- WebGL2 canonical Preview resource lifecycle: **hosted exact-real PASS**;
- WebGPU resource lifecycle implementation: **structural/build PASS only**;
- Android WebGL2 resource lifecycle: **open**;
- Android WebGPU resource lifecycle: **open**.

## Claim boundary

`deleteBuffer`, `deleteVertexArray` and `GPUBuffer.destroy()` plus renderer ownership state prove resource-object lifecycle. They do not reveal the exact instant the browser/driver physically returns VRAM. No hard GPU-memory budget is selected from this evidence.

This remains a verified **single tile**. Real 2x2/3x3 terrain remains blocked by `P0-MULTITILE-TERRAIN-01` seam/source authority. Existing 65/129/257 mesh resolutions remain graphics-profile experiments and are not a spatial/distance LOD policy.

## Parallel integration

STRØM #40 separately adds renderer-neutral lifecycle callback observation. Its role is complementary: once composed, it can time/trace the scheduler adapter calls without placing WebGL/WebGPU logic inside `engine/streaming`.

FORGE #35 still has `production_seam_authority=false`. The WCS candidate-source experiment has been handed off separately and is not a dependency for this single-tile lifecycle proof.

## Next

1. Compose STRØM #40 lifecycle observations with this canonical Preview bridge without duplicating renderer telemetry.
2. Capture fresh Android WebGL2 device evidence on the exact integrated commit and require the same resource checkpoints.
3. Capture WebGPU only on a device/browser where an adapter is actually available; do not promote build-only evidence.
4. Keep real neighboring terrain fail-closed until FORGE establishes source/seam authority.
5. After real neighbors exist, run multi-tile resource churn, resident/GPU budgets and then a measured spatial LOD experiment.
