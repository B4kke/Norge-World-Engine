# 2026-08-18 — ATLAS candidate world-coordinate contract

## Scope

This is a production-direction contract/regression in `engine/world`, not a final whole-Norway coordinate-policy decision. It makes the already-proven Float64-world / Float32-render-local direction explicit enough for renderer, streaming and future simulation/physics/network boundaries without selecting a renderer, physics engine, network protocol, tile size, render-origin threshold or national CRS/index.

Evidence class in this change is **local Node/structural regression**. Existing precision/origin experiments remain separate evidence. No browser, Android, GPU or real physics-engine acceptance is claimed here.

## Candidate contract

- `WorldFrame` is the coordinate authority and requires separate `horizontalCrs` and `verticalDatum` identities plus explicit metre units and axis order.
- v0.1 arithmetic is `projected-cartesian-height`: authoritative easting/northing/datum-qualified height are IEEE-754 Float64 JavaScript Numbers. The Nannestad test frame is `EPSG:25832` + `NN2000`; this does not select that CRS for all Norway.
- `WorldPosition` is authoritative. Renderer-local `Float32Array(3)` is derived only after Float64 subtraction from a high-precision render-origin anchor.
- A render-local frame is identified by `(originSeriesId, epoch)`, not epoch alone. This prevents equal numeric epochs from different camera/session histories from aliasing.
- An origin shift increments epoch and returns its Float64 world-space delta. It cannot mutate authoritative entity state.
- Historical render samples can only be reconstructed with the retained matching origin series+epoch. Raw local deltas across an epoch boundary fail closed; temporal code must compensate/reconstruct or reset history.
- `TileFrame` binds tile identity to a high-precision anchor in the same `WorldFrame`. Tile-local -> render-local composes tile and render anchors in Float64 before the single Float32 cast.
- `SubsystemLocalFrame` is a renderer-independent adapter boundary for a future physics island or similar local engine. Its anchor/epoch is independent of render origin.
- Authoritative snapshot serialization includes world-frame CRS/datum metadata, tick and sorted world positions; render origin/epoch is deliberately excluded.

## Adversarial regression

Authoring environment: Node `v22.16.0`, Linux x64.

`node engine/world/test_world_contract.mjs` reports:

```json
{"status":"PASS","contract":"nwe.world-coordinate-contract/0.1-candidate","cases":8,"authoritative":"Float64 JS Number / explicit world frame","renderLocal":"Float32Array / origin epoch scoped","wholeNorwayPolicy":"OPEN"}
```

The eight cases cover:

1. large projected absolute coordinates with Float64-before-Float32 subtraction;
2. render-origin shift mid-tick with unchanged authoritative state;
3. temporal delta over an epoch boundary plus historical-origin retention/expiry;
4. tile-boundary crossing with identical reconstructed world position;
5. entity crossing the render-origin anchor without world-state discontinuity;
6. deterministic authoritative serialization/replay under fixed vs shifted render-origin schedules;
7. a physics/subsystem-local Float64 adapter remaining invariant across 1,000 render-origin shifts;
8. fail-closed missing vertical datum, world-frame mismatch, stale epoch and foreign origin-series cases.

Focused numerical observation from the large-coordinate case:

- maximum world reconstruction error from the derived Float32 local sample: **0.024125 mm**;
- naïvely converting the absolute northings to Float32 before subtraction produces **0.085877 m** error in the same case;
- maximum origin-compensated physical-delta error across the exercised mid-tick shift: **0.048829 mm**.

These are regression-case observations, not a threshold study and not whole-Norway acceptance numbers.

## Serialization/replay boundary

Schema `engine/world/schemas/authoritative-world-snapshot-v0.1.schema.json` requires explicit horizontal CRS and vertical datum. The regression serializes the same simulated world evolution under two different render-origin schedules and requires byte-identical authoritative JSON at the final tick. This makes render-origin presentation state non-authoritative by construction.

The current snapshot schema intentionally contains only entity positions. Velocity/components, network quantization and deterministic simulation event encoding remain future versioned contracts; adding them must not make render-origin state authoritative.

## CI gate

`.github/workflows/baseline.yml` now runs syntax checks, the adversarial world-contract regression and JSON-schema parsing. This turns the contract into a repository gate rather than leaving it as prose/prototype guidance.

## Open / not selected

- whole-Norway horizontal CRS or multi-frame/indexing strategy;
- vertical transformation policy outside the explicit datum identity;
- render-origin anchor selection and shift threshold;
- whether renderer temporal systems compensate motion vectors or reset history on epoch change;
- actual physics precision/island/rebase policy;
- network authority, quantization, prediction/reconciliation and replay protocol;
- tile-local persisted precision and national tile hierarchy.

No entry is added to `docs/04-decisions.md` from this contract alone. Representative browser/device/camera/physics measurements are still required before a final coordinate policy.
