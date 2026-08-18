# `engine/world` — candidate world-coordinate contract

This module owns the boundary between authoritative world state and disposable local presentation/subsystem frames. It is intentionally renderer-, streaming-, physics- and network-library independent.

## Contract v0.1 candidate

`WorldFrame` names the coordinate authority. Horizontal CRS and vertical datum are separate mandatory fields. The current v0.1 arithmetic model is `projected-cartesian-height`: easting, northing and datum-qualified height are metre-valued JavaScript Numbers (IEEE-754 Float64). Nannestad may instantiate this with `EPSG:25832` + `NN2000`; that does **not** make EPSG:25832 a whole-Norway policy.

`WorldPosition` is authoritative state and always carries `worldFrameId`. Renderer-local positions are derived as `Float32Array(3)` only after Float64 subtraction against a `RenderOrigin.anchorWorld`. The renderer may retain local coordinates, GPU buffers and an `originEpoch` for presentation/history, but must not write those values back as world truth.

`RenderOrigin` contains an explicit `originSeriesId`, world-frame anchor and monotonic safe-integer epoch. The pair `(originSeriesId, epoch)` identifies the local frame, so samples from another camera/session cannot alias merely because the numeric epoch matches. The policy that chooses the anchor or shift threshold is deliberately outside this module. A shift increments the epoch and returns the Float64 world-space origin delta. Raw local deltas across different epochs are rejected; temporal systems either reconstruct/compensate using the matching historical origins or reset their history.

`TileFrame` gives a runtime tile identity a high-precision anchor in the same `WorldFrame`. Tile-local coordinates are offsets from that anchor. `tileLocalToRenderLocal()` combines tile and render anchors in Float64 before the single Float32 storage conversion, so large absolute projected coordinates never need to pass through Float32 world space.

`SubsystemLocalFrame` is the generic future boundary for physics or other local engines. Its anchor/epoch is independent of `RenderOrigin`; changing presentation origin cannot move physics/world state. Network/authoritative serialization uses `nwe.authoritative-world-snapshot/0.1`, carries the explicit `WorldFrame`, and excludes render origin/epoch entirely.

## Explicit non-decisions

- No whole-Norway horizontal CRS/indexing strategy is selected.
- No render-origin anchor or shift threshold is selected.
- No physics engine, physics precision, island size or rebasing policy is selected.
- No networking authority/quantization protocol is selected.
- No tile size or tile-local storage precision is selected by this module.
- `projected-cartesian-height` is the candidate v0.1 arithmetic model exercised by current Prototype-0 evidence; replacing/expanding it requires a versioned contract and representative measurements.

## Regression

```bash
node --check engine/world/world_contract.mjs
node --check engine/world/test_world_contract.mjs
node engine/world/test_world_contract.mjs
python -m json.tool engine/world/schemas/authoritative-world-snapshot-v0.1.schema.json >/dev/null
```

The adversarial suite covers large absolute coordinates, origin shift mid-tick, temporal delta across epoch boundaries, historical origin retention, tile-boundary crossing, entity crossing the render anchor, authoritative serialization/replay and a render-independent physics/subsystem adapter.
